/* ============================================================
 * pages/simulate.js —— PG-04 事件仿真测试
 * 用例模板加载 / 表单+JSON 双模式 / 执行链路可视化
 * （①名单过滤 ②特征提取 ③规则命中 ④综合决策）
 * 仿真不产生真实案件、不写业务状态
 * ============================================================ */
window.RG = window.RG || {};
RG.pages = RG.pages || {};

RG.pages.simulate = (function () {
  'use strict';
  const { $, $$, esc, toast } = RG.util;
  const A = RG.api;

  let tplIdx = -1;        // 当前模板
  let running = false;
  let _beRules = null;    // 后端规则缓存（未命中对照表数据源）

  function render() {
    return '' +
    '<div class="note"><b>交互要点：</b>支持模板加载 / JSON与表单双模式；点击"执行仿真"后单步呈现 ①名单过滤 ②特征提取 ③规则命中 ④决策输出；仿真不产生真实案件、不写业务状态。</div>' +
    '<div class="sim-grid">' +
      '<div>' +
        '<div class="card" style="margin-bottom:12px"><h3>测试用例模板</h3><table id="tplTable">' +
          RG.mock.SIM_TEMPLATES.map((t, i) =>
            '<tr><td><a class="tpl-link' + (i === 0 ? ' tpl-cur' : '') + '" data-tpl="' + i + '">' + t.name + '</a></td>' +
            '<td class="muted">期望：' + t.expect + '</td></tr>').join('') +
        '</table></div>' +
        '<div class="card"><h3>事件参数构建 <span>' +
          '<span class="tag blue click" id="fmForm" data-mode="form">表单模式</span> ' +
          '<span class="tag gray click" id="fmJson" data-mode="json">JSON模式</span></span></h3>' +
          '<div id="simForm">' +
            '<div class="field"><label>事件类型</label><select id="sType">' +
              Object.keys(RG.mock.SCENES).map(k => '<option value="' + k + '">' + k + '</option>').join('') + '</select></div>' +
            '<div class="row">' +
              '<div class="field"><label class="req">用户编号</label><input type="text" id="sUser" value="U10086"></div>' +
              '<div class="field"><label>业务单据号</label><input type="text" id="sOrder" value="CPN-20260927-TEST01"></div>' +
            '</div>' +
            '<div class="row">' +
              '<div class="field"><label>设备指纹（画像自动关联）</label><input type="text" id="sDev" value="DEV_9f2a1c81e" disabled></div>' +
              '<div class="field"><label>请求 IP（画像自动关联）</label><input type="text" id="sIp" value="112.74.103.55" disabled></div>' +
            '</div>' +
            '<div class="field"><label>事件参数（JSON）</label><textarea id="sPayload" rows="4" class="mono">{"couponId":"CPN_L50","amount":50,"channel":"h5"}</textarea></div>' +
          '</div>' +
          '<div id="simJson" style="display:none">' +
            '<textarea id="sJson" rows="11" class="mono">' + esc(JSON.stringify({
              eventType: 'coupon_receive', userId: 'U10086',
              deviceId: 'DEV_9f2a1c81e', ip: '112.74.103.55',
              bizOrderId: 'CPN-20260927-TEST01',
              payload: { couponId: 'CPN_L50', amount: 50 }
            }, null, 2)) + '</textarea></div>' +
          '<button class="btn primary block" id="btnRun" style="padding:9px;margin-top:8px">▶ 执行仿真检测</button>' +
        '</div>' +
      '</div>' +
      '<div class="card" id="simResult"><h3>执行链路可视化 <span class="tip">单步回溯</span></h3>' + chainHtml() + '</div>' +
    '</div>';
  }

  function chainHtml() {
    const step = (i, id, title, body) =>
      '<div class="chain-step">' +
        (i < 4 ? '<div class="idx" id="i' + i + '">' + i + '</div><div class="line" id="l' + i + '"></div>' : '<div class="idx pending" id="i4">4</div>') +
        '<div class="chain-body"><b>' + title + '</b><div id="' + id + '" class="muted" style="margin-top:6px">待执行</div></div>' +
      '</div>';
    return step(1, 'r0', '黑白名单快速过滤', '') +
      step(2, 'r1', '特征提取结果（滑动窗口快照）', '') +
      step(3, 'r2', '规则命中链路', '') +
      step(4, 'r3', '综合决策输出', '<div class="muted" style="margin-top:8px;font-size:11px">※ 仿真模式：不产生真实案件、不写业务状态</div>');
  }

  /* ---------- 模板加载 ---------- */
  function loadTpl(i) {
    tplIdx = i;
    const t = RG.mock.SIM_TEMPLATES[i];
    if (mode === 'form') {
      $('#sType').value = t.event.type;
      $('#sUser').value = t.event.userId;
      $('#sPayload').value = JSON.stringify(t.event.payload);
      const p = RG.mock.getUser(t.event.userId);
      $('#sDev').value = p.device;
      $('#sIp').value = p.ip;
    } else {
      $('#sJson').value = JSON.stringify({
        eventType: t.event.type, userId: t.event.userId,
        deviceId: RG.mock.getUser(t.event.userId).device, ip: RG.mock.getUser(t.event.userId).ip,
        bizOrderId: 'SIM-TEST-' + Date.now(), payload: t.event.payload
      }, null, 2);
    }
    resetChain();
    $$('.tpl-link').forEach(a => a.classList.toggle('tpl-cur', +a.dataset.tpl === i));
    toast('已载入模板：' + t.name);
  }

  /* ---------- 表单/JSON 切换 ---------- */
  let mode = 'form';
  function setMode(m) {
    mode = m;
    $('#simForm').style.display = m === 'form' ? 'block' : 'none';
    $('#simJson').style.display = m === 'json' ? 'block' : 'none';
    $('#fmForm').className = 'tag click ' + (m === 'form' ? 'blue' : 'gray');
    $('#fmJson').className = 'tag click ' + (m === 'json' ? 'blue' : 'gray');
  }

  /* ---------- 链路重置与渲染 ---------- */
  function resetChain() {
    ['i1', 'i2', 'i3'].forEach(i => $('#' + i).className = 'idx');
    $('#i4').className = 'idx pending';
    ['l1', 'l2', 'l3'].forEach(i => $('#' + i).className = 'line');
    ['r0', 'r1', 'r2', 'r3'].forEach(i => {
      const el = $('#' + i);
      if (i === 'r3') { el.innerHTML = '<div class="muted" style="margin-top:8px;font-size:11px">※ 仿真模式：不产生真实案件、不写业务状态</div>'; return; }
      el.className = 'muted';
      el.style.marginTop = '6px';
      el.textContent = '待执行';
    });
  }
  function setStep(i, html) {
    const el = $('#' + (i === 4 ? 'r3' : 'r' + (i - 1)));
    el.innerHTML = html;
    el.className = '';
    $('#i' + i).classList.add('done');
    $('#i' + i).classList.remove('pending');
    if (i < 4) $('#l' + i).classList.add('done');
  }

  /* ---------- 执行仿真 ---------- */
  function readEvent() {
    if (mode === 'json') {
      try {
        const j = JSON.parse($('#sJson').value);
        return { type: j.eventType || j.type, userId: j.userId };
      } catch (e) { toast('JSON 格式错误：' + e.message, 'err'); return null; }
    }
    const payloadTxt = $('#sPayload').value.trim();
    try { if (payloadTxt) JSON.parse(payloadTxt); }
    catch (e) { toast('事件参数 JSON 格式错误：' + e.message, 'err'); return null; }
    if (!$('#sUser').value.trim()) { $('#sUser').classList.add('err'); toast('请填写用户编号', 'err'); return null; }
    $('#sUser').classList.remove('err');
    return { type: $('#sType').value, userId: $('#sUser').value.trim() };
  }

  function runSim() {
    if (running) return;
    const ev = readEvent();
    if (!ev) return;
    running = true;
    $('#btnRun').disabled = true;
    resetChain();
    A.simulate(ev).then(res => {
      const t1 = setTimeout(() => setStep(1, res.steps.list), 350);
      const t2 = setTimeout(() => {
        if (!res.features) { // 名单直接命中时无需特征提取
          setStep(2, '<div class="muted">名单已命中，跳过特征提取</div>');
          return;
        }
        setStep(2, '<table class="feat-table" style="margin-top:6px">' +
          '<tr><td class="muted" colspan="3">用户 ' + esc(ev.userId) + '（' + esc(RG.mock.getUser(ev.userId).name) + '）特征快照</td></tr>' +
          res.features.map(f =>
            '<tr><td>' + f.key + '</td><td class="' + (f.status === 'high' ? 'diff-up' : '') + '">' +
            (typeof f.value === 'boolean' ? f.value : esc(f.value)) + '</td>' +
            '<td class="muted">' + (f.status === 'high' ? '异常' : f.status === 'mid' ? '关注' : '正常') + '</td></tr>').join('') +
          '</table>');
      }, 900);
      const t3 = setTimeout(() => {
        const hitCodes = res.hits.map(h => h.code);
        const rules = _beRules || RG.mock.RULES;   // 优先后端规则，兜底本地
        const miss = rules.filter(r =>
          r.enabled && (r.scene === '通用' || r.scene === ev.type) && hitCodes.indexOf(r.code) < 0);
        setStep(3, res.hits.map(h =>
          '<div class="rule-hit hit"><span>✅ ' + h.code + ' ' + esc(h.name) + ' <span class="muted">（' + esc(h.reason) + '）</span></span><b>+' + h.score + '</b></div>').join('') +
          miss.map(r => '<div class="rule-hit"><span>◻ ' + r.code + ' ' + esc(r.name) + '</span><span class="no">未命中（+0）</span></div>').join('') || '<div class="muted">无命中规则</div>');
      }, 1500);
      const t4 = setTimeout(() => {
        const cls = res.action === 'Reject' ? 'reject' : res.action === 'Review' ? 'review' : 'pass';
        const desc = res.action === 'Reject' ? '高风险·直接拦截并自动创建风险案件'
          : res.action === 'Review' ? '中风险·生成人工审核案件' : '低风险·正常放行';
        setStep(4, '<div class="verdict ' + cls + '" style="margin-top:6px">' +
          '综合得分 <span class="score-ring">' + res.score + '</span> 分 → 决策：<span style="font-size:18px">' + res.action + '</span><br>' +
          '<small style="font-weight:400;font-size:12px">' + desc + '</small></div>' +
          '<div class="muted" style="margin-top:8px;font-size:11px">※ 仿真模式：不产生真实案件、不写业务状态 · 用时 ' + res.elapsed + 'ms（P99 内）</div>');
        running = false;
        $('#btnRun').disabled = false;
      }, 2000);
      simTimers.push(t1, t2, t3, t4);
    }).catch(msg => {
      running = false;
      $('#btnRun').disabled = false;
      toast(msg, 'err');
    });
  }

  let simTimers = [];
  function onClick(e) {
    const tpl = e.target.closest('[data-tpl]');
    if (tpl) return loadTpl(+tpl.dataset.tpl);
    const m = e.target.closest('[data-mode]');
    if (m) return setMode(m.dataset.mode);
    if (e.target.closest('#btnRun')) return runSim();
  }
  function mount() {
    $('#pageContainer').addEventListener('click', onClick);
    tplIdx = 0;
    A.getRules().then(rs => { _beRules = rs; }).catch(() => { _beRules = null; });
  }
  function unmount() {
    simTimers.forEach(clearTimeout); simTimers = [];
    running = false;
    $('#pageContainer').removeEventListener('click', onClick);
  }

  return { render, mount, unmount };
})();
