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
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;

const SITE_BANNER_URL = '/realpecado_mc_ig.png';

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || process.env.ISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'https://realpecado.up.railway.app/auth/discord/callback';
const PASSWORD = process.env.PASSWORD || 'admin';
const OWNER_ID = '1473070694425301205';
const PLANS_ACCESS_IDS = ['1526570298743197766'];
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const DISCORD_TICKET_CATEGORY_ID = process.env.DISCORD_TICKET_CATEGORY_ID || '';
const DISCORD_API = 'https://discord.com/api/v10';

app.use(morgan('short'));
app.use(express.json({ limit: '600mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const BOTS_DIR = process.env.BOTS_DIR || path.join(__dirname, 'bots');
if (!fs.existsSync(BOTS_DIR)) fs.mkdirSync(BOTS_DIR, { recursive: true });
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
    dest: UPLOADS_DIR,
    limits: { fileSize: 200 * 1024 * 1024, files: 1 },
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
        res.json({ id: session.id, username: session.username, discriminator: session.discriminator, avatar: session.avatar, banner: session.banner, banner_color: session.banner_color, type: 'discord', isOwner: isOwner(session), isAdmin: adminStatus, canAccessPlans: PLANS_ACCESS_IDS.includes(session.id) });
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
    const runDir = path.dirname(mainFile);
    try {
        if (fs.existsSync(path.join(runDir, 'package.json')) && !fs.existsSync(path.join(runDir, 'node_modules'))) {
            try {
                execSync('npm install --prefer-offline', { cwd: runDir, stdio: 'pipe', timeout: 600000 });
            } catch(e) { return { error: 'Erro ao instalar dependencias: ' + e.message }; }
        }
        if (bots[name]) {
            try { bots[name].kill(); } catch(e) {}
            delete bots[name];
        }
        const proc = spawn('node', [mainFile], {
            cwd: runDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, NODE_PATH: path.join(runDir, 'node_modules') }
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
        db.setAutoStart(name, true);
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
    db.setAutoStart(name, false);
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
    if (files.length) return path.join(dir, files[0]);
    const subDirs = fs.readdirSync(dir).filter(f => { try { return fs.statSync(path.join(dir, f)).isDirectory() && !f.startsWith('.') && f !== 'node_modules'; } catch(e) { return false; } });
    for (const sub of subDirs) {
        const found = findMainFile(path.join(dir, sub));
        if (found) return found;
    }
    return null;
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
        let status = 'stopped';
        if (isRunning) status = 'running';
        else if (b.status === 'installing') status = 'installing';
        return {
            name: b.name, owner: b.owner, ownerName: ownerNames[b.owner] || b.owner,
            status,
            language: b.language || 'Node.js',
            ram: b.ram || 0, cpu: b.cpu || 0, uptime,
            auto_start: b.auto_start || false,
            createdAt: b.createdAt
        };
    });
}

app.get('/api/bots', auth, async (req, res) => {
    const all = await getBotList();
    const admin = await isAdmin(req.session);
    if (isOwner(req.session) || admin) return res.json(all);
    res.json(all.filter(b => b.owner === req.session.id));
});

app.get('/api/bots/info', auth, async (req, res) => {
    const botsList = await getBotList();
    res.json(botsList.filter(b => b.owner === req.session.id));
});

app.get('/api/bots/stats', auth, async (req, res) => {
    const stats = {};
    const admin = await isAdmin(req.session);
    const allowed = isOwner(req.session) || admin ? null : req.session.id;
    for (const [name, proc] of Object.entries(bots)) {
        if (proc.exitCode !== null) continue;
        if (allowed) {
            const b = (await db.getBots()).find(x => x.name === name);
            if (!b || b.owner !== allowed) continue;
        }
        stats[name] = { ram: 0, cpu: 0, uptime: proc._startedAt ? Math.floor((Date.now() - proc._startedAt) / 1000) : 0 };
        try {
            const used = process.memoryUsage();
            stats[name].ram = Math.round(used.rss / 1024 / 1024);
        } catch(e) {}
    }
    res.json(stats);
});

function dirSizeBytes(dir) {
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        try {
            if (entry.isDirectory()) total += dirSizeBytes(p);
            else total += fs.statSync(p).size;
        } catch(e) {}
    }
    return total;
}

app.get('/api/admin/disk', auth, async (req, res) => {
    const s = req.session;
    if (!(await isAdmin(s))) return res.status(403).json({ error: 'Sem permissao' });
    const persistRoot = path.dirname(BOTS_DIR);
    const dataDir = path.join(persistRoot, 'data');
    const out = { persist: persistRoot, bots: [], data: [], uploads: [], topLevel: [], disk: {} };
    try {
        if (fs.statfs) {
            for (const [label, p] of [['root', '/app'], ['volume', persistRoot]]) {
                const st = fs.statfsSync(p);
                out.disk[label] = { freeMB: +((st.bavail * st.bsize) / 1048576).toFixed(1), totalMB: +((st.blocks * st.bsize) / 1048576).toFixed(1) };
            }
        }
    } catch(e) { out.disk.error = e.message; }
    if (fs.existsSync(persistRoot)) {
        for (const name of fs.readdirSync(persistRoot)) {
            const p = path.join(persistRoot, name);
            try { if (fs.statSync(p).isDirectory()) out.topLevel.push({ name, sizeMB: +(dirSizeBytes(p) / 1048576).toFixed(2) }); } catch(e) {}
        }
        out.topLevel.sort((a, b) => b.sizeMB - a.sizeMB);
    }
    if (fs.existsSync(BOTS_DIR)) {
        for (const name of fs.readdirSync(BOTS_DIR)) {
            const p = path.join(BOTS_DIR, name);
            try { if (fs.statSync(p).isDirectory()) out.bots.push({ name, sizeMB: +(dirSizeBytes(p) / 1048576).toFixed(2) }); } catch(e) {}
        }
    }
    if (fs.existsSync(dataDir)) {
        for (const f of fs.readdirSync(dataDir)) {
            const p = path.join(dataDir, f);
            try { if (fs.statSync(p).isFile()) out.data.push({ name: f, sizeMB: +(fs.statSync(p).size / 1048576).toFixed(2) }); } catch(e) {}
        }
    }
    if (fs.existsSync(UPLOADS_DIR)) {
        for (const f of fs.readdirSync(UPLOADS_DIR)) {
            const p = path.join(UPLOADS_DIR, f);
            try { if (fs.statSync(p).isFile()) out.uploads.push({ name: f, sizeMB: +(fs.statSync(p).size / 1048576).toFixed(2) }); } catch(e) {}
        }
    }
    out.bots.sort((a, b) => b.sizeMB - a.sizeMB);
    out.data.sort((a, b) => b.sizeMB - a.sizeMB);
    out.uploads = out.uploads.filter(u => u.sizeMB > 0).sort((a, b) => b.sizeMB - a.sizeMB);
    res.json(out);
});

app.post('/api/admin/cleanup', auth, async (req, res) => {
    const s = req.session;
    if (!(await isAdmin(s))) return res.status(403).json({ error: 'Sem permissao' });
    const removed = [];
    let freedMB = 0;
    if (fs.existsSync(UPLOADS_DIR)) {
        for (const f of fs.readdirSync(UPLOADS_DIR)) {
            const p = path.join(UPLOADS_DIR, f);
            try {
                if (fs.statSync(p).isFile()) {
                    freedMB += fs.statSync(p).size / 1048576;
                    fs.unlinkSync(p);
                    removed.push(f);
                }
            } catch(e) {}
        }
    }
    logActivity('cleanup', 'Limpou ' + removed.length + ' uploads temporarios (' + freedMB.toFixed(1) + 'MB)', s);
    res.json({ success: true, removed: removed.length, freedMB: +freedMB.toFixed(2) });
});

app.post('/api/bots', auth, upload.single('file'), async (req, res) => {
    const session = req.session;
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.match(/^[a-zA-Z0-9_\-]{2,50}$/)) { try { if (req.file) fs.unlinkSync(req.file.path); } catch(e2) {} return res.status(400).json({ error: 'Nome invalido' }); }
    if (!req.file) return res.status(400).json({ error: 'Arquivo .ZIP necessario' });
    const botDir = getBotPath(name);
    if (fs.existsSync(botDir)) { try { fs.unlinkSync(req.file.path); } catch(e2) {} return res.status(409).json({ error: 'Bot ja existe' }); }
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
        try {
            const items = fs.readdirSync(botDir);
            if (items.length === 1) {
                const only = path.join(botDir, items[0]);
                if (fs.statSync(only).isDirectory() && items[0] !== 'node_modules') {
                    for (const f of fs.readdirSync(only)) {
                        fs.renameSync(path.join(only, f), path.join(botDir, f));
                    }
                    try { fs.rmdirSync(only); } catch(e) {}
                }
            }
        } catch(e) {}
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
    const b = (await db.getBots()).find(x => x.name === name);
    const session = req.session;
    if (!b) return res.status(404).json({ error: 'Bot nao encontrado' });
    const admin = await isAdmin(session);
    if (!admin && b.owner !== session.id) return res.status(403).json({ error: 'Sem permissao' });
    const proc = bots[name];
    const logs = proc ? (proc._logs || []).slice(-200) : [];
    res.json({ logs });
});

