let DiscordUser = null;
let refreshInterval = null;
let logsInterval = null;
let staffsInterval = null;
let activityInterval = null;
let purchasesInterval = null;
let currentLogsBot = null;
let allStaffs = [];
let announcerInterval = null;

function startStaffsRefresh() { stopStaffsRefresh(); loadStaffs(); staffsInterval = setInterval(loadStaffs, 3000); activityInterval = setInterval(loadActivityLogs, 10000); purchasesInterval = setInterval(() => { const ps = document.getElementById('purchases-section'); if (ps && ps.style.display !== 'none') loadPurchases(); }, 8000); }
function stopStaffsRefresh() { if (staffsInterval) { clearInterval(staffsInterval); staffsInterval = null; } if (activityInterval) { clearInterval(activityInterval); activityInterval = null; } if (purchasesInterval) { clearInterval(purchasesInterval); purchasesInterval = null; } }

async function apiFetch(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    const storedPass = sessionStorage.getItem('lbpass');
    if (storedPass) headers['X-Auth-Password'] = storedPass;
    options.headers = headers;
    const res = await fetch(url, options);
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) return null;
    return res.json();
}

function showTab(tab, btn) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    btn.classList.add('active');
    if (tab === 'staffs' && DiscordUser && DiscordUser.isAdmin) {
        loadStaffs(); startStaffsRefresh(); loadActivityLogs();
        document.getElementById('purchases-section').style.display = 'block';
        loadPurchases();
        loadAutoAnn();
    } else {
        stopStaffsRefresh();
        const ps = document.getElementById('purchases-section');
        if (ps) ps.style.display = 'none';
    }
    if (tab === 'profile') { loadProfileBots(); renderProfilePlans(); loadProfilePurchases(); loadProfileSubscription(); }
    if (tab === 'planos') { renderPlans(); const af = document.getElementById('plans-admin-form'); if (af) af.style.display = (DiscordUser && DiscordUser.isAdmin) ? 'block' : 'none'; }
    if (tab === 'databases') { loadDatabases(); }
}

const LANG_COLORS = { 'Node.js': '#22c55e', 'Python': '#3b82f6', 'Java': '#f97316', 'TypeScript': '#3b82f6', 'Rust': '#f97316', 'Go': '#06b6d4', 'C++': '#a855f7', 'PHP': '#8b5cf6' };
const LANG_ICONS = { 'Node.js': 'JS', 'Python': 'PY', 'Java': 'JV', 'TypeScript': 'TS', 'Rust': 'RS', 'Go': 'GO', 'C++': 'C+', 'PHP': 'PH' };

async function loadProfileBots() {
    const data = await apiFetch('/api/bots/info');
    const c = document.getElementById('profile-bots-list');
    if (!c) return;
    if (!data || !data.length) { c.innerHTML = '<p class="empty">Nenhuma aplicacao</p>'; return; }
    document.getElementById('ps-bots').textContent = data.length;
    document.getElementById('ps-online').textContent = data.filter(b => b.status === 'running').length;
    c.innerHTML = data.map(b => {
        const langColor = LANG_COLORS[b.language] || '#71717a';
        const langIcon = LANG_ICONS[b.language] || '??';
        const uptime = b.uptime > 0 ? formatUptime(b.uptime) : '-';
        const statusText = b.status === 'running' ? 'Online' : b.status === 'installing' ? 'Instalando' : b.status === 'error' ? 'Erro' : 'Offline';
        return `
<div class="profile-bot-row">
  <div class="profile-bot-dot ${b.status}"></div>
  <div class="profile-bot-info">
    <div class="profile-bot-name">${esc(b.name)}</div>
    <div class="profile-bot-meta">
      <span class="profile-bot-lang" style="color:${langColor}"><span style="font-weight:700">${langIcon}</span> ${esc(b.language)}</span>
      ${b.status === 'running' ? `<span>${esc(String(b.ram))}MB</span><span>${esc(String(b.cpu))}%</span><span>${uptime}</span>` : ''}
    </div>
  </div>
  <span class="profile-bot-status ${b.status}">${statusText}</span>
</div>`;
    }).join('');
}

async function loadProfilePurchases() {
    const data = await apiFetch('/api/user/purchases');
    const c = document.getElementById('profile-purchases-list');
    if (!c) return;
    if (!data || !data.length) { c.innerHTML = '<p class="empty">Nenhuma compra ainda</p>'; return; }
    c.innerHTML = data.map(p => {
        const status = p.status || 'pending';
        const date = new Date(p.created_at).toLocaleDateString('pt-BR');
        return `
<div class="profile-purchase-item">
  <div class="profile-purchase-icon ${status}"></div>
  <div class="profile-purchase-info">
    <div class="profile-purchase-name">${esc(p.plan_name)}</div>
    <div class="profile-purchase-meta">
      <span>${esc(p.plan_price || '?')}</span>
      <span>${esc(p.plan_duration || '?')}</span>
      <span>${date}</span>
    </div>
  </div>
  <span class="profile-purchase-status ${status}">${PURCHASE_STATUS[status] || status}</span>
</div>`;
    }).join('');
}

async function loadProfileSubscription() {
    const data = await apiFetch('/api/user/purchases');
    const c = document.getElementById('profile-sub-status');
    if (!c) return;
    const approved = data ? data.filter(p => p.status === 'approved') : [];
    if (!approved.length) {
        c.innerHTML = '<div class="profile-sidebar-item"><span>Status</span><strong class="text-green">Inativo</strong></div><div class="profile-sidebar-item"><span>Plano</span><strong class="text-muted">Nenhum</strong></div>';
        return;
    }
    const latest = approved[0];
    c.innerHTML = `
<div class="profile-sidebar-item"><span>Status</span><strong class="text-green">Ativo</strong></div>
<div class="profile-sidebar-item"><span>Plano</span><strong>${esc(latest.plan_name)}</strong></div>
<div class="profile-sidebar-item"><span>Valor</span><strong>${esc(latest.plan_price || '?')}</strong></div>
<div class="profile-sidebar-item"><span>Duracao</span><strong>${esc(latest.plan_duration || '?')}</strong></div>
<div class="profile-sidebar-item"><span>Comprado</span><strong>${new Date(latest.created_at).toLocaleDateString('pt-BR')}</strong></div>`;
}

function renderProfilePlans() {
    const c = document.getElementById('profile-plans-list');
    if (!c) return;
    if (!plans.length) { c.innerHTML = '<p class="empty">Nenhum plano criado</p>'; return; }
    c.innerHTML = plans.map(p => {
        const tier = p.tier || 'bronze';
        const tierColor = { bronze: '#cd7f32', prata: '#c0c0c0', ouro: '#ffd700', diamante: '#00c8ff' }[tier] || '#5865f2';
        const iconSvg = TIER_ICONS[tier] || TIER_ICONS.bronze;
        return `
<div class="profile-sidebar-plan">
  <div class="profile-sidebar-plan-left">
    <span class="profile-sidebar-plan-icon">${iconSvg}</span>
    <div>
      <div class="profile-sidebar-plan-name">${esc(p.name)}</div>
      <div class="profile-sidebar-plan-price">${esc(p.price)} / ${esc(p.duration)}</div>
    </div>
  </div>
  <button class="profile-sidebar-plan-btn" style="background:${tierColor};color:#1a1a1e" onclick="buyPlan(${escJS(JSON.stringify({name:p.name,price:p.price,tier,duration:p.duration}))})">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
  </button>
</div>`;
    }).join('');
}

