const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const multer = require('multer');
const AdmZip = require('adm-zip');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const SITE_BANNER_URL = '/realpecado_mc_ig.png';

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || process.env.ISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'https://realpecado.up.railway.app/auth/discord/callback';
const PASSWORD = process.env.PASSWORD || 'admin';
const OWNER_ID = '1473070694425301205';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

app.use(morgan('short'));
app.use(express.json({ limit: '600mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const BOTS_DIR = process.env.BOTS_DIR || path.join(__dirname, 'bots');
if (!fs.existsSync(BOTS_DIR)) fs.mkdirSync(BOTS_DIR, { recursive: true });

const upload = multer({
    dest: path.join(__dirname, 'uploads'),
    limits: { fileSize: 500 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => { if (!file.originalname.endsWith('.zip')) cb(new Error('Apenas .ZIP')); else cb(null, true); }
});

let sessions = {};
let bots = {};
let activityLogs = [];
let announcements = [];
let lastAnnouncementId = 0;
let autoAnnouncement = { enabled: false, message: '', intervalMs: 600000 };
let autoAnnounceTimer = null;
const MAX_ACTIVITY_LOGS = 200;

const failedLogins = {};
const BRUTE_THRESHOLD = 5;
const BRUTE_WINDOW = 30 * 60 * 1000;

const loginLimiter = rateLimit({
    windowMs: 60 * 1000, max: 10,
    message: { error: 'Muitas tentativas. Aguarde.' }
});

function checkBruteForce(ip) {
    const entry = failedLogins[ip];
    if (!entry) return false;
    if (Date.now() - entry.time > BRUTE_WINDOW) { delete failedLogins[ip]; return false; }
    return entry.count >= BRUTE_THRESHOLD;
}

function cookieAttrs(req) {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const secure = proto === 'https';
    return `HttpOnly; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
}
function clearCookieAttrs(req) {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const secure = proto === 'https';
    return `session=; HttpOnly; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

function getSessionSync(req) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/session=([^;]+)/);
    if (match && sessions[match[1]]) return sessions[match[1]];
    const pass = req.headers['x-auth-password'];
    if (pass && pass === PASSWORD) return { type: 'password', username: 'Admin (Senha)', id: 'password-user' };
    return null;
}

async function getSession(req) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/session=([^;]+)/);
    if (match) {
        if (sessions[match[1]]) return sessions[match[1]];
        const fromDb = await db.getSession(match[1]);
        if (fromDb) { sessions[match[1]] = fromDb; return fromDb; }
    }
    const pass = req.headers['x-auth-password'];
    if (pass && pass === PASSWORD) return { type: 'password', username: 'Admin (Senha)', id: 'password-user' };
    return null;
}

function isOwner(session) { return session && session.id === OWNER_ID; }
async function isAdmin(session) {
    if (!session) return false;
    if (isOwner(session)) return true;
    if (session.type === 'password') return true;
    const admins = await db.getAdmins();
    return admins.includes(session.id);
}

function auth(req, res, next) { getSession(req).then(s => { if (!s) return res.status(401).json({ error: 'Nao autorizado' }); req.session = s; next(); }).catch(() => res.status(401).json({ error: 'Erro auth' })); }
function adminOnly(req, res, next) { auth(req, res, () => { isAdmin(req.session).then(a => { if (!a) return res.status(403).json({ error: 'Apenas admin' }); next(); }); }); }
function ownerOnly(req, res, next) { auth(req, res, () => { if (!isOwner(req.session)) return res.status(403).json({ error: 'Apenas owner' }); next(); }); }

function logActivity(type, detail, user) {
    activityLogs.unshift({ type, detail, user: user ? user.username || user.id : 'Sistema', ts: new Date().toISOString() });
    if (activityLogs.length > MAX_ACTIVITY_LOGS) activityLogs.length = MAX_ACTIVITY_LOGS;
}

// === DISCORD OAUTH ===
app.get('/auth/discord', (req, res) => {
    if (!DISCORD_CLIENT_SECRET) return res.redirect('/?error=' + encodeURIComponent('DISCORD_CLIENT_SECRET nao configurado'));
    const params = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, redirect_uri: DISCORD_REDIRECT_URI, response_type: 'code', scope: 'identify' });
    res.redirect('https://discord.com/api/oauth2/authorize?' + params);
});

