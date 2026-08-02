const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const crypto = require('crypto');

const app = express();
const PORT = 3000;
const BOTS_DIR = path.join(__dirname, 'bots');
const PASSWORD = '/realpecado';

const DISCORD_CLIENT_ID = '1522442710315700315';
const DISCORD_CLIENT_SECRET = 'NBYOWa2f28QgSnYMU-qZWsgKkXoRGdob';
const DISCORD_REDIRECT_URI = 'https://realpecado.onrender.com/auth/discord/callback';

const OWNER_ID = '1473070694425301205';

const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
const STAFFS_FILE = path.join(__dirname, 'staffs.json');
const BANNED_FILE = path.join(__dirname, 'banned.json');
const BOTS_META_FILE = path.join(__dirname, 'bots-meta.json');

// === LOGS DO SERVIDOR ===
const serverLogs = [];
function slog(msg, type = 'info') {
    const entry = {
        time: new Date().toLocaleTimeString('pt-BR'),
        date: new Date().toLocaleDateString('pt-BR'),
        ts: Date.now(),
        type, // info | warn | error | bot | auth
        msg
    };
    serverLogs.push(entry);
    if (serverLogs.length > 1000) serverLogs.shift();
    console.log(`[${entry.date} ${entry.time}] [${type.toUpperCase()}] ${msg}`);
}

// Sessoes persistidas em disco para sobreviver a reinicializacoes
function loadSessions() {
    if (fs.existsSync(SESSIONS_FILE)) {
        try { return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); } catch (e) { return {}; }
    }
    return {};
}

function saveSessions(data) {
    try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2)); } catch(e) {}
}

const sessions = loadSessions();

function loadBotsMeta() {
    if (fs.existsSync(BOTS_META_FILE)) {
        try { return JSON.parse(fs.readFileSync(BOTS_META_FILE, 'utf8')); } catch (e) { return {}; }
    }
    return {};
}

function saveBotsMeta(meta) {
    fs.writeFileSync(BOTS_META_FILE, JSON.stringify(meta, null, 2));
}

function setBotOwner(botName, ownerId) {
    const meta = loadBotsMeta();
    meta[botName] = { owner: ownerId, createdAt: new Date().toISOString() };
    saveBotsMeta(meta);
}

function getBotOwner(botName) {
    const meta = loadBotsMeta();
    return meta[botName] ? meta[botName].owner : null;
}

function loadStaffs() {
    if (fs.existsSync(STAFFS_FILE)) {
        try { return JSON.parse(fs.readFileSync(STAFFS_FILE, 'utf8')); } catch (e) { return []; }
    }
    return [];
}

function saveStaffs(staffs) {
    fs.writeFileSync(STAFFS_FILE, JSON.stringify(staffs, null, 2));
}

function loadBanned() {
    if (fs.existsSync(BANNED_FILE)) {
        try { return JSON.parse(fs.readFileSync(BANNED_FILE, 'utf8')); } catch (e) { return []; }
    }
    return [];
}

function saveBanned(banned) {
    fs.writeFileSync(BANNED_FILE, JSON.stringify(banned, null, 2));
}

function isBanned(id) {
    return loadBanned().some(b => b.id === id);
}

function addStaff(user) {
    const staffs = loadStaffs();
    const existing = staffs.find(s => s.id === user.id);
    if (existing) {
        existing.loginCount = (existing.loginCount || 0) + 1;
        existing.lastLogin = new Date().toISOString();
        existing.username = user.username;
        existing.avatar = user.avatar;
        saveStaffs(staffs);
    } else {
        staffs.push({
            id: user.id,
            username: user.username,
            discriminator: user.discriminator || '0',
            avatar: user.avatar,
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            loginCount: 1,
            banned: false
        });
        saveStaffs(staffs);
    }
}

function addPasswordStaff() {
    const staffs = loadStaffs();
    const id = 'password-admin';
    const existing = staffs.find(s => s.id === id);
    if (existing) {
        existing.loginCount = (existing.loginCount || 0) + 1;
        existing.lastLogin = new Date().toISOString();
        saveStaffs(staffs);
    } else {
        staffs.push({
            id: id,
            username: 'Admin (Senha)',
            discriminator: '0',
            avatar: null,
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            loginCount: 1,
            banned: false
        });
        saveStaffs(staffs);
    }
}

