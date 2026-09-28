/* ============================================================
 * pages/system.js —— PG-06 系统运行监控（仅系统管理员）
 * 吞吐/延迟/健康度指标 + 各模块耗时分布 + 运行配置（保存记入审计）
 * ============================================================ */
window.RG = window.RG || {};
RG.pages = RG.pages || {};

RG.pages.system = (function () {
  'use strict';
  const { $, toast } = RG.util;
  const A = RG.api;

  let timers = [];

  function render() {
    return '' +
    '<div class="metrics" id="sCards"></div>' +
    '<div class="grid3">' +
      '<div class="card"><h3>各模块耗时分布</h3><table>' +
        '<tr><th>链路阶段</th><th>P50</th><th>P95</th><th>P99</th></tr>' +
        '<tr><td>事件网关·格式校验</td><td>3ms</td><td>8ms</td><td>12ms</td></tr>' +
        '<tr><td>黑白名单过滤</td><td>2ms</td><td>5ms</td><td>9ms</td></tr>' +
        '<tr><td>特征计算引擎</td><td>28ms</td><td>74ms</td><td>96ms</td></tr>' +
        '<tr><td>规则决策引擎</td><td>15ms</td><td>38ms</td><td>51ms</td></tr>' +
      '</table></div>' +
      '<div class="card"><h3>运行配置（管理员）</h3><table>' +
        '<tr><td>Challenge 二次验证开关</td><td style="width:90px"><span class="switch" id="cfgChallenge"></span></td></tr>' +
        '<tr><td>中风险阈值（Review 线）</td><td><input type="text" id="cfgReview" style="width:70px;text-align:center"></td></tr>' +
        '<tr><td>高风险阈值（Reject 线）</td><td><input type="text" id="cfgReject" style="width:70px;text-align:center"></td></tr>' +
        '<tr><td>案件自动归档天数</td><td><input type="text" id="cfgArchive" style="width:70px;text-align:center"></td></tr>' +
      '</table>' +
      '<button class="btn primary" id="btnSaveCfg" style="margin-top:10px">保存配置（记入审计）</button></div>' +
      '<div class="card"><h3>事件吞吐趋势 <span class="tip">近1h</span></h3><div id="tpsBox"></div>' +
      '<div class="legend"><span><i style="background:#3b6fe0"></i>请求TPS</span><span><i style="background:#3fb27f"></i>持久化TPS（异步）</span></div></div>' +
    '</div>';
  }

  function renderMetrics() {
    const tps = Math.round(320 + Math.random() * 60);
    const p99 = Math.round(150 + Math.random() * 30);
    $('#sCards').innerHTML =
      '<div class="card metric"><span class="muted">事件吞吐（当前）</span><div class="num">' + tps + ' <small>TPS</small></div><div class="delta up">峰值 518 TPS</div></div>' +
      '<div class="card metric"><span class="muted">决策接口 P99</span><div class="num" style="color:' + (p99 <= 200 ? 'var(--low)' : 'var(--high)') + '">' + p99 + ' <small>ms</small></div><div class="delta">目标 ≤ 200ms ' + (p99 <= 200 ? '✅' : '⚠ 超标') + '</div></div>' +
      '<div class="card metric"><span class="muted">特征引擎降级标记</span><div class="num" style="color:var(--low)">0.3%</div><div class="delta">快照 degraded 占比</div></div>' +
      '<div class="card metric"><span class="muted">接口健康度</span><div class="num" style="color:var(--low)">99.98%</div><div class="delta up">近24h 无故障</div></div>';
  }

  function drawTps() {
    const W = 300, H = 140;
    const mk = (base, amp) => Array.from({ length: 11 }, (_, i) =>
      H - 15 - (base + Math.random() * amp) / 600 * (H - 30))
      .map((y, i) => (i * 30).toFixed(0) + ',' + y.toFixed(1)).join(' L');
    $('#tpsBox').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="140">' +
      '<path d="M' + mk(360, 160) + '" fill="none" stroke="#3b6fe0" stroke-width="2"/>' +
      '<path d="M' + mk(110, 30) + '" fill="none" stroke="#3fb27f" stroke-width="2" stroke-dasharray="4 3"/>' +
      '</svg>';
  }

  function bindConfig() {
    A.getConfig().then(cfg => {
      $('#cfgChallenge').classList.toggle('on', cfg.challengeEnabled);
      $('#cfgReview').value = cfg.reviewLine;
      $('#cfgReject').value = cfg.rejectLine;
      $('#cfgArchive').value = cfg.archiveDays;
    });
    $('#cfgChallenge').addEventListener('click', function () { this.classList.toggle('on'); });
    $('#btnSaveCfg').addEventListener('click', () => {
      const review = parseInt($('#cfgReview').value, 10);
      const reject = parseInt($('#cfgReject').value, 10);
      const archive = parseInt($('#cfgArchive').value, 10);
      if (!(review >= 0 && review < reject && reject <= 100)) { toast('阈值无效：需满足 0 ≤ Review线 < Reject线 ≤ 100', 'err'); return; }
      if (!(archive >= 1)) { toast('归档天数需 ≥ 1', 'err'); return; }
      A.saveConfig({
        challengeEnabled: $('#cfgChallenge').classList.contains('on'),
        reviewLine: review, rejectLine: reject, archiveDays: archive
      }, RG.app.ROLE_INFO[RG.app.state.role]).then(() => toast('配置已保存，变更记入审计日志', 'ok'));
    });
  }

  function mount() {
    renderMetrics();
    drawTps();
    timers.push(setInterval(renderMetrics, 6000));
    bindConfig();
  }
  function unmount() { timers.forEach(clearInterval); timers = []; }

  return { render, mount, unmount };
})();