app.get('/auth/discord/callback', async (req, res) => {
    const { code, error: discordError } = req.query;
    if (discordError) return res.redirect('/?error=' + encodeURIComponent(discordError));
    if (!code) return res.redirect('/?error=no_code');
    try {
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: DISCORD_REDIRECT_URI, scope: 'identify' })
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
            console.error('OAuth FALHOU:', JSON.stringify(tokenData));
            return res.redirect('/?error=' + encodeURIComponent(tokenData.error_description || tokenData.error || 'Token exchange falhou'));
        }
        const userRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: 'Bearer ' + tokenData.access_token } });
        const user = await userRes.json();
        console.log('OAuth login ok:', user.username);
        if (await db.isBanned(user.id)) return res.redirect('/?banned=1');
        const sessionToken = crypto.randomBytes(32).toString('hex');
        sessions[sessionToken] = { type: 'discord', id: user.id, username: user.username, discriminator: user.discriminator, avatar: user.avatar, banner: user.banner || null, banner_color: user.banner_color || null };
        await db.saveSession(sessionToken, { ...sessions[sessionToken], createdAt: new Date().toISOString() });
        await db.upsertStaff(user.id, { username: user.username, discriminator: user.discriminator || '0', avatar: user.avatar, lastLogin: new Date().toISOString(), $inc: { loginCount: 1 } });
        logActivity('login', 'Login via Discord', { id: user.id, username: user.username });
        res.setHeader('Set-Cookie', 'session=' + sessionToken + '; ' + cookieAttrs(req));
        res.redirect('/');
    } catch (e) {
        console.error('OAuth callback error:', e.message);
        res.redirect('/?error=' + encodeURIComponent(e.message));
    }
});

app.post('/auth/password', loginLimiter, async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    if (checkBruteForce(ip)) {
        logActivity('brute_force', 'Tentativa de brute force de ' + ip, null);
        return res.status(429).json({ error: 'Bloqueado por multiplas tentativas. Aguarde 30 minutos.' });
    }
    const { password } = req.body;
    if (typeof password !== 'string' || password !== PASSWORD) {
        if (failedLogins[ip]) failedLogins[ip].count++; else failedLogins[ip] = { count: 1, time: Date.now() };
        return res.status(401).json({ error: 'Senha incorreta' });
    }
    if (failedLogins[ip]) failedLogins[ip].count = 0;
    const sessionToken = crypto.randomBytes(32).toString('hex');
    sessions[sessionToken] = { type: 'password', username: 'Admin (Senha)', id: 'password-user' };
    await db.saveSession(sessionToken, { type: 'password', username: 'Admin (Senha)', id: 'password-user', createdAt: new Date().toISOString() });
    logActivity('login', 'Login via senha', { id: 'password-user', username: 'Admin' });
    res.setHeader('Set-Cookie', 'session=' + sessionToken + '; ' + cookieAttrs(req));
    res.json({ success: true });
});

app.get('/auth/logout', async (req, res) => {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/session=([^;]+)/);
    if (match) { delete sessions[match[1]]; await db.deleteSession(match[1]); }
    res.setHeader('Set-Cookie', clearCookieAttrs(req));
    res.json({ success: true });
});

app.get('/api/me', auth, async (req, res) => {
    const session = req.session;
    const adminStatus = await isAdmin(session);
    if (session.type === 'discord') {
        try { await db.upsertStaff(session.id, { username: session.username, discriminator: session.discriminator || '0', avatar: session.avatar, lastLogin: new Date().toISOString(), $inc: { loginCount: 1 } }); } catch(e) { console.error('Erro upsertStaff em /api/me:', e.message); }
        res.json({ id: session.id, username: session.username, discriminator: session.discriminator, avatar: session.avatar, banner: session.banner, banner_color: session.banner_color, type: 'discord', isOwner: isOwner(session), isAdmin: adminStatus });
    } else {
        res.json({ id: '0', username: 'Admin (Senha)', discriminator: '0', avatar: null, banner: null, banner_color: null, type: 'password', isOwner: false, isAdmin: true });
    }
});

