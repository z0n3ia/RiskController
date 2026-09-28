/* ============================================================
 * pages/audit.js —— PG-05 操作审计流水
 * append-only 审计日志检索；策略师仅可见策略变更部分（规则/名单变更）
 * ============================================================ */
window.RG = window.RG || {};
RG.pages = RG.pages || {};

RG.pages.audit = (function () {
  'use strict';
  const { $, $$, esc, toast, renderPagination } = RG.util;
  const A = RG.api;

  const TYPE_CLS = { '案件处置': 'high', '规则变更': 'blue', '名单变更': 'mid', '登录': 'gray' };
  const page = { no: 1, size: 10 };
  let total = 0;
  const isStrategist = () => RG.app.state.role === 'strategist';

  function render() {
    return '' +
    '<div class="note"><b>说明：</b>审计日志 append-only、不可篡改，覆盖审核处置与规则变更两类操作；支持按操作人/类型/时间检索' +
      (isStrategist() ? '。<b>当前角色（风控策略师）仅可查看策略变更部分（规则变更 / 名单变更）。</b>' : '。') + '</div>' +
    '<div class="filter-bar card">' +
      '<select id="aType" style="flex:0 0 150px"><option value="">全部操作类型</option><option>案件处置</option><option>规则变更</option><option>名单变更</option><option>登录</option></select>' +
      '<select id="aOperator" style="flex:0 0 170px"><option value="">全部操作人</option>' +
        ['审核员·李敏', '审核员·王强', '策略师·陈晨', '管理员·admin'].map(o => '<option>' + o + '</option>').join('') + '</select>' +
      '<input type="text" id="aKw" placeholder="搜索内容 / 对象">' +
      '<button class="btn primary" id="btnQuery">查询</button>' +
    '</div>' +
    '<div class="card"><table id="auditTable"></table><div id="auditPager"></div></div>';
  }

  function load() {
    A.getAuditLogs({
      type: $('#aType').value,
      operator: $('#aOperator').value,
      kw: $('#aKw').value.trim(),
      scope: isStrategist() ? 'policy' : ''
    }).then(res => {
      const list = res.list;
      total = list.length;
      const rows = list.slice((page.no - 1) * page.size, page.no * page.size);
      $('#auditTable').innerHTML =
        '<tr><th>日志编号</th><th>操作类型</th><th>操作人</th><th>操作内容</th><th>对象</th><th>时间</th></tr>' +
        (rows.length ? rows.map(a =>
          '<tr><td class="mono">' + a.id + '</td>' +
          '<td><span class="tag ' + (TYPE_CLS[a.type] || 'gray') + '">' + a.type + '</span></td>' +
          '<td class="muted">' + a.operator + '</td>' +
          '<td style="max-width:420px">' + esc(a.content) + '</td>' +
          '<td>' + targetLink(a) + '</td>' +
          '<td class="muted mono">' + a.time + '</td></tr>').join('')
          : '<tr><td colspan="6" class="empty">没有符合条件的日志</td></tr>');
      renderPagination($('#auditPager'), { page: page.no, size: page.size, total, onPage: p => { page.no = p; load(); } });
    });
  }

  /** 对象跳转：case → 工作台 / rule、list → 策略配置 */
  function targetLink(a) {
    if (a.targetType === 'case' && a.target !== '—') {
      return '<a href="#/workbench">' + esc(a.target) + '</a>';
    }
    if ((a.targetType === 'rule' || a.targetType === 'list') && a.target !== '—') {
      if (RG.app.ROUTES.policy.roles.includes(RG.app.state.role)) return '<a href="#/policy">' + esc(a.target) + '</a>';
      return '<span class="muted">' + esc(a.target) + '</span>';
    }
    return '<span class="muted">' + esc(a.target) + '</span>';
  }

  let onQ;
  function mount() {
    onQ = () => { page.no = 1; load(); };
    $('#btnQuery').addEventListener('click', onQ);
    $('#aType').addEventListener('change', onQ);
    $('#aOperator').addEventListener('change', onQ);
    $('#aKw').addEventListener('input', RG.util.debounce(onQ, 300));
    load();
  }
  function unmount() { /* 静态绑定随 innerHTML 销毁，无需清理 */ }

  return { render, mount, unmount };
})();
