/* ============================================================
 * engine.js —— 风控决策引擎（纯逻辑，零依赖，数据全部由调用方注入）
 *
 * 职责（对应 PRD §6 特征计算引擎 + 规则决策引擎）：
 *   ① 黑白名单快速过滤
 *   ② 滑动窗口特征计算：从事件流实时聚合（1h/24h/10m 窗口），不查表
 *   ③ 规则条件树求值 + 分值累计
 *   ④ 综合仲裁：Pass(0~59) / Review(60~79) / Reject(80~100)
 *
 * 仅被 scripts/demo.js、scripts/generator.js 引用，也可被未来后端复用。
 * ============================================================ */

const HOUR = 3600 * 1000;

/** 条件树操作符 */
const OPS = {
  '>=': (a, b) => a >= b, '>': (a, b) => a > b,
  '<=': (a, b) => a <= b, '<': (a, b) => a < b,
  '==': (a, b) => a === b, '!=': (a, b) => a !== b
};

export class RiskEngine {
  /**
   * @param {Object} opts
   * @param {Array}  opts.users      用户画像库（data/users.json）
   * @param {Array}  opts.rules      规则集（data/rules.json）
   * @param {Array}  opts.blacklist  名单库（data/blacklist.json）
   * @param {Object} [opts.config]   运行配置 { reviewLine, rejectLine, challengeEnabled }
   */
  constructor({ users, rules, blacklist, config }) {
    this.users = new Map(users.map(u => [u.userId, u]));
    this.rules = rules;
    this.config = Object.assign({ reviewLine: 60, rejectLine: 80, challengeEnabled: false }, config);
    this.blacklist = (blacklist || []).map(e => ({ ...e }));

    // 静态聚合：同 IP 注册账号数（来自画像库）
    this.ipRegisterCnt = new Map();
    for (const u of users) {
      this.ipRegisterCnt.set(u.ip, (this.ipRegisterCnt.get(u.ip) || 0) + 1);
    }

    // 滑动窗口状态（运行时聚合）
    this.userEvents = new Map();   // userId  -> [{t,type,amount,addressId}]
    this.deviceCoupon = new Map(); // deviceId-> [{t,userId}]（coupon_receive）
    this.addrOrders = new Map();   // address -> [{t,bizOrderId,userId}]（order_create）
  }

  /* ---------------- 名单 ---------------- */
  _inList(listType, dim, value) {
    return this.blacklist.some(e => e.listType === listType && e.dim === dim && e.value === value);
  }
  /** 添加名单（同一实体同一维度仅属一种类型：后写覆盖） */
  addList(entry) {
    const i = this.blacklist.findIndex(e => e.dim === entry.dim && e.value === entry.value);
    if (i >= 0) this.blacklist.splice(i, 1);
    this.blacklist.unshift({ ...entry });
  }

  /* ---------------- 画像 ---------------- */
  getUser(userId) {
    return this.users.get(userId) || null;
  }

  /* ---------------- 滑动窗口特征计算 ---------------- */
  /**
   * 基于已回放的事件历史 + 当前事件，计算特征快照。
   * 时间窗口：[t - 窗口, t]，含当前事件。
   */
  computeFeatures(event, t) {
    const u = this.users.get(event.userId) || {};
    const win = (map, key, ms) => (map.get(key) || []).filter(x => x.t >= t - ms);

    const userEv = win(this.userEvents, event.userId, 24 * HOUR);
    const coupons1h = userEv.filter(x => x.type === 'coupon_receive' && x.t >= t - HOUR);
    const orders24h = userEv.filter(x => x.type === 'order_create');
    const orders10m = orders24h.filter(x => x.t >= t - 10 * 60 * 1000);
    const refunds24h = userEv.filter(x => x.type === 'after_sale_apply');

    const deviceCouponUsers = new Set(
      win(this.deviceCoupon, event.deviceId, HOUR).map(x => x.userId));
    if (event.eventType === 'coupon_receive') deviceCouponUsers.add(event.userId);

    const addrOrders24h = new Set(
      win(this.addrOrders, u.address, 24 * HOUR).map(x => x.bizOrderId));
    if (event.eventType === 'order_create') addrOrders24h.add(event.bizOrderId);

    return {
      device_account_cnt_1h: deviceCouponUsers.size,
      ip_register_cnt: this.ipRegisterCnt.get(event.ip) || 1,
      coupon_cnt_1h: coupons1h.length,
      coupon_amount_1h: coupons1h.reduce((s, x) => s + (x.amount || 0), 0),
      order_cnt_24h: orders24h.length,
      order_cnt_10m: orders10m.length,
      sku_limit_flag: !!(event.payload && event.payload.skuLimit),
      addr_order_cnt_24h: addrOrders24h.size,
      refund_amount: refunds24h.reduce((s, x) => s + (x.amount || 0), 0),
      refund_cnt_24h: refunds24h.length,
      account_age_d: u.regTime ? Math.max(0, Math.floor((t - Date.parse(u.regTime)) / (24 * HOUR))) : 0,
      ua_anomaly: !!u.uaAnomaly,
      ip_idc_flag: !!u.ipIdc
    };
  }