// === STAFFS ===
app.get('/api/staffs', adminOnly, async (req, res) => {
    const session = req.session;
    const staffs = await db.getStaffs();
    const bannedList = await db.getBanned();
    const admins = await db.getAdmins();
    const activeIds = new Set(Object.values(sessions).map(s => s.id));
    const result = staffs.filter(s => {
        if (isOwner(session)) return true;
        if (s.id === OWNER_ID) return false;
        return s.id !== session.id;
    }).map(s => ({
        id: s.id, username: s.username, discriminator: s.discriminator, avatar: s.avatar,
        createdAt: s.createdAt, lastLogin: s.lastLogin, loginCount: s.loginCount || 1,
        banned: bannedList.some(b => b.id === s.id),
        isAdmin: admins.includes(s.id),
        online: activeIds.has(s.id)
    }));
    res.json(result);
});

app.get('/api/users/all', ownerOnly, async (req, res) => {
    const staffs = await db.getStaffs();
    const bannedList = await db.getBanned();
    const admins = await db.getAdmins();
    const activeIds = new Set(Object.values(sessions).map(s => s.id));
    const result = staffs.map(s => ({
        id: s.id, username: s.username, discriminator: s.discriminator, avatar: s.avatar,
        createdAt: s.createdAt, lastLogin: s.lastLogin, loginCount: s.loginCount || 1,
        botCount: Object.values(bots).filter(b => b.owner === s.id).length,
        banned: bannedList.some(b => b.id === s.id),
        isOwner: s.id === OWNER_ID,
        isAdmin: admins.includes(s.id),
        online: activeIds.has(s.id)
    }));
    res.json(result);
});

app.post('/api/staffs/:id/ban', adminOnly, async (req, res) => {
    const id = req.params.id;
    const staff = await db.getStaff(id);
    await db.addBanned(id, { username: staff ? staff.username : 'Desconhecido', bannedAt: new Date().toISOString() });
    logActivity('ban', 'Baniu ' + (staff ? staff.username : id), getSessionSync(req));
    res.json({ success: true });
});
app.post('/api/staffs/:id/unban', ownerOnly, async (req, res) => {
    const staff = await db.getStaff(req.params.id);
    await db.removeBanned(req.params.id);
    logActivity('unban', 'Desbaniu ' + (staff ? staff.username : req.params.id), getSessionSync(req));
    res.json({ success: true });
});
app.post('/api/staffs/:id/makeadmin', ownerOnly, async (req, res) => {
    const id = req.params.id;
    const staff = await db.getStaff(id);
    await db.addAdmin(id);
    logActivity('make_admin', 'Tornou ' + (staff ? staff.username : id) + ' admin', getSessionSync(req));
    res.json({ success: true });
});
app.post('/api/staffs/:id/removeadmin', ownerOnly, async (req, res) => {
    const id = req.params.id;
    const staff = await db.getStaff(id);
    await db.removeAdmin(id);
    logActivity('remove_admin', 'Removeu admin de ' + (staff ? staff.username : id), getSessionSync(req));
    res.json({ success: true });
});

// === BOTS ===
function getBotPath(name) { return path.join(BOTS_DIR, name); }

function getBotStatus(name) {
    try {
        const proc = bots[name];
        if (proc && proc.exitCode === null) {
            return { running: true, pid: proc.pid, uptime: Math.floor((Date.now() - proc._startedAt) / 1000) };
        }
        return { running: false };
    } catch (e) { return { running: false }; }
}

