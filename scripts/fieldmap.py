# fieldmap.py —— 抓取后端各接口实际返回的字段名（字段映射核对基准）
import json
import urllib.request

BASE = 'http://127.0.0.1:8642'


def call(method, path, body=None, role='admin'):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header('Content-Type', 'application/json')
    req.add_header('X-Role', role)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=10) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {'_http': e.code}


def keys(x, depth=1):
    if isinstance(x, list) and x:
        return keys(x[0], depth)
    if isinstance(x, dict):
        return sorted(x.keys())
    return type(x).__name__


print('login        :', keys(call('POST', '/api/v1/auth/login',
      {'account': 'a@b.c', 'password': 'demo123456', 'role': 'admin'})['data']))

# 造一个 Reject 事件确保案件存在（团伙第4次领券触发 R003+R012）
for i in range(4):
    ev = call('POST', '/api/v1/events', {
        'eventType': 'coupon_receive', 'userId': 'U10086', 'bizOrderId': 'CPN-FM-%d' % i,
        'deviceId': 'DEV_9f2a1c81e', 'ip': '112.74.103.55',
        'timestamp': '2026-09-27T11:%02d:00' % (10 + i), 'payload': {'couponId': 'CPN_L50', 'amount': 50}})
evd = ev['data']
print('events       :', keys(evd))
print('  decision   :', keys(evd['decision']))
print('  ruleHit    :', keys(evd['ruleHits'][0]) if evd['ruleHits'] else '[]')
print('  featureSnap:', keys(evd['featureSnapshot']))

cases = call('GET', '/api/v1/cases?size=1')['data']
print('cases.list   :', keys(cases))
print('  item       :', keys(cases['list'][0]))
cid = cases['list'][0]['caseId']

d = call('GET', '/api/v1/cases/' + cid)['data']
print('cases.detail :', keys(d))
print('  case       :', keys(d['case']))
print('  profile    :', keys(d['profile']))
print('  snapshotRow:', keys(d['snapshotRows'][0]))
print('  decision   :', keys(d['decision']))
print('  event      :', keys(d['event']))

s = call('POST', '/api/v1/simulate', {'eventType': 'coupon_receive', 'userId': 'U10086'})['data']
print('simulate     :', keys(s))
print('  verdict    :', keys(s['verdict']))
print('  featureRow :', keys(s['features'][0]) if s['features'] else 'None')

print('rules.item   :', keys(call('GET', '/api/v1/rules')['data']))
print('lists        :', keys(call('GET', '/api/v1/lists')['data']))
print('  stats      :', keys(call('GET', '/api/v1/lists')['data']['stats']))
print('audit.item   :', keys(call('GET', '/api/v1/audit-logs')['data']['list'][0]))
print('metrics      :', keys(call('GET', '/api/v1/metrics/summary')['data']))
print('config       :', keys(call('GET', '/api/v1/config')['data']))
disp = call('POST', '/api/v1/cases/%s/dispose' % cid,
            {'conclusion': 'black', 'dims': ['user'], 'reason': '字段核对', 'evidence': 'fieldmap'}, 'auditor')
print('dispose      :', keys(disp['data']) if disp.get('data') else disp)
