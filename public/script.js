let AUTH_PASSWORD = '';
let DiscordUser = null;
let refreshInterval = null;
let logsInterval = null;
let serverLogsInterval = null;
let currentLogsBot = null;
let allStaffs = [];
let allServerLogs = [];

async function apiFetch(url, options = {}) {
    options.headers = { 'Content-Type': 'application/json', ...options.headers };
    try {
        const res = await fetch(url, options);
        if (res.status === 401) { document.getElementById('login-error').textContent = 'Sessao expirada ou senha incorreta'; return null; }
        if (!res.ok) return null;
        return res.json();
    } catch(e) {
        console.warn('apiFetch erro de rede:', url, e.message);
        return null;
    }
}

function showTab(tab, btn) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    btn.classList.add('active');
    if (tab === 'staffs') { loadStaffs(); refreshServerLogs(); }
}

function showSubTab(panelId, btnId) {
    document.querySelectorAll('.subtab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(panelId).classList.add('active');
    document.getElementById(btnId).classList.add('active');
    if (panelId === 'logs-panel') refreshServerLogs();
}

function getAvatar(user) {
    if (user && user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
}

function getBanner(user) {
    if (user && user.banner) return `https://cdn.discordapp.com/banners/${user.id}/${user.banner}.png?size=600`;
    return 'https://cdn.discordapp.com/attachments/1529031153586147469/1530538178132316210/realpecado_mc_ig.png?ex=6a6741c1&is=6a65f041&hm=fd571caaaee8430088d24d6ce5778e5a5e90518b295ec2e28723d7b7aa97a766&';
}

async function doLogin() {
    const pass = document.getElementById('login-password').value;
    if (!pass) { document.getElementById('login-error').textContent = 'Digite a senha'; return; }
    document.getElementById('login-error').textContent = '';
    document.getElementById('login-error').style.color = '';

    try {
        const res = await fetch('/auth/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pass })
        });
        const data = await res.json();
        if (data.success) {
            enterApp();
        } else {
            document.getElementById('login-error').textContent = data.error || 'Senha incorreta';
            document.getElementById('login-error').style.color = '#ef4444';
        }
    } catch(e) {
        document.getElementById('login-error').textContent = 'Erro ao conectar';
        document.getElementById('login-error').style.color = '#ef4444';
    }
}

const OWNER_ID = '1473070694425301205';

function enterApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'flex';

    const avatar = getAvatar(DiscordUser);
    const banner = getBanner(DiscordUser);
    const name = DiscordUser ? DiscordUser.username : 'Admin';
    const id = DiscordUser ? `ID: ${DiscordUser.id}` : 'Login via senha';

    document.getElementById('sidebar-avatar').src = avatar;
    document.getElementById('sidebar-name').textContent = name;
    document.getElementById('profile-avatar').src = avatar;
    document.getElementById('profile-banner').src = banner;
    document.getElementById('profile-name').textContent = name;
    document.getElementById('profile-id').textContent = id;

    if (DiscordUser && DiscordUser.id === OWNER_ID) {
        document.getElementById('btn-staffs').style.display = 'flex';
    }

    if (DiscordUser && DiscordUser.created_at) {
        const d = new Date(parseInt(DiscordUser.created_at) * 1000 + 1420070400000);
        document.getElementById('ps-since').textContent = d.toLocaleDateString('pt-BR', { year: 'numeric', month: 'short' });
    } else {
        document.getElementById('ps-since').textContent = new Date().toLocaleDateString('pt-BR', { year: 'numeric', month: 'short' });
    }

    document.getElementById('profile-badges').innerHTML = DiscordUser
        ? '<span class="badge badge-owner">Owner</span><span class="badge badge-admin">Admin</span>'
        : '<span class="badge badge-admin">Admin</span>';

    refreshBots();
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(refreshBots, 2000);
    // Auto-refresh logs se estiver na aba
    if (serverLogsInterval) clearInterval(serverLogsInterval);
    serverLogsInterval = setInterval(() => {
        const logsPanel = document.getElementById('logs-panel');
        if (logsPanel && logsPanel.classList.contains('active')) refreshServerLogs();
    }, 3000);
}

