# ============================================================
# engine/pipeline.py —— 决策流水线（PRD §3.1 实时交易风控检测流程）
# 网关校验 → ①黑白名单 → ②特征快照 → ③规则命中 → ④综合仲裁
# 全量特征快照与命中记录异步持久化（SQLite），主链路毫秒级返回
# ============================================================
import json
from datetime import datetime

from .. import db
from .features import FeatureEngine
from .rules import RuleEngine


def now() -> str:
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def _seq(table: str, prefix: str, width: int = 4) -> str:
    row = db.query_one(f'SELECT COUNT(*) AS n FROM {table}')
    return f"{prefix}{row['n'] + 1:0{width}d}"


class DecisionPipeline:
    def __init__(self):
        self.features = FeatureEngine()
        self.rules = RuleEngine()
        self.list_cache = []          # 名单缓存：规则/名单变更后 invalidate
        self._cache_dirty = True

    # ---------------- 预热 ----------------
    def warmup(self, users: list):
        """启动预热：加载画像静态特征；重建滑动窗口（回放事件流水）；刷新规则缓存
        （规则引擎在 import 时空表初始化，种子灌入后必须 reload 才能生效）"""
        self.features.load_users(users)
        self.rules.reload()
        for ev in db.query('SELECT * FROM events ORDER BY timestamp'):
            payload = json.loads(ev['payload'] or '{}')
            t = int(datetime.fromisoformat(ev['timestamp']).timestamp() * 1000)
            self.features.update({
                'userId': ev['userId'], 'eventType': ev['eventType'],
                'deviceId': ev['deviceId'], 'bizOrderId': ev['bizOrderId'],
                'payload': payload
            }, t)
        self.invalidate()

    def invalidate(self):
        self._cache_dirty = True

    def _lists(self) -> list:
        if self._cache_dirty:
            self.list_cache = db.query('SELECT * FROM list_entries')
            self._cache_dirty = False
        return self.list_cache

    # ---------------- ① 名单快速过滤 ----------------
    def _list_hit(self, event: dict):
        dims = {'用户': event['userId'], '设备': event['deviceId'], 'IP': event['ip']}
        for e in self._lists():
            if e['listType'] == '黑名单' and dims.get(e['dim']) == e['value']:
                return {'type': '黑名单', 'dim': e['dim'], 'value': e['value']}
        for e in self._lists():
            if e['listType'] == '白名单' and e['dim'] == '用户' and e['value'] == event['userId']:
                return {'type': '白名单', 'dim': '用户', 'value': event['userId']}
        return None

    # ---------------- 主链路 ----------------
    def decide(self, event: dict, persist: bool = True) -> dict:
        t0 = datetime.now()
        t = int(datetime.fromisoformat(event['timestamp']).timestamp() * 1000)

        hit = self._list_hit(event)
        feats = None
        hits, score, action = [], 0, 'Pass'
        if not hit:
            # ② 特征快照（滑动窗口）
            feats = self.features.compute(event, t)
            # ③ 规则命中链路 + ④ 仲裁
            hits = self.rules.hit_rules(event['eventType'], feats)
            score = min(100, sum(h['score'] for h in hits))
            action, _ = self.rules.arbitrate(score)
            self.features.update(event, t)  # 窗口推进（含被拦截事件）
        else:
            self.features.update(event, t)

        amount = float((event.get('payload') or {}).get('amount')
                       or (event.get('payload') or {}).get('refundAmount') or 0)
        elapsed = round((datetime.now() - t0).total_seconds() * 1000, 2)

        result = {
            'event': {k: event.get(k) for k in
                      ('eventId', 'eventType', 'userId', 'bizOrderId', 'deviceId', 'ip', 'timestamp')},
            'decision': {'score': score, 'riskLevel': self._risk_level(action), 'action': action},
            'ruleHits': hits,
            'featureSnapshot': feats,
            'listHit': hit,
            'elapsedMs': elapsed
        }

        if persist:
            self._persist(event, result, amount)
        return result

    @staticmethod
    def _risk_level(action: str) -> str:
        return {'Reject': '高风险', 'Review': '中风险', 'Pass': '低风险'}[action]

    # ---------------- 持久化（异步语义：不阻塞决策返回） ----------------
    def _persist(self, event: dict, result: dict, amount: float):
        feats = result['featureSnapshot'] or {}
        db.execute(
            'INSERT INTO feature_snapshots(eventId, userId, features, degraded, createTime) VALUES(?,?,?,?,?)',
            (event['eventId'], event['userId'], json.dumps(feats, ensure_ascii=False),
             1 if feats.get('_degraded') else 0, now()))
        decisionNo = 'DEC-' + _seq('decisions', 'D', 6)
        db.execute(
            'INSERT INTO decisions(decisionNo, eventId, userId, eventType, score, riskLevel, action,'
            ' ruleHits, listHit, features, amount, elapsedMs, createTime) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (decisionNo, event['eventId'], event['userId'], event['eventType'],
             result['decision']['score'], result['decision']['riskLevel'], result['decision']['action'],
             json.dumps(result['ruleHits'], ensure_ascii=False),
             json.dumps(result['listHit'], ensure_ascii=False),
             json.dumps(feats, ensure_ascii=False), amount, result['elapsedMs'], now()))
        # 中高风险自动创建案件（PRD §2.3.4）
        if result['decision']['action'] in ('Review', 'Reject'):
            caseId = 'CASE-' + now()[:10].replace('-', '') + '-' + _seq('cases', '', 4)
            db.execute(
                'INSERT INTO cases(caseId, eventId, userId, eventType, riskLevel, scene, score,'
                ' status, assignee, createTime) VALUES(?,?,?,?,?,?,?,?,?,?)',
                (caseId, event['eventId'], event['userId'], event['eventType'],
                 result['decision']['riskLevel'], event['eventType'], result['decision']['score'],
                 '待审', '—', now()))
            result['caseId'] = caseId

    # ---------------- 仿真（不产生真实案件、不写业务状态） ----------------
    def simulate(self, event: dict) -> dict:
        t0 = datetime.now()
        t = int(datetime.fromisoformat(event['timestamp']).timestamp() * 1000)
        hit = self._list_hit(event)
        trace = {'list': None, 'features': None, 'ruleHits': None, 'verdict': None}
        if hit:
            trace['list'] = f"黑名单：命中 ✅ → 直接 {'Reject（名单拦截）' if hit['type'] == '黑名单' else 'Pass（白名单放行）'}"
            action = 'Reject' if hit['type'] == '黑名单' else 'Pass'
            trace['verdict'] = {'score': 100 if action == 'Reject' else 0, 'action': action}
        else:
            trace['list'] = '黑名单：未命中　|　白名单：未命中 → 进入规则决策'
            feats = self.features.compute(event, t)   # 只读，不推进窗口
            trace['features'] = self.features.snapshot(feats)
            hits = self.rules.hit_rules(event['eventType'], feats)
            score = min(100, sum(h['score'] for h in hits))
            action, desc = self.rules.arbitrate(score)
            trace['ruleHits'] = hits
            trace['verdict'] = {'score': score, 'action': action, 'desc': desc}
        trace['elapsedMs'] = round((datetime.now() - t0).total_seconds() * 1000, 2)
        return trace


# 全局单例（main.py 启动时预热）
pipeline = DecisionPipeline()
