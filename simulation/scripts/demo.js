/* ============================================================
 * demo.js —— 演示脚本（端到端回放）
 *
 * 流程：
 *   阶段一：回放处置前事件流 → 实时决策输出 → 中高风险自动建档
 *   处置  ：按剧本模拟审核员「拉黑」操作（写入引擎名单库）
 *   阶段二：回放处置后事件流 → 团伙换号重试被名单直接拦截（对抗效果）
 *   汇总  ：决策分布 / 案件清单 / 预估挽回资损
 *
 * 运行：node scripts/demo.js（或 npm run demo）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RiskEngine } from './engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const load = f => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));

/* ---------- 加载纯数据 ---------- */
const users = load('users_stream.json').users;   // 完整画像（含合成背景用户，由 generator 产出）
const { rules } = load('rules.json');
const blacklist = load('blacklist.json').entries;
const scenarios = load('scenarios.json');
const events = fs.readFileSync(path.join(DATA_DIR, 'events_stream.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));

const engine = new RiskEngine({ users, rules, blacklist });
const SC1 = scenarios.scenarios[0];           // 演示场景一（必选）
const disposeAt = `${scenarios.day}T${SC1.dispose.at}`;

/* ---------- 输出工具 ---------- */
const hm = e => e.timestamp.slice(11, 19);
const line = (mark, e, extra) =>
  console.log(`[${mark}] ${hm(e)} ${e.eventId} ${e.userId.padEnd(7)} ${e.eventType.padEnd(17)}${extra}`);

/* ---------- 案件登记（模拟案件流转模块：中高风险自动建档） ---------- */
let caseSeq = 0;
const cases = [];
const dayCompact = scenarios.day.replaceAll('-', '');
function openCase(d) {
  const c = {
    caseId: `CASE-${dayCompact}-${String(++caseSeq).padStart(3, '0')}`,
    eventId: d.event.eventId, userId: d.event.userId, eventType: d.event.eventType,
    level: d.action === 'Reject' ? '高危' : '中风险', score: d.score, hits: d.hits
  };
  cases.push(c);
  return c;
}

/* ================= 阶段一：处置前回放 ================= */
console.log('═'.repeat(78));
console.log(`阶段一　回放事件流（${scenarios.stream.start} ~ ${SC1.dispose.at}，处置前）`);
console.log('═'.repeat(78));

const stats = { Pass: 0, Review: 0, Reject: 0, listReject: 0, listPass: 0 };
let firstCaseDecision = null;
let savedAmount = 0;
let elapsedSum = 0, elapsedN = 0;
let whiteShown = false;

for (const e of events) {
  if (Date.parse(e.timestamp) >= Date.parse(disposeAt)) break;
  const d = engine.decide(e);
  elapsedSum += d.elapsed; elapsedN++;

  if (d.listHit) { // 名单命中
    if (d.action === 'Reject') stats.listReject++; else stats.listPass++;
    if (d.listHit.type === '白名单') {
      if (!whiteShown) {
        whiteShown = true;
        line('LIST-W', e, '│ 命中白名单（用户）→ Pass（后续白名单放行不再逐条打印）');
      }
    } else {
      line('LIST-B', e, `│ 命中黑名单（${d.listHit.dim}）→ Reject`);
    }
    continue;
  }
  stats[d.action]++;
  if (d.action === 'Pass') continue;          // 正常放行不逐条打印

  const c = openCase(d);
  const hitsTxt = d.hits.map(h => `${h.code}(+${h.score})`).join(' ') || '—';
  line(d.action === 'Reject' ? 'REJECT' : 'REVIEW', e,
    `│ ${hitsTxt} = ${d.score}分 → ${d.action}　建档 ${c.caseId}`);
  if (!firstCaseDecision && d.action === 'Reject') firstCaseDecision = d;
  if (d.action === 'Reject') {
    const p = e.payload || {};
    savedAmount += p.amount || p.refundAmount || 0;
  }
}

console.log(`\n[摘要] 正常放行 ${stats.Pass} 条（略） · 人审 ${stats.Review} 条 · 拦截 ${stats.Reject} 条 · 名单命中 ${stats.listPass + stats.listReject} 条`);

/* 特征快照示例（首个高危案件） */
if (firstCaseDecision) {
  const f = firstCaseDecision.features;
  console.log('\n[特征快照示例] 首个高危案件 ' + firstCaseDecision.event.userId + ' 异常特征：');
  for (const [k, v] of Object.entries(f)) {
    const abnormal = ['device_account_cnt_1h', 'ip_register_cnt', 'coupon_cnt_1h', 'ua_anomaly', 'ip_idc_flag'].includes(k);
    if (abnormal) console.log(`   · ${k} = ${v}`);
  }
}

/* ================= 模拟审核处置 ================= */
console.log('\n' + '═'.repeat(78));
console.log(`模拟审核处置　${SC1.dispose.at}　${SC1.name}`);
console.log('═'.repeat(78));

const gangUsers = [...new Set(cases.filter(c => SC1.actors.includes(c.userId)).map(c => c.userId))];
const dimSources = { user: gangUsers, device: [], ip: [] };
for (const uid of gangUsers) {
  const u = users.find(x => x.userId === uid);
  if (!dimSources.device.includes(u.device)) dimSources.device.push(u.device);
  if (!dimSources.ip.includes(u.ip)) dimSources.ip.push(u.ip);
}
const DIM_NAME = { user: '用户', device: '设备', ip: 'IP' };
console.log(`${SC1.dispose.operator} 对团伙 ${gangUsers.length} 个涉案账号执行「${SC1.dispose.conclusion}」（关联案件 ${cases.filter(c => SC1.actors.includes(c.userId)).length} 件）：`);
for (const dim of SC1.dispose.blackDims) {
  for (const value of dimSources[dim]) {
    engine.addList({ listType: '黑名单', dim: DIM_NAME[dim], value,
      reason: '羊毛党团伙领券（案件 ' + cases[0].caseId + ' 等）', operator: SC1.dispose.operator, time: SC1.dispose.at });
    console.log(`   · ${DIM_NAME[dim]} ${value} → 写入黑名单`);
  }
}

/* ================= 阶段二：处置后回放（对抗效果） ================= */
console.log('\n' + '═'.repeat(78));
console.log(`阶段二　回放处置后事件流（${SC1.dispose.at} 之后）—— 团伙换号重试`);
console.log('═'.repeat(78));

let phase2Reject = 0;
for (const e of events) {
  if (Date.parse(e.timestamp) < Date.parse(disposeAt)) continue;
  const d = engine.decide(e);
  elapsedSum += d.elapsed; elapsedN++;
  if (d.listHit && d.action === 'Reject') {
    stats.listReject++;
    line('LIST-B', e, `│ 命中黑名单（${d.listHit.dim}）→ Reject ⛔ 名单拦截（未产生规则计算）`);
    phase2Reject++;
  } else if (d.action !== 'Pass') {
    const c = openCase(d);
    line(d.action, e, `│ ${d.hits.map(h => `${h.code}(+${h.score})`).join(' ')} = ${d.score}分 → ${d.action}　建档 ${c.caseId}`);
    stats[d.action]++;
  } else {
    stats.Pass++;
  }
}

/* ================= 汇总 ================= */
console.log('\n' + '═'.repeat(78));
console.log('演示汇总');
console.log('═'.repeat(78));
console.log(`事件总量　　　：${events.length} 条`);
console.log(`决策分布　　　：Pass ${stats.Pass} · Review ${stats.Review} · Reject ${stats.Reject} · 名单拦截 ${phase2Reject} · 白名单放行 ${stats.listPass}`);
console.log(`自动建档案件　：${cases.length} 件（高危 ${cases.filter(c => c.level === '高危').length} / 中风险 ${cases.filter(c => c.level === '中风险').length}）`);
console.log(`黑名单联动　　：用户 ${gangUsers.length} · 设备 ${dimSources.device.length} · IP ${dimSources.ip.length}`);
console.log(`对抗效果　　　：处置后团伙重试 ${phase2Reject} 次全部被名单直接拦截（规则引擎零耗时）`);
console.log(`预估挽回资损　：¥ ${savedAmount.toLocaleString()}（按拦截事件金额累计）`);
console.log(`单事件决策耗时：平均 ${(elapsedSum / Math.max(1, elapsedN)).toFixed(2)}ms（离线回放；在线模式要求 P99 ≤ 200ms）`);