function logout() {
    DiscordUser = null;
    if (refreshInterval) clearInterval(refreshInterval);
    if (logsInterval) clearInterval(logsInterval);
    if (serverLogsInterval) clearInterval(serverLogsInterval);
    fetch('/auth/logout').then(() => { window.location.reload(); });
}

document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

document.getElementById('bot-file').addEventListener('change', function() {
    if (this.files.length > 0) document.getElementById('file-label-text').textContent = this.files[0].name;
});

async function refreshBots() {
    const data = await apiFetch('/api/bots');
    if (data) renderBots(data);
    refreshDiskStatus();
}

async function refreshDiskStatus() {
    const data = await apiFetch('/api/disk');
    if (!data) return;
    let el = document.getElementById('disk-status');
    if (!el) return;
    const pct = 100 - data.freePercent;
    let color = '#22c55e';
    if (pct >= 70) color = '#f59e0b';
    if (pct >= 90) color = '#ef4444';
    el.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
            <span style="color:${color}">${data.usedMB}MB / ${data.limitMB}MB usado</span>
            <div style="flex:1;height:4px;background:var(--border);border-radius:2px;overflow:hidden;min-width:60px">
                <div style="height:100%;width:${pct}%;background:${color};border-radius:2px;transition:width .4s"></div>
            </div>
        </div>`;
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

    c.innerHTML = bots.map(b => {
        let statusLabel = 'Offline';
        if (b.status === 'running') statusLabel = 'Online';
        else if (b.status === 'installing') statusLabel = 'Instalando...';
        else if (b.status === 'error') statusLabel = 'Erro';

        return `
<div class="bot-card ${b.status}">
  <div class="bot-top"><h3>${b.name}</h3><span class="bot-badge ${b.status}">${statusLabel}</span></div>
  <div class="bot-btns">
    <button class="b-start" onclick="startBot('${b.name}')" ${b.status==='installing'?'disabled':''}><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>Ligar</button>
    <button class="b-stop" onclick="stopBot('${b.name}')"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>Desligar</button>
    <button class="b-restart" onclick="restartBot('${b.name}')" ${b.status==='installing'?'disabled':''}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/></svg>Reiniciar</button>
    <button class="b-console" onclick="openLogs('${b.name}')"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>Console</button>
    <button class="b-delete" onclick="deleteBot('${b.name}')"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
  </div>
</div>`;
    }).join('');
}

async function createBot() {
    const name = document.getElementById('bot-name').value.trim();
    const fi = document.getElementById('bot-file');
    const s = document.getElementById('create-status');
    if (!name) { s.textContent='Digite um nome';s.style.color='#ef4444';return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) { s.textContent='Nome invalido: use apenas letras, numeros, _ e -';s.style.color='#ef4444';return; }
    if (!fi.files.length) { s.textContent='Selecione um .ZIP';s.style.color='#ef4444';return; }
    if (!fi.files[0].name.endsWith('.zip')) { s.textContent='Apenas .ZIP';s.style.color='#ef4444';return; }

    const fd = new FormData();
    fd.append('name', name);
    fd.append('file', fi.files[0]);
    s.textContent='Enviando ZIP...';s.style.color='#f59e0b';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000);

    try {
        const res = await fetch('/api/bots', { method:'POST', body:fd, signal:controller.signal });
        clearTimeout(timeout);

        if (res.status === 401) {
            s.textContent='Sessao expirada, recarregue a pagina';s.style.color='#ef4444';return;
        }
        if (res.status === 403) {
            s.textContent='Sem permissao para criar bots';s.style.color='#ef4444';return;
        }
        if (res.status === 413) {
            s.textContent='ZIP muito grande! Maximo 50MB. Remova a pasta node_modules antes de zipar.';s.style.color='#ef4444';return;
        }
        if (res.status === 507) {
            s.textContent='Servidor sem espaco em disco. Aguarde o dono liberar espaco.';s.style.color='#ef4444';return;
        }

        let data;
        try { data = await res.json(); } catch(jsonErr) {
            s.textContent='Erro no servidor (status ' + res.status + ')';s.style.color='#ef4444';return;
        }

        if (data.success) {
            s.textContent='Bot criado com sucesso!';s.style.color='#22c55e';
            document.getElementById('bot-name').value='';
            document.getElementById('bot-file').value='';
            document.getElementById('file-label-text').textContent='Selecionar .ZIP';
            refreshBots();
        } else {
            s.textContent=data.error||'Erro desconhecido';s.style.color='#ef4444';
        }
    } catch(e) {
        clearTimeout(timeout);
        if (e.name === 'AbortError') {
            s.textContent='Upload demorou demais, tente um ZIP menor';s.style.color='#ef4444';
        } else {
            s.textContent='Erro de conexao com o servidor. Verifique se esta logado e tente novamente.';s.style.color='#ef4444';
        }
    }
}

async function startBot(n) { await apiFetch(`/api/bots/${n}/start`,{method:'POST'});refreshBots(); }
async function stopBot(n) { await apiFetch(`/api/bots/${n}/stop`,{method:'POST'});refreshBots(); }
async function restartBot(n) { await apiFetch(`/api/bots/${n}/restart`,{method:'POST'});refreshBots(); }
async function deleteBot(n) { if(!confirm(`Deletar "${n}"?`))return;await apiFetch(`/api/bots/${n}`,{method:'DELETE'});refreshBots(); }

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
    const d=await apiFetch(`/api/bots/${currentLogsBot}/logs`);
    if(d&&d.logs){const c=document.getElementById('logs-content');c.innerHTML=d.logs.map(l=>`<div>${esc(l)}</div>`).join('');c.scrollTop=c.scrollHeight;}
}
function closeLogs(){document.getElementById('logs-section').style.display='none';currentLogsBot=null;clearInterval(logsInterval);}
function esc(t){const d=document.createElement('div');d.textContent=t;return d.innerHTML;}

function timeAgo(dateStr) {
    if (!dateStr) return '-';
    const now = new Date();
    const then = new Date(dateStr);
    const diff = Math.floor((now - then) / 1000);
    if (diff < 60) return `${diff}s atras`;
    if (diff < 3600) return `${Math.floor(diff/60)}min atras`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h atras`;
    if (diff < 2592000) return `${Math.floor(diff/86400)}d atras`;
    return then.toLocaleDateString('pt-BR');
}

