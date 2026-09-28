# diag_fraud.py —— 诊断 U09912 退款事件为何不再产生案件
import json
import urllib.request

BASE = 'http://127.0.0.1:8642'


def call(method, path, body=None, role='admin'):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header('Content-Type', 'application/json')
    req.add_header('X-Role', role)
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(req, data=data, timeout=10) as r:
        return json.loads(r.read().decode())


snap = call('GET', '/api/v1/features/U09912/snapshot')['data']
for row in snap['snapshot']:
    if row['key'] in ('refund_cnt_24h', 'refund_amount', 'addr_order_cnt_24h', 'account_age_d'):
        print(row['key'], '=', row['value'], '| status:', row['status'])

d = call('POST', '/api/v1/events', {
    'eventType': 'after_sale_apply', 'userId': 'U09912', 'bizOrderId': 'REF-DIAG-1',
    'payload': {'refundAmount': 1688, 'reason': '未收到货'}})['data']
print('action:', d['decision'], '| caseId:', d.get('caseId'))
print('hits:', [(h['code'], h['score'], h['reason']) for h in d['ruleHits']])
fs = d['featureSnapshot'] or {}
print('features:', {k: fs.get(k) for k in ('refund_cnt_24h', 'refund_amount', 'addr_order_cnt_24h')})
