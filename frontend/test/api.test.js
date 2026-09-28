/* api.test.js —— HTTP 适配层测试：fetch 桩驱动，覆盖信封解包 / 角色头 / 字段映射 / 证据拼装 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv, envelope, okJson } = require('./helpers/env');

/* ---------- 桩基建：每个测试自建独立环境 ---------- */
let CALLS = [], reply = null, _env = null;

function newApi() {
  CALLS = [];
  reply = null;
  const fetchImpl = async (url, opts = {}) => {
    const path = url.replace('http://127.0.0.1:8642', '');
    CALLS.push({ method: opts.method || 'GET', path,
                 headers: opts.headers || {}, body: opts.body });
    const hit = reply && reply(opts.method || 'GET', path);
    if (hit) return hit;
    return okJson({ detail: '未匹配路由: ' + path }, { ok: false, status: 404 });
  };
  _env = makeEnv(['mock-data.js', 'api.js'], fetchImpl);
  return _env.RG.api;
}

/** 注册桩响应：route('GET', '/path', data, {ok,status})，查询串按前缀匹配 */
function route(method, path, data, opt) {
  reply = (m, p) => (m === method && (p === path || p.startsWith(path + '?'))
    ? envelope(data, opt) : null);
}

/** 跨 vm 沙箱对象归一化（原型域不同，deepStrictEqual 需先过 JSON） */
const j = o => JSON.parse(JSON.stringify(o));

/** 取沙箱内 mock 的 SCENES 文案（缓存） */
const M_SCENES = (() => {
  let cache = null;
  return key => (cache || (cache = makeEnv(['mock-data.js']).RG.mock.SCENES))[key];
})();

/* ---------- HTTP 基础 ---------- */
test('req：信封解包，未设角色时不带 X-Role 头', async () => {
  const A = newApi();
  route('GET', '/api/v1/config', { reviewLine: 60 });
  const cfg = await A.getConfig();
  assert.strictEqual(cfg.reviewLine, 60);
  assert.strictEqual(CALLS[0].headers['Content-Type'], 'application/json');
  assert.strictEqual(CALLS[0].headers['X-Role'], undefined);
});

test('req：sessionStorage 有角色时携带 X-Role', async () => {
  const A = newApi();
  route('GET', '/api/v1/config', {});
  _env.storage.setItem('rg_role', 'auditor');
  await A.getConfig();
  assert.strictEqual(CALLS[0].headers['X-Role'], 'auditor');
});

test('req：网络异常抛可读错误', async () => {
  const env2 = makeEnv(['mock-data.js', 'api.js'], async () => { throw new Error('ECONNREFUSED'); });
  await assert.rejects(() => env2.RG.api.getConfig(), /服务连接失败/);
});

test('req：HTTP 4xx 透出 detail，业务失败透出 msg', async () => {
  const A = newApi();
  await assert.rejects(() => A.getConfig(), /未匹配路由/);       // 默认桩：404+detail
  reply = () => okJson({ code: 1, msg: '业务处理失败' });          // 信封 code!==0
  await assert.rejects(() => A.getConfig(), /业务处理失败/);
});

/* ---------- 登录 / 指标 / 滚屏 ---------- */
test('login：参数校验 + 成功映射 + body 密码', async () => {
  const A = newApi();
  await assert.rejects(() => A.login('', '', 'admin'), /请输入账号/);
  await assert.rejects(() => A.login('a@b.c', '123', 'admin'), /至少 6 位/);
  route('POST', '/api/v1/auth/login', { account: 'a@b.c', role: 'admin' });
  assert.deepStrictEqual(j(await A.login('a@b.c', 'demo123456', 'admin')),
    { account: 'a@b.c', role: 'admin' });
  assert.strictEqual(JSON.parse(CALLS[0].body).password, 'demo123456');
});

test('getMetrics：透传指标字段', async () => {
  const A = newApi();
  route('GET', '/api/v1/metrics/summary',
    { eventCount: 10, interceptRate: '0.6%', pendingCases: 3, pendingHigh: 1, savedAmount: 405 });
  const m = await A.getMetrics();
  assert.strictEqual(m.pendingHigh, 1);
  assert.strictEqual(m.eventCount, 10);
});

test('genEvent：倒序拉取后正序轮播 + 动作→等级映射 + 取尽重拉', async () => {
  const A = newApi();
  const rows = [   // 后端返回：时间倒序（最新在前）
    { time: '2026-09-28 10:00:03', user: 'U3', type: 'login', action: 'Pass', score: 0 },
    { time: '2026-09-28 10:00:02', user: 'U2', type: 'order_pay', action: 'Review', score: 65 },
    { time: '2026-09-28 10:00:01', user: 'U1', type: 'coupon_receive', action: 'Reject', score: 95 }
  ];
  route('GET', '/api/v1/events/recent?limit=30', rows);
  assert.deepStrictEqual(j(await A.genEvent()),
    { time: '10:00:01', user: 'U1', type: 'coupon_receive', lvl: 'high', action: 'Reject', score: 95 });
  assert.deepStrictEqual(j(await A.genEvent()),
    { time: '10:00:02', user: 'U2', type: 'order_pay', lvl: 'mid', action: 'Review', score: 65 });
  assert.deepStrictEqual(j(await A.genEvent()),
    { time: '10:00:03', user: 'U3', type: 'login', lvl: 'low', action: 'Pass', score: 0 });
  await A.genEvent();   // 取尽 → 重新拉取
  assert.strictEqual(CALLS.length, 2, '缓存取尽后应二次请求');
});

