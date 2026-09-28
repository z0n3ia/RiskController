/* mock-data.test.js —— Mock 数据完整性与客户端条件树求值器测试 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./helpers/env');

const M = makeEnv(['mock-data.js']).RG.mock;

test('规则目录：≥9 条且字段齐全', () => {
  assert.ok(M.RULES.length >= 9, `实际 ${M.RULES.length} 条`);
  for (const r of M.RULES) {
    assert.ok(r.code && r.name && r.scene && typeof r.score === 'number', `字段缺失: ${r.code}`);
    assert.ok(r.expr && typeof r.reasonTpl === 'string', `expr/reasonTpl 缺失: ${r.code}`);
  }
});

test('reasonTpl 占位符必须是特征目录中的合法 key', () => {
  const keys = new Set(M.FEATURES.map(f => f.key));
  for (const r of M.RULES) {
    for (const m of r.reasonTpl.matchAll(/\{([^}]+)\}/g)) {
      assert.ok(keys.has(m[1]), `${r.code} 引用未知特征 ${m[1]}`);
    }
  }
});

test('SCENES 覆盖五类事件', () => {
  for (const s of ['login', 'coupon_receive', 'order_create', 'order_pay', 'after_sale_apply']) {
    assert.ok(M.SCENES[s], `缺少场景标签: ${s}`);
  }
});

test('evalTree：叶子比较与 AND/OR 组合', () => {
  const feats = { a: 6, b: 'x', c: false };
  assert.strictEqual(M.evalTree({ field: 'a', op: '>=', value: 6 }, feats), true);
  assert.strictEqual(M.evalTree({ field: 'a', op: '>', value: 6 }, feats), false);
  assert.strictEqual(M.evalTree({ field: 'a', op: '==', value: 6 }, feats), true);
  assert.strictEqual(M.evalTree({ field: 'c', op: '==', value: false }, feats), true);
  assert.strictEqual(M.evalTree({ field: 'missing', op: '>=', value: 1 }, feats), false, '特征缺失 → 不命中');
  const AND = { op: 'AND', children: [
    { field: 'a', op: '>=', value: 5 }, { field: 'b', op: '==', value: 'x' }] };
  assert.strictEqual(M.evalTree(AND, feats), true);
  const OR = { op: 'OR', children: [
    { field: 'a', op: '<', value: 1 }, { field: 'b', op: '==', value: 'x' }] };
  assert.strictEqual(M.evalTree(OR, feats), true);
});

test('exprToStr：操作符翻译与嵌套拼接', () => {
  assert.strictEqual(
    M.exprToStr({ field: 'device_account_cnt_1h', op: '>=', value: 6 }),
    'device_account_cnt_1h ≥ 6');
  const tree = { op: 'AND', children: [
    { field: 'a', op: '<=', value: 3 },
    { field: 'b', op: '!=', value: 0 }] };
  assert.strictEqual(M.exprToStr(tree), 'a ≤ 3 AND b ≠ 0');
});

test('clone 为深拷贝', () => {
  const src = { a: { b: [1, 2] } };
  const out = M.clone(src);
  out.a.b.push(3);
  assert.deepStrictEqual(src.a.b, [1, 2], '原对象不受影响');
});

test('名单库种子含三类名单且事件池/仿真模板非空', () => {
  const types = new Set(M.LISTS.map(x => x.listType));
  for (const t of ['黑名单', '白名单', '灰名单']) assert.ok(types.has(t));
  assert.ok(M.EVENT_POOL.length > 0 && M.SIM_TEMPLATES.length > 0);
});
