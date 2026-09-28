# ============================================================
# security.py —— 角色鉴权（PRD §2.2 权限矩阵）+ 审计留痕助手
# 演示级鉴权：登录签发 token，业务接口通过 X-Role 头携带角色
# ============================================================
from fastapi import Header, HTTPException

ROLES = {'auditor': '风控审核员', 'strategist': '风控策略师', 'admin': '系统管理员'}
ROLE_NAME = {v: k for k, v in ROLES.items()}


def require_role(*allowed: str):
    """FastAPI 依赖：校验 X-Role 头；未授权返回 403"""

    def checker(x_role: str = Header(default='')):
        if x_role not in ROLES:
            raise HTTPException(status_code=401, detail='未登录或角色无效（需 X-Role 头）')
        if allowed and x_role not in allowed:
            raise HTTPException(status_code=403, detail=f'当前角色无权执行该操作（需 {" / ".join(ROLES[r] for r in allowed)}）')
        return x_role

    return checker


def operator_of(x_role: str) -> str:
    """角色 → 操作人署名（审计留痕用）"""
    return {'auditor': '审核员·李敏', 'strategist': '策略师·陈晨', 'admin': '管理员·admin'}[x_role]


def add_audit(operator: str, role: str, action_type: str, target_type: str,
              target_id: str, content: str, before='', after=''):
    """审计日志（append-only，不可篡改）"""
    from . import db
    from .engine.pipeline import now
    n = db.query_one('SELECT COUNT(*) AS n FROM audit_logs')['n']
    db.execute(
        'INSERT INTO audit_logs(logNo,operator,role,actionType,targetType,targetId,'
        'content,before,after,time) VALUES(?,?,?,?,?,?,?,?,?,?)',
        ('AUD-' + str(90000 + n + 1), operator, ROLES.get(role, role), action_type,
         target_type, target_id, content, str(before), str(after), now()))
