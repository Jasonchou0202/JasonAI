#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""内容闭环看板 · 构建脚本
用法：python3 build.py   →  dist/index.html（单文件，无外部依赖）
先运行校验（validate.py），不通过就停止，不会生成页面。"""
import json, os, sys, re, html
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from validate import validate, red_hits, privacy_hits
E = html.escape
NUM = '①②③④⑤⑥⑦'
ST = {'published': ('已发布', 's-ok'), 'made': ('已制作', 's-made'), 'pending': ('待采集', 's-wait'), 'paused': ('停更中', 's-pause'), 'none': ('未做', 's-wait'), 'tbd': ('待定', 's-wait')}
RED = {'pass': ('红线通过', 'r-ok'), 'check': ('红线待核', 'r-warn'), 'hit': ('红线命中', 'r-bad'), 'todo': ('复查待做', 'r-wait')}
SLOT_NAME = [('2h', '2 小时'), ('15:00', '15:00'), ('21:00', '21:00'), ('24h', '24 小时')]
MORDER = ['播放', '阅读', '赞', '评', '藏', '转', '在看', '关注', '互动和']
PRIMARY = {'抖音': '互动和', '视频号': '播放', '公众号': '阅读', '小红书': '互动和', '朋友圈': '互动和'}

def val(s):
    s = E(str(s))
    for w in ('待采集', '拿不到'): s = s.replace(w, f'<span class="pending">{w}</span>')
    return s
def mtext(m):
    if isinstance(m, str): return val(m)
    keys = [k for k in MORDER if k in m] + [k for k in m if k not in MORDER]
    return ' · '.join(f'{E(k)} <b>{val(m[k])}</b>' for k in keys)
def mshort(pfn, m):
    if isinstance(m, str): return val(m)
    k = PRIMARY.get(pfn)
    if k in m: return f'{E(k)} <b>{val(m[k])}</b>'
    keys = [k for k in MORDER if k in m][:2]
    return ' · '.join(f'{E(k)} <b>{val(m[k])}</b>' for k in keys)
def tag(lab, cls): return f'<span class="tag {cls}"><span class="dot"></span>{lab}</span>'
def short_time(t): return t[5:] if t and len(t) >= 16 else t

CSS = open(os.path.join(ROOT, 'templates', 'style.css'), encoding='utf-8').read()
SALES_NAV = [
    ('/JasonAI/#/dashboard', '生意看板'),
    ('/JasonAI/#/entry', '记一笔'),
    ('/JasonAI/#/details', '销售明细'),
    ('/JasonAI/#/calendar', '客户日程'),
    ('/JasonAI/#/settings', '账本设置'),
]
CONTENT_NAV = [
    ('/JasonAI/board-e160b241a233/', '内容闭环看板'),
    ('#stages', '七段流水线'),
    ('#topics', '选题流水线'),
    ('#mechanisms', '机制验证'),
]

def nav_links(items):
    return ''.join(f'<a href="{E(href)}">{E(label)}</a>' for href, label in items)

def nav_groups(content_open=True):
    sales_hidden = ' hidden'
    content_hidden = '' if content_open else ' hidden'
    sales_exp = 'false'
    content_exp = 'true' if content_open else 'false'
    return f'''<div class="nav-group"><button type="button" class="nav-summary" aria-expanded="{sales_exp}">销售板块</button><div class="nav-sub"{sales_hidden}>{nav_links(SALES_NAV)}</div></div>
<div class="nav-group"><button type="button" class="nav-summary" aria-expanded="{content_exp}">内容生产板块</button><div class="nav-sub"{content_hidden}>{nav_links(CONTENT_NAV)}</div></div>'''

SHELL_SCRIPT = r'''<script>(function(){
function mark(){
  var hash=location.hash;
  document.querySelectorAll(".nav-sub a").forEach(function(a){
    var href=a.getAttribute("href")||"";
    var on=hash?href===hash||href.slice(-hash.length)===hash:href==="/JasonAI/board-e160b241a233/";
    a.classList.toggle("active",on);
  });
}
document.querySelectorAll(".nav-summary").forEach(function(btn){
  btn.addEventListener("click",function(){
    var sub=btn.parentNode.querySelector(".nav-sub");
    var open=btn.getAttribute("aria-expanded")==="true";
    btn.setAttribute("aria-expanded",open?"false":"true");
    if(sub) sub.hidden=open;
  });
});
document.querySelectorAll("[data-sheet]").forEach(function(btn){
  btn.addEventListener("click",function(){
    var sheet=document.getElementById("mobile-sheet");
    if(!sheet) return;
    var id=btn.getAttribute("data-sheet");
    var open=sheet.getAttribute("data-open")===id && !sheet.hidden;
    sheet.hidden=open;
    sheet.setAttribute("data-open",open?"":id);
    document.querySelectorAll("[data-sheet]").forEach(function(b){
      b.classList.toggle("active",!open && b===btn);
    });
  });
});
window.addEventListener("hashchange",mark);
mark();
})();</script>'''

def render(d):
    stages = d['stages']; topics = d['topics']
    # KPI 条
    kp = ''
    for k in d['kpis']:
        v = '<span class="pending">待采集</span>' if k['status'] == 'pending' else E(str(k['value']))
        kp += f'<div class="kpi"><div class="k-t">{E(k["title"])}</div><div class="k-v">{v}<small>{E(k.get("unit",""))}</small></div><div class="k-d">{E(k["note"])}</div></div>'
    acc = ''.join(f'<div class="acc"><b>{E(a["platform"])}</b><span>{" · ".join(f"{E(mk)} {val(mv)}" for mk, mv in a["metrics"].items())}</span><em>{E(short_time(a["time"]))}{("　" + E(a["note"])) if a.get("note") else ""}</em></div>' for a in d['accounts'])
    # 流程图
    pipe = ''
    for st in stages:
        i = st['id']; c = len([t for t in topics if t['stage'] == i])
        lab = f'{len(d["collection"])} 项采集' if i == 1 else (f'{c} 个选题' if c else '暂无')
        has = c or i == 1
        pipe += f'<li class="st{" has" if has else ""}"><div class="nd">{i}</div><h3>{E(st["name"])}</h3><div class="o">{E(st["owner"])} · {E(st["rhythm"])}</div><span class="cnt{"" if has else " z"}">{lab}</span></li>'
    coll = ''.join(f'<div class="cc"><div class="t">{E(c["name"])}</div><b>{E(c["count"])}</b><p>{E(c["detail"])}</p><p>{E(c["time"])}</p></div>' for c in d['collection'])
    # 机制
    mech = d['mechanisms']; cnt = {}
    for it in mech['items']: cnt[it['status']] = cnt.get(it['status'], 0) + 1
    mtags = ''.join(f'<span class="tag m-{ {"初步验证":"a","已验证":"a","待验证":"b","暂停":"c","未标注":"d"}[k] }">{E(k)} {v}</span>' for k, v in cnt.items())
    mlist = ''.join(f'<li><span class="no">{it["no"]}</span>{E(it["title"])}<span class="tag m-{ {"初步验证":"a","已验证":"a","待验证":"b","暂停":"c","未标注":"d"}[it["status"]] }">{E(it["status"])}</span></li>' for it in mech['items'])
    bl = d['baselines']
    blt = '　'.join(f'{E(k)}：中位 {v["median"]:g} · 2 倍线 {v["double"]:g}（{E(v["formula"])}，{E(v["sample"])}）' for k, v in bl.items())
    # 选题行
    order = sorted([t for t in topics if 3 <= t['stage'] <= 5], key=lambda t: -t['stage']) + [t for t in topics if t['stage'] == 6] + [t for t in topics if t['stage'] == 7] + [t for t in topics if t['stage'] <= 2]
    rows = ''
    for t in order:
        s = t['stage']
        seg = ''.join(f'<div class="seg{" done" if i < s else " now" if i == s else ""}"></div>' for i in range(1, 8))
        tl = ''.join(f'<span class="{"now" if st["id"] == s else ""}">{NUM[st["id"]-1]} {E(st["name"])}</span>' for st in stages)
        fl = ''.join({'best': '<span class="tag best">本周最佳</span>', 'worst': '<span class="tag worst">本周最差</span>', 'focus': '<span class="tag focus">今日重点</span>'}[f] for f in t['flags'])
        pfs = ''
        for q in t['platforms']:
            lab, cls = ST[q['status']]
            extra = ' '.join(x for x in (q.get('work', ''), q.get('time', '')) if x)
            inner = f'{E(q["platform"])} · {lab}' + (f'<span class="x"> {E(extra)}</span>' if extra else '')
            if q.get('url'): inner = f'<a href="{E(q["url"])}" target="_blank" rel="noopener noreferrer">{inner}</a>'
            pfs += f'<span class="tag {cls}"><span class="dot"></span>{inner}</span>'
        pnotes = ''.join(f'<li>{E(q["platform"])}：{val(q["note"])}</li>' for q in t['platforms'] if q.get('note'))
        if not t['platforms']: pfs = '<span class="tag s-wait">尚未制作</span>'
        pn_html = '<ul class="pn">' + pnotes + '</ul>' if pnotes else ''
        # 数据：按平台展示 4 个固定快照位 + 最新一次
        snaps = t['snapshots']; data = ''
        plats = []
        for q in t['platforms']:
            if q['status'] == 'published' and q['platform'] not in plats: plats.append(q['platform'])
        for q in snaps:
            if q['platform'] not in plats: plats.append(q['platform'])
        nosnap = [p for p in plats if not any(q['platform'] == p for q in snaps)]
        for pfn in plats:
            ss = [q for q in snaps if q['platform'] == pfn]
            if not ss: continue
            work = next((q.get('work') for q in t['platforms'] if q['platform'] == pfn and q.get('work')), '')
            boxes = ''
            for sk, sn in SLOT_NAME:
                hit = [q for q in ss if q['slot'] == sk]
                v = mshort(pfn, hit[-1]['metrics']) + (f'<i>{E(hit[-1]["elapsed"])}</i>' if hit else '') if hit else '<span class="pending">待采集</span>'
                boxes += f'<div class="sb"><span>{sn}</span><div>{v}</div></div>'
            last = max(ss, key=lambda q: q['time']) if ss else None
            lt = f'<p class="last">最新 {E(short_time(last["time"]))}（{E(last["elapsed"])}）：{mtext(last["metrics"])}{("；" + val(last["note"])) if last.get("note") else ""}</p>' if last else '<p class="last">还没有快照：<span class="pending">待采集</span></p>'
            data += f'<div class="pd"><h5>{E(pfn)}{(" · " + E(work)) if work else ""}</h5><div class="sbs">{boxes}</div>{lt}</div>'
        if nosnap: data += f'<div class="pd"><h5>{"、".join(E(p) for p in nosnap)}</h5><p class="last">已发布，4 个快照位均为 <span class="pending">待采集</span></p></div>'
        if not plats: data = f'<p class="last">{val(t["compare"])}</p>'
        else: data += f'<p class="cmp"><b>对比中位：</b>{val(t["compare"])}</p>'
        rl, rc = RED[t['redline']['level']]
        blk = ''.join(f'<li>{E(b)}</li>' for b in t['blockers'])
        blk = f'<div class="block"><b>卡点</b><ul>{blk}</ul></div>' if t['blockers'] else '<div class="noblock">卡点：无</div>'
        rows += f'''<article class="row{" hot" if "focus" in t["flags"] else ""}" id="{E(t["id"])}"><div class="rh"><span class="date">{E(t["date"][5:])}</span><h3>{E(t["title"])}</h3><span class="cur">当前：{NUM[s-1]} {E(stages[s-1]["name"])}</span>{fl}</div>
<div class="track" aria-hidden="true">{seg}</div><div class="tl">{tl}</div><p class="note">{E(t["stage_note"])}</p>
<div class="grid3"><div><h4>各平台状态</h4><div class="pfs">{pfs}</div>{pn_html}<div class="red">{tag(rl, rc)}<span>{E(t["redline"]["note"])}</span></div>{blk}</div>
<div><h4>数据快照</h4>{data}</div>
<div><h4>来源与分工</h4><dl><div class="f"><dt>来源</dt><dd>{E(t["source"])}</dd></div><div class="f"><dt>对应机制</dt><dd>{E(t["mechanism"])}</dd></div><div class="f"><dt>负责</dt><dd>{E(t["owners"])}</dd></div></dl></div></div></article>'''
    legend = ''.join(tag(l, c) for k, (l, c) in ST.items() if k in ('published', 'made', 'pending', 'paused'))
    embedded = json.dumps(d, ensure_ascii=False).replace('</', '<\\/')
    groups = nav_groups(True)
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>内容闭环看板 · 章鱼哥AI工作室</title><style>{CSS}</style></head><body>
<div class="app-shell">
<aside class="sidebar" aria-label="侧边栏"><div class="brand"><img src="/JasonAI/octopus.svg" alt="" width="43" height="43"><div><strong>章鱼哥</strong><span>AI 工作室 · 生意手账</span></div></div>
<div class="workspace-label">我的工作台</div><nav aria-label="主要导航">{groups}</nav></aside>
<div class="main-shell">
<header class="topbar"><div class="breadcrumb">工作室<span>/</span>内容生产板块<span>/</span><strong>内容闭环看板</strong></div>
<p class="asof">数据更新于 <b>{E(d["updated_at"])}</b> · 本周 {E(d["week"]["label"])}</p></header>
<main class="main-content wrap" id="top">
<section class="kpis" aria-label="本周关键数字">{kp}</section>
<section class="accs" aria-label="账号概况">{acc}</section>
<section class="pipe-wrap" id="stages" aria-label="7 个阶段"><ol class="pipe">{pipe}</ol></section>
<div class="sec" id="collect"><h2>① 采集入口</h2><span class="legend">采集只读 · 含红线内容只记录不采用</span></div><section class="collect">{coll}</section>
<div class="sec" id="topics"><h2>选题流水线</h2><div class="legend">{legend}</div></div>
{rows}
<div class="sec" id="mechanisms"><h2>爆款文案机制 · 验证进度</h2><div class="legend">{mtags}<span>待验证假设 {mech["hypotheses_count"]} 条 · {E(mech["updated"])}</span></div></div>
<ol class="mech">{mlist}</ol>
</main>
<footer class="wrap foot"><div class="footer-workspace">{groups}</div><p>中位数基线：{blt}</p><p>灰色「待采集」「拿不到」表示目前没有真实数据，不做估算。时间均为北京时间。更新人：{E(d["updated_by"])}</p></footer>
</main></div>
<div class="mobile-dock"><div class="mobile-sheet" id="mobile-sheet" hidden data-open=""><div class="sheet-sales nav-sub">{nav_links(SALES_NAV)}</div><div class="sheet-content nav-sub">{nav_links(CONTENT_NAV)}</div></div>
<nav class="mobile-nav" aria-label="手机导航"><button type="button" data-sheet="sales">销售板块</button><a class="mobile-add" href="/JasonAI/#/entry">记一笔</a><button type="button" data-sheet="content">内容生产</button></nav></div>
</div>
<script type="application/json" id="dashboard-data">{embedded}</script>
{SHELL_SCRIPT}
</body></html>'''

def main():
    src = os.path.join(ROOT, 'data', 'dashboard.json')
    d = json.load(open(src, encoding='utf-8'))
    errs = validate(d)
    if errs:
        print('✗ 数据校验没通过，已停止构建：'); [print('  - ' + e) for e in errs]; sys.exit(1)
    out = render(d)
    text = html.unescape(re.sub(r'<style.*?</style>|<[^>]+>', ' ', out, flags=re.S))
    h = red_hits(text) + privacy_hits(text)
    if h: print(f'✗ 生成的页面里命中 {h}，已停止'); sys.exit(1)
    if re.search(r'<(script|link)[^>]+(src|href)="https?://', out): print('✗ 页面引用了外部资源，已停止'); sys.exit(1)
    os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
    dst = os.path.join(ROOT, 'dist', 'index.html')
    open(dst, 'w', encoding='utf-8').write(out)
    print(f'✓ 已生成 {dst}（{len(out.encode())/1024:.1f} KB，数据更新于 {d["updated_at"]}）')

if __name__ == '__main__':
    main()