// === FILE MANAGER ===
function safeBotPath(botName, relPath) {
    const base = path.resolve(getBotPath(botName));
    const target = path.resolve(base, relPath || '.');
    if (target !== base && !target.startsWith(base + path.sep)) return null;
    return target;
}
async function canManageBot(botName, session) {
    const b = (await db.getBots()).find(x => x.name === botName);
    if (!b) return null;
    const admin = await isAdmin(session);
    if (!admin && b.owner !== session.id) return null;
    return b;
}

app.get('/api/bots/:name/files', auth, async (req, res) => {
    const name = req.params.name;
    const b = await canManageBot(name, req.session);
    if (!b) return res.status(403).json({ error: 'Sem permissao' });
    const dir = safeBotPath(name, req.query.path || '.');
    if (!dir) return res.status(400).json({ error: 'Caminho invalido' });
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return res.status(404).json({ error: 'Pasta nao encontrada' });
    const items = fs.readdirSync(dir, { withFileTypes: true }).map(f => {
        const fp = path.join(dir, f.name);
        let size = 0, mtime = null;
        try { const st = fs.statSync(fp); size = f.isDirectory() ? 0 : st.size; mtime = st.mtime; } catch(e) {}
        return { name: f.name, isDir: f.isDirectory(), size, mtime };
    }).sort((a, b) => (a.isDir === b.isDir) ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1));
    res.json({ path: req.query.path || '.', items });
});

