# routers/graph.py —— 关联图谱（PRD §6 画像与图谱：同设备/同IP/同地址 BFS 扩散 1~2 跳）
from collections import deque

from fastapi import APIRouter, Depends, HTTPException

from .. import db
from ..security import require_role

router = APIRouter(prefix='/api/v1/graph', tags=['graph'])

ETYPES = ('user', 'device', 'ip', 'address')
LABELS = {'user': '用户', 'device': '设备', 'ip': 'IP', 'address': '地址'}


@router.get('/{etype}/{value}')
def neighbors(etype: str, value: str, depth: int = 1, x_role: str = Depends(require_role())):
    """BFS 扩散：返回中心节点 + depth 跳内的节点与边（前端 SVG 拓扑渲染）"""
    if etype not in ETYPES:
        raise HTTPException(400, 'etype 必须是 user/device/ip/address')
    depth = depth if depth in (1, 2) else 1

    adj = {}
    for e in db.query('SELECT * FROM graph_edges'):
        adj.setdefault((e['srcType'], e['srcValue']), []).append(e)
        adj.setdefault((e['dstType'], e['dstValue']), []).append(e)

    nodes, seen_n = [], {(etype, value)}
    out_edges, seen_e = [], set()
    queue = deque([(etype, value, 0)])
    while queue:
        t, v, d = queue.popleft()
        if d >= depth:
            continue
        for e in adj.get((t, v), []):
            other = ((e['dstType'], e['dstValue']) if (e['srcType'], e['srcValue']) == (t, v)
                     else (e['srcType'], e['srcValue']))
            ek = (e['srcType'], e['srcValue'], e['dstType'], e['dstValue'], e['relType'])
            rk = tuple(sorted([ek[:2], ek[2:4]])) + (ek[4],)
            if rk not in seen_e:
                seen_e.add(rk)
                out_edges.append({'src': {'type': e['srcType'], 'value': e['srcValue']},
                                  'dst': {'type': e['dstType'], 'value': e['dstValue']},
                                  'rel': e['relType'], 'weight': e['weight']})
            if other not in seen_n:
                seen_n.add(other)
                node = {'type': other[0], 'value': other[1], 'label': LABELS[other[0]]}
                if other[0] == 'user':
                    u = db.query_one('SELECT name FROM users WHERE userId=?', (other[1],))
                    if u:
                        node['name'] = u['name']
                nodes.append(node)
                queue.append((other[0], other[1], d + 1))

    center = {'type': etype, 'value': value, 'label': LABELS[etype]}
    if etype == 'user':
        u = db.query_one('SELECT name FROM users WHERE userId=?', (value,))
        if u:
            center['name'] = u['name']
    return {'code': 0, 'data': {'center': center, 'nodes': nodes, 'edges': out_edges}}
