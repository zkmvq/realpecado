const { MongoClient } = require('mongodb');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const MONGO_URI = process.env.MONGO_URI;
const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

let mongoClient, mongoDb;
let pgPool;
let dbType = 'json';

let jsonStores = {};

function jsonStore(name) {
    if (!jsonStores[name]) {
        const filePath = path.join(DATA_DIR, name + '.json');
        jsonStores[name] = { filePath, data: {} };
        try {
            if (fs.existsSync(filePath)) {
                jsonStores[name].data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
        } catch (e) { jsonStores[name].data = {}; }
    }
    return jsonStores[name];
}

function jsonSave(name) {
    const store = jsonStores[name];
    if (!store) return;
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(store.filePath, JSON.stringify(store.data, null, 2), 'utf8');
    } catch (e) { console.error('Erro ao salvar ' + name + '.json:', e.message); }
}

async function connectDB() {
    if (DATABASE_URL) {
        try {
            pgPool = new Pool({
                connectionString: DATABASE_URL,
                ssl: process.env.DB_SSL_VERIFY === 'true' ? { rejectUnauthorized: true } : { rejectUnauthorized: false },
                max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000, allowExitOnIdle: false
            });
            await pgPool.query('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, data JSONB, created_at TIMESTAMP DEFAULT NOW())');
            await pgPool.query('CREATE TABLE IF NOT EXISTS staffs (id TEXT PRIMARY KEY, data JSONB)');
            await pgPool.query('CREATE TABLE IF NOT EXISTS banned (id TEXT PRIMARY KEY, data JSONB)');
            await pgPool.query('CREATE TABLE IF NOT EXISTS admins (id TEXT PRIMARY KEY)');
            await pgPool.query('CREATE TABLE IF NOT EXISTS bots (name TEXT PRIMARY KEY, data JSONB)');
            await pgPool.query('CREATE TABLE IF NOT EXISTS purchases (id SERIAL PRIMARY KEY, user_id TEXT, username TEXT, plan_name TEXT, plan_price TEXT, plan_tier TEXT, plan_duration TEXT, status TEXT DEFAULT \'pending\', created_at TIMESTAMP DEFAULT NOW(), reviewed_at TIMESTAMP)');
            await pgPool.query('CREATE TABLE IF NOT EXISTS databases (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, db_type TEXT NOT NULL, db_name TEXT NOT NULL, db_user TEXT NOT NULL, db_password TEXT NOT NULL, db_host TEXT DEFAULT \'localhost\', db_port INTEGER DEFAULT 5432, status TEXT DEFAULT \'active\', created_at TIMESTAMP DEFAULT NOW())');
            await pgPool.query('ALTER TABLE bots ADD COLUMN IF NOT EXISTS auto_start BOOLEAN DEFAULT false');
            await pgPool.query('ALTER TABLE bots ADD COLUMN IF NOT EXISTS language TEXT DEFAULT NULL');
            await pgPool.query('CREATE INDEX IF NOT EXISTS idx_purchases_user_id ON purchases(user_id)');
            await pgPool.query('CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status)');
            await pgPool.query('CREATE INDEX IF NOT EXISTS idx_databases_user_id ON databases(user_id)');
            dbType = 'pg';
            console.log('PostgreSQL conectado!');
            return;
        } catch (e) { console.error('Erro PostgreSQL:', e.message); }
    }
    if (MONGO_URI) {
        try {
            mongoClient = new MongoClient(MONGO_URI);
            await mongoClient.connect();
            mongoDb = mongoClient.db('bot-host');
            dbType = 'mongo';
            console.log('MongoDB conectado!');
            return;
        } catch (e) { console.error('Erro MongoDB:', e.message); }
    }
    dbType = 'json';
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('Usando JSON files em ' + DATA_DIR);
}

function isUsingDB() { return dbType !== 'json'; }