app.get('/api/bots/:name/files/content', auth, async (req, res) => {
    const name = req.params.name;
    const b = await canManageBot(name, req.session);
    if (!b) return res.status(403).json({ error: 'Sem permissao' });
    const fp = safeBotPath(name, req.query.path || '');
    if (!fp) return res.status(400).json({ error: 'Caminho invalido' });
    if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return res.status(404).json({ error: 'Arquivo nao encontrado' });
    const size = fs.statSync(fp).size;
    if (size > 2 * 1024 * 1024) return res.status(400).json({ error: 'Arquivo muito grande para editar (max 2MB)' });
    const ext = path.extname(fp).toLowerCase();
    const binaryExts = ['.png','.jpg','.jpeg','.gif','.webp','.ico','.zip','.rar','.7z','.exe','.bin','.mp3','.mp4','.ogg','.wav','.woff','.woff2','.ttf','.eot','.sqlite','.db','.jar','.node'];
    if (binaryExts.includes(ext)) return res.status(400).json({ error: 'Arquivo binario, nao pode ser editado aqui' });
    try {
        let content = fs.readFileSync(fp, 'utf8');
        if (content.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'Arquivo muito grande para editar' });
        res.json({ content, path: req.query.path || '' });
    } catch(e) { res.status(500).json({ error: 'Erro ao ler arquivo' }); }
});