function getAvatar(u) {
    if (u && u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`;
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
}

function getBanner(u) {
    if (u && u.banner) return `https://cdn.discordapp.com/banners/${u.id}/${u.banner}.png?size=600`;
    return '/realpecado_mc_ig.png';
}

const OWNER_ID = '1473070694425301205';
const DISCORD_USER_GUILD = '1520550763850371175';

function enterApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'flex';
    const avatar = getAvatar(DiscordUser);
    const name = DiscordUser ? DiscordUser.username : 'User';
    const id = DiscordUser && DiscordUser.type === 'discord' ? DiscordUser.id : 'Senha';
    const type = DiscordUser && DiscordUser.type === 'discord' ? 'Discord' : 'Senha';

    document.getElementById('sidebar-avatar').src = avatar;
    document.getElementById('sidebar-name').textContent = name;
    document.getElementById('profile-avatar').src = avatar;
    document.getElementById('profile-name').textContent = name;
    document.getElementById('profile-id').textContent = id;
    document.getElementById('info-name').textContent = name;
    document.getElementById('info-id').textContent = id;
    document.getElementById('info-type').textContent = type;
    document.getElementById('profile-banner').src = getBanner(DiscordUser);

    const plansOnly = !!(DiscordUser && DiscordUser.canAccessPlans && !DiscordUser.isOwner && !DiscordUser.isAdmin);

    if (DiscordUser && DiscordUser.isAdmin) {
        document.getElementById('btn-staffs').style.display = 'flex';
        loadAutoAnn();
    } else {
        document.getElementById('btn-staffs').style.display = 'none';
    }

    const annCard = document.getElementById('announcer-card');
    if (annCard) annCard.style.display = (DiscordUser && (DiscordUser.isOwner || DiscordUser.isAdmin)) ? 'block' : 'none';

    if (plansOnly) {
        ['btn-dashboard', 'btn-profile', 'btn-discord', 'btn-databases'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        document.getElementById('btn-planos').style.display = 'flex';
        const us = document.getElementById('users-section');
        if (us) us.style.display = 'none';
        showTab('planos', document.getElementById('btn-planos'));
    } else if (DiscordUser && DiscordUser.isOwner) {
        document.getElementById('btn-planos').style.display = 'flex';
        document.getElementById('btn-databases').style.display = 'flex';
        document.getElementById('users-section').style.display = 'block';
        loadUsers();
    } else {
        document.getElementById('btn-planos').style.display = 'none';
        document.getElementById('btn-databases').style.display = 'flex';
        document.getElementById('users-section').style.display = 'none';
    }

    loadPlans();
    startAnnouncementPoll();

    if (DiscordUser && DiscordUser.created_at) {
        const d = new Date(parseInt(DiscordUser.created_at) * 1000 + 1420070400000);
        const sinceText = d.toLocaleDateString('pt-BR', { year: 'numeric', month: 'short' });
        document.getElementById('ps-since').textContent = sinceText;
        document.getElementById('info-since').textContent = sinceText;
    } else {
        const sinceText = new Date().toLocaleDateString('pt-BR', { year: 'numeric', month: 'short' });
        document.getElementById('ps-since').textContent = sinceText;
        document.getElementById('info-since').textContent = sinceText;
    }

    if (DiscordUser && DiscordUser.isOwner) {
        document.getElementById('profile-badges').innerHTML = '<span class="badge badge-owner">Owner</span><span class="badge badge-admin">Admin</span>';
    } else if (DiscordUser && DiscordUser.isAdmin) {
        document.getElementById('profile-badges').innerHTML = '<span class="badge badge-admin">Admin</span>';
    } else {
        document.getElementById('profile-badges').innerHTML = '<span class="badge" style="background:rgba(255,255,255,.05);color:#71717a;border:1px solid rgba(255,255,255,.06)">Usuario</span>';
    }

    const globalBtn = document.getElementById('btn-start-all-global');
    if (globalBtn) {
        if (DiscordUser && (DiscordUser.isOwner || DiscordUser.isAdmin)) {
            globalBtn.style.display = 'flex';
        } else {
            globalBtn.style.display = 'none';
        }
    }

    refreshBots();
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(refreshBots, 2000);
    startStatsRefresh();
    loadProfileBots();
    loadProfilePurchases();
    loadProfileSubscription();
    renderProfilePlans();
}

function logout() {
    DiscordUser = null;
    sessionStorage.removeItem('lbpass');
    if (refreshInterval) clearInterval(refreshInterval);
    if (logsInterval) clearInterval(logsInterval);
    stopStatsRefresh();
    fetch('/auth/logout').then(() => { window.location.reload(); });
}

async function doLogin() {
    const pass = document.getElementById('login-password').value;
    if (!pass) { document.getElementById('login-error').textContent = 'Digite a senha'; return; }
    document.getElementById('login-error').textContent = '';
    try {
        const res = await fetch('/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass }) });
        const data = await res.json();
        if (data.success) { sessionStorage.setItem('lbpass', pass); checkSession(); }
        else { document.getElementById('login-error').textContent = data.error || 'Senha incorreta'; document.getElementById('login-error').style.color = '#ef4444'; }
    } catch(e) { document.getElementById('login-error').textContent = 'Erro ao conectar'; document.getElementById('login-error').style.color = '#ef4444'; }
}

document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('bot-file').addEventListener('change', function() {
    if (this.files.length > 0) document.getElementById('file-label-text').textContent = this.files[0].name;
});

async function refreshBots() {
    const data = await apiFetch('/api/bots');
    if (data) renderBots(data);
}

function renderBots(bots) {
    const c = document.getElementById('bots-list');
    const online = bots.filter(b => b.status === 'running').length;
    const stopped = bots.filter(b => b.status === 'stopped').length;
    document.getElementById('stat-online').textContent = online;
    document.getElementById('stat-total').textContent = bots.length;
    document.getElementById('stat-stopped').textContent = stopped;
    document.getElementById('ps-bots').textContent = bots.length;
    document.getElementById('ps-online').textContent = online;
    if (!bots.length) { c.innerHTML = '<p class="empty">Nenhum bot encontrado</p>'; return; }

    const isAdmin = DiscordUser && DiscordUser.isAdmin;
    const isOwn = DiscordUser && DiscordUser.isOwner;
    const myId = DiscordUser && DiscordUser.id;

    function botCardHtml(b) {
        const canManage = isAdmin || b.owner === myId;
        let statusLabel = 'Offline';
        if (b.status === 'running') statusLabel = 'Online';
        else if (b.status === 'installing') statusLabel = 'Instalando...';
        else if (b.status === 'error') statusLabel = 'Erro';
        const isRunning = b.status === 'running';
        const langBadge = b.language ? `<span class="bot-lang-badge" style="background:${(LANG_COLORS[b.language]||'#71717a')}18;color:${LANG_COLORS[b.language]||'#71717a'};border:1px solid ${(LANG_COLORS[b.language]||'#71717a')}25">${LANG_ICONS[b.language]||'?'} ${esc(b.language)}</span>` : '';
        return `
<div class="bot-card ${b.status}" data-bot="${escAttr(b.name)}">
  <div class="bot-card-header">
    <span class="bot-card-name">${esc(b.name)}</span>
    <span class="bot-badge ${b.status}">${esc(statusLabel)}</span>
  </div>
  <div class="bot-card-meta">
    ${langBadge}
    ${isRunning ? `<div class="bot-stats">
      <div class="bot-stat-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/></svg><span class="bot-stat-val" data-stat="ram" data-bot="${escAttr(b.name)}">--</span><span class="bot-stat-unit">MB</span></div>
      <div class="bot-stat-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg><span class="bot-stat-val" data-stat="cpu" data-bot="${escAttr(b.name)}">--</span><span class="bot-stat-unit">%</span></div>
      <div class="bot-stat-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span class="bot-stat-val" data-stat="uptime" data-bot="${escAttr(b.name)}">--</span></div>
    </div>` : ''}
  </div>
  <div class="bot-card-btns">
    ${canManage ? `
    <button class="b-start" onclick="startBot('${escJS(b.name)}')" ${b.status==='installing'?'disabled':''}><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>Ligar</button>
    <button class="b-stop" onclick="stopBot('${escJS(b.name)}')"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>Desligar</button>
    <button class="b-restart" onclick="restartBot('${escJS(b.name)}')" ${b.status==='installing'?'disabled':''}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/></svg>Reiniciar</button>
    <button class="b-console" onclick="openLogs('${escJS(b.name)}')"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>Console</button>
    <button class="b-files" onclick="openFiles('${escJS(b.name)}')"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Arquivos</button>
    <button class="b-delete" onclick="deleteBot('${escJS(b.name)}')"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
    ` : `<span style="font-size:11px;color:#71717a">Aguardando dono para gerenciar</span>`}
  </div>
</div>`;
    }

    if (isAdmin || isOwn) {
        const myBots = bots.filter(b => b.owner === myId);
        const otherBots = bots.filter(b => b.owner !== myId);
        const grouped = {};
        for (const b of otherBots) {
            const key = b.owner || 'desconhecido';
            if (!grouped[key]) grouped[key] = { name: b.ownerName || key, bots: [] };
            grouped[key].bots.push(b);
        }
        let html = '';
        if (myBots.length) {
            html += `<div class="bots-section"><div class="bots-section-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Meus Bots <span class="bots-section-count">${myBots.length}</span></div><div class="bots-grid">${myBots.map(botCardHtml).join('')}</div></div>`;
        }
        for (const [ownerId, group] of Object.entries(grouped)) {
            html += `<div class="bots-section"><div class="bots-section-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> ${esc(group.name)} <span class="bots-section-count">${group.bots.length}</span></div><div class="bots-grid">${group.bots.map(botCardHtml).join('')}</div></div>`;
        }
        c.innerHTML = html || '<p class="empty">Nenhum bot encontrado</p>';
    } else {
        c.innerHTML = bots.map(botCardHtml).join('');
    }
    loadBotStats();
}

function formatUptime(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds/60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds/3600)}h ${Math.floor((seconds%3600)/60)}m`;
    return `${Math.floor(seconds/86400)}d ${Math.floor((seconds%86400)/3600)}h`;
}

let statsInterval = null;
async function loadBotStats() {
    const data = await apiFetch('/api/bots/stats');
    if (!data) return;
    for (const [name, stats] of Object.entries(data)) {
        const ramEl = document.querySelector(`[data-stat="ram"][data-bot="${CSS.escape(name)}"]`);
        const cpuEl = document.querySelector(`[data-stat="cpu"][data-bot="${CSS.escape(name)}"]`);
        const upEl = document.querySelector(`[data-stat="uptime"][data-bot="${CSS.escape(name)}"]`);
        if (ramEl) ramEl.textContent = stats.ram;
        if (cpuEl) cpuEl.textContent = stats.cpu;
        if (upEl) upEl.textContent = formatUptime(stats.uptime);
    }
}
function startStatsRefresh() { stopStatsRefresh(); loadBotStats(); statsInterval = setInterval(loadBotStats, 5000); }
function stopStatsRefresh() { if (statsInterval) { clearInterval(statsInterval); statsInterval = null; } }

async function createBot() {
    const name = document.getElementById('bot-name').value.trim();
    const fi = document.getElementById('bot-file');
    const s = document.getElementById('create-status');
    if (!name) { s.textContent='Digite um nome';s.style.color='#ef4444';return; }
    if (!fi.files.length) { s.textContent='Selecione um .ZIP';s.style.color='#ef4444';return; }
    if (!fi.files[0].name.endsWith('.zip')) { s.textContent='Apenas .ZIP';s.style.color='#ef4444';return; }
    const MAX_MB = 200;
    if (fi.files[0].size > MAX_MB * 1024 * 1024) { s.textContent='Arquivo muito grande! Maximo ' + MAX_MB + 'MB';s.style.color='#ef4444';return; }
    const fd = new FormData();
    fd.append('name', name);
    fd.append('file', fi.files[0]);
    const btn = document.querySelector('.create-bot-form button, .create-bot-form [type="submit"], #create-bot-btn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
    const totalMB = (fi.files[0].size / 1024 / 1024).toFixed(1);
    s.textContent='Enviando ZIP (' + totalMB + 'MB) — 0%...';s.style.color='#f59e0b';
    let startTime = Date.now();
    try {
        const result = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/bots');
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const pct = Math.round((e.loaded / e.total) * 100);
                    const elapsed = (Date.now() - startTime) / 1000;
                    const speed = elapsed > 0 ? (e.loaded / 1024 / 1024 / elapsed).toFixed(1) : '?';
                    const remaining = speed > 0 ? ((e.total - e.loaded) / 1024 / 1024 / parseFloat(speed)).toFixed(0) : '?';
                    s.textContent = pct < 100
                        ? `Enviando ${pct}% (${speed} MB/s) — ${remaining}s restante...`
                        : 'Processando ZIP...';
                }
            };
            xhr.onload = () => {
                const text = xhr.responseText || '';
                try { resolve(JSON.parse(text)); }
                catch(e) {
                    const detail = text ? (text.length > 300 ? text.slice(0, 300) + '...' : text) : 'Resposta vazia do servidor';
                    reject(new Error('Resposta invalida do servidor (HTTP ' + xhr.status + '): ' + detail));
                }
            };
            xhr.onerror = () => reject(new Error('Falha na conexao'));
            xhr.timeout = 1800000;
            xhr.ontimeout = () => reject({ name: 'AbortError' });
            xhr.send(fd);
        });
        if (result.success) {
            s.textContent='Criado! Instalando dependencias em background...';s.style.color='#22c55e';
            document.getElementById('bot-name').value='';
            document.getElementById('bot-file').value='';
            document.getElementById('file-label-text').textContent='Selecionar .ZIP';
            refreshBots();
            let attempts = 0;
            const pollInterval = setInterval(() => { refreshBots(); attempts++; if (attempts > 300) clearInterval(pollInterval); }, 2000);
        } else { s.textContent=result.error||'Erro';s.style.color='#ef4444'; }
    } catch(e) {
        s.textContent = e.name === 'AbortError' ? 'Upload demorou muito (>30min)' : 'Erro: ' + e.message;
        s.style.color='#ef4444';
    } finally {
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }
}

async function startBot(n) {
    const btn = document.querySelector(`.bot-card[data-bot="${CSS.escape(n)}"] .b-start`);
    if (btn) { btn.disabled = true; btn.textContent = 'Ligando...'; }
    try {
        const res = await apiFetch(`/api/bots/${encodeURIComponent(n)}/start`,{method:'POST'});
        if (!res || !res.success) alert('Erro ao ligar o bot: ' + (res && res.error ? res.error : 'sem permissao ou bot nao encontrado'));
    } catch(e) { alert('Erro ao ligar o bot: ' + e.message); }
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>Ligar'; }
    refreshBots();
}
async function stopBot(n) { await apiFetch(`/api/bots/${encodeURIComponent(n)}/stop`,{method:'POST'});refreshBots(); }
async function restartBot(n) { await apiFetch(`/api/bots/${encodeURIComponent(n)}/restart`,{method:'POST'});refreshBots(); }
async function deleteBot(n) { if(!confirm(`Deletar "${n}"?`))return;await apiFetch(`/api/bots/${encodeURIComponent(n)}`,{method:'DELETE'});refreshBots(); }

async function startAllBots() {
    const btn = document.getElementById('btn-start-all-global');
    if (btn) { btn.disabled = true; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10"/></svg> Ligando...'; }
    try {
        const res = await apiFetch('/api/bots/start-all', { method: 'POST' });
        if (res && res.success) {
            const ok = res.results.success.length;
            const fail = res.results.failed.length;
            const failDetails = res.results.failed && res.results.failed.length ? '\n' + res.results.failed.map(f => `- ${f.name}: ${f.error}`).join('\n') : '';
            alert(`${ok} bot(s) ligado(s) com sucesso!${fail ? ` ${fail} falha(s).${failDetails}` : ''}`);
            refreshBots();
        } else {
            alert('Erro ao ligar todos os bots (verifique se voce e admin/owner)');
        }
    } catch(e) {
        alert('Erro ao ligar todos os bots: ' + e.message);
    }
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg> LIGAR TODOS'; }
}

async function openLogs(n) {
    currentLogsBot=n;
    document.getElementById('logs-section').style.display='block';
    document.getElementById('logs-bot-name').textContent=n;
    refreshLogs();
    if(logsInterval)clearInterval(logsInterval);
    logsInterval=setInterval(refreshLogs,2000);
}
async function refreshLogs() {
    if(!currentLogsBot)return;
    const d=await apiFetch(`/api/bots/${encodeURIComponent(currentLogsBot)}/logs`);
    if(d&&d.logs){const c=document.getElementById('logs-content');c.innerHTML=d.logs.map(l=>`<div>${esc(l)}</div>`).join('');c.scrollTop=c.scrollHeight;}
}
function closeLogs(){document.getElementById('logs-section').style.display='none';currentLogsBot=null;clearInterval(logsInterval);}

// === FILE MANAGER ===
let currentFilesBot = null;
let currentFilesPath = '.';

function openFiles(n) {
    currentFilesBot = n;
    currentFilesPath = '.';
    document.getElementById('files-section').style.display = 'block';
    document.getElementById('files-bot-name').textContent = n;
    document.getElementById('files-editor').style.display = 'none';
    filesList();
}
function closeFiles() {
    document.getElementById('files-section').style.display = 'none';
    document.getElementById('files-editor').style.display = 'none';
    currentFilesBot = null;
}
async function filesList() {
    if (!currentFilesBot) return;
    const d = await apiFetch(`/api/bots/${encodeURIComponent(currentFilesBot)}/files?path=${encodeURIComponent(currentFilesPath)}`);
    if (!d || !d.items) { document.getElementById('files-list').innerHTML = '<p class="empty">Erro ao carregar arquivos</p>'; return; }
    const bread = document.getElementById('files-breadcrumb');
    const parts = (d.path === '.' ? [] : d.path.split('/'));
    let acc = '';
    let bhtml = '<span class="fb-crumb fb-root" onclick="filesNav(\'.\')">' + esc(currentFilesBot) + '</span>';
    parts.forEach((p, i) => {
        acc = acc ? acc + '/' + p : p;
        bhtml += '<span class="fb-sep">/</span><span class="fb-crumb" onclick="filesNav(' + escJS(acc) + ')">' + esc(p) + '</span>';
    });
    bread.innerHTML = bhtml;
    const c = document.getElementById('files-list');
    if (!d.items.length) { c.innerHTML = '<p class="empty">Pasta vazia</p>'; return; }
    c.innerHTML = d.items.map(f => {
        const sizeTxt = f.isDir ? '' : (f.size >= 1048576 ? (f.size/1048576).toFixed(1) + ' MB' : f.size >= 1024 ? (f.size/1024).toFixed(1) + ' KB' : f.size + ' B');
        const icon = f.isDir
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
        const row = `<div class="files-row" data-path="${escAttr((d.path === '.' ? '' : d.path + '/') + f.name)}" data-dir="${f.isDir}" ondblclick="${f.isDir ? `filesNav('${escJS((d.path === '.' ? '' : d.path + '/') + f.name)}')` : `filesOpenFile('${escJS((d.path === '.' ? '' : d.path + '/') + f.name)}')`}" onclick="filesRowClick(event,this)">
          <div class="files-icon">${icon}</div>
          <div class="files-name">${esc(f.name)}</div>
          <div class="files-size">${esc(sizeTxt)}</div>
          <div class="files-actions">
            <button class="fbtn" onclick="event.stopPropagation();filesNav('${escJS((d.path === '.' ? '' : d.path + '/') + f.name)}')" ${f.isDir ? '' : 'style="display:none"'} title="Abrir"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>
            <button class="fbtn" onclick="event.stopPropagation();filesOpenFile('${escJS((d.path === '.' ? '' : d.path + '/') + f.name)}')" ${f.isDir ? 'style="display:none"' : ''} title="Editar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
            <button class="fbtn" onclick="event.stopPropagation();filesRename('${escJS((d.path === '.' ? '' : d.path + '/') + f.name)}')" title="Renomear"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>
            <button class="fbtn danger" onclick="event.stopPropagation();filesDelete('${escJS((d.path === '.' ? '' : d.path + '/') + f.name)}', ${f.isDir})" title="Deletar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
          </div>
        </div>`;
        return row;
    }).join('');
}
function filesRowClick(e, el) {
    if (e.target.closest('.files-actions')) return;
    document.querySelectorAll('.files-row').forEach(r => r.classList.remove('selected'));
    el.classList.add('selected');
}
function filesNav(p) {
    currentFilesPath = p || '.';
    document.getElementById('files-editor').style.display = 'none';
    filesList();
}
async function filesOpenFile(p) {
    if (!currentFilesBot) return;
    const d = await apiFetch(`/api/bots/${encodeURIComponent(currentFilesBot)}/files/content?path=${encodeURIComponent(p)}`);
    if (!d || d.content === undefined) { alert(d && d.error ? d.error : 'Nao foi possivel abrir o arquivo'); return; }
    document.getElementById('files-editor').style.display = 'block';
    document.getElementById('files-editor-name').textContent = p;
    document.getElementById('files-editor-content').value = d.content;
    currentFilesEditorPath = p;
}
let currentFilesEditorPath = null;
async function filesSave() {
    if (!currentFilesBot || !currentFilesEditorPath) return;
    const btn = document.getElementById('files-save-btn');
    const content = document.getElementById('files-editor-content').value;
    btn.disabled = true;
    btn.innerHTML = 'Salvando...';
    const url = `/api/bots/${encodeURIComponent(currentFilesBot)}/files/write`;
    let res = await apiFetch(url, {
        method: 'POST',
        body: JSON.stringify({ path: currentFilesEditorPath, content })
    });
    if (!res) {
        try {
            const r = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: currentFilesEditorPath, content }),
                credentials: 'include'
            });
            const body = await r.json();
            if (body && body.error) res = body;
        } catch(e) {}
    }
    btn.disabled = false;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Salvar';
    alert(res && res.success ? 'Arquivo salvo!' : (res && res.error ? res.error : 'Erro ao salvar arquivo'));
}
function filesCloseEditor() { document.getElementById('files-editor').style.display = 'none'; currentFilesEditorPath = null; }
async function filesDelete(p, isDir) {
    if (!currentFilesBot) return;
    if (!confirm(`Deletar "${p}"?`)) return;
    const res = await apiFetch(`/api/bots/${encodeURIComponent(currentFilesBot)}/files?path=${encodeURIComponent(p)}`, { method: 'DELETE' });
    alert(res && res.success ? 'Deletado!' : (res && res.error ? res.error : 'Erro ao deletar'));
    filesList();
}
async function filesRename(p) {
    if (!currentFilesBot) return;
    const newName = prompt('Novo nome:', p.split('/').pop());
    if (!newName || newName === p.split('/').pop()) return;
    const parent = p.includes('/') ? p.substring(0, p.lastIndexOf('/') + 1) : '';
    const res = await apiFetch(`/api/bots/${encodeURIComponent(currentFilesBot)}/files/rename`, {
        method: 'POST',
        body: JSON.stringify({ path: p, newPath: parent + newName })
    });
    alert(res && res.success ? 'Renomeado!' : (res && res.error ? res.error : 'Erro ao renomear'));
    filesList();
}
async function filesCreatePrompt() {
    if (!currentFilesBot) return;
    const isFolder = confirm('Criar uma PASTA? (Cancelar = criar arquivo)');
    const name = prompt('Nome do ' + (isFolder ? 'arquivo' : 'pasta') + ':');
    if (!name || !name.trim()) return;
    const full = (currentFilesPath === '.' ? '' : currentFilesPath + '/') + name.trim();
    const res = await apiFetch(`/api/bots/${encodeURIComponent(currentFilesBot)}/files/create`, {
        method: 'POST',
        body: JSON.stringify({ path: full, type: isFolder ? 'folder' : 'file' })
    });
    alert(res && res.success ? 'Criado!' : (res && res.error ? res.error : 'Erro ao criar'));
    filesList();
}
function esc(t){const d=document.createElement('div');d.textContent=t;return d.innerHTML;}
function escAttr(t){return t.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function escJS(t){return t.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"').replace(/</g,'\\x3c').replace(/>/g,'\\x3e');}

function timeAgo(dateStr) {
    if (!dateStr) return '-';
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
    if (diff < 60) return `${diff}s atras`;
    if (diff < 3600) return `${Math.floor(diff/60)}min atras`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h atras`;
    if (diff < 2592000) return `${Math.floor(diff/86400)}d atras`;
    return new Date(dateStr).toLocaleDateString('pt-BR');
}

