# routers/audit.py —— 审计日志查询（append-only；策略师仅可见策略变更部分）
from fastapi import APIRouter, Depends

from .. import db
from ..security import require_role

router = APIRouter(prefix='/api/v1/audit-logs', tags=['audit'])


@router.get('')
def list_logs(type: str = '', operator: str = '', kw: str = '',
              page: int = 1, size: int = 10, x_role: str = Depends(require_role('strategist', 'admin'))):
    """按操作类型/操作人/关键词检索；策略师仅可见 规则变更+名单变更（PRD §2.2 权限矩阵）"""
    sql, params = 'SELECT * FROM audit_logs WHERE 1=1', []
    if x_role == 'strategist':
        sql += " AND actionType IN ('规则变更','名单变更')"
    if type:
        sql += ' AND actionType = ?'; params.append(type)
    if operator:
        sql += ' AND operator = ?'; params.append(operator)
    if kw:
        sql += ' AND (content LIKE ? OR targetId LIKE ?)'; params += [f'%{kw}%', f'%{kw}%']
    total = db.query_one(f'SELECT COUNT(*) AS n FROM ({sql})', params)['n']
    rows = db.query(sql + ' ORDER BY logId DESC LIMIT ? OFFSET ?', params + [size, (page - 1) * size])
    return {'code': 0, 'data': {'list': rows, 'total': total}}
