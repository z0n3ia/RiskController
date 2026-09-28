# verify.py —— 后端自检：循环导入修复 + 建库灌种 + 引擎预热（一次性验证脚本）
import sys

sys.path.insert(0, 'backend')

from app import config, db, seed                      # noqa: E402
from app.engine.pipeline import pipeline as engine   # noqa: E402  (模块内单例实例)

db.reset()
print('cfg:', config.get_config())
print('seeded:', seed.seed())
for t in ('users', 'rules', 'list_entries', 'graph_edges'):
    print(t + ':', db.query_one(f'SELECT COUNT(*) AS n FROM {t}')['n'])

users = db.query('SELECT * FROM users')
engine.warmup(users)
print('warmup ok, ip_register entries:', len(engine.features.ip_register))

ev = {'eventId': 'EVT-TEST-1', 'eventType': 'coupon_receive', 'userId': 'U10086',
      'bizOrderId': 'CPN-TEST-1', 'deviceId': 'DEV_9f2a1c81e', 'ip': '112.74.103.55',
      'timestamp': '2026-09-27T10:21:33', 'payload': {'couponId': 'CPN_L50', 'amount': 50}}
d = engine.decide(ev)
print('decide:', d['decision'], '| hits:', [(h['code'], h['score']) for h in d['ruleHits']],
      '| case:', d.get('caseId'))
print('VERIFY_OK')
