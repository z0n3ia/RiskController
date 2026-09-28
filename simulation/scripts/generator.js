/* ============================================================
 * generator.js —— 模拟事件流生成器（纯逻辑，剧本参数全部来自 data/）
 *
 * 读取：data/users.json（画像）、data/scenarios.json（剧本）
 * 写出：data/events_stream.jsonl（按时间升序，一行一个事件）
 *
 * 运行：node scripts/generator.js（或 npm run generate）
 * 固定随机种子，数据集可复现。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

/* ---------- 加载纯数据 ---------- */
const seedUsers = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8')).users;
const scenariosCfg = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'scenarios.json'), 'utf8'));

/* ---------- 可复现随机数（mulberry32） ---------- */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(scenariosCfg.seed || 42);
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const randInt = ([a, b]) => a + Math.floor(rnd() * (b - a + 1));

/* ---------- 合成背景用户（稀释单用户行为密度，使流量接近真实分布） ---------- */
function synthUsers(n) {
  const arr = [];
  for (let i = 1; i <= n; i++) {
    const regMs = Date.parse('2024-01-01T00:00:00') + rnd() * (Date.parse('2026-07-01T00:00:00') - Date.parse('2024-01-01T00:00:00'));
    arr.push({
      userId: 'UB' + String(i).padStart(4, '0'),
      name: '背景用户-' + i,
      group: 'normal',
      regTime: fmt(regMs),
      device: 'DEV_BG' + rnd().toString(16).slice(2, 10),
      ip: `${randInt([1, 223])}.${randInt([0, 255])}.${randInt([0, 255])}.${randInt([1, 254])}`,
      ipIdc: false, uaAnomaly: false,
      address: 'ADDR_BG_' + String(i).padStart(3, '0'),
      tags: []
    });
  }
  return arr;
}
const users = seedUsers.concat(synthUsers(scenariosCfg.baseline.syntheticUsers || 0));
const USER_MAP = new Map(users.map(u => [u.userId, u]));

/* ---------- 时间工具 ---------- */
const DAY = scenariosCfg.day;
const at = hm => Date.parse(`${DAY}T${hm}`);
function pad(n, w = 2) { return String(n).padStart(w, '0'); }
function fmt(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function dayCompact() { return DAY.replaceAll('-', ''); }

/* ---------- 事件构造 ---------- */
let seq = 0;
let orderSeq = 50000, couponSeq = 80000, refundSeq = 11000;
function makeEvent(t, eventType, userId, payload) {
  const u = USER_MAP.get(userId);
  const id = { order_create: () => `ORD-${dayCompact()}-${++orderSeq}`,
    coupon_receive: () => `CPN-${dayCompact()}-${++couponSeq}`,
    after_sale_apply: () => `REF-${dayCompact()}-${++refundSeq}`,
    login: () => null, order_pay: () => `PAY-${dayCompact()}-${++orderSeq}` }[eventType]();
  return {
    eventId: 'EVT-' + pad(++seq, 6),
    timestamp: fmt(t), eventType, userId,
    bizOrderId: id, deviceId: u.device, ip: u.ip, payload: payload || {}
  };
}
/** 在窗口内生成 count 个随机时刻（升序） */
function timesInWindow(win, count) {
  const a = at(win.start), b = at(win.end);
  return Array.from({ length: count }, () => a + rnd() * (b - a)).sort((x, y) => x - y);
}

/* ---------- 基线正常流量 ---------- */
function genBaseline() {
  const { eventsPerMinute, mix, payloadDefaults } = scenariosCfg.baseline;
  const baseUsers = users.map(u => u.userId);   // 全量用户（含合成背景用户）共同承载基线流量
  const events = [];
  const mixEntries = Object.entries(mix);
  for (let m = at(scenariosCfg.stream.start); m < at(scenariosCfg.stream.end); m += 60_000) {
    for (let i = 0; i < eventsPerMinute; i++) {
      // 按权重混合选事件类型
      let r = rnd(), type = mixEntries[0][0];
      for (const [k, w] of mixEntries) { if (r < w) { type = k; break; } r -= w; }
      const userId = pick(baseUsers);
      const d = payloadDefaults[type] || {};
      let payload = { ...d };
      if (d.amountRange) payload.amount = randInt(d.amountRange);
      if (d.refundAmountRange) { payload.refundAmount = randInt(d.refundAmountRange); payload.orderId = 'ORD-HIST-' + randInt([10000, 99999]); }
      events.push(makeEvent(m + Math.floor(rnd() * 60_000), type, userId, payload));
    }
  }
  return events;
}

/* ---------- 场景事件 ---------- */
function genScenario(sc) {
  const events = [];
  if (sc.orderPhase) { // 退款欺诈前的正常下单铺垫
    for (const t of timesInWindow(sc.orderPhase.window, sc.orderPhase.count)) {
      events.push(makeEvent(t, sc.orderPhase.eventType, sc.actors[0],
        { ...sc.orderPhase.payload, addressId: USER_MAP.get(sc.actors[0]).address }));
    }
  }
  const count = sc.type === 'coupon_burst' ? sc.actors.length * sc.claimsPerUser
    : sc.type === 'refund_fraud' ? sc.count
    : sc.type === 'order_burst' ? sc.count : 0;
  const claims = timesInWindow(sc.window, count);
  let i = 0;
  for (const userId of sc.actors) {
    const n = sc.type === 'coupon_burst' ? sc.claimsPerUser : count;
    for (let k = 0; k < n && i < claims.length; k++, i++) {
      events.push(makeEvent(claims[i], sc.eventType, userId, { ...sc.payload }));
    }
  }
  // 处置后重试（换号换设备，IP 不变）
  if (sc.postDisposeRetry) {
    const rt = sc.postDisposeRetry;
    const retryTimes = timesInWindow(rt.window, rt.actors.length * rt.claimsPerUser);
    let j = 0;
    for (const userId of rt.actors) {
      for (let k = 0; k < rt.claimsPerUser; k++, j++) {
        events.push(makeEvent(retryTimes[j], rt.eventType, userId, { ...sc.payload }));
      }
    }
  }
  return events;
}

/* ---------- 主流程 ---------- */
const all = [...genBaseline(), ...scenariosCfg.scenarios.flatMap(genScenario)];
all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
all.forEach((e, i) => { e.eventId = 'EVT-' + pad(i + 1, 6); });

const out = path.join(DATA_DIR, 'events_stream.jsonl');
fs.writeFileSync(out, all.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
// 回放所需的完整画像（种子画像 + 合成背景用户）供 demo/引擎加载
fs.writeFileSync(path.join(DATA_DIR, 'users_stream.json'),
  JSON.stringify({ users }, null, 2), 'utf8');

const byType = {};
for (const e of all) byType[e.eventType] = (byType[e.eventType] || 0) + 1;
console.log(`✔ 事件流已生成：${out}`);
console.log(`  用户画像已更新：${path.join(DATA_DIR, 'users_stream.json')}（共 ${users.length} 人）`);
console.log(`  总事件 ${all.length} 条，时间范围 ${all[0].timestamp} ~ ${all[all.length - 1].timestamp}`);
console.log('  类型分布：' + JSON.stringify(byType));
