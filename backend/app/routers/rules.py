# routers/rules.py —— 策略与规则（PRD §6：规则 CRUD/启停，变更记审计，即时生效）
import json

from fastapi import APIRouter, Depends, HTTPException

from .. import db
from ..engine.pipeline import pipeline, now
from ..engine.rules import expr_to_str
from ..models import RuleIn, RuleToggleIn
from ..security import add_audit, operator_of, require_role

router = APIRouter(prefix='/api/v1/rules', tags=['rules'])


def _row(r):
    return {**r, 'expr': json.loads(r['expr']), 'enabled': bool(r['enabled']),
            'exprText': expr_to_str(json.loads(r['expr']))}


@router.get('')
def list_rules(scene: str = '', enabled: str = '', kw: str = '', x_role: str = Depends(require_role())):
    sql, params = 'SELECT * FROM rules WHERE 1=1', []
    if scene:
        sql += ' AND scene = ?'; params.append(scene)
    if enabled != '':
        sql += ' AND enabled = ?'; params.append(int(enabled == '1' or enabled == 'true'))
    if kw:
        sql += ' AND (code LIKE ? OR name LIKE ?)'; params += [f'%{kw}%', f'%{kw}%']
    rows = db.query(sql + ' ORDER BY code', params)
    return {'code': 0, 'data': [_row(r) for r in rows]}


def _next_code() -> str:
    n = db.query_one("SELECT COUNT(*) AS n FROM rules WHERE code GLOB 'R[0-9][0-9]'")['n']
    return f'R{27 + n:02d}'


@router.post('')
def create_rule(body: RuleIn, x_role: str = Depends(require_role('strategist'))):
    """新建规则：默认停用，需仿真验证后开启（PRD §3.3）"""
    code = body.code or _next_code()
    if db.query_one('SELECT 1 FROM rules WHERE code=?', (code,)):
        raise HTTPException(400, f'规则编码 {code} 已存在')
    operator = operator_of(x_role)
    db.execute('INSERT INTO rules(code,name,scene,expr,score,enabled,reasonTpl,creator,updateTime)'
               ' VALUES(?,?,?,?,?,?,?,?,?)',
               (code, body.name, body.scene, json.dumps(body.expr, ensure_ascii=False),
                body.score, 0, body.reasonTpl, operator, now()))
    pipeline.rules.reload()
    add_audit(operator, x_role, '规则变更', 'rule', code,
              f'新增规则 {code}（{body.name}，分值{body.score}），初始状态=停用')
    return {'code': 0, 'data': {'code': code, 'enabled': False}}


@router.put('/{code}')
def update_rule(code: str, body: RuleIn, x_role: str = Depends(require_role('strategist'))):
    old = db.query_one('SELECT * FROM rules WHERE code=?', (code,))
    if not old:
        raise HTTPException(404, '规则不存在')
    operator = operator_of(x_role)
    db.execute('UPDATE rules SET name=?,scene=?,expr=?,score=?,enabled=?,reasonTpl=?,updateTime=?'
               ' WHERE code=?',
               (body.name, body.scene, json.dumps(body.expr, ensure_ascii=False), body.score,
                int(body.enabled), body.reasonTpl, now(), code))
    pipeline.rules.reload()
    add_audit(operator, x_role, '规则变更', 'rule', code,
              f'编辑规则 {code}（{body.name}，分值{old["score"]}→{body.score}，'
              f'状态={"启用" if body.enabled else "停用"}）',
              before={'score': old['score']}, after={'score': body.score})
    return {'code': 0, 'data': {'code': code}}


@router.patch('/{code}/toggle')
def toggle_rule(code: str, body: RuleToggleIn, x_role: str = Depends(require_role('strategist'))):
    old = db.query_one('SELECT * FROM rules WHERE code=?', (code,))
    if not old:
        raise HTTPException(404, '规则不存在')
    operator = operator_of(x_role)
    db.execute('UPDATE rules SET enabled=?, updateTime=? WHERE code=?',
               (int(body.enabled), now(), code))
    pipeline.rules.reload()
    add_audit(operator, x_role, '规则变更', 'rule', code,
              f'规则 {code} {"启用" if body.enabled else "停用"}',
              before=bool(old['enabled']), after=body.enabled)
    return {'code': 0, 'data': {'code': code, 'enabled': body.enabled}}


@router.delete('/{code}')
def delete_rule(code: str, x_role: str = Depends(require_role('strategist'))):
    old = db.query_one('SELECT * FROM rules WHERE code=?', (code,))
    if not old:
        raise HTTPException(404, '规则不存在')
    db.execute('DELETE FROM rules WHERE code=?', (code,))
    pipeline.rules.reload()
    add_audit(operator_of(x_role), x_role, '规则变更', 'rule', code,
              f'删除规则 {code}（{old["name"]}）', before=old['name'], after='')
    return {'code': 0, 'data': True}
