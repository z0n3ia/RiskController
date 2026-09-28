# ============================================================
# seed.py —— 种子数据装载（从 simulation/data 读取，服务首次启动自动执行）
# ============================================================
import json
import os

from . import db
from .engine.pipeline import now

_SIM_DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'simulation', 'data')


def _load(fname):
    path = os.path.join(_SIM_DATA, fname)
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def _phone(uid: str) -> str:
    digits = ''.join(ch for ch in uid if ch.isdigit()) or '0000'
    return '138****' + digits[-4:]


def is_empty() -> bool:
    return db.query_one('SELECT COUNT(*) AS n FROM users')['n'] == 0


def seed():
    """灌入种子：用户画像 / 规则 / 名单 / 图谱边（幂等：仅在空库时执行）"""
    if not is_empty():
        return False

    # 1. 用户画像（users_stream.json = 种子画像 + 合成背景用户）
    data = _load('users_stream.json') or _load('users.json') or {'users': []}
    users = data.get('users', [])
    for u in users:
        db.execute(
            'INSERT INTO users(userId,name,grp,regTime,device,ip,ipIdc,uaAnomaly,address,phone,'
            'tags,historyOrders,refunds) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (u['userId'], u.get('name', ''), u.get('group', 'normal'), u.get('regTime', ''),
             u.get('device', ''), u.get('ip', ''), int(u.get('ipIdc', False)),
             int(u.get('uaAnomaly', False)), u.get('address', ''), _phone(u['userId']),
             json.dumps(u.get('tags', []), ensure_ascii=False),
             u.get('historyOrders', 0), u.get('refunds', 0)))

    # 2. 规则（条件树 JSON）
    rules = (_load('rules.json') or {}).get('rules', [])
    for r in rules:
        db.execute(
            'INSERT INTO rules(code,name,scene,expr,score,enabled,reasonTpl,creator,updateTime)'
            ' VALUES(?,?,?,?,?,?,?,?,?)',
            (r['code'], r['name'], r['scene'], json.dumps(r['expr'], ensure_ascii=False),
             r['score'], int(r['enabled']), r['reasonTpl'], '策略师·陈晨', '09-27 09:12'))

    # 3. 名单库
    lists = (_load('blacklist.json') or {}).get('entries', [])
    for e in lists:
        db.execute('INSERT INTO list_entries(listType,dim,value,reason,operator,time)'
                   ' VALUES(?,?,?,?,?,?)',
                   (e['listType'], e['dim'], e['value'], e['reason'], e['operator'], e['time']))

    # 4. 关联图谱边：user→device/ip/address 实体边 + 同维聚集的 user→user 边
    by_dev, by_ip, by_addr = {}, {}, {}
    for u in users:
        by_dev.setdefault(u.get('device'), []).append(u)
        by_ip.setdefault(u.get('ip'), []).append(u)
        by_addr.setdefault(u.get('address'), []).append(u)

    edges = []
    for u in users:
        if u.get('device'):
            edges.append(('user', u['userId'], 'device', u['device'], '使用设备', 1))
        if u.get('ip'):
            edges.append(('user', u['userId'], 'ip', u['ip'], '请求IP', 1))
        if u.get('address'):
            edges.append(('user', u['userId'], 'address', u['address'], '收货地址', 1))

    REL = {'device': '同设备', 'ip': '同IP', 'address': '同地址'}
    for grp_map, etype in ((by_dev, 'device'), (by_ip, 'ip'), (by_addr, 'address')):
        for key, grp in grp_map.items():
            members = [u['userId'] for u in grp if u.get('userId')]
            if len(members) >= 2 and key:
                anchor = members[0]
                for m in members[1:]:
                    edges.append(('user', anchor, 'user', m, REL[etype], len(members)))

    db.executemany(
        'INSERT INTO graph_edges(srcType,srcValue,dstType,dstValue,relType,weight) VALUES(?,?,?,?,?,?)',
        [(e[0], e[1], e[2], e[3], e[4], e[5]) for e in edges])

    # 5. 初始审计日志
    db.execute(
        'INSERT INTO audit_logs(logNo,operator,role,actionType,targetType,targetId,content,before,after,time)'
        ' VALUES(?,?,?,?,?,?,?,?,?,?)',
        ('AUD-90000', '管理员·admin', '系统管理员', '登录', 'none', '—', '系统初始化，种子数据装载完成', '', '', now()))
    return True
