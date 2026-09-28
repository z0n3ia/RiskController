# ============================================================
# replay.py —— 端到端 HTTP 回放（对应 simulation/scripts/demo.js 的服务端版本）
# 流程：阶段一回放（处置前）→ 模拟审核处置（拉黑团伙）→ 阶段二回放（对抗效果）
# 前置：后端已启动（127.0.0.1:8642），数据库已重置（空窗口冷启动）
# 运行：python scripts/replay.py
# ============================================================
import json
import os
import urllib.request

BASE = 'http://127.0.0.1:8642'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'simulation', 'data')


def call(method, path, body=None, role='admin'):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header('Content-Type', 'application/json')
    req.add_header('X-Role', role)
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(req, data=data, timeout=15) as r:
        return json.loads(r.read().decode())


def post_event(e):
    body = {'eventType': e['eventType'], 'userId': e['userId'],
            'bizOrderId': e.get('bizOrderId'), 'deviceId': e.get('deviceId'),
            'ip': e.get('ip'), 'timestamp': e['timestamp'], 'payload': e.get('payload', {})}
    return call('POST', '/api/v1/events', body)['data']


sc = json.load(open(os.path.join(DATA, 'scenarios.json'), encoding='utf-8'))
S1 = sc['scenarios'][0]
DISPOSE_AT = sc['day'] + 'T' + S1['dispose']['at']
ACTORS = set(S1['actors'])
events = sorted((json.loads(l) for l in open(
    os.path.join(DATA, 'events_stream.jsonl'), encoding='utf-8') if l.strip()),
    key=lambda e: e['timestamp'])

stats = {'Pass': 0, 'Review': 0, 'Reject': 0, 'list': 0}
gang_cases, first_reject = [], None
bar = '═' * 74

# ================= 阶段一：处置前回放 =================
print(bar)
print(f"阶段一　回放事件流（{sc['stream']['start']} ~ {S1['dispose']['at']}，处置前）")
print(bar)
for e in events:
    if e['timestamp'] >= DISPOSE_AT:
        break
    d = post_event(e)
    dec, hit = d['decision'], d.get('listHit')
    if hit:
        stats['list'] += 1
        if hit['type'] == '黑名单':
            print(f"[LIST-B] {e['timestamp'][11:19]} {e['userId']} {e['eventType']}"
                  f" │ 命中黑名单（{hit['dim']}）→ Reject")
        continue
    stats[dec['action']] += 1
    if dec['action'] == 'Pass':
        continue
    hits = ' '.join(f"{h['code']}(+{h['score']})" for h in d['ruleHits'])
    cid = d.get('caseId', '')
    print(f"[{dec['action']}] {e['timestamp'][11:19]} {e['userId']} {e['eventType']}"
          f" │ {hits} = {dec['score']}分 → {dec['action']}" + (f"　建档 {cid}" if cid else ''))
    if e['userId'] in ACTORS and cid:
        gang_cases.append(cid)
    if not first_reject and dec['action'] == 'Reject':
        first_reject = d

print(f"\n[摘要] 放行 {stats['Pass']} · 人审 {stats['Review']} · 拦截 {stats['Reject']}"
      f" · 名单命中 {stats['list']}")

if first_reject:
    print('\n[特征快照示例] 首个高危案件 ' + first_reject['event']['userId'] + ' 异常特征：')
    for k, v in first_reject['featureSnapshot'].items():
        if k in ('device_account_cnt_1h', 'ip_register_cnt', 'coupon_cnt_1h',
                 'ua_anomaly', 'ip_idc_flag'):
            print(f'   · {k} = {v}')

# ================= 模拟审核处置 =================
print('\n' + bar)
print(f"模拟审核处置　{S1['dispose']['at']}　{S1['name']}")
print(bar)
print(f"{S1['dispose']['operator']} 对团伙 {len(gang_cases)} 个涉案账号执行「拉黑用户」：")
for cid in gang_cases:
    r = call('POST', f'/api/v1/cases/{cid}/dispose', {
        'conclusion': 'black', 'dims': S1['dispose']['blackDims'],
        'reason': '确认为羊毛党团伙领券行为，证据充分',
        'evidence': '同设备多账号1h内批量领取大额券，命中R003/R007，综合评分超Reject线'
    }, role='auditor')['data']
    print(f"   · 案件 {cid} → {r['conclusion']}　黑名单新增 {r['blackAdded']}")

# ================= 阶段二：处置后回放 =================
print('\n' + bar)
print(f"阶段二　回放处置后事件流（{S1['dispose']['at']} 之后）—— 团伙换号重试")
print(bar)
p2_list, p2_other = 0, 0
for e in events:
    if e['timestamp'] < DISPOSE_AT:
        continue
    d = post_event(e)
    if d.get('listHit') and d['listHit']['type'] == '黑名单':
        stats['list'] += 1
        p2_list += 1
        print(f"[LIST-B] {e['timestamp'][11:19]} {e['userId']} {e['eventType']}"
              f" │ 命中黑名单（{d['listHit']['dim']}）→ Reject ⛔ 名单拦截")
    elif d['decision']['action'] != 'Pass':
        stats[d['decision']['action']] += 1
        p2_other += 1
        hits = ' '.join(f"{h['code']}(+{h['score']})" for h in d['ruleHits'])
        print(f"[{d['decision']['action']}] {e['timestamp'][11:19]} {e['userId']} {e['eventType']}"
              f" │ {hits} = {d['decision']['score']}分 → {d['decision']['action']}")
    else:
        stats['Pass'] += 1

# ================= 汇总 =================
m = call('GET', '/api/v1/metrics/summary')['data']
lists_stats = call('GET', '/api/v1/lists')['data']['stats']
print('\n' + bar)
print('演示汇总')
print(bar)
print(f"事件总量　　　：{m['eventCount']} 条（决策 {m['decisionCount']} 条）")
print(f"决策分布　　　：Pass {stats['Pass']} · Review {stats['Review']} · Reject {stats['Reject']}"
      f" · 名单拦截 {p2_list} · 白名单放行（阶段一）{stats['list'] - p2_list}")
print(f"自动建档案件　：{m['pendingCases'] + stats['Reject'] + stats['Review']} 件关联"
      f"（当前待审 {m['pendingCases']}）")
print(f"名单库　　　　：黑 {lists_stats['黑名单']} / 白 {lists_stats['白名单']} / 灰 {lists_stats['灰名单']}")
print(f"对抗效果　　　：处置后名单直接拦截 {p2_list} 次（规则引擎零耗时）")
print(f"预估挽回资损　：¥ {m['savedAmount']:,.0f}　平均决策耗时 {m['avgElapsedMs']}ms")