function formatCount(n) { return n > 1 ? `${n}x` : '1x'; }

async function loadStaffs() {
    const data = await apiFetch('/api/staffs');
    if (!data) return;
    allStaffs = data;
    renderStaffs(data);
}

function renderStaffs(staffs) {
    const c = document.getElementById('staffs-list');
    const active = staffs.filter(s => !s.banned).length;
    const banned = staffs.filter(s => s.banned).length;
    document.getElementById('staffs-total').textContent = staffs.length;
    document.getElementById('staffs-active').textContent = active;
    document.getElementById('staffs-banned-count').textContent = banned;
    if (!staffs.length) { c.innerHTML = '<p class="empty">Nenhum staff registrado</p>'; return; }

    c.innerHTML = staffs.map(s => {
        const isOwnerUser = s.id === OWNER_ID;
        const avatar = s.avatar ? `https://cdn.discordapp.com/avatars/${escAttr(s.id)}/${escAttr(s.avatar)}.png?size=96` : 'https://cdn.discordapp.com/embed/avatars/0.png';
        const logins = formatCount(s.loginCount);
        const lastLogin = timeAgo(s.lastLogin);
        const registered = s.createdAt ? new Date(s.createdAt).toLocaleDateString('pt-BR') : '-';

        const isOnline = s.online;
    return `
        <div class="staff-card ${s.banned ? 'banned' : ''}">
            <div class="staff-avatar-wrap">
                <img src="${escAttr(avatar)}" class="staff-avatar" alt="">
                <div class="staff-online-dot ${isOnline ? 'online' : 'offline'}"></div>
            </div>
            <div class="staff-info">
                <div class="staff-name-row">
                    <span class="staff-name staff-name-link" onclick="openStaffProfile('${escJS(s.id)}')" title="Ver perfil">${esc(s.username)}</span>
                    ${isOwnerUser ? '<span class="staff-owner-badge">Owner</span>' : ''}
                    ${s.isAdmin && !isOwnerUser ? '<span class="staff-owner-badge" style="background:linear-gradient(135deg,rgba(88,101,242,.1),rgba(88,101,242,.03));color:#5865F2;border-color:rgba(88,101,242,.15)">Admin</span>' : ''}
                </div>
                <span class="staff-id">${esc(s.id)}</span>
                <div class="staff-meta">
                    <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg> ${logins} login</span>
                    <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${lastLogin}</span>
                    <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${registered}</span>
                </div>
            </div>
            <div class="staff-actions">
                <button class="staff-btn btn-copy-id" onclick="copyStaffId('${escJS(s.id)}',this)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> ID</button>
                ${!isOwnerUser ? (s.isAdmin
                    ? `<button class="staff-btn btn-unban" onclick="removeAdmin('${escJS(s.id)}')">Remover Admin</button>`
                    : `<button class="staff-btn btn-ban" style="background:rgba(88,101,242,.06);color:#5865F2;border-color:rgba(88,101,242,.12)" onclick="makeAdmin('${escJS(s.id)}','${escJS(s.username)}')">Tornar Admin</button>`
                ) : ''}
                ${!isOwnerUser ? (s.banned
                    ? `<button class="staff-btn btn-unban" onclick="unbanStaff('${escJS(s.id)}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Desbanir</button>`
                    : `<button class="staff-btn btn-ban" onclick="banStaff('${escJS(s.id)}','${escJS(s.username)}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Banir</button>`
                ) : ''}
            </div>
        </div>`;
    }).join('');
}

function filterStaffs() {
    const q = document.getElementById('staffs-search').value.toLowerCase().trim();
    if (!q) { renderStaffs(allStaffs); return; }
    renderStaffs(allStaffs.filter(s => s.username.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)));
}

function copyStaffId(id, btn) {
    navigator.clipboard.writeText(id).then(() => {
        const o = btn.innerHTML;
        btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copiado!';
        setTimeout(() => { btn.innerHTML = o; }, 2000);
    });
}

async function banStaff(id, name) {
    if (!confirm(`Banir "${name}" do painel?`)) return;
    if ((await apiFetch(`/api/staffs/${encodeURIComponent(id)}/ban`, { method: 'POST' }))?.success) loadStaffs();
}
async function unbanStaff(id) {
    if ((await apiFetch(`/api/staffs/${encodeURIComponent(id)}/unban`, { method: 'POST' }))?.success) loadStaffs();
}
async function makeAdmin(id, name) {
    if (!confirm(`Tornar "${name}" admin?\nEle podera gerenciar todos os bots.`)) return;
    if ((await apiFetch(`/api/staffs/${encodeURIComponent(id)}/makeadmin`, { method: 'POST' }))?.success) loadStaffs();
}
async function removeAdmin(id) {
    if (!confirm('Remover admin desta pessoa?')) return;
    if ((await apiFetch(`/api/staffs/${encodeURIComponent(id)}/removeadmin`, { method: 'POST' }))?.success) loadStaffs();
}

let cachedAllPurchases = null;

async function getAllPurchases() {
    if (!cachedAllPurchases) { cachedAllPurchases = await apiFetch('/api/purchases') || []; }
    return cachedAllPurchases;
}

async function openStaffProfile(id) {
    const s = allStaffs.find(x => x.id === id);
    if (!s) return;
    const overlay = document.getElementById('profile-overlay');
    const body = document.getElementById('profile-body');
    if (!overlay || !body) return;
    overlay.style.display = 'flex';
    body.innerHTML = '<p class="empty" style="padding:24px">Carregando perfil...</p>';
    const avatar = s.avatar ? `https://cdn.discordapp.com/avatars/${escAttr(s.id)}/${escAttr(s.avatar)}.png?size=128` : 'https://cdn.discordapp.com/embed/avatars/0.png';
    const isOwnerUser = s.id === OWNER_ID;
    let badges = '';
    if (isOwnerUser) badges += '<span class="staff-owner-badge">Owner</span>';
    else if (s.isAdmin) badges += '<span class="staff-owner-badge" style="background:linear-gradient(135deg,rgba(88,101,242,.1),rgba(88,101,242,.03));color:#5865F2;border-color:rgba(88,101,242,.15)">Admin</span>';
    if (s.banned) badges += '<span class="staff-owner-badge" style="background:rgba(239,68,68,.1);color:#ef4444;border-color:rgba(239,68,68,.2)">Banido</span>';
    const onlineHtml = s.online ? '<span style="color:#22c55e">Online agora</span>' : '<span style="color:var(--muted)">Offline</span>';
    const lastLogin = s.lastLogin ? new Date(s.lastLogin).toLocaleDateString('pt-BR') : '-';
    const registered = s.createdAt ? new Date(s.createdAt).toLocaleDateString('pt-BR') : '-';
    const purchases = await getAllPurchases();
    const mine = (purchases || []).filter(p => String(p.user_id) === String(id));
    let purchasesHtml = '';
    if (!mine.length) {
        purchasesHtml = '<p class="empty" style="padding:12px 0">Nenhuma compra registrada</p>';
    } else {
        purchasesHtml = mine.map(p => {
            const status = p.status || 'pending';
            const date = new Date(p.created_at).toLocaleDateString('pt-BR');
            const ticketLink = p.ticket_channel_id
                ? `<a class="profile-ticket-link" href="https://discord.com/channels/${p.ticket_guild_id || DISCORD_USER_GUILD}/${p.ticket_channel_id}" target="_blank">Ticket</a>`
                : '';
            return `
<div class="profile-purchase-item">
  <div class="profile-purchase-icon ${status}"></div>
  <div class="profile-purchase-info">
    <div class="profile-purchase-name">${esc(p.plan_name)}</div>
    <div class="profile-purchase-meta">
      <span>${esc(p.plan_price || '?')}</span>
      <span>${esc(p.plan_duration || '?')}</span>
      <span>${date}</span>
    </div>
  </div>
  <span class="profile-purchase-status ${status}">${PURCHASE_STATUS[status] || status}</span>
  ${ticketLink}
</div>`;
        }).join('');
    }
    body.innerHTML = `
<div class="profile-top">
  <div class="profile-avatar-wrap">
    <img class="profile-big-avatar" src="${escAttr(avatar)}" alt="">
    <div class="staff-online-dot ${s.online ? 'online' : 'offline'}" style="position:static"></div>
  </div>
  <div class="profile-head-info">
    <div class="profile-name-row">
      <span class="profile-name">${esc(s.username)}</span>
      ${badges}
    </div>
    <div class="profile-id-row">
      <span class="profile-id">${esc(s.id)}</span>
      <button class="profile-link-btn" onclick="copyStaffId('${escJS(s.id)}',this)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar ID</button>
    </div>
    <div class="profile-actions">
      <a class="profile-link-btn discord" href="https://discord.com/users/${escAttr(s.id)}" target="_blank"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.369a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037 19.736 19.736 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg> Perfil no Discord</a>
      <span class="profile-online-label">${onlineHtml}</span>
    </div>
  </div>
</div>
<div class="profile-stats">
  <div class="profile-stat-card"><span class="profile-stat-val">${s.loginCount || 1}</span><span class="profile-stat-label">Logins</span></div>
  <div class="profile-stat-card"><span class="profile-stat-val" style="font-size:15px">${esc(lastLogin)}</span><span class="profile-stat-label">Ultimo login</span></div>
  <div class="profile-stat-card"><span class="profile-stat-val" style="font-size:15px">${esc(registered)}</span><span class="profile-stat-label">Membro desde</span></div>
</div>
<div class="profile-section-title">Compras (${mine.length})</div>
<div class="profile-purchases">${purchasesHtml}</div>`;
}