function formatCount(n) {
    if (!n) return '0';
    if (n === 1) return '1x';
    return `${n}x`;
}

async function loadStaffs() {
    const data = await apiFetch('/api/staffs');
    if (!data) return;
    allStaffs = data;
    renderStaffs(data);
}

// === LOGS DO SERVIDOR ===
const LOG_COLORS = { info: '#71717a', warn: '#f59e0b', error: '#ef4444', bot: '#5865F2', auth: '#22c55e' };
const LOG_ICONS = {
    info: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    warn: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    error: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    bot: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    auth: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
};

async function refreshServerLogs() {
    const data = await apiFetch('/api/server-logs?limit=300');
    if (!data) return;
    allServerLogs = data.logs;
    renderServerLogs(allServerLogs);
}

function filterServerLogs() {
    const type = document.getElementById('log-filter').value;
    const filtered = type ? allServerLogs.filter(l => l.type === type) : allServerLogs;
    renderServerLogs(filtered);
}

function renderServerLogs(logs) {
    const c = document.getElementById('server-logs-content');
    if (!logs || !logs.length) { c.innerHTML = '<p class="empty">Nenhum log registrado ainda</p>'; return; }
    const wasAtBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 40;
    c.innerHTML = logs.map(l => {
        const color = LOG_COLORS[l.type] || '#71717a';
        const icon = LOG_ICONS[l.type] || LOG_ICONS.info;
        return `<div class="slog-line">
            <span class="slog-time">${l.date} ${l.time}</span>
            <span class="slog-type" style="color:${color}">${icon} ${l.type.toUpperCase()}</span>
            <span class="slog-msg">${esc(l.msg)}</span>
        </div>`;
    }).join('');
    if (wasAtBottom) c.scrollTop = c.scrollHeight;
}

function clearServerLogsView() {
    document.getElementById('server-logs-content').innerHTML = '<p class="empty">Visualizacao limpa. Os logs continuam no servidor.</p>';
}