// === VERIFICACAO DE DISCO ===
const MAX_BOTS_DIR_MB = 400; // limite em MB para a pasta bots (Railway tem ~1-2GB)
const MAX_SINGLE_BOT_MB = 150; // maximo que um bot pode ocupar apos instalacao

function getDirSizeMB(dirPath) {
    let total = 0;
    if (!fs.existsSync(dirPath)) return 0;
    try {
        const walk = (p) => {
            const entries = fs.readdirSync(p, { withFileTypes: true });
            for (const e of entries) {
                const full = path.join(p, e.name);
                try {
                    if (e.isDirectory()) walk(full);
                    else total += fs.statSync(full).size;
                } catch {}
            }
        };
        walk(dirPath);
    } catch {}
    return total / (1024 * 1024);
}

function checkDiskSpace() {
    const usedMB = getDirSizeMB(BOTS_DIR);
    return {
        usedMB: Math.round(usedMB),
        limitMB: MAX_BOTS_DIR_MB,
        freePercent: Math.max(0, Math.round(((MAX_BOTS_DIR_MB - usedMB) / MAX_BOTS_DIR_MB) * 100)),
        ok: usedMB < MAX_BOTS_DIR_MB
    };
}

function isOwner(req) {
    const session = getSession(req);
    return session && session.type === 'discord' && session.id === OWNER_ID;
}

function ownerOnly(req, res, next) {
    if (isOwner(req)) return next();
    res.status(403).json({ error: 'Acesso negado' });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

// Limite de 50MB por ZIP para evitar lotar o disco do Railway
const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.zip') return cb(new Error('Apenas arquivos .zip sao aceitos'));
        cb(null, true);
    }
});

const bots = {};

function getBotDir(name) { return path.join(BOTS_DIR, name); }

function loadBots() {
    if (!fs.existsSync(BOTS_DIR)) fs.mkdirSync(BOTS_DIR, { recursive: true });

    // Limpar bots fantasmas do metadata (existem no JSON mas nao no disco)
    const meta = loadBotsMeta();
    let changed = false;
    for (const name of Object.keys(meta)) {
        const botPath = path.join(BOTS_DIR, name);
        if (!fs.existsSync(botPath)) {
            slog(`Bot fantasma removido do registro: "${name}" (diretorio nao existe mais)`, 'warn');
            delete meta[name];
            changed = true;
        }
    }
    if (changed) saveBotsMeta(meta);

    // Limpar bots em memoria que nao existem no disco
    for (const name of Object.keys(bots)) {
        const botPath = path.join(BOTS_DIR, name);
        if (!fs.existsSync(botPath)) {
            if (bots[name] && bots[name].process) {
                try { bots[name].process.kill('SIGTERM'); } catch {}
            }
            delete bots[name];
        }
    }

    const folders = fs.readdirSync(BOTS_DIR);
    for (const folder of folders) {
        const botPath = path.join(BOTS_DIR, folder);
        if (!fs.statSync(botPath).isDirectory()) continue;
        if (!bots[folder]) {
            bots[folder] = { process: null, status: 'stopped', logs: [], port: null };
        }
    }
}

function addLog(name, msg) {
    if (!bots[name]) return;
    const line = `[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`;
    bots[name].logs.push(line);
    if (bots[name].logs.length > 500) bots[name].logs.shift();
}