function closeProfile() {
    const overlay = document.getElementById('profile-overlay');
    if (overlay) overlay.style.display = 'none';
}

async function checkSession() {
    try {
        const headers = {};
        const storedPass = sessionStorage.getItem('lbpass');
        if (storedPass) headers['X-Auth-Password'] = storedPass;
        const r = await fetch('/api/me', { headers, credentials: 'include' });
        if (r.ok) { const d = await r.json(); if (d.id) { DiscordUser = d; enterApp(); } }
    } catch(e) {}
}

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('banned') === '1') {
    document.addEventListener('DOMContentLoaded', () => { const e = document.getElementById('login-error'); if (e) { e.textContent = 'Sua conta foi banida do painel.'; e.style.color = '#ef4444'; } });
}
if (urlParams.get('error')) {
    document.addEventListener('DOMContentLoaded', () => { const e = document.getElementById('login-error'); if (e) { e.textContent = 'Erro no login: ' + decodeURIComponent(urlParams.get('error')); e.style.color = '#ef4444'; } });
    history.replaceState(null, '', '/');
}

checkSession();

document.addEventListener('DOMContentLoaded', () => {
    const loginScreen = document.getElementById('login-screen');
    const loginCard = document.querySelector('.login-card');
    if (loginScreen) {
        loginScreen.addEventListener('mousemove', (e) => {
            const rect = loginScreen.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width * 100);
            const y = ((e.clientY - rect.top) / rect.height * 100);
            loginScreen.style.setProperty('--mx', x + '%');
            loginScreen.style.setProperty('--my', y + '%');
            const g1 = document.querySelector('.login-glow-1');
            const g2 = document.querySelector('.login-glow-2');
            if (g1) g1.style.transform = `translate(${(e.clientX - rect.width/2) * 0.02}px, ${(e.clientY - rect.height/2) * 0.02}px)`;
            if (g2) g2.style.transform = `translate(${(e.clientX - rect.width/2) * -0.015}px, ${(e.clientY - rect.height/2) * -0.015}px)`;
            if (loginCard) {
                const cx = (e.clientX - rect.left) / rect.width - 0.5;
                const cy = (e.clientY - rect.top) / rect.height - 0.5;
                loginCard.style.transform = `perspective(800px) rotateY(${cx * 12}deg) rotateX(${-cy * 12}deg) scale3d(1.02,1.02,1.02)`;
            }
        });
        loginScreen.addEventListener('mouseleave', () => {
            if (loginCard) loginCard.style.transform = 'perspective(800px) rotateY(0deg) rotateX(0deg) scale3d(1,1,1)';
        });
    }

    const mainArea = document.querySelector('.main-area');
    if (mainArea && !document.getElementById('main-bg')) {
        const bg = document.createElement('div');
        bg.id = 'main-bg';
        bg.innerHTML = '<div class="main-grid"></div><div class="main-glow main-glow-1"></div><div class="main-glow main-glow-2"></div>';
        mainArea.prepend(bg);
        mainArea.addEventListener('mousemove', (e) => {
            const rect = mainArea.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width * 100);
            const y = ((e.clientY - rect.top) / rect.height * 100);
            mainArea.style.setProperty('--mx', x + '%');
            mainArea.style.setProperty('--my', y + '%');
            const g1 = bg.querySelector('.main-glow-1');
            const g2 = bg.querySelector('.main-glow-2');
            if (g1) g1.style.transform = `translate(${(e.clientX - rect.left - rect.width/2) * 0.015}px, ${(e.clientY - rect.top - rect.height/2) * 0.015}px)`;
            if (g2) g2.style.transform = `translate(${(e.clientX - rect.left - rect.width/2) * -0.01}px, ${(e.clientY - rect.top - rect.height/2) * -0.01}px)`;
        });
    }
});