app.post('/api/bots/:name/files/write', auth, async (req, res) => {
    const name = req.params.name;
    const b = await canManageBot(name, req.session);
    if (!b) return res.status(403).json({ error: 'Sem permissao' });
    const { path: relPath, content } = req.body;
    if (typeof relPath !== 'string' || relPath.includes('..')) return res.status(400).json({ error: 'Caminho invalido' });
    const fp = safeBotPath(name, relPath);
    if (!fp) return res.status(400).json({ error: 'Caminho invalido' });
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Arquivo nao encontrado' });
    if (!fs.statSync(fp).isFile()) return res.status(400).json({ error: 'Nao e um arquivo' });
    if (typeof content !== 'string' || content.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'Conteudo invalido' });
    fs.writeFileSync(fp, content, 'utf8');
    logActivity('file_edit', 'Editou ' + relPath + ' em ' + name, req.session);
    res.json({ success: true });
});

app.post('/api/bots/:name/files/create', auth, async (req, res) => {
    const name = req.params.name;
    const b = await canManageBot(name, req.session);
    if (!b) return res.status(403).json({ error: 'Sem permissao' });
    const { path: relPath, type, content } = req.body;
    if (typeof relPath !== 'string' || relPath.includes('..') || !relPath.trim()) return res.status(400).json({ error: 'Caminho invalido' });
    const fp = safeBotPath(name, relPath);
    if (!fp) return res.status(400).json({ error: 'Caminho invalido' });
    if (fs.existsSync(fp)) return res.status(409).json({ error: 'Ja existe' });
    if (type === 'folder') {
        fs.mkdirSync(fp, { recursive: true });
    } else {
        const parent = path.dirname(fp);
        if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
        fs.writeFileSync(fp, typeof content === 'string' ? content : '', 'utf8');
    }
    logActivity('file_create', 'Criou ' + relPath + ' em ' + name, req.session);
    res.json({ success: true });
});

app.post('/api/bots/:name/files/rename', auth, async (req, res) => {
    const name = req.params.name;
    const b = await canManageBot(name, req.session);
    if (!b) return res.status(403).json({ error: 'Sem permissao' });
    const { path: oldPath, newPath } = req.body;
    if (typeof oldPath !== 'string' || typeof newPath !== 'string' || oldPath.includes('..') || newPath.includes('..')) return res.status(400).json({ error: 'Caminho invalido' });
    const from = safeBotPath(name, oldPath);
    const to = safeBotPath(name, newPath);
    if (!from || !to) return res.status(400).json({ error: 'Caminho invalido' });
    if (!fs.existsSync(from)) return res.status(404).json({ error: 'Nao encontrado' });
    if (fs.existsSync(to)) return res.status(409).json({ error: 'Destino ja existe' });
    const base = path.resolve(getBotPath(name));
    if (path.dirname(from) === base || path.dirname(to) === base) return res.status(403).json({ error: 'Nao pode mover arquivos na raiz do bot' });
    fs.renameSync(from, to);
    logActivity('file_rename', 'Renomeou ' + oldPath + ' em ' + name, req.session);
    res.json({ success: true });
});