function startBotProcess(name) {
    const botPath = getBotPath(name);
    const mainFile = findMainFile(botPath);
    if (!mainFile) return { error: 'Nenhum entry point encontrado' };
    try {
        if (bots[name]) {
            try { bots[name].kill(); } catch(e) {}
            delete bots[name];
        }
        const proc = spawn('node', [mainFile], {
            cwd: botPath,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, NODE_PATH: path.join(botPath, 'node_modules') }
        });
        proc._startedAt = Date.now();
        proc._name = name;
        proc.stdout.on('data', d => {
            if (!proc._logs) proc._logs = [];
            proc._logs.push(d.toString());
            if (proc._logs.length > 500) proc._logs.splice(0, 100);
        });
        proc.stderr.on('data', d => {
            if (!proc._logs) proc._logs = [];
            proc._logs.push('[ERRO] ' + d.toString());
            if (proc._logs.length > 500) proc._logs.splice(0, 100);
        });
        proc.on('exit', (code, signal) => {
            console.log('Bot ' + name + ' encerrou (codigo=' + code + ' sinal=' + signal + ')');
            if (bots[name] === proc) {
                delete bots[name];
                db.saveBot(name, { status: 'stopped', stoppedAt: new Date().toISOString(), exitCode: code });
            }
        });
        proc.on('error', err => console.error('Erro ao iniciar bot ' + name + ':', err.message));
        bots[name] = proc;
        db.saveBot(name, { status: 'running', startedAt: new Date().toISOString() });
        return { success: true };
    } catch (e) { return { error: e.message }; }
}

function stopBotProcess(name) {
    if (bots[name]) {
        try { bots[name].kill('SIGTERM'); } catch(e) {}
        setTimeout(() => { try { if (bots[name]) bots[name].kill('SIGKILL'); } catch(e) {} }, 3000);
        delete bots[name];
    }
    db.saveBot(name, { status: 'stopped', stoppedAt: new Date().toISOString() });
    return { success: true };
}

function findMainFile(dir) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try { const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); if (pkg.main && fs.existsSync(path.join(dir, pkg.main))) return path.join(dir, pkg.main); } catch(e) {}
    }
    for (const f of ['index.js', 'bot.js', 'main.js', 'app.js', 'server.js']) {
        if (fs.existsSync(path.join(dir, f))) return path.join(dir, f);
    }
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
    return files.length ? path.join(dir, files[0]) : null;
}

async function getBotList() {
    const dbBots = await db.getBots();
    const staffs = await db.getStaffs();
    const ownerNames = {};
    for (const s of staffs) ownerNames[s.id] = s.username;
    return dbBots.map(b => {
        const proc = bots[b.name];
        const isRunning = proc && proc.exitCode === null;
        const uptime = isRunning ? Math.floor((Date.now() - proc._startedAt) / 1000) : 0;
        return {
            name: b.name, owner: b.owner, ownerName: ownerNames[b.owner] || b.owner,
            status: isRunning ? 'running' : (b.status || 'stopped'),
            language: b.language || 'Node.js',
            ram: b.ram || 0, cpu: b.cpu || 0, uptime,
            auto_start: b.auto_start || false,
            createdAt: b.createdAt
        };
    });
}

app.get('/api/bots', auth, async (req, res) => {
    res.json(await getBotList());
});

app.get('/api/bots/info', auth, async (req, res) => {
    const botsList = await getBotList();
    res.json(botsList.filter(b => b.owner === req.session.id));
});

app.get('/api/bots/stats', auth, async (req, res) => {
    const stats = {};
    for (const [name, proc] of Object.entries(bots)) {
        if (proc.exitCode !== null) continue;
        stats[name] = { ram: 0, cpu: 0, uptime: proc._startedAt ? Math.floor((Date.now() - proc._startedAt) / 1000) : 0 };
        try {
            const used = process.memoryUsage();
            stats[name].ram = Math.round(used.rss / 1024 / 1024);
        } catch(e) {}
    }
    res.json(stats);
});

