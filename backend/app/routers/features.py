# routers/features.py —— 特征快照接口（PRD §6：GET /api/v1/features/:userId/snapshot）
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from ..engine.features import threshold_map
from ..engine.pipeline import pipeline
from ..security import require_role

router = APIRouter(prefix='/api/v1/features', tags=['features'])


@router.get('/{userId}/snapshot')
def user_snapshot(userId: str, x_role: str = Depends(require_role())):
    """用户当前特征快照（只读，不推进滑动窗口；含历史均值/规则阈值/状态）"""
    u = pipeline.features.users.get(userId)
    if not u:
        raise HTTPException(404, '用户不存在')
    fake = {'eventType': 'login', 'userId': userId, 'bizOrderId': '—',
            'deviceId': u.get('device') or '', 'ip': u.get('ip') or '', 'payload': {}}
    t = int(datetime.now().timestamp() * 1000)
    feats = pipeline.features.compute(fake, t)
    th = threshold_map()
    rows = [{**row, 'thresholds': th.get(row['key'], [])}
            for row in pipeline.features.snapshot(feats)]
    return {'code': 0, 'data': {'userId': userId, 'snapshot': rows, 'degraded': False}}
