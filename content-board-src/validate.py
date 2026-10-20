#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""内容闭环看板 · 数据校验脚本
用法：python3 validate.py [data/dashboard.json]
检查：① 字段齐全、类型和取值正确（规则见 data/数据格式说明.md）
      ② 所有文字字段（含字段名）扫描红线词，命中即失败
      ③ 隐私扫描：微信号、手机号、客户/台账类字段，命中即失败
      ④ 获客区块 acquisition（schema 1.1）：每日加微、每日成交汇总、月目标
      ⑤ 新鲜度：时间晚于现在 = 错误；超过 24 小时 = 提醒（不拦构建，页面显示灰色）
      ⑥ 如有 data/wechat_leads.csv（列 date,count,source,note），一并校验并合并
退出码：0 = 通过；1 = 有错误（不要运行 build.py）"""
import json, re, sys, os, csv
from datetime import datetime, timedelta

RED_WORDS = ['VPN', '翻墙', '科学上网', '梯子', '节点', 'IP', '海外账号', '接码', '防封', '封号', '代充', '拼车']
PRIVACY = [(r'wxid_[A-Za-z0-9_-]+', '疑似微信 ID'), (r'微信号\s*[:：]', '疑似微信号'), (r'(?<!\d)1[3-9]\d{9}(?!\d)', '疑似手机号'),
           (r'客户(名|姓名|清单|名单)', '客户信息'), (r'台账|收款|成交额|销售额|订单号', '销售/台账信息'), (r'(?<!\d)\d{17}[\dXx](?!\d)', '疑似身份证号')]
PLATFORMS = {'抖音', '视频号', '公众号', '小红书', '朋友圈'}
PF_STATUS = {'published', 'made', 'pending', 'paused', 'none', 'tbd'}
SLOTS = {'2h', '15:00', '21:00', '24h', '72h', 'other'}
RED_LEVEL = {'pass', 'check', 'hit', 'todo'}
MECH_STATUS = {'待验证', '初步验证', '已验证', '暂停', '未标注'}
FLAGS = {'focus', 'best', 'worst'}
MISSING = {'待采集', '拿不到', '不适用'}
RE_DT = re.compile(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$')
RE_D = re.compile(r'^\d{4}-\d{2}-\d{2}$')
# 获客渠道（固定 4 个，key 即页面显示名）。口径（章鱼哥 10-19 16:18）：有渠道拆分时，4 个渠道之和必须正好等于当天 count；渠道全空 = 渠道未填，允许
LEAD_SOURCES = ['抖音', '视频号', '公众号', '小红书']
UNASSIGNED = {''}  # CSV 里 source 只能留空（= 渠道未填），不再有「未分渠道」
SLOT_CANON = ['2h', '15:00', '21:00', '24h']   # 新快照只用这 4 个；旧标签 72h / other 仍能读，页面按采集时间自动归入或不显示
COLL_PLATFORMS = {'小红书', '抖音', '知乎', 'X', '视频号', '公众号', '其他'}
SRC_STATUS = {'active', 'not_started'}
DEAL_SOURCE = '销售看板成交客户数（同步方式待章鱼哥拍板）'
DEAL_PROVIDERS = {'销售看板Bot', '章鱼哥'}
# 金额类字段：公开看板不放成交金额，整份 JSON 出现即失败
MONEY_KEY = re.compile(r'amount|money|price|revenue|income|gmv|sales|金额|收入|营收|价格|单价|总价|成交额|销售额|元', re.I)
# 获客区块里不许出现的字段名（只存数字和来源，不存人）
BANNED_KEYS = {'name', 'names', 'nickname', 'wxid', 'wechat_id', 'phone', 'mobile', 'customer', 'customers', 'customer_name',
               '名字', '姓名', '昵称', '备注名', '微信', '手机', '客户名', '订单'}
STALE_HOURS = 24

def parse_time(t, year=None):
    """支持 YYYY-MM-DD HH:MM / YYYY-MM-DD / MM-DD HH:MM / MM-DD；认不出返回 None。只有日期时按当天 23:59 算。"""
    if not isinstance(t, str): return None
    t = t.strip(); y = year or datetime.now().year
    for fmt, full in (('%Y-%m-%d %H:%M', True), ('%Y-%m-%d', False)):
        try:
            v = datetime.strptime(t, fmt); return v if full else v.replace(hour=23, minute=59)
        except ValueError: pass
    m = re.match(r'^(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$', t)
    if m:
        try:
            v = datetime(y, int(m.group(1)), int(m.group(2)))
            return v.replace(hour=int(m.group(3)), minute=int(m.group(4))) if m.group(3) else v.replace(hour=23, minute=59)
        except ValueError: return None
    return None

def now_bj():
    """box 时钟已是北京时间；测试时可用环境变量 BOARD_NOW="YYYY-MM-DD HH:MM" 固定"""
    v = os.environ.get('BOARD_NOW')
    return datetime.strptime(v, '%Y-%m-%d %H:%M') if v else datetime.now().replace(second=0, microsecond=0)

def red_hits(text):
    hits = []
    for w in RED_WORDS:
        if w == 'IP':
            if re.search(r'(?<![A-Za-z])IP(?![A-Za-z])', text, re.I): hits.append(w)
        elif w == 'VPN':
            if re.search('vpn', text, re.I): hits.append(w)
        elif w in text: hits.append(w)
    return hits

def privacy_hits(text):
    return [name for pat, name in PRIVACY if re.search(pat, text)]

def walk_strings(o, path='$'):
    if isinstance(o, dict):
        for k, v in o.items():
            yield f'{path}.{k}(字段名)', str(k)
            yield from walk_strings(v, f'{path}.{k}')
    elif isinstance(o, list):
        for i, v in enumerate(o): yield from walk_strings(v, f'{path}[{i}]')
    elif isinstance(o, str):
        yield path, o

def validate(d):
    E = []
    def need(obj, key, typ, path):
        if not isinstance(obj, dict) or key not in obj:
            E.append(f'{path}：缺少字段「{key}」'); return None
        v = obj[key]
        if typ and not isinstance(v, typ):
            E.append(f'{path}.{key}：类型应为 {typ if isinstance(typ, type) else "/".join(t.__name__ for t in typ)}，实际是 {type(v).__name__}'); return None
        return v
    def s(obj, key, path, required=True):
        if not required and key not in obj: return None
        v = need(obj, key, str, path)
        if v is not None and not v.strip() and required: E.append(f'{path}.{key}：不能为空')
        return v
    if not isinstance(d, dict): return ['顶层必须是对象 {}']
    sv = d.get('schema_version')
    if sv not in ('1.0', '1.1'): E.append('$.schema_version：应为 "1.1"（旧版 "1.0" 仍可读，但没有获客区块）')
    u = s(d, 'updated_at', '$')
    if u and not RE_DT.match(u): E.append('$.updated_at：格式应为 YYYY-MM-DD HH:MM（北京时间）')
    s(d, 'updated_by', '$')
    w = need(d, 'week', dict, '$')
    if w:
        for k in ('start', 'end'):
            v = s(w, k, '$.week')
            if v and not RE_D.match(v): E.append(f'$.week.{k}：格式应为 YYYY-MM-DD')
        s(w, 'label', '$.week')
    ks = need(d, 'kpis', list, '$') or []
    for i, k in enumerate(ks):
        p = f'$.kpis[{i}]'
        for f in ('key', 'title', 'unit', 'note'): s(k, f, p, required=(f != 'unit'))
        s(k, 'source', p, required=False)
        kt = s(k, 'time', p, required=False)
        if kt and not RE_DT.match(kt): E.append(f'{p}.time：格式应为 YYYY-MM-DD HH:MM')
        if 'prev_value' in k and k['prev_value'] is not None and (isinstance(k['prev_value'], bool) or not isinstance(k['prev_value'], (int, float))):
            E.append(f'{p}.prev_value：上周值只能是数字或 null（null 显示「上周待录入」）')
        if 'result' in k and not isinstance(k['result'], bool): E.append(f'{p}.result：只能是 true / false')
        st = s(k, 'status', p)
        if st and st not in ('real', 'pending'): E.append(f'{p}.status：只能是 real 或 pending')
        if 'value' not in k: E.append(f'{p}：缺少字段「value」')
        else:
            v = k['value']
            if st == 'pending' and v is not None: E.append(f'{p}.value：status 为 pending 时 value 必须是 null（页面显示「待采集」）')
            if st == 'real' and not isinstance(v, (int, float, str)): E.append(f'{p}.value：status 为 real 时必须填数字或文字')
    sts = need(d, 'stages', list, '$') or []
    if [x.get('id') for x in sts if isinstance(x, dict)] != list(range(1, 8)): E.append('$.stages：必须正好 7 个，id 依次为 1–7')
    for i, x in enumerate(sts):
        for f in ('name', 'owner', 'rhythm', 'desc'): s(x, f, f'$.stages[{i}]')
    bl = need(d, 'baselines', dict, '$') or {}
    for pfn, b in bl.items():
        if pfn not in PLATFORMS: E.append(f'$.baselines：平台名「{pfn}」不在 {sorted(PLATFORMS)} 里')
        for f in ('median', 'double'):
            need(b, f, (int, float), f'$.baselines.{pfn}')
        s(b, 'formula', f'$.baselines.{pfn}'); s(b, 'sample', f'$.baselines.{pfn}')
    for i, a in enumerate(need(d, 'accounts', list, '$') or []):
        p = f'$.accounts[{i}]'
        if s(a, 'platform', p) not in PLATFORMS: E.append(f'{p}.platform：平台名不对')
        t = s(a, 'time', p)
        if t and not RE_DT.match(t): E.append(f'{p}.time：格式应为 YYYY-MM-DD HH:MM')
        m = need(a, 'metrics', dict, p)
        for mk, mv in (m or {}).items():
            if not isinstance(mv, (int, float, str)) or isinstance(mv, bool): E.append(f'{p}.metrics.{mk}：只能是数字或文字')
    for i, c in enumerate(need(d, 'collection', list, '$') or []):
        for f in ('name', 'count', 'detail', 'time'): s(c, f, f'$.collection[{i}]')
        s(c, 'items_source', f'$.collection[{i}]', required=False)
        its = c.get('items')
        if its is None: continue
        if not isinstance(its, list): E.append(f'$.collection[{i}].items：必须是列表（没有明细写 []，页面显示「明细待大管家补充」）'); continue
        for j, it in enumerate(its):
            p = f'$.collection[{i}].items[{j}]'
            if not isinstance(it, dict): E.append(f'{p}：必须是对象'); continue
            s(it, 'title', p)
            pf = s(it, 'platform', p, required=False)
            if pf and pf not in COLL_PLATFORMS: E.append(f'{p}.platform：只能是 {"、".join(sorted(COLL_PLATFORMS))}')
            s(it, 'time', p, required=False); s(it, 'note', p, required=False)
            u = s(it, 'url', p, required=False)
            if u and not u.startswith('https://'): E.append(f'{p}.url：必须以 https:// 开头')
            if 'count' in it and (not isinstance(it['count'], int) or isinstance(it['count'], bool) or it['count'] < 0): E.append(f'{p}.count：出现次数必须是 ≥0 的整数')
            extra = set(it) - {'title', 'platform', 'time', 'note', 'url', 'count'}
            if extra: E.append(f'{p}：不认识的字段 {sorted(extra)}')
    mc = need(d, 'mechanisms', dict, '$')
    if mc:
        need(mc, 'hypotheses_count', int, '$.mechanisms'); s(mc, 'updated', '$.mechanisms')
        nos = []
        for i, it in enumerate(need(mc, 'items', list, '$.mechanisms') or []):
            p = f'$.mechanisms.items[{i}]'
            nos.append(need(it, 'no', int, p)); s(it, 'title', p)
            if s(it, 'status', p) not in MECH_STATUS: E.append(f'{p}.status：只能是 {"、".join(sorted(MECH_STATUS))}')
        if len(set(nos)) != len(nos): E.append('$.mechanisms.items：no 有重复')
    ids = set()
    for i, t in enumerate(need(d, 'topics', list, '$') or []):
        p = f'$.topics[{i}]'
        tid = s(t, 'id', p)
        if tid:
            if not re.match(r'^[a-z0-9-]+$', tid): E.append(f'{p}.id：只用小写字母、数字和短横线')
            if tid in ids: E.append(f'{p}.id：「{tid}」重复')
            ids.add(tid)
        dt = s(t, 'date', p)
        if dt and not RE_D.match(dt): E.append(f'{p}.date：格式应为 YYYY-MM-DD')
        for f in ('title', 'stage_note', 'source', 'mechanism', 'owners', 'compare'): s(t, f, p)
        sg = need(t, 'stage', int, p)
        if sg is not None and not 1 <= sg <= 7: E.append(f'{p}.stage：只能是 1–7')
        for fl in need(t, 'flags', list, p) or []:
            if fl not in FLAGS: E.append(f'{p}.flags：「{fl}」不认识，只能是 focus/best/worst')
        for j, q in enumerate(need(t, 'platforms', list, p) or []):
            pp = f'{p}.platforms[{j}]'
            if s(q, 'platform', pp) not in PLATFORMS: E.append(f'{pp}.platform：平台名不对')
            if s(q, 'status', pp) not in PF_STATUS: E.append(f'{pp}.status：只能是 {"/".join(sorted(PF_STATUS))}')
            for f in ('time', 'work', 'note'): s(q, f, pp, required=False)
            url = s(q, 'url', pp, required=False)
            if url and not url.startswith('https://'): E.append(f'{pp}.url：必须以 https:// 开头')
        for j, q in enumerate(need(t, 'snapshots', list, p) or []):
            pp = f'{p}.snapshots[{j}]'
            if s(q, 'slot', pp) not in SLOTS: E.append(f'{pp}.slot：只能是 2h / 15:00 / 21:00 / 24h（旧标签 72h / other 也认）')
            if s(q, 'platform', pp) not in PLATFORMS: E.append(f'{pp}.platform：平台名不对')
            tm = s(q, 'time', pp)
            if tm and not RE_DT.match(tm): E.append(f'{pp}.time：格式应为 YYYY-MM-DD HH:MM')
            s(q, 'elapsed', pp); s(q, 'note', pp, required=False)
            m = q.get('metrics')
            if isinstance(m, str):
                if m not in MISSING: E.append(f'{pp}.metrics：写文字时只能是 待采集 / 拿不到')
            elif isinstance(m, dict):
                for mk, mv in m.items():
                    if isinstance(mv, bool) or not isinstance(mv, (int, float, str)): E.append(f'{pp}.metrics.{mk}：只能是数字，或 待采集 / 拿不到')
                    elif isinstance(mv, str) and mv not in MISSING: E.append(f'{pp}.metrics.{mk}：「{mv}」不是数字；没有数据请写 待采集 或 拿不到')
            else: E.append(f'{pp}.metrics：必须是对象（指标: 数字）或 "待采集" / "拿不到"')
        r = need(t, 'redline', dict, p)
        if r:
            if s(r, 'level', f'{p}.redline') not in RED_LEVEL: E.append(f'{p}.redline.level：只能是 pass/check/hit/todo')
            s(r, 'note', f'{p}.redline')
        for j, b in enumerate(need(t, 'blockers', list, p) or []):
            if not isinstance(b, str) or not b.strip(): E.append(f'{p}.blockers[{j}]：必须是非空文字')
    if sv == '1.1' or 'acquisition' in d:
        validate_acquisition(d, E, ids)
    validate_ceo(d, E, ids)
    _money_keys(d, '$', E)
    for path, text in walk_strings(d):
        h = red_hits(text)
        if h: E.append(f'红线词命中 {h}：{path}')
        h = privacy_hits(text)
        if h: E.append(f'隐私信息命中 {h}：{path}')
    return E

def _int(v): return isinstance(v, int) and not isinstance(v, bool)
def _num(v): return isinstance(v, (int, float)) and not isinstance(v, bool)

def _money_keys(o, path, E):
    if isinstance(o, dict):
        for k, v in o.items():
            if MONEY_KEY.search(str(k)): E.append(f'{path}.{k}：看板不放成交金额，金额类字段「{k}」不允许（只存每日成交客户数）')
            _money_keys(v, f'{path}.{k}', E)
    elif isinstance(o, list):
        for i, v in enumerate(o): _money_keys(v, f'{path}[{i}]', E)

def _banned_keys(o, path, E):
    if isinstance(o, dict):
        for k, v in o.items():
            if str(k).lower() in BANNED_KEYS: E.append(f'{path}.{k}：获客区块只存数字和来源，不许有「{k}」这类个人信息字段')
            _banned_keys(v, f'{path}.{k}', E)
    elif isinstance(o, list):
        for i, v in enumerate(o): _banned_keys(v, f'{path}[{i}]', E)

def _sources(obj, path, E, total=None, allow_missing=True, exact=False, what='当天总数'):
    """渠道拆分可以不填、可以是 {}（= 渠道未填）；只要填了，exact=True 时合计必须正好等于总数（daily、deals_daily 都用这个口径），exact=False 时不能大于总数"""
    if obj is None and allow_missing: return
    if not isinstance(obj, dict): E.append(f'{path}：必须是对象，例 {{"抖音": 2, "视频号": 1}}；没拆分可以不写或写 {{}}'); return
    sm = 0
    for k, v in obj.items():
        if k not in LEAD_SOURCES: E.append(f'{path}：来源「{k}」不认识，只能是 {"、".join(LEAD_SOURCES)}')
        if not _int(v) or v < 0: E.append(f'{path}.{k}：必须是 ≥0 的整数')
        else: sm += v
    if total is None or not _int(total) or not obj: return
    if exact and sm != total:
        E.append(f'{path}：4 个渠道合计 {sm} ≠ {what} {total}，渠道合计必须正好等于{what}（说不清渠道就整项不写 sources）')
    elif not exact and sm > total:
        E.append(f'{path}：渠道合计 {sm} 大于总数 {total}，请核对')

def validate_acquisition(d, E, topic_ids):
    a = d.get('acquisition')
    if not isinstance(a, dict): E.append('$.acquisition：schema 1.1 必须有获客区块（对象）'); return
    P = '$.acquisition'
    _banned_keys(a, P, E)
    for f in ('north_star', 'adds_source', 'deal_source', 'deal_provider'):
        v = a.get(f)
        if not isinstance(v, str) or not v.strip(): E.append(f'{P}.{f}：必填文字')
    if a.get('deal_source') != DEAL_SOURCE: E.append(f'{P}.deal_source：成交数据源固定为「{DEAL_SOURCE}」')
    # 来源定义
    srcs = a.get('sources')
    if not isinstance(srcs, list): E.append(f'{P}.sources：必须是列表')
    else:
        keys = [x.get('key') for x in srcs if isinstance(x, dict)]
        if sorted(keys) != sorted(LEAD_SOURCES): E.append(f'{P}.sources：必须正好是 {"、".join(LEAD_SOURCES)} 这 4 个渠道')
        for i, x in enumerate(srcs):
            if not isinstance(x, dict): E.append(f'{P}.sources[{i}]：必须是对象'); continue
            for f in ('key', 'label', 'path'):
                if not isinstance(x.get(f), str) or not x[f].strip(): E.append(f'{P}.sources[{i}].{f}：必填文字')
            if x.get('status') not in SRC_STATUS: E.append(f'{P}.sources[{i}].status：只能是 active / not_started')
    # 月目标
    mt = a.get('monthly_target')
    if not isinstance(mt, dict): E.append(f'{P}.monthly_target：必须是对象')
    else:
        for f in ('wechat_adds', 'new_customers'):
            if f not in mt: E.append(f'{P}.monthly_target：缺少「{f}」（还没定就写 null，页面显示「待定」）')
            elif mt[f] is not None and (not _num(mt[f]) or mt[f] < 0): E.append(f'{P}.monthly_target.{f}：只能是 ≥0 的数字或 null')
    # 漏斗上两层（每周手动/大管家填，没数据写 null）
    fi = a.get('funnel_inputs')
    if not isinstance(fi, dict): E.append(f'{P}.funnel_inputs：必须是对象')
    else:
        for f in ('exposure', 'visits'):
            x = fi.get(f)
            if not isinstance(x, dict): E.append(f'{P}.funnel_inputs.{f}：必须是对象 {{"value": null, "source": "…", "time": null}}'); continue
            v = x.get('value')
            if v is not None and (not _int(v) or v < 0): E.append(f'{P}.funnel_inputs.{f}.value：只能是 ≥0 的整数或 null')
            if not isinstance(x.get('source'), str) or not x['source'].strip(): E.append(f'{P}.funnel_inputs.{f}.source：必填文字')
            t = x.get('time')
            if v is not None and not (isinstance(t, str) and RE_DT.match(t)): E.append(f'{P}.funnel_inputs.{f}.time：有数字时必须写采集时间 YYYY-MM-DD HH:MM')
            if t is not None and not (isinstance(t, str) and RE_DT.match(t)): E.append(f'{P}.funnel_inputs.{f}.time：格式应为 YYYY-MM-DD HH:MM 或 null')
    # 每日加微
    dl = a.get('daily')
    if not isinstance(dl, list): E.append(f'{P}.daily：必须是列表（还没数据写 []）')
    else:
        seen = set()
        for i, r in enumerate(dl):
            p = f'{P}.daily[{i}]'
            if not isinstance(r, dict): E.append(f'{p}：必须是对象'); continue
            dt = r.get('date')
            if not (isinstance(dt, str) and RE_D.match(dt)): E.append(f'{p}.date：格式应为 YYYY-MM-DD')
            elif dt in seen: E.append(f'{p}.date：{dt} 重复，同一天只记一条（来源拆到 sources 里）')
            else: seen.add(dt)
            c = r.get('count')
            if not _int(c) or c < 0: E.append(f'{p}.count：必须是 ≥0 的整数（当天没加人写 0；没报数就不要建这一天）')
            _sources(r.get('sources'), f'{p}.sources', E, total=c, exact=True)
            for j, bc in enumerate(r.get('by_content') or []):
                pp = f'{p}.by_content[{j}]'
                if not isinstance(bc, dict): E.append(f'{pp}：必须是对象'); continue
                if not isinstance(bc.get('label'), str) or not bc['label'].strip(): E.append(f'{pp}.label：必填，写作品名或「抖音第88集」这类编号')
                if bc.get('topic_id') is not None and bc['topic_id'] not in topic_ids: E.append(f'{pp}.topic_id：「{bc["topic_id"]}」不在 topics 里')
                if not _int(bc.get('count')) or bc['count'] < 0: E.append(f'{pp}.count：必须是 ≥0 的整数')
            if r.get('by_content') and _int(c) and sum(b.get('count', 0) for b in r['by_content'] if isinstance(b, dict) and _int(b.get('count'))) > c:
                E.append(f'{p}.by_content：按内容合计不能超过当天总数 {c}')
            ra = r.get('reported_at')
            if not (isinstance(ra, str) and RE_DT.match(ra)): E.append(f'{p}.reported_at：必填，记录时间 YYYY-MM-DD HH:MM')
            if not isinstance(r.get('reported_by'), str) or not r['reported_by'].strip(): E.append(f'{p}.reported_by：必填，例「章鱼哥报数」')
            if 'note' in r and not isinstance(r['note'], str): E.append(f'{p}.note：必须是文字')
            elif len(r.get('note', '')) > 60: E.append(f'{p}.note：备注最多 60 字，只写来源情况，不写人')
    # 每日成交（销售看板Bot 只读统计后提供的当天汇总）
    dd = a.get('deals_daily')
    if not isinstance(dd, list): E.append(f'{P}.deals_daily：必须是列表（还没数据写 []）')
    else:
        seen = set()
        for i, r in enumerate(dd):
            p = f'{P}.deals_daily[{i}]'
            if not isinstance(r, dict): E.append(f'{p}：必须是对象'); continue
            allowed = {'date', 'new_customers', 'sources', 'provided_at', 'provided_by', 'note'}
            extra = set(r) - allowed
            if extra: E.append(f'{p}：只允许当天成交客户数，多了 {sorted(extra)}（不放金额、不放明细）')
            dt = r.get('date')
            if not (isinstance(dt, str) and RE_D.match(dt)): E.append(f'{p}.date：格式应为 YYYY-MM-DD')
            elif dt in seen: E.append(f'{p}.date：{dt} 重复，同一天只记一条汇总')
            else: seen.add(dt)
            nc = r.get('new_customers')
            if not _int(nc) or nc < 0: E.append(f'{p}.new_customers：必须是 ≥0 的整数')
            if 'sources' in r: _sources(r['sources'], f'{p}.sources', E, total=nc, exact=True, what='成交客户数')  # 10-19 16:24 章鱼哥：必须正好相等
            pa = r.get('provided_at')
            if not (isinstance(pa, str) and RE_DT.match(pa)): E.append(f'{p}.provided_at：必填，统计时间 YYYY-MM-DD HH:MM')
            if r.get('provided_by') not in DEAL_PROVIDERS: E.append(f'{p}.provided_by：只能是「销售看板Bot」或「章鱼哥」（第二大脑和大管家都不读销售数据）')
            if 'note' in r and (not isinstance(r['note'], str) or len(r['note']) > 60): E.append(f'{p}.note：文字，最多 60 字')

def validate_ceo(d, E, topic_ids):
    """CEO 驾驶舱的手写字段：本周结论、拍板区、风险条（schema 1.1，可缺省）"""
    ws = d.get('week_summary')
    if ws is not None:
        if not isinstance(ws, dict) or not isinstance(ws.get('text'), str) or not ws['text'].strip(): E.append('$.week_summary.text：必填一句话')
        elif len(ws['text']) > 90: E.append('$.week_summary.text：一句话结论最多 90 字')
        if isinstance(ws, dict) and not (isinstance(ws.get('time'), str) and RE_DT.match(ws['time'])): E.append('$.week_summary.time：格式 YYYY-MM-DD HH:MM')
    dc = d.get('decisions')
    if dc is not None:
        if not isinstance(dc, list): E.append('$.decisions：必须是列表')
        else:
            if len(dc) > 3: E.append(f'$.decisions：最多 3 条（现在 {len(dc)} 条），挑最急的')
            for i, x in enumerate(dc):
                p = f'$.decisions[{i}]'
                if not isinstance(x, dict): E.append(f'{p}：必须是对象'); continue
                for f in ('title', 'why'):
                    if not isinstance(x.get(f), str) or not x[f].strip(): E.append(f'{p}.{f}：必填文字')
                if x.get('topic_id') is not None and x['topic_id'] not in topic_ids: E.append(f'{p}.topic_id：「{x["topic_id"]}」不在 topics 里')
                if x.get('since') is not None and not (isinstance(x['since'], str) and RE_D.match(x['since'])): E.append(f'{p}.since：格式 YYYY-MM-DD')
    rk = d.get('risks')
    if rk is not None:
        if not isinstance(rk, list): E.append('$.risks：必须是列表')
        else:
            for i, x in enumerate(rk):
                p = f'$.risks[{i}]'
                if not isinstance(x, dict): E.append(f'{p}：必须是对象'); continue
                if x.get('level') not in ('red', 'yellow'): E.append(f'{p}.level：只能是 red / yellow')
                if not isinstance(x.get('text'), str) or not x['text'].strip(): E.append(f'{p}.text：必填文字')
                if x.get('topic_id') is not None and x['topic_id'] not in topic_ids: E.append(f'{p}.topic_id：「{x["topic_id"]}」不在 topics 里')

# ---------- wechat_leads.csv（可选） ----------
def load_leads_csv(path):
    """读 date,count,source,note；同一天多行按来源合并。返回 (daily 记录列表, 错误列表)。文件不存在返回 (None, [])"""
    if not os.path.exists(path): return None, []
    E = []; days = {}
    mtime = datetime.fromtimestamp(os.path.getmtime(path)).strftime('%Y-%m-%d %H:%M')
    with open(path, encoding='utf-8-sig', newline='') as fh:
        rd = csv.DictReader(fh)
        if [c.strip() for c in (rd.fieldnames or [])] != ['date', 'count', 'source', 'note']:
            return [], [f'wechat_leads.csv：表头必须正好是 date,count,source,note，现在是 {rd.fieldnames}']
        for n, row in enumerate(rd, start=2):
            p = f'wechat_leads.csv 第 {n} 行'
            dt = (row.get('date') or '').strip(); cs = (row.get('count') or '').strip()
            src = (row.get('source') or '').strip(); note = (row.get('note') or '').strip()
            if src in UNASSIGNED: src = ''
            if not RE_D.match(dt): E.append(f'{p}：date 格式应为 YYYY-MM-DD'); continue
            if not re.match(r'^\d+$', cs): E.append(f'{p}：count 必须是 ≥0 的整数'); continue
            if src and src not in LEAD_SOURCES: E.append(f'{p}：source「{src}」不认识，只能是 {"、".join(LEAD_SOURCES)}，或留空（= 渠道未填）'); continue
            if len(note) > 60: E.append(f'{p}：note 最多 60 字')
            h = red_hits(note) + privacy_hits(note)
            if h: E.append(f'{p}：note 命中 {h}')
            r = days.setdefault(dt, {'date': dt, 'count': 0, 'sources': {}, 'note': '', 'reported_at': mtime, 'reported_by': 'wechat_leads.csv'})
            r['count'] += int(cs)
            if src: r['sources'][src] = r['sources'].get(src, 0) + int(cs)
            if note: r['note'] = (r['note'] + '；' + note).strip('；')[:60]
    return [days[k] for k in sorted(days)], E

def merge_leads(d, recs):
    """把 CSV 记录并进 d['acquisition']['daily']（只在内存里，不回写 json）。同一天 json 已有就以 json 为准。返回提醒列表"""
    W = []
    if not recs: return W
    a = d.get('acquisition')
    if not isinstance(a, dict) or not isinstance(a.get('daily'), list): return ['wechat_leads.csv：dashboard.json 没有 acquisition.daily，跳过合并']
    have = {r.get('date') for r in a['daily'] if isinstance(r, dict)}
    for r in recs:
        if r['date'] in have: W.append(f'wechat_leads.csv：{r["date"]} 在 dashboard.json 里已有记录，以 json 为准，CSV 这天没合并')
        else: a['daily'].append(r)
    a['daily'].sort(key=lambda r: r.get('date', ''))
    return W

def collect_times(d):
    """列出页面上所有带采集时间的数字：(路径, 时间文字)"""
    out = [('$.updated_at', d.get('updated_at'))]
    for i, k in enumerate(d.get('kpis', [])):
        if k.get('time'): out.append((f'$.kpis[{i}]（{k.get("title")}）', k['time']))
    for i, a in enumerate(d.get('accounts', [])): out.append((f'$.accounts[{i}]（{a.get("platform")}）', a.get('time')))
    for i, c in enumerate(d.get('collection', [])): out.append((f'$.collection[{i}]（{c.get("name")}）', c.get('time')))
    for i, t in enumerate(d.get('topics', [])):
        for j, q in enumerate(t.get('snapshots', [])): out.append((f'$.topics[{i}].snapshots[{j}]（{q.get("platform")}）', q.get('time')))
    a = d.get('acquisition') or {}
    for i, r in enumerate(a.get('daily') or []): out.append((f'$.acquisition.daily[{i}]（{r.get("date")}）', r.get('reported_at')))
    for i, r in enumerate(a.get('deals_daily') or []): out.append((f'$.acquisition.deals_daily[{i}]（{r.get("date")}）', r.get('provided_at')))
    for f, x in ((a.get('funnel_inputs') or {}).items()):
        if isinstance(x, dict) and x.get('time'): out.append((f'$.acquisition.funnel_inputs.{f}', x['time']))
    return out

def freshness(d, now=None):
    """返回 (错误, 提醒)。时间晚于现在 10 分钟以上 = 错误；超过 24 小时 = 提醒（页面显示灰色）"""
    now = now or now_bj(); E = []; W = []
    yr = int(d['updated_at'][:4]) if isinstance(d.get('updated_at'), str) and RE_DT.match(d['updated_at']) else now.year
    for path, t in collect_times(d):
        v = parse_time(t, yr)
        if v is None: continue
        if v > now + timedelta(minutes=10): E.append(f'新鲜度：{path} 的时间 {t} 晚于现在 {now:%Y-%m-%d %H:%M}，请核对')
        elif now - v > timedelta(hours=STALE_HOURS): W.append(f'{path} 采集于 {t}，已超 {STALE_HOURS} 小时（页面显示灰色）')
    u = parse_time(d.get('updated_at'), yr)
    if u and now - u > timedelta(hours=STALE_HOURS): W.insert(0, f'整页 updated_at {d["updated_at"]} 已超 {STALE_HOURS} 小时没更新，请大管家补快照')
    return E, W

def load_all(json_path, csv_path=None):
    """build.py 和 validate.py 共用：读 json → 合并 CSV → 校验 → 新鲜度。返回 (d, 错误, 提醒, csv 状态文字)"""
    d = json.load(open(json_path, encoding='utf-8'))
    csv_path = csv_path or os.path.join(os.path.dirname(json_path), 'wechat_leads.csv')
    recs, ce = load_leads_csv(csv_path)
    if recs is None: cs = 'wechat_leads.csv 不存在，跳过'
    else: cs = f'wechat_leads.csv 读到 {len(recs)} 天'
    W = merge_leads(d, recs) if not ce else []
    errs = ce + (validate(d) if isinstance(d, dict) else ['顶层必须是对象 {}'])
    fe, fw = freshness(d) if not errs else ([], [])
    return d, errs + fe, W + fw, cs

def main():
    f = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'dashboard.json')
    try:
        d, errs, warns, cs = load_all(f)
    except Exception as e:
        print(f'✗ JSON 读不出来：{e}'); sys.exit(1)
    if errs:
        print(f'✗ 校验失败，共 {len(errs)} 处：'); [print('  - ' + e) for e in errs]; sys.exit(1)
    n = len(d['topics']); s = sum(len(t['snapshots']) for t in d['topics'])
    a = d.get('acquisition') or {}
    print(f'✓ 校验通过：{n} 个选题，{s} 条快照，加微记录 {len(a.get("daily") or [])} 天，成交记录 {len(a.get("deals_daily") or [])} 天，红线词 0 命中，隐私信息 0 命中（数据更新于 {d["updated_at"]}；{cs}）')
    if warns:
        print(f'⚠ 新鲜度提醒 {len(warns)} 条（不拦构建）：'); [print('  - ' + w) for w in warns[:12]]
        if len(warns) > 12: print(f'  … 另有 {len(warns) - 12} 条')

if __name__ == '__main__':
    main()
