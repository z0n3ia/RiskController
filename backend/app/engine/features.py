# ============================================================
# engine/features.py —— 滑动窗口特征计算引擎（PRD §6 特征计算引擎）
# 从事件流实时聚合：近1h/24h/10m 行为频次、设备/IP/地址聚集度、环境标识
# ============================================================
from ..config import get_config  # noqa: F401 (预留)

HOUR = 3600 * 1000
DAY = 24 * HOUR

# 特征目录（快照接口 / 前端快照表共用）
FEATURE_DEFS = [
    {'key': 'device_account_cnt_1h', 'label': '同设备领券账号数(1h)'},
    {'key': 'ip_register_cnt',       'label': '同IP注册账号数'},
    {'key': 'coupon_cnt_1h',         'label': '近1h领券次数'},
    {'key': 'coupon_amount_1h',      'label': '近1h领券面额'},
    {'key': 'order_cnt_24h',         'label': '近24h下单次数'},
    {'key': 'order_cnt_10m',         'label': '近10min下单次数'},
    {'key': 'sku_limit_flag',        'label': '限量商品标识'},
    {'key': 'addr_order_cnt_24h',    'label': '同收货地址订单数(24h)'},
    {'key': 'refund_amount',         'label': '累计退款金额'},
    {'key': 'refund_cnt_24h',        'label': '近24h退款申请次数'},
    {'key': 'account_age_d',         'label': '账号注册天数'},
    {'key': 'ua_anomaly',            'label': 'UA环境异常标识'},
    {'key': 'ip_idc_flag',           'label': '机房代理IP标识'}
]

# 历史均值（快照对比列）
FEATURE_HISTORY = {
    'device_account_cnt_1h': 1.2, 'ip_register_cnt': 1.0, 'coupon_cnt_1h': 0.5,
    'coupon_amount_1h': 0, 'order_cnt_24h': 1.5, 'order_cnt_10m': 0.1,
    'sku_limit_flag': False, 'addr_order_cnt_24h': 0.4, 'refund_amount': 60,
    'refund_cnt_24h': 0.1, 'account_age_d': 300, 'ua_anomaly': False, 'ip_idc_flag': False
}


def threshold_map() -> dict:
    """特征键 → 引用该特征的规则阈值列表（'R003:>=3'），供快照"规则阈值"列"""
    import json as _json
    from .. import db
    th = {}
    for r in db.query('SELECT code, expr FROM rules'):
        def walk(n):
            if 'children' not in n:
                th.setdefault(n['field'], []).append(f"{r['code']}:{n['op']}{n['value']}")
                return
            for c in n['children']:
                walk(c)
        walk(_json.loads(r['expr']))
    return th


def parse_ts(ts: str) -> int:
    from datetime import datetime
    return int(datetime.fromisoformat(ts).timestamp() * 1000)


def feat_status(key, val):
    """快照状态：偏离历史均值越多风险越高"""
    h = FEATURE_HISTORY.get(key)
    if isinstance(val, bool):
        return 'high' if (val and not h) else 'ok'
    if not isinstance(val, (int, float)):
        return 'ok'
    if h == 0:
        return 'mid' if val >= 100 else 'ok'
    if val >= h * 3:
        return 'high'
    if val >= h * 2:
        return 'mid'
    return 'ok'


class FeatureEngine:
    """滑动时间窗口缓存（内存态，服务重启后由事件流水重建）"""

    def __init__(self):
        self.user_events = {}    # userId -> [(t, type, amount)]
        self.device_coupons = {} # deviceId -> [(t, userId)]
        self.addr_orders = {}    # address -> [(t, bizOrderId, userId)]
        self.ip_register = {}    # ip -> 账号数（来自画像静态聚合）
        self.users = {}

    def load_users(self, users: list):
        """启动预热：画像静态特征 + 同IP注册账号数"""
        self.users = {u['userId']: u for u in users}
        self.ip_register = {}
        for u in users:
            self.ip_register[u['ip']] = self.ip_register.get(u['ip'], 0) + 1

    def _win(self, store, key, ms, t):
        arr = store.get(key, [])
        cut = t - ms
        while arr and arr[0][0] < cut:
            arr.pop(0)
        return arr

    def update(self, event: dict, t: int):
        """事件写入滑动窗口（内存态；全量流水异步持久化到 events 表）"""
        uid = event['userId']
        amount = float((event.get('payload') or {}).get('amount')
                       or (event.get('payload') or {}).get('refundAmount') or 0)
        self.user_events.setdefault(uid, []).append((t, event['eventType'], amount))
        if event['eventType'] == 'coupon_receive':
            self.device_coupons.setdefault(event['deviceId'], []).append((t, uid))
        if event['eventType'] == 'order_create':
            addr = (self.users.get(uid) or {}).get('address')
            self.addr_orders.setdefault(addr, []).append((t, event.get('bizOrderId'), uid))

    def compute(self, event: dict, t: int, degraded=False) -> dict:
        """特征快照（PRD §8：特征上下文快照，键值结构）"""
        u = self.users.get(event['userId']) or {}
        uid = event['userId']
        etype = event['eventType']
        payload = event.get('payload') or {}

        user_ev = self._win(self.user_events, uid, DAY, t)
        coupons1h = [x for x in user_ev if x[1] == 'coupon_receive' and x[0] >= t - HOUR]
        orders24h = [x for x in user_ev if x[1] == 'order_create']
        orders10m = [x for x in orders24h if x[0] >= t - 10 * 60 * 1000]
        refunds24h = [x for x in user_ev if x[1] == 'after_sale_apply']

        dev_coupons = self._win(self.device_coupons, event['deviceId'], HOUR, t)
        dev_users = {x[1] for x in dev_coupons}
        if etype == 'coupon_receive':
            dev_users.add(uid)

        addr = u.get('address')
        addr_orders = {x[1] for x in self._win(self.addr_orders, addr, DAY, t)}
        if etype == 'order_create':
            addr_orders.add(event.get('bizOrderId'))

        age_d = 0
        if u.get('regTime'):
            age_d = max(0, (t - parse_ts(u['regTime'])) // DAY)

        return {
            'device_account_cnt_1h': len(dev_users),
            'ip_register_cnt': self.ip_register.get(event['ip'], 1),
            'coupon_cnt_1h': len(coupons1h),
            'coupon_amount_1h': int(sum(x[2] for x in coupons1h)),
            'order_cnt_24h': len(orders24h),
            'order_cnt_10m': len(orders10m),
            'sku_limit_flag': bool(payload.get('skuLimit')),
            'addr_order_cnt_24h': len(addr_orders),
            'refund_amount': int(sum(x[2] for x in refunds24h)),
            'refund_cnt_24h': len(refunds24h),
            'account_age_d': age_d,
            'ua_anomaly': bool(u.get('uaAnomaly')),
            'ip_idc_flag': bool(u.get('ipIdc')),
            '_degraded': degraded
        }

    def snapshot(self, feats: dict) -> list:
        """特征快照行（含历史均值/状态，供工作台快照对比）"""
        rows = []
        for f in FEATURE_DEFS:
            v = feats.get(f['key'])
            rows.append({
                'key': f['key'], 'label': f['label'], 'value': v,
                'history': FEATURE_HISTORY.get(f['key']),
                'status': feat_status(f['key'], v)
            })
        return rows
