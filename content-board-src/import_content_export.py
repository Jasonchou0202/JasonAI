#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""内容闭环看板 · 导入「生成可发布汇总」文件
用法：python3 import_content_export.py 汇总文件.json [--write] [--data data/dashboard.json]
来源：生意手账「今日获客录入」页 →「生成可发布汇总」（章鱼哥确认后才交给第二大脑）。
文件里只有日期、当天新增微信好友数、4 个来源拆分，没有备注，也没有任何人的信息。
做什么：① 严格校验汇总文件（多一个字段都不行）
        ② 用汇总覆盖 dashboard.json 里 from～to 这段日期的 acquisition.daily（云端是准数；这段里云端没有的日期会被移除）
        ③ 合并后跑一遍 validate.py 的全部校验（含红线词、隐私扫描、新鲜度），不通过就不写
不加 --write 只预览变化，不改文件。写入后照常 validate.py → build.py → 审核 → PR。"""
import json, os, re, sys
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from validate import LEAD_SOURCES, RE_D, RE_DT, validate, freshness, red_hits, privacy_hits, walk_strings

KIND = 'content-daily-export'
TOP_KEYS = {'kind', 'version', 'from', 'to', 'exported_at', 'daily'}
DAY_KEYS = {'date', 'wechat_adds', 'sources'}
REPORTED_BY = '章鱼哥录入（生意手账）'

def _int(v): return isinstance(v, int) and not isinstance(v, bool)

def check_export(x):
    """返回错误列表；空列表 = 通过"""
    E = []
    if not isinstance(x, dict): return ['汇总文件顶层必须是对象']
    if set(x) != TOP_KEYS: E.append(f'汇总文件字段必须正好是 {sorted(TOP_KEYS)}，现在是 {sorted(x)}')
    if x.get('kind') != KIND: E.append(f'kind 必须是 {KIND}')
    if x.get('version') != 1: E.append('version 必须是 1')
    f, t = x.get('from'), x.get('to')
    if not (isinstance(f, str) and RE_D.match(f) and isinstance(t, str) and RE_D.match(t)) or f > t: E.append('from / to 必须是 YYYY-MM-DD，且 from 不晚于 to'); return E
    if not (isinstance(x.get('exported_at'), str) and RE_DT.match(x['exported_at'])): E.append('exported_at 格式应为 YYYY-MM-DD HH:MM（北京时间）')
    dl = x.get('daily')
    if not isinstance(dl, list): return E + ['daily 必须是列表']
    seen = set()
    for i, r in enumerate(dl):
        p = f'daily[{i}]'
        if not isinstance(r, dict) or set(r) != DAY_KEYS: E.append(f'{p}：字段必须正好是 date、wechat_adds、sources'); continue
        d = r['date']
        if not (isinstance(d, str) and RE_D.match(d)): E.append(f'{p}.date 格式不对'); continue
        if not f <= d <= t: E.append(f'{p}.date {d} 不在 {f}～{t} 之内')
        if d in seen: E.append(f'{p}.date {d} 重复')
        seen.add(d)
        c = r['wechat_adds']
        if not _int(c) or c < 0: E.append(f'{p}.wechat_adds 必须是 ≥0 的整数')
        s = r['sources']
        if not isinstance(s, dict) or set(s) != set(LEAD_SOURCES): E.append(f'{p}.sources 必须正好是 {"、".join(LEAD_SOURCES)} 4 个来源'); continue
        if any(not _int(v) or v < 0 for v in s.values()): E.append(f'{p}.sources 每项必须是 ≥0 的整数'); continue
        if _int(c) and sum(s.values()) != c: E.append(f'{p}：4 个来源合计 {sum(s.values())} ≠ 当天新增 {c}')
    for path, text in walk_strings(x):
        h = red_hits(text) + privacy_hits(text)
        if h: E.append(f'{path} 命中 {h}')
    return E

def merge(d, x):
    """把汇总并进 d（就地修改）。返回 (新增日期, 改动日期, 移除日期, 提醒)"""
    a = d['acquisition']; old = {r['date']: r for r in a['daily'] if isinstance(r, dict) and 'date' in r}
    f, t = x['from'], x['to']; W = []
    keep = [r for r in a['daily'] if not (f <= r.get('date', '') <= t)]
    new = []
    for r in x['daily']:
        e = {'date': r['date'], 'count': r['wechat_adds'], 'sources': {k: r['sources'][k] for k in LEAD_SOURCES if r['sources'][k]},
             'note': '', 'reported_at': x['exported_at'], 'reported_by': REPORTED_BY}
        prev = old.get(r['date'])
        if prev and prev.get('by_content'):
            if sum(b.get('count', 0) for b in prev['by_content']) <= e['count']: e['by_content'] = prev['by_content']
            else: W.append(f'{r["date"]}：原来的「按内容」合计超过新的当天总数，已去掉，请第二大脑重新核对')
        if prev and prev.get('note'): e['note'] = prev['note']
        new.append(e)
    a['daily'] = sorted(keep + new, key=lambda r: r['date'])
    same = lambda p, n: p.get('count') == n['count'] and (p.get('sources') or {}) == n['sources']
    added = [e['date'] for e in new if e['date'] not in old]
    changed = [e['date'] for e in new if e['date'] in old and not same(old[e['date']], e)]
    removed = sorted(k for k in old if f <= k <= t and k not in {e['date'] for e in new})
    return added, changed, removed, W

def main(argv):
    args = [v for v in argv if not v.startswith('--')]
    write = '--write' in argv
    data = os.path.join(ROOT, 'data', 'dashboard.json')
    if '--data' in argv: data = argv[argv.index('--data') + 1]; args = [v for v in args if v != data]
    if len(args) != 1: print(__doc__); return 2
    try: x = json.load(open(args[0], encoding='utf-8'))
    except Exception as e: print(f'✗ 汇总文件读不出来：{e}'); return 1
    E = check_export(x)
    if E: print(f'✗ 汇总文件校验失败，共 {len(E)} 处：'); [print('  - ' + e) for e in E]; return 1
    d = json.load(open(data, encoding='utf-8'))
    added, changed, removed, W = merge(d, x)
    errs = validate(d)
    if not errs: errs = freshness(d)[0]
    if errs: print(f'✗ 合并后看板校验失败，共 {len(errs)} 处，没有写入：'); [print('  - ' + e) for e in errs]; return 1
    print(f'✓ 汇总 {x["from"]}～{x["to"]} 共 {len(x["daily"])} 天，校验通过')
    print(f'  新增 {len(added)} 天{("：" + "、".join(added)) if added else ""}')
    print(f'  改动 {len(changed)} 天{("：" + "、".join(changed)) if changed else ""}')
    print(f'  移除 {len(removed)} 天{("：" + "、".join(removed)) if removed else ""}（云端已删除或没有这天）')
    for w in W: print('⚠ ' + w)
    if write:
        open(data, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2))
        print(f'✓ 已写入 {data}；下一步：python3 validate.py && python3 build.py，再走审核和 PR')
    else: print('（预览，没有改文件；确认后加 --write）')
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
