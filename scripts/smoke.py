# smoke.py —— 后端全接口冒烟测试（鉴权/事件/案件/规则/名单/图谱/指标/审计/仿真/配置）
import json
import urllib.parse
import urllib.request

BASE = 'http://127.0.0.1:8642'
PASS, FAIL = [], []


def call(method, path, body=None, role=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header('Content-Type', 'application/json')
    if role:
        req.add_header('X-Role', role)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=10) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}')


def check(name, cond, detail=''):
    (PASS if cond else FAIL).append(name)
    print(('PASS' if cond else 'FAIL'), name, detail)


# 1. 健康 + 登录
s, r = call('GET', '/api/v1/health')
check('health', s == 200 and r['data']['status'] == 'UP')
s, r = call('POST', '/api/v1/auth/login', {'account': 'admin@riskguard.cn', 'password': 'demo123456', 'role': 'admin'})
check('login', s == 200 and r['data']['role'] == 'admin')

# 2. 规则 CRUD（策略师）
s, r = call('GET', '/api/v1/rules', role='strategist')
n0 = len(r['data'])
check('rules.list', s == 200 and n0 >= 9, f'n={n0}')
s, r = call('POST', '/api/v1/rules', {
    'name': '冒烟测试规则', 'scene': 'coupon_receive', 'score': 30,
    'expr': {'op': 'AND', 'children': [{'field': 'coupon_cnt_1h', 'op': '>=', 'value': 2}]},
    'reasonTpl': '近1h领券{coupon_cnt_1h}次'}, role='strategist')
code = r['data']['code']
check('rules.create', s == 200 and code, f'code={code}')
s, r = call('POST', '/api/v1/rules', {'name': 'x', 'scene': '通用', 'score': 10, 'expr': {}}, role='auditor')
check('rules.create 403(auditor)', s == 403)
s, r = call('PATCH', f'/api/v1/rules/{code}/toggle', {'enabled': True}, role='strategist')
check('rules.toggle', s == 200 and r['data']['enabled'] is True)
s, r = call('DELETE', f'/api/v1/rules/{code}', role='strategist')
check('rules.delete', s == 200)

# 3. 名单库（策略师）
s, r = call('GET', '/api/v1/lists', role='strategist')
check('lists.list', s == 200 and r['data']['stats']['黑名单'] >= 3)
s, r = call('POST', '/api/v1/lists', {'listType': '灰名单', 'dim': '用户', 'values': ['U07777'], 'reason': '冒烟测试'}, role='strategist')
check('lists.add', s == 200 and r['data']['added'] == 1)
lid = [x['id'] for x in call('GET', '/api/v1/lists?dim=' + urllib.parse.quote('用户') + '&kw=U07777', role='strategist')[1]['data']['list']]
s, r = call('DELETE', f'/api/v1/lists/{lid[0]}', role='strategist')
check('lists.remove', s == 200)

# 4. 图谱
s, r = call('GET', '/api/v1/graph/user/U10086?depth=2', role='auditor')
check('graph', s == 200 and len(r['data']['nodes']) >= 2 and len(r['data']['edges']) >= 1,
      f"nodes={len(r['data']['nodes'])} edges={len(r['data']['edges'])}")

# 5. 事件决策（冷启动：静态特征 → R007+R018=50 Pass；回放阶段再验证完整链路）
s, r = call('POST', '/api/v1/events', {
    'eventType': 'coupon_receive', 'userId': 'U05123', 'bizOrderId': 'CPN-SM-1',
    'payload': {'couponId': 'CPN_L5', 'amount': 5}}, role='admin')
check('events.decide(normal)', s == 200 and r['data']['decision']['action'] == 'Pass',
      f"score={r['data']['decision']['score']}")

# 6. 案件：滑动窗口特征需累积 —— 3 笔同地址订单铺垫 + 3 笔高额退款（第3笔触发 R021+R023=60 → Review）
for i in range(3):
    call('POST', '/api/v1/events', {
        'eventType': 'order_create', 'userId': 'U09912', 'bizOrderId': f'ORD-SM-{i}',
        'payload': {'skuId': 'SKU_1', 'qty': 1, 'amount': 1688}}, role='admin')