let sendingAnnouncement = false;

async function sendAnnouncement() {
    if (sendingAnnouncement) return;
    sendingAnnouncement = true;
    const input = document.getElementById('announcement-text');
    const status = document.getElementById('announcement-status');
    const msg = input.value.trim();
    if (!msg) { status.textContent = 'Digite uma mensagem'; status.style.color = '#ef4444'; sendingAnnouncement = false; return; }
    status.textContent = 'Enviando...'; status.style.color = '#f59e0b';
    try {
        const res = await apiFetch('/api/announcements', { method: 'POST', body: JSON.stringify({ message: msg }) });
        if (res && res.success) {
            status.textContent = 'Aviso enviado para todos online!'; status.style.color = '#22c55e';
            input.value = '';
            setTimeout(() => { status.textContent = ''; }, 3000);
        } else {
            status.textContent = 'Erro ao enviar'; status.style.color = '#ef4444';
        }
    } catch(e) {
        status.textContent = 'Erro ao enviar'; status.style.color = '#ef4444';
    }
    sendingAnnouncement = false;
}

document.addEventListener('DOMContentLoaded', () => {
    const annInput = document.getElementById('announcement-text');
    if (annInput) annInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendAnnouncement(); });
});

function startAnnouncementPoll() {
    if (announcerInterval) clearInterval(announcerInterval);
    checkNewAnnouncement();
    announcerInterval = setInterval(checkNewAnnouncement, 5000);
}