function flattenBotDir(botDir, name) {
    for (let depth = 0; depth < 5; depth++) {
        if (fs.existsSync(path.join(botDir, 'package.json'))) return;
        if (fs.existsSync(path.join(botDir, 'index.js'))) return;

        const entries = fs.readdirSync(botDir, { withFileTypes: true });
        const subDirs = entries.filter(e => e.isDirectory());

        if (subDirs.length === 1 && entries.length === 1) {
            const subDir = path.join(botDir, subDirs[0].name);
            addLog(name, `Encontrei pasta unica "${subDirs[0].name}", movendo arquivos...`);
            const subEntries = fs.readdirSync(subDir, { withFileTypes: true });
            for (const se of subEntries) {
                const src = path.join(subDir, se.name);
                const dst = path.join(botDir, se.name);
                if (fs.existsSync(dst)) continue;
                fs.renameSync(src, dst);
            }
            fs.rmSync(subDir, { recursive: true, force: true });
            addLog(name, 'Arquivos movidos para raiz!');
        } else if (subDirs.length > 0) {
            for (const sub of subDirs) {
                const subDirPath = path.join(botDir, sub.name);
                if (fs.existsSync(path.join(subDirPath, 'package.json')) || fs.existsSync(path.join(subDirPath, 'index.js'))) {
                    addLog(name, `Encontrei projeto em subpasta "${sub.name}", movendo...`);
                    const subEntries = fs.readdirSync(subDirPath, { withFileTypes: true });
                    for (const se of subEntries) {
                        const src = path.join(subDirPath, se.name);
                        const dst = path.join(botDir, se.name);
                        if (fs.existsSync(dst)) continue;
                        fs.renameSync(src, dst);
                    }
                    fs.rmSync(subDirPath, { recursive: true, force: true });
                    addLog(name, 'Arquivos movidos para raiz!');
                    break;
                }
            }
        } else {
            break;
        }
    }
}

function startBot(name) {
    const botDir = getBotDir(name);
    if (!fs.existsSync(botDir)) {
        if (bots[name]) {
            bots[name].status = 'error';
            addLog(name, 'ERRO: Arquivos do bot nao encontrados no servidor. O Railway reiniciou e apagou os arquivos. Re-envie o ZIP do bot para restaurar.');
        }
        return false;
    }
    if (bots[name] && bots[name].process) return true;

    flattenBotDir(botDir, name);

    const packageJson = path.join(botDir, 'package.json');
    let mainFile = 'index.js';
    if (fs.existsSync(packageJson)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
            if (pkg.main) mainFile = pkg.main;
        } catch (e) {}
    }

    const entryFile = path.join(botDir, mainFile);

    if (!fs.existsSync(entryFile)) {
        addLog(name, `Arquivo ${mainFile} nao encontrado! Verifique o ZIP.`);
        bots[name].status = 'error';
        return false;
    }

    const nmDir = path.join(botDir, 'node_modules');
    const lockFile = path.join(botDir, 'package-lock.json');

    if (fs.existsSync(packageJson)) {
        bots[name].status = 'installing';
        if (fs.existsSync(nmDir)) {
            addLog(name, 'Limpando node_modules antigo...');
            fs.rmSync(nmDir, { recursive: true, force: true });
        }
        if (fs.existsSync(lockFile)) {
            addLog(name, 'Removendo package-lock.json antigo...');
            fs.rmSync(lockFile, { force: true });
        }

        // Verificar espaco antes de instalar
        const diskBefore = checkDiskSpace();
        if (!diskBefore.ok) {
            addLog(name, `ERRO: Espaco em disco insuficiente (${diskBefore.usedMB}MB/${diskBefore.limitMB}MB usado). Delete bots antigos para liberar espaco.`);
            bots[name].status = 'error';
            return false;
        }

        addLog(name, `Instalando dependencias (espaco livre: ${diskBefore.limitMB - diskBefore.usedMB}MB)...`);

        // --omit=dev: instala so dependencias de producao
        // --no-audit --no-fund: mais rapido, sem requests extras
        // --prefer-offline: usa cache se disponivel
        const npmEnv = { ...process.env, NPM_CONFIG_CACHE: path.join(os.tmpdir(), 'npm-cache') };
        const install = spawn('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--prefer-offline'], {
            cwd: botDir,
            shell: true,
            env: npmEnv
        });
        install.stdout.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach(l => addLog(name, l)));
        install.stderr.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach(l => addLog(name, l)));
        install.on('close', (code) => {
            if (code !== 0) {
                addLog(name, `ERRO: npm install falhou (codigo ${code})`);
                bots[name].status = 'error';
                return;
            }

            // Limpar cache do npm para economizar espaco
            try {
                const cacheDir = path.join(os.tmpdir(), 'npm-cache');
                if (fs.existsSync(cacheDir)) {
                    fs.rmSync(cacheDir, { recursive: true, force: true });
                }
            } catch {}

            // Verificar espaco apos instalacao
            const diskAfter = checkDiskSpace();
            addLog(name, `Dependencias instaladas! Disco usado: ${diskAfter.usedMB}MB/${diskAfter.limitMB}MB`);

            if (!diskAfter.ok) {
                addLog(name, 'AVISO: Disco proximo do limite! Considere deletar bots antigos.');
            }

            launchBot(name, botDir, entryFile);
        });
        install.on('error', (err) => {
            addLog(name, `ERRO ao rodar npm install: ${err.message}`);
            bots[name].status = 'error';
        });
        return true;
    }

    addLog(name, 'package.json nao encontrado, tentando iniciar direto...');
    launchBot(name, botDir, entryFile);
    return true;
}

