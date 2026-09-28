# routers/auth.py —— 登录（演示级：校验非空即签发，角色由前端选择）
from fastapi import APIRouter

from ..models import LoginIn
from ..security import ROLES, add_audit

router = APIRouter(prefix='/api/v1/auth', tags=['auth'])


@router.post('/login')
def login(body: LoginIn):
    if body.role not in ROLES:
        return {'code': 400, 'msg': '未知角色'}
    add_audit(body.account, body.role, '登录', 'none', '—', f'登录成功（角色 {ROLES[body.role]}）')
    return {'code': 0, 'data': {'token': 'demo-token-' + body.role, 'role': body.role,
                                'roleName': ROLES[body.role], 'account': body.account}}