app.delete('/api/bots/:name/files', auth, async (req, res) => {
    const name = req.params.name;
    const b = await canManageBot(name, req.session);
    if (!b) return res.status(403).json({ error: 'Sem permissao' });
    const relPath = req.query.path || '';
    if (typeof relPath !== 'string' || relPath.includes('..') || !relPath.trim()) return res.status(400).json({ error: 'Caminho invalido' });
    const fp = safeBotPath(name, relPath);
    if (!fp) return res.status(400).json({ error: 'Caminho invalido' });
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Nao encontrado' });
    const base = path.resolve(getBotPath(name));
    if (path.dirname(fp) === base) return res.status(403).json({ error: 'Nao pode deletar arquivos na raiz do bot' });
    try { fs.rmSync(fp, { recursive: true, force: true }); } catch(e) { return res.status(500).json({ error: 'Erro ao deletar' }); }
    logActivity('file_delete', 'Deletou ' + relPath + ' em ' + name, req.session);
    res.json({ success: true });
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
async function discordFetch(path, opts = {}) {
    if (!DISCORD_BOT_TOKEN) return null;
    const res = await fetch(DISCORD_API + path, {
        ...opts,
        headers: { Authorization: 'Bot ' + DISCORD_BOT_TOKEN, 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    if (!res.ok) { const body = await res.text().catch(() => ''); console.error('Discord API ' + path + ' -> ' + res.status + ': ' + body.slice(0, 200)); return null; }
    return res.json();
}

async function createDiscordTicket({ id, session, planName, planPrice, planDuration, paymentMethod }) {
    if (!DISCORD_BOT_TOKEN || !DISCORD_TICKET_CATEGORY_ID) return null;
    try {
        const category = await discordFetch('/channels/' + DISCORD_TICKET_CATEGORY_ID);
        if (!category || !category.guild_id) return null;
        const guildId = category.guild_id;
        const isDiscordUser = session && session.type === 'discord' && /^\d+$/.test(String(session.id || ''));
        const name = ('ticket-' + (session && session.username ? session.username : 'compra'))
            .toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'ticket-compra';
        const overwrites = [
            { id: guildId, type: 0, deny: String(1024) },
            ...(isDiscordUser ? [{ id: String(session.id), type: 1, allow: String(1024 + 2048 + 65536) }] : [])
        ];
        const channel = await discordFetch('/guilds/' + guildId + '/channels', {
            method: 'POST',
            body: JSON.stringify({ name, type: 0, parent_id: DISCORD_TICKET_CATEGORY_ID, permission_overwrites: overwrites })
        });
        if (!channel || !channel.id) return null;
        await discordFetch('/channels/' + channel.id + '/messages', {
            method: 'POST',
            body: JSON.stringify({
                content: isDiscordUser ? '<@' + session.id + '>' : '',
                embeds: [{
                    title: 'Ticket de Compra #' + id,
                    color: 0x22c55e,
                    fields: [
                        { name: 'Usuario', value: session.username + (isDiscordUser ? ' (' + session.id + ')' : ''), inline: true },
                        { name: 'Plano', value: planName || '?', inline: true },
                        { name: 'Valor', value: planPrice || '?', inline: true },
                        { name: 'Duracao', value: planDuration || '?', inline: true },
                        { name: 'Pagamento', value: paymentMethod || 'Manual', inline: true },
                        { name: 'Status', value: 'Pendente de aprovacao', inline: false }
                    ],
                    timestamp: new Date().toISOString()
                }]
            })
        });
        return { channelId: channel.id, guildId };
    } catch (e) { console.error('Erro criar ticket Discord:', e.message); return null; }
}

async function grantDiscordRole(userId, roleId) {
    if (!DISCORD_BOT_TOKEN || !roleId || !userId) return { ok: false, reason: 'sem-config' };
    if (!/^\d+$/.test(String(userId)) || !/^\d+$/.test(String(roleId))) return { ok: false, reason: 'id-invalido' };
    try {
        const guilds = await discordFetch('/users/@me/guilds');
        if (!guilds || !guilds.length) return { ok: false, reason: 'sem-servidor' };
        for (const g of guilds) {
            const res = await fetch(DISCORD_API + '/guilds/' + g.id + '/members/' + userId + '/roles/' + roleId, {
                method: 'PUT',
                headers: { Authorization: 'Bot ' + DISCORD_BOT_TOKEN, 'Content-Type': 'application/json' }
            });
            if (res.ok) { console.log('Cargo ' + roleId + ' concedido para ' + userId + ' em ' + g.id); return { ok: true, guildId: g.id }; }
            const status = res.status;
            if (status !== 404) { const body = await res.text().catch(() => ''); console.error('Grant role ' + roleId + ' -> ' + status + ': ' + body.slice(0, 200)); }
        }
        return { ok: false, reason: 'nao-encontrado' };
    } catch (e) { console.error('grantDiscordRole error:', e.message); return { ok: false, reason: 'erro' }; }
}

app.get('/api/purchases', adminOnly, async (req, res) => {
    res.json(await db.getPurchases());
});
app.get('/api/plans', auth, async (req, res) => {
    res.json(await db.getPlans());
});
app.post('/api/plans', adminOnly, async (req, res) => {
    const { name, price, duration, tier, features, botsMax, roleId } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome do plano obrigatorio' });
    const plan = await db.savePlan({ name, price, duration, tier, features, botsMax, roleId, createdAt: new Date().toISOString() });
    logActivity('plan', 'Criou plano ' + name, getSessionSync(req));
    res.json({ success: true, plan });
});
app.delete('/api/plans/:id', adminOnly, async (req, res) => {
    await db.deletePlan(req.params.id);
    logActivity('plan', 'Removeu plano #' + req.params.id, getSessionSync(req));
    res.json({ success: true });
});
app.get('/api/user/purchases', auth, async (req, res) => {
    res.json(await db.getUserPurchases(req.session.id));
});
app.post('/api/purchase', auth, async (req, res) => {
    const session = req.session;
    const { planName, planPrice, planTier, planDuration, paymentMethod, planRoleId } = req.body;
    if (!planName) return res.status(400).json({ error: 'Dados incompletos' });
    const id = await db.createPurchase({ userId: session.id, username: session.username, planName, planPrice, planTier, planDuration, paymentMethod: paymentMethod || 'manual', roleId: planRoleId });
    let ticket = null;
    try {
        ticket = await createDiscordTicket({ id, session, planName, planPrice, planDuration, paymentMethod });
        if (ticket) await db.saveTicketInfo(id, { channelId: ticket.channelId, guildId: ticket.guildId });
    } catch(e) { console.error('Erro ao criar ticket:', e.message); }
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
    res.json({ success: true, id, ticketChannelId: ticket ? ticket.channelId : null, ticketGuildId: ticket ? ticket.guildId : null });
});
app.post('/api/purchases/:id/approve', adminOnly, async (req, res) => {
    const id = parseInt(req.params.id);
    await db.updatePurchaseStatus(id, 'approved');
    const p = await db.getPurchase(id);
    let grantedRole = null;
    if (p && p.role_id && /^\d+$/.test(String(p.user_id))) {
        grantedRole = await grantDiscordRole(p.user_id, p.role_id);
        if (grantedRole && grantedRole.ok) logActivity('purchase_role', 'Cargo concedido na compra #' + id, getSessionSync(req));
    }
    if (p && p.ticket_channel_id && DISCORD_BOT_TOKEN) {
        try {
            const roleNote = grantedRole && grantedRole.ok ? '\n\nBeneficios ativados no servidor!' : '';
            await discordFetch('/channels/' + p.ticket_channel_id + '/messages', {
                method: 'POST',
                body: JSON.stringify({ embeds: [{ title: 'Compra #' + id + ' APROVADA', color: 0x22c55e, description: 'Pagamento confirmado! O plano **' + (p.plan_name || '') + '** ja esta ativo.' + roleNote, timestamp: new Date().toISOString() }] })
            });
        } catch(e) { console.error('Erro notificar aprovacao:', e.message); }
    }
    logActivity('purchase_approve', 'Aprovou compra #' + id, getSessionSync(req));
    res.json({ success: true });
});
app.post('/api/purchases/:id/reject', adminOnly, async (req, res) => {
    const id = parseInt(req.params.id);
    await db.updatePurchaseStatus(id, 'rejected');
    const p = await db.getPurchase(id);
    if (p && p.ticket_channel_id && DISCORD_BOT_TOKEN) {
        try {
            await discordFetch('/channels/' + p.ticket_channel_id + '/messages', {
                method: 'POST',
                body: JSON.stringify({ embeds: [{ title: 'Compra #' + id + ' RECUSADA', color: 0xef4444, description: 'Seu pagamento nao foi confirmado. Se acha que houve erro, abra um novo ticket.', timestamp: new Date().toISOString() }] })
            });
        } catch(e) { console.error('Erro notificar rejeicao:', e.message); }
    }
    logActivity('purchase_reject', 'Rejeitou compra #' + id, getSessionSync(req));
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
        if (b.status === 'running' || b.status === 'installing') {
            await db.saveBot(b.name, { status: 'stopped', stoppedAt: new Date().toISOString() });
        }
    }
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

// === ERROR HANDLER ===
app.use((err, req, res, next) => {
    if (!res.headersSent) {
        if (err instanceof multer.MulterError) {
            const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo maior que o limite (200MB)' : 'Erro no upload: ' + err.message;
            return res.status(400).json({ error: msg });
        }
        if (err.message === 'Apenas .ZIP') return res.status(400).json({ error: 'Apenas arquivos .ZIP' });
        console.error('Erro na requisicao:', err);
        return res.status(500).json({ error: 'Erro interno: ' + err.message });
    }
    next(err);
});

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
