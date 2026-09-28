/* ============================================================
 * app.js —— 应用入口：登录 / 角色权限 / hash 路由 / 导航
 * ============================================================ */
window.RG = window.RG || {};

RG.app = (function () {
  'use strict';
  const { $, $$, toast } = RG.util;

  /* ================= 角色与路由（按 PRD §2.2 权限矩阵） ================= */
  const ROLE_INFO = {
    auditor: '风控审核员', strategist: '风控策略师', admin: '系统管理员'
  };
  const ROUTES = {
    dashboard: { title: '风控态势大盘', icon: '📊', roles: ['auditor', 'strategist', 'admin'] },
    workbench: { title: '风控审核工作台', icon: '🗂', roles: ['auditor', 'strategist', 'admin'] },
    policy:    { title: '策略与规则配置', icon: '⚙️', roles: ['strategist'] },
    simulate:  { title: '事件仿真测试', icon: '🧪', roles: ['auditor', 'strategist', 'admin'] },
    audit:     { title: '操作审计流水', icon: '📜', roles: ['strategist', 'admin'] },
    system:    { title: '系统运行监控', icon: '🖥', roles: ['admin'] }
  };

  const state = { role: null, account: null, rt: true, current: null };

  /* ================= 登录 / 登出 ================= */
  let pickedRole = null;

  function bindLogin() {
    const pick = $('#rolePick');
    pick.addEventListener('click', e => {
      const role = e.target.closest('.role');
      if (!role) return;
      $$('.role', pick).forEach(r => r.classList.remove('sel'));
      role.classList.add('sel');
      pickedRole = role.dataset.role;
      $('#loginErr').textContent = '';
    });
    $('#loginBtn').addEventListener('click', doLogin);
    $('#loginPwd').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  }

  async function doLogin() {
    const account = $('#loginUser').value.trim();
    const pwd = $('#loginPwd').value;
    const err = $('#loginErr');
    if (!account) { err.textContent = '请输入账号'; return; }
    if (!pwd) { err.textContent = '请输入密码'; return; }
    if (!pickedRole) { err.textContent = '请先选择登录角色'; return; }
    try {
      await RG.api.login(account, pwd, pickedRole);
      state.role = pickedRole;
      state.account = account;
      sessionStorage.setItem('rg_role', pickedRole);
      sessionStorage.setItem('rg_account', account);
      enterApp();
    } catch (msg) {
      err.textContent = msg;
    }
  }

  function logout() {
    sessionStorage.removeItem('rg_role');
    sessionStorage.removeItem('rg_account');
    if (state.current && RG.pages[state.current].unmount) RG.pages[state.current].unmount();
    state.role = null; state.current = null;
    $('#app').classList.remove('show');
    $('#login').style.display = 'flex';
  }

  function enterApp() {
    $('#login').style.display = 'none';
    $('#app').classList.add('show');
    $('#curRole').textContent = ROLE_INFO[state.role];
    renderNav();
    if (!location.hash || !ROUTES[hashName()]) location.hash = '#/dashboard';
    route();
  }

  /* ================= 导航（按角色过滤） ================= */
  function renderNav() {
    $('#sideNav').innerHTML = Object.keys(ROUTES)
      .filter(key => ROUTES[key].roles.includes(state.role))
      .map(key => '<a data-page="' + key + '" href="#/' + key + '">' + ROUTES[key].icon + ' ' + ROUTES[key].title + '</a>')
      .join('');
  }

  /* ================= 路由 ================= */
  function hashName() { return (location.hash || '').replace(/^#\//, ''); }

  function route() {
    if (!state.role) return;
    let name = hashName();
    const conf = ROUTES[name];
    if (!conf) { location.hash = '#/dashboard'; return; }
    if (!conf.roles.includes(state.role)) {
      toast('当前角色无权访问「' + conf.title + '」', 'err');
      if (name === 'dashboard') return;
      location.hash = '#/dashboard';
      return;
    }
    // 旧页面清理定时器等资源
    if (state.current && RG.pages[state.current] && RG.pages[state.current].unmount) {
      RG.pages[state.current].unmount();
    }
    const mod = RG.pages[name];
    const box = $('#pageContainer');
    box.innerHTML = mod.render();
    if (mod.mount) mod.mount();
    $$('#sideNav a').forEach(a => a.classList.toggle('active', a.dataset.page === name));
    $('#pageTitle').textContent = conf.title;
    state.current = name;
  }

  /* ================= 启动 ================= */
  function boot() {
    bindLogin();
    $('#logoutBtn').addEventListener('click', logout);
    $('#rtSwitch').addEventListener('click', function () {
      this.classList.toggle('on');
      state.rt = this.classList.contains('on');
      toast(state.rt ? '实时推送已开启' : '实时推送已暂停');
    });
    window.addEventListener('hashchange', route);

    // 已有会话则自动恢复登录态
    const saved = sessionStorage.getItem('rg_role');
    if (saved && ROLE_INFO[saved]) {
      pickedRole = saved;
      state.role = saved;
      state.account = sessionStorage.getItem('rg_account');
      $$('#rolePick .role').forEach(r => r.classList.toggle('sel', r.dataset.role === saved));
      enterApp();
    }
  }

  document.addEventListener('DOMContentLoaded', boot);

  return { state, ROLE_INFO, ROUTES };
})();