/* ---------- 案件（含 CCN 最高的 getCase 全分支） ---------- */
const CASE_RAW = (over = {}) => Object.assign({
  case: { caseId: 'CASE-1', eventType: 'after_sale_apply', riskLevel: '高风险',
          createTime: '09-28 10:00:00', status: '待审', userId: 'U1', assignee: '' },
  decision: { ruleHits: [{ code: 'R021', score: 35, reason: '退款金额6752元，近24h申请4次' },
                          { code: 'R023', score: 25, reason: '同地址订单3单，退款申请4次' }] },
  event: { bizOrderId: 'REF-1', eventType: 'after_sale_apply', payload: { orderId: 'SO-9', refundAmount: 6752 } },
  profile: { userId: 'U1', name: '张三', device: 'DEV_X', ip: '1.2.3.4',
             devicePeers: ['U2', 'U3'], ipPeers: [], regTime: '2026-06-01T00:00:00',
             historyOrders: 5, refunds: 2, tags: [], phone: '138****0000' },
  snapshotRows: [{ key: 'refund_cnt_24h', value: 4 }]
}, over);

test('getCase：高风险分支——hits/单据/画像/证据提示拼装', async () => {
  const A = newApi();
  route('GET', '/api/v1/cases/CASE-1', CASE_RAW());
  const c = await A.getCase('CASE-1');
  assert.strictEqual(CALLS[0].path, '/api/v1/cases/CASE-1');
  assert.strictEqual(c.caseInfo.id, 'CASE-1');
  assert.strictEqual(c.caseInfo.level, 'high');
  assert.strictEqual(c.caseInfo.time, '09-28 10:00:00');
  assert.strictEqual(c.caseInfo.bizOrderId, 'REF-1');
  assert.strictEqual(c.caseInfo.hits.length, 2);
  assert.strictEqual(c.sceneLabel, M_SCENES('after_sale_apply'));
  // 业务单据还原：orderId + refundAmount
  assert.deepStrictEqual(j(c.caseInfo.bizOrders),
    [{ id: 'SO-9', type: M_SCENES('after_sale_apply'), amount: '¥6752', status: '—' }]);
  // 画像映射
  assert.strictEqual(c.profile.name, '张三');
  assert.strictEqual(c.profile.devicePeers.length, 2);
  assert.ok(Number.isFinite(c.profile.regDays) && c.profile.regDays >= 0);
  // 证据提示：命中原因 + 设备关联 + 高风险建议
  assert.strictEqual(c.caseInfo.evidence,
    '退款金额6752元，近24h申请4次；同地址订单3单，退款申请4次；同设备关联 3 个账号；'
    + '建议直接拦截并拉黑设备/IP/账号');
  assert.ok(c.snapshot.length >= 1);
});

test('getCase：券单据还原 + 中风险建议 + IP 关联', async () => {
  const A = newApi();
  route('GET', '/api/v1/cases/CASE-2', CASE_RAW({
    case: { caseId: 'CASE-2', eventType: 'coupon_receive', riskLevel: '中风险' },
    decision: { ruleHits: [] },
    event: { bizOrderId: 'CPN-1', eventType: 'coupon_receive', payload: { couponId: 'CPN_L50', amount: 50 } },
    profile: { userId: 'U2', devicePeers: [], ipPeers: ['U9'] }
  }));
  const c = await A.getCase('CASE-2');
  assert.strictEqual(c.caseInfo.level, 'mid');
  assert.deepStrictEqual(j(c.caseInfo.bizOrders),
    [{ id: 'CPN_L50', type: M_SCENES('coupon_receive'), amount: '¥50', status: '—' }]);
  assert.strictEqual(c.caseInfo.evidence,
    '同 IP 关联 2 个账号；建议人工核对证据链与关联实体后处置');
});

test('getCase：空 hits 兜底（仅建议语）', async () => {
  const A = newApi();
  route('GET', '/api/v1/cases/CASE-3', CASE_RAW({
    decision: { ruleHits: [] },
    profile: { userId: 'U3', devicePeers: [], ipPeers: [] }
  }));
  const c = await A.getCase('CASE-3');
  assert.strictEqual(c.caseInfo.evidence, '建议直接拦截并拉黑设备/IP/账号');
});

