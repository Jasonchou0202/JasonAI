#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""内容闭环看板 · 选题流水线卡片 ＋ 采集入口详情
- 快照按采集时间归入 4 个时段：2 小时 / 下午 3 点 / 晚上 9 点 / 24 小时；归不进去的（例如 72 小时）留在数据里，页面不显示
- 每个平台一张小图：4 根堆叠柱（赞、评、藏、转），折线连各时段互动合计；平台没有的字段按缺失处理，不当 0
- 图表是内联 SVG，不引外部库"""
import html
from datetime import timedelta
from validate import parse_time

E = html.escape
NUM = '①②③④⑤⑥⑦'
SLOTS = [('2h', '2小时'), ('15:00', '下午3点'), ('21:00', '晚上9点'), ('24h', '24小时')]
CHART_PF = ['抖音', '公众号', '视频号', '小红书']
STATUS_PF = ['抖音', '公众号', '视频号', '小红书', '朋友圈']
PARTS = [('赞', '#166b55'), ('评', '#5f9e86'), ('藏', '#a9d3c1'), ('转', '#d9b45f')]
HEAD = {'抖音': '播放', '公众号': '阅读', '视频号': '播放', '小红书': '观看'}
RED = {'pass': ('红线通过', 'r-ok'), 'check': ('红线待核', 'r-warn'), 'hit': ('红线命中', 'r-bad'), 'todo': ('复查待做', 'r-wait')}

def _pt(t, year):
    return parse_time(t, year) if t else None

def slot_map_for(year):
    """返回 slot_map(topic) -> {平台: {slot: 快照}}"""
    def slot_map(t):
        out = {}
        for pfn in CHART_PF + ['朋友圈']:
            q = next((x for x in t['platforms'] if x['platform'] == pfn), None)
            pub = _pt(q.get('time'), year) if q else None
            ss = [s for s in t['snapshots'] if s['platform'] == pfn]
            cand = {k: [] for k, _ in SLOTS}
            for s in ss:
                st = _pt(s['time'], year)
                if s['slot'] in cand:  # 已标好的时段直接用
                    cand[s['slot']].append((0, -st.timestamp() if st else 0, s)); continue
                if s['slot'] != 'other' or not st: continue  # 72h 等旧标签不显示
                el = (st - pub).total_seconds() / 3600 if pub else None
                same = pub and st.date() == pub.date()
                if el is not None and 1.5 <= el <= 3.0: cand['2h'].append((1, abs(el - 2), s))
                elif same and 14 <= st.hour + st.minute / 60 < 17.5: cand['15:00'].append((1, abs(st.hour + st.minute / 60 - 15), s))
                elif same and st.hour >= 19: cand['21:00'].append((1, abs(st.hour + st.minute / 60 - 21), s))
                elif el is not None and 20 <= el <= 30: cand['24h'].append((1, abs(el - 24), s))
            out[pfn] = {k: sorted(v, key=lambda x: (x[0], x[1]))[0][2] for k, v in cand.items() if v}
        return out
    return slot_map

def chart(pfn, slots):
    """一个平台的小图。slots: {slot: 快照}；只画 metrics 是对象的快照"""
    W, H, PADL, PADB, TOP = 232, 120, 6, 22, 16
    bw = 30; gap = (W - PADL * 2 - bw * 4) / 3
    vals = []
    missing = set()
    for k, _ in SLOTS:
        s = slots.get(k); m = s['metrics'] if s and isinstance(s['metrics'], dict) else None
        if m is None: vals.append(None); continue
        parts = [(n, m.get(n) if isinstance(m.get(n), (int, float)) else None) for n, _ in PARTS]
        for n, v in parts:
            if v is None: missing.add(n)
        vals.append((parts, sum(v for _, v in parts if v is not None), s))
    mx = max([v[1] for v in vals if v] + [1]) * 1.15
    sc = lambda v: (H - PADB - TOP) * v / mx
    g = ''; pts = []
    for i, ((k, lab), v) in enumerate(zip(SLOTS, vals)):
        x = PADL + i * (bw + gap); base = H - PADB
        if v is None:
            g += f'<rect x="{x:.1f}" y="{base - 18}" width="{bw}" height="18" rx="3" fill="none" stroke="#c8d0ca" stroke-dasharray="3 3"/><text x="{x + bw / 2:.1f}" y="{base - 5}" class="cz">待采</text>'
        else:
            y = base
            tip = ' · '.join(f'{n} {"缺" if vv is None else vv}' for n, vv in v[0])
            g += f'<g><title>{E(lab)} · {E(v[2]["time"][5:])} 采集：{E(tip)} · 合计 {v[1]}</title>'
            for (n, vv), (_, col) in zip(v[0], PARTS):
                if not vv: continue
                h = sc(vv); y -= h
                g += f'<rect x="{x:.1f}" y="{y:.1f}" width="{bw}" height="{h:.1f}" fill="{col}"/>'
            g += '</g>'
            pts.append((x + bw / 2, base - sc(v[1]), v[1]))
        g += f'<text x="{x + bw / 2:.1f}" y="{H - 6}" class="cx">{E(lab)}</text>'
    if len(pts) > 1:
        g += '<polyline fill="none" stroke="#124d3f" stroke-width="1.6" points="' + ' '.join(f'{px:.1f},{py:.1f}' for px, py, _ in pts) + '"/>'
    for px, py, v in pts:
        g += f'<circle cx="{px:.1f}" cy="{py:.1f}" r="2.6" fill="#fff" stroke="#124d3f" stroke-width="1.5"/><text x="{px:.1f}" y="{py - 5:.1f}" class="cv">{v}</text>'
    svg = f'<svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="{E(pfn)} 各时段赞评藏转">{g}</svg>'
    shown = [v for v in vals if v]
    head = ''
    if shown:
        last = shown[-1][2]; hk = HEAD.get(pfn)
        if hk and isinstance(last['metrics'], dict) and isinstance(last['metrics'].get(hk), (int, float)):
            head = f'<span class="ch-h">{E(hk)} {last["metrics"][hk]}</span>'
    miss = f'<span class="ch-m">无{"、".join(sorted(missing, key=[n for n, _ in PARTS].index))}字段</span>' if (missing and shown) else ''
    return f'<div class="ch"><div class="ch-t"><b>{E(pfn)}</b>{head}{miss}</div>{svg}</div>'

def legend():
    sw = ''.join(f'<span><i style="background:{c}"></i>{n}</span>' for n, c in PARTS)
    return f'<span class="clg">{sw}<span><i class="ln"></i>互动合计</span></span>'

def render_topics(d, F, slot_map):
    stages = d['topics'] and d['stages']; topics = d['topics']
    order = sorted([t for t in topics if 3 <= t['stage'] <= 5], key=lambda t: -t['stage']) + [t for t in topics if t['stage'] == 6] + [t for t in topics if t['stage'] == 7] + [t for t in topics if t['stage'] <= 2]
    rows = ''
    for t in order:
        s = t['stage']; sm = slot_map(t)
        seg = ''.join(f'<div class="seg{" done" if i < s else " now" if i == s else ""}"></div>' for i in range(1, 8))
        fl = ''.join({'best': '<span class="tag best">本周最佳</span>', 'worst': '<span class="tag worst">本周最差</span>', 'focus': '<span class="tag focus">今日重点</span>'}[f] for f in t['flags'])
        sym = ''
        for pfn in STATUS_PF:
            q = next((x for x in t['platforms'] if x['platform'] == pfn), None)
            ok = bool(q and q['status'] == 'published')
            inner = f'<span class="sy">{"✓" if ok else "✗"}</span>{E(pfn)}'
            tip = f'{pfn}：{"已发布" if ok else "未发布"}' + (f' {q.get("time")}' if q and q.get('time') else '')
            if ok and q.get('url'): inner = f'<a href="{E(q["url"])}" target="_blank" rel="noopener noreferrer">{inner}</a>'
            sym += f'<span class="ps {"ps-y" if ok else "ps-n"}" title="{E(tip)}">{inner}</span>'
        pubs = [p for p in CHART_PF if any(q['platform'] == p and q['status'] == 'published' for q in t['platforms'])]
        charts = ''.join(chart(p, sm.get(p, {})) for p in pubs)
        charts = f'<div class="charts">{charts}</div>' if charts else '<p class="last">还没有发布，暂无数据</p>'
        rl, rc = RED[t['redline']['level']]
        chips = f'<span class="tag {rc}"><span class="dot"></span>{rl}</span>' + (f'<span class="tag r-warn">卡点 {len(t["blockers"])}</span>' if t['blockers'] else '')
        # 展开区：原来卡片上的说明文字全部收在这里
        pn = ''.join(f'<li>{E(q["platform"])}：{E(q["note"])}</li>' for q in t['platforms'] if q.get('note'))
        snaps = ''.join(f'<li{F.attr(q["time"])}>{E(q["time"][5:])} · {E(q["platform"])} · {E(q["slot"])} · ' + (E(q['metrics']) if isinstance(q['metrics'], str) else ' '.join(f'{E(k)}{E(str(v))}' for k, v in q['metrics'].items())) + (f'（{E(q["note"])}）' if q.get('note') else '') + '</li>' for q in sorted(t['snapshots'], key=lambda q: q['time']))
        blk = ''.join(f'<li>{E(b)}</li>' for b in t['blockers'])
        more = f'''<details class="tx"><summary>展开</summary><dl>
<div class="f"><dt>现状</dt><dd>{E(t["stage_note"])}</dd></div><div class="f"><dt>对比中位</dt><dd>{E(t["compare"])}</dd></div>
<div class="f"><dt>红线</dt><dd>{E(t["redline"]["note"])}</dd></div>{f'<div class="f"><dt>卡点</dt><dd><ul>{blk}</ul></dd></div>' if blk else ''}
<div class="f"><dt>来源</dt><dd>{E(t["source"])}</dd></div><div class="f"><dt>对应机制</dt><dd>{E(t["mechanism"])}</dd></div><div class="f"><dt>负责</dt><dd>{E(t["owners"])}</dd></div>
{f'<div class="f"><dt>平台备注</dt><dd><ul>{pn}</ul></dd></div>' if pn else ''}{f'<div class="f"><dt>全部快照</dt><dd><ul class="sl">{snaps}</ul></dd></div>' if snaps else ''}</dl></details>'''
        rows += f'''<article class="row{" hot" if "focus" in t["flags"] else ""}" id="{E(t["id"])}"><div class="rh"><span class="date">{E(t["date"][5:])}</span><h3>{E(t["title"])}</h3><span class="cur">{NUM[s-1]} {E(d["stages"][s-1]["name"])}</span>{fl}</div>
<div class="track" aria-hidden="true">{seg}</div>
<div class="rs2"><div class="pss">{sym}</div><div class="chips">{chips}</div></div>
{charts}{more}</article>'''
    return rows

def render_collection(d, F):
    cards = ''; dialogs = ''
    for i, c in enumerate(d['collection']):
        its = c.get('items') or []
        cards += (f'<button type="button" class="cc" data-open="coll-{i}"{F.attr(c["time"])} aria-haspopup="dialog">'
                  f'<span class="t">{E(c["name"])}</span><b>{E(c["count"])}</b><span class="cc-d">{E(c["time"])}</span><span class="cc-go">{"看明细 " + str(len(its)) + " 条" if its else "明细待补充"} ›</span></button>')
        if its:
            li = ''
            for it in its:
                meta = ' · '.join(E(x) for x in (it.get('platform'), it.get('time')) if x)
                cnt = f'<b class="it-c">{it["count"]} 次</b>' if 'count' in it else ''
                link = f'<a href="{E(it["url"])}" target="_blank" rel="noopener noreferrer">原帖 ↗</a>' if it.get('url') else ''
                li += f'<li><div class="it-t">{E(it["title"])}{cnt}</div><div class="it-m">{meta}{(" · " + E(it["note"])) if it.get("note") else ""} {link}</div></li>'
            body = f'<ol class="its">{li}</ol>'
        else:
            body = '<p class="empty">明细待大管家补充</p>'
        src = f'<p class="dg-s">明细来源：{E(c["items_source"])}</p>' if c.get('items_source') else ''
        dialogs += f'''<dialog class="dg" id="coll-{i}" aria-labelledby="coll-{i}-h"><div class="dg-h"><h3 id="coll-{i}-h">{E(c["name"])} <small>{E(c["count"])} · {E(c["time"])}</small></h3><button type="button" class="dg-x" data-close aria-label="关闭">✕</button></div>
<div class="dg-b"><p class="dg-s">{E(c["detail"])}</p>{body}{src}</div></dialog>'''
    return f'<section class="collect">{cards}</section>{dialogs}'

DIALOG_SCRIPT = r'''<script>(function(){
document.querySelectorAll("[data-open]").forEach(function(b){b.addEventListener("click",function(){var d=document.getElementById(b.getAttribute("data-open"));if(!d)return;if(d.showModal)d.showModal();else d.setAttribute("open","")})});
document.querySelectorAll("dialog.dg").forEach(function(d){d.addEventListener("click",function(e){if(e.target===d)d.close()});var x=d.querySelector("[data-close]");if(x)x.addEventListener("click",function(){d.close()})});
})();</script>'''
