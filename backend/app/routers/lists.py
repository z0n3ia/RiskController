# routers/lists.py —— 名单库（PRD §6 策略与名单模块：黑白灰维护 + 批量导入）
from fastapi import APIRouter, Depends, HTTPException

from .. import db
from ..engine.pipeline import pipeline, now
from ..models import ListBatchIn
from ..security import add_audit, operator_of, require_role

router = APIRouter(prefix='/api/v1/lists', tags=['lists'])

LIST_TYPES = ('黑名单', '白名单', '灰名单')
DIMS = ('用户', '手机号', 'IP', '设备', '地址')


@router.get('')
def list_entries(listType: str = '', dim: str = '', kw: str = '', x_role: str = Depends(require_role())):
    sql, params = 'SELECT * FROM list_entries WHERE 1=1', []
    if listType:
        sql += ' AND listType = ?'; params.append(listType)
    if dim:
        sql += ' AND dim = ?'; params.append(dim)
    if kw:
        sql += ' AND value LIKE ?'; params.append(f'%{kw}%')
    rows = db.query(sql + ' ORDER BY id DESC', params)
    stats = {t: db.query_one('SELECT COUNT(*) AS n FROM list_entries WHERE listType=?', (t,))['n']
             for t in LIST_TYPES}
    return {'code': 0, 'data': {'list': rows, 'stats': stats}}


@router.post('')
def add_lists(body: ListBatchIn, x_role: str = Depends(require_role('strategist'))):
    """批量添加：同一实体同一维度仅属一种名单类型（后写覆盖并留痕）"""
    if body.listType not in LIST_TYPES:
        raise HTTPException(400, f'名单类型必须是 {" / ".join(LIST_TYPES)}')
    if body.dim not in DIMS:
        raise HTTPException(400, f'维度必须是 {" / ".join(DIMS)}')
    operator = operator_of(x_role)
    added, covered = [], []
    for v in body.values:
        v = v.strip()
        if not v:
            continue
        old = db.query_one('SELECT * FROM list_entries WHERE dim=? AND value=?', (body.dim, v))
        if old and old['listType'] != body.listType:
            covered.append(v)
        if old:
            db.execute('DELETE FROM list_entries WHERE id=?', (old['id'],))
        db.execute('INSERT INTO list_entries(listType,dim,value,reason,operator,time)'
                   ' VALUES(?,?,?,?,?,?)',
                   (body.listType, body.dim, v, body.reason, operator, now()))
        added.append(v)
    pipeline.invalidate()
    if added:
        add_audit(operator, x_role, '名单变更', 'list', added[0],
                  f'{body.listType}新增（维度={body.dim}）：{", ".join(added)}'
                  + (f'；覆盖原记录：{", ".join(covered)}' if covered else ''))
    return {'code': 0, 'data': {'added': len(added), 'covered': covered}}


@router.delete('')
def remove_entry_by_value(dim: str = '', value: str = '', x_role: str = Depends(require_role('strategist'))):
    """按 维度+实体值 删除（前端工作台处置联动/名单库移出均以此定位）"""
    if not dim or not value:
        raise HTTPException(400, '需提供 dim 与 value')
    old = db.query_one('SELECT * FROM list_entries WHERE dim=? AND value=?', (dim, value))
    if not old:
        raise HTTPException(404, '名单记录不存在')
    db.execute('DELETE FROM list_entries WHERE id=?', (old['id'],))
    pipeline.invalidate()
    add_audit(operator_of(x_role), x_role, '名单变更', 'list', old['value'],
              f'{old["value"]} 移出{old["listType"]}（维度={old["dim"]}）',
              before=old['listType'], after='')
    return {'code': 0, 'data': True}


@router.delete('/{entry_id}')
def remove_entry(entry_id: int, x_role: str = Depends(require_role('strategist'))):
    old = db.query_one('SELECT * FROM list_entries WHERE id=?', (entry_id,))
    if not old:
        raise HTTPException(404, '名单记录不存在')
    db.execute('DELETE FROM list_entries WHERE id=?', (entry_id,))
    pipeline.invalidate()
    add_audit(operator_of(x_role), x_role, '名单变更', 'list', old['value'],
              f'{old["value"]} 移出{old["listType"]}（维度={old["dim"]}）',
              before=old['listType'], after='')
    return {'code': 0, 'data': True}