function launchBot(name, botDir, entryFile) {
    if (!fs.existsSync(entryFile)) {
        addLog(name, `Arquivo ${path.basename(entryFile)} nao encontrado!`);
        bots[name].status = 'error';
        return;
    }

    const child = spawn('node', [entryFile], {
        cwd: botDir,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe']
    });

    bots[name].process = child;
    bots[name].status = 'running';
    addLog(name, 'Bot iniciado!');

    child.stdout.on('data', (data) => {
        data.toString().split('\n').filter(Boolean).forEach(line => addLog(name, line));
    });
    child.stderr.on('data', (data) => {
        data.toString().split('\n').filter(Boolean).forEach(line => addLog(name, `[ERRO] ${line}`));
    });
    child.on('close', (code) => {
        addLog(name, `Bot parou (codigo: ${code})`);
        bots[name].process = null;
        bots[name].status = 'stopped';
    });
    child.on('error', (err) => {
        addLog(name, `Erro ao iniciar: ${err.message}`);
        bots[name].process = null;
        bots[name].status = 'error';
    });

    return true;
}

function stopBot(name) {
    if (!bots[name] || !bots[name].process) return false;
    try {
        bots[name].process.kill('SIGTERM');
        addLog(name, 'Bot desligado.');
        bots[name].status = 'stopped';
        bots[name].process = null;
        return true;
    } catch (e) {
        addLog(name, `Erro ao desligar: ${e.message}`);
        return false;
    }
}

function restartBot(name) {
    stopBot(name);
    setTimeout(() => startBot(name), 1000);
    return true;
}

function deleteBot(name) {
    stopBot(name);
    const botDir = getBotDir(name);
    if (fs.existsSync(botDir)) fs.rmSync(botDir, { recursive: true, force: true });
    delete bots[name];
}

function canAccessBot(req, botName) {
    const session = getSession(req);
    if (!session) return false;
    if (session.type === 'discord' && session.id === OWNER_ID) return true;
    const meta = loadBotsMeta();
    const owner = meta[botName] ? meta[botName].owner : null;
    if (session.type === 'discord') return owner === session.id;
    if (session.type === 'password') return owner === 'password-admin';
    return false;
}

function getSession(req) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/session=([^;]+)/);
    if (match && sessions[match[1]]) return sessions[match[1]];
    return null;
}

function auth(req, res, next) {
    if (getSession(req)) return next();
    res.status(401).json({ error: 'Nao autorizado' });
}

loadBots();

// === DISCORD OAUTH ===
app.get('/auth/discord', (req, res) => {
    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: DISCORD_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify'
    });
    res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/');

    try {
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: DISCORD_REDIRECT_URI,
                scope: 'identify'
            })
        });
        const tokenData = await tokenRes.json();

        if (!tokenData.access_token) return res.redirect('/');

        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const user = await userRes.json();

        if (isBanned(user.id)) {
            return res.redirect('/?banned=1');
        }

        const sessionToken = crypto.randomBytes(32).toString('hex');
        sessions[sessionToken] = {
            type: 'discord',
            id: user.id,
            username: user.username,
            discriminator: user.discriminator,
            avatar: user.avatar,
            banner: user.banner || null,
            banner_color: user.banner_color || null
        };
        saveSessions(sessions);

        addStaff(user);
        slog(`Login Discord: ${user.username} (${user.id})`, 'auth');

        res.setHeader('Set-Cookie', `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax`);
        res.redirect('/');
    } catch (e) {
        res.redirect('/');
    }
});

