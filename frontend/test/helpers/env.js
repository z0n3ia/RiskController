/* ============================================================
 * env.js —— vm 沙箱测试环境：无浏览器加载前端脚本
 * 注入 window / sessionStorage / fetch / URLSearchParams，
 * 按 index.html 的加载顺序执行脚本，暴露 window.RG。
 * ============================================================ */
'use strict';
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const JS_DIR = path.resolve(__dirname, '..', '..', 'js');

function makeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
}

/**
 * 创建沙箱并按顺序加载 js/<file>。
 * @param {Array<string>} files 如 ['mock-data.js', 'api.js']
 * @param {Function} [fetchImpl] fetch 桩：async (url, opts) => Response 形状
 */
function makeEnv(files, fetchImpl) {
  const win = {};
  const ctx = {
    window: win,
    sessionStorage: makeStorage(),
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    fetch: fetchImpl || (async () => { throw new Error('no fetch stub'); })
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // 裸标识符 RG 代理 window.RG（脚本习惯 window.RG=... 后直接写 RG.xxx）
  vm.runInContext(
    "Object.defineProperty(this, 'RG', { get: () => window.RG, set: v => { window.RG = v; }, configurable: true });",
    ctx);
  const load = f => {
    const p = path.join(JS_DIR, f);
    vm.runInContext(fs.readFileSync(p, 'utf-8'), ctx, { filename: p });
  };
  files.forEach(load);
  return {
    ctx,
    RG: win.RG,
    /** 沙箱内按需继续加载 js/<file>（用于先注入 RG.api/RG.app 桩再加载页面模块） */
    load,
    /** 运行期替换 fetch 桩 */
    setFetch: impl => { ctx.fetch = impl; },
    /** 读取沙箱内 sessionStorage */
    storage: ctx.sessionStorage
  };
}

/** 构造 Response 形状的桩返回值 */
function okJson(data, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => data };
}
const envelope = data => okJson({ code: 0, data });

module.exports = { makeEnv, okJson, envelope };
