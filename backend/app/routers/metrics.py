# routers/metrics.py —— 监控与审计模块 · 指标汇总（PRD §6：决策指标统计汇总）
import json

from fastapi import APIRouter, Depends

from .. import db
from ..security import require_role

router = APIRouter(prefix='/api/v1/metrics', tags=['metrics'])


@router.get('/summary')
def summary(x_role: str = Depends(require_role())):
    """态势大盘指标：事件量/拦截率/待审案件/挽回资损/决策分布/规则排行/耗时"""
    total = db.query_one('SELECT COUNT(*) AS n FROM decisions')['n']
    events = db.query_one('SELECT COUNT(*) AS n FROM events')['n']
    rej = db.query_one("SELECT COUNT(*) AS n FROM decisions WHERE action='Reject'")['n']
    rev = db.query_one("SELECT COUNT(*) AS n FROM decisions WHERE action='Review'")['n']
    pending = db.query_one("SELECT COUNT(*) AS n FROM cases WHERE status='待审'")['n']
    pending_high = db.query_one("SELECT COUNT(*) AS n FROM cases WHERE status='待审' AND riskLevel='高风险'")['n']
    saved = db.query_one("SELECT COALESCE(SUM(amount),0) AS s FROM decisions WHERE action='Reject'")['s']
    risk = {r['riskLevel']: r['n'] for r in
            db.query('SELECT riskLevel, COUNT(*) AS n FROM decisions GROUP BY riskLevel')}

    # 规则命中排行（聚合 decisions.ruleHits JSON）
    counter, names = {}, {r['code']: r['name'] for r in db.query('SELECT code, name FROM rules')}
    for r in db.query('SELECT ruleHits FROM decisions'):
        for h in json.loads(r['ruleHits'] or '[]'):
            counter[h['code']] = counter.get(h['code'], 0) + 1
    ranking = sorted(counter.items(), key=lambda x: -x[1])[:6]

    avg_ms = db.query_one('SELECT COALESCE(AVG(elapsedMs),0) AS v FROM decisions')['v']
    return {'code': 0, 'data': {
        'eventCount': events,
        'decisionCount': total,
        'interceptRate': round(rej / total * 100, 1) if total else 0,
        'pendingCases': pending,
        'pendingHigh': pending_high,
        'savedAmount': round(saved, 2),
        'decisionDist': {'Pass': total - rej - rev, 'Review': rev, 'Reject': rej},
        'riskDist': risk,
        'ruleRanking': [{'code': c, 'name': names.get(c, ''), 'hits': n} for c, n in ranking],
        'avgElapsedMs': round(avg_ms, 2)
    }}