app.get('/auth/logout', (req, res) => {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/session=([^;]+)/);
    if (match) { delete sessions[match[1]]; saveSessions(sessions); }
    res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; Max-Age=0');
    res.json({ success: true });
});

app.post('/auth/password', (req, res) => {
    const { password } = req.body;
    if (password !== PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });
    const sessionToken = crypto.randomBytes(32).toString('hex');
    sessions[sessionToken] = { type: 'password', username: 'Admin' };
    saveSessions(sessions);
    addPasswordStaff();
    slog('Login via senha de acesso', 'auth');
    res.setHeader('Set-Cookie', `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax`);
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Nao autorizado' });
    if (session.type === 'discord') {
        res.json({ id: session.id, username: session.username, discriminator: session.discriminator, avatar: session.avatar, banner: session.banner, banner_color: session.banner_color, type: 'discord' });
    } else {
        res.json({ id: '0', username: 'Admin', discriminator: '0', avatar: null, banner: null, banner_color: null, type: 'password' });
    }
});

// === STAFFS API ===
app.get('/api/staffs', ownerOnly, (req, res) => {
    const staffs = loadStaffs();
    const banned = loadBanned();
    const result = staffs.map(s => ({
        ...s,
        banned: banned.some(b => b.id === s.id)
    }));
    res.json(result);
});

app.post('/api/staffs/:id/ban', ownerOnly, (req, res) => {
    const { id } = req.params;
    if (id === OWNER_ID || id === 'password-admin') return res.status(400).json({ error: 'Nao pode banir owner/admin' });
    const banned = loadBanned();
    if (!banned.find(b => b.id === id)) {
        const staff = loadStaffs().find(s => s.id === id);
        banned.push({ id, username: staff ? staff.username : 'Desconhecido', bannedAt: new Date().toISOString() });
        saveBanned(banned);
        slog(`Staff banido: ${staff ? staff.username : id} (${id})`, 'warn');
    }
    res.json({ success: true });
});

app.post('/api/staffs/:id/unban', ownerOnly, (req, res) => {
    const { id } = req.params;
    let banned = loadBanned();
    const staff = banned.find(b => b.id === id);
    banned = banned.filter(b => b.id !== id);
    saveBanned(banned);
    if (staff) slog(`Staff desbanido: ${staff.username} (${id})`, 'info');
    res.json({ success: true });
});

app.get('/api/staffs/banned', ownerOnly, (req, res) => {
    res.json(loadBanned());
});

// === DISK API ===
app.get('/api/disk', auth, (req, res) => {
    res.json(checkDiskSpace());
});

// === BOT API ===
app.get('/api/bots', auth, (req, res) => {
    loadBots();
    const session = getSession(req);
    const ownerSession = session && session.type === 'discord' && session.id === OWNER_ID;
    const userId = session && session.type === 'discord' ? session.id : null;
    const meta = loadBotsMeta();

    const list = Object.entries(bots)
        .filter(([name]) => {
            if (ownerSession) return true; // owner ve tudo
            const botOwner = meta[name] ? meta[name].owner : null;
            return botOwner === userId; // outros veem apenas seus bots
        })
        .map(([name, data]) => ({ name, status: data.status, logsCount: data.logs.length }));

    res.json(list);
});

