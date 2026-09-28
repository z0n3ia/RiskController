/* ============================================================
 * pages/dashboard.js —— PG-01 风控态势大盘
 * 指标卡定时刷新 / 拦截率趋势(1h/24h/7d) / 风险分布环形图 /
 * 规则命中排行 / 决策动作分布 / 实时事件滚屏
 * ============================================================ */
window.RG = window.RG || {};
RG.pages = RG.pages || {};

RG.pages.dashboard = (function () {
  'use strict';
  const { $, $$, esc, toast } = RG.util;
  const A = RG.api;

  /* 规则命中排行演示数据（近24h） */
  const RANK = [
    ['R003', '同设备多账号领券', 1204], ['R007', '同IP注册账号数超标', 986],
    ['R012', '近1h领券频次异常', 713], ['R021', '高额未收货退款高频', 428],
    ['R015', '同收货地址订单聚集', 257], ['R018', '机房代理IP标识', 163]
  ];
  const LVL_COLOR = ['var(--high)', 'var(--mid)', 'var(--low)', 'var(--primary)'];
  const RANGES = { '1h': 12, '24h': 24, '7d': 7 };
  let trendRange = '24h';

  /* ---------- 趋势数据（演示：按范围生成波动序列） ---------- */
  function trendData(range) {
    const n = RANGES[range];
    const arr = [];
    for (let i = 0; i < n; i++) {
      let v = 5.5 + Math.random() * 2.2;
      if (range === '24h' && i === 17) v = 9.8;           // 大促峰值
      if (range === '1h' && i === n - 1) v = 6.4;
      arr.push(+v.toFixed(1));
    }
    return arr;
  }
  /** 数据 → SVG 折线 */
  function trendSvg(data, markIdx) {
    const W = 600, H = 200, pad = 8;
    const min = 0, max = 12;
    const pts = data.map((v, i) => [
      pad + i * (W - pad * 2) / (data.length - 1),
      H - 20 - (v - min) / (max - min) * (H - 45)
    ]);
    const line = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L');
    let peak = '';
    if (markIdx !== undefined && data[markIdx] >= 9) {
      peak = '<circle cx="' + pts[markIdx][0] + '" cy="' + pts[markIdx][1] + '" r="3.5" fill="var(--high)"/>' +
        '<text x="' + pts[markIdx][0] + '" y="' + (pts[markIdx][1] - 10) + '" font-size="10" fill="var(--high)" text-anchor="middle">大促峰值 ' + data[markIdx] + '%</text>';
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="180">' +
      [40, 80, 120, 160].map(y => '<line x1="0" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="#eef1f5"/>').join('') +
      '<path d="M' + line + '" fill="none" stroke="#3b6fe0" stroke-width="2"/>' +
      '<path d="M' + line + ' L' + (W - pad) + ',' + H + ' L' + pad + ',' + H + ' Z" fill="#3b6fe0" opacity=".08"/>' +
      peak + '</svg>';
  }

  /* ---------- 事件滚屏 ---------- */
  function feedItem(e) {
    const cls = { high: 'high', mid: 'mid', low: 'low' }[e.lvl] || 'gray';
    return '<li><span class="muted mono">' + e.time + '</span>' +
      '<span class="tag blue">' + e.type + '</span><a>' + esc(e.user) + '</a>' +
      '<span style="margin-left:auto"><span class="tag ' + cls + '">' + e.action + ' ' + e.score + '</span></span></li>';
  }
  function pushFeed() {
    if (!RG.app.state.rt) return;
    A.genEvent().then(e => {
      const ul = $('#feed');
      if (!ul) return;
      ul.insertAdjacentHTML('afterbegin', feedItem(e));
      while (ul.children.length > 16) ul.lastElementChild.remove();
    }).catch(() => { /* 服务暂无新事件时静默 */ });
  }

  /* ---------- 渲染 ---------- */
  function render() {
    const rankMax = RANK[0][2];
    const rankRows = RANK.map((r, i) =>
      '<tr><td><a data-rule="' + r[0] + '">' + r[0] + ' ' + r[1] + '</a></td>' +
      '<td style="width:45%"><div class="bar-wrap"><i style="width:' + Math.round(r[2] / rankMax * 100) + '%;background:' + LVL_COLOR[Math.min(2, i === 0 ? 0 : i < 3 ? 1 : 2)] + '"></i></div></td>' +
      '<td class="muted">' + r[2].toLocaleString() + '</td></tr>').join('');

    return '' +
    '<div class="metrics" id="mCards"></div>' +
    '<div class="grid2">' +
      '<div class="card"><h3>拦截率趋势 <span>' +
        Object.keys(RANGES).map(k => '<span class="tag click ' + (k === trendRange ? 'blue' : 'gray') + '" data-range="' + k + '">' + k + '</span>').join(' ') +
      '</span></h3>' +
      '<div id="trendBox"></div>' +
      '<div class="legend"><span><i style="background:#3b6fe0"></i>拦截率</span><span><i style="background:#eef1f5"></i>时间轴（近' + trendRange + '）</span></div></div>' +
      '<div class="card"><h3>风险等级分布 <span class="tip">近24h</span></h3>' +
        '<div style="text-align:center;padding:8px 0">' +
        '<svg viewBox="0 0 120 120" width="150" height="150">' +
          '<circle cx="60" cy="60" r="45" fill="none" stroke="#eef1f5" stroke-width="16"/>' +
          '<circle cx="60" cy="60" r="45" fill="none" stroke="#3fb27f" stroke-width="16" stroke-dasharray="175 283" transform="rotate(-90 60 60)"/>' +
          '<circle cx="60" cy="60" r="45" fill="none" stroke="#f5a623" stroke-width="16" stroke-dasharray="62 283" stroke-dashoffset="-175" transform="rotate(-90 60 60)"/>' +
          '<circle cx="60" cy="60" r="45" fill="none" stroke="#e5484d" stroke-width="16" stroke-dasharray="46 283" stroke-dashoffset="-237" transform="rotate(-90 60 60)"/>' +
          '<text x="60" y="58" text-anchor="middle" font-size="16" font-weight="700">28.6k</text>' +
          '<text x="60" y="74" text-anchor="middle" font-size="8" fill="#8a94a3">事件总量</text></svg>' +
        '<div class="legend" style="justify-content:center"><span><i style="background:#3fb27f"></i>低风险 62%</span><span><i style="background:#f5a623"></i>中风险 22%</span><span><i style="background:#e5484d"></i>高风险 16%</span></div>' +
        '</div></div>' +
    '</div>' +
    '<div class="grid3">' +
      '<div class="card"><h3>规则命中排行 <span class="tip">Top 6 · 近24h</span></h3><table>' +
        '<tr><th>规则</th><th>命中占比</th><th>次数</th></tr>' + rankRows + '</table></div>' +
      '<div class="card"><h3>决策动作分布 <span class="tip">近1h</span></h3><table>' +
        '<tr><th>动作</th><th>占比</th><th>次数</th></tr>' +
        '<tr><td><span class="tag low">Pass 放行</span></td><td>91.2%</td><td>11,716</td></tr>' +
        '<tr><td><span class="tag mid">Review 人审</span></td><td>4.1%</td><td>527</td></tr>' +
        '<tr><td><span class="tag high">Reject 拦截</span></td><td>4.7%</td><td>604</td></tr>' +
        '<tr><td><span class="tag gray">Challenge 二次验证</span></td><td>0%</td><td>' + (RG.mock.CONFIG.challengeEnabled ? '启用中' : '0（未启用）') + '</td></tr>' +
        '</table>' +
        '<div class="note" style="margin-top:12px"><b>待办提醒：</b><span id="todoN">—</span> 个案件等待处理 <a href="#/workbench">前往工作台 →</a></div></div>' +
      '<div class="card"><h3>实时事件滚屏 <span class="tag gray">WebSocket</span></h3>' +
        '<div class="scroll-feed"><ul id="feed">' +
          RG.mock.EVENTS.slice(0, 12).map(feedItem).join('') + '</ul></div></div>' +
    '</div>';
  }

  /* ---------- 指标卡 ---------- */
  function renderMetrics() {
    A.getMetrics().then(m => {
      const box = $('#mCards');
      if (!box) return;
      box.innerHTML =
        '<div class="card metric"><span class="muted">实时事件请求量（近1h）</span><div class="num">' + m.eventCount.toLocaleString() + '</div><div class="delta up">▲ 持续接入中</div></div>' +
        '<div class="card metric"><span class="muted">拦截率（近1h）</span><div class="num" style="color:var(--high)">' + m.interceptRate + '%</div><div class="delta down">▼ 0.9% 较上一小时</div></div>' +
        '<div class="card metric"><span class="muted">待审案件</span><div class="num" style="color:var(--mid)">' + m.pendingCases + '</div><div class="delta down">高危 ' + m.pendingHigh + '</div></div>' +
        '<div class="card metric"><span class="muted">预估挽回资损（今日）</span><div class="num" style="color:var(--low)">¥ ' + m.savedAmount.toLocaleString() + '</div><div class="delta up">按拦截订单金额估算</div></div>';
      const todo = $('#todoN');
      if (todo) todo.textContent = m.pendingCases + m.pendingHigh;
    });
  }

  /* ---------- 事件绑定 ---------- */
  let timers = [];
  function onClick(e) {
    const range = e.target.closest('[data-range]');
    if (range) { trendRange = range.dataset.range; drawTrend(); return; }
    const rule = e.target.closest('[data-rule]');
    if (rule) {
      if (RG.app.ROUTES.policy.roles.includes(RG.app.state.role)) location.hash = '#/policy';
      else toast('「策略与规则配置」仅风控策略师可访问', 'err');
    }
  }
  function mount() {
    renderMetrics();
    drawTrend();
    // 分钟级刷新（演示降为 8s）
    timers.push(setInterval(renderMetrics, 8000));
    timers.push(setInterval(pushFeed, 3000));
    $('#pageContainer').addEventListener('click', onClick);
  }
  function drawTrend() {
    const data = trendData(trendRange);
    const mark = trendRange === '24h' ? 17 : undefined;
    $('#trendBox').innerHTML = trendSvg(data, mark);
    // 更新范围按钮选中态与图例
    $$('[data-range]').forEach(t => t.classList.toggle('blue', t.dataset.range === trendRange));
    const lg = $('#trendBox').nextElementSibling;
    if (lg) lg.lastElementChild.textContent = '时间轴（近' + trendRange + '）';
  }
  function unmount() {
    timers.forEach(clearInterval); timers = [];
    $('#pageContainer').removeEventListener('click', onClick);
  }

  return { render, mount, unmount };
})();
