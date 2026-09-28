/* ============================================================
 * util.js —— 通用工具：DOM / HTML 转义 / Toast / Modal / 分页
 * 全局命名空间：window.RG
 * ============================================================ */
window.RG = window.RG || {};

RG.util = (function () {
  'use strict';

  /* ---------- DOM 快捷方式 ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** HTML 转义，防止注入 */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /** 防抖 */
  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms || 300);
    };
  }

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function toast(msg, type) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = type || '';
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, 2400);
  }

  /* ---------- Modal ---------- */
  let modalSeq = 0;

  /**
   * 打开弹窗
   * @param {Object} opt { title, body(HTML), footer(HTML), width, onClose }
   * @returns 弹窗根元素（.modal-mask），可通过返回值再查询内部节点
   */
  function openModal(opt) {
    const id = 'm_' + (++modalSeq);
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.id = id;
    mask.innerHTML =
      '<div class="modal"' + (opt.width ? ' style="width:' + opt.width + 'px"' : '') + '>' +
        '<div class="m-head"><span>' + opt.title + '</span><span class="m-close" data-close>✕</span></div>' +
        '<div class="m-body">' + (opt.body || '') + '</div>' +
        (opt.footer ? '<div class="m-foot">' + opt.footer + '</div>' : '') +
      '</div>';
    mask.addEventListener('click', e => {
      if (e.target === mask || e.target.closest('[data-close]')) closeModal(mask);
    });
    $('#modalRoot').appendChild(mask);
    if (opt.onClose) mask._onClose = opt.onClose;
    return mask;
  }

  function closeModal(mask) {
    if (typeof mask === 'string') mask = document.getElementById(mask);
    if (mask && mask.parentNode) {
      if (mask._onClose) mask._onClose();
      mask.remove();
    }
  }

  /** 二次确认弹窗，返回 Promise<boolean> */
  function confirm(opt) {
    return new Promise(resolve => {
      const mask = openModal({
        title: opt.title || '操作确认',
        width: opt.width || 420,
        body: '<p style="line-height:1.8">' + opt.body + '</p>',
        footer:
          '<button class="btn" data-act="cancel">取消</button>' +
          '<button class="btn ' + (opt.danger ? 'danger' : 'primary') + '" data-act="ok">' + (opt.okText || '确认') + '</button>'
      });
      mask.addEventListener('click', e => {
        const act = e.target.closest('[data-act]');
        if (!act) return;
        closeModal(mask);
        resolve(act.dataset.act === 'ok');
      });
    });
  }

  /* ---------- 分页渲染 ---------- */
  /**
   * @param {HTMLElement} box   容器
   * @param {Object} opt { page, size, total, onPage(p) }
   */
  function renderPagination(box, opt) {
    const totalPages = Math.max(1, Math.ceil(opt.total / opt.size));
    const cur = Math.min(opt.page, totalPages);
    let btns = '';
    const add = (p, label, cls) => {
      btns += '<span class="pg ' + (cls || '') + '" data-p="' + p + '">' + (label || p) + '</span>';
    };
    add(cur - 1, '‹', cur <= 1 ? 'dis' : '');
    for (let p = 1; p <= totalPages; p++) {
      if (totalPages > 7 && p > 2 && p < totalPages - 1 && Math.abs(p - cur) > 1) {
        if (btns.indexOf('…') < 0) add('', '…', 'dis');
        continue;
      }
      add(p, null, p === cur ? 'cur' : '');
    }
    add(cur + 1, '›', cur >= totalPages ? 'dis' : '');
    box.innerHTML =
      '<div class="pagination">' + btns +
      '<span class="info">共 ' + opt.total + ' 条</span></div>';
    box.querySelector('.pagination').addEventListener('click', e => {
      const pg = e.target.closest('.pg');
      if (!pg || pg.classList.contains('dis') || pg.classList.contains('cur')) return;
      opt.onPage(+pg.dataset.p);
    });
  }

  return { $, $$, esc, debounce, toast, openModal, closeModal, confirm, renderPagination };
})();