app.post('/api/bots', auth, (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'ZIP muito grande. Limite maximo: 50MB. Remova node_modules e arquivos desnecessarios do ZIP.' });
            }
            return res.status(400).json({ error: err.message || 'Erro no upload' });
        }
        next();
    });
}, (req, res) => {
    try {
        const session = getSession(req);
        if (session && session.type === 'password') {
            addPasswordStaff();
        }

        const name = req.body.name;
        if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) return res.status(400).json({ error: 'Nome invalido' });

        const botDir = getBotDir(name);
        if (fs.existsSync(botDir)) return res.status(400).json({ error: 'Bot ja existe' });

        // Verificar espaco em disco antes de criar o bot
        const disk = checkDiskSpace();
        if (!disk.ok) {
            return res.status(507).json({
                error: `Espaco em disco cheio no servidor (${disk.usedMB}MB/${disk.limitMB}MB). O dono precisa aumentar o volume ou deletar bots antigos.`
            });
        }
        if (disk.freePercent < 10) {
            slog(`AVISO: Disco com menos de 10% livre (${disk.usedMB}MB/${disk.limitMB}MB)`, 'warn');
        }

        fs.mkdirSync(botDir, { recursive: true });
        bots[name] = { process: null, status: 'stopped', logs: [], port: null };

        // Registrar dono do bot
        const ownerId = session && session.type === 'discord' ? session.id : 'password-admin';
        setBotOwner(name, ownerId);

        if (req.file) {
            const ext = path.extname(req.file.originalname).toLowerCase();
            if (ext === '.zip') {
                try {
                    addLog(name, 'Extraindo ZIP...');
                    const zip = new AdmZip(req.file.path);
                    const entries = zip.getEntries();

                    let extractTarget = botDir;

                    const rootDirs = entries.filter(e => e.isDirectory && e.entryName.split('/').filter(Boolean).length === 1);
                    const rootFiles = entries.filter(e => !e.isDirectory && e.entryName.split('/').filter(Boolean).length === 1);
                    const hasInnerProject = entries.some(e => {
                        if (e.isDirectory) return false;
                        const parts = e.entryName.split('/').filter(Boolean);
                        return parts.length >= 2 && (parts[parts.length - 1] === 'package.json' || parts[parts.length - 1] === 'index.js');
                    });

                    if (rootDirs.length === 1 && rootFiles.length === 0 && hasInnerProject) {
                        addLog(name, `ZIP com pasta unica, extraindo direto na raiz...`);
                        for (const entry of entries) {
                            if (entry.isDirectory) continue;
                            const parts = entry.entryName.split('/').filter(Boolean);
                            const relativePath = parts.slice(1).join('/');
                            if (!relativePath) continue;
                            if (relativePath.startsWith('node_modules/')) continue;
                            const dest = path.join(botDir, relativePath);
                            const destDir = path.dirname(dest);
                            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                            fs.writeFileSync(dest, entry.getData());
                        }
                    } else if (rootDirs.length === 1 && rootFiles.length === 0) {
                        addLog(name, `ZIP com pasta "${rootDirs[0].name}", extraindo e movendo...`);
                        const tempDir = path.join(os.tmpdir(), `bot-extract-${Date.now()}`);
                        zip.extractAllTo(tempDir, true);
                        const innerDir = path.join(tempDir, rootDirs[0].name);
                        if (fs.existsSync(innerDir)) {
                            const innerEntries = fs.readdirSync(innerDir, { withFileTypes: true });
                            for (const ie of innerEntries) {
                                const src = path.join(innerDir, ie.name);
                                const dst = path.join(botDir, ie.name);
                                if (ie.isDirectory()) {
                                    fs.cpSync(src, dst, { recursive: true });
                                } else {
                                    fs.copyFileSync(src, dst);
                                }
                            }
                        }
                        fs.rmSync(tempDir, { recursive: true, force: true });
                    } else {
                        addLog(name, 'ZIP na raiz, extraindo...');
                        for (const entry of entries) {
                            if (entry.isDirectory) continue;
                            const parts = entry.entryName.split('/').filter(Boolean);
                            const relativePath = parts.join('/');
                            if (!relativePath) continue;
                            if (relativePath.startsWith('node_modules/')) continue;
                            const dest = path.join(botDir, relativePath);
                            const destDir = path.dirname(dest);
                            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                            fs.writeFileSync(dest, entry.getData());
                        }
                    }

                    try { fs.unlinkSync(req.file.path); } catch(e) {}

                    flattenBotDir(botDir, name);

                    const files = fs.readdirSync(botDir);
                    addLog(name, `Arquivos: ${files.join(', ') || 'nenhum'}`);

                    if (!fs.existsSync(path.join(botDir, 'package.json')) && !fs.existsSync(path.join(botDir, 'index.js'))) {
                        addLog(name, 'AVISO: Nenhum package.json ou index.js encontrado na raiz!');
                    }

                    addLog(name, 'ZIP extraido com sucesso!');
                } catch (e) {
                    addLog(name, `Erro ao extrair ZIP: ${e.message}`);
                    try { fs.unlinkSync(req.file.path); } catch(ex) {}
                    try { fs.rmSync(botDir, { recursive: true, force: true }); } catch(ex) {}
                    delete bots[name];
                    return res.status(400).json({ error: 'Arquivo ZIP invalido: ' + e.message });
                }
            } else {
                fs.copyFileSync(req.file.path, path.join(botDir, req.file.originalname));
                try { fs.unlinkSync(req.file.path); } catch(e) {}
            }
        }

        addLog(name, 'Bot criado com sucesso!');
        slog(`Bot criado: "${name}" por ${ownerId}`, 'bot');
        res.json({ success: true, name });
    } catch (e) {
        const name = req.body && req.body.name;
        if (name) {
            try { fs.rmSync(getBotDir(name), { recursive: true, force: true }); } catch(ex) {}
            delete bots[name];
        }
        try { if (req.file) fs.unlinkSync(req.file.path); } catch(ex) {}
        res.status(500).json({ error: 'Erro interno: ' + e.message });
    }
});