async function getSession(token) {
    if (!token || typeof token !== 'string') return null;
    try {
        if (dbType === 'pg') { const r = await pgPool.query('SELECT data FROM sessions WHERE token=$1', [token]); return r.rows[0] ? r.rows[0].data : null; }
        if (dbType === 'mongo') { const doc = await mongoDb.collection('sessions').findOne({ token }); if (!doc) return null; const { _id, token: t, ...rest } = doc; return rest; }
        if (dbType === 'json') { const s = jsonStore('sessions'); return s.data[token] || null; }
    } catch (e) { console.error('getSession error:', e.message); }
    return null;
}
async function saveSession(token, data) {
    if (!token || typeof token !== 'string') return;
    try {
        if (dbType === 'pg') { const saveData = { ...data, createdAt: data.createdAt || new Date().toISOString() }; await pgPool.query('INSERT INTO sessions (token, data) VALUES ($1, $2) ON CONFLICT (token) DO UPDATE SET data=$2', [token, saveData]); }
        if (dbType === 'mongo') { await mongoDb.collection('sessions').updateOne({ token }, { $set: { token, ...data, createdAt: data.createdAt || new Date() } }, { upsert: true }); }
        if (dbType === 'json') { const s = jsonStore('sessions'); s.data[token] = { ...data, createdAt: data.createdAt || new Date().toISOString() }; jsonSave('sessions'); }
    } catch (e) { console.error('saveSession error:', e.message); }
}
async function deleteSession(token) {
    try { if (dbType === 'pg') await pgPool.query('DELETE FROM sessions WHERE token=$1', [token]); if (dbType === 'mongo') await mongoDb.collection('sessions').deleteOne({ token }); if (dbType === 'json') { const s = jsonStore('sessions'); delete s.data[token]; jsonSave('sessions'); } } catch (e) { console.error('deleteSession error:', e.message); }
}
async function deleteAllSessions() {
    try { if (dbType === 'pg') await pgPool.query('DELETE FROM sessions'); if (dbType === 'mongo') await mongoDb.collection('sessions').deleteMany({}); if (dbType === 'json') { jsonStore('sessions').data = {}; jsonSave('sessions'); } } catch (e) { console.error('deleteAllSessions error:', e.message); }
}
async function getAllSessions() {
    try {
        if (dbType === 'pg') { const r = await pgPool.query('SELECT token, data FROM sessions'); const map = {}; for (const row of r.rows) map[row.token] = row.data; return map; }
        if (dbType === 'mongo') { const docs = await mongoDb.collection('sessions').find({}).toArray(); const map = {}; for (const d of docs) { const { _id, token, ...rest } = d; map[token] = rest; } return map; }
        if (dbType === 'json') return { ...jsonStore('sessions').data };
    } catch (e) { console.error('getAllSessions error:', e.message); }
    return {};
}
async function cleanOldSessions() {
    try {
        if (dbType === 'pg') await pgPool.query("DELETE FROM sessions WHERE (data->>'createdAt')::timestamp < NOW() - INTERVAL '30 days'");
        if (dbType === 'mongo') { const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); await mongoDb.collection('sessions').deleteMany({ createdAt: { $lt: d } }); }
        if (dbType === 'json') { const s = jsonStore('sessions'); const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; let changed = false; for (const [token, data] of Object.entries(s.data)) { if (data.createdAt && new Date(data.createdAt).getTime() < cutoff) { delete s.data[token]; changed = true; } } if (changed) jsonSave('sessions'); }
    } catch (e) { console.error('cleanOldSessions error:', e.message); }
}

