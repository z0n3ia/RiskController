# routers/config.py —— 运行配置（PRD §2.2：系统运行配置仅系统管理员）
from fastapi import APIRouter, Depends, HTTPException

from ..config import get_config, set_config
from ..models import ConfigIn
from ..security import add_audit, operator_of, require_role

router = APIRouter(prefix='/api/v1/config', tags=['config'])


@router.get('')
def get_cfg(x_role: str = Depends(require_role('admin'))):
    return {'code': 0, 'data': get_config()}


@router.put('')
def put_cfg(body: ConfigIn, x_role: str = Depends(require_role('admin'))):
    old = get_config()
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(400, '无可更新字段')
    if 'reviewLine' in patch and 'rejectLine' in patch and patch['reviewLine'] >= patch['rejectLine']:
        raise HTTPException(400, '阈值无效：需满足 0 ≤ Review线 < Reject线 ≤ 100')
    new = set_config(patch)
    diff = '；'.join(f'{k} {old[k]}→{new[k]}' for k in patch if old.get(k) != new[k])
    if diff:
        add_audit(operator_of(x_role), x_role, '规则变更', 'config', '系统配置',
                  f'运行配置调整：{diff}', before=old, after=new)
    return {'code': 0, 'data': new}