cid = None
last_action = ''
for i in range(3):
    s, r = call('POST', '/api/v1/events', {
        'eventType': 'after_sale_apply', 'userId': 'U09912', 'bizOrderId': f'REF-SM-{i}',
        'payload': {'refundAmount': 1688, 'reason': '未收到货'}}, role='admin')
    last_action = r['data']['decision']['action']
    if r['data'].get('caseId'):
        cid = r['data']['caseId']
check('events.decide(fraud)->case', cid is not None, f'last_action={last_action} case={cid}')
s, r = call('GET', f'/api/v1/cases/{cid}', role='auditor')
check('cases.detail', s == 200 and r['data']['case']['caseId'] == cid and len(r['data']['snapshotRows']) >= 10)
s, r = call('POST', f'/api/v1/cases/{cid}/dispose',
            {'conclusion': 'black', 'dims': ['user', 'device'], 'reason': '冒烟测试：确认为退款欺诈',
             'evidence': '24h内4次高额退款，命中R021/R023'}, role='auditor')
check('cases.dispose(black)', s == 200 and len(r['data']['blackAdded']) == 2)
s, r = call('POST', '/api/v1/events', {
    'eventType': 'after_sale_apply', 'userId': 'U09912', 'bizOrderId': 'REF-SM-2',
    'payload': {'refundAmount': 1688}}, role='admin')
check('blacklist.intercept', s == 200 and r['data']['listHit'] and r['data']['listHit']['type'] == '黑名单',
      f"hit={r['data']['listHit']}")
s, r = call('POST', f'/api/v1/cases/{cid}/dispose', {'conclusion': 'pass', 'reason': 'x', 'evidence': 'y'}, role='strategist')
check('cases.dispose 403(strategist)', s == 403)

# 7. 仿真（不落库）
n_before = call('GET', '/api/v1/metrics/summary', role='admin')[1]['data']['decisionCount']
s, r = call('POST', '/api/v1/simulate', {'eventType': 'coupon_receive', 'userId': 'U10086'}, role='strategist')
n_after = call('GET', '/api/v1/metrics/summary', role='admin')[1]['data']['decisionCount']
check('simulate.no-persist', s == 200 and r['data']['verdict'] and n_before == n_after,
      f"verdict={r['data']['verdict'].get('action')}")

# 8. 指标 + 审计 + 配置
s, r = call('GET', '/api/v1/metrics/summary', role='admin')
d = r['data']
check('metrics.summary', s == 200 and d['eventCount'] >= 4 and d['ruleRanking'], f"events={d['eventCount']} reject={d['decisionDist']['Reject']}")
s, r = call('GET', '/api/v1/audit-logs', role='admin')
types = {x['actionType'] for x in r['data']['list']}
check('audit.admin', s == 200 and '案件处置' in types and '名单变更' in types, f'types={sorted(types)}')
s, r = call('GET', '/api/v1/audit-logs', role='strategist')
types_s = {x['actionType'] for x in r['data']['list']}
check('audit.strategist scope', s == 200 and types_s <= {'规则变更', '名单变更'}, f'types={sorted(types_s)}')
s, r = call('GET', '/api/v1/config', role='admin')
check('config.get', s == 200 and r['data']['reviewLine'] == 60)
s, r = call('PUT', '/api/v1/config', {'reviewLine': 65}, role='admin')
check('config.put', s == 200 and r['data']['reviewLine'] == 65)
call('PUT', '/api/v1/config', {'reviewLine': 60}, role='admin')  # 还原
s, r = call('PUT', '/api/v1/config', {'reviewLine': 65}, role='strategist')
check('config.put 403(strategist)', s == 403)

print(f"\n===== SUMMARY: {len(PASS)} passed, {len(FAIL)} failed =====")
if FAIL:
    print('FAILED:', FAIL)
    raise SystemExit(1)
