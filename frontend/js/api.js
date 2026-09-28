/* ============================================================
 * api.js —— 数据访问层（HTTP 适配 · 对接 backend/ 决策管理服务）
 * 对页面暴露的接口签名与原 Mock 完全一致，页面无需改动。
 * 职责：统一信封解包 {code,data} / X-Role 角色头 / 字段映射。
 *
 * 后端接口（PRD §6）：
 *   POST /api/v1/auth/login                    登录
 *   POST /api/v1/events · GET /events/recent   事件网关 + 滚屏
 *   GET  /api/v1/features/{uid}/snapshot       特征快照
 *   GET  /api/v1/cases · GET/POST /cases/:id   案件 + 处置
 *   CRUD /api/v1/rules · PATCH /rules/:code/toggle
 *   GET/POST/DELETE /api/v1/lists · POST /lists/import
 *   GET  /api/v1/graph/:type/:value            实体图谱
 *   GET  /api/v1/metrics/summary · /audit-logs · /config · POST /simulate
 * ============================================================ */
window.RG = window.RG || {};

RG.api = (function () {
  'use strict';
  const BASE = window.RG_API_BASE || 'http://127.0.0.1:8642';
  const M = RG.mock;   // 仅用静态文案/模板：SCENES 场景标签、SIM_TEMPLATES、getUser 兜底

  /* ================= HTTP 基础 ================= */
  const role = () => sessionStorage.getItem('rg_role') || '';

  async function req(method, path, body) {
    let resp, r = null;
    try {
      resp = await fetch(BASE + path, {
        method,
        headers: Object.assign({ 'Content-Type': 'application/json' },
          role() ? { 'X-Role': role() } : {}),
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      r = await resp.json();
    } catch (e) {
      throw '服务连接失败（' + BASE + '），请确认后端已启动';
    }
    if (!resp.ok) throw (r && (r.detail || r.msg)) || ('请求失败（' + resp.status + '）');
    if (r && r.code !== 0) throw r.msg || '业务处理失败';
    return r.data;
  }

  const qs = obj => {
    const q = new URLSearchParams();
    Object.keys(obj).forEach(k => { if (obj[k] !== '' && obj[k] != null) q.set(k, obj[k]); });
    const s = q.toString();
    return s ? '?' + s : '';
  };

  /* 风险等级值域映射：前端 high/mid/low ↔ 后端 高风险/中风险/低风险 */
  const LVL2BE = { high: '高风险', mid: '中风险', low: '低风险' };
  const RISK2FE = { '高风险': 'high', '中风险': 'mid', '低风险': 'low' };

  /* ================= 登录 ================= */
  async function login(account, pwd, rolePick) {
    if (!account || !pwd) throw '请输入账号与密码';
    if (pwd.length < 6) throw '密码长度至少 6 位';
    const d = await req('POST', '/api/v1/auth/login',
      { account, password: pwd, role: rolePick });
    return { account: d.account, role: d.role };
  }

  /* ================= 指标（大盘） ================= */
  async function getMetrics() {
    const d = await req('GET', '/api/v1/metrics/summary');
    return {
      eventCount: d.eventCount,
      interceptRate: d.interceptRate,
      pendingCases: d.pendingCases,
      pendingHigh: d.pendingHigh != null ? d.pendingHigh : (d.riskDist ? 0 : 0),
      savedAmount: d.savedAmount
    };
  }

  /* ================= 实时事件滚屏 ================= */
  let _feedCache = [], _feedPtr = 0;
  async function genEvent() {
    if (_feedPtr >= _feedCache.length) {
      const rows = await req('GET', '/api/v1/events/recent?limit=30');
      _feedCache = (rows || []).slice().reverse();   // 时间正序轮播
      _feedPtr = 0;
      if (!_feedCache.length) throw '暂无事件';
    }
    const r = _feedCache[_feedPtr++ % _feedCache.length];
    return {
      time: (r.time || '').slice(11) || r.time,
      user: r.user, type: r.type,
      lvl: r.action === 'Reject' ? 'high' : r.action === 'Review' ? 'mid' : 'low',
      action: r.action, score: r.score
    };
  }

  /* ================= 特征快照 ================= */
  async function getSnapshot(userId) {
    const d = await req('GET', '/api/v1/features/' + encodeURIComponent(userId) + '/snapshot');
    return d.snapshot || [];
  }

  /* ================= 案件 ================= */
  async function getCaseList(filter) {
    filter = filter || {};
    const d = await req('GET', '/api/v1/cases' + qs({
      level: filter.level ? (LVL2BE[filter.level] || filter.level) : '',
      scene: filter.scene || '', status: filter.status || '', kw: filter.kw || '',
      page: filter.page || 1, size: filter.size || 10
    }));
    return {
      total: d.total,
      list: (d.list || []).map(c => ({
        id: c.caseId, userId: c.userId, scene: c.eventType,
        level: RISK2FE[c.riskLevel] || 'low', score: c.score,
        status: c.status, time: c.createTime, assignee: c.assignee,
        hits: c.hits || []
      }))
    };
  }

  async function getCase(id) {
    const d = await req('GET', '/api/v1/cases/' + encodeURIComponent(id));
    const c = d.case || {}, dec = d.decision || {}, ev = d.event || {}, p = d.profile || {};
    const payload = ev.payload || {};
    // 业务单据：从事件流水还原（券/订单/退款各取其单据号与金额）
    const bizOrders = [];
    if (ev.bizOrderId && ev.bizOrderId !== '—') {
      const amt = payload.amount != null ? payload.amount : payload.refundAmount;
      bizOrders.push({
        id: payload.orderId || payload.couponId || ev.bizOrderId,
        type: (M.SCENES[ev.eventType] || ev.eventType),
        amount: amt != null ? '¥' + amt : '—',
        status: '—'
      });
    }
    // 证据提示：后端无静态文案，按命中规则触发原因 + 图谱关联 + 处置建议动态拼装
    const evParts = (dec.ruleHits || []).map(h => h.reason).filter(Boolean);
    if (p.devicePeers && p.devicePeers.length) evParts.push('同设备关联 ' + (p.devicePeers.length + 1) + ' 个账号');
    if (p.ipPeers && p.ipPeers.length) evParts.push('同 IP 关联 ' + (p.ipPeers.length + 1) + ' 个账号');
    evParts.push(c.riskLevel === 'high' ? '建议直接拦截并拉黑设备/IP/账号' : '建议人工核对证据链与关联实体后处置');
    return {
      caseInfo: Object.assign({}, c, {
        id: c.caseId, scene: c.eventType, level: RISK2FE[c.riskLevel] || 'low',
        time: c.createTime, bizOrderId: ev.bizOrderId || '—',
        hits: dec.ruleHits || [], bizOrders,
        evidence: evParts.join('；')
      }),
      sceneLabel: M.SCENES[c.eventType] || c.eventType,
      profile: {
        userId: p.userId, name: p.name,
        regDays: p.regTime ? Math.max(0, Math.floor((Date.now() - new Date(p.regTime).getTime()) / 86400000)) : 0,
        historyOrders: p.historyOrders || 0, refunds: p.refunds || 0,
        tags: p.tags || [], device: p.device || '', ip: p.ip || '',
        devicePeers: p.devicePeers || [], ipPeers: p.ipPeers || [],
        phone: p.phone || ''
      },
      snapshot: d.snapshotRows || []
    };
  }

  async function disposeCase(opt) {
    // operator 由后端按 X-Role 派生，此处不传
    return req('POST', '/api/v1/cases/' + encodeURIComponent(opt.caseId) + '/dispose', {
      conclusion: opt.conclusion, dims: opt.dims || [],
      reason: opt.reason, evidence: opt.evidence
    });
  }

  /* ================= 规则 ================= */
  async function getRules(filter) {
    filter = filter || {};
    const d = await req('GET', '/api/v1/rules' + qs({
      scene: filter.scene || '', enabled: filter.enabled == null ? '' : filter.enabled,
      kw: filter.kw || ''
    }));
    return (d || []).map(r => Object.assign({}, r, { enabled: !!r.enabled }));
  }
  async function saveRule(rule /*, operator 由 X-Role 派生 */) {
    const body = { name: rule.name, scene: rule.scene, expr: rule.expr,
                   score: rule.score, reasonTpl: rule.reasonTpl || '', enabled: !!rule.enabled };
    const d = rule.code
      ? await req('PUT', '/api/v1/rules/' + encodeURIComponent(rule.code), body)
      : await req('POST', '/api/v1/rules', body);
    return Object.assign({}, rule, d);   // d 含生成/确认的 code
  }
  async function toggleRule(code, enabled) {
    return req('PATCH', '/api/v1/rules/' + encodeURIComponent(code) + '/toggle', { enabled });
  }
  async function deleteRule(code) {
    return req('DELETE', '/api/v1/rules/' + encodeURIComponent(code));
  }

  /* ================= 名单库 ================= */
  async function getLists(filter) {
    filter = filter || {};
    const d = await req('GET', '/api/v1/lists' + qs({
      listType: filter.listType || '', dim: filter.dim || '', kw: filter.kw || ''
    }));
    return {
      list: d.list || [],
      stats: { black: d.stats['黑名单'] || 0, white: d.stats['白名单'] || 0, gray: d.stats['灰名单'] || 0 }
    };
  }
  async function addLists(opt) {
    const values = String(opt.values).split(/\n+/).map(s => s.trim()).filter(Boolean);
    return req('POST', '/api/v1/lists', {
      listType: opt.listType, dim: opt.dim, values, reason: opt.reason
    });
  }
  async function removeList(ref) {   // ref:{dim,value}
    return req('DELETE', '/api/v1/lists' + qs({ dim: ref.dim, value: ref.value }));
  }
  async function importLists(opt) {
    const values = String(opt.values).split(/\n+/).map(s => s.trim()).filter(Boolean);
    const rows = await req('POST', '/api/v1/lists/import', {
      listType: opt.listType, dim: opt.dim, values, reason: opt.reason || '批量导入'
    });
    return (rows || []).map(r => ({ idx: r.row, value: r.value, ok: r.ok, msg: r.msg }));
  }

  /* ================= 审计日志 ================= */
  async function getAuditLogs(filter) {
    filter = filter || {};
    const d = await req('GET', '/api/v1/audit-logs' + qs({
      type: filter.type || '', operator: filter.operator || '', kw: filter.kw || '',
      page: 1, size: 500   // 拉全量过滤结果，前端分页（scope 由后端按角色自动限制）
    }));
    return {
      total: d.total,
      list: (d.list || []).map(a => ({
        id: a.logId, type: a.actionType, operator: a.operator,
        content: a.content, target: a.targetId, targetType: a.targetType, time: a.time
      }))
    };
  }

  /* ================= 运行配置 ================= */
  async function getConfig() { return req('GET', '/api/v1/config'); }
  async function saveConfig(cfg /*, operator 由 X-Role 派生 */) {
    return req('PUT', '/api/v1/config', cfg);
  }

  /* ================= 仿真检测 ================= */
  async function simulate(event) {
    if (!M.SCENES[event.type]) throw '未知事件类型：' + event.type;
    if (!event.userId) throw '缺少用户编号 userId';
    const s = await req('POST', '/api/v1/simulate', {
      eventType: event.type, userId: event.userId,
      payload: event.payload || {}, timestamp: event.timestamp
    });
    const listHit = s.list && (s.list.indexOf('黑名单：命中') >= 0);
    const whiteHit = s.list && (s.list.indexOf('白名单：命中') >= 0);
    return {
      blackHit: !!listHit, whiteHit: !!whiteHit,
      features: s.features,                 // 行超集：{key,label,value,history,status}，FE 用 key/value/status
      hits: s.ruleHits || [],
      score: s.verdict ? s.verdict.score : 0,
      action: s.verdict ? s.verdict.action : 'Pass',
      steps: { list: s.list || '' },
      elapsed: s.elapsedMs
    };
  }

  return {
    login, getMetrics, getSnapshot, genEvent,
    getCaseList, getCase, disposeCase,
    getRules, saveRule, toggleRule, deleteRule,
    getLists, addLists, removeList, importLists,
    getAuditLogs, getConfig, saveConfig, simulate
  };
})();