async function getStaffs() {
    try {
        if (dbType === 'pg') return (await pgPool.query('SELECT id, data FROM staffs')).rows.map(r => ({ id: r.id, ...r.data }));
        if (dbType === 'mongo') return await mongoDb.collection('staffs').find({}).toArray();
        if (dbType === 'json') return Object.entries(jsonStore('staffs').data).map(([id, data]) => ({ id, ...data }));
    } catch (e) { console.error('getStaffs error:', e.message); }
    return [];
}
async function getStaff(id) {
    if (!id || typeof id !== 'string') return null;
    try { if (dbType === 'pg') { const r = await pgPool.query('SELECT data FROM staffs WHERE id=$1', [id]); return r.rows[0] ? r.rows[0].data : null; } if (dbType === 'mongo') return await mongoDb.collection('staffs').findOne({ id }); if (dbType === 'json') return jsonStore('staffs').data[id] || null; } catch (e) { console.error('getStaff error:', e.message); }
    return null;
}
async function upsertStaff(id, data) {
    if (!id || typeof id !== 'string') return;
    const { $inc, ...setData } = data;
    try {
        if (dbType === 'pg') { const existing = await getStaff(id); if ($inc) { for (const [k, v] of Object.entries($inc)) { setData[k] = (typeof v === 'number' && typeof (existing && existing[k]) === 'number') ? existing[k] + v : (v || 0); } } await pgPool.query('INSERT INTO staffs (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data=$2', [id, setData]); }
        if (dbType === 'mongo') { const update = { $set: { id, ...setData } }; if ($inc) update.$inc = $inc; await mongoDb.collection('staffs').updateOne({ id }, update, { upsert: true }); }
        if (dbType === 'json') { const s = jsonStore('staffs'); const existing = s.data[id] || {}; const merged = { ...existing, ...setData }; if ($inc) { for (const [k, v] of Object.entries($inc)) { merged[k] = (typeof v === 'number' && typeof existing[k] === 'number') ? existing[k] + v : (v || 0); } } s.data[id] = merged; jsonSave('staffs'); }
    } catch (e) { console.error('upsertStaff error:', e.message); }
}
async function updateStaff(id, update) {
    if (!id || typeof id !== 'string') return;
    try {
        if (dbType === 'pg') { const existing = await getStaff(id); const merged = existing ? { ...existing, ...update } : { id, ...update }; await pgPool.query('INSERT INTO staffs (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data=$2', [id, merged]); }
        if (dbType === 'mongo') await mongoDb.collection('staffs').updateOne({ id }, { $set: update });
        if (dbType === 'json') { const s = jsonStore('staffs'); s.data[id] = { ...(s.data[id] || {}), ...update }; jsonSave('staffs'); }
    } catch (e) { console.error('updateStaff error:', e.message); }
}

async function getBanned() {
    try { if (dbType === 'pg') return (await pgPool.query('SELECT id, data FROM banned')).rows.map(r => ({ id: r.id, ...r.data })); if (dbType === 'mongo') return await mongoDb.collection('banned').find({}).toArray(); if (dbType === 'json') return Object.entries(jsonStore('banned').data).map(([id, data]) => ({ id, ...data })); } catch (e) { console.error('getBanned error:', e.message); }
    return [];
}
async function addBanned(id, data) {
    if (!id || typeof id !== 'string') return;
    try { if (dbType === 'pg') await pgPool.query('INSERT INTO banned (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data=$2', [id, data]); if (dbType === 'mongo') await mongoDb.collection('banned').updateOne({ id }, { $set: { id, ...data } }, { upsert: true }); if (dbType === 'json') { const s = jsonStore('banned'); s.data[id] = data; jsonSave('banned'); } } catch (e) { console.error('addBanned error:', e.message); }
}
async function removeBanned(id) {
    try { if (dbType === 'pg') await pgPool.query('DELETE FROM banned WHERE id=$1', [id]); if (dbType === 'mongo') await mongoDb.collection('banned').deleteOne({ id }); if (dbType === 'json') { delete jsonStore('banned').data[id]; jsonSave('banned'); } } catch (e) { console.error('removeBanned error:', e.message); }
}
async function isBanned(id) {
    if (!id || typeof id !== 'string') return false;
    try { if (dbType === 'pg') return (await pgPool.query('SELECT EXISTS(SELECT 1 FROM banned WHERE id=$1)', [id])).rows[0].exists; if (dbType === 'mongo') return (await mongoDb.collection('banned').countDocuments({ id })) > 0; if (dbType === 'json') return !!jsonStore('banned').data[id]; } catch (e) { console.error('isBanned error:', e.message); }
    return false;
}

