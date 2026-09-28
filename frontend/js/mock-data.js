/* ============================================================
 * mock-data.js —— 模拟数据与内存状态
 * 含：特征目录 / 规则(条件树) / 用户画像 / 案件 / 名单 / 审计日志 /
 *     实时事件流 / 仿真模板 / 运行配置 / 规则条件树求值器
 * 说明：数据保存在内存中，页面操作（处置/规则变更等）实时生效；
 *       后端就绪后仅替换 api.js 即可，本文件可整体下线。
 * ============================================================ */
window.RG = window.RG || {};

RG.mock = (function () {
  'use strict';

  /* ================= 特征目录（条件构建器 / 快照表共用） ================= */
  const FEATURES = [
    { key: 'device_account_cnt_1h', label: '同设备领券账号数(1h)', unit: '个' },
    { key: 'ip_register_cnt',       label: '同IP注册账号数',      unit: '个' },
    { key: 'coupon_cnt_1h',         label: '近1h领券次数',        unit: '次' },
    { key: 'coupon_amount_1h',      label: '近1h领券面额',        unit: '元' },
    { key: 'order_cnt_24h',         label: '近24h下单次数',       unit: '次' },
    { key: 'order_cnt_10m',         label: '近10min下单次数',     unit: '次' },
    { key: 'sku_limit_flag',        label: '限量商品标识',        unit: '' },
    { key: 'addr_order_cnt_24h',    label: '同收货地址订单数(24h)', unit: '单' },
    { key: 'refund_amount',         label: '累计退款金额',        unit: '元' },
    { key: 'refund_cnt_24h',        label: '近24h退款申请次数',   unit: '次' },
    { key: 'account_age_d',         label: '账号注册天数',        unit: '天' },
    { key: 'ua_anomaly',            label: 'UA环境异常标识',      unit: '' },
    { key: 'ip_idc_flag',           label: '机房代理IP标识',      unit: '' }
  ];

  /* ================= 用户画像 =================
   * regDays 注册天数 / deviceAccounts 同设备账号数 / ipRegister 同IP注册数
   * peers.device / peers.ip：图谱关联账号
   */
  const USERS = {
    U10086: { name: '羊毛党-A组-06', regDays: 1,  device: 'DEV_9f2a1c81e', ip: '112.74.103.55', ipIdc: true,  ua: true,
      deviceAccounts: 6, ipRegister: 9, couponCnt1h: 4, couponAmount1h: 200,
      orderCnt24h: 0, orderCnt10m: 0, skuLimit: false, addrOrders: 0, refundAmount: 0, refundCnt24h: 0,
      historyOrders: 0, refunds: 0,
      tags: ['批量注册', '设备聚集', '代理IP', '新号领券'],
      peers: { device: ['U10087', 'U10095'], ip: ['U10087', 'U10092', 'U10095', 'U10102'] } },
    U10087: { name: '羊毛党-A组-07', regDays: 1,  device: 'DEV_9f2a1c81e', ip: '112.74.103.55', ipIdc: true,  ua: true,
      deviceAccounts: 6, ipRegister: 9, couponCnt1h: 4, couponAmount1h: 200,
      orderCnt24h: 0, orderCnt10m: 0, skuLimit: false, addrOrders: 0, refundAmount: 0, refundCnt24h: 0,
      historyOrders: 0, refunds: 0,
      tags: ['批量注册', '设备聚集', '代理IP', '新号领券'],
      peers: { device: ['U10086', 'U10095'], ip: ['U10086', 'U10092', 'U10095'] } },
    U10092: { name: '羊毛党-A组-03', regDays: 2,  device: 'DEV_44b1e0d2',  ip: '112.74.103.55', ipIdc: true,  ua: true,
      deviceAccounts: 2, ipRegister: 9, couponCnt1h: 3, couponAmount1h: 150,
      orderCnt24h: 0, orderCnt10m: 0, skuLimit: false, addrOrders: 0, refundAmount: 0, refundCnt24h: 0,
      historyOrders: 0, refunds: 0,
      tags: ['批量注册', '代理IP'],
      peers: { device: [], ip: ['U10086', 'U10087'] } },
    U10095: { name: '羊毛党-B组-01', regDays: 1,  device: 'DEV_9f2a1c81e', ip: '112.74.103.55', ipIdc: true,  ua: false,
      deviceAccounts: 6, ipRegister: 9, couponCnt1h: 2, couponAmount1h: 100,
      orderCnt24h: 0, orderCnt10m: 0, skuLimit: false, addrOrders: 0, refundAmount: 0, refundCnt24h: 0,
      historyOrders: 0, refunds: 0,
      tags: ['批量注册', '设备聚集'],
      peers: { device: ['U10086', 'U10087'], ip: ['U10086', 'U10087'] } },
    U09912: { name: '退款欺诈-03',   regDays: 210, device: 'DEV_1a2b77cd',  ip: '223.104.3.88',  ipIdc: false, ua: false,
      deviceAccounts: 1, ipRegister: 3, couponCnt1h: 0, couponAmount1h: 0,
      orderCnt24h: 1, orderCnt10m: 0, skuLimit: false, addrOrders: 3, refundAmount: 1688, refundCnt24h: 4,
      historyOrders: 23, refunds: 6,
      tags: ['高额退款', '退款高频', '地址聚集'],
      peers: { device: [], ip: ['U09913'] } },
    U09855: { name: '囤货黄牛-01',   regDays: 95,  device: 'DEV_5f6e90bb',  ip: '61.144.22.7',   ipIdc: false, ua: false,
      deviceAccounts: 1, ipRegister: 1, couponCnt1h: 0, couponAmount1h: 0,
      orderCnt24h: 5, orderCnt10m: 2, skuLimit: true, addrOrders: 6, refundAmount: 0, refundCnt24h: 0,
      historyOrders: 41, refunds: 1,
      tags: ['地址聚集', '高频下单'],
      peers: { device: [], ip: [] } },
    U09701: { name: '黄牛-试单号',   regDays: 12,  device: 'DEV_5f6e90bb',  ip: '61.144.22.7',   ipIdc: false, ua: false,
      deviceAccounts: 2, ipRegister: 2, couponCnt1h: 0, couponAmount1h: 0,
      orderCnt24h: 6, orderCnt10m: 6, skuLimit: true, addrOrders: 2, refundAmount: 0, refundCnt24h: 0,
      historyOrders: 6, refunds: 0,
      tags: ['高频下单'],
      peers: { device: ['U09855'], ip: [] } },
    U05123: { name: '正常用户-01',   regDays: 420, device: 'DEV_88ee01aa',  ip: '117.136.8.201', ipIdc: false, ua: false,
      deviceAccounts: 1, ipRegister: 1, couponCnt1h: 1, couponAmount1h: 5,
      orderCnt24h: 1, orderCnt10m: 0, skuLimit: false, addrOrders: 1, refundAmount: 39, refundCnt24h: 0,
      historyOrders: 132, refunds: 2,
      tags: [],
      peers: { device: [], ip: [] } },
    U04471: { name: '正常用户-02',   regDays: 660, device: 'DEV_c0d3a551',  ip: '39.144.7.12',   ipIdc: false, ua: false,
      deviceAccounts: 1, ipRegister: 1, couponCnt1h: 0, couponAmount1h: 0,
      orderCnt24h: 2, orderCnt10m: 0, skuLimit: false, addrOrders: 0, refundAmount: 0, refundCnt24h: 0,
      historyOrders: 301, refunds: 1, tags: [], peers: { device: [], ip: [] } },
    U03210: { name: '正常用户-03',   regDays: 830, device: 'DEV_7b2f4c09',  ip: '112.17.40.6',   ipIdc: false, ua: false,
      deviceAccounts: 1, ipRegister: 1, couponCnt1h: 1, couponAmount1h: 10,
      orderCnt24h: 1, orderCnt10m: 0, skuLimit: false, addrOrders: 0, refundAmount: 0, refundCnt24h: 0,
      historyOrders: 522, refunds: 0, tags: [], peers: { device: [], ip: [] } },
    U09870: { name: '羊毛党-A组-11', regDays: 1,  device: 'DEV_9f2a1c81e', ip: '112.74.103.55', ipIdc: true,  ua: true,
      deviceAccounts: 6, ipRegister: 9, couponCnt1h: 4, couponAmount1h: 200,
      orderCnt24h: 0, orderCnt10m: 0, skuLimit: false, addrOrders: 0, refundAmount: 0, refundCnt24h: 0,
      historyOrders: 0, refunds: 0,
      tags: ['批量注册', '设备聚集', '代理IP'],
      peers: { device: ['U10086', 'U10087'], ip: ['U10086', 'U10092'] } }
  };
  // 未知用户的兜底画像（正常用户）
  const DEFAULT_USER = {
    name: '普通用户', regDays: 365, device: 'DEV_unknown00', ip: '10.0.0.1', ipIdc: false, ua: false,
    deviceAccounts: 1, ipRegister: 1, couponCnt1h: 1, couponAmount1h: 5,
    orderCnt24h: 1, orderCnt10m: 0, skuLimit: false, addrOrders: 1, refundAmount: 0, refundCnt24h: 0,
    historyOrders: 20, refunds: 0, tags: [], peers: { device: [], ip: [] }
  };
  function getUser(uid) { return USERS[uid] || Object.assign({ name: '普通用户' }, DEFAULT_USER); }

  /* ================= 规则（条件树） =================
   * expr: { op:'AND'|'OR', children:[ {field,op,value} | 子树 ] }
   */
  const RULES = [
    { code: 'R003', name: '同设备多账号领券', scene: 'coupon_receive', score: 45, enabled: true,
      updateTime: '09-27 09:12', creator: '策略师·陈晨',
      expr: { op: 'AND', children: [{ field: 'device_account_cnt_1h', op: '>=', value: 3 }] },
      reasonTpl: '近1h同设备领券账号数={device_account_cnt_1h}' },
    { code: 'R007', name: '同IP注册账号数超标', scene: '通用', score: 40, enabled: true,
      updateTime: '09-26 18:40', creator: '策略师·陈晨',
      expr: { op: 'AND', children: [{ field: 'ip_register_cnt', op: '>=', value: 5 }] },
      reasonTpl: '同IP注册账号数={ip_register_cnt}' },
    { code: 'R012', name: '近1h领券频次异常', scene: 'coupon_receive', score: 20, enabled: true,
      updateTime: '09-26 11:02', creator: '策略师·陈晨',
      expr: { op: 'AND', children: [
        { field: 'coupon_cnt_1h', op: '>=', value: 3 },
        { field: 'account_age_d', op: '<=', value: 3 } ] },
      reasonTpl: '近1h领券{coupon_cnt_1h}次且注册仅{account_age_d}天' },
    { code: 'R015', name: '同收货地址订单聚集', scene: 'order_create', score: 15, enabled: true,
      updateTime: '09-20 10:00', creator: '策略师·陈晨',
      expr: { op: 'AND', children: [{ field: 'addr_order_cnt_24h', op: '>=', value: 5 }] },
      reasonTpl: '近24h同收货地址订单={addr_order_cnt_24h}单' },
    { code: 'R018', name: '机房代理IP标识', scene: '通用', score: 10, enabled: true,
      updateTime: '09-18 14:30', creator: '策略师·陈晨',
      expr: { op: 'AND', children: [{ field: 'ip_idc_flag', op: '==', value: true }] },
      reasonTpl: '请求IP命中机房代理库' },
    { code: 'R021', name: '高额未收货退款高频', scene: 'after_sale_apply', score: 35, enabled: true,
      updateTime: '09-25 16:20', creator: '策略师·陈晨',
      expr: { op: 'AND', children: [
        { field: 'refund_amount', op: '>=', value: 500 },
        { field: 'refund_cnt_24h', op: '>=', value: 3 } ] },
      reasonTpl: '退款金额{refund_amount}元，近24h申请{refund_cnt_24h}次' },
    { code: 'R023', name: '同地址多账号退款聚集', scene: 'after_sale_apply', score: 25, enabled: true,
      updateTime: '09-24 20:11', creator: '策略师·陈晨',
      expr: { op: 'AND', children: [
        { field: 'addr_order_cnt_24h', op: '>=', value: 3 },
        { field: 'refund_cnt_24h', op: '>=', value: 2 } ] },
      reasonTpl: '同地址订单{addr_order_cnt_24h}单，退款申请{refund_cnt_24h}次' },
    { code: 'R024', name: '囤货型订单聚集', scene: 'order_create', score: 50, enabled: true,
      updateTime: '09-23 09:05', creator: '策略师·陈晨',
      expr: { op: 'AND', children: [
        { field: 'addr_order_cnt_24h', op: '>=', value: 5 },
        { field: 'order_cnt_24h', op: '>=', value: 3 } ] },
      reasonTpl: '同地址{addr_order_cnt_24h}单且近24h下单{order_cnt_24h}次' },
    { code: 'R026', name: '黄牛高频下单限量商品', scene: 'order_create', score: 50, enabled: false,
      updateTime: '09-27 08:55', creator: '策略师·陈晨',
      expr: { op: 'AND', children: [
        { field: 'order_cnt_10m', op: '>=', value: 5 },
        { field: 'sku_limit_flag', op: '==', value: true } ] },
      reasonTpl: '近10min下单{order_cnt_10m}次，含限量商品', isNew: true }
  ];

  /* ================= 条件树求值器 ================= */
  const OPS = {
    '>=': (a, b) => a >= b, '>': (a, b) => a > b,
    '<=': (a, b) => a <= b, '<': (a, b) => a < b,
    '==': (a, b) => a === b, '!=': (a, b) => a !== b
  };
  function evalTree(node, feats) {
    if (!node.children) { // 叶子
      const v = feats[node.field];
      if (v === undefined) return false;      // 特征缺失 → 不命中
      return !!OPS[node.op](v, node.value);
    }
    return node.op === 'AND'
      ? node.children.every(c => evalTree(c, feats))
      : node.children.some(c => evalTree(c, feats));
  }
  /** 条件树 → 显示字符串 */
  function exprToStr(node) {
    if (!node.children) {
      const f = FEATURES.find(x => x.key === node.field);
      const v = typeof node.value === 'boolean' ? String(node.value) : node.value;
      const opTxt = { '>=': '≥', '<=': '≤', '==': '=', '!=': '≠' }[node.op] || node.op;
      return (f ? f.key : node.field) + ' ' + opTxt + ' ' + v;
    }
    const joiner = node.op === 'AND' ? ' AND ' : ' OR ';
    return node.children.map(exprToStr).join(joiner);
  }

  /* ================= 名单库 ================= */
  const LISTS = [
    { listType: '黑名单', dim: '设备', value: 'DEV_3c81aa02', reason: '羊毛党团伙设备（案件CASE-20260927-005101）', operator: '审核员·李敏', time: '09-27 09:30' },
    { listType: '黑名单', dim: 'IP',   value: '45.121.8.90',  reason: '机房代理IP批量注册', operator: '策略师·陈晨', time: '09-27 09:31' },
    { listType: '黑名单', dim: '用户', value: 'U09877', reason: '多次高额恶意退款', operator: '审核员·王强', time: '09-26 15:12' },
    { listType: '白名单', dim: '用户', value: 'U00001', reason: '压测白名单，跳过全部规则', operator: '管理员·admin', time: '09-01 00:00' },
    { listType: '灰名单', dim: '手机号', value: '138****0033', reason: '观察：新号高频领券待复核', operator: '策略师·陈晨', time: '09-26 20:44' }
  ];

  /* ================= 案件 ================= */
  const SCENES = {
    login: 'login 账号登录', coupon_receive: 'coupon_receive 营销领券',
    order_create: 'order_create 订单创建', order_pay: 'order_pay 订单支付',
    after_sale_apply: 'after_sale_apply 售后退款'
  };
  const CASES = [
    { id: 'CASE-20260927-005218', userId: 'U10086', scene: 'coupon_receive', level: 'high', score: 85,
      status: '待审', time: '2026-09-27 10:21:33', assignee: '—',
      bizOrderId: 'CPN-20260927-88412',
      hits: [
        { code: 'R003', score: 45, reason: '近1h同设备领券账号数=6' },
        { code: 'R007', score: 40, reason: '同IP注册账号数=9' } ],
      bizOrders: [
        { id: 'CPN-20260927-88412', type: '满199减50券', amount: '¥50', status: '已拦截' },
        { id: 'ORD-20260927-55301', type: '关联未支付订单', amount: '¥239.00', status: '待处置联动' } ],
      evidence: '该设备1h内6个账号领取50元档大额券×4张；IP与9个注册账号关联，建议直接拦截并拉黑设备。' },
    { id: 'CASE-20260927-005217', userId: 'U10087', scene: 'coupon_receive', level: 'high', score: 85,
      status: '待审', time: '2026-09-27 10:21:29', assignee: '—',
      bizOrderId: 'CPN-20260927-88413',
      hits: [
        { code: 'R003', score: 45, reason: '近1h同设备领券账号数=6' },
        { code: 'R007', score: 40, reason: '同IP注册账号数=9' } ],
      bizOrders: [
        { id: 'CPN-20260927-88413', type: '满199减50券', amount: '¥50', status: '已拦截' } ],
      evidence: '与案件005218同设备同IP聚集，团伙特征明显，建议合并处置并拉黑设备。' },
    { id: 'CASE-20260927-005210', userId: 'U09912', scene: 'after_sale_apply', level: 'mid', score: 70,
      status: '待审', time: '2026-09-27 10:02:11', assignee: '—',
      bizOrderId: 'REF-20260927-11233',
      hits: [
        { code: 'R021', score: 35, reason: '退款金额1688元，近24h申请4次' },
        { code: 'R023', score: 25, reason: '同地址订单3单，退款申请4次' },
        { code: 'R018', score: 10, reason: '—' } ],
      bizOrders: [
        { id: 'ORD-20260925-11209', type: '手机数码 · 已签收', amount: '¥1688.00', status: '退款审核中' } ],
      evidence: '历史退款率26%，同收货地址关联3账号近期均有退款申请，疑似退货欺诈团伙。' },
    { id: 'CASE-20260927-005198', userId: 'U09855', scene: 'order_create', level: 'mid', score: 65,
      status: '审核中', time: '2026-09-27 09:47:05', assignee: '审核员·李敏',
      bizOrderId: 'ORD-20260927-54987',
      hits: [
        { code: 'R024', score: 50, reason: '同地址6单且近24h下单5次' },
        { code: 'R015', score: 15, reason: '近24h同收货地址订单=6单' } ],
      bizOrders: [
        { id: 'ORD-20260927-54987', type: '限量商品 ×2', amount: '¥9996.00', status: '待支付' } ],
      evidence: '同一收货地址24h内聚集6笔订单，含限量商品，疑似黄牛囤货转卖。' },
    { id: 'CASE-20260927-005101', userId: 'U09870', scene: 'coupon_receive', level: 'high', score: 85,
      status: '已处置', time: '2026-09-27 09:30:41', assignee: '审核员·李敏',
      bizOrderId: 'CPN-20260927-88011',
      hits: [
        { code: 'R003', score: 45, reason: '近1h同设备领券账号数=6' },
        { code: 'R007', score: 40, reason: '同IP注册账号数=9' } ],
      bizOrders: [
        { id: 'CPN-20260927-88011', type: '满199减50券', amount: '¥50', status: '已作废' } ],
      evidence: '同设备批量领券，已执行拉黑处置（设备/IP/账号入黑名单）。' }
  ];
  const DISPOSITIONS = [ // 历史处置记录（append-only）
    { caseId: 'CASE-20260927-005101', conclusion: '拉黑用户', actions: '取消关联订单+设备/IP/账号入黑名单',
      reason: '确认为羊毛党团伙领券', evidence: '同设备6账号1h内领券4张大额券，命中R003/R007', operator: '审核员·李敏', time: '09-27 09:31:02' }
  ];

  /* ================= 审计日志（append-only） ================= */
  let auditSeq = 90218;
  const AUDITS = [
    { id: 'AUD-90218', type: '案件处置', operator: '审核员·李敏', content: '案件 CASE-…-005101 结论=拉黑，处置动作=取消订单+设备/IP/账号入黑名单', target: 'CASE-…-005101', targetType: 'case', time: '09-27 09:31:02' },
    { id: 'AUD-90217', type: '规则变更', operator: '策略师·陈晨', content: '新增规则 R026（黄牛高频下单限量商品，分值50），初始状态=停用', target: 'R026', targetType: 'rule', time: '09-27 08:55:40' },
    { id: 'AUD-90216', type: '规则变更', operator: '策略师·陈晨', content: '调整 R003 分值 40 → 45（依据仿真回测误伤率 0.2%）', target: 'R003', targetType: 'rule', time: '09-27 09:12:11' },
    { id: 'AUD-90215', type: '名单变更', operator: '审核员·王强', content: '用户 U09877 移入黑名单（维度=用户）', target: 'U09877', targetType: 'list', time: '09-26 15:12:33' },
    { id: 'AUD-90214', type: '登录', operator: '管理员·admin', content: '登录成功（IP 10.2.8.11）', target: '—', targetType: 'none', time: '09-26 14:02:01' }
  ];
  function addAudit(entry) {
    entry.id = 'AUD-' + (++auditSeq);
    entry.time = fmtTime();
    AUDITS.unshift(entry);
    return entry;
  }

  /* ================= 实时事件流 ================= */
  const EVENT_POOL = [
    ['U10086', 'coupon_receive', 'high', 'Reject', 85], ['U05123', 'order_pay', 'low', 'Pass', 12],
    ['U09912', 'after_sale_apply', 'mid', 'Review', 70], ['U10087', 'coupon_receive', 'high', 'Reject', 85],
    ['U04471', 'login', 'low', 'Pass', 5], ['U09855', 'order_create', 'mid', 'Review', 65],
    ['U10092', 'coupon_receive', 'high', 'Reject', 80], ['U03210', 'order_pay', 'low', 'Pass', 8],
    ['U10095', 'coupon_receive', 'high', 'Reject', 85], ['U05123', 'coupon_receive', 'low', 'Pass', 10],
    ['U09701', 'order_create', 'mid', 'Review', 60], ['U04471', 'order_pay', 'low', 'Pass', 15]
  ];
  const EVENTS = [];
  function pushEvent(e) {
    e.time = fmtClock();
    EVENTS.unshift(e);
    if (EVENTS.length > 30) EVENTS.pop();
    return e;
  }
  (function seedEvents() {
    // 倒序播一遍种子，形成初始滚屏
    for (let i = EVENT_POOL.length - 1; i >= 0; i--) {
      const p = EVENT_POOL[i];
      pushEvent({ user: p[0], type: p[1], lvl: p[2], action: p[3], score: p[4] });
    }
  })();

  /* ================= 仿真模板 ================= */
  const SIM_TEMPLATES = [
    { name: '羊毛党批量领券（高危）', expect: 'Reject',
      event: { type: 'coupon_receive', userId: 'U10086', payload: { couponId: 'CPN_L50', amount: 50, channel: 'h5' } } },
    { name: '恶意退款欺诈（人审）', expect: 'Review',
      event: { type: 'after_sale_apply', userId: 'U09912', payload: { orderId: 'ORD-20260925-11209', refundAmount: 1688, reason: '未收到货' } } },
    { name: '正常用户领券（通过）', expect: 'Pass',
      event: { type: 'coupon_receive', userId: 'U05123', payload: { couponId: 'CPN_L5', amount: 5, channel: 'app' } } },
    { name: '黄牛囤货下单（自建）', expect: 'Reject',
      event: { type: 'order_create', userId: 'U09701', payload: { skuId: 'SKU_LIMIT_001', qty: 4, amount: 19996 } } }
  ];

  /* ================= 运行配置 ================= */
  const CONFIG = { challengeEnabled: false, reviewLine: 60, rejectLine: 80, archiveDays: 30 };

  /* ================= 工具 ================= */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtClock() { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function fmtTime() {
    const d = new Date();
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  /** 深拷贝（隔离内部状态，避免页面直接改到源数据） */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ================= 指标基线 ================= */
  const METRICS_BASE = { eventCount: 12847, interceptRate: 6.4, savedAmount: 862540 };

  return {
    FEATURES, USERS, getUser, DEFAULT_USER, SCENES,
    RULES, evalTree, exprToStr, OPS,
    LISTS, CASES, DISPOSITIONS, AUDITS, addAudit,
    EVENTS, pushEvent, EVENT_POOL,
    SIM_TEMPLATES, CONFIG, METRICS_BASE,
    fmtClock, fmtTime, clone
  };
})();