test('getCaseList：筛选参数映射 + 列表字段映射', async () => {
  const A = newApi();
  route('GET', '/api/v1/cases', { total: 1, list: [{ caseId: 'C9', userId: 'U1',
    eventType: 'coupon_receive', riskLevel: '低风险', score: 10, status: '已处置',
    createTime: '09-28 09:00', assignee: '审核员', hits: [] }] });
  const r = await A.getCaseList({ level: 'high', page: 2, size: 10 });
  assert.ok(CALLS[0].path.includes('level=' + encodeURIComponent('高风险')));
  assert.ok(CALLS[0].path.includes('page=2'));
  assert.strictEqual(r.total, 1);
  assert.strictEqual(r.list[0].id, 'C9');
  assert.strictEqual(r.list[0].level, 'low');
});

test('disposeCase：POST 处置，body 不含 operator', async () => {
  const A = newApi();
  route('POST', '/api/v1/cases/CASE-1/dispose', { blackAdded: 2 });
  const r = await A.disposeCase({ caseId: 'CASE-1', conclusion: 'black',
    dims: ['user', 'device'], reason: 'r', evidence: 'e' });
  assert.strictEqual(CALLS[0].method, 'POST');
  assert.deepStrictEqual(JSON.parse(CALLS[0].body),
    { conclusion: 'black', dims: ['user', 'device'], reason: 'r', evidence: 'e' });
  assert.strictEqual(r.blackAdded, 2);
});

/* ---------- 规则 / 名单 / 审计 / 仿真 ---------- */
test('saveRule：无 code 走 POST，有 code 走 PUT，enabled 强制布尔', async () => {
  const A = newApi();
  route('POST', '/api/v1/rules', { code: 'R100' });
  await A.saveRule({ name: 'n', scene: 'login', score: 10, expr: {}, enabled: 1 });
  assert.strictEqual(CALLS[0].method, 'POST');
  assert.strictEqual(JSON.parse(CALLS[0].body).enabled, true);
  route('PUT', '/api/v1/rules/R1', { code: 'R1' });
  await A.saveRule({ code: 'R1', name: 'n', scene: 'login', score: 10, expr: {}, enabled: false });
  assert.strictEqual(CALLS[1].method, 'PUT');
  assert.strictEqual(CALLS[1].path, '/api/v1/rules/R1');
});

test('getLists：stats 中文键 → 英文键', async () => {
  const A = newApi();
  route('GET', '/api/v1/lists',
    { list: [{ id: 'L1' }], stats: { '黑名单': 5, '白名单': 1, '灰名单': 2 } });
  const r = await A.getLists({});
  assert.deepStrictEqual(j(r.stats), { black: 5, white: 1, gray: 2 });
});

test('addLists：values 按行拆分、去空、去空白', async () => {
  const A = newApi();
  route('POST', '/api/v1/lists', { added: 2 });
  await A.addLists({ listType: '黑名单', dim: '用户', values: ' U1 \n\nU2\n', reason: 'x' });
  assert.deepStrictEqual(JSON.parse(CALLS[0].body).values, ['U1', 'U2']);
});

test('removeList：按 dim+value 组 DELETE 查询串', async () => {
  const A = newApi();
  route('DELETE', '/api/v1/lists', true);
  await A.removeList({ dim: '设备', value: 'DEV_1' });
  assert.strictEqual(CALLS[0].method, 'DELETE');
  assert.ok(CALLS[0].path.includes('dim=' + encodeURIComponent('设备')));
  assert.ok(CALLS[0].path.includes('value=DEV_1'));
});

test('getAuditLogs：三键映射 + 拉全量分页', async () => {
  const A = newApi();
  route('GET', '/api/v1/audit-logs', { total: 1, list: [{ logId: 'AUD-1', actionType: '案件处置',
    operator: '审核员', content: 'c', targetId: 'CASE-1', targetType: 'case', time: '09-28 10:00' }] });
  const r = await A.getAuditLogs({ type: '案件处置' });
  assert.ok(CALLS[0].path.includes('size=500'));
  assert.strictEqual(r.list[0].id, 'AUD-1');
  assert.strictEqual(r.list[0].type, '案件处置');
});

test('simulate：参数校验 + 命中文案解析', async () => {
  const A = newApi();
  await assert.rejects(() => A.simulate({ type: 'nope', userId: 'U1' }), /未知事件类型/);
  await assert.rejects(() => A.simulate({ type: 'login' }), /userId/);
  route('POST', '/api/v1/simulate', {
    list: '黑名单：命中 用户 U1', features: [], ruleHits: [],
    verdict: { score: 100, action: 'Reject' }, elapsedMs: 0.1 });
  const s = await A.simulate({ type: 'coupon_receive', userId: 'U1' });
  assert.strictEqual(s.blackHit, true);
  assert.strictEqual(s.whiteHit, false);
  assert.strictEqual(s.action, 'Reject');
  assert.strictEqual(JSON.parse(CALLS[0].body).eventType, 'coupon_receive');
});
