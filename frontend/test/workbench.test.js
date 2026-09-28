/* workbench.test.js —— 工作台详情视图构建函数测试（vm 沙箱，纯字符串断言） */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./helpers/env');

/* 加载顺序对齐 index.html：util → mock-data → 注入 RG.api/RG.app 桩 → 页面模块 */
const env = makeEnv(['util.js', 'mock-data.js']);
env.ctx.window.RG.api = {};
env.ctx.window.RG.app = { state: { role: 'auditor' },
  ROLE_INFO: { auditor: '风控审核员', strategist: '风控策略师', admin: '系统管理员' } };
env.load('pages/workbench.js');

const V = env.RG.pages.workbench._views;

/* ---------- Tabs / 快照行 ---------- */
test('tabsHtml：五个页签且第一个 active', () => {
  const h = V.tabsHtml();
  assert.strictEqual((h.match(/class="tab /g) || []).length, 5);
  assert.ok(h.includes('class="tab active" data-tab="w1"'));
  assert.ok(h.includes('data-tab="w5"'));
});

test('featRowHtml：异常/关注/正常三态与缺失值、阈值列', () => {
  const base = { key: 'k', label: '标签', value: 5, history: 2, thresholds: ['R003:>=6'] };
  const hi = V.featRowHtml(Object.assign({}, base, { status: 'high' }));
  assert.ok(hi.includes('tag high">异常') && hi.includes('diff-up'));
  assert.ok(hi.includes('R003:&gt;=6'), '阈值经 esc 转义（防 XSS）');
  const mid = V.featRowHtml(Object.assign({}, base, { status: 'mid' }));
  assert.ok(mid.includes('tag mid">关注') && !mid.includes('diff-up'));
  const ok = V.featRowHtml(Object.assign({}, base, { status: 'ok', thresholds: [] }));
  assert.ok(ok.includes('tag gray">正常') && ok.includes('<td class="muted">—</td>'), '空阈值显示 —');
  const miss = V.featRowHtml(Object.assign({}, base, { status: 'ok', value: undefined, history: true }));
  assert.ok(miss.includes('—（缺失）') && miss.includes('>true<'), '布尔历史均值转字符串');
  const bool = V.featRowHtml(Object.assign({}, base, { status: 'ok', value: false }));
  assert.ok(bool.includes('>false<'));
});

/* ---------- 订单状态色 ---------- */
test('orderTagCls：取消/拦截/作废/拒绝→high，恢复→low，其余→gray', () => {
  for (const s of ['已取消', '已拦截', '作废', '拒绝退款']) assert.strictEqual(V.orderTagCls(s), 'high');
  assert.strictEqual(V.orderTagCls('已恢复'), 'low');
  assert.strictEqual(V.orderTagCls('已完成'), 'gray');
});

/* ---------- 概览卡片 ---------- */
const C = { id: 'CASE-1', userId: 'U1', status: '待审', score: 85, level: 'high',
            bizOrderId: 'REF-1', time: '09-28 10:00', assignee: '李敏',
            hits: [{ code: 'R021', score: 35, reason: '退款金额6752元' }],
            bizOrders: [{ id: 'SO-9', type: '售后', amount: '¥6752', status: '已取消' }],
            evidence: '证据A' };
const P = { userId: 'U1', name: '张三', device: 'DEV_X', ip: '1.2.3.4', phone: '138****0000',
            regDays: 2, historyOrders: 5, refunds: 2, tags: ['高额退款', '退款高频'],
            devicePeers: ['U2', 'U3'], ipPeers: ['U9'] };
const D = { sceneLabel: 'after_sale_apply 售后退款' };

test('eventInfoCardHtml：基本信息、已处置后缀、机房代理标记', () => {
  const h = V.eventInfoCardHtml(C, P, D, { ipIdc: true, addrOrders: 0 }, '高危', 'high');
  assert.ok(h.includes('CASE-1') && h.includes('张三') && h.includes('REF-1'));
  assert.ok(h.includes('机房代理'));
  assert.ok(!h.includes('· 已处置'), '待审案件无状态后缀');
  const disposed = V.eventInfoCardHtml(Object.assign({}, C, { status: '已处置' }), P, D,
    { ipIdc: false, addrOrders: 0 }, '高危', 'high');
  assert.ok(disposed.includes('· 已处置'));
  assert.ok(!disposed.includes('机房代理'), '非机房 IP 不加标记');
});

test('judgementCardHtml：规则名、评分汇总与证据提示', () => {
  const h = V.judgementCardHtml(C);
  assert.ok(h.includes('R021') && h.includes('+35') && h.includes('退款金额6752元'));
  assert.ok(h.includes('高风险 Reject'));
  assert.ok(h.includes('证据提示：') && h.includes('证据A'));
  const mid = V.judgementCardHtml(Object.assign({}, C, { level: 'mid' }));
  assert.ok(mid.includes('中风险 Review'));
});

test('ordersTableHtml：状态着色', () => {
  const h = V.ordersTableHtml(C);
  assert.ok(h.includes('tag high">已取消'));
  const ok = V.ordersTableHtml(Object.assign({}, C,
    { bizOrders: [{ id: 'SO-1', type: '订单', amount: '¥1', status: '已完成' }] }));
  assert.ok(ok.includes('tag gray">已完成'));
});

/* ---------- 画像卡片 ---------- */
test('profileCardHtml：新账号标记与风险标签', () => {
  const h = V.profileCardHtml(P);
  assert.ok(h.includes('新账号'));
  assert.ok(h.includes('tag high">高额退款') && h.includes('tag high">退款高频'));
  const old = V.profileCardHtml(Object.assign({}, P, { regDays: 300, tags: [] }));
  assert.ok(!old.includes('新账号') && old.includes('无'), '老账号且无标签显示 无');
});

test('relationCardHtml：聚集度三档（高/中/—）', () => {
  const h = V.relationCardHtml({ addrOrders: 6 }, P);   // 设备2→高, IP1→中, 地址6→高
  assert.ok(h.includes('同设备账号</td><td>3</td><td class="diff-up">高'));
  assert.ok(h.includes('同IP账号</td><td>2</td><td class="muted">中'));
  assert.ok(h.includes('同收货地址</td><td>6</td><td class="diff-up">高'));
  const none = V.relationCardHtml({ addrOrders: 0 },
    Object.assign({}, P, { devicePeers: [], ipPeers: [] }));
  assert.ok(none.includes('同设备账号</td><td>1</td><td class="muted">—'));
  const few = V.relationCardHtml({ addrOrders: 2 },
    Object.assign({}, P, { devicePeers: ['U2'], ipPeers: ['U1', 'U2', 'U3'] }));
  assert.ok(few.includes('同设备账号</td><td>2</td><td class="muted">中'));
  assert.ok(few.includes('同IP账号</td><td>4</td><td class="diff-up">高'));
});

/* ---------- 处置提示（权限/终态） ---------- */
test('disposeNoteHtml：非审核员→权限提示，审核员终态→说明，其余为空', () => {
  env.ctx.window.RG.app.state.role = 'strategist';
  const perm = V.disposeNoteHtml(C);
  assert.ok(perm.includes('权限提示') && perm.includes('风控策略师'));
  env.ctx.window.RG.app.state.role = 'auditor';
  assert.strictEqual(V.disposeNoteHtml(C), '', '审核员+待审 → 无提示');
  assert.ok(V.disposeNoteHtml(Object.assign({}, C, { status: '已处置' })).includes('已终态'));
  assert.ok(V.disposeNoteHtml(Object.assign({}, C, { status: '已归档' })).includes('已终态'));
});

/* ---------- 快照/图谱/处置面板 ---------- */
test('snapshotPaneHtml：表头与行数', () => {
  const h = V.snapshotPaneHtml([
    { key: 'a', label: 'A', value: 1, history: 1, thresholds: [], status: 'ok' },
    { key: 'b', label: 'B', value: 2, history: 1, thresholds: [], status: 'high' }]);
  assert.ok(h.includes('feat-table') && (h.match(/<tr><td>/g) || []).length === 2);
});

test('graphPaneHtml：图例与 SVG 容器', () => {
  const h = V.graphPaneHtml('<svg>x</svg>');
  assert.ok(h.includes('<div class="graph-box"><svg>x</svg>') && h.includes('设备节点'));
});

test('disposePaneHtml：禁用态与黑名单维度', () => {
  const h = V.disposePaneHtml(C, P, '', false);
  assert.ok(h.includes('id="btnDispose" style="padding:9px" >') && !h.includes('disabled>确认执行'));
  const dis = V.disposePaneHtml(C, P, '', true);
  assert.strictEqual((dis.match(/disabled/g) || []).length, 3, '两个 textarea + 按钮');
  assert.ok(h.includes('data-dim="device"') && h.includes(P.device));
});