function renderStaffs(staffs) {
    const c = document.getElementById('staffs-list');
    const active = staffs.filter(s => !s.banned).length;
    const banned = staffs.filter(s => s.banned).length;

    document.getElementById('staffs-total').textContent = staffs.length;
    document.getElementById('staffs-active').textContent = active;
    document.getElementById('staffs-banned-count').textContent = banned;

    if (!staffs.length) { c.innerHTML = '<p class="empty">Nenhum staff registrado ainda</p>'; return; }

    c.innerHTML = staffs.map(s => {
        const isPasswordAdmin = s.id === 'password-admin';
        const isOwner = s.id === OWNER_ID;

        let avatar;
        if (isPasswordAdmin) {
            avatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="#5865F2" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>');
        } else if (s.avatar) {
            avatar = `https://cdn.discordapp.com/avatars/${s.id}/${s.avatar}.png?size=96`;
        } else {
            avatar = 'https://cdn.discordapp.com/embed/avatars/0.png';
        }

        const logins = formatCount(s.loginCount);
        const lastLogin = timeAgo(s.lastLogin);
        const registered = s.createdAt ? new Date(s.createdAt).toLocaleDateString('pt-BR') : '-';
        const displayName = isPasswordAdmin ? 'Admin (Senha)' : s.username;

        return `
        <div class="staff-card ${s.banned ? 'banned' : ''}">
            <div class="staff-avatar-wrap">
                <img src="${avatar}" class="staff-avatar" alt="">
                <div class="staff-online-dot"></div>
            </div>
            <div class="staff-info">
                <div class="staff-name-row">
                    <span class="staff-name">${esc(displayName)}</span>
                    ${isOwner ? '<span class="staff-owner-badge">Owner</span>' : ''}
                    ${isPasswordAdmin ? '<span class="staff-owner-badge" style="background:linear-gradient(135deg,rgba(88,101,242,.1),rgba(88,101,242,.03));color:#5865F2;border-color:rgba(88,101,242,.15)">Senha</span>' : ''}
                </div>
                <span class="staff-id">${s.id}</span>
                <div class="staff-meta">
                    <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg> ${logins} login</span>
                    <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${lastLogin}</span>
                    <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${registered}</span>
                </div>
            </div>
            <div class="staff-actions">
                <button class="staff-btn btn-copy-id" onclick="copyStaffId('${s.id}',this)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    ID
                </button>
                ${!isOwner && !isPasswordAdmin ? (s.banned
                    ? `<button class="staff-btn btn-unban" onclick="unbanStaff('${s.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Desbanir</button>`
                    : `<button class="staff-btn btn-ban" onclick="banStaff('${s.id}','${esc(s.username)}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Banir</button>`
                ) : ''}
            </div>
        </div>`;
    }).join('');
}

function filterStaffs() {
    const q = document.getElementById('staffs-search').value.toLowerCase().trim();
    if (!q) { renderStaffs(allStaffs); return; }
    const filtered = allStaffs.filter(s => s.username.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
    renderStaffs(filtered);
}

function copyStaffId(id, btn) {
    navigator.clipboard.writeText(id).then(() => {
        const original = btn.innerHTML;
        btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copiado!';
        setTimeout(() => { btn.innerHTML = original; }, 2000);
    });
}

async function banStaff(id, name) {
    if (!confirm(`Banir "${name}" do painel?\nEle nao conseguira mais acessar via Discord.`)) return;
    const res = await apiFetch(`/api/staffs/${id}/ban`, { method: 'POST' });
    if (res && res.success) loadStaffs();
}

async function unbanStaff(id) {
    const res = await apiFetch(`/api/staffs/${id}/unban`, { method: 'POST' });
    if (res && res.success) loadStaffs();
}

async function checkSession() {
    try {
        const r = await fetch('/api/me');
        if (r.ok) {
            const d = await r.json();
            if (d.id) {
                DiscordUser = d;
                enterApp();
            }
        }
    } catch(e) {}
}

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('banned') === '1') {
    document.addEventListener('DOMContentLoaded', () => {
        const err = document.getElementById('login-error');
        if (err) { err.textContent = 'Sua conta foi banida do painel.'; err.style.color = '#ef4444'; }
    });
}

checkSession();