app.post('/api/bots', auth, upload.single('file'), async (req, res) => {
    const session = req.session;
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.match(/^[a-zA-Z0-9_\-]{2,50}$/)) return res.status(400).json({ error: 'Nome invalido' });
    if (!req.file) return res.status(400).json({ error: 'Arquivo .ZIP necessario' });
    const botDir = getBotPath(name);
    if (fs.existsSync(botDir)) return res.status(409).json({ error: 'Bot ja existe' });
    try {
        const zipPath = req.file.path;
        const destDir = botDir;
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        try {
            execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'pipe', timeout: 120000 });
        } catch(e) {
            const fallback = new AdmZip(zipPath);
            fallback.extractAllTo(destDir, true);
        }
        try { fs.unlinkSync(zipPath); } catch(e2) {}
        const pkgPath = path.join(botDir, 'package.json');
        let lang = 'Node.js';
        await db.saveBot(name, { owner: session.id, language: lang, status: 'installing', createdAt: new Date().toISOString() });
        res.json({ success: true });
        logActivity('bot_create', 'Criou bot ' + name, session);
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                const deps = { ...pkg.dependencies, ...pkg.devDependencies };
                if (deps['discord.js'] && deps['discord.js'].startsWith('^14')) lang = 'Node.js';
                await db.saveBot(name, { owner: session.id, language: lang, status: 'installing', createdAt: new Date().toISOString() });
                execSync('npm install --prefer-offline', { cwd: botDir, stdio: 'pipe', timeout: 600000 });
                await db.saveBot(name, { owner: session.id, language: lang, status: 'stopped', createdAt: new Date().toISOString() });
            } catch(e) {
                await db.saveBot(name, { owner: session.id, language: lang, status: 'stopped', createdAt: new Date().toISOString() });
            }
        } else {
            await db.saveBot(name, { owner: session.id, language: lang, status: 'stopped', createdAt: new Date().toISOString() });
        }
    } catch (e) {
        try { fs.unlinkSync(req.file.path); } catch(e2) {}
        try { fs.rmSync(botDir, { recursive: true, force: true }); } catch(e2) {}
        if (!res.headersSent) res.status(500).json({ error: 'Erro ao processar ZIP: ' + e.message });
    }
});

app.post('/api/bots/:name/start', auth, async (req, res) => {
    const name = req.params.name;
    const b = (await db.getBots()).find(x => x.name === name);
    const session = req.session;
    if (!b) return res.status(404).json({ error: 'Bot nao encontrado' });
    const admin = await isAdmin(session);
    if (!admin && b.owner !== session.id) return res.status(403).json({ error: 'Sem permissao' });
    const botDir = getBotPath(name);
    if (!fs.existsSync(botDir)) return res.status(404).json({ error: 'Diretorio do bot nao encontrado' });
    const result = startBotProcess(name);
    if (result.error) return res.status(500).json({ error: result.error });
    logActivity('bot_start', 'Ligou bot ' + name, session);
    res.json({ success: true });
});

app.post('/api/bots/:name/stop', auth, async (req, res) => {
    const name = req.params.name;
    const b = (await db.getBots()).find(x => x.name === name);
    const session = req.session;
    if (!b) return res.status(404).json({ error: 'Bot nao encontrado' });
    const admin = await isAdmin(session);
    if (!admin && b.owner !== session.id) return res.status(403).json({ error: 'Sem permissao' });
    stopBotProcess(name);
    logActivity('bot_stop', 'Desligou bot ' + name, session);
    res.json({ success: true });
});

app.post('/api/bots/:name/restart', auth, async (req, res) => {
    const name = req.params.name;
    const b = (await db.getBots()).find(x => x.name === name);
    const session = req.session;
    if (!b) return res.status(404).json({ error: 'Bot nao encontrado' });
    const admin = await isAdmin(session);
    if (!admin && b.owner !== session.id) return res.status(403).json({ error: 'Sem permissao' });
    stopBotProcess(name);
    await new Promise(r => setTimeout(r, 1000));
    const result = startBotProcess(name);
    if (result.error) return res.status(500).json({ error: result.error });
    logActivity('bot_restart', 'Reiniciou bot ' + name, session);
    res.json({ success: true });
});

app.delete('/api/bots/:name', auth, async (req, res) => {
    const name = req.params.name;
    const b = (await db.getBots()).find(x => x.name === name);
    const session = req.session;
    if (!b) return res.status(404).json({ error: 'Bot nao encontrado' });
    const admin = await isAdmin(session);
    if (!admin && b.owner !== session.id) return res.status(403).json({ error: 'Sem permissao' });
    stopBotProcess(name);
    const botDir = getBotPath(name);
    try { fs.rmSync(botDir, { recursive: true, force: true }); } catch(e) {}
    await db.deleteBotDB(name);
    logActivity('bot_delete', 'Deletou bot ' + name, session);
    res.json({ success: true });
});