async function getAdmins() {
    try { if (dbType === 'pg') return (await pgPool.query('SELECT id FROM admins')).rows.map(r => r.id); if (dbType === 'mongo') return (await mongoDb.collection('admins').find({}).toArray()).map(d => d.id); if (dbType === 'json') return jsonStore('admins').data.ids || []; } catch (e) { console.error('getAdmins error:', e.message); }
    return [];
}
async function addAdmin(id) {
    if (!id || typeof id !== 'string') return;
    try { if (dbType === 'pg') await pgPool.query('INSERT INTO admins (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]); if (dbType === 'mongo') await mongoDb.collection('admins').updateOne({ id }, { $set: { id } }, { upsert: true }); if (dbType === 'json') { const s = jsonStore('admins'); if (!s.data.ids) s.data.ids = []; if (!s.data.ids.includes(id)) { s.data.ids.push(id); jsonSave('admins'); } } } catch (e) { console.error('addAdmin error:', e.message); }
}
async function removeAdmin(id) {
    try { if (dbType === 'pg') await pgPool.query('DELETE FROM admins WHERE id=$1', [id]); if (dbType === 'mongo') await mongoDb.collection('admins').deleteOne({ id }); if (dbType === 'json') { const s = jsonStore('admins'); if (s.data.ids) { s.data.ids = s.data.ids.filter(x => x !== id); jsonSave('admins'); } } } catch (e) { console.error('removeAdmin error:', e.message); }
}

async function getBots() {
    try { if (dbType === 'pg') return (await pgPool.query('SELECT name, data, auto_start FROM bots')).rows.map(r => ({ name: r.name, ...r.data, auto_start: r.auto_start })); if (dbType === 'mongo') return await mongoDb.collection('bots').find({}).toArray(); if (dbType === 'json') return Object.entries(jsonStore('bots').data).map(([name, data]) => ({ name, ...data })); } catch (e) { console.error('getBots error:', e.message); }
    return [];
}
async function saveBot(name, data) {
    if (!name || typeof name !== 'string') return;
    try {
        if (dbType === 'pg') { const { auto_start, ...rest } = data; if (auto_start !== undefined) { await pgPool.query('INSERT INTO bots (name, data, auto_start) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET data = bots.data || $2, auto_start=$3', [name, rest, auto_start]); } else { await pgPool.query('INSERT INTO bots (name, data) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET data = bots.data || $2', [name, rest]); } }
        if (dbType === 'mongo') await mongoDb.collection('bots').updateOne({ name }, { $set: data }, { upsert: true });
        if (dbType === 'json') { const s = jsonStore('bots'); s.data[name] = { ...(s.data[name] || {}), ...data }; jsonSave('bots'); }
    } catch (e) { console.error('saveBot error:', e.message); }
}
async function setAutoStart(name, value) {
    try { if (dbType === 'pg') await pgPool.query('UPDATE bots SET auto_start=$2 WHERE name=$1', [name, value]); if (dbType === 'mongo') await mongoDb.collection('bots').updateOne({ name }, { $set: { auto_start: value } }); if (dbType === 'json') { const s = jsonStore('bots'); if (s.data[name]) { s.data[name].auto_start = value; jsonSave('bots'); } } } catch (e) { console.error('setAutoStart error:', e.message); }
}
async function deleteBotDB(name) {
    try { if (dbType === 'pg') await pgPool.query('DELETE FROM bots WHERE name=$1', [name]); if (dbType === 'mongo') await mongoDb.collection('bots').deleteOne({ name }); if (dbType === 'json') { delete jsonStore('bots').data[name]; jsonSave('bots'); } } catch (e) { console.error('deleteBotDB error:', e.message); }
}

async function createPurchase(data) {
    try { if (dbType === 'pg') { const r = await pgPool.query('INSERT INTO purchases (user_id, username, plan_name, plan_price, plan_tier, plan_duration) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [data.userId, data.username, data.planName, data.planPrice, data.planTier, data.planDuration]); return r.rows[0].id; } } catch (e) { console.error('createPurchase error:', e.message); }
    if (dbType === 'json') { const s = jsonStore('purchases'); const id = (s.data._nextId || 0) + 1; s.data._nextId = id; s.data[id] = { id, user_id: data.userId, username: data.username, plan_name: data.planName, plan_price: data.planPrice, plan_tier: data.planTier, plan_duration: data.planDuration, status: 'pending', created_at: new Date().toISOString() }; jsonSave('purchases'); return id; }
    return Date.now();
}
async function getPurchases(status) {
    try {
        if (dbType === 'pg') { if (status) return (await pgPool.query('SELECT * FROM purchases WHERE status=$1 ORDER BY created_at DESC', [status])).rows; return (await pgPool.query('SELECT * FROM purchases ORDER BY created_at DESC')).rows; }
        if (dbType === 'json') { const all = Object.values(jsonStore('purchases').data).filter(v => typeof v === 'object' && v.id); if (status) return all.filter(p => p.status === status).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); return all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); }
    } catch (e) { console.error('getPurchases error:', e.message); }
    return [];
}
async function updatePurchaseStatus(id, status) {
    try { if (dbType === 'pg') await pgPool.query('UPDATE purchases SET status=$2, reviewed_at=NOW() WHERE id=$1', [id, status]); if (dbType === 'json') { const s = jsonStore('purchases'); if (s.data[id]) { s.data[id].status = status; s.data[id].reviewed_at = new Date().toISOString(); jsonSave('purchases'); } } } catch (e) { console.error('updatePurchaseStatus error:', e.message); }
}
async function getUserPurchases(userId) {
    try { if (dbType === 'pg') return (await pgPool.query('SELECT * FROM purchases WHERE user_id=$1 ORDER BY created_at DESC', [userId])).rows; if (dbType === 'json') return Object.values(jsonStore('purchases').data).filter(v => typeof v === 'object' && v.user_id === userId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); } catch (e) { console.error('getUserPurchases error:', e.message); }
    return [];
}

async function createDatabase(data) {
    try { if (dbType === 'pg') { const r = await pgPool.query('INSERT INTO databases (user_id, db_type, db_name, db_user, db_password, db_host, db_port) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [data.userId, data.dbType, data.dbName, data.dbUser, data.dbPassword, data.dbHost || 'localhost', data.dbPort || 5432]); return r.rows[0]; } } catch (e) { console.error('createDatabase error:', e.message); }
    return null;
}
async function getDatabases(userId) {
    try { if (dbType === 'pg') { if (userId) return (await pgPool.query('SELECT * FROM databases WHERE user_id=$1 ORDER BY created_at DESC', [userId])).rows; return (await pgPool.query('SELECT * FROM databases ORDER BY created_at DESC')).rows; } } catch (e) { console.error('getDatabases error:', e.message); }
    return [];
}
async function deleteDatabase(id, userId) {
    try { if (dbType === 'pg') { if (userId) await pgPool.query('DELETE FROM databases WHERE id=$1 AND user_id=$2', [id, userId]); else await pgPool.query('DELETE FROM databases WHERE id=$1', [id]); } } catch (e) { console.error('deleteDatabase error:', e.message); }
}
async function resetDbPassword(id, newPassword) {
    try { if (dbType === 'pg') await pgPool.query('UPDATE databases SET db_password=$2 WHERE id=$1', [id, newPassword]); } catch (e) { console.error('resetDbPassword error:', e.message); }
}
async function getDatabaseById(id) {
    try { if (dbType === 'pg') { const r = await pgPool.query('SELECT * FROM databases WHERE id=$1', [id]); return r.rows[0] || null; } } catch (e) { console.error('getDatabaseById error:', e.message); }
    return null;
}

module.exports = {
    connectDB, isUsingDB,
    getSession, saveSession, deleteSession, deleteAllSessions, getAllSessions, cleanOldSessions,
    getStaffs, getStaff, upsertStaff, updateStaff,
    getBanned, addBanned, removeBanned, isBanned,
    getAdmins, addAdmin, removeAdmin,
    getBots, saveBot, deleteBotDB, setAutoStart,
    createPurchase, getPurchases, updatePurchaseStatus, getUserPurchases,
    createDatabase, getDatabases, deleteDatabase, resetDbPassword, getDatabaseById
};