app.post('/api/bots/:name/start', auth, (req, res) => {
    const { name } = req.params;
    if (!bots[name]) return res.status(404).json({ error: 'Bot nao encontrado' });
    if (!canAccessBot(req, name)) return res.status(403).json({ error: 'Acesso negado' });
    slog(`Bot ligado: "${name}"`, 'bot');
    res.json({ success: startBot(name) });
});

app.post('/api/bots/:name/stop', auth, (req, res) => {
    const { name } = req.params;
    if (!bots[name]) return res.status(404).json({ error: 'Bot nao encontrado' });
    if (!canAccessBot(req, name)) return res.status(403).json({ error: 'Acesso negado' });
    slog(`Bot desligado: "${name}"`, 'bot');
    res.json({ success: stopBot(name) });
});

app.post('/api/bots/:name/restart', auth, (req, res) => {
    const { name } = req.params;
    if (!bots[name]) return res.status(404).json({ error: 'Bot nao encontrado' });
    if (!canAccessBot(req, name)) return res.status(403).json({ error: 'Acesso negado' });
    slog(`Bot reiniciado: "${name}"`, 'bot');
    res.json({ success: restartBot(name) });
});

app.delete('/api/bots/:name', auth, (req, res) => {
    const { name } = req.params;
    if (!bots[name]) return res.status(404).json({ error: 'Bot nao encontrado' });
    if (!canAccessBot(req, name)) return res.status(403).json({ error: 'Acesso negado' });
    slog(`Bot deletado: "${name}"`, 'warn');
    deleteBot(name);
    // Remover metadata do bot deletado
    const meta = loadBotsMeta();
    delete meta[name];
    saveBotsMeta(meta);
    res.json({ success: true });
});

app.get('/api/bots/:name/logs', auth, (req, res) => {
    const { name } = req.params;
    if (!bots[name]) return res.status(404).json({ error: 'Bot nao encontrado' });
    if (!canAccessBot(req, name)) return res.status(403).json({ error: 'Acesso negado' });
    res.json({ logs: bots[name].logs });
});

app.get('/health', (req, res) => {
    res.json({ ok: true });
});

app.get('/api/server-logs', ownerOnly, (req, res) => {
    const limit = parseInt(req.query.limit) || 200;
    res.json({ logs: serverLogs.slice(-limit) });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    slog(`Servidor iniciado na porta ${PORT}`, 'info');
    slog(`Discord OAuth: ${DISCORD_CLIENT_ID !== 'SEU_CLIENT_ID' ? 'Configurado' : 'Nao configurado'}`, 'info');

    // Auto-religar todos os bots que existem no disco
    const allBots = Object.keys(bots);
    if (allBots.length > 0) {
        slog(`Auto-iniciando ${allBots.length} bot(s)...`, 'info');
        allBots.forEach((name, i) => {
            setTimeout(() => {
                slog(`Auto-iniciando bot: "${name}"`, 'bot');
                startBot(name);
            }, i * 3000); // espaca 3s entre cada bot para nao sobrecarregar
        });
    }

    console.log(`Painel rodando em http://localhost:${PORT}`);
    console.log(`Senha: ${PASSWORD}`);
    console.log(`Discord OAuth: ${DISCORD_CLIENT_ID !== 'SEU_CLIENT_ID' ? 'Configurado' : 'Nao configurado'}`);
});