app.get('/api/bots/:name/logs', auth, async (req, res) => {
    const name = req.params.name;
    const proc = bots[name];
    const logs = proc ? (proc._logs || []).slice(-200) : [];
    res.json({ logs });
});

// === LIGAR ALL (admin/owner) ===
app.post('/api/bots/start-all', adminOnly, async (req, res) => {
    const allBots = await db.getBots();
    const results = { success: [], failed: [] };
    for (const b of allBots) {
        const botDir = getBotPath(b.name);
        if (!fs.existsSync(botDir)) { results.failed.push({ name: b.name, error: 'Diretorio nao encontrado' }); continue; }
        if (bots[b.name] && bots[b.name].exitCode === null) { results.success.push(b.name); continue; }
        const result = startBotProcess(b.name);
        if (result.success) { results.success.push(b.name); } else { results.failed.push({ name: b.name, error: result.error }); }
    }
    logActivity('bot_start_all', 'Ligou todos os bots (' + results.success.length + ' ok, ' + results.failed.length + ' falha)', req.session);
    res.json({ success: true, results });
});

// === PURCHASES ===
app.get('/api/purchases', adminOnly, async (req, res) => {
    res.json(await db.getPurchases());
});
app.get('/api/user/purchases', auth, async (req, res) => {
    res.json(await db.getUserPurchases(req.session.id));
});
app.post('/api/purchase', auth, async (req, res) => {
    const session = req.session;
    const { planName, planPrice, planTier, planDuration, paymentMethod } = req.body;
    if (!planName) return res.status(400).json({ error: 'Dados incompletos' });
    const id = await db.createPurchase({ userId: session.id, username: session.username, planName, planPrice, planTier, planDuration, paymentMethod: paymentMethod || 'manual' });
    try {
        const WEBHOOK = process.env.DISCORD_TICKET_WEBHOOK;
        if (WEBHOOK) {
            const embed = {
                embeds: [{
                    title: 'Nova Compra #' + id,
                    color: 0x22c55e,
                    fields: [
                        { name: 'Usuario', value: session.username + ' (' + session.id + ')', inline: true },
                        { name: 'Plano', value: planName, inline: true },
                        { name: 'Valor', value: planPrice || '?', inline: true },
                        { name: 'Duracao', value: planDuration || '?', inline: true },
                        { name: 'Pagamento', value: paymentMethod || 'Manual', inline: true },
                        { name: 'Status', value: 'Pendente', inline: true }
                    ],
                    timestamp: new Date().toISOString()
                }],
                content: '@everyone'
            };
            await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(embed) });
        }
    } catch(e) { console.error('Erro webhook compra:', e.message); }
    logActivity('purchase', 'Compra #' + id + ' - ' + planName + ' (' + (planPrice || '?') + ')', session);
    res.json({ success: true, id });
});
app.post('/api/purchases/:id/approve', adminOnly, async (req, res) => {
    await db.updatePurchaseStatus(parseInt(req.params.id), 'approved');
    logActivity('purchase_approve', 'Aprovou compra #' + req.params.id, getSessionSync(req));
    res.json({ success: true });
});
app.post('/api/purchases/:id/reject', adminOnly, async (req, res) => {
    await db.updatePurchaseStatus(parseInt(req.params.id), 'rejected');
    logActivity('purchase_reject', 'Rejeitou compra #' + req.params.id, getSessionSync(req));
    res.json({ success: true });
});

