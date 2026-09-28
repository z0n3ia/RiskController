# ============================================================
# db.py —— SQLite 持久化层（PRD §7 数据模型 · 九大实体 + 运行配置）
# 线程安全：单连接 + threading.Lock（FastAPI 同步路由跑线程池）
# 注意：本模块不 import config（配置默认值归 config.py 所有，避免循环导入）
# ============================================================
import os
import sqlite3
import threading

_DB_PATH = os.environ.get(
    'RG_DB',
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'riskguard.db')
)

_lock = threading.Lock()
_conn = None


def _connect():
    global _conn
    if _conn is None:
        os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
        _conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute('PRAGMA journal_mode=WAL')
        _init_schema(_conn)
    return _conn


def query(sql, params=()):
    with _lock:
        cur = _connect().execute(sql, params)
        return [dict(r) for r in cur.fetchall()]


def query_one(sql, params=()):
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql, params=()):
    with _lock:
        cur = _connect().execute(sql, params)
        _conn.commit()
        return cur.lastrowid


def executemany(sql, rows):
    with _lock:
        _connect().executemany(sql, rows)
        _conn.commit()


# ============================================================
# 建表（PRD §7 九大实体 + 运行配置 + 图谱边）
# ============================================================
_SCHEMA = """
CREATE TABLE IF NOT EXISTS users(             -- 用户画像
  userId TEXT PRIMARY KEY, name TEXT, grp TEXT, regTime TEXT,
  device TEXT, ip TEXT, ipIdc INTEGER, uaAnomaly INTEGER,
  address TEXT, phone TEXT, tags TEXT, historyOrders INTEGER, refunds INTEGER
);
CREATE TABLE IF NOT EXISTS events(            -- 事件流水
  eventId TEXT PRIMARY KEY, eventType TEXT, userId TEXT, bizOrderId TEXT,
  deviceId TEXT, ip TEXT, timestamp TEXT, payload TEXT
);
CREATE TABLE IF NOT EXISTS feature_snapshots( -- 特征快照（含降级标记）
  snapshotId INTEGER PRIMARY KEY AUTOINCREMENT, eventId TEXT, userId TEXT,
  features TEXT, degraded INTEGER DEFAULT 0, createTime TEXT
);
CREATE TABLE IF NOT EXISTS rules(             -- 规则（条件树 JSON）
  code TEXT PRIMARY KEY, name TEXT, scene TEXT, expr TEXT, score INTEGER,
  enabled INTEGER, reasonTpl TEXT, creator TEXT, updateTime TEXT
);
CREATE TABLE IF NOT EXISTS decisions(         -- 决策流水
  decisionId INTEGER PRIMARY KEY AUTOINCREMENT, decisionNo TEXT, eventId TEXT,
  userId TEXT, eventType TEXT, score INTEGER, riskLevel TEXT, action TEXT,
  ruleHits TEXT, listHit TEXT, features TEXT, amount REAL, elapsedMs REAL, createTime TEXT
);
CREATE TABLE IF NOT EXISTS cases(             -- 风控案件
  caseId TEXT PRIMARY KEY, eventId TEXT, userId TEXT, eventType TEXT,
  riskLevel TEXT, scene TEXT, score INTEGER, status TEXT, assignee TEXT,
  createTime TEXT, disposeTime TEXT
);
CREATE TABLE IF NOT EXISTS dispositions(      -- 处置记录（append-only）
  id INTEGER PRIMARY KEY AUTOINCREMENT, caseId TEXT, conclusion TEXT,
  actions TEXT, reason TEXT, evidence TEXT, operator TEXT, time TEXT
);
CREATE TABLE IF NOT EXISTS list_entries(      -- 名单库（黑/白/灰 × 五维）
  id INTEGER PRIMARY KEY AUTOINCREMENT, listType TEXT, dim TEXT, value TEXT,
  reason TEXT, operator TEXT, time TEXT
);
CREATE TABLE IF NOT EXISTS graph_edges(       -- 关联图谱边（同构实体网络）
  id INTEGER PRIMARY KEY AUTOINCREMENT, srcType TEXT, srcValue TEXT,
  dstType TEXT, dstValue TEXT, relType TEXT, weight REAL
);
CREATE TABLE IF NOT EXISTS audit_logs(        -- 审计日志（append-only）
  logId INTEGER PRIMARY KEY AUTOINCREMENT, logNo TEXT, operator TEXT, role TEXT,
  actionType TEXT, targetType TEXT, targetId TEXT, content TEXT,
  before TEXT, after TEXT, time TEXT
);
CREATE TABLE IF NOT EXISTS config(            -- 运行配置
  key TEXT PRIMARY KEY, value TEXT
);
CREATE INDEX IF NOT EXISTS idx_dec_event ON decisions(eventId);
CREATE INDEX IF NOT EXISTS idx_case_user ON cases(userId);
CREATE INDEX IF NOT EXISTS idx_case_status ON cases(status);
"""

# 建表时灌入的配置默认值（与 config.DEFAULT_CONFIG 保持一致；此处内联避免循环导入）
_DEFAULTS = {'reviewLine': '60', 'rejectLine': '80', 'challengeEnabled': 'false', 'archiveDays': '30'}


def _init_schema(c):
    c.executescript(_SCHEMA)
    for k, v in _DEFAULTS.items():
        c.execute('INSERT OR IGNORE INTO config(key, value) VALUES(?, ?)', (k, v))
    c.commit()


def reset():
    """重建库（种子脚本用）：连同 WAL/SHM 残留一并清除"""
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None
        for suffix in ('', '-wal', '-shm'):
            p = _DB_PATH + suffix
            if os.path.exists(p):
                os.remove(p)
    _connect()
