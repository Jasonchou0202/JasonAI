#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""内容闭环看板 · 数据校验脚本
用法：python3 validate.py [data/dashboard.json]
检查：① 字段齐全、类型和取值正确（规则见 data/数据格式说明.md）
      ② 所有文字字段（含字段名）扫描红线词，命中即失败
      ③ 隐私扫描：微信号、手机号、客户/台账类字段，命中即失败
退出码：0 = 通过；1 = 有错误（不要运行 build.py）"""
import json, re, sys, os

RED_WORDS = ['VPN', '翻墙', '科学上网', '梯子', '节点', 'IP', '海外账号', '接码', '防封', '封号', '代充', '拼车']
PRIVACY = [(r'wxid_[A-Za-z0-9_-]+', '疑似微信 ID'), (r'微信号\s*[:：]', '疑似微信号'), (r'(?<!\d)1[3-9]\d{9}(?!\d)', '疑似手机号'),
           (r'客户(名|姓名|清单|名单)', '客户信息'), (r'台账|收款|成交额|销售额|订单号', '销售/台账信息'), (r'(?<!\d)\d{17}[\dXx](?!\d)', '疑似身份证号')]
PLATFORMS = {'抖音', '视频号', '公众号', '小红书', '朋友圈'}
PF_STATUS = {'published', 'made', 'pending', 'paused', 'none', 'tbd'}
SLOTS = {'2h', '15:00', '21:00', '24h', 'other'}
RED_LEVEL = {'pass', 'check', 'hit', 'todo'}
MECH_STATUS = {'待验证', '初步验证', '已验证', '暂停', '未标注'}
FLAGS = {'focus', 'best', 'worst'}
MISSING = {'待采集', '拿不到', '不适用'}
RE_DT = re.compile(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$')
RE_D = re.compile(r'^\d{4}-\d{2}-\d{2}$')

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
    if d.get('schema_version') != '1.0': E.append('$.schema_version：应为 "1.0"')
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
            if s(q, 'slot', pp) not in SLOTS: E.append(f'{pp}.slot：只能是 2h / 15:00 / 21:00 / 24h / other')
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
    for path, text in walk_strings(d):
        h = red_hits(text)
        if h: E.append(f'红线词命中 {h}：{path}')
        h = privacy_hits(text)
        if h: E.append(f'隐私信息命中 {h}：{path}')
    return E

def main():
    f = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'dashboard.json')
    try:
        d = json.load(open(f, encoding='utf-8'))
    except Exception as e:
        print(f'✗ JSON 读不出来：{e}'); sys.exit(1)
    errs = validate(d)
    if errs:
        print(f'✗ 校验失败，共 {len(errs)} 处：'); [print('  - ' + e) for e in errs]; sys.exit(1)
    n = len(d['topics']); s = sum(len(t['snapshots']) for t in d['topics'])
    print(f'✓ 校验通过：{n} 个选题，{s} 条快照，红线词 0 命中，隐私信息 0 命中（数据更新于 {d["updated_at"]}）')

if __name__ == '__main__':
    main()
