# check_adapter.py —— 适配层字段映射验证（后端补丁 + 新端点）
import json
import urllib.parse
import urllib.request

BASE = 'http://127.0.0.1:8642'
PASS, FAIL = [], []


def call(method, path, body=None, role='admin'):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header('Content-Type', 'application/json')
    if role:
        req.add_header('X-Role', role)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=10) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {'_http': e.code}


def check(name, cond, detail=''):
    (PASS if cond else FAIL).append(name)
    print(('PASS' if cond else 'FAIL'), name, detail)


# 1. metrics.pendingHigh
m = call('GET', '/api/v1/metrics/summary')['data']
check('metrics.pendingHigh', 'pendingHigh' in m, f"值={m.get('pendingHigh')}")

# 2. cases.list 含 hits
cs = call('GET', '/api/v1/cases?size=3')['data']['list']
has_hits = all('hits' in c for c in cs) and any(c['hits'] for c in cs)
check('cases.list.hits', has_hits, f"首条hits={[h['code'] for h in cs[0]['hits']]}")

# 3. cases.detail snapshotRows 含 thresholds
cid = cs[0]['caseId']
d = call('GET', '/api/v1/cases/' + cid)['data']
th = d['snapshotRows'][0].get('thresholds')
check('cases.detail.thresholds', isinstance(th, list) and any(r.get('thresholds') for r in d['snapshotRows']),
      f"示例={next((r['thresholds'] for r in d['snapshotRows'] if r['thresholds']), '无')}")

# 4. features snapshot 新端点
f = call('GET', '/api/v1/features/U10086/snapshot')['data']
check('features.snapshot', f['userId'] == 'U10086' and len(f['snapshot']) >= 10
      and all('thresholds' in r for r in f['snapshot']), f"rows={len(f['snapshot'])}")

# 5. events/recent 滚屏数据源
r = call('GET', '/api/v1/events/recent?limit=5')['data']
check('events.recent', len(r) == 5 and all(
    {'decisionId', 'time', 'user', 'type', 'action', 'score'} <= set(x.keys()) for x in r),
    f"首条={r[0]['user']}/{r[0]['eventType'] if 'eventType' in r[0] else r[0]['type']}/{r[0]['action']}")

# 6. 名单按值删除（先加后删）
call('POST', '/api/v1/lists', {'listType': '灰名单', 'dim': '用户', 'values': ['U99999'], 'reason': '适配验证'}, 'strategist')
del_r = call('DELETE', '/api/v1/lists?dim=' + urllib.parse.quote('用户') + '&value=U99999', None, 'strategist')
check('lists.delete-by-value', del_r.get('data') is True, str(del_r))

print(f"\n===== {len(PASS)} passed, {len(FAIL)} failed =====")
raise SystemExit(1 if FAIL else 0)
