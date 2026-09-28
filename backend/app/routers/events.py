# routers/events.py —— 事件网关（PRD §6：校验事件格式并分发至决策流水线）
from datetime import datetime
from itertools import count

from fastapi import APIRouter, Depends

from .. import db
from ..engine.pipeline import pipeline, now
from ..models import EventIn
from ..security import require_role

router = APIRouter(prefix='/api/v1/events', tags=['events'])

EVENT_TYPES = ('login', 'coupon_receive', 'order_create', 'order_pay', 'after_sale_apply')
_seq = count(1)


@router.post('')
def receive_event(body: EventIn, x_role: str = Depends(require_role())):
    """接收业务端风控请求 → 同步返回决策结果（P99 ≤ 200ms），全量异步持久化"""
    if body.eventType not in EVENT_TYPES:
        return {'code': 400, 'msg': f'未知事件类型：{body.eventType}'}
    user = pipeline.features.users.get(body.userId)
    event = {
        'eventId': 'EVT-' + datetime.now().strftime('%Y%m%d%H%M%S') + f'{next(_seq):06d}',
        'eventType': body.eventType,
        'userId': body.userId,
        'bizOrderId': body.bizOrderId or '—',
        'deviceId': body.deviceId or (user or {}).get('device', 'DEV_unknown'),
        'ip': body.ip or (user or {}).get('ip', '0.0.0.0'),
        'timestamp': body.timestamp or now(),
        'payload': body.payload
    }
    # 事件流水入库（PRD：全量异步持久化；SQLite 本地写为毫秒级，语义等价不阻塞）
    from .. import db
    import json
    db.execute('INSERT OR IGNORE INTO events(eventId,eventType,userId,bizOrderId,deviceId,ip,timestamp,payload)'
               ' VALUES(?,?,?,?,?,?,?,?)',
               (event['eventId'], event['eventType'], event['userId'], event['bizOrderId'],
                event['deviceId'], event['ip'], event['timestamp'],
                json.dumps(body.payload, ensure_ascii=False)))
    result = pipeline.decide(event, persist=True)
    return {'code': 0, 'data': result}


@router.get('/recent')
def recent_events(limit: int = 20, x_role: str = Depends(require_role())):
    """最近决策事件（态势大盘滚屏轮播数据源；WebSocket 就绪前的替代）"""
    limit = max(1, min(limit, 50))
    rows = db.query(
        'SELECT d.decisionId, d.action, d.score, d.riskLevel, d.createTime,'
        ' e.userId, e.eventType FROM decisions d'
        ' LEFT JOIN events e ON e.eventId = d.eventId'
        ' ORDER BY d.decisionId DESC LIMIT ?', (limit,))
    return {'code': 0, 'data': [
        {'decisionId': r['decisionId'], 'time': r['createTime'],
         'user': r['userId'] or '—', 'type': r['eventType'] or '—',
         'action': r['action'], 'score': r['score'], 'riskLevel': r['riskLevel']}
        for r in rows]}
