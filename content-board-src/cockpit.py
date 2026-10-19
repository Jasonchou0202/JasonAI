#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""内容闭环看板 · CEO 驾驶舱（95 分方案第一阶段）
北极星卡片、获客漏斗、一句话结论、4 个结果 KPI、七段红黄绿灯、拍板区和风险条、获客来源榜、五平台对比表。
所有数字只来自 data/dashboard.json（以及可选的 data/wechat_leads.csv）；没有数据一律显示「待录入」/「待采集」，不估算。
本文件不读取任何销售数据：成交只用 acquisition.deals_daily 里的每日成交客户数（销售看板Bot 或章鱼哥提供），不放金额。"""
import html
from datetime import datetime, timedelta
from validate import parse_time, STALE_HOURS, LEAD_SOURCES

E = html.escape
NUM = '①②③④⑤⑥⑦'
PRIMARY = {'抖音': '互动和', '视频号': '播放', '公众号': '阅读', '小红书': '互动和', '朋友圈': '互动和'}
PF_ORDER = ['抖音', '视频号', '公众号', '小红书', '朋友圈']
PENDING = '<span class="pending">待录入</span>'

def fmt_num(v):
    if v is None: return PENDING
    return f'{v:,}' if isinstance(v, int) else f'{v:g}'

class Fresh:
    """给带采集时间的元素加 data-t（页面打开时由脚本再判断一次是否超 24 小时）"""
    def __init__(self, d, now):
        self.now = now; self.year = int(d['updated_at'][:4])
    def dt(self, t): return parse_time(t, self.year) if t else None
    def stale(self, t):
        v = self.dt(t); return bool(v and self.now - v > timedelta(hours=STALE_HOURS))
    def attr(self, t):
        v = self.dt(t)
        if not v: return ''
        return f' data-t="{v:%Y-%m-%dT%H:%M:00}+08:00"' + (' data-stale="1"' if self.stale(t) else '')
    def src(self, source, t, extra=''):
        tt = self.dt(t)
        ts = f' · 采集 {tt:%m-%d %H:%M}' if tt and len(t) > 10 else (f' · {E(t)}' if t else ' · 采集时间：还没有')
        old = '<em class="old">已超 24 小时</em>' if self.stale(t) else ''
        return f'<div class="src">来源：{E(source)}{ts}{(" · " + extra) if extra else ""}{old}</div>'

def _d(s): return datetime.strptime(s, '%Y-%m-%d').date()

def ranges(d, now):
    ws = _d(d['week']['start']); we = _d(d['week']['end'])
    pws = ws - timedelta(days=7); pwe = ws - timedelta(days=1)
    ms = now.date().replace(day=1)
    return (ws, we), (pws, pwe), (ms, now.date())

def in_range(recs, r):
    return [x for x in recs if r[0] <= _d(x['date']) <= r[1]]

def adds_sum(a, r):
    xs = in_range(a.get('daily') or [], r)
    return (sum(x['count'] for x in xs) if xs else None), xs

def deals_sum(a, r):
    xs = in_range(a.get('deals_daily') or [], r)
    if not xs: return None, xs
    return sum(x['new_customers'] for x in xs), xs

def delta(cur, prev, pp=False):
    if cur is None: return '<span class="dl na">本周待录入</span>'
    if prev is None: return '<span class="dl na">上周待录入</span>'
    df = cur - prev
    if pp:  # 百分点
        f = lambda x: f'{x:.1f}%'
        pct = ''; dv = f'{abs(df):.1f} 个百分点'
    else:
        f = fmt_num; pct = f'（{df / prev * 100:+.0f}%）' if prev else ''; dv = fmt_num(abs(df))
    if df > 0: return f'<span class="dl up">▲ {dv}{pct}</span><span class="dl-p">上周 {f(prev)}</span>'
    if df < 0: return f'<span class="dl down">▼ {dv}{pct}</span><span class="dl-p">上周 {f(prev)}</span>'
    return f'<span class="dl flat">持平</span><span class="dl-p">上周 {f(prev)}</span>'

def latest(xs, key):
    ts = [x.get(key) for x in xs if x.get(key)]
    return max(ts) if ts else None

def rate(a, b):
    if a is None or b is None or not a: return '—'
    return f'{b / a * 100:.1f}%'

def stage_lights(d, F):
    out = []
    coll_t = [F.dt(c['time']) for c in d['collection']]
    coll_t = [t for t in coll_t if t]
    for st in d['stages']:
        i = st['id']; ts = [t for t in d['topics'] if t['stage'] == i]
        if i == 1:
            fresh = coll_t and F.now - max(coll_t) <= timedelta(hours=24)
            lv, why = ('g', '今日已采集') if fresh else ('y', '超过 24 小时没有新采集')
        elif not ts:
            lv, why = 'n', '暂无选题'
        elif any(t['redline']['level'] == 'hit' for t in ts):
            lv, why = 'r', '有红线命中待改'
        elif any(t['blockers'] for t in ts):
            n = sum(len(t['blockers']) for t in ts); lv, why = 'y', f'{n} 个卡点'
        elif any(t['redline']['level'] in ('check', 'todo') for t in ts):
            lv, why = 'y', '红线待核'
        else:
            lv, why = 'g', '顺畅'
        cnt = f'{len(d["collection"])} 项' if i == 1 else f'{len(ts)} 个选题'
        out.append(f'<li class="lt lt-{lv}"><span class="lamp" aria-hidden="true"></span><b>{NUM[i-1]} {E(st["name"])}</b><span>{cnt} · {E(why)}</span></li>')
    return '<ol class="lights" aria-label="七段流水线红黄绿灯">' + ''.join(out) + '</ol>'

def render_cockpit(d, F):
    a = d.get('acquisition') or {}
    wk, pwk, mon = ranges(d, F.now)
    cur, cur_x = adds_sum(a, wk); prev, _ = adds_sum(a, pwk); mtot, mon_x = adds_sum(a, mon)
    tgt = (a.get('monthly_target') or {}).get('wechat_adds')
    last_rep = latest(a.get('daily') or [], 'reported_at')
    pct = min(100, mtot / tgt * 100) if (mtot is not None and tgt) else 0
    prog = f'{pct:.0f}%' if tgt and mtot is not None else '—'
    days = f'本周已报 {len(cur_x)}/7 天'
    ns = f'''<div class="ns"{F.attr(last_rep)}><div class="ns-t"><span class="star">北极星</span>{E(a.get("north_star", "本周私域新增微信好友"))}</div>
<div class="ns-v">{fmt_num(cur)}<small>人</small></div><div class="ns-cmp">{delta(cur, prev)}</div>
<div class="ns-m"><span>本月累计 <b>{fmt_num(mtot)}</b> 人</span><span>月目标 <b>{fmt_num(tgt) if tgt is not None else '<span class="pending">待定</span>'}</b></span><span>进度 <b>{prog}</b></span></div>
<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="{pct:.0f}"><i style="width:{pct:.0f}%"></i></div>
{F.src(a.get("adds_source", "章鱼哥每晚报数"), last_rep, days)}</div>'''
    # 漏斗
    fi = a.get('funnel_inputs') or {}
    ex = fi.get('exposure') or {}; vi = fi.get('visits') or {}
    dc, dx = deals_sum(a, wk)
    deal_t = latest(dx, 'provided_at')
    steps = [('内容曝光', ex.get('value'), ex.get('source', ''), ex.get('time')),
             ('小号主页访问 / 问询', vi.get('value'), vi.get('source', ''), vi.get('time')),
             ('加微', cur, a.get('adds_source', '章鱼哥每晚报数'), last_rep),
             ('成交', dc, a.get('deal_source', ''), deal_t)]
    fh = ''
    for k, (lab, v, src, t) in enumerate(steps):
        if k: fh += f'<li class="fr"><span>转化率</span><b>{rate(steps[k-1][1], v)}</b></li>'
        fh += f'<li class="fs"{F.attr(t)}><div class="fs-t">{E(lab)}</div><div class="fs-v">{fmt_num(v)}</div>{F.src(src, t)}</li>'
    funnel = f'<div class="funnel"><div class="fn-h"><h3>获客漏斗 · 本周</h3><span>内容曝光 → 小号主页访问/问询 → 加微 → 成交</span></div><ol class="fn">{fh}</ol></div>'
    ws = d.get('week_summary') or {}
    verdict = f'<div class="verdict"{F.attr(ws.get("time"))}><b>本周结论</b><p>{E(ws.get("text", "待录入"))}</p>{F.src(ws.get("by", "第二大脑"), ws.get("time"))}</div>'
    # 4 个结果 KPI
    kmap = {k['key']: k for k in d['kpis']}
    pdc, _ = deals_sum(a, pwk)
    padd, _ = adds_sum(a, pwk)
    def kcard(title, v, unit, dl, src, t, note=''):
        return f'<div class="rk"{F.attr(t)}><div class="k-t">{E(title)}</div><div class="k-v">{v}<small>{E(unit)}</small></div><div class="rk-d">{dl}</div>{("<div class=k-d>" + E(note) + "</div>") if note else ""}{F.src(src, t)}</div>'
    cards = ''
    for key in ('published', 'above_median'):
        k = kmap.get(key)
        if not k: continue
        v = None if k['status'] == 'pending' else k['value']
        vv = '<span class="pending">待采集</span>' if v is None else E(str(v))
        dl = delta(v, k.get('prev_value')) if isinstance(v, (int, float)) else '<span class="dl na">上周待录入</span>'
        cards += kcard(k['title'], vv, k.get('unit', ''), dl, k.get('source') or d['updated_by'], k.get('time') or d['updated_at'])
    dsrc = a.get('deal_source', '')
    cards += kcard('本周成交客户', fmt_num(dc), '位', delta(dc, pdc), dsrc, deal_t)
    cv = dc / cur * 100 if (dc is not None and cur) else None
    pcv = pdc / padd * 100 if (pdc is not None and padd) else None
    cvh = PENDING if cv is None else f'{cv:.1f}<small>%</small>'
    cards += kcard('加微→成交转化率', cvh, '', delta(cv, pcv, pp=True), '本周成交客户 ÷ 本周加微', deal_t or last_rep, '两项都有数据才计算')
    # 拍板区 + 风险条
    dec = d.get('decisions') or []
    dh = ''.join(f'<li><span class="dn">{n}</span><div><b>{E(x["title"])}</b><p>{E(x["why"])}{(" · " + E(x["since"][5:]) + " 起") if x.get("since") else ""}{(f" · <a href=\'#{E(x["topic_id"])}\'>看选题</a>") if x.get("topic_id") else ""}</p></div></li>' for n, x in enumerate(dec, 1))
    dh = dh or '<li class="none">今天没有要拍板的事</li>'
    rk = d.get('risks') or []
    rh = ''.join(f'<li class="rs rs-{x["level"]}"><span class="dot"></span>{E(x["text"])}{(f" <a href=\'#{E(x["topic_id"])}\'>查看</a>") if x.get("topic_id") else ""}</li>' for x in rk)
    decide = f'''<div class="decide" id="decide"><div class="dc"><div class="dc-h"><h3>等章鱼哥拍板</h3><span>{len(dec)} / 3</span></div><ol class="dl-list">{dh}</ol></div>
<div class="risk"><h3>风险条</h3><ul>{rh or '<li class="rs">暂无风险</li>'}</ul></div></div>'''
    return f'''<section class="cockpit" id="cockpit" aria-label="CEO 驾驶舱">
<div class="ns-row">{ns}{funnel}</div>
{verdict}
<div class="rks" aria-label="结果 KPI">{cards}</div>
{stage_lights(d, F)}
{decide}
</section>
<button type="button" class="more-toggle" aria-expanded="false" aria-controls="more">展开全部数据（获客来源、五平台对比、选题流水线）</button>'''

def render_acq_sources(d, F):
    a = d.get('acquisition') or {}
    wk, pwk, _ = ranges(d, F.now)
    _, wx = adds_sum(a, wk); _, px = adds_sum(a, pwk)
    def by_src(xs):
        if not xs: return None
        o = {k: 0 for k in LEAD_SOURCES}
        for r in xs:
            for k, v in (r.get('sources') or {}).items(): o[k] = o.get(k, 0) + v
        return o
    cw = by_src(wx); cp = by_src(px)
    total = sum(cw.values()) if cw else None
    _, dx = deals_sum(a, wk)
    dsrc = None
    if dx and any('sources' in r for r in dx):
        dsrc = {}
        for r in dx:
            for k, v in (r.get('sources') or {}).items(): dsrc[k] = dsrc.get(k, 0) + v
    srcs = {x['key']: x for x in a.get('sources') or []}
    order = sorted(LEAD_SOURCES, key=lambda k: (-(cw or {}).get(k, 0), LEAD_SOURCES.index(k))) if cw else LEAD_SOURCES
    rows = ''
    last_rep = latest(a.get('daily') or [], 'reported_at')
    for k in order:
        x = srcs.get(k, {'label': k, 'path': '', 'status': 'active'})
        ns = x['status'] == 'not_started'
        tagh = '<span class="tag s-wait">暂未做获客</span>' if ns else ''
        if cw is None: v = PENDING; share = '—'
        else: v = f'<b>{cw.get(k, 0)}</b>'; share = f'{cw.get(k, 0) / total * 100:.0f}%' if total else '—'
        pv = '—' if cp is None else str(cp.get(k, 0))
        dv = '—' if dsrc is None else str(dsrc.get(k, 0))
        rows += f'<tr class="{"ns-row-off" if ns else ""}"><th scope="row">{E(x["label"])} {tagh}<span class="path">{E(x["path"])}</span></th><td class="n">{v}</td><td class="n">{share}</td><td class="n">{pv}</td><td class="n">{dv}</td></tr>'
    tot = PENDING if total is None else f'<b>{total}</b>'
    rows += f'<tr class="sum"><th scope="row">合计</th><td class="n">{tot}</td><td class="n">{"100%" if total else "—"}</td><td class="n">{"—" if cp is None else sum(cp.values())}</td><td class="n">{"—" if dsrc is None else sum(dsrc.values())}</td></tr>'
    # 按内容
    bc = {}
    for r in wx:
        for x in r.get('by_content') or []:
            key = x.get('topic_id') or x['label']
            bc.setdefault(key, {'label': x['label'], 'count': 0, 'topic_id': x.get('topic_id')})['count'] += x['count']
    if bc:
        items = ''.join(f'<li><span>{E(v["label"])}</span><b>{v["count"]} 人</b>{(f" <a href=\'#{E(v["topic_id"])}\'>选题</a>") if v.get("topic_id") else ""}</li>' for v in sorted(bc.values(), key=lambda v: -v['count']))
        bch = f'<ol class="bc">{items}</ol>'
    else:
        bch = '<p class="last">还没有能对应到具体内容的记录（报数时顺口说一句「来自第几集」，这里就会按内容排）</p>'
    return f'''<section class="acq" id="acq"{F.attr(last_rep)}><div class="acq-t"><table class="tbl"><thead><tr><th scope="col">来源 · 承接路径</th><th scope="col">本周加微</th><th scope="col">占比</th><th scope="col">上周</th><th scope="col">本周成交客户</th></tr></thead><tbody>{rows}</tbody></table>
{F.src(a.get("adds_source", ""), last_rep, "成交客户来源为可选项")}</div>
<div class="acq-c"><h4>按内容 · 本周加微</h4>{bch}</div></section>'''

def _metric(pfn, m):
    if isinstance(m, str): return f'<span class="pending">{E(m)}</span>'
    k = PRIMARY.get(pfn)
    if k in m: return f'{E(k)} <b>{E(str(m[k]))}</b>'
    keys = [x for x in m][:2]
    return ' · '.join(f'{E(x)} <b>{E(str(m[x]))}</b>' for x in keys)

def render_compare(d, F):
    tps = d['topics']
    t = next((x for x in tps if 'focus' in x['flags']), None)
    if not t:
        pub = [x for x in tps if any(q['status'] == 'published' for q in x['platforms'])]
        t = max(pub, key=lambda x: x['date']) if pub else None
    if not t: return '<p class="last">本周还没有发布的选题</p>'
    bl = d.get('baselines', {})
    rows = ''
    for pfn in PF_ORDER:
        q = next((x for x in t['platforms'] if x['platform'] == pfn), None)
        stat = q['status'] if q else 'none'
        lab = {'published': '已发布', 'made': '已制作', 'pending': '待采集', 'paused': '停更中', 'none': '未做', 'tbd': '待定'}[stat]
        info = ' '.join(x for x in ((q or {}).get('work', ''), (q or {}).get('time', '')) if x)
        cells = ''
        for slot in ('2h', '24h', '72h'):
            hit = [s for s in t['snapshots'] if s['platform'] == pfn and s['slot'] == slot]
            if stat != 'published': cells += '<td class="c na">—</td>'
            elif hit:
                h = hit[-1]
                cells += f'<td class="c"{F.attr(h["time"])}>{_metric(pfn, h["metrics"])}<span class="ct">{E(h["time"][5:])}</span></td>'
            else: cells += '<td class="c"><span class="pending">待采集</span></td>'
        b = bl.get(pfn)
        bh = f'中位 {b["median"]:g} · 2 倍线 {b["double"]:g}<span class="ct">{E(b["formula"])}</span>' if b else '<span class="ct">暂无基线</span>'
        rows += f'<tr><th scope="row">{E(pfn)}<span class="path">{lab}{(" · " + E(info)) if info else ""}</span></th>{cells}<td class="c">{bh}</td></tr>'
    return f'''<section class="cmpt"><p class="cmpt-h"><b>{E(t["date"][5:])}</b> {E(t["title"])} <a href="#{E(t["id"])}">看详情</a></p>
<div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">平台</th><th scope="col">发布后 2 小时</th><th scope="col">24 小时</th><th scope="col">72 小时</th><th scope="col">中位数基线</th></tr></thead><tbody>{rows}</tbody></table></div>
<div class="src">来源：大管家快照（各平台后台/作品页，只读）· 抖音、小红书看互动和，视频号看播放，公众号看阅读</div></section>'''
