#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""内容闭环看板 · 构建脚本
用法：python3 build.py   →  dist/index.html（单文件，无外部依赖）
先运行校验（validate.py），不通过就停止，不会生成页面。"""
import json, os, sys, re, html
from datetime import datetime, timedelta
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from validate import red_hits, privacy_hits, load_all, parse_time, now_bj, LEAD_SOURCES, STALE_HOURS
from cockpit import render_cockpit, render_acq_sources, render_compare, Fresh, ACQ_SCRIPT
from pipeline import slot_map_for, render_topics, render_collection, legend as chart_legend, DIALOG_SCRIPT
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
    ('#acq', '获客来源'),
    ('#compare', '四平台对比'),
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
var now=Date.now();
document.querySelectorAll("[data-t]").forEach(function(el){
  var t=Date.parse(el.getAttribute("data-t"));
  if(t && now-t>STALE_MS){el.classList.add("stale");}
});
var mt=document.querySelector(".more-toggle");
if(mt) mt.addEventListener("click",function(){
  var open=document.body.classList.toggle("show-more");
  mt.setAttribute("aria-expanded",open?"true":"false");
  mt.textContent=open?"收起":"展开全部数据";
});
window.addEventListener("hashchange",function(){ if(location.hash && location.hash!=="#cockpit"){document.body.classList.add("show-more"); if(mt){mt.setAttribute("aria-expanded","true"); mt.textContent="收起";}} });
window.addEventListener("hashchange",mark);
mark();
})();</script>'''

def render(d, now=None):
    now = now or now_bj()
    F = Fresh(d, now)
    stages = d['stages']; topics = d['topics']
    # KPI 条
    kp = ''
    for k in d['kpis']:
        v = '<span class="pending">待采集</span>' if k['status'] == 'pending' else E(str(k['value']))
        kp += f'<div class="kpi"{F.attr(k.get("time") or d["updated_at"])}><div class="k-t">{E(k["title"])}</div><div class="k-v">{v}<small>{E(k.get("unit",""))}</small></div><div class="k-d">{E(k["note"])}</div>{F.src(k.get("source") or d["updated_by"], k.get("time") or d["updated_at"])}</div>'
    acc = ''.join(f'<div class="acc"{F.attr(a["time"])}><b>{E(a["platform"])}</b><span>{" · ".join(f"{E(mk)} {val(mv)}" for mk, mv in a["metrics"].items())}</span><em>{E(short_time(a["time"]))}{("　" + E(a["note"])) if a.get("note") else ""}</em></div>' for a in d['accounts'])
    # 流程图
    pipe = ''
    for st in stages:
        i = st['id']; c = len([t for t in topics if t['stage'] == i])
        lab = f'{len(d["collection"])} 项采集' if i == 1 else (f'{c} 个选题' if c else '暂无')
        has = c or i == 1
        pipe += f'<li class="st{" has" if has else ""}"><div class="nd">{i}</div><h3>{E(st["name"])}</h3><div class="o">{E(st["owner"])} · {E(st["rhythm"])}</div><span class="cnt{"" if has else " z"}">{lab}</span></li>'
    # 机制
    mech = d['mechanisms']; cnt = {}
    for it in mech['items']: cnt[it['status']] = cnt.get(it['status'], 0) + 1
    mtags = ''.join(f'<span class="tag m-{ {"初步验证":"a","已验证":"a","待验证":"b","暂停":"c","未标注":"d"}[k] }">{E(k)} {v}</span>' for k, v in cnt.items())
    mlist = ''.join(f'<li><span class="no">{it["no"]}</span>{E(it["title"])}<span class="tag m-{ {"初步验证":"a","已验证":"a","待验证":"b","暂停":"c","未标注":"d"}[it["status"]] }">{E(it["status"])}</span></li>' for it in mech['items'])
    bl = d['baselines']
    blt = '　'.join(f'{E(k)}：中位 {v["median"]:g} · 2 倍线 {v["double"]:g}（{E(v["formula"])}，{E(v["sample"])}）' for k, v in bl.items())
    slot_map = slot_map_for(F.year)
    rows = render_topics(d, F, slot_map)
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
{render_cockpit(d, F)}
<div class="more" id="more"><div class="sec"><h2>获客来源榜</h2><span class="legend" title="只存人数和渠道，不存名字和联系方式；手填数字先存本机，标「未同步」">手填 · 存本机 · 复制口令同步</span></div>
{render_acq_sources(d, F)}
<div class="sec" id="compare"><h2>四平台对比 · 本周主推选题</h2></div>
{render_compare(d, F, slot_map)}
<div class="sec"><h2>过程指标</h2><span class="legend">采集、选题、发布、机制</span></div>
<section class="kpis" aria-label="过程指标">{kp}</section>
<section class="accs" aria-label="账号概况">{acc}</section>
<section class="pipe-wrap" id="stages" aria-label="7 个阶段"><ol class="pipe">{pipe}</ol></section>
<div class="sec" id="collect"><h2>① 采集入口</h2><span class="legend">点卡片看明细</span></div>{render_collection(d, F)}
<div class="sec" id="topics"><h2>选题流水线</h2><div class="legend">{chart_legend()}<span class="legend-s" title="平台没有的字段（例如视频号没有收藏）按缺失处理，不算 0；72 小时等其他时间点的快照在「展开」里">✓ 已发布 ✗ 未发布</span></div></div>
{rows}
<div class="sec" id="mechanisms"><h2>爆款文案机制 · 验证进度</h2><div class="legend">{mtags}<span>待验证假设 {mech["hypotheses_count"]} 条 · {E(mech["updated"])}</span></div></div>
<ol class="mech">{mlist}</ol>
</div>
</main>
<footer class="wrap foot"><div class="footer-workspace">{groups}</div><p>中位数基线：{blt}</p><p>灰色「待采集」「拿不到」「待录入」表示目前没有真实数据，不做估算；整块变灰 = 采集时间已超 24 小时。时间均为北京时间（页面生成于 {now:%Y-%m-%d %H:%M}）。更新人：{E(d["updated_by"])}</p></footer>
</main></div>
<div class="mobile-dock"><div class="mobile-sheet" id="mobile-sheet" hidden data-open=""><div class="sheet-sales nav-sub">{nav_links(SALES_NAV)}</div><div class="sheet-content nav-sub">{nav_links(CONTENT_NAV)}</div></div>
<nav class="mobile-nav" aria-label="手机导航"><button type="button" data-sheet="sales">销售板块</button><a class="mobile-add" href="/JasonAI/#/entry">记一笔</a><button type="button" data-sheet="content">内容生产</button></nav></div>
</div>
<script type="application/json" id="dashboard-data">{embedded}</script>
{SHELL_SCRIPT.replace("STALE_MS", str(STALE_HOURS * 3600 * 1000))}
{ACQ_SCRIPT}
{DIALOG_SCRIPT}
</body></html>'''

def main():
    src = os.path.join(ROOT, 'data', 'dashboard.json')
    d, errs, warns, cs = load_all(src)
    if errs:
        print('✗ 数据校验没通过，已停止构建：'); [print('  - ' + e) for e in errs]; sys.exit(1)
    print(f'· {cs}；新鲜度提醒 {len(warns)} 条（页面显示灰色）')
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