// === DATABASES ===
app.get('/api/databases', auth, async (req, res) => {
    const session = req.session;
    const admin = await isAdmin(session);
    const dbs = admin ? await db.getDatabases() : await db.getDatabases(session.id);
    res.json(dbs.map(d => ({ ...d, db_password: d.db_password ? '***' : null })));
});
app.post('/api/databases', auth, async (req, res) => {
    const session = req.session;
    const { dbType, dbName } = req.body;
    if (!dbName || !dbName.match(/^[a-z][a-z0-9_]{2,29}$/i)) return res.status(400).json({ error: 'Nome invalido' });
    const existing = await db.getDatabases(session.id);
    if (existing.length >= 3) return res.status(400).json({ error: 'Limite de 3 bancos por usuario' });
    const user = dbName + '_user';
    const password = crypto.randomBytes(16).toString('hex');
    const host = process.env.DB_HOST || 'localhost';
    const port = parseInt(process.env.DB_PORT) || 5432;
    try {
        const pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await pool.query('CREATE DATABASE "' + dbName + '"');
        await pool.query("CREATE USER " + user + " WITH PASSWORD '" + password + "'");
        await pool.query('GRANT ALL PRIVILEGES ON DATABASE "' + dbName + '" TO ' + user);
        await pool.query('GRANT ALL ON SCHEMA public TO ' + user);
        await pool.end();
    } catch(e) {
        console.error('Erro ao criar banco real:', e.message);
        try {
            const pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
            await pool.query('CREATE DATABASE "' + dbName + '"');
            await pool.end();
        } catch(e2) { console.error('Erro ao criar banco (tentativa 2):', e2.message); }
    }
    const dbRecord = await db.createDatabase({ userId: session.id, dbType: dbType || 'postgres', dbName, dbUser: user, dbPassword: password, dbHost: host, dbPort: port });
    res.json({ success: true, db: { ...dbRecord, db_password: password } });
});
app.delete('/api/databases/:id', auth, async (req, res) => {
    const session = req.session;
    const admin = await isAdmin(session);
    const dbRec = await db.getDatabaseById(parseInt(req.params.id));
    if (!dbRec) return res.status(404).json({ error: 'Banco nao encontrado' });
    if (!admin && dbRec.user_id !== session.id) return res.status(403).json({ error: 'Sem permissao' });
    try {
        const pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await pool.query('DROP DATABASE IF EXISTS "' + dbRec.db_name + '"');
        await pool.query('DROP USER IF EXISTS ' + dbRec.db_user);
        await pool.end();
    } catch(e) { console.error('Erro ao deletar banco real:', e.message); }
    await db.deleteDatabase(parseInt(req.params.id));
    res.json({ success: true });
});
app.post('/api/databases/:id/reset-password', auth, async (req, res) => {
    const session = req.session;
    const admin = await isAdmin(session);
    const dbRec = await db.getDatabaseById(parseInt(req.params.id));
    if (!dbRec) return res.status(404).json({ error: 'Banco nao encontrado' });
    if (!admin && dbRec.user_id !== session.id) return res.status(403).json({ error: 'Sem permissao' });
    const newPassword = crypto.randomBytes(16).toString('hex');
    try {
        const pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await pool.query("ALTER USER " + dbRec.db_user + " WITH PASSWORD '" + newPassword + "'");
        await pool.end();
    } catch(e) { console.error('Erro ao resetar senha:', e.message); }
    await db.resetDbPassword(parseInt(req.params.id), newPassword);
    res.json({ success: true, newPassword });
});

// === ANNOUNCEMENTS ===
app.post('/api/announcements', adminOnly, async (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || message.length > 500) return res.status(400).json({ error: 'Mensagem invalida' });
    const ann = { id: ++lastAnnouncementId, message, author: req.session.username, timestamp: new Date().toISOString() };
    announcements.push(ann);
    if (announcements.length > 50) announcements.shift();
    logActivity('announcement', 'Anuncio: ' + message.substring(0, 50), req.session);
    res.json({ success: true });
});
app.get('/api/announcements/last', auth, (req, res) => {
    const last = req.session._lastAnnId || 0;
    const latest = announcements[announcements.length - 1];
    if (latest && latest.id > last) { req.session._lastAnnId = latest.id; res.json({ announcement: latest }); }
    else res.json({ announcement: null });
});