  /* ---------------- 条件树求值 ---------------- */
  evalTree(node, feats) {
    if (!node.children) {
      const v = feats[node.field];
      return v === undefined ? false : !!OPS[node.op](v, node.value);
    }
    return node.op === 'AND'
      ? node.children.every(c => this.evalTree(c, feats))
      : node.children.some(c => this.evalTree(c, feats));
  }

  fillReason(tpl, feats) {
    return tpl.replace(/\{(\w+)\}/g, (_, k) => feats[k]);
  }

  /* ---------------- 决策主链路 ---------------- */
  /**
   * 事件进入决策流水线：名单过滤 → 特征计算（含窗口更新）→ 规则求值 → 仲裁
   * @returns {Object} decision
   */
  decide(event) {
    const t0 = Date.now();
    const t = Date.parse(event.timestamp);
    const u = this.users.get(event.userId);

    /* ① 黑白名单快速过滤 */
    const blackHit = ['用户', '设备', 'IP'].find(dim => {
      const val = dim === '用户' ? event.userId : dim === '设备' ? event.deviceId : event.ip;
      return this._inList('黑名单', dim, val);
    });
    const whiteHit = this._inList('白名单', '用户', event.userId);
    if (blackHit || whiteHit) {
      // 名单命中仍需更新窗口（保持事件流完整），但跳过规则
      this._updateWindows(event, t);
      return {
        event, action: blackHit ? 'Reject' : 'Pass', score: blackHit ? 100 : 0,
        hits: [], features: null,
        listHit: blackHit ? { type: '黑名单', dim: blackHit } : { type: '白名单', dim: '用户' },
        elapsed: Date.now() - t0
      };
    }

    /* ② 特征计算（滑动窗口）+ 窗口更新 */
    this._updateWindows(event, t);
    const features = this.computeFeatures(event, t);

    /* ③ 规则命中链路 */
    const hits = [];
    for (const r of this.rules) {
      if (!r.enabled) continue;
      if (r.scene !== '通用' && r.scene !== event.eventType) continue;
      if (this.evalTree(r.expr, features)) {
        hits.push({ code: r.code, name: r.name, score: r.score, reason: this.fillReason(r.reasonTpl, features) });
      }
    }

    /* ④ 综合仲裁 */
    const score = Math.min(100, hits.reduce((s, h) => s + h.score, 0));
    const action = score >= this.config.rejectLine ? 'Reject'
      : score >= this.config.reviewLine ? 'Review' : 'Pass';

    return { event, action, score, hits, features, listHit: null, elapsed: Date.now() - t0 };
  }

  /** 事件写入滑动窗口 */
  _updateWindows(event, t) {
    const amount = (event.payload && (event.payload.amount ?? event.payload.refundAmount)) || 0;
    const address = (this.users.get(event.userId) || {}).address;
    if (!this.userEvents.has(event.userId)) this.userEvents.set(event.userId, []);
    this.userEvents.get(event.userId).push({ t, type: event.eventType, amount, addressId: address });
    if (event.eventType === 'coupon_receive') {
      if (!this.deviceCoupon.has(event.deviceId)) this.deviceCoupon.set(event.deviceId, []);
      this.deviceCoupon.get(event.deviceId).push({ t, userId: event.userId });
    }
    if (event.eventType === 'order_create') {
      if (!this.addrOrders.has(address)) this.addrOrders.set(address, []);
      this.addrOrders.get(address).push({ t, bizOrderId: event.bizOrderId, userId: event.userId });
    }
  }
}
