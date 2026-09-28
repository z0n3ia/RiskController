# ============================================================
# config.py —— 运行配置（PRD §2.3.4 仲裁阈值，PUT 后即时生效并记审计）
# 本模块拥有 DEFAULT_CONFIG（db.py 不反向依赖本模块，避免循环导入）
# ============================================================
from . import db

# 运行配置默认值
DEFAULT_CONFIG = {
    'reviewLine': 60,        # 中风险阈值（Review 线）
    'rejectLine': 80,        # 高风险阈值（Reject 线）
    'challengeEnabled': False,
    'archiveDays': 30
}

_INT_KEYS = ('reviewLine', 'rejectLine', 'archiveDays')
_BOOL_KEYS = ('challengeEnabled',)


def get_config() -> dict:
    """读取运行配置（config 表覆盖默认值）"""
    cfg = dict(DEFAULT_CONFIG)
    for r in db.query('SELECT key, value FROM config'):
        k, v = r['key'], r['value']
        if k in _INT_KEYS:
            try:
                cfg[k] = int(v)
            except (TypeError, ValueError):
                pass
        elif k in _BOOL_KEYS:
            cfg[k] = str(v).lower() in ('1', 'true', 'yes')
    return cfg


def set_config(patch: dict) -> dict:
    """更新运行配置（调用方负责记审计）"""
    for k, v in patch.items():
        db.execute(
            'INSERT INTO config(key, value) VALUES(?, ?) '
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            (k, str(v)))
    return get_config()
