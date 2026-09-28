/* ============================================================
 * pages/workbench.js —— PG-02 风控审核工作台
 * 案件筛选/列表/分页 + 详情五 Tab（概览/画像/特征快照/图谱/研判处置）
 * 处置闭环：结论选择 → 必填校验 → 二次确认 → 状态流转/名单/审计联动
 * 权限：全员可查看；处置（放行/拦截/拉黑）仅风控审核员（PRD §2.2）
 * ============================================================ */
window.RG = window.RG || {};
RG.pages = RG.pages || {};

RG.pages.workbench = (function () {
  'use strict';
  const { $, $$, esc, toast, openModal, closeModal, confirm, renderPagination } = RG.util;
  const A = RG.api;

  const LVL = { high: ['高危', 'high'], mid: ['中风险', 'mid'], low: ['低风险', 'low'] };
  const ST = { '待审': 'mid', '审核中': 'blue', '已处置': 'gray', '已归档': 'gray' };
  const filter = { level: '', scene: '', status: '', kw: '', page: 1, size: 10 };
  let total = 0;
  let selectedId = null;   // 当前选中案件

  /* ================= 渲染 ================= */
  function render() {
    return '' +
    '<div class="ws-grid">' +
      /* 左：筛选 + 列表 */
      '<div class="ws-left">' +
        '<div class="card">' +
          '<div class="row field"><select id="fLevel"><option value="">全部风险等级</option><option value="high">高危</option><option value="mid">中风险</option></select>' +
          '<select id="fScene"><option value="">全部事件场景</option>' + Object.keys(RG.mock.SCENES).map(k => '<option value="' + k + '">' + k + '</option>').join('') + '</select></div>' +
          '<div class="row field"><select id="fStatus"><option value="">全部审核状态</option><option>待审</option><option>审核中</option><option>已处置</option></select>' +
          '<input type="text" id="fKw" placeholder="案件编号 / 用户编号"></div>' +
          '<button class="btn primary block" id="btnQuery">查询案件</button>' +
        '</div>' +
        '<div class="list" id="caseList"></div>' +
        '<div id="casePager"></div>' +
      '</div>' +
      /* 右：详情 */
      '<div class="ws-right"><div class="card" id="caseDetail">' +
        '<div class="empty">← 请选择左侧案件查看详情</div>' +
      '</div></div>' +
    '</div>';
  }

  /* ================= 案件列表 ================= */
  function loadList() {
    return A.getCaseList(filter).then(res => {
      total = res.total;
      const box = $('#caseList');
      if (!res.list.length) { box.innerHTML = '<div class="empty">没有符合条件的案件</div>'; }
      else {
        box.innerHTML = res.list.map(c => {
          const [lvlTxt, lvlCls] = LVL[c.level];
          return '<div class="case-item ' + (c.id === selectedId ? 'sel' : '') + '" data-id="' + c.id + '">' +
            '<div class="top"><b class="mono" style="font-size:12px">' + c.id + '</b>' +
            '<span class="tag ' + lvlCls + '">' + lvlTxt + ' ' + c.score + '</span></div>' +
            '<div style="margin:3px 0">' + RG.mock.SCENES[c.scene] + '</div>' +
            '<div class="muted" style="font-size:11px">用户 ' + c.userId + ' · ' + c.time.slice(11) +
            ' · <span class="tag ' + ST[c.status] + '">' + c.status + '</span> ' +
            c.hits.map(h => '<span class="tag blue">' + h.code + '</span>').join(' ') + '</div></div>';
        }).join('');
      }
      renderPagination($('#casePager'), { page: filter.page, size: filter.size, total, onPage: p => { filter.page = p; loadList(); } });
      // 未选中或选中项不在列表中 → 默认选第一条
      if (!selectedId || !res.list.some(c => c.id === selectedId)) {
        if (res.list.length) selectCase(res.list[0].id);
      }
    });
  }

  /* ================= 案件详情 ================= */
  function selectCase(id) {
    selectedId = id;
    $$('.case-item').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
    A.getCase(id).then(data => { renderDetail(data); })
      .catch(msg => toast(msg, 'err'));
  }

  function canDispose() { return RG.app.state.role === 'auditor'; }

  /* ---------- 详情视图构建（纯字符串函数，Node 可单测；renderDetail 仅编排） ---------- */

  function tabsHtml() {
    return '<div class="tabs">' +
      ['案件概览', '用户画像', '特征快照对比', '关联实体图谱', '研判与处置'].map((t, i) =>
        '<div class="tab ' + (i === 0 ? 'active' : '') + '" data-tab="w' + (i + 1) + '">' + t + '</div>').join('') +
      '</div>';
  }

  function featRowHtml(f) {
    const valTxt = typeof f.value === 'boolean' ? String(f.value) : (f.value === undefined ? '—（缺失）' : f.value);
    const hisTxt = typeof f.history === 'boolean' ? String(f.history) : f.history;
    const st = f.status === 'high' ? '<span class="tag high">异常</span>'
      : f.status === 'mid' ? '<span class="tag mid">关注</span>' : '<span class="tag gray">正常</span>';
    return '<tr><td>' + f.key + ' ' + f.label + '</td><td class="' + (f.status === 'high' ? 'diff-up' : '') + '">' + valTxt + '</td>' +
      '<td>' + hisTxt + '</td><td class="muted">' + (f.thresholds.length ? esc(f.thresholds.join('；')) : '—') + '</td><td>' + st + '</td></tr>';
  }

  function orderTagCls(status) {
    if (status.includes('取消') || status.includes('拦截') ||
        status.includes('作废') || status.includes('拒绝')) return 'high';
    return status.includes('恢复') ? 'low' : 'gray';
  }

  function eventInfoCardHtml(c, p, d, mockUser, lvlTxt, lvlCls) {
    return '<div class="card" style="background:#fafbfd"><h3>事件基本信息 <span class="tag ' + lvlCls + '">' + lvlTxt + ' ' + (c.status === '已处置' ? '· ' + c.status : '') + ' · 得分 ' + c.score + '</span></h3><table>' +
      '<tr><td class="muted" width="30%">案件编号</td><td class="mono">' + c.id + '</td></tr>' +
      '<tr><td class="muted">事件类型</td><td><span class="tag blue">' + d.sceneLabel + '</span></td></tr>' +
      '<tr><td class="muted">涉事用户</td><td><a>' + c.userId + '（' + esc(p.name) + '）</a></td></tr>' +
      '<tr><td class="muted">业务单据</td><td class="mono">' + c.bizOrderId + '</td></tr>' +
      '<tr><td class="muted">设备指纹</td><td class="mono">' + p.device + ' <span class="tag ' + (p.devicePeers.length ? 'high' : 'gray') + '">关联 ' + (p.devicePeers.length + 1) + ' 账号</span></td></tr>' +
      '<tr><td class="muted">请求 IP</td><td class="mono">' + p.ip + (mockUser.ipIdc ? ' <span class="tag mid">机房代理</span>' : '') + '</td></tr>' +
      '<tr><td class="muted">触发时间</td><td>' + c.time + '</td></tr>' +
      '<tr><td class="muted">审核状态</td><td><span class="tag ' + ST[c.status] + '">' + c.status + '</span>　处理人：' + c.assignee + '</td></tr>' +
      '</table></div>';
  }

  function judgementCardHtml(c) {
    return '<div class="card" style="background:#fafbfd"><h3>系统判定摘要</h3><table>' +
      '<tr><th>命中规则</th><th>分值</th><th>触发原因</th></tr>' +
      c.hits.map(h => '<tr><td>' + h.code + ' ' + esc(ruleName(h.code)) + '</td><td class="diff-up">+' + h.score + '</td><td class="muted">' + esc(h.reason) + '</td></tr>').join('') +
      '<tr><td colspan="3" class="muted">共命中 ' + c.hits.length + ' 条规则，累计 ' + c.score + ' 分 → ' +
        (c.level === 'high' ? '高风险 Reject' : '中风险 Review') + '，自动创建案件</td></tr>' +
      '</table>' +
      '<div class="note" style="margin-top:10px"><b>证据提示：</b>' + esc(c.evidence) + '</div></div>';
  }

  function ordersTableHtml(c) {
    return '<h3 style="margin:12px 0 8px">关联订单 / 券信息</h3><table>' +
      '<tr><th>单据</th><th>类型</th><th>金额/面额</th><th>状态</th></tr>' +
      c.bizOrders.map(o => '<tr><td class="mono">' + o.id + '</td><td>' + o.type + '</td><td>' + o.amount + '</td><td><span class="tag ' + orderTagCls(o.status) + '">' + o.status + '</span></td></tr>').join('') +
      '</table>';
  }

  function profileCardHtml(p) {
    return '<div class="card"><h3>账号画像</h3><table>' +
      '<tr><td class="muted" width="32%">用户编号</td><td class="mono">' + p.userId + '（' + esc(p.name) + '）</td></tr>' +
      '<tr><td class="muted">注册天数</td><td>' + p.regDays + ' 天' + (p.regDays <= 3 ? ' <span class="tag high">新账号</span>' : '') + '</td></tr>' +
      '<tr><td class="muted">历史订单</td><td>' + p.historyOrders + ' 单</td></tr>' +
      '<tr><td class="muted">历史退款</td><td>' + p.refunds + ' 次</td></tr>' +
      '<tr><td class="muted">手机号</td><td class="mono">' + p.phone + '</td></tr>' +
      '<tr><td class="muted">风险标签</td><td>' + (p.tags.length ? p.tags.map(t => '<span class="tag ' + (t.length <= 2 ? 'mid' : 'high') + '">' + esc(t) + '</span>').join(' ') : '<span class="muted">无</span>') + '</td></tr>' +
      '</table></div>';
  }

  function relationCardHtml(mockUser, p) {
    const heat = (n, hi) => '<td class="' + (n >= hi ? 'diff-up' : 'muted') + '">' + (n >= hi ? '高' : n ? '中' : '—') + '</td>';
    const addr = mockUser.addrOrders || 0;
    return '<div class="card"><h3>关联维度汇总</h3><table>' +
      '<tr><th>维度</th><th>关联实体数</th><th>异常度</th></tr>' +
      '<tr><td>同设备账号</td><td>' + (p.devicePeers.length + 1) + '</td>' + heat(p.devicePeers.length, 2) + '</tr>' +
      '<tr><td>同IP账号</td><td>' + (p.ipPeers.length + 1) + '</td>' + heat(p.ipPeers.length, 3) + '</tr>' +
      '<tr><td>同收货手机号</td><td>0</td><td class="muted">—</td></tr>' +
      '<tr><td>同收货地址</td><td>' + addr + '</td>' + heat(addr, 5) + '</tr>' +
      '</table></div>';
  }

  function disposeNoteHtml(c) {
    if (!canDispose())
      return '<div class="note"><b>权限提示：</b>当前角色「' + RG.app.ROLE_INFO[RG.app.state.role] + '」仅可查看案件，处置操作需风控审核员执行。</div>';
    return (c.status === '已处置' || c.status === '已归档')
      ? '<div class="note"><b>说明：</b>该案件已终态，不可重复处置。</div>' : '';
  }

  function snapshotPaneHtml(snapshot) {
    return '<div class="tabpane" id="w3">' +
      '<div class="note"><b>展示逻辑：</b>当前值 vs 用户历史均值 / 规则阈值，异常项红色高亮；特征缺失时显示降级标记。</div>' +
      '<table class="feat-table"><tr><th>特征项</th><th>当前值</th><th>历史均值</th><th>规则阈值</th><th>状态</th></tr>' +
      snapshot.map(featRowHtml).join('') + '</table></div>';
  }

  function graphPaneHtml(graphSvg) {
    return '<div class="tabpane" id="w4">' +
      '<div class="note"><b>交互说明：</b>节点可点击下钻查看实体详情；连线粗细表示关联强度；同设备/同IP 聚集账号一目了然。</div>' +
      '<div class="graph-box">' + graphSvg + '</div>' +
      '<div class="legend"><span><i style="background:#fdecec;border:1px solid #e5484d"></i>设备节点</span>' +
        '<span><i style="background:#e8effc;border:1px solid #3b6fe0"></i>用户节点</span>' +
        '<span><i style="background:#fdf3e2;border:1px solid #c07d10"></i>IP节点</span><span>★ 案件主体</span></div>' +
      '</div>';
  }

  function disposePaneHtml(c, p, note, disabled) {
    return '<div class="tabpane" id="w5">' +
      '<div class="note"><b>处置规则：</b>提交前需填写处置原因备注与核查依据；点击"确认执行"触发二次确认弹窗；处置后联动业务单据状态并写入不可篡改审计日志。</div>' +
      note +
      '<div class="row">' +
      '<div class="card"><h3>处理结论</h3>' +
        '<div class="dispose-opts">' +
          '<div class="opt" data-c="pass">✅ 放行<br><small class="muted">恢复关联单据</small></div>' +
          '<div class="opt danger" data-c="reject">⛔ 拦截<br><small class="muted">取消订单/拒绝退款</small></div>' +
          '<div class="opt danger" data-c="black">🚫 拉黑用户<br><small class="muted">拦截+主体入黑名单</small></div>' +
        '</div>' +
        '<div id="blackDims" style="display:none;margin-bottom:10px">' +
          '<label class="muted" style="font-size:12px">选择加入黑名单的维度（可多选）：</label>' +
          '<div class="dims">' +
            '<span class="tag blue click dim-tag" data-dim="user">用户账号 ' + p.userId + '</span>' +
            '<span class="tag blue click dim-tag" data-dim="phone">手机号 ' + p.phone + '</span>' +
            '<span class="tag blue click dim-tag" data-dim="ip">IP ' + p.ip + '</span>' +
            '<span class="tag blue click dim-tag" data-dim="device">设备 ' + p.device + '</span>' +
          '</div></div>' +
        '<div class="field"><label class="req">处置原因备注</label><textarea id="dReason" rows="2" ' + (disabled ? 'disabled' : '') + ' placeholder="例如：确认为羊毛党团伙领券行为，证据充分"></textarea></div>' +
        '<div class="field"><label class="req">核查依据</label><textarea id="dEvidence" rows="3" ' + (disabled ? 'disabled' : '') + ' placeholder="例如：同设备6账号1h内领券4张大额券，命中R003(+45)/R007(+40)，综合85分"></textarea></div>' +
        '<button class="btn primary block" id="btnDispose" style="padding:9px" ' + (disabled ? 'disabled' : '') + '>确认执行处置</button>' +
      '</div>' +
      '<div class="card"><h3>处置动作预览</h3><table>' +
        '<tr><th>系统联动动作</th><th>对象</th><th>结果</th></tr>' +
        '<tr><td>拦截/恢复关联订单</td><td class="mono">' + esc(c.bizOrders.map(o => o.id).join('、')) + '</td><td>提交后执行</td></tr>' +
        '<tr><td>主体写入黑名单库</td><td>按所选维度</td><td>拉黑时执行</td></tr>' +
        '<tr><td>写入审计日志（append-only）</td><td>AUD-自动生成</td><td>提交后执行</td></tr>' +
        '<tr><td>案件状态流转</td><td>' + c.status + ' → 已处置</td><td>提交后执行</td></tr>' +
      '</table></div>' +
      '</div></div>';
  }

  function renderDetail(d) {
    const c = d.caseInfo, p = d.profile;
    const mockUser = RG.mock.getUser(c.userId);
    const [lvlTxt, lvlCls] = LVL[c.level];
    const disabled = !canDispose() || c.status === '已处置' || c.status === '已归档';
    $('#caseDetail').innerHTML =
      tabsHtml() +
      /* w1 案件概览 */
      '<div class="tabpane active" id="w1"><div class="row">' +
        eventInfoCardHtml(c, p, d, mockUser, lvlTxt, lvlCls) + judgementCardHtml(c) +
      '</div>' +
      ordersTableHtml(c) + '</div>' +
      /* w2 用户画像 */
      '<div class="tabpane" id="w2"><div class="row">' +
        profileCardHtml(p) + relationCardHtml(mockUser, p) +
      '</div></div>' +
      /* w3 特征快照对比 */
      snapshotPaneHtml(d.snapshot) +
      /* w4 关联实体图谱 */
      graphPaneHtml(buildGraph(p)) +
      /* w5 研判与处置 */
      disposePaneHtml(c, p, disposeNoteHtml(c), disabled);
    bindDetail(c, p);
  }

  function ruleName(code) {
    const r = RG.mock.RULES.find(x => x.code === code);
    return r ? r.name : '';
  }

  /* ================= 关联实体图谱（数据驱动 SVG） ================= */
  function buildGraph(p) {
    const nodes = [], edges = [];
    // 设备节点（中心）
    nodes.push({ id: 'dev', x: 320, y: 130, r: 26, fill: '#fdecec', stroke: '#e5484d', lines: ['设备', p.device.slice(0, 9) + '…'] });
    // 案件主体用户 + 同设备账号（左侧）
    const deviceUsers = [p.userId].concat(p.devicePeers);
    deviceUsers.forEach((u, i) => {
      const y = 45 + i * 58;
      nodes.push({ id: 'u:' + u, x: 140, y, r: 17, fill: '#e8effc', stroke: '#3b6fe0', lines: [u === p.userId ? u + ' ★' : u] });
      edges.push({ x1: 320, y1: 130, x2: 140, y2: y, c: '#e5484d', w: u === p.userId ? 2.5 : 1.8, strong: true });
    });
    // IP 节点 + 同IP账号（右侧）
    nodes.push({ id: 'ip', x: 480, y: 130, r: 20, fill: '#fdf3e2', stroke: '#c07d10', lines: ['IP', p.ip.split('.').pop()] });
    edges.push({ x1: 320, y1: 130, x2: 480, y2: 130, c: '#e5484d', w: 2, strong: true });
    p.ipPeers.forEach((u, i) => {
      const y = 40 + i * 55;
      nodes.push({ id: 'u:' + u, x: 590, y, r: 14, fill: '#eef1f5', stroke: '#8a94a3', lines: [u] });
      edges.push({ x1: 480, y1: 130, x2: 590, y2: y, c: '#d8dee6', w: 1.4 });
    });
    const entityInfo = id => {
      if (id === 'dev') return '设备 ' + p.device + '：关联 ' + deviceUsers.length + ' 个账号';
      if (id === 'ip') return 'IP ' + p.ip + '：关联 ' + (p.ipPeers.length + 1) + ' 个账号';
      const u = id.slice(2);
      const up = RG.mock.getUser(u);
      return '用户 ' + u + '（' + up.name + '）：注册 ' + up.regDays + ' 天，标签：' + (up.tags.join('、') || '无');
    };
    return '<svg viewBox="0 0 660 260">' +
      edges.map(e => '<line x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2 + '" stroke="' + e.c + '" stroke-width="' + e.w + '"/>').join('') +
      nodes.map(n => '<g class="gnode" data-entity="' + n.id + '">' +
        '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + n.r + '" fill="' + n.fill + '" stroke="' + n.stroke + '" stroke-width="2"/>' +
        n.lines.map((t, i) => '<text x="' + n.x + '" y="' + (n.y + (i === 0 ? -2 : 10) + (n.lines.length === 1 ? 4 : 0)) + '" text-anchor="middle" font-size="' + (n.lines.length === 1 ? 8 : 9) + '" fill="' + n.stroke + '">' + t + '</text>').join('') +
        '</g>').join('') +
      '<text class="edge-label" x="212" y="120" fill="#e5484d">同设备 ×' + deviceUsers.length + '</text>' +
      '<text class="edge-label" x="416" y="122" fill="#c07d10">同IP ×' + (p.ipPeers.length + 1) + '</text>' +
      '</svg>';
    // 节点点击下钻信息在 bindDetail 中以 data-entity 委托处理
  }

  /* ================= 详情区事件绑定 ================= */
  function bindDetail(c, p) {
    const box = $('#caseDetail');
    // Tabs
    box.querySelector('.tabs').addEventListener('click', e => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      $$('.tab', box).forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.tabpane', box).forEach(pa => pa.classList.remove('active'));
      $('#' + tab.dataset.tab, box).classList.add('active');
    });
    // 图谱节点下钻
    box.querySelectorAll('.gnode').forEach(g => {
      g.addEventListener('click', () => {
        const info = { dev: '设备 ' + p.device + '（关联 ' + (p.devicePeers.length + 1) + ' 账号）',
          ip: 'IP ' + p.ip + '（关联 ' + (p.ipPeers.length + 1) + ' 账号）' }[g.dataset.entity];
        const uid = (g.dataset.entity || '').slice(2);
        const up = RG.mock.getUser(uid);
        openModal({
          title: '实体详情', width: 420,
          body: '<table>' +
            '<tr><td class="muted" width="30%">实体</td><td>' + (info ? info : '用户 ' + uid + '（' + esc(up.name) + '）') + '</td></tr>' +
            (uid ? '<tr><td class="muted">注册天数</td><td>' + up.regDays + ' 天</td></tr>' +
            '<tr><td class="muted">风险标签</td><td>' + (up.tags.join('、') || '无') + '</td></tr>' : '') +
          '</table>',
          footer: '<button class="btn" data-close>关闭</button>'
        });
      });
    });
    // 处置：结论选择
    let conclusion = null;
    const opts = box.querySelectorAll('.dispose-opts .opt');
    opts.forEach(o => o.addEventListener('click', () => {
      if (o.classList.contains('disabled') || $('#btnDispose').disabled) return;
      opts.forEach(x => x.classList.remove('sel'));
      o.classList.add('sel');
      conclusion = o.dataset.c;
      $('#blackDims').style.display = conclusion === 'black' ? 'block' : 'none';
    }));
    // 黑名单维度多选
    box.querySelectorAll('.dim-tag').forEach(t => t.addEventListener('click', () => {
      t.classList.toggle('blue'); t.classList.toggle('gray');
    }));
    // 提交处置
    const btn = $('#btnDispose');
    if (btn) btn.addEventListener('click', () => {
      const reason = $('#dReason').value.trim();
      const evidence = $('#dEvidence').value.trim();
      let ok = true;
      [['#dReason', reason], ['#dEvidence', evidence]].forEach(([sel, v]) => {
        $(sel).classList.toggle('err', !v);
        if (!v) ok = false;
      });
      if (!conclusion) { toast('请先选择处理结论', 'err'); return; }
      if (!ok) { toast('请填写处置原因备注与核查依据（必填）', 'err'); return; }
      const dims = $$('.dim-tag.blue').map(t => t.dataset.dim);
      if (conclusion === 'black' && !dims.length) { toast('拉黑处置至少选择一个名单维度', 'err'); return; }
      const cTxt = { pass: '放行', reject: '拦截', black: '拉黑用户' }[conclusion];
      confirm({
        title: '⚠ 处置操作二次确认',
        danger: conclusion !== 'pass',
        okText: '确认执行',
        body: '确认对案件 <b class="mono">' + c.id + '</b> 执行 <b style="color:var(--high)">「' + cTxt + '」</b> 处置？' +
          '<table style="margin-top:10px">' +
          '<tr><td class="muted" width="35%">联动动作</td><td>' +
            (conclusion === 'black' ? '取消关联订单 · 写入黑名单（' + dims.map(d => ({ user: '账号', phone: '手机号', ip: 'IP', device: '设备' }[d])).join('/') + '）'
              : conclusion === 'reject' ? '取消关联订单 / 拒绝退款' : '恢复关联单据') + '</td></tr>' +
          '<tr><td class="muted">审计留痕</td><td>处置人 + 结论 + 依据将写入不可篡改审计日志</td></tr>' +
          '<tr><td class="muted">案件状态</td><td>' + c.status + ' → 已处置</td></tr>' +
          '</table>' +
          '<div class="field" style="margin-top:12px"><label>请输入操作密码 / 动态口令确认</label><input type="password" id="dPwd" placeholder="演示环境：任意输入"></div>'
      }).then(yes => {
        if (!yes) return;
        A.disposeCase({ caseId: c.id, conclusion, dims, reason, evidence, operator: RG.app.ROLE_INFO[RG.app.state.role] })
          .then(res => {
            toast('处置已执行：' + res.conclusion + ' · 单据联动 · 审计留痕完成' + (res.blackAdded.length ? ' · 黑名单新增 ' + res.blackAdded.length + ' 项' : ''), 'ok');
            loadList();
            selectCase(c.id);
          })
          .catch(msg => toast(msg, 'err'));
      });
    });
  }

  /* ================= 页面事件 ================= */
  function onListClick(e) {
    const item = e.target.closest('.case-item');
    if (item) selectCase(item.dataset.id);
  }
  function mount() {
    $('#pageContainer').addEventListener('click', onListClick);
    $('#btnQuery').addEventListener('click', () => {
      filter.level = $('#fLevel').value;
      filter.scene = $('#fScene').value;
      filter.status = $('#fStatus').value;
      filter.kw = $('#fKw').value.trim();
      filter.page = 1;
      loadList();
    });
    loadList();
  }
  function unmount() {
    $('#pageContainer').removeEventListener('click', onListClick);
  }

  return {
    render, mount, unmount,
    /* 纯视图构建函数，供 Node 单测（frontend/test）使用 */
    _views: { tabsHtml, featRowHtml, orderTagCls, eventInfoCardHtml, judgementCardHtml,
              ordersTableHtml, profileCardHtml, relationCardHtml, disposeNoteHtml,
              snapshotPaneHtml, graphPaneHtml, disposePaneHtml }
  };
})();
