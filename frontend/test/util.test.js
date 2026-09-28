/* util.test.js —— RG.util 纯函数测试（vm 沙箱，无浏览器） */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./helpers/env');

const env = makeEnv(['util.js']);
const U = env.RG.util;

test('esc 转义 HTML 特殊字符', () => {
  const out = U.esc('<img src=x onerror="alert(1)">&\'');
  assert.ok(!out.includes('<') && !out.includes('>'), '不得残留尖括号');
  assert.ok(out.includes('&lt;img') && out.includes('&amp;'));
  assert.strictEqual(U.esc('abc123'), 'abc123', '普通文本原样通过');
});

test('debounce 只执行最后一次调用', async () => {
  let n = 0;
  const d = U.debounce(() => { n++; }, 30);
  d(); d(); d();
  await new Promise(r => setTimeout(r, 15));
  assert.strictEqual(n, 0, '等待期内不执行');
  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(n, 1, '冷却结束后只执行一次');
});
