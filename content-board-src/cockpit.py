#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""内容闭环看板 · CEO 驾驶舱
北极星（含周一到周日手填）、漏斗、结论、结果 KPI、七段灯、拍板区、获客来源榜（可编辑）、四平台对比表。
数字只来自 data/dashboard.json（及可选 data/wechat_leads.csv）＋ 章鱼哥在本机浏览器里手填、尚未同步的数字（localStorage，标「未同步」）。
没有数据一律显示「待录入」/「待采集」，不估算。不读取任何销售数据；成交只用 acquisition.deals_daily 的每日成交客户数，不放金额。"""
import html, json
from datetime import datetime, timedelta
from validate import parse_time, STALE_HOURS, LEAD_SOURCES

E = html.escape
NUM = '①②③④⑤⑥⑦'
WD = '一二三四五六日'
PRIMARY = {'抖音': '互动和', '视频号': '播放', '公众号': '阅读', '小红书': '互动和'}
CMP_PF = ['抖音', '公众号', '视频号', '小红书']
PENDING = '<span class="pending">待录入</span>'
SHORT_PATH = {'抖音': '主号 @ 小号「章鱼哥AI助手」', '视频号': '微信内直接加', '公众号': '微信内直接加', '小红书': '暂未做获客'}

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
        """一行小字：采集时间；来源放进悬停提示"""
        tt = self.dt(t)
        ts = f'{tt:%m-%d %H:%M}' if tt and len(t) > 10 else (E(t) if t else '还没有数据')
        old = '<em class="old">超 24 小时</em>' if self.stale(t) else ''
        return f'<div class="src" title="来源：{E(source)}">{ts}{(" · " + extra) if extra else ""}{old}</div>'

def _d(s): return datetime.strptime(s, '%Y-%m-%d').date()

def ranges(d, now):
    ws = _d(d['week']['start']); we = _d(d['week']['end'])
    return (ws, we), (ws - timedelta(days=7), ws - timedelta(days=1)), (now.date().replace(day=1), now.date())

def in_range(recs, r): return [x for x in recs if r[0] <= _d(x['date']) <= r[1]]

def adds_sum(a, r):
    xs = in_range(a.get('daily') or [], r)
    return (sum(x['count'] for x in xs) if xs else None), xs

def deals_sum(a, r):
    xs = in_range(a.get('deals_daily') or [], r)
    return (sum(x['new_customers'] for x in xs) if xs else None), xs

def delta(cur, prev, pp=False):
    if cur is None: return '<span class="dl na">本周待录入</span>'
    if prev is None: return '<span class="dl na">上周待录入</span>'
    df = cur - prev
    if pp: f = lambda x: f'{x:.1f}%'; pct = ''; dv = f'{abs(df):.1f} 个百分点'
    else: f = fmt_num; pct = f'（{df / prev * 100:+.0f}%）' if prev else ''; dv = fmt_num(abs(df))
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
    coll_t = [t for t in (F.dt(c['time']) for c in d['collection']) if t]
    for st in d['stages']:
        i = st['id']; ts = [t for t in d['topics'] if t['stage'] == i]
        if i == 1:
            fresh = coll_t and F.now - max(coll_t) <= timedelta(hours=24)
            lv, why = ('g', '今日已采集') if fresh else ('y', '超 24 小时没采集')
        elif not ts: lv, why = 'n', '暂无'
        elif any(t['redline']['level'] == 'hit' for t in ts): lv, why = 'r', '红线命中待改'
        elif any(t['blockers'] for t in ts): lv, why = 'y', f'{sum(len(t["blockers"]) for t in ts)} 个卡点'
        elif any(t['redline']['level'] in ('check', 'todo') for t in ts): lv, why = 'y', '红线待核'
        else: lv, why = 'g', '顺畅'
        out.append(f'<li class="lt lt-{lv}" title="{E(st["owner"])} · {E(st["rhythm"])}"><span class="lamp" aria-hidden="true"></span><b>{NUM[i-1]} {E(st["name"])}</b><span>{E(why)}</span></li>')
    return '<ol class="lights" aria-label="七段流水线红黄绿灯">' + ''.join(out) + '</ol>'

def funnel_svg_layers():
    """4 层固定递减宽度的梯形（不按数值比例）：每层上沿 = 上一层下沿"""
    W = [100, 80, 62, 46, 32]
    out = []
    for i in range(4):
        top, bot = W[i], W[i + 1]
        inset = (top - bot) / 2 / top * 100
        out.append((top, f'polygon(0 0,100% 0,{100 - inset:.2f}% 100%,{inset:.2f}% 100%)'))
    return out

def render_cockpit(d, F):
    a = d.get('acquisition') or {}
    wk, pwk, mon = ranges(d, F.now)
    cur, cur_x = adds_sum(a, wk); prev, _ = adds_sum(a, pwk); mtot, _ = adds_sum(a, mon)
    tgt = (a.get('monthly_target') or {}).get('wechat_adds')
    last_rep = latest(a.get('daily') or [], 'reported_at')
    pct = min(100, mtot / tgt * 100) if (mtot is not None and tgt) else 0
    pub = {r['date']: r for r in a.get('daily') or []}
    days = ''
    for k in range(7):
        dd = wk[0] + timedelta(days=k); ds = dd.isoformat()
        fut = dd > F.now.date(); tod = dd == F.now.date()
        v = pub.get(ds, {}).get('count')
        days += (f'<label class="day{" today" if tod else ""}{" future" if fut else ""}"><span>{WD[k]}<em>{dd.month}/{dd.day}</em></span>'
                 f'<input type="number" min="0" step="1" inputmode="numeric" data-day="{ds}" value="{"" if v is None else v}" aria-label="{dd.month}月{dd.day}日新增微信好友"{" disabled" if fut else ""}>'
                 f'<i class="u" hidden>未同步</i></label>')
    tip = f'来源：{a.get("adds_source", "")}。在这里手填的数字先存在本机浏览器（标「未同步」），点「复制同步口令」发给第二大脑后写进正式数据。'
    ns = f'''<div class="ns" id="ns" title="{E(tip)}"><div class="ns-t"><span class="star">北极星</span>{E(a.get("north_star", "本周私域新增微信好友"))}<span class="unsync" id="ns-unsync" hidden>含未同步</span></div>
<div class="ns-v"><span id="ns-total">{fmt_num(cur)}</span><small>人</small></div><div class="ns-cmp" id="ns-cmp">{delta(cur, prev)}</div>
<div class="days" id="ns-days">{days}</div>
<div class="ns-m"><span>本月 <b id="ns-month">{fmt_num(mtot)}</b></span><span>月目标 <b>{fmt_num(tgt) if tgt is not None else '<span class="pending">待定</span>'}</b></span><span class="ns-sync"><button type="button" class="sync-btn" data-sync>复制同步口令</button></span></div>
<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="{pct:.0f}"><i id="ns-bar" style="width:{pct:.0f}%"></i></div></div>'''
    # 漏斗：固定递减宽度的梯形层
    fi = a.get('funnel_inputs') or {}
    ex = fi.get('exposure') or {}; vi = fi.get('visits') or {}
    dc, dx = deals_sum(a, wk)
    deal_t = latest(dx, 'provided_at')
    steps = [('① 内容曝光', ex.get('value'), ex.get('source', ''), ex.get('time')),
             ('② 小号主页访问', vi.get('value'), vi.get('source', ''), vi.get('time')),
             ('③ 加微', cur, a.get('adds_source', ''), last_rep),
             ('④ 成交', dc, a.get('deal_source', ''), deal_t)]
    fh = ''
    for k, ((lab, v, src, t), (w, clip)) in enumerate(zip(steps, funnel_svg_layers())):
        if k: fh += f'<div class="rt" data-rt="{k}">↓ <b>{rate(steps[k-1][1], v)}</b></div>'
        tt = F.dt(t)
        tip = f'来源：{src}' + (f' · 采集 {tt:%m-%d %H:%M}' if tt else '')
        fh += (f'<div class="lay l{k+1}" style="width:{w}%;clip-path:{clip}" title="{E(tip)}" data-v="{"" if v is None else v}"{F.attr(t)}>'
               f'<span class="ln">{lab}</span><b data-fn="{k}">{fmt_num(v)}</b></div>')
    funnel = f'<div class="funnel"><div class="fn-h"><h3>获客漏斗 · 本周</h3><span class="tip" title="层宽固定递减，不按数值比例；↓ 后面是相邻两层的转化率；悬停每层看来源">ⓘ</span></div><div class="fnl">{fh}</div></div>'
    ws = d.get('week_summary') or {}
    verdict = f'<div class="verdict"{F.attr(ws.get("time"))}><b>本周结论</b><p>{E(ws.get("text", "待录入"))}</p></div>'
    kmap = {k['key']: k for k in d['kpis']}
    pdc, _ = deals_sum(a, pwk); padd, _ = adds_sum(a, pwk)
    def kcard(title, v, unit, dl, src, t, live=''):
        return f'<div class="rk"{F.attr(t)}{live}><div class="k-t">{E(title)}</div><div class="k-v">{v}<small>{E(unit)}</small></div><div class="rk-d">{dl}</div>{F.src(src, t)}</div>'
    cards = ''
    for key in ('published', 'above_median'):
        k = kmap.get(key)
        if not k: continue
        v = None if k['status'] == 'pending' else k['value']
        vv = '<span class="pending">待采集</span>' if v is None else E(str(v))
        dl = delta(v, k.get('prev_value')) if isinstance(v, (int, float)) else '<span class="dl na">上周待录入</span>'
        cards += kcard(k['title'], vv, k.get('unit', ''), dl, k.get('source') or d['updated_by'], k.get('time') or d['updated_at'])
    cards += kcard('本周成交客户', fmt_num(dc), '位', delta(dc, pdc), a.get('deal_source', ''), deal_t)
    cv = dc / cur * 100 if (dc is not None and cur) else None
    pcv = pdc / padd * 100 if (pdc is not None and padd) else None
    cvh = PENDING if cv is None else f'{cv:.1f}<small>%</small>'
    cards += kcard('加微→成交转化率', f'<span data-live="conv">{cvh}</span>', '', f'<span data-live="conv-d">{delta(cv, pcv, pp=True)}</span>', '本周成交客户 ÷ 本周加微', deal_t or last_rep)
    dec = d.get('decisions') or []
    dh = ''.join(f'<li><span class="dn">{n}</span><div><b>{E(x["title"])}</b><p>{E(x["why"])}{(f" · <a href=\'#{E(x["topic_id"])}\'>看选题</a>") if x.get("topic_id") else ""}</p></div></li>' for n, x in enumerate(dec, 1))
    dh = dh or '<li class="none">今天没有要拍板的事</li>'
    rk = d.get('risks') or []
    rh = ''.join(f'<li class="rs rs-{x["level"]}"><span class="dot"></span><span>{E(x["text"])}</span>{(f" <a href=\'#{E(x["topic_id"])}\'>查看</a>") if x.get("topic_id") else ""}</li>' for x in rk)
    decide = f'''<div class="decide" id="decide"><div class="dc"><div class="dc-h"><h3>等章鱼哥拍板</h3><span>{len(dec)} / 3</span></div><ol class="dl-list">{dh}</ol></div>
<div class="risk"><h3>风险条</h3><ul>{rh or '<li class="rs">暂无风险</li>'}</ul></div></div>'''
    return f'''<section class="cockpit" id="cockpit" aria-label="CEO 驾驶舱">
<div class="ns-row">{ns}{funnel}</div>
{verdict}
<div class="rks" aria-label="结果 KPI">{cards}</div>
{stage_lights(d, F)}
{decide}
</section>
<button type="button" class="more-toggle" aria-expanded="false" aria-controls="more">展开全部数据</button>'''

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
    today = F.now.date().isoformat()
    tr = {r['date']: r for r in a.get('daily') or []}.get(today) or {}
    rows = ''
    for k in LEAD_SOURCES:
        tv = (tr.get('sources') or {}).get(k)
        rows += (f'<tr data-ch="{E(k)}"><th scope="row">{E(k)}<span class="path">{E(SHORT_PATH.get(k, ""))}</span></th>'
                 f'<td><div class="step"><button type="button" data-step="-1" aria-label="{E(k)} 减 1">−</button>'
                 f'<input type="number" min="0" step="1" inputmode="numeric" data-ch="{E(k)}" value="{"" if tv is None else tv}" aria-label="{E(k)} 当天加微">'
                 f'<button type="button" data-step="1" aria-label="{E(k)} 加 1">+</button></div><i class="u" hidden>未同步</i></td>'
                 f'<td class="n" data-wk="{E(k)}">{PENDING if cw is None else cw.get(k, 0)}</td><td class="n" data-pw="{E(k)}">{"—" if cp is None else cp.get(k, 0)}</td></tr>')
    bc = {}
    for r in wx:
        for x in r.get('by_content') or []:
            key = x.get('topic_id') or x['label']
            bc.setdefault(key, {'label': x['label'], 'count': 0})['count'] += x['count']
    bch = ''
    if bc:
        bch = '<div class="acq-c"><h4>按内容 · 本周</h4><ol class="bc">' + ''.join(f'<li><span>{E(v["label"])}</span><b>{v["count"]} 人</b></li>' for v in sorted(bc.values(), key=lambda v: -v['count'])) + '</ol></div>'
    return f'''<section class="acq" id="acq"><div class="acq-bar"><label>日期 <input type="date" id="acq-date" value="{today}" max="{today}"></label><span id="acq-day" class="acq-day"></span><button type="button" class="sync-btn" data-sync>复制同步口令</button></div>
<table class="tbl acq-t"><thead><tr><th scope="col">渠道</th><th scope="col">当天加微</th><th scope="col">本周</th><th scope="col">上周</th></tr></thead><tbody>{rows}</tbody></table>
<div class="sync-out" id="sync-out" hidden><textarea readonly rows="2" aria-label="同步口令"></textarea><span id="sync-msg"></span></div>{bch}</section>'''

def render_compare(d, F, slot_map):
    tps = d['topics']
    t = next((x for x in tps if 'focus' in x['flags']), None)
    if not t:
        pub = [x for x in tps if any(q['status'] == 'published' for q in x['platforms'])]
        t = max(pub, key=lambda x: x['date']) if pub else None
    if not t: return '<p class="last">本周还没有发布的选题</p>'
    bl = d.get('baselines', {}); sm = slot_map(t)
    rows = ''
    for pfn in CMP_PF:
        q = next((x for x in t['platforms'] if x['platform'] == pfn), None)
        pubd = q and q['status'] == 'published'
        cells = ''
        for slot in ('2h', '15:00', '21:00', '24h'):
            h = sm.get(pfn, {}).get(slot)
            if not pubd: cells += '<td class="c na">—</td>'
            elif h:
                m = h['metrics']; k = PRIMARY[pfn]
                v = f'<b>{E(str(m[k]))}</b>' if isinstance(m, dict) and k in m else '<span class="pending">拿不到</span>'
                cells += f'<td class="c"{F.attr(h["time"])} title="{E(k)} · 采集 {E(h["time"][5:])}">{v}</td>'
            else: cells += '<td class="c"><span class="pending">待采集</span></td>'
        b = bl.get(pfn)
        bh = f'{b["median"]:g}' if b else '—'
        rows += f'<tr><th scope="row">{E(pfn)}<span class="path">{E(PRIMARY[pfn])}</span></th>{cells}<td class="c n">{bh}</td></tr>'
    return f'''<section class="cmpt"><p class="cmpt-h"><b>{E(t["date"][5:])}</b> <a href="#{E(t["id"])}">{E(t["title"])}</a></p>
<div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">平台</th><th scope="col">2 小时</th><th scope="col">下午 3 点</th><th scope="col">晚上 9 点</th><th scope="col">24 小时</th><th scope="col">中位数</th></tr></thead><tbody>{rows}</tbody></table></div></section>'''

ACQ_SCRIPT = r'''<script>(function(){
var el=document.getElementById("dashboard-data"); if(!el) return;
var D=JSON.parse(el.textContent), A=D.acquisition||{}, CH=["抖音","视频号","公众号","小红书"], KEY="content-board-acq-v1";
function pad(n){return (n<10?"0":"")+n}
function ymd(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}
function pd(s){var p=s.split("-");return new Date(+p[0],+p[1]-1,+p[2],12)}
function add(s,n){var d=pd(s);d.setDate(d.getDate()+n);return ymd(d)}
function range(a,b){var o=[];for(var s=a;s<=b;s=add(s,1))o.push(s);return o}
var TODAY=ymd(new Date());
function stamp(){var d=new Date();return TODAY+" "+pad(d.getHours())+":"+pad(d.getMinutes())}
function load(){try{var o=JSON.parse(localStorage.getItem(KEY)||"{}");return o&&typeof o==="object"?o:{}}catch(e){return {}}}
function save(o){try{localStorage.setItem(KEY,JSON.stringify(o))}catch(e){}}
var PUB={};(A.daily||[]).forEach(function(r){PUB[r.date]=r});
function num(v){return typeof v==="number"&&isFinite(v)?v:null}
function ssum(s){var t=0,n=0;CH.forEach(function(c){var v=s?num(s[c]):null;if(v!==null){t+=v;n++}});return n?t:null}
function ltot(l){return num(l.total)!==null?l.total:ssum(l.src)}
function same(l,p){if(ltot(l)!==p.count)return false;var ps=p.sources||{};for(var i=0;i<CH.length;i++){var c=CH[i],lv=l.src?num(l.src[c]):null;if(lv!==null&&lv!==num(ps[c]))return false}return true}
/* 合并规则：正式数据（dashboard.json）为准；本机记录只有「比正式数据新且不一样」才算未同步并替代当天（不叠加） */
function eff(date,L){var l=L[date],p=PUB[date];
 if(l&&ltot(l)===null)l=null;
 if(l&&(!p||((l.t||"")>(p.reported_at||"")&&!same(l,p)))){var s={};CH.forEach(function(c){var v=l.src?num(l.src[c]):null;if(v!==null)s[c]=v});return{total:ltot(l),src:s,un:true}}
 if(p)return{total:p.count,src:p.sources||{},un:false,synced:!!l};
 return{total:null,src:{},un:false}}
function agg(dates,L){var t=null,un=false,ch={};dates.forEach(function(s){var e=eff(s,L);if(e.total!==null)t=(t||0)+e.total;if(e.un)un=true;CH.forEach(function(c){var v=num(e.src[c]);if(v!==null)ch[c]=(ch[c]||0)+v})});return{total:t,un:un,ch:ch}}
var P='<span class="pending">待录入</span>';
function fmt(v){return v===null?P:String(v)}
function delta(c,p,pp){if(c===null)return '<span class="dl na">本周待录入</span>';if(p===null)return '<span class="dl na">上周待录入</span>';var df=c-p,f=function(x){return pp?x.toFixed(1)+"%":String(x)},dv=pp?Math.abs(df).toFixed(1)+" 个百分点":String(Math.abs(df)),pc=(!pp&&p)?"（"+(df>0?"+":"")+Math.round(df/p*100)+"%）":"";
 if(df>0)return '<span class="dl up">▲ '+dv+pc+'</span><span class="dl-p">上周 '+f(p)+'</span>';if(df<0)return '<span class="dl down">▼ '+dv+pc+'</span><span class="dl-p">上周 '+f(p)+'</span>';return '<span class="dl flat">持平</span><span class="dl-p">上周 '+f(p)+'</span>'}
var WS=D.week.start,WE=D.week.end,PWS=add(WS,-7),PWE=add(WS,-1);
function dealsIn(a,b){var t=null;(A.deals_daily||[]).forEach(function(r){if(r.date>=a&&r.date<=b)t=(t||0)+r.new_customers});return t}
function $(s){return document.querySelector(s)}
function selDate(){var i=$("#acq-date");return (i&&i.value)||TODAY}
function render(){var L=load(),wk=agg(range(WS,WE),L),pw=agg(range(PWS,PWE),L),mo=agg(range(TODAY.slice(0,8)+"01",TODAY),L);
 var x=$("#ns-total");if(x)x.innerHTML=fmt(wk.total);
 x=$("#ns-unsync");if(x)x.hidden=!wk.un;
 x=$("#ns-cmp");if(x)x.innerHTML=delta(wk.total,pw.total);
 x=$("#ns-month");if(x)x.innerHTML=fmt(mo.total);
 var tg=num((A.monthly_target||{}).wechat_adds);x=$("#ns-bar");if(x)x.style.width=(tg&&mo.total!==null?Math.min(100,mo.total/tg*100):0)+"%";
 document.querySelectorAll("input[data-day]").forEach(function(inp){var ds=inp.getAttribute("data-day"),e=eff(ds,L),lab=inp.parentNode;
  lab.classList.toggle("today",ds===TODAY);var fut=ds>TODAY;lab.classList.toggle("future",fut);inp.disabled=fut;
  if(document.activeElement!==inp)inp.value=e.total===null?"":e.total;var u=lab.querySelector(".u");if(u)u.hidden=!e.un;lab.classList.toggle("un",e.un);lab.classList.toggle("bad",bad(e))});
 var dl=dealsIn(WS,WE),pdl=dealsIn(PWS,PWE);
 var lays=document.querySelectorAll(".lay");if(lays.length===4){lays[2].setAttribute("data-v",wk.total===null?"":wk.total);var b=lays[2].querySelector("[data-fn]");if(b)b.innerHTML=fmt(wk.total);
  for(var k=1;k<4;k++){var a0=lays[k-1].getAttribute("data-v"),a1=lays[k].getAttribute("data-v"),r=document.querySelector('[data-rt="'+k+'"] b');if(r)r.textContent=(a0!==""&&a1!==""&&+a0>0)?(a1/a0*100).toFixed(1)+"%":"—"}}
 var cv=(dl!==null&&wk.total)?dl/wk.total*100:null,pcv=(pdl!==null&&pw.total)?pdl/pw.total*100:null;
 x=$('[data-live="conv"]');if(x)x.innerHTML=cv===null?P:cv.toFixed(1)+"<small>%</small>";
 x=$('[data-live="conv-d"]');if(x)x.innerHTML=delta(cv,pcv,true);
 var sd=selDate(),e=eff(sd,L);
 document.querySelectorAll("tr[data-ch]").forEach(function(tr){var c=tr.getAttribute("data-ch"),inp=tr.querySelector("input"),v=num(e.src[c]);
  if(document.activeElement!==inp)inp.value=v===null?"":v;var u=tr.querySelector(".u");if(u)u.hidden=!e.un;tr.classList.toggle("bad",bad(e));
  var w=tr.querySelector("[data-wk]");if(w)w.innerHTML=wk.total===null&&!wk.ch[c]?P:String(wk.ch[c]||0)+(wk.un?' <i class="u">含未同步</i>':"");
  var q=tr.querySelector("[data-pw]");if(q)q.textContent=pw.total===null?"—":String(pw.ch[c]||0)});
 x=$("#acq-day");if(x){var as=ssum(e.src),h;
  if(e.total===null)h=sd.slice(5)+" 当天：待录入";
  else{h=sd.slice(5)+" 当天共 <b>"+e.total+"</b> 人";if(bad(e))h+=' <span class="warn">渠道合计 '+ssum(e.src)+'，不符</span>';
   h+=e.un?' <i class="u">未同步</i>':(e.synced?' <i class="ok">已同步</i>':"")}
  x.innerHTML=h}}
function setDay(ds,v){var L=load(),e=eff(ds,L),l=L[ds]||{total:e.total,src:JSON.parse(JSON.stringify(e.src||{}))};l.total=v;l.t=stamp();if(ltot(l)===null)delete L[ds];else L[ds]=l;save(L);render()}
function setCh(ds,c,v){var L=load(),e=eff(ds,L),l=L[ds]||{total:e.total,src:JSON.parse(JSON.stringify(e.src||{}))};l.src=l.src||{};if(v===null)delete l.src[c];else l.src[c]=v;l.t=stamp();if(ltot(l)===null)delete L[ds];else L[ds]=l;save(L);render()}
function val(inp){var s=String(inp.value).trim();if(s==="")return null;var n=parseInt(s,10);return isNaN(n)||n<0?0:n}
document.querySelectorAll("input[data-day]").forEach(function(inp){inp.addEventListener("change",function(){setDay(inp.getAttribute("data-day"),val(inp))})});
document.querySelectorAll("tr[data-ch]").forEach(function(tr){var c=tr.getAttribute("data-ch"),inp=tr.querySelector("input");
 inp.addEventListener("change",function(){setCh(selDate(),c,val(inp))});
 tr.querySelectorAll("[data-step]").forEach(function(b){b.addEventListener("click",function(){var v=val(inp)||0;v=Math.max(0,v+parseInt(b.getAttribute("data-step"),10));inp.value=v;setCh(selDate(),c,v)})})});
var di=$("#acq-date");if(di){di.max=TODAY;if(!di.value||di.value>TODAY)di.value=TODAY;di.addEventListener("change",function(){if(di.value>TODAY)di.value=TODAY;render()})}
function line(ds,e){var as=ssum(e.src),s="加微 "+ds.slice(5)+"：共 "+e.total+" 人";
 if(as===null)return s+"；渠道未填";if(as!==e.total)return s+"；渠道合计不符";s+="；"+CH.map(function(c){return c+" "+(num(e.src[c])===null?0:e.src[c])}).join("，");return s}
function bad(e){var as=ssum(e.src);return e.total!==null&&as!==null&&as!==e.total}
function badDays(){var L=load();return Object.keys(L).filter(function(k){var e=eff(k,L);return e.un&&bad(e)}).sort()}
function phrase(){var L=load(),ds=Object.keys(L).filter(function(k){return eff(k,L).un}).sort();
 if(!ds.length){var e=eff(selDate(),L);return e.total===null?"":line(selDate(),e)}
 return ds.map(function(k){return line(k,eff(k,L))}).join("\n")}
document.querySelectorAll("[data-sync]").forEach(function(btn){btn.addEventListener("click",function(){var t=phrase(),box=$("#sync-out"),ta=box&&box.querySelector("textarea"),msg=$("#sync-msg");
 if(!t){if(box){box.hidden=false;ta.value="";msg.textContent="还没有可同步的数字"}return}
 var bd=badDays();if(!bd.length&&/渠道合计不符/.test(t))bd=[selDate()];
 if(bd.length){if(box){box.hidden=false;ta.value=t;msg.innerHTML='<span class="warn">'+bd.map(function(k){return k.slice(5)}).join("、")+' 渠道合计不符，改对再复制</span>'}return}
 if(box){box.hidden=false;ta.value=t}
 function ok(){if(msg)msg.textContent="已复制，粘贴发给第二大脑即可"}
 function fb(){try{ta.focus();ta.select();if(document.execCommand("copy"))ok();else if(msg)msg.textContent="请手动复制上面这段文字"}catch(e){if(msg)msg.textContent="请手动复制上面这段文字"}}
 if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).then(ok,fb);else fb();
 if(box&&box.scrollIntoView&&btn.closest&&!btn.closest("#acq")){document.body.classList.add("show-more");box.scrollIntoView({block:"center"})}})});
window.__acqPhrase=phrase;
render();
})();</script>'''
