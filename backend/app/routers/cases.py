# routers/cases.py —— 案件流转（PRD §6：列表/详情/处置联动 + 审计留痕）
import json

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import db
from ..engine.features import threshold_map
from ..engine.pipeline import pipeline, now
from ..models import DisposeIn
from ..security import add_audit, operator_of, require_role

router = APIRouter(prefix='/api/v1/cases', tags=['cases'])


@router.get('')
def list_cases(level: str = '', scene: str = '', status: str = '', kw: str = '',
               page: int = 1, size: int = 10, x_role: str = Depends(require_role())):
    sql, params = 'SELECT * FROM cases WHERE 1=1', []
    if level:
        sql += ' AND riskLevel = ?'; params.append(level)
    if scene:
        sql += ' AND scene = ?'; params.append(scene)
    if status:
        sql += ' AND status = ?'; params.append(status)
    if kw:
        sql += ' AND (caseId LIKE ? OR userId LIKE ?)'; params += [f'%{kw}%', f'%{kw}%']
    total = db.query_one(f'SELECT COUNT(*) AS n FROM ({sql})', params)['n']
    rows = db.query(sql + ' ORDER BY createTime DESC LIMIT ? OFFSET ?',
                    params + [size, (page - 1) * size])
    # 联查命中规则（工作台列表行的风险 Tag）：一次取本页案件的 ruleHits
    if rows:
        ph = ','.join('?' * len(rows))
        decmap = {d['eventId']: json.loads(d['ruleHits'] or '[]') for d in db.query(
            f'SELECT eventId, ruleHits FROM decisions WHERE eventId IN ({ph})',
            [r['eventId'] for r in rows])}
        rows = [{**r, 'hits': decmap.get(r['eventId'], [])} for r in rows]
    return {'code': 0, 'data': {'list': rows, 'total': total}}


def _profile(uid: str) -> dict:
    u = db.query_one('SELECT * FROM users WHERE userId = ?', (uid,)) or {}
    dev_peers = [r['srcValue'] for r in db.query(
        "SELECT srcValue FROM graph_edges WHERE dstType='device' AND dstValue="
        "(SELECT dstValue FROM graph_edges WHERE srcType='user' AND srcValue=? AND relType='使用设备')"
        " AND relType='使用设备' AND srcValue != ?", (uid, uid))]
    ip_peers = [r['dstValue'] for r in db.query(
        "SELECT dstValue FROM graph_edges WHERE srcType='user' AND relType='同IP' AND srcValue=?", (uid,))]
    return {**u, 'tags': json.loads(u.get('tags') or '[]'),
            'devicePeers': dev_peers, 'ipPeers': ip_peers}


@router.get('/{case_id}')
def case_detail(case_id: str, x_role: str = Depends(require_role())):
    case = db.query_one('SELECT * FROM cases WHERE caseId = ?', (case_id,))
    if not case:
        raise HTTPException(404, '案件不存在')
    dec = db.query_one('SELECT * FROM decisions WHERE eventId = ? ORDER BY decisionId DESC', (case['eventId'],)) or {}
    snap = db.query_one('SELECT * FROM feature_snapshots WHERE eventId = ? ORDER BY snapshotId DESC',
                        (case['eventId'],))
    disp = db.query('SELECT * FROM dispositions WHERE caseId = ?', (case_id,))
    events = db.query('SELECT * FROM events WHERE eventId = ?', (case['eventId'],))
    ev = events[0] if events else {}
    # 快照补"规则阈值"列（从规则条件树收集）
    th = threshold_map()
    snap_rows = pipeline.features.snapshot(json.loads(snap['features'])) if snap else []
    snap_rows = [{**row, 'thresholds': th.get(row['key'], [])} for row in snap_rows]
    return {'code': 0, 'data': {
        'case': case,
        'decision': {**dec, 'ruleHits': json.loads(dec.get('ruleHits') or '[]'),
                     'features': json.loads(dec.get('features') or '{}')} if dec else None,
        'snapshotRows': snap_rows,
        'event': {**ev, 'payload': json.loads(ev.get('payload') or '{}')} if ev else None,
        'profile': _profile(case['userId']),
        'dispositions': disp
    }}


@router.post('/{case_id}/dispose')
def dispose(case_id: str, body: DisposeIn, x_role: str = Depends(require_role('auditor'))):
    """处置（仅风控审核员）：状态流转 + 业务联动 + 名单写入 + 审计留痕"""
    case = db.query_one('SELECT * FROM cases WHERE caseId = ?', (case_id,))
    if not case:
        raise HTTPException(404, '案件不存在')
    if case['status'] in ('已处置', '已归档'):
        raise HTTPException(400, f'案件已终态（{case["status"]}），不可重复处置')
    if body.conclusion not in ('pass', 'reject', 'black'):
        raise HTTPException(400, '结论必须是 pass/reject/black')
    dims = body.dims
    if body.conclusion == 'black' and not dims:
        raise HTTPException(400, '拉黑处置至少选择一个名单维度')

    conclusion_txt = {'pass': '放行', 'reject': '拦截', 'black': '拉黑用户'}[body.conclusion]
    operator = operator_of(x_role)
    actions_txt = {'pass': '恢复关联单据', 'reject': '取消关联订单/拒绝退款',
                   'black': '取消关联订单+所选维度入黑名单'}[body.conclusion]

    db.execute("UPDATE cases SET status='已处置', assignee=?, disposeTime=? WHERE caseId=?",
               (operator, now(), case_id))
    db.execute('INSERT INTO dispositions(caseId,conclusion,actions,reason,evidence,operator,time)'
               ' VALUES(?,?,?,?,?,?,?)',
               (case_id, conclusion_txt, actions_txt, body.reason, body.evidence, operator, now()))
    add_audit(operator, x_role, '案件处置', 'case', case_id,
              f'案件 {case_id} 结论={conclusion_txt}，处置动作={actions_txt}',
              before=case['status'], after='已处置')

    # 拉黑联动：主体写入黑名单库（同实体同维度后写覆盖）+ 独立审计
    added = []
    if body.conclusion == 'black':
        u = _profile(case['userId'])
        dim_map = {'user': ('用户', case['userId']), 'phone': ('手机号', u.get('phone', '')),
                   'ip': ('IP', u.get('ip', '')), 'device': ('设备', u.get('device', ''))}
        for d in dims:
            if d not in dim_map:
                continue
            dim, value = dim_map[d]
            if not value:
                continue
            db.execute('DELETE FROM list_entries WHERE dim=? AND value=?', (dim, value))
            db.execute('INSERT INTO list_entries(listType,dim,value,reason,operator,time)'
                       ' VALUES(?,?,?,?,?,?)',
                       ('黑名单', dim, value, f'{body.reason}（关联案件 {case_id}）', operator, now()))
            added.append(f'{dim}:{value}')
        if added:
            pipeline.invalidate()  # 名单缓存失效，下个事件立即生效
            add_audit(operator, x_role, '名单变更', 'list', case['userId'],
                      '处置联动：' + '、'.join(added) + ' 移入黑名单')
    return {'code': 0, 'data': {'caseId': case_id, 'conclusion': conclusion_txt, 'blackAdded': added}}
