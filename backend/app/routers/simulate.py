# routers/simulate.py —— 事件仿真测试（PRD §6 仿真测试模块：不产生真实案件、不写业务状态）
from fastapi import APIRouter, Depends, HTTPException

from ..engine.pipeline import pipeline, now
from ..models import SimulateIn
from ..security import require_role

router = APIRouter(prefix='/api/v1/simulate', tags=['simulate'])

EVENT_TYPES = ('login', 'coupon_receive', 'order_create', 'order_pay', 'after_sale_apply')


@router.post('')
def simulate(body: SimulateIn, x_role: str = Depends(require_role())):
    if body.eventType not in EVENT_TYPES:
        raise HTTPException(400, f'未知事件类型：{body.eventType}')
    if not body.userId:
        raise HTTPException(400, '缺少用户编号 userId')
    user = pipeline.features.users.get(body.userId)
    event = {
        'eventId': 'SIM-' + now().replace(' ', 'T'),
        'eventType': body.eventType, 'userId': body.userId,
        'bizOrderId': 'SIM-TEST', 'deviceId': (user or {}).get('device', 'DEV_unknown'),
        'ip': (user or {}).get('ip', '0.0.0.0'),
        'timestamp': body.timestamp or now(), 'payload': body.payload
    }
    trace = pipeline.simulate(event)
    return {'code': 0, 'data': trace}