async function checkNewAnnouncement() {
    const data = await apiFetch('/api/announcements/last');
    if (data && data.announcement) showAnnouncement(data.announcement);
}

function showAnnouncement(ann) {
    const overlay = document.getElementById('announcement-overlay');
    if (!overlay) return;
    const time = new Date(ann.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    overlay.innerHTML = `
        <div class="ann-header">
            <div class="ann-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            </div>
            <div>
                <div class="ann-title">Aviso</div>
                <div class="ann-author">por ${esc(ann.author)}</div>
            </div>
        </div>
        <div class="ann-message">${esc(ann.message)}</div>
        <div class="ann-footer">
            <span class="ann-time">${time}</span>
            <button class="ann-close" onclick="closeAnnouncement()">Fechar</button>
        </div>`;
    overlay.style.display = 'block';
    overlay.classList.remove('hide');
    playNotifSound();
    clearTimeout(overlay._hideTimer);
    overlay._hideTimer = setTimeout(closeAnnouncement, 8000);
}

function playNotifSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const notes = [880, 1100, 880];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.12);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.15);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime + i * 0.12);
            osc.stop(ctx.currentTime + i * 0.12 + 0.15);
        });
    } catch(e) {}
}

function closeAnnouncement() {
    const overlay = document.getElementById('announcement-overlay');
    if (!overlay) return;
    overlay.classList.add('hide');
    setTimeout(() => { overlay.style.display = 'none'; overlay.classList.remove('hide'); }, 300);
}

let autoAnnLoaded = false;
async function loadAutoAnn() {
    const data = await apiFetch('/api/auto-announcement');
    if (!data) return;
    document.getElementById('auto-ann-toggle').checked = data.enabled;
    document.getElementById('auto-ann-message').value = data.message || '';
    document.getElementById('auto-ann-interval').value = data.intervalMinutes || '10';
    updateAutoAnnUI();
    autoAnnLoaded = true;
}
function updateAutoAnnUI() {
    const enabled = document.getElementById('auto-ann-toggle').checked;
    const knob = document.getElementById('auto-ann-toggle-knob');
    const bg = knob.parentElement.querySelector('span:first-child');
    if (enabled) {
        knob.style.background = '#22c55e';
        knob.style.transform = 'translateX(18px)';
        if (bg) bg.style.background = 'rgba(34,197,94,.25)';
    } else {
        knob.style.background = '#71717a';
        knob.style.transform = 'translateX(0)';
        if (bg) bg.style.background = '#333';
    }
}
function toggleAutoAnn() {
    updateAutoAnnUI();
}
async function saveAutoAnn() {
    const enabled = document.getElementById('auto-ann-toggle').checked;
    const message = document.getElementById('auto-ann-message').value.trim();
    const intervalMinutes = parseInt(document.getElementById('auto-ann-interval').value) || 10;
    const s = document.getElementById('auto-ann-status');
    if (enabled && !message) { s.textContent = 'Digite a mensagem'; s.style.color = '#ef4444'; return; }
    s.textContent = 'Salvando...'; s.style.color = '#f59e0b';
    const res = await apiFetch('/api/auto-announcement', {
        method: 'POST',
        body: JSON.stringify({ enabled, message, intervalMinutes })
    });
    if (res && res.success) {
        s.textContent = enabled ? 'Auto-aviso ativado!' : 'Auto-aviso desativado!';
        s.style.color = '#22c55e';
    } else {
        s.textContent = 'Erro ao salvar'; s.style.color = '#ef4444';
    }
    setTimeout(() => { s.textContent = ''; }, 3000);
}

const ACTIVITY_ICONS = {
    bot_start: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>',
    bot_stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
    bot_restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/></svg>',
    bot_create: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    bot_delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    unban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
    make_admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    remove_admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
    announcement: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    login: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>',
    bot_start_all: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/><polygon points="5 3 19 12 5 21" opacity="0.5"/></svg>'
};
const ACTIVITY_LABELS = {
    bot_start: 'Ligou bot', bot_stop: 'Desligou bot', bot_restart: 'Reiniciou bot',
    bot_create: 'Criou bot', bot_delete: 'Deletou bot', ban: 'Baniu usuario',
    unban: 'Desbaniu usuario', make_admin: 'Tornou admin', remove_admin: 'Removeu admin',
    announcement: 'Anuncio', login: 'Login',
    bot_start_all: 'Ligou todos os bots'
};

function timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `${s}s atras`;
    if (s < 3600) return `${Math.floor(s/60)}m atras`;
    if (s < 86400) return `${Math.floor(s/3600)}h atras`;
    return `${Math.floor(s/86400)}d atras`;
}

async function loadActivityLogs() {
    const data = await apiFetch('/api/activity-logs?limit=50');
    if (!data) return;
    const c = document.getElementById('activity-logs-list');
    if (!c) return;
    if (!data.length) { c.innerHTML = '<p class="empty">Nenhuma atividade registrada</p>'; return; }
    c.innerHTML = data.map(l => `
<div class="activity-item">
  <div class="activity-icon ${escAttr(l.type)}">${ACTIVITY_ICONS[l.type] || ''}</div>
  <div class="activity-info">
    <div class="activity-detail">${esc(ACTIVITY_LABELS[l.type] || l.type)}: ${esc(l.detail)}</div>
    <div class="activity-user">por <strong>${esc(l.user || 'Sistema')}</strong></div>
  </div>
  <div class="activity-time" title="${new Date(l.ts).toLocaleString('pt-BR')}">${timeAgo(l.ts)}</div>
</div>`).join('');
}

let plans = [];

async function loadPlans() {
    try {
        const data = await apiFetch('/api/plans');
        if (Array.isArray(data)) plans = data;
    } catch(e) {}
    const af = document.getElementById('plans-admin-form');
    if (af) af.style.display = (DiscordUser && DiscordUser.isAdmin) ? 'block' : 'none';
    renderPlans();
}

const PURCHASE_STATUS = { pending: 'Pendente', approved: 'Aprovado', rejected: 'Rejeitado' };
let allPurchases = [];
let purchasesFilter = 'all';

