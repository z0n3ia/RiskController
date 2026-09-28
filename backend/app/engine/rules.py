# ============================================================
# engine/rules.py —— 规则决策引擎（PRD §6：名单匹配、条件表达式计算、
# 分值累计与综合仲裁）
# ============================================================
import json

from .. import db
from ..config import get_config

OPS = {
    '>=': lambda a, b: a >= b, '>': lambda a, b: a > b,
    '<=': lambda a, b: a <= b, '<': lambda a, b: a < b,
    '==': lambda a, b: a == b, '!=': lambda a, b: a != b
}


def eval_tree(node: dict, feats: dict) -> bool:
    """条件树求值：叶子 = 特征键 + 操作符 + 阈值；内部节点 = AND/OR 组合"""
    if 'children' not in node:
        v = feats.get(node['field'])
        if v is None:
            return False
        return bool(OPS[node['op']](v, node['value']))
    fn = all if node['op'] == 'AND' else any
    return fn(eval_tree(c, feats) for c in node['children'])


def expr_to_str(node: dict) -> str:
    if 'children' not in node:
        sym = {'>=': '≥', '<=': '≤', '==': '=', '!=': '≠'}.get(node['op'], node['op'])
        v = node['value']
        v = str(v) if isinstance(v, bool) else v
        return f"{node['field']} {sym} {v}"
    joiner = ' AND ' if node['op'] == 'AND' else ' OR '
    return joiner.join(expr_to_str(c) for c in node['children'])


class RuleEngine:
    """规则缓存 + 命中链路；规则 CRUD 后调用 reload() 立即生效"""

    def __init__(self):
        self.reload()

    def reload(self):
        self.rules = db.query('SELECT * FROM rules ORDER BY code')
        for r in self.rules:
            r['expr'] = json.loads(r['expr'])
            r['enabled'] = bool(r['enabled'])

    def hit_rules(self, scene: str, feats: dict) -> list:
        hits = []
        for r in self.rules:
            if not r['enabled']:
                continue
            if r['scene'] not in ('通用', scene):
                continue
            if eval_tree(r['expr'], feats):
                hits.append({
                    'code': r['code'], 'name': r['name'], 'score': r['score'],
                    'reason': self.fill_reason(r['reasonTpl'], feats)
                })
        return hits

    @staticmethod
    def fill_reason(tpl: str, feats: dict) -> str:
        import re
        return re.sub(r'\{(\w+)\}', lambda m: str(feats.get(m.group(1), '')), tpl or '')

    def arbitrate(self, score: int) -> tuple:
        """综合仲裁（PRD §2.3.4）：0~59 Pass / 60~79 Review / 80~100 Reject"""
        cfg = get_config()
        if score >= cfg['rejectLine']:
            return 'Reject', '高风险·直接拦截并自动创建风险案件'
        if score >= cfg['reviewLine']:
            return 'Review', '中风险·生成人工审核案件'
        return 'Pass', '低风险·正常放行'
