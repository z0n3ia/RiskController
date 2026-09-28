/* ============================================================
 * pages/policy.js —— PG-03 策略与规则配置（仅风控策略师）
 * Tab1 规则管理：筛选 / 行内分值编辑 / 启停开关 / 新建·编辑(条件树构建器) / 删除
 * Tab2 名单库：黑白灰维护 / 添加 / 移出 / 批量导入（校验结果反馈）
 * 所有变更记入审计日志；新建规则默认停用，需仿真验证后开启
 * ============================================================ */
window.RG = window.RG || {};
RG.pages = RG.pages || {};

RG.pages.policy = (function () {
  'use strict';
  const { $, $$, esc, toast, openModal, closeModal, confirm, renderPagination } = RG.util;
  const A = RG.api;

  const OPS_OPTS = [['>=', '≥'], ['>', '>'], ['<=', '≤'], ['<', '<'], ['==', '=='], ['!=', '!=']];
  const SCENE_OPTS = ['通用', 'login', 'coupon_receive', 'order_create', 'order_pay', 'after_sale_apply'];
  const DIMS = ['用户', '手机号', 'IP', '设备', '地址'];
  const operator = () => RG.app.ROLE_INFO[RG.app.state.role];

  let rulesCache = [];
  let listsCache = [];
  const rFilter = { scene: '', enabled: '', kw: '' };
  const lFilter = { listType: '', dim: '', kw: '' };

  function ruleSceneTag(scene) {
    return scene === '通用' ? '<span class="tag gray">通用</span>' : '<span class="tag blue">' + scene + '</span>';
  }

  /* ================= 渲染 ================= */
  function render() {
    return '' +
    '<div class="tabs" style="margin-bottom:12px">' +
      '<div class="tab active" data-ptab="p1">规则管理<span id="ruleCount"></span></div>' +
      '<div class="tab" data-ptab="p2">名单库管理</div>' +
    '</div>' +
    /* ---- Tab1 规则管理 ---- */
    '<div class="tabpane active" id="p1">' +
      '<div class="note"><b>交互要点：</b>规则列表支持场景筛选、启停开关（行内即时生效）、权重分值行内编辑；"编辑"打开条件树构建器；新建规则默认停用，需仿真验证后开启。</div>' +
      '<div class="card" style="margin-bottom:12px"><div class="row" style="align-items:center">' +
        '<select id="rScene" style="flex:0 0 180px"><option value="">全部场景</option>' + SCENE_OPTS.filter(s => s !== '通用').map(s => '<option>' + s + '</option>').join('') + '</select>' +
        '<select id="rEnabled" style="flex:0 0 140px"><option value="">全部状态</option><option value="1">启用中</option><option value="0">已停用</option></select>' +
        '<input type="text" id="rKw" placeholder="搜索规则编码 / 名称" style="max-width:240px">' +
        '<span class="spacer"></span>' +
        '<button class="btn primary" id="btnNewRule">＋ 新建规则</button>' +
      '</div></div>' +
      '<div class="card"><table id="ruleTable"></table></div>' +
    '</div>' +
    /* ---- Tab2 名单库 ---- */
    '<div class="tabpane" id="p2">' +
      '<div class="card" style="margin-bottom:12px"><div class="row" style="align-items:center">' +
        '<div id="listStats" style="display:flex;gap:6px;flex:0 0 auto"></div>' +
        '<select id="lDim" style="flex:0 0 150px"><option value="">维度：全部</option>' + DIMS.map(d => '<option>' + d + '</option>').join('') + '</select>' +
        '<input type="text" id="lKw" placeholder="搜索实体值" style="max-width:220px">' +
        '<span class="spacer"></span>' +
        '<button class="btn" id="btnImport">⬆ 批量导入</button>' +
        '<button class="btn primary" id="btnAddList">＋ 添加名单</button>' +
      '</div></div>' +
      '<div class="card"><table id="listTable"></table>' +
      '<div class="note" style="margin-top:10px"><b>约束说明：</b>同一实体同一维度仅属一种名单类型（后写覆盖并留痕）；黑名单命中直接 Reject，白名单直接 Pass。</div></div>' +
    '</div>';
  }

  /* ================= 规则管理 ================= */
  function loadRules() {
    A.getRules(rFilter).then(list => {
      rulesCache = list;
      $('#ruleCount').textContent = '（' + list.length + '）';
      $('#ruleTable').innerHTML =
        '<tr><th>编码</th><th>规则名称</th><th>场景</th><th>条件表达式</th><th>分值</th><th>状态</th><th>更新时间</th><th>操作</th></tr>' +
        (list.length ? list.map(r =>
          '<tr' + (r.enabled ? '' : ' style="opacity:.62"') + '>' +
          '<td class="mono">' + r.code + '</td>' +
          '<td>' + esc(r.name) + (r.isNew ? ' <span class="tag mid">新建未验证</span>' : '') + '</td>' +
          '<td>' + ruleSceneTag(r.scene) + '</td>' +
          '<td class="mono muted" style="max-width:260px">' + esc(RG.mock.exprToStr(r.expr)) + '</td>' +
          '<td><input type="text" class="score-in" data-code="' + r.code + '" value="' + r.score + '" style="width:56px;text-align:center"></td>' +
          '<td><span class="switch ' + (r.enabled ? 'on' : '') + '" data-toggle="' + r.code + '"></span></td>' +
          '<td class="muted">' + r.updateTime + '</td>' +
          '<td><a data-edit="' + r.code + '">编辑</a> · <a data-sim="' + r.code + '">仿真</a> · ' +
            '<a style="color:var(--high)" data-del="' + r.code + '">删除</a></td>' +
          '</tr>').join('') : '<tr><td colspan="8" class="empty">没有符合条件的规则</td></tr>');
    });
  }

  /** 条件树构建器弹窗（编辑 / 新建共用） */
  function ruleModal(rule) {
    const isCreate = !rule;
    rule = rule || { name: '', scene: 'coupon_receive', score: 20, enabled: false, reasonTpl: '', expr: null };
    // 解析已有条件树为行数据
    const mainRows = [], orRows = [];
    (function parse(node, into) {
      if (!node) return;
      if (!node.children) into.push({ field: node.field, op: node.op, value: node.value });
      else if (node.op === 'OR') node.children.forEach(c => parse(c, orRows));
      else node.children.forEach(c => parse(c, mainRows));
    })(rule.expr, mainRows);
    if (!mainRows.length) mainRows.push({ field: 'coupon_cnt_1h', op: '>=', value: 3 });

    const featOpts = sel => RG.mock.FEATURES.map(f =>
      '<option value="' + f.key + '"' + (f.key === sel ? ' selected' : '') + '>' + f.key + '</option>').join('');
    const opOpts = sel => OPS_OPTS.map(o => '<option value="' + o[0] + '"' + (o[0] === sel ? ' selected' : '') + '>' + o[1] + '</option>').join('');

    const rowHtml = (r, group) =>
      '<div class="cond-row" data-group="' + group + '">' +
        '<select class="c-field">' + featOpts(r.field) + '</select>' +
        '<select class="op c-op">' + opOpts(r.op) + '</select>' +
        '<input type="text" class="c-val" value="' + esc(String(r.value)) + '">' +
        '<button class="btn ghost" data-delrow>✕</button></div>';

    const mask = openModal({
      title: isCreate ? '新建规则' : '编辑规则 ' + rule.code + ' · ' + esc(rule.name),
      width: 620,
      body: '' +
        '<div class="row">' +
          '<div class="field"><label>规则编码</label><input type="text" id="rCode" value="' + (isCreate ? '保存后自动生成' : rule.code) + '"' + (isCreate ? ' disabled' : '') + '></div>' +
          '<div class="field"><label class="req">规则名称</label><input type="text" id="rName" value="' + esc(rule.name) + '"></div>' +
        '</div>' +
        '<div class="row">' +
          '<div class="field"><label class="req">所属场景</label><select id="rSceneSel">' + SCENE_OPTS.map(s => '<option' + (s === rule.scene ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></div>' +
          '<div class="field"><label class="req">风险分值（权重）</label><input type="text" id="rScore" value="' + rule.score + '"></div>' +
        '</div>' +
        '<div class="field"><label class="req">条件表达式（树状构建器）</label>' +
          '<div class="cond-group"><span class="op-badge">且 AND</span><div id="condMain">' +
            mainRows.map(r => rowHtml(r, 'main')).join('') + '</div>' +
            '<button class="btn ghost" id="addCond">＋ 添加条件</button>' +
            '<div class="cond-group" style="margin-left:24px"><span class="op-badge or">或 OR（子组）</span><div id="condOr">' +
              orRows.map(r => rowHtml(r, 'or')).join('') + '</div>' +
              '<button class="btn ghost" id="addCondOr">＋ 添加条件</button></div>' +
          '</div></div>' +
        '<div class="row">' +
          '<div class="field"><label>触发原因描述模板（{特征键} 占位）</label><input type="text" id="rTpl" value="' + esc(rule.reasonTpl) + '" placeholder="近1h同设备领券账号数={device_account_cnt_1h}"></div>' +
          (isCreate ? '<div class="field"><label>启用状态</label><input type="text" value="停用（新建默认，仿真验证后开启）" disabled></div>'
            : '<div class="field"><label>启用状态</label><select id="rEnabledSel"><option value="1"' + (rule.enabled ? ' selected' : '') + '>启用</option><option value="0"' + (!rule.enabled ? ' selected' : '') + '>停用</option></select></div>') +
        '</div>',
      footer:
        '<button class="btn" data-close>取消</button>' +
        '<button class="btn" id="btnRuleSim">仿真验证</button>' +
        '<button class="btn primary" id="btnRuleSave">保存</button>'
    });

    // 条件行增删
    mask.querySelector('#addCond').addEventListener('click', () =>
      mask.querySelector('#condMain').insertAdjacentHTML('beforeend', rowHtml({ field: 'coupon_cnt_1h', op: '>=', value: 1 }, 'main')));
    mask.querySelector('#addCondOr').addEventListener('click', () =>
      mask.querySelector('#condOr').insertAdjacentHTML('beforeend', rowHtml({ field: 'ua_anomaly', op: '==', value: 'true' }, 'or')));
    mask.addEventListener('click', e => {
      if (e.target.closest('[data-delrow]')) e.target.closest('.cond-row').remove();
      if (e.target.closest('#btnRuleSim')) { closeModal(mask); location.hash = '#/simulate'; }
      if (e.target.closest('#btnRuleSave')) {
        const name = mask.querySelector('#rName').value.trim();
        const score = parseInt(mask.querySelector('#rScore').value, 10);
        let ok = true;
        if (!name) { mask.querySelector('#rName').classList.add('err'); ok = false; }
        if (!(score >= 1 && score <= 100)) { mask.querySelector('#rScore').classList.add('err'); ok = false; }
        // 收集条件行
        const read = group => $$('.cond-row', mask).filter(r => r.dataset.group === group).map(r => ({
          field: r.querySelector('.c-field').value,
          op: r.querySelector('.c-op').value,
          value: castVal(r.querySelector('.c-val').value.trim())
        })).filter(r => r.field);
        const main = read('main'), or = read('or');
        if (!main.length && !or.length) { toast('请至少配置一个条件', 'err'); return; }
        if (!ok) { toast('请检查表单填写', 'err'); return; }
        const children = main.slice();
        if (or.length) children.push({ op: 'OR', children: or });
        const saved = {
          code: isCreate ? undefined : rule.code,
          name, score,
          scene: mask.querySelector('#rSceneSel').value,
          expr: { op: 'AND', children },
          reasonTpl: mask.querySelector('#rTpl').value.trim(),
          enabled: isCreate ? false : mask.querySelector('#rEnabledSel').value === '1'
        };
        A.saveRule(saved, operator()).then(r => {
          closeModal(mask);
          toast('规则 ' + r.code + ' 已保存，变更记入审计日志', 'ok');
          loadRules();
        });
      }
    });
  }
  function castVal(v) {
    if (v === 'true') return true;
    if (v === 'false') return false;
    return isNaN(+v) || v === '' ? v : +v;
  }

  /* ================= 名单库 ================= */
  function loadLists() {
    A.getLists(lFilter).then(res => {
      listsCache = res.list;
      $('#listStats').innerHTML =
        '<span class="tag high">黑名单 ' + res.stats.black + '</span>' +
        '<span class="tag low">白名单 ' + res.stats.white + '</span>' +
        '<span class="tag mid">灰名单 ' + res.stats.gray + '</span>';
      $('#listTable').innerHTML =
        '<tr><th>名单类型</th><th>维度</th><th>实体值</th><th>加入原因</th><th>操作人</th><th>生效时间</th><th>操作</th></tr>' +
        (res.list.length ? res.list.map((it, i) =>
          '<tr><td><span class="tag ' + ({ '黑名单': 'high', '白名单': 'low', '灰名单': 'mid' }[it.listType]) + '">' + it.listType + '</span></td>' +
          '<td>' + it.dim + '</td><td class="mono">' + esc(it.value) + '</td>' +
          '<td class="muted" style="max-width:260px">' + esc(it.reason) + '</td>' +
          '<td class="muted">' + it.operator + '</td><td class="muted">' + it.time + '</td>' +
          '<td>' + (it.listType === '灰名单'
            ? '<a data-conv="' + i + '" data-to="黑名单">转黑</a> · <a data-conv="' + i + '" data-to="白名单">转白</a>'
            : '<a style="color:var(--high)" data-remove="' + i + '">移出</a>') + '</td></tr>').join('')
          : '<tr><td colspan="7" class="empty">没有符合条件的名单记录</td></tr>');
    });
  }

  /** 添加名单弹窗 */
  function addListModal() {
    const mask = openModal({
      title: '添加名单', width: 480,
      body: '' +
        '<div class="row">' +
          '<div class="field"><label class="req">名单类型</label><select id="aType"><option>黑名单</option><option>白名单</option><option>灰名单</option></select></div>' +
          '<div class="field"><label class="req">维度</label><select id="aDim">' + DIMS.map(d => '<option>' + d + '</option>').join('') + '</select></div>' +
        '</div>' +
        '<div class="field"><label class="req">实体值（多个用换行分隔）</label><textarea id="aVals" rows="4" class="mono" placeholder="U10086&#10;DEV_9f2a1c81e"></textarea></div>' +
        '<div class="field"><label class="req">加入原因</label><input type="text" id="aReason" placeholder="例如：羊毛党团伙领券（关联案件 CASE-…）"></div>' +
        '<div class="note"><b>约束：</b>同一实体同一维度仅属一种名单类型，重复添加将覆盖并留痕。</div>',
      footer: '<button class="btn" data-close>取消</button><button class="btn primary" id="btnAddListOk">确认添加</button>'
    });
    mask.querySelector('#btnAddListOk').addEventListener('click', () => {
      const values = mask.querySelector('#aVals').value;
      const reason = mask.querySelector('#aReason').value.trim();
      let ok = true;
      if (!values.trim()) { mask.querySelector('#aVals').classList.add('err'); ok = false; }
      if (!reason) { mask.querySelector('#aReason').classList.add('err'); ok = false; }
      if (!ok) { toast('请填写实体值与加入原因', 'err'); return; }
      A.addLists({ listType: mask.querySelector('#aType').value, dim: mask.querySelector('#aDim').value, values, reason, operator: operator() })
        .then(res => {
          closeModal(mask);
          toast('名单已添加 ' + res.added + ' 条' + (res.covered.length ? '，覆盖原记录 ' + res.covered.length + ' 条' : ''), 'ok');
          loadLists();
        });
    });
  }

  /** 批量导入弹窗（模拟上传 + 校验结果） */
  function importModal() {
    const mask = openModal({
      title: '名单批量导入', width: 500,
      body: '' +
        '<div class="field"><label>① 选择名单类型与维度</label>' +
          '<div class="row"><select id="iType" style="flex:0 0 120px"><option>黑名单</option><option>白名单</option><option>灰名单</option></select>' +
          '<select id="iDim"><option>IP</option><option>用户</option><option>设备</option></select></div></div>' +
        '<div class="field"><label>② 粘贴名单内容（模拟 .csv 上传，每行一个实体值）</label>' +
          '<textarea id="iVals" rows="5" class="mono" placeholder="112.74.103.55&#10;45.121.8.90&#10;not-an-ip"></textarea></div>' +
        '<div class="field"><label>③ 导入结果预览</label><div id="iResult" class="muted" style="font-size:12px">尚未执行导入</div></div>',
      footer: '<button class="btn" data-close>关闭</button><button class="btn primary" id="btnImportOk">确认导入</button>'
    });
    mask.querySelector('#btnImportOk').addEventListener('click', () => {
      const values = mask.querySelector('#iVals').value;
      if (!values.trim()) { mask.querySelector('#iVals').classList.add('err'); toast('请粘贴名单内容', 'err'); return; }
      A.importLists({ listType: mask.querySelector('#iType').value, dim: mask.querySelector('#iDim').value, values, operator: operator() })
        .then(results => {
          const okN = results.filter(r => r.ok).length;
          mask.querySelector('#iResult').innerHTML =
            '<table><tr><th>行</th><th>实体值</th><th>结果</th></tr>' +
            results.map(r => '<tr><td>' + r.idx + '</td><td class="mono">' + esc(r.value) + '</td>' +
              '<td style="color:' + (r.ok ? 'var(--low)' : 'var(--high)') + '">' + r.msg + '</td></tr>').join('') +
            '</table>';
          toast('导入完成：成功 ' + okN + ' 条，失败 ' + (results.length - okN) + ' 条', okN ? 'ok' : 'err');
          loadLists();
        });
    });
  }

  /* ================= 页面事件 ================= */
  function onClick(e) {
    const t = e.target;
    // 顶部 Tab
    const ptab = t.closest('[data-ptab]');
    if (ptab) {
      $$('#pageContainer [data-ptab]').forEach(x => x.classList.toggle('active', x === ptab));
      $$('#pageContainer > .tabpane').forEach(p => p.classList.toggle('active', p.id === ptab.dataset.ptab));
      return;
    }
    // 规则操作
    if (t.closest('#btnNewRule')) return ruleModal(null);
    const edit = t.closest('[data-edit]');   if (edit) return ruleModal(rulesCache.find(r => r.code === edit.dataset.edit));
    const sim = t.closest('[data-sim]');     if (sim) { location.hash = '#/simulate'; return; }
    const del = t.closest('[data-del]');
    if (del) {
      const r = rulesCache.find(x => x.code === del.dataset.del);
      confirm({ title: '删除规则', danger: true, okText: '确认删除',
        body: '确认删除规则 <b class="mono">' + r.code + ' ' + esc(r.name) + '</b>？<br><span class="muted">删除操作将记入审计日志。</span>' })
        .then(yes => yes && A.deleteRule(r.code, operator()).then(() => { toast('规则已删除', 'ok'); loadRules(); }));
      return;
    }
    const tg = t.closest('[data-toggle]');
    if (tg) {
      const r = rulesCache.find(x => x.code === tg.dataset.toggle);
      const next = !r.enabled;
      A.toggleRule(r.code, next, operator()).then(() => {
        toast('规则 ' + r.code + ' 已' + (next ? '启用' : '停用') + '，变更记入审计日志', 'ok');
        loadRules();
      });
      return;
    }
    // 名单操作
    if (t.closest('#btnAddList')) return addListModal();
    if (t.closest('#btnImport')) return importModal();
    const rm = t.closest('[data-remove]');
    if (rm) {
      const it = listsCache[+rm.dataset.remove];
      confirm({ title: '移出名单', danger: true, body: '确认将 <b class="mono">' + esc(it.value) + '</b> 移出' + it.listType + '（维度=' + it.dim + '）？' })
        .then(yes => yes && A.removeList({ dim: it.dim, value: it.value }, operator()).then(() => { toast('已移出并留痕', 'ok'); loadLists(); }));
      return;
    }
    const cv = t.closest('[data-conv]');
    if (cv) {
      const it = listsCache[+cv.dataset.conv], to = cv.dataset.to;
      A.removeList({ dim: it.dim, value: it.value }, operator())
        .then(() => A.addLists({ listType: to, dim: it.dim, values: it.value, reason: it.reason + '（灰名单' + to.slice(1) + '）', operator: operator() }))
        .then(() => { toast(it.value + ' 已转入' + to, 'ok'); loadLists(); });
    }
  }
  function onChange(e) {
    // 规则分值行内编辑
    const sin = e.target.closest('.score-in');
    if (sin) {
      const r = rulesCache.find(x => x.code === sin.dataset.code);
      const v = parseInt(sin.value, 10);
      if (!(v >= 1 && v <= 100)) { toast('分值需为 1~100 的整数', 'err'); sin.value = r.score; return; }
      if (v === r.score) return;
      A.saveRule(Object.assign({}, r, { score: v }), operator()).then(() => {
        toast(r.code + ' 分值已更新为 ' + v + '，变更记入审计日志', 'ok');
        loadRules();
      });
    }
  }
  let onClickFn, onChangeFn, onQuery;
  function mount() {
    onClickFn = onClick; onChangeFn = onChange;
    $('#pageContainer').addEventListener('click', onClickFn);
    $('#pageContainer').addEventListener('change', onChangeFn);
    onQuery = () => { rFilter.scene = $('#rScene').value; rFilter.enabled = $('#rEnabled').value; rFilter.kw = $('#rKw').value.trim(); loadRules(); };
    ['#rScene', '#rEnabled'].forEach(s => $(s).addEventListener('change', onQuery));
    $('#rKw').addEventListener('input', RG.util.debounce(onQuery, 300));
    $('#lDim').addEventListener('change', lQuery);
    $('#lKw').addEventListener('input', RG.util.debounce(lQuery, 300));
    loadRules();
    lQuery();
  }
  function lQuery() {
    lFilter.dim = $('#lDim') ? $('#lDim').value : '';
    lFilter.kw = $('#lKw') ? $('#lKw').value.trim() : '';
    loadLists();
  }
  function unmount() {
    $('#pageContainer').removeEventListener('click', onClickFn);
    $('#pageContainer').removeEventListener('change', onChangeFn);
  }

  return { render, mount, unmount };
})();
