# crap_score.py —— CRAP 指标计算（Change Risk Anti-Patterns）
# 公式：CRAP(f) = CCN(f)^2 + Volume(f) × (1 − Coverage/100)
#   CCN    = 圈复杂度（lizard）
#   Volume = 函数非空非注释行数 NLOC（Halstead volume 的工程近似，可复现）
#   Coverage = 所在文件语句覆盖率（coverage.py，仅 backend；无测试的前端按 0 计）
# 分级（crap4j 惯例）：<30 良好 | 30~60 关注 | 60~90 风险 | >=90 高危
import io
import json
import os
import sys

import lizard

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGETS = ['backend/app', 'scripts', 'frontend/js', 'simulation/scripts']
LANG = {'.py': 'python', '.js': 'javascript'}
COV_FILE = os.path.join(ROOT, '.crap_coverage.json')
OUT_FILE = os.path.join(ROOT, 'docs', 'crap-report.json')


def load_coverage():
    cov = {}
    if os.path.exists(COV_FILE):
        data = json.load(io.open(COV_FILE, encoding='utf-8'))
        for path, info in data.get('files', {}).items():
            cov[os.path.normpath(path).lower()] = info['summary']['percent_covered']
    return cov


def funcs_of(path):
    try:
        fi = lizard.analyze_file(path)
    except Exception as e:
        print('SKIP', path, e)
        return []
    return [(f.name, f.cyclomatic_complexity, f.nloc, f.token_count,
             f.length) for f in fi.function_list]


def band(c):
    return '良好' if c < 30 else '关注' if c < 60 else '风险' if c < 90 else '高危'


def main():
    cov = load_coverage()
    rows = []
    for tgt in TARGETS:
        base = os.path.join(ROOT, tgt)
        for dirpath, _, files in os.walk(base):
            for fn in files:
                ext = os.path.splitext(fn)[1]
                if ext not in LANG:
                    continue
                path = os.path.join(dirpath, fn)
                rel = os.path.relpath(path, ROOT)
                pct = cov.get(os.path.normpath(rel).lower(), 0.0)
                for name, ccn, nloc, tokens, length in funcs_of(path):
                    crap = ccn * ccn + nloc * (1 - pct / 100.0)
                    rows.append({'file': rel, 'func': name.split('::')[-1],
                                 'ccn': ccn, 'nloc': nloc, 'tokens': tokens,
                                 'cov': round(pct, 1), 'crap': round(crap, 1)})

    rows.sort(key=lambda r: -r['crap'])
    total = len(rows)
    bands = {'良好': 0, '关注': 0, '风险': 0, '高危': 0}
    for r in rows:
        bands[band(r['crap'])] += 1
    avg = sum(r['crap'] for r in rows) / total if total else 0
    # 项目总分：容量加权平均（体量大的函数权重高），并给出良品率
    weighted = (sum(r['crap'] * max(r['nloc'], 1) for r in rows)
                / max(sum(max(r['nloc'], 1) for r in rows), 1))

    print('=' * 78)
    print(f"函数总数 {total} | 简单平均 CRAP {avg:.1f} | 加权平均 CRAP {weighted:.1f}")
    print(f"分级分布：良好 {bands['良好']} ({bands['良好']/total*100:.0f}%) | "
          f"关注 {bands['关注']} | 风险 {bands['风险']} | 高危 {bands['高危']}")
    print('=' * 78)
    print('TOP-15 最危险函数：')
    for r in rows[:15]:
        print(f"  {r['crap']:7.1f} [{band(r['crap'])}] CCN={r['ccn']:<3} NLOC={r['nloc']:<4} "
              f"cov={r['cov']:5.1f}%  {r['file']} :: {r['func'][:60]}")
    print('-' * 78)
    print('按模块平均 CRAP：')
    mods = {}
    for r in rows:
        key = '/'.join(r['file'].replace('\\', '/').split('/')[:2])
        mods.setdefault(key, []).append(r['crap'])
    for k in sorted(mods, key=lambda k: -sum(mods[k]) / len(mods[k])):
        v = mods[k]
        print(f"  {sum(v)/len(v):7.1f}  n={len(v):<4} {k}")

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    json.dump({'summary': {'functions': total, 'avg': round(avg, 1),
                           'weighted_avg': round(weighted, 1), 'bands': bands,
                           'good_rate_pct': round(bands['良好'] / total * 100, 1)},
               'worst': rows[:15], 'all': rows},
              io.open(OUT_FILE, 'w', encoding='utf-8'), ensure_ascii=False)
    print('[saved]', OUT_FILE)


if __name__ == '__main__':
    main()