// === AUTO ANNOUNCEMENT ===
app.get('/api/auto-announcement', adminOnly, (req, res) => {
    res.json({ enabled: autoAnnouncement.enabled, message: autoAnnouncement.message, intervalMinutes: Math.round(autoAnnouncement.intervalMs / 60000) });
});
app.post('/api/auto-announcement', adminOnly, async (req, res) => {
    const { enabled, message, intervalMinutes } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled deve ser boolean' });
    if (enabled && (!message || typeof message !== 'string' || message.length > 500)) return res.status(400).json({ error: 'Mensagem invalida' });
    const intervalMs = (parseInt(intervalMinutes) || 10) * 60000;
    autoAnnouncement = { enabled, message: message || '', intervalMs };
    if (autoAnnounceTimer) { clearInterval(autoAnnounceTimer); autoAnnounceTimer = null; }
    if (enabled) {
        autoAnnounceTimer = setInterval(() => {
            if (autoAnnouncement.message) {
                const ann = { id: ++lastAnnouncementId, message: autoAnnouncement.message, author: 'Sistema (Auto)', timestamp: new Date().toISOString() };
                announcements.push(ann);
                if (announcements.length > 50) announcements.shift();
            }
        }, intervalMs);
        logActivity('announcement', 'Auto-aviso ativado: ' + message.substring(0, 50) + ' (a cada ' + intervalMinutes + 'min)', req.session);
    } else {
        logActivity('announcement', 'Auto-aviso desativado', req.session);
    }
    const configPath = path.join(__dirname, 'data', 'auto_announcement.json');
    try {
        if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({ enabled, message: message || '', intervalMs }), 'utf8');
    } catch(e) { console.error('Erro ao salvar auto-announcement:', e.message); }
    res.json({ success: true });
});
function loadAutoAnnConfig() {
    try {
        const configPath = path.join(__dirname, 'data', 'auto_announcement.json');
        if (fs.existsSync(configPath)) {
            const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (saved.enabled) {
                autoAnnouncement = { enabled: true, message: saved.message || '', intervalMs: saved.intervalMs || 600000 };
                autoAnnounceTimer = setInterval(() => {
                    if (autoAnnouncement.message) {
                        const ann = { id: ++lastAnnouncementId, message: autoAnnouncement.message, author: 'Sistema (Auto)', timestamp: new Date().toISOString() };
                        announcements.push(ann);
                        if (announcements.length > 50) announcements.shift();
                    }
                }, autoAnnouncement.intervalMs);
                console.log('Auto-announcement restaurado: a cada ' + Math.round(autoAnnouncement.intervalMs/60000) + 'min');
            }
        }
    } catch(e) { console.error('Erro ao carregar auto-announcement:', e.message); }
}

// === ACTIVITY LOGS ===
app.get('/api/activity-logs', adminOnly, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json(activityLogs.slice(0, limit));
});

// === SESSION CLEANUP ===
async function loadSessions() {
    try { const saved = await db.getAllSessions(); Object.assign(sessions, saved); console.log('Sessoes carregadas:', Object.keys(sessions).length); } catch(e) { console.error('Erro ao carregar sessoes:', e.message); }
}

async function startBotsFromDB() {
    const botList = await db.getBots();
    for (const b of botList) {
        if (b.auto_start) {
            const botDir = getBotPath(b.name);
            if (fs.existsSync(botDir)) startBotProcess(b.name);
        }
    }
    console.log('Auto-start bots iniciados');
}

async function sessionCleanup() {
    await db.cleanOldSessions();
    for (const [token, session] of Object.entries(sessions)) {
        if (session.createdAt && Date.now() - new Date(session.createdAt).getTime() > 30 * 24 * 60 * 60 * 1000) {
            delete sessions[token];
            await db.deleteSession(token);
        }
    }
}

// === STARTUP ===
async function start() {
    await db.connectDB();
    await loadSessions();
    await startBotsFromDB();
    loadAutoAnnConfig();
    setInterval(sessionCleanup, 3600000);
    setInterval(() => {
        for (const [name, proc] of Object.entries(bots)) {
            if (proc.exitCode !== null) {
                delete bots[name];
                db.saveBot(name, { status: 'stopped', stoppedAt: new Date().toISOString() });
            }
        }
    }, 10000);

    app.listen(PORT, () => {
        console.log('Servidor rodando na porta ' + PORT);
    });
}

start().catch(e => { console.error('Erro ao iniciar:', e); process.exit(1); });

module.exports = app;