function setPurchasesFilter(f, btn) {
    purchasesFilter = f;
    document.querySelectorAll('.purchase-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderPurchasesList();
}

async function loadPurchases() {
    const data = await apiFetch('/api/purchases');
    if (!data) return;
    allPurchases = data;
    renderPurchasesList();
}

function renderPurchasesList() {
    const c = document.getElementById('purchases-list');
    const badge = document.getElementById('purchases-pending-count');
    const pendingCount = allPurchases.filter(p => p.status === 'pending').length;
    if (badge) {
        badge.textContent = pendingCount + ' pendente' + (pendingCount === 1 ? '' : 's');
        badge.style.display = pendingCount ? 'inline-flex' : 'none';
    }
    if (!c) return;
    let list = allPurchases;
    if (purchasesFilter === 'pending') list = allPurchases.filter(p => p.status === 'pending');
    if (purchasesFilter === 'approved') list = allPurchases.filter(p => p.status === 'approved');
    if (purchasesFilter === 'rejected') list = allPurchases.filter(p => p.status === 'rejected');
    const filters = `
<div class="purchase-filters">
  <button class="purchase-filter-btn ${purchasesFilter === 'all' ? 'active' : ''}" onclick="setPurchasesFilter('all',this)">Todas</button>
  <button class="purchase-filter-btn ${purchasesFilter === 'pending' ? 'active' : ''}" onclick="setPurchasesFilter('pending',this)">Pendentes${pendingCount ? ' (' + pendingCount + ')' : ''}</button>
  <button class="purchase-filter-btn ${purchasesFilter === 'approved' ? 'active' : ''}" onclick="setPurchasesFilter('approved',this)">Aprovadas</button>
  <button class="purchase-filter-btn ${purchasesFilter === 'rejected' ? 'active' : ''}" onclick="setPurchasesFilter('rejected',this)">Rejeitadas</button>
</div>`;
    if (!list.length) {
        c.innerHTML = filters + '<p class="empty">Nenhuma compra registrada</p>';
        return;
    }
    c.innerHTML = filters + list.map(p => {
        const date = new Date(p.created_at).toLocaleDateString('pt-BR') + ' ' + new Date(p.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const isPending = p.status === 'pending';
        const tier = p.plan_tier || 'bronze';
        const tierColor = TIER_COLORS[tier] || '#5865f2';
        const tierName = TIER_NAMES[tier] || tier;
        const ticketLink = p.ticket_channel_id
            ? `<a class="purchase-ticket-link" href="https://discord.com/channels/${p.ticket_guild_id || DISCORD_USER_GUILD}/${p.ticket_channel_id}" target="_blank"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 4.97-4.03 9-9 9-1.21 0-2.36-.24-3.4-.68L3 20l1.83-4.1A8.94 8.94 0 0 1 3 10c0-4.97 4.03-9 9-9s9 4.03 9 9z"/></svg> Ticket</a>`
            : '';
        return `
<div class="purchase-item ${isPending ? 'pending' : ''}">
  <div class="purchase-tier-stripe" style="background:${tierColor}"></div>
  <div class="purchase-info">
    <div class="purchase-top">
      <span class="purchase-plan"><span class="purchase-id">#${p.id}</span> ${esc(p.plan_name)}</span>
      <span class="purchase-tier-badge" style="color:${tierColor};border-color:${tierColor}55;background:${tierColor}14">${esc(tierName)}</span>
    </div>
    <div class="purchase-buyer" onclick="openStaffProfile('${escJS(String(p.user_id))}')" title="Ver perfil da pessoa">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      ${esc(p.username)}
    </div>
    <div class="purchase-meta">
      <span class="purchase-price">${esc(p.plan_price || '?')}</span>
      <span>${esc(p.plan_duration || '?')}</span>
      <span>${date}</span>
      ${ticketLink}
    </div>
  </div>
  <div class="purchase-side">
    <span class="purchase-status-badge ${escAttr(p.status)}">${esc(PURCHASE_STATUS[p.status] || p.status)}</span>
    ${isPending ? `<div class="purchase-actions">
      <button class="purchase-btn purchase-approve" onclick="approvePurchase(${p.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Aprovar e Ativar</button>
      <button class="purchase-btn purchase-reject" onclick="rejectPurchase(${p.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Rejeitar</button>
    </div>` : ''}
  </div>
</div>`;
    }).join('');
}

async function approvePurchase(id) {
    if (!confirm('Aprovar esta compra e ativar o plano na pessoa?')) return;
    const res = await apiFetch('/api/purchases/' + id + '/approve', { method: 'POST' });
    if (res && res.success) {
        cachedAllPurchases = null;
        loadPurchases();
        alert('Compra aprovada! Plano ativo na pessoa e beneficios concedidos no Discord (se configurado).');
    }
}
async function rejectPurchase(id) {
    if (!confirm('Rejeitar esta compra?')) return;
    const res = await apiFetch('/api/purchases/' + id + '/reject', { method: 'POST' });
    if (res && res.success) {
        cachedAllPurchases = null;
        loadPurchases();
    }
}

let usersRefreshInterval = null;

async function loadUsers() {
    const data = await apiFetch('/api/users/all');
    const c = document.getElementById('users-list');
    if (!c) return;
    if (!data || !data.length) { c.innerHTML = '<p class="empty">Nenhum usuario registrado</p>'; return; }
    c.innerHTML = data.map(u => {
        const badges = [];
        if (u.isOwner) badges.push('<span class="staff-owner-badge">Owner</span>');
        else if (u.isAdmin) badges.push('<span class="staff-owner-badge" style="background:linear-gradient(135deg,rgba(88,101,242,.1),rgba(88,101,242,.03));color:#5865F2;border-color:rgba(88,101,242,.15)">Admin</span>');
        if (u.banned) badges.push('<span class="staff-owner-badge" style="background:linear-gradient(135deg,rgba(239,68,68,.1),rgba(239,68,68,.03));color:#ef4444;border-color:rgba(239,68,68,.15)">Banido</span>');
        const avatarUrl = u.avatar || `https://cdn.discordapp.com/embed/avatars/${parseInt(u.discriminator || '0') % 5}.png`;
        const lastLogin = u.lastLogin ? new Date(u.lastLogin).toLocaleString('pt-BR') : 'Nunca';
        return `
<div class="staff-card" style="cursor:default">
  <img src="${escAttr(avatarUrl)}" class="staff-avatar" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
  <div class="staff-info">
    <div class="staff-name">${esc(u.username)}<span class="staff-disc">#${esc(u.discriminator)}</span></div>
    <div class="staff-id">${esc(u.id)}</div>
    <div class="staff-meta" style="margin-top:4px;font-size:11px;color:var(--muted)">
      <span style="color:${u.online ? '#22c55e' : '#71717a'}">${u.online ? 'Online' : 'Offline'}</span>
      <span>Bots: ${u.botCount}</span>
      <span>Logins: ${u.loginCount}</span>
    </div>
    <div class="staff-meta" style="font-size:11px;color:var(--muted)">
      <span>Ultimo login: ${lastLogin}</span>
    </div>
  </div>
  <div style="display:flex;gap:4px;flex-shrink:0">${badges.join('')}</div>
</div>`;
    }).join('');
}

if (usersRefreshInterval) clearInterval(usersRefreshInterval);
usersRefreshInterval = setInterval(() => {
    const sec = document.getElementById('users-section');
    if (sec && sec.style.display !== 'none') loadUsers();
}, 10000);

const TIER_ICONS = {
    bronze: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    prata: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    ouro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
    diamante: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"/><path d="M12 2v20"/></svg>'
};

const TIER_NAMES = { bronze: 'Bronze', prata: 'Prata', ouro: 'Ouro', diamante: 'Diamante' };
const TIER_COLORS = { bronze: '#cd7f32', prata: '#c0c0c0', ouro: '#ffd700', diamante: '#00c8ff' };

let _featuredPlanIdx = -1;

function renderPlans() {
    const c = document.getElementById('plans-list');
    if (!c) return;
    if (!plans.length) {
        c.innerHTML = '<p class="empty">Nenhum plano criado ainda</p>';
        const cmp = document.getElementById('plans-compare');
        if (cmp) cmp.innerHTML = '';
        return;
    }
    const isAdmin = DiscordUser && DiscordUser.isAdmin;
    _featuredPlanIdx = plans.length >= 3 ? Math.floor(plans.length / 2) : -1;

    c.innerHTML = plans.map((p, i) => {
        const tier = p.tier || 'bronze';
        const color = TIER_COLORS[tier] || '#dc2626';
        const features = (p.features || '').split(',').map(f => f.trim()).filter(Boolean);
        const botsMax = p.botsMax || '∞';
        const isFeat = i === _featuredPlanIdx;
        const spec = features[0] || (String(botsMax) + ' bot' + (botsMax == 1 ? '' : 's'));
        const rest = features.slice(1);
        return `
<div class="plan-card tier-${tier} ${isFeat ? 'featured' : ''}" style="--tier:${color}">
  ${isFeat ? '<div class="plan-featured-badge">Mais Vendido</div>' : ''}
  <div class="plan-head">
    <div class="plan-name">${esc(p.name)}</div>
  </div>
  <div class="plan-spec" style="color:${color}">${esc(spec)}</div>
  <ul class="plan-features">
    ${rest.map(f => `<li>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      ${esc(f)}
    </li>`).join('')}
    <li>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      Suporte 24/7
    </li>
  </ul>
  <div class="plan-bottom">
    <div class="plan-price-wrap">
      <span class="plan-price">${esc(p.price)}</span>
      <span class="plan-duration">/ ${esc(p.duration)}</span>
    </div>
    <button class="plan-buy-btn tier-${tier}" onclick="openCheckoutByIndex(${i})">
      Escolher
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </button>
  </div>
  ${isAdmin ? `<div class="plan-admin-bar"><button class="plan-delete-btn" onclick="deletePlan(${i})">Remover plano</button></div>` : ''}
</div>`;
    }).join('');

    renderPlansCompare();
}

function renderPlansCompare() {
    const box = document.getElementById('plans-compare');
    if (!box) return;
    if (!plans.length) { box.innerHTML = ''; return; }

    const standard = [
        'Monitoramento em tempo real',
        'Explorador de arquivos',
        'Console interativo',
        'Auto reinicializacao',
        'Protecao Anti-DDoS',
        'Suporte 24/7'
    ];
    const allFeats = [];
    plans.forEach(p => {
        (p.features || '').split(',').map(f => f.trim()).filter(Boolean).forEach(f => {
            if (!allFeats.includes(f)) allFeats.push(f);
        });
    });

    const head = `<thead><tr><th>Recursos</th>${plans.map((p, i) =>
        `<th class="${i === _featuredPlanIdx ? 'cmp-feat' : ''}">${esc(p.name)}</th>`).join('')}</tr></thead>`;

    const botsRow = `<tr class="cmp-bots"><td>Maximo de Bots</td>${plans.map(p =>
        `<td class="cmp-num">${esc(String(p.botsMax || '∞'))}</td>`).join('')}</tr>`;

    const feats = [...standard, ...allFeats].map(f => {
        const isStd = standard.includes(f);
        return `<tr><td>${esc(f)}</td>${plans.map(p => {
            const ok = isStd || (p.features || '').toLowerCase().split(',').map(x => x.trim()).includes(f.toLowerCase());
            return ok
                ? `<td class="cmp-yes"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></td>`
                : `<td class="cmp-no">-</td>`;
        }).join('')}</tr>`;
    }).join('');

    box.innerHTML = `
    <div class="plans-compare-head">
      <h2>Compare os planos</h2>
    </div>
    <div class="cmp-scroll">
      <table class="cmp-table">
        ${head}
        <tbody>
          ${botsRow}
          ${feats}
        </tbody>
      </table>
    </div>`;
}

function openCheckoutByIndex(idx) {
    const p = plans[idx];
    if (!p) return;
    openCheckout(p);
}

let _checkoutPlan = null;
function openCheckout(plan) {
    if (!DiscordUser) { alert('Faça login com Discord primeiro'); return; }
    _checkoutPlan = plan;
    const color = TIER_COLORS[plan.tier] || '#5865f2';
    const tierIcon = TIER_ICONS[plan.tier] || '';
    document.getElementById('checkout-tier-badge').innerHTML = tierIcon + ' ' + (TIER_NAMES[plan.tier] || plan.tier);
    document.getElementById('checkout-tier-badge').style.background = color;
    document.getElementById('checkout-plan-name').textContent = plan.name;
    document.getElementById('checkout-plan-price').textContent = plan.price;
    document.getElementById('checkout-plan-dur').textContent = plan.duration;
    const features = (plan.features || '').split(',').map(f => f.trim()).filter(Boolean);
    document.getElementById('checkout-features').innerHTML = features.map(f => `
        <div class="checkout-feat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>${esc(f)}</div>`).join('');
    document.getElementById('checkout-confirm-btn').disabled = false;
    document.getElementById('checkout-overlay').style.display = 'flex';
    document.getElementById('checkout-overlay').style.setProperty('--tier-color', color);
}
function closeCheckout() {
    document.getElementById('checkout-overlay').style.display = 'none';
    _checkoutPlan = null;
}

async function confirmPurchase() {
    if (!_checkoutPlan) return;
    const btn = document.getElementById('checkout-confirm-btn');
    btn.disabled = true;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10"/></svg> Processando...';
    try {
        const res = await fetch('/api/purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ planName: _checkoutPlan.name, planPrice: _checkoutPlan.price, planTier: _checkoutPlan.tier, planDuration: _checkoutPlan.duration, planRoleId: _checkoutPlan.roleId || null })
        });
        const data = await res.json();
        if (data.success) {
            let msg = `Compra #${data.id} registrada com sucesso!`;
            if (data.ticketChannelId) {
                msg += '\n\nUm ticket foi aberto no Discord. Clique OK para abrir.';
                closeCheckout();
                alert(msg);
                window.open(`https://discord.com/channels/${data.ticketGuildId || DISCORD_USER_GUILD}/${data.ticketChannelId}`, '_blank');
            } else {
                msg += '\n\nAbra um ticket no Discord e envie o comprovante.';
                closeCheckout();
                alert(msg);
            }
            loadPurchases();
        } else {
            btn.disabled = false;
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg> Confirmar Compra';
            alert(data.error || 'Erro ao processar compra');
        }
    } catch (e) {
        btn.disabled = false;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg> Confirmar Compra';
        alert('Erro de conexao');
    }
}

async function addPlan() {
    const name = document.getElementById('plan-name').value.trim();
    const price = document.getElementById('plan-price').value.trim();
    const duration = document.getElementById('plan-duration').value.trim();
    const tier = document.getElementById('plan-tier').value;
    const features = document.getElementById('plan-features').value.trim();
    const botsMax = document.getElementById('plan-bots').value || '∞';
    const roleId = document.getElementById('plan-role-id').value.trim() || null;
    const s = document.getElementById('plan-status');
    if (!name || !price || !duration) { s.textContent = 'Preencha nome, preco e duracao'; s.style.color = '#ef4444'; return; }
    const res = await apiFetch('/api/plans', { method: 'POST', body: JSON.stringify({ name, price, duration, tier, features, botsMax, roleId }) });
    if (res && res.success) {
        document.getElementById('plan-name').value = '';
        document.getElementById('plan-price').value = '';
        document.getElementById('plan-duration').value = '';
        document.getElementById('plan-features').value = '';
        document.getElementById('plan-bots').value = '';
        document.getElementById('plan-role-id').value = '';
        document.getElementById('plan-tier').value = 'bronze';
        s.textContent = 'Plano criado!'; s.style.color = '#22c55e';
        setTimeout(() => { s.textContent = ''; }, 2000);
        await loadPlans();
    } else {
        s.textContent = (res && res.error) || 'Erro ao criar plano'; s.style.color = '#ef4444';
    }
}

async function deletePlan(i) {
    const plan = plans[i];
    if (!plan || !plan.id) return;
    if (!confirm('Remover este plano?')) return;
    const res = await apiFetch('/api/plans/' + plan.id, { method: 'DELETE' });
    if (res && res.success) await loadPlans();
    else alert('Erro ao remover plano');
}

// === DATABASES ===
const DB_ICONS = { postgres: 'PG', mongodb: 'MG', mysql: 'MY', redis: 'RD' };
const DB_COLORS = { postgres: '#336791', mongodb: '#4DB33D', mysql: '#4479A1', redis: '#DC382D' };
const DB_PORTS = { postgres: 5432, mongodb: 27017, mysql: 3306, redis: 6379 };

let _dbPasswords = {};

async function loadDatabases() {
    const data = await apiFetch('/api/databases');
    const c = document.getElementById('databases-list');
    if (!c) return;
    if (!data || !data.length) { c.innerHTML = '<p class="empty">Nenhum banco criado</p>'; return; }
    c.innerHTML = data.map(d => {
        const color = DB_COLORS[d.db_type] || '#555';
        const storedPwd = _dbPasswords[d.id];
        return `
<div class="db-card">
  <div class="db-card-header">
    <div class="db-icon" style="background:${color}20;color:${color};border:1px solid ${color}30">
      ${DB_ICONS[d.db_type] || 'DB'}
    </div>
    <div class="db-card-info">
      <div class="db-card-name">${esc(d.db_name)}</div>
      <div class="db-card-type">${esc(d.db_type.toUpperCase())} &middot; ${esc(d.db_user)}</div>
    </div>
    <span class="db-status-badge active">Ativo</span>
  </div>
  <div class="db-card-details">
    <div class="db-detail"><span class="db-detail-label">Host</span><span class="db-detail-val">${esc(d.db_host)}</span></div>
    <div class="db-detail"><span class="db-detail-label">Porta</span><span class="db-detail-val">${d.db_port}</span></div>
    <div class="db-detail"><span class="db-detail-label">Database</span><span class="db-detail-val">${esc(d.db_name)}</span></div>
    <div class="db-detail"><span class="db-detail-label">Criado</span><span class="db-detail-val">${new Date(d.created_at).toLocaleDateString('pt-BR')}</span></div>
  </div>
  ${storedPwd ? `<div class="db-card-details" style="border-top:1px solid var(--border);margin-top:0;margin-bottom:12px;padding-top:10px">
    <div class="db-detail" style="grid-column:1/-1"><span class="db-detail-label">Senha atual</span><span class="db-detail-val" style="color:#f59e0b;word-break:break-all">${esc(storedPwd)}</span></div>
  </div>` : ''}
  <div class="db-card-actions">
    <button class="db-btn db-btn-copy" onclick="copyDbConn(${d.id},'${escJS(d.db_name)}','${escJS(d.db_type)}','${escJS(d.db_host)}',${d.db_port},'${escJS(d.db_user)}')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      Copiar Conexao
    </button>
    <button class="db-btn db-btn-reset" onclick="resetDbPassword(${d.id},'${escJS(d.db_name)}')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
      Resetar Senha
    </button>
    <button class="db-btn db-btn-delete" onclick="deleteDatabase(${d.id},'${escJS(d.db_name)}')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      Deletar
    </button>
  </div>
</div>`;
    }).join('');
}

async function createDatabase() {
    const dbType = 'postgres';
    const dbName = document.getElementById('db-name').value.trim();
    const s = document.getElementById('db-status');
    if (!dbName) { s.textContent = 'Digite o nome do banco'; s.style.color = '#ef4444'; return; }
    s.textContent = 'Criando banco real no PostgreSQL...'; s.style.color = '#f59e0b';
    const data = await apiFetch('/api/databases', { method: 'POST', body: JSON.stringify({ dbType, dbName }) });
    if (data && data.success) {
        _dbPasswords[data.db.id] = data.db.db_password;
        s.innerHTML = `Banco "<strong>${esc(data.db.db_name)}</strong>" criado!<br><span style="font-size:11px;color:#a1a1aa">Usuario: ${esc(data.db.db_user)} | Host: ${esc(data.db.db_host)}:${data.db.db_port}</span><br><span style="font-size:11px;color:#f59e0b">Senha: ${esc(data.db.db_password)} (copie agora!)</span>`;
        s.style.color = '#22c55e';
        document.getElementById('db-name').value = '';
        loadDatabases();
    } else {
        s.textContent = (data && data.error) || 'Erro ao criar banco'; s.style.color = '#ef4444';
    }
}

async function deleteDatabase(id, name) {
    if (!confirm(`Deletar banco "${name}"? Todos os dados serao perdidos.`)) return;
    if (!confirm(`Tem certeza absoluta? Isso nao pode ser desfeito.`)) return;
    const data = await apiFetch(`/api/databases/${id}`, { method: 'DELETE' });
    if (data && data.success) { delete _dbPasswords[id]; loadDatabases(); }
}

async function resetDbPassword(id, name) {
    if (!confirm(`Resetar senha do banco "${name}"? A senha antiga deixara de funcionar.`)) return;
    const data = await apiFetch(`/api/databases/${id}/reset-password`, { method: 'POST' });
    if (data && data.success) {
        _dbPasswords[id] = data.newPassword;
        loadDatabases();
    }
}

function copyDbConn(id, name, type, host, port, user) {
    const pwd = _dbPasswords[id] || 'SENHA';
    const connStr = { postgres: `postgresql://${user}:${pwd}@${host}:${port}/${name}` };
    const text = connStr[type] || `${user}:${pwd}@${host}:${port}/${name}`;
    navigator.clipboard.writeText(text).then(() => alert('String de conexao copiada!'));
}
