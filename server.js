const express = require('express')
const fs = require('fs')
const path = require('path')
const multer = require('multer')
const sharp = require('sharp')
const bcrypt = require('bcrypt')
const { Server } = require('socket.io')
const http = require('http')
const https = require('https')
const saltRounds = 10
const app = express()
const sqlite3 = require('sqlite3').verbose();
const dbPath = path.join(__dirname, 'api', 'chats.db');
const db = new sqlite3.Database(dbPath);
const crypto = require('crypto');
const sessionsDb = new sqlite3.Database(path.join(__dirname, 'api', 'sessions.db'));
const rateLimit = require('express-rate-limit');
const zlib = require('zlib');
const mainDbPath = path.join(__dirname, 'api', 'main.db');
const mainDb = new sqlite3.Database(mainDbPath);

function dbRun(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function dbGet(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function dbAll(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function runPrepared(database, sql, parameterSets) {
    return new Promise((resolve, reject) => {
        const statement = database.prepare(sql, err => {
            if (err) return reject(err);

            let index = 0;
            const runNext = () => {
                if (index >= parameterSets.length) {
                    statement.finalize(finalizeErr => {
                        if (finalizeErr) reject(finalizeErr);
                        else resolve();
                    });
                    return;
                }

                statement.run(parameterSets[index], runErr => {
                    if (runErr) {
                        statement.finalize(() => reject(runErr));
                        return;
                    }
                    index += 1;
                    runNext();
                });
            };

            runNext();
        });
    });
}

async function userExists(userId) {
    if (!Number.isSafeInteger(Number(userId))) return false;
    return Boolean(await dbGet(mainDb, 'SELECT 1 FROM users WHERE id = ?', [Number(userId)]));
}

const MANAGED_MEDIA_DIRECTORIES = ['images', 'videos', 'audios'];
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/tiff'
]);

function resolveManagedMediaPath(storedPath) {
    if (typeof storedPath !== 'string' || !storedPath.startsWith('/')) return null;
    const normalized = storedPath.replace(/^\/+/, '');
    const absolutePath = path.resolve(__dirname, normalized);

    for (const directory of MANAGED_MEDIA_DIRECTORIES) {
        const root = path.resolve(__dirname, directory);
        if (absolutePath === root || absolutePath.startsWith(root + path.sep)) {
            return absolutePath;
        }
    }
    return null;
}

function deleteManagedMediaFile(storedPath) {
    const absolutePath = resolveManagedMediaPath(storedPath);
    if (!absolutePath) return false;

    try {
        if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
        return true;
    } catch (error) {
        console.error('Failed to delete managed media file:', absolutePath, error.message);
        return false;
    }
}

function safeUnlinkTemporaryFile(filePath) {
    try {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (error) {
        console.error('Failed to remove temporary media file:', error.message);
    }
}

function isValidGifBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 6) return false;
    const signature = buffer.subarray(0, 6).toString('ascii');
    return signature === 'GIF87a' || signature === 'GIF89a';
}

function createMemoryUpload({ maxFileSize, allowedMime }) {
    return multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: maxFileSize, files: 10 },
        fileFilter: (req, file, cb) => {
            if (allowedMime(file.mimetype || '')) return cb(null, true);
            const error = new Error('Unsupported file type');
            error.statusCode = 415;
            return cb(error, false);
        }
    });
}

async function resolveMessageMediaIds(filePaths, fileTypes) {
    return Promise.all(filePaths.map(async (filePath, index) => {
        const fileType = fileTypes[index];
        if (fileType !== 'image' && fileType !== 'gif') return null;

        const canonicalId = filePath.match(/^\/photo\/(\d+)$/)?.[1];
        if (canonicalId) return Number(canonicalId);

        const photo = await dbGet(
            mainDb,
            'SELECT id FROM photos WHERE file_path = ? ORDER BY id ASC LIMIT 1',
            [filePath]
        );
        return photo?.id || null;
    }));
}

async function formatChatMessage(msg) {
    const filePaths = msg.file_paths ? msg.file_paths.split(',').filter(Boolean) : [];
    const fileTypes = msg.file_types ? msg.file_types.split(',') : [];
    const publicRole = await getPublicRoleForUser(Number(msg.user_id));

    return {
        id: msg.id,
        chatId: msg.chat_id,
        userId: msg.user_id,
        username: msg.username,
        profilePicture: msg.profile_picture,
        ...publicRole,
        messageText: msg.message_text,
        filePaths,
        fileTypes,
        fileIds: await resolveMessageMediaIds(filePaths, fileTypes),
        isRead: msg.is_read === 1,
        createdAt: msg.created_at,
        referenceId: msg.reference_id,
        edited: msg.edited === 1
    };
}

async function ensureColumn(tableName, columnName, definition) {
    const columns = await dbAll(mainDb, `PRAGMA table_info(${tableName})`);
    if (!columns.some(column => column.name === columnName)) {
        await dbRun(mainDb, `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}

async function ensureAlbumPhotosForeignKeys() {
    const table = await dbGet(
        mainDb,
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'album_photos'"
    );
    if (!table) return;

    const foreignKeys = await dbAll(mainDb, 'PRAGMA foreign_key_list(album_photos)');
    const albumForeignKey = foreignKeys.find(key => key.from === 'album_id');
    if (albumForeignKey?.table === 'user_photo_albums') return;

    console.warn('Repairing album_photos foreign key target');
    await dbRun(mainDb, 'DROP TABLE IF EXISTS album_photos_rebuild');
    await dbRun(mainDb, `
        CREATE TABLE album_photos_rebuild (
            album_id INTEGER NOT NULL REFERENCES user_photo_albums(id) ON DELETE CASCADE,
            photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
            added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            added_at INTEGER DEFAULT 0,
            PRIMARY KEY (album_id, photo_id)
        )
    `);
    await dbRun(mainDb, `
        INSERT OR IGNORE INTO album_photos_rebuild (album_id, photo_id, added_by, added_at)
        SELECT
            ap.album_id,
            ap.photo_id,
            CASE WHEN u.id IS NULL THEN NULL ELSE ap.added_by END,
            ap.added_at
        FROM album_photos ap
        JOIN user_photo_albums ua ON ua.id = ap.album_id
        JOIN photos p ON p.id = ap.photo_id
        LEFT JOIN users u ON u.id = ap.added_by
    `);
    await dbRun(mainDb, 'DROP TABLE album_photos');
    await dbRun(mainDb, 'ALTER TABLE album_photos_rebuild RENAME TO album_photos');
}

async function purgeOrphanSessions() {
    const sessionUsers = await dbAll(sessionsDb, 'SELECT DISTINCT user_id FROM sessions');
    const userIds = sessionUsers
        .map(row => Number(row.user_id))
        .filter(Number.isSafeInteger);
    const existingUsers = new Set();

    for (let index = 0; index < userIds.length; index += 500) {
        const chunk = userIds.slice(index, index + 500);
        if (!chunk.length) continue;
        const placeholders = chunk.map(() => '?').join(',');
        const rows = await dbAll(mainDb, `SELECT id FROM users WHERE id IN (${placeholders})`, chunk);
        rows.forEach(row => existingUsers.add(Number(row.id)));
    }

    const orphanUserIds = userIds.filter(userId => !existingUsers.has(userId));
    if (!orphanUserIds.length) return 0;

    await runPrepared(
        sessionsDb,
        'DELETE FROM sessions WHERE user_id = ?',
        orphanUserIds.map(userId => [userId])
    );
    console.warn(`Removed sessions for ${orphanUserIds.length} users missing from main.db`);
    return orphanUserIds.length;
}

async function runDatabaseMigrations() {
    // SQLite connection PRAGMAs must finish before the migration transaction.
    // Running them fire-and-forget races with BEGIN IMMEDIATE and can crash
    // startup with "Safety level may not be changed inside a transaction".
    await dbRun(mainDb, 'PRAGMA journal_mode = WAL');
    await dbRun(mainDb, 'PRAGMA synchronous = NORMAL');
    await dbRun(mainDb, 'PRAGMA cache_size = 10000');
    await dbRun(mainDb, 'PRAGMA temp_store = MEMORY');
    await dbRun(mainDb, 'PRAGMA busy_timeout = 5000');
    await dbRun(mainDb, 'PRAGMA foreign_keys = ON');
    await dbRun(mainDb, 'BEGIN IMMEDIATE TRANSACTION');
    try {
        await dbRun(mainDb, `
            CREATE TABLE IF NOT EXISTS user_roles (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                granted_at INTEGER NOT NULL,
                granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                PRIMARY KEY (user_id, role)
            )
        `);
        await dbRun(mainDb, `
            CREATE TABLE IF NOT EXISTS profile_pinned_posts (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                post_id INTEGER NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
                pinned_at INTEGER NOT NULL
            )
        `);
        await dbRun(mainDb, `
            CREATE TABLE IF NOT EXISTS post_moderation_state (
                post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
                hidden INTEGER NOT NULL DEFAULT 0,
                hidden_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                hidden_at INTEGER,
                deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                deleted_at INTEGER
            )
        `);
        await dbRun(mainDb, `
            CREATE TABLE IF NOT EXISTS moderation_audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                moderator_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                flag_id INTEGER,
                post_id INTEGER,
                action TEXT NOT NULL,
                details TEXT,
                created_at INTEGER NOT NULL
            )
        `);
        await dbRun(mainDb, `
            CREATE TABLE IF NOT EXISTS global_announcements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                text TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER,
                is_active INTEGER NOT NULL DEFAULT 1
            )
        `);
        await dbRun(mainDb, `
            CREATE TABLE IF NOT EXISTS global_announcement_dismissals (
                announcement_id INTEGER NOT NULL REFERENCES global_announcements(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                dismissed_at INTEGER NOT NULL,
                PRIMARY KEY (announcement_id, user_id)
            )
        `);

        await ensureColumn('user_mascot_status', 'petting_record', 'INTEGER NOT NULL DEFAULT 0');
        await ensureColumn('post_files', 'display_name', 'TEXT');
        await ensureColumn('comments', 'is_spoiler', 'INTEGER NOT NULL DEFAULT 0');
        await ensureAlbumPhotosForeignKeys();
        await dbRun(mainDb, 'UPDATE user_mascot_status SET bricked = 0 WHERE bricked != 0');
        await ensureColumn('mod_posts_flagged', 'status', "TEXT NOT NULL DEFAULT 'pending'");
        await ensureColumn('mod_posts_flagged', 'resolution_action', 'TEXT');

        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_comments_post_created ON comments(post_id, created_at)',
            'CREATE INDEX IF NOT EXISTS idx_comments_parent_created ON comments(parent_comment_id, created_at)',
            'CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at)',
            'CREATE INDEX IF NOT EXISTS idx_flags_status_submitted ON mod_posts_flagged(status, submitted_at DESC)',
            'CREATE INDEX IF NOT EXISTS idx_roles_role_user ON user_roles(role, user_id)',
            'CREATE INDEX IF NOT EXISTS idx_announcements_active_created ON global_announcements(is_active, created_at DESC)',
            'CREATE INDEX IF NOT EXISTS idx_announcement_dismissals_user ON global_announcement_dismissals(user_id, announcement_id)',
            'CREATE INDEX IF NOT EXISTS idx_moderation_state_hidden ON post_moderation_state(hidden, post_id)'
        ];
        for (const sql of indexes) await dbRun(mainDb, sql);

        // Older chat image attachments predate photo metadata. Backfill it so
        // those messages can use the same save-to-album flow as newer media.
        const messagesWithMedia = await dbAll(mainDb, `
            SELECT user_id, file_paths, file_types, created_at
            FROM messages
            WHERE file_paths IS NOT NULL AND file_paths != ''
        `);
        for (const message of messagesWithMedia) {
            const paths = message.file_paths.split(',');
            const types = message.file_types ? message.file_types.split(',') : [];
            for (let index = 0; index < paths.length; index++) {
                if (types[index] !== 'image' && types[index] !== 'gif') continue;
                const filePath = paths[index];
                if (!filePath) continue;

                const existingPhoto = await dbGet(
                    mainDb,
                    'SELECT id FROM photos WHERE file_path = ? LIMIT 1',
                    [filePath]
                );
                if (!existingPhoto) {
                    const createdAt = Number(message.created_at) || Math.floor(Date.now() / 1000);
                    await dbRun(mainDb, `
                        INSERT INTO photos (file_path, uploaded_by, created_at)
                        VALUES (?, ?, ?)
                    `, [filePath, message.user_id, createdAt]);
                }
            }
        }

        const now = Math.floor(Date.now() / 1000);
        await dbRun(mainDb, `
            INSERT OR IGNORE INTO admins (user_id)
            SELECT id FROM users WHERE id = 1773499483205
        `);
        await dbRun(mainDb, `
            INSERT OR IGNORE INTO user_roles (user_id, role, granted_at, granted_by)
            SELECT id, 'owner', ?, id
            FROM users
            WHERE id = 1773499483205
        `, [now]);
        await dbRun(mainDb, `
            INSERT OR IGNORE INTO user_roles (user_id, role, granted_at, granted_by)
            SELECT id, 'developer', ?, id
            FROM users
            WHERE id IN (1785492771018, 1785491766416, 1785483293118)
               OR LOWER(username) = 'exempale'
        `, [now]);
        await dbRun(mainDb, `
            INSERT OR IGNORE INTO user_roles (user_id, role, granted_at, granted_by)
            SELECT id, 'moderator', ?, id
            FROM users
            WHERE id IN (
                1773530527641,
                1773532455226,
                1774965468558,
                1775762928265,
                1778956842477,
                1785492771018,
                1785523125622
            )
        `, [now]);

        await dbRun(mainDb, 'COMMIT');
        await purgeOrphanSessions();
        console.log('FortPort database migrations are ready');
    } catch (error) {
        await dbRun(mainDb, 'ROLLBACK').catch(() => {});
        throw error;
    }
}

const databaseReady = runDatabaseMigrations().catch(error => {
    console.error('FortPort database initialization failed:', error);
    throw error;
});
const { generateVerificationToken, sendVerificationEmail } = require('./config/email');
const { verifyToken } = require('./config/email');
//const { generateVerificationToken, sendVerificationEmail } = require('./config/email');
require('dotenv').config();
const { Worker } = require('worker_threads');

console.log('EMAIL_HOST:', process.env.EMAIL_HOST); // Debug: check if loaded

function validateChatId(chatId) {
    if (!/^\d+_\d+$/.test(chatId)) {
        throw new Error('Invalid chat ID format');
    }
    return chatId;
}

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again later.' }
});

const accountEmailLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Слишком много запросов. Попробуйте позже.' }
});

const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Слишком много регистраций. Попробуйте позже.' }
});

function generateShortId() {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let result;
        result = '';
        for (let i = 0; i < 11; i++) {
            result += chars[Math.floor(Math.random() * 62)];
        }
    return result;
}

// MIDDLEWARE - Order matters! Put these FIRST
app.disable('x-powered-by')
app.use((req, res, next) => {
  res.vary('Accept-Encoding')
  const originalSend = res.send.bind(res)
  res.send = function compressedSend(body) {
    if (
      req.method !== 'HEAD' &&
      body != null &&
      !res.getHeader('Content-Encoding') &&
      /\bgzip\b/.test(req.headers['accept-encoding'] || '')
    ) {
      const contentType = String(res.getHeader('Content-Type') || '')
      const isCompressible = /^(text\/|application\/(json|javascript|xml))/i.test(contentType)
      const source = Buffer.isBuffer(body) ? body : Buffer.from(String(body))
      if (isCompressible && source.length >= 1024) {
            const compressed = zlib.gzipSync(source, { level: zlib.constants.Z_BEST_SPEED })
        res.setHeader('Content-Type', contentType)
        res.setHeader('Content-Encoding', 'gzip')
        res.setHeader('Content-Length', compressed.length)
        return originalSend(compressed)
      }
    }
    return originalSend(body)
  }
  next()
})
app.use(express.json({ limit: '2mb' }))
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})
const blockedStaticRoots = new Set([
  'backups',
  'config',
  'node_modules',
  'ssl',
  '.git',
  '.workbuddy-ai'
])
const blockedStaticFiles = new Set([
  '.env',
  '.db',
  'package.json',
  'package-lock.json',
  'server.js',
  'cluster.js',
  'readme.md',
  'news.txt'
])
app.use((req, res, next) => {
  let pathname
  try {
    pathname = decodeURIComponent(req.path)
  } catch (error) {
    return res.status(400).end()
  }
  const segments = pathname.split('/').filter(Boolean)
  const firstSegment = segments[0] || ''
  const basename = segments[segments.length - 1] || ''
  const isApiDatabaseFile = firstSegment === 'api' && /\.(?:db(?:-shm|-wal)?)$/i.test(basename)
  if (
    blockedStaticRoots.has(firstSegment) ||
    blockedStaticFiles.has(basename) ||
    isApiDatabaseFile ||
    /\.(?:db(?:-shm|-wal)?|key|crt)$/i.test(basename)
  ) {
    return res.status(404).end()
  }
  next()
})
app.use(async (req, res, next) => {
  if (
    req.method !== 'GET' ||
    !/\bgzip\b/.test(req.headers['accept-encoding'] || '') ||
    !/\.(?:css|js)$/i.test(req.path)
  ) {
    return next()
  }

  try {
    const relativePath = decodeURIComponent(req.path).replace(/^\/+/, '')
    const absolutePath = path.resolve(__dirname, relativePath)
    const workspaceRoot = path.resolve(__dirname) + path.sep
    if (!absolutePath.startsWith(workspaceRoot)) return res.status(404).end()

    const source = await fs.promises.readFile(absolutePath)
    if (source.length < 1024) return next()

    const extension = path.extname(absolutePath).toLowerCase()
    const contentType = extension === '.css'
      ? 'text/css; charset=utf-8'
      : 'application/javascript; charset=utf-8'
    const etag = `W/\"${source.length.toString(16)}-${crypto.createHash('sha1').update(source).digest('hex').slice(0, 16)}\"`
    if (req.headers['if-none-match'] === etag) return res.status(304).end()

    const compressed = zlib.gzipSync(source, { level: zlib.constants.Z_BEST_SPEED })
    res.status(200)
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Encoding', 'gzip')
    res.setHeader('Content-Length', compressed.length)
    res.setHeader('Cache-Control', 'no-cache, must-revalidate')
    res.setHeader('ETag', etag)
    res.end(compressed)
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return next()
    next(error)
  }
})
app.use(express.static(__dirname, {
  etag: true,
  lastModified: true,
  maxAge: 0,
  setHeaders: (res, filePath) => {
    const extension = path.extname(filePath).toLowerCase()
    if (['.webp', '.jpg', '.jpeg', '.png', '.gif', '.ico', '.svg', '.woff', '.woff2'].includes(extension)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400')
    } else if (['.js', '.css'].includes(extension)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate')
    } else if (extension === '.html') {
      res.setHeader('Cache-Control', 'no-cache')
    }
  }
}))

// Route-specific in-memory upload limits. MIME is only the first gate;
// image uploads are also decoded by Sharp (and GIF signatures checked) before persistence.
const uploadMedia = createMemoryUpload({
  maxFileSize: 50 * 1024 * 1024,
  allowedMime: mime => mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')
});
const uploadImage = createMemoryUpload({
  maxFileSize: 10 * 1024 * 1024,
  allowedMime: mime => SUPPORTED_IMAGE_MIME_TYPES.has(mime)
});
const uploadAudio = createMemoryUpload({
  maxFileSize: 25 * 1024 * 1024,
  allowedMime: mime => mime.startsWith('audio/')
});
const uploadUserBackground = uploadImage;

const cookieParser = require('cookie-parser')
// Add this after your other middleware
app.use(cookieParser())

async function verifyCommunityAccess(req, res, next) {
  const communityId = parseInt(req.params.id);
  const userId = req.userId;
  
  mainDb.get(`
    SELECT c.owner_id, 
           (SELECT COUNT(*) FROM community_moderators WHERE community_id = c.id AND user_id = ?) as is_moderator
    FROM communities c
    WHERE c.id = ?
  `, [userId, communityId], (err, community) => {
    if (err || !community) {
      return res.status(404).json({ error: 'Not found' });
    }
    
    const isOwner = community.owner_id === userId;
    const isModerator = community.is_moderator > 0;
    
    if (!isOwner && !isModerator) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    next();
  });
}

async function authenticate(req, res, next) {
  try {
    await databaseReady;
  } catch (error) {
    console.error('Database initialization failed:', error);
    return res.status(503).json({ error: 'Service is initializing' });
  }

  const sessionId = req.cookies.sessionId;
  
  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  sessionsDb.get(`
    SELECT user_id, expires_at FROM sessions 
    WHERE session_id = ? AND expires_at > ?
  `, [sessionId, Date.now()], async (err, row) => {
    if (err || !row) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    try {
      if (!(await userExists(row.user_id))) {
        sessionsDb.run('DELETE FROM sessions WHERE session_id = ?', [sessionId], deleteErr => {
          if (deleteErr) console.error('Failed to remove orphan session:', deleteErr);
        });
        res.clearCookie('sessionId');
        return res.status(401).json({ error: 'Account no longer exists. Sign in again.' });
      }
    } catch (lookupError) {
      console.error('Failed to validate session user:', lookupError);
      return res.status(500).json({ error: 'Failed to validate session' });
    }
    
    const newExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    sessionsDb.run(`
      UPDATE sessions 
      SET expires_at = ? 
      WHERE session_id = ?
    `, [newExpiry, sessionId], (updateErr) => {
      if (updateErr) {
        console.error('Failed to extend session:', updateErr);
      }
      
      req.userId = row.user_id;
      next();
    });
  });
}



// Optional: middleware that doesn't block unauthenticated users
async function optionalAuth(req, res, next) {
    try {
        await databaseReady;
    } catch (error) {
        console.error('Database initialization failed:', error);
        return res.status(503).json({ error: 'Service is initializing' });
    }

    const sessionId = req.cookies.sessionId;
    
    if (sessionId) {
        sessionsDb.get(`
            SELECT user_id FROM sessions 
            WHERE session_id = ? AND expires_at > ?
        `, [sessionId, Date.now()], async (err, row) => {
            if (!err && row) {
                try {
                    if (await userExists(row.user_id)) {
                        req.userId = row.user_id;
                    } else {
                        sessionsDb.run('DELETE FROM sessions WHERE session_id = ?', [sessionId], deleteErr => {
                            if (deleteErr) console.error('Failed to remove orphan session:', deleteErr);
                        });
                        res.clearCookie('sessionId');
                    }
                } catch (lookupError) {
                    console.error('Failed to validate optional session user:', lookupError);
                }
            }
            next();
        });
    } else {
        next();
    }
}

// Generate a new session
async function getUserCapabilities(userId) {
    const [admin, roles] = await Promise.all([
        dbGet(mainDb, 'SELECT 1 FROM admins WHERE user_id = ?', [userId]),
        dbAll(mainDb, 'SELECT role FROM user_roles WHERE user_id = ? ORDER BY role', [userId])
    ]);
    const roleNames = roles.map(row => row.role);
    const isOwner = roleNames.includes('owner') || Number(userId) === 1773499483205;
    const isDeveloper = roleNames.includes('developer');
    const isModerator = roleNames.includes('moderator');
    const displayRole = isOwner ? 'owner' : isDeveloper ? 'developer' : isModerator ? 'moderator' : null;
    return {
        isAdmin: Boolean(admin) || isOwner,
        isOwner,
        isDeveloper,
        isModerator,
        displayRole,
        roles: roleNames
    };
}

function getDisplayRoleFromFlags({ userId, isOwner, isDeveloper, isModerator }) {
    if (isOwner || Number(userId) === 1773499483205) return 'owner';
    if (isDeveloper) return 'developer';
    if (isModerator) return 'moderator';
    return null;
}

function getPublicRoleDto({ userId, isOwner, isDeveloper, isModerator }) {
    const displayRole = getDisplayRoleFromFlags({ userId, isOwner, isDeveloper, isModerator });
    return {
        isOwner: displayRole === 'owner',
        isDeveloper: Boolean(isDeveloper),
        isModerator: Boolean(isModerator),
        displayRole
    };
}

async function getPublicRoleForUser(userId) {
    if (!Number.isSafeInteger(Number(userId))) return getPublicRoleDto({ userId: null });
    const roles = await dbAll(mainDb, 'SELECT role FROM user_roles WHERE user_id = ?', [Number(userId)]);
    const roleNames = roles.map(row => row.role);
    return getPublicRoleDto({
        userId: Number(userId),
        isOwner: roleNames.includes('owner'),
        isDeveloper: roleNames.includes('developer'),
        isModerator: roleNames.includes('moderator')
    });
}

async function addPublicRoles(items) {
    const list = Array.isArray(items) ? items : [];
    const ids = [...new Set(list.map(item => Number(item.id ?? item.userId)).filter(Number.isSafeInteger))];
    if (ids.length === 0) return list;
    const placeholders = ids.map(() => '?').join(',');
    const rows = await dbAll(mainDb, `SELECT user_id, role FROM user_roles WHERE user_id IN (${placeholders})`, ids);
    const roleMap = new Map(ids.map(id => [id, new Set()]));
    rows.forEach(row => roleMap.get(Number(row.user_id))?.add(row.role));
    return list.map(item => {
        const id = Number(item.id ?? item.userId);
        const roles = roleMap.get(id) || new Set();
        return {
            ...item,
            ...getPublicRoleDto({
                userId: id,
                isOwner: roles.has('owner'),
                isDeveloper: roles.has('developer'),
                isModerator: roles.has('moderator')
            })
        };
    });
}

async function isDeveloper(userId) {
    const row = await dbGet(mainDb, `
        SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'developer'
    `, [userId]);
    return Boolean(row);
}

async function requireDeveloper(req, res, next) {
    try {
        if (!(await isDeveloper(req.userId))) {
            return res.status(403).json({ error: 'Developer access required' });
        }
        next();
    } catch (error) {
        console.error('Developer authorization failed:', error);
        res.status(500).json({ error: 'Server error' });
    }
}

async function requireModerator(req, res, next) {
    try {
        const capabilities = await getUserCapabilities(req.userId);
        if (!capabilities.isAdmin && !capabilities.isDeveloper && !capabilities.isModerator) {
            return res.status(403).json({ error: 'Moderator access required' });
        }
        req.capabilities = capabilities;
        next();
    } catch (error) {
        console.error('Moderator authorization failed:', error);
        res.status(500).json({ error: 'Server error' });
    }
}

async function createSession(userId) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  
  return new Promise((resolve, reject) => {
    sessionsDb.run(`
      INSERT INTO sessions (session_id, user_id, expires_at)
      VALUES (?, ?, ?)
    `, [sessionId, userId, expiresAt], (err) => {
      if (err) reject(err);
      else resolve(sessionId);
    });
  });
}

async function touchSession(sessionId) {
  const newExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 more days
  
  return new Promise((resolve, reject) => {
    sessionsDb.run(`
      UPDATE sessions 
      SET expires_at = ? 
      WHERE session_id = ?
    `, [newExpiry, sessionId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Delete session on logout
async function deleteSession(sessionId) {
  return new Promise((resolve, reject) => {
    sessionsDb.run(`DELETE FROM sessions WHERE session_id = ?`, [sessionId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ============ FETCH POSTS ============

async function fetchPosts({
    userId = -1,
    communityId = -1,
    before = -1,
    limit = 50,
    currentUserId = 0,
    postId = null,
    timeSpan = '',
    sortBy = ''
}) {
    limit = Math.max(1, Math.min(200, parseInt(limit) || 50));

    let viewerCanSeeHidden = false;
    if (Number(currentUserId) > 0) {
        try {
            const capabilities = await getUserCapabilities(Number(currentUserId));
            viewerCanSeeHidden = capabilities.isAdmin || capabilities.isDeveloper;
        } catch (error) {
            console.error('Failed to load feed capabilities:', error);
        }
    }

    const where = [];
    const postParams = [];
    if (!viewerCanSeeHidden) {
        where.push(`NOT EXISTS (
            SELECT 1 FROM post_moderation_state pms
            WHERE pms.post_id = p.id AND pms.hidden = 1
        )`);
    }

    if (postId !== null && postId !== undefined && postId !== -1) {
        where.push("p.id = ?");
        postParams.push(Number(postId));
        limit = 1; // Force limit to 1 when fetching single post
    } else {
	if (userId == 'not_friends' && communityId == 'not_subscriptions') {
    const rawFriends = await getFriends(currentUserId);
    const friendIds = rawFriends.map(f => f.id);
    const rawCommunities = await getCommunities(currentUserId);
    const commIds = rawCommunities.map(c => c.id);
    
    const conditions = [];
    
    // 1. Not friends
    if (friendIds.length > 0) {
        conditions.push(`p.user_id IS NOT ${currentUserId} AND p.user_id NOT IN (${friendIds.join(', ')})`);
    }
    
    // 2. Community is NULL OR not subscribed
    if (commIds.length > 0) {
        conditions.push(`(p.community_id IS NULL OR p.community_id NOT IN (${commIds.join(', ')}))`);
    } else {
        conditions.push(`p.community_id IS NULL`);
    }
    
    where.push(conditions.join(' AND '));
    where.push(`NOT EXISTS (SELECT user_id
                FROM post_likes
                WHERE user_id=${Number(currentUserId)} AND post_id=p.id)`)
} else if (userId == 'friends') {
            const rawFriends = await getFriends(currentUserId);
            const friendIds = rawFriends.map(f => f.id);
	    const friendClause = friendIds.join(', '); 
            where.push("p.user_id IN (" + friendClause + ") AND p.community_id IS NULL");
            where.push("p.is_anonymous = 0");

        } else if (communityId == 'subscriptions') {
            const rawCommunities = await getCommunities(currentUserId);
            const commIds = rawCommunities.map(c => c.id);
	    const commClause = commIds.join(', '); 
            where.push("p.community_id IN (" + commClause + ")");

        } else if (userId !== -1) {
            where.push("p.user_id = ?");
            where.push("p.is_anonymous = 0");
            postParams.push(userId);
        } else if (communityId !== -1) {
            where.push("p.community_id = ?");
            postParams.push(communityId);
        } else {
            where.push("p.show_in_feed = 1");
        }

        if (before !== -1 && before !== null && before !== undefined) {
            where.push("p.id < ?");
            postParams.push(Number(before));
        }
    }
    
	let order = "BY p.created_at DESC"
    
    if (timeSpan == '24h') {where.push("datetime(p.created_at, 'unixepoch') >= datetime('now', '-24 hours')")}
    else if (timeSpan == 'week') {where.push("datetime(p.created_at, 'unixepoch') >= datetime('now', '-7 days')")}
    else if (timeSpan == 'month') {where.push("datetime(p.created_at, 'unixepoch') >= datetime('now', '-30 days')")}
    else if (timeSpan == '6months') {where.push("datetime(p.created_at, 'unixepoch') >= datetime('now', '-6 months')")}
    else if (timeSpan == 'year') {where.push("datetime(p.created_at, 'unixepoch') >= datetime('now', '-1 year')")}
	
    if (sortBy == 'new') {} 
	else if (sortBy == 'popular') {
		order = "BY like_count DESC"
	}


    const query = `
        SELECT
            p.id,
            p.user_id,
            p.content,
            p.is_anonymous,
            p.created_at,
            p.community_id,
            p.is_spoiler,
            p.is_nsfw,
            p.spoiler_preview,
            EXISTS(
                SELECT 1 FROM user_roles ur
                WHERE ur.user_id = p.user_id AND ur.role = 'developer'
            ) AS is_developer,
            EXISTS(
                SELECT 1 FROM user_roles ur
                WHERE ur.user_id = p.user_id AND ur.role = 'moderator'
            ) AS is_moderator,
            EXISTS(
                SELECT 1 FROM user_roles ur
                WHERE ur.user_id = p.user_id AND ur.role = 'owner'
            ) AS is_owner,
            EXISTS(
                SELECT 1 FROM profile_pinned_posts ppp
                WHERE ppp.post_id = p.id AND ppp.user_id = p.user_id
            ) AS is_pinned,
            EXISTS(
                SELECT 1 FROM post_moderation_state pms
                WHERE pms.post_id = p.id AND pms.hidden = 1
            ) AS is_hidden,
	
		(
	        SELECT COUNT(*)
	        FROM post_likes pl
	        WHERE pl.post_id = p.id
	    ) AS like_count,

            CASE
                WHEN p.is_anonymous = 0 THEN u.username
                ELSE NULL
            END AS username,

            u.profile_picture,

            (
                SELECT json_group_array(
                    json_object(
                        'file_path',file_path,
                        'file_type',file_type,
                        'file_order',file_order,
                        'display_name', COALESCE(
                            display_name,
                            CASE
                                WHEN file_path GLOB '/audio/[0-9]*'
                                THEN (SELECT name FROM audio WHERE id = CAST(REPLACE(file_path, '/audio/', '') AS INTEGER))
                                ELSE NULL
                            END
                        ),
                        'media_id', CASE
                            WHEN file_path GLOB '/photo/[0-9]*'
                            THEN CAST(REPLACE(file_path, '/photo/', '') AS INTEGER)
                            WHEN file_path GLOB '/video/[0-9]*'
                            THEN CAST(REPLACE(file_path, '/video/', '') AS INTEGER)
                            WHEN file_path GLOB '/audio/[0-9]*'
                            THEN CAST(REPLACE(file_path, '/audio/', '') AS INTEGER)
                            ELSE NULL
                        END
                    )
                )
                FROM post_files
                WHERE post_id=p.id
                ORDER BY file_order
            ) AS files_json,

            (
                SELECT json_group_array(user_id)
                FROM post_likes
                WHERE post_id=p.id
            ) AS likes_json,


            (
                SELECT json_group_array(user_id)
                FROM post_dislikes
                WHERE post_id=p.id
            ) AS dislikes_json,

            (
                SELECT json_group_array(
                    json_object(
                        'id',c.id,
                        'user_id',c.user_id,
                        'username',cu.username,
                        'profile_picture',cu.profile_picture,
                        'is_developer', EXISTS(
                            SELECT 1 FROM user_roles cur
                            WHERE cur.user_id = c.user_id AND cur.role = 'developer'
                        ),
                        'is_moderator', EXISTS(
                            SELECT 1 FROM user_roles cur
                            WHERE cur.user_id = c.user_id AND cur.role = 'moderator'
                        ),
                        'is_owner', EXISTS(
                            SELECT 1 FROM user_roles cur
                            WHERE cur.user_id = c.user_id AND cur.role = 'owner'
                        ),
                        'content',c.content,
                        'reference',c.parent_comment_id,
                        'is_spoiler',c.is_spoiler,
                        'attachment',c.attachment_path,
                        'attachment_type',c.attachment_type,
                        'attachment_media_id', CASE
                            WHEN c.attachment_path GLOB '/photo/[0-9]*'
                            THEN CAST(REPLACE(c.attachment_path, '/photo/', '') AS INTEGER)
                            ELSE NULL
                        END,
                        'created_at',c.created_at,

                        'like_count',
                        (
                            SELECT COUNT(*)
                            FROM comment_likes cl
                            WHERE cl.comment_id=c.id
                        ),

                        'user_liked',
                        EXISTS(
                            SELECT cl.user_id
                            FROM comment_likes cl
                            WHERE cl.comment_id=c.id
                            AND cl.user_id=${Number(currentUserId)}
                        )
                    )
                )
                FROM comments c
                LEFT JOIN users cu
                    ON cu.id=c.user_id
                WHERE c.post_id=p.id
            ) AS comments_json,
            (
                SELECT json_object(
                    'id', poll.id,
                    'title', poll.title,
                    'multiChoice', poll.multiple_choice,
                    'expiresAt', poll.expires_at,
                    'choices', (
                        SELECT json_group_array(
                            json_object(
                                'id', pc.id,
                                'text', pc.content,
                                'image', pc.image_path,
                                'votes', (
                                    SELECT COUNT(*)
                                    FROM poll_votes pv
                                    WHERE pv.choice_id = pc.id
                                ),
                                'userVoted', (
                                    SELECT COUNT(*) > 0
                                    FROM poll_votes pv
                                    WHERE pv.choice_id = pc.id
                                    AND pv.user_id = ${Number(currentUserId)}
                                )
                            )
                            ORDER BY pc.choice_order
                        )
                        FROM poll_choices pc
                        WHERE pc.poll_id = poll.id
                    ),
                    'totalVotes', (
    SELECT COUNT(DISTINCT pv.user_id)
    FROM poll_votes pv
    JOIN poll_choices pc ON pc.id = pv.choice_id
    WHERE pc.poll_id = poll.id
)
                )
                FROM polls poll
                WHERE poll.post_id = p.id
            ) AS poll_json

        FROM posts p
        LEFT JOIN users u ON u.id = p.user_id
        WHERE ${where.join(" AND ")}
        ORDER ${order}
        LIMIT ${limit}
    `;

    return new Promise((resolve, reject) => {

        mainDb.all(query, postParams, (err, rows) => {

            if (err)
                return reject(err);

            const posts = rows.map(row => {

                let files = [];
                let fileTypes = [];
                let fileIds = [];
                let fileNames = [];
                let likes = [];
                let dislikes = [];
                let comments = [];
                let poll = null;

                try {
                    const arr = JSON.parse(row.files_json || "[]");
                    files = arr.map(f => f.file_path);
                    fileTypes = arr.map(f => f.file_type);
                    fileIds = arr.map(f => f.media_id || null);
                    fileNames = arr.map(f => f.display_name || null);
                } catch {}

                try {
                    likes = JSON.parse(row.likes_json || "[]");
                } catch {}

                try {
                    dislikes = JSON.parse(row.dislikes_json || "[]");
                } catch {}

                try {
                    comments = JSON.parse(row.comments_json || "[]");
                } catch {}

                try {
                    poll = JSON.parse(row.poll_json || "null");
                } catch {}

                return {

                    id: row.id,

                    userId:
                        row.is_anonymous
                            ? null
                            : row.user_id,

                    username: row.username,
                    ...getPublicRoleDto({
                        userId: row.user_id,
                        isOwner: Boolean(row.is_owner),
                        isDeveloper: Boolean(row.is_developer),
                        isModerator: Boolean(row.is_moderator)
                    }),
                    isPinned: Boolean(row.is_pinned),
                    isHidden: Boolean(row.is_hidden),

                    content: row.content,

                    files,
                    fileTypes,
                    fileIds,
                    fileNames,

                    community:
                        row.community_id
                            ? String(row.community_id)
                            : "",

                    isAnonymous:
                        row.is_anonymous === 1,

                    createdAt:
                        new Date(row.created_at * 1000).toISOString(),

                    likes: likes.includes(currentUserId) ? [currentUserId] : [],
                    likeCount: likes.length,

                    dislikes,
                    dislikeCount: dislikes.length,

                    spoiler: !!row.is_spoiler,
                    nsfw: !!row.is_nsfw,
                    spoilerPreview: row.spoiler_preview || "",

                    poll: poll,

                    comments: comments.map(c => ({
                        id: c.id,
                        userId: c.user_id,
                        username: c.username,
                        profilePicture: c.profile_picture,
                        ...getPublicRoleDto({
                            userId: c.user_id,
                            isOwner: Boolean(c.is_owner),
                            isDeveloper: Boolean(c.is_developer),
                            isModerator: Boolean(c.is_moderator)
                        }),
                        content: c.content,
                        reference: c.reference,
                        isSpoiler: Boolean(c.is_spoiler),
                        attachment: c.attachment,
                        attachmentType: c.attachment_type,
                        attachmentMediaId: c.attachment_media_id || null,
                        createdAt: new Date(c.created_at * 1000).toISOString(),
                        likeCount: c.like_count || 0,
                        likes: c.user_liked ? [currentUserId] : []
                    }))
                };

            });

            resolve({
                posts,
                nextPostId:
                    posts.length === limit
                        ? posts[posts.length - 1].id
                        : null
            });

        });

    });
}

// ============ NOTIFICATION HELPER FUNCTIONS ============

async function createNotification(userId, type, source) {
    const validTypes = ['comment_on_post', 'reply_to_comment', 'like_on_post', 'like_on_comment', 'friend_request', 'friend_request_accepted'];
    if (!validTypes.includes(type)) {
        console.error('Invalid notification type:', type);
        return null;
    }

    const numericUserId = Number(userId);
    try {
        if (!(await userExists(numericUserId))) {
            console.warn(`Notification skipped: user ${userId} no longer exists`);
            return null;
        }

        const result = await dbRun(mainDb, `
            INSERT INTO user_notifications (user_id, time_created_at, notification_type, source)
            SELECT ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)
        `, [
            numericUserId,
            Math.floor(Date.now() / 1000),
            type,
            String(source),
            numericUserId
        ]);

        if (!result.changes) return null;
        console.log(`Notification created: ${type} for user ${numericUserId} from source ${source}`);
        notifyNotificationClient(numericUserId, {
            type: 'new_notification',
            notificationId: result.lastID
        });
        return result.lastID;
    } catch (error) {
        console.error('Error creating notification:', {
            userId: numericUserId,
            type,
            source,
            code: error.code,
            message: error.message
        });
        return null;
    }
}


// Clean up expired sessions periodically
setInterval(() => {
  sessionsDb.run(`DELETE FROM sessions WHERE expires_at < ?`, [Date.now()]);
  console.log('🧹 Cleaned up expired sessions');
}, 60 * 60 * 1000); // Every hour

// ============ HTML ROUTES ============
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'main.html'))
})

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'))
})

app.get('/login', (req, res) => { 
  res.sendFile(path.join(__dirname, 'login.html'))
})

app.get('/communities', (req, res) => {
  res.sendFile(path.join(__dirname, 'communities.html'))
})

app.get('/chats', (req, res) => {
  res.sendFile(path.join(__dirname, 'chats.html'))
})

app.get('/friends', (req, res) => {
  res.sendFile(path.join(__dirname, 'friends.html'))
})

app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'profile.html'))
})

app.get('/modspace', (req, res) => {
  res.sendFile(path.join(__dirname, 'modspace.html'))
})

app.get('/community/settings', (req, res) => {
    res.sendFile(path.join(__dirname, 'community_settings.html'));
});

app.get('/community', (req, res) => {
  res.sendFile(path.join(__dirname, 'community.html'))
})

app.get('/new_community', (req, res) => {
  res.sendFile(path.join(__dirname, 'new_community.html'))
})

app.get('/mobile/new_community', (req, res) => {
  res.sendFile(path.join(__dirname, 'new_community_mobile.html'))
})

app.get('/mobile/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login_mobile.html'))
})

app.get('/mobile/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'register_mobile.html'))
})

app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'settings.html'))
})

app.get('/support', (req, res) => {
  res.sendFile(path.join(__dirname, 'support.html'))
})

app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, 'about.html'))
})

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'privacy.html'))
})

app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'terms.html'))
})


app.get('/audios', (req, res) => {
  res.sendFile(path.join(__dirname, 'audios.html'))
})

// ============================================================
// PHOTO ROUTES
// ============================================================

// 1. Serve the actual image file - for <img src="/photo/123">
app.get('/photo/:id', async (req, res) => {
    try {
        const photoId = parseInt(req.params.id);
        const photo = await new Promise((resolve) => {
            mainDb.get('SELECT file_path FROM photos WHERE id = ?', [photoId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!photo) return res.status(404).send('Photo not found');
        
        const ext = path.extname(photo.file_path).toLowerCase();
        const contentTypes = {
            '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
            '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'
        };
        res.setHeader('Content-Type', contentTypes[ext] || 'image/jpeg');
        res.sendFile(path.join(__dirname, photo.file_path));
        
    } catch (error) {
        console.error('Photo serve error:', error);
        res.status(500).send('Server error');
    }
});

// 2. JSON metadata - for client-side fetching
app.get('/api/photo/:id', optionalAuth, async (req, res) => {
    try {
        const photoId = parseInt(req.params.id);
        const currentUserId = req.userId || null;
        
        const photo = await new Promise((resolve, reject) => {
            mainDb.get(`
                SELECT 
                    p.id, p.file_path, p.uploaded_by, p.created_at,
                    u.username, u.profile_picture
                FROM photos p
                LEFT JOIN users u ON p.uploaded_by = u.id
                WHERE p.id = ?
            `, [photoId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!photo) return res.status(404).json({ error: 'Photo not found' });
        
        // Check if this photo is in a post or comment
        let postInfo = await new Promise((resolve) => {
            mainDb.get(`
                SELECT pf.post_id, posts.content as post_content, posts.is_anonymous
                FROM post_files pf
                JOIN posts ON pf.post_id = posts.id
                WHERE pf.file_path = ?
            `, [`/photo/${photoId}`], (err, row) => {
                resolve(row);
            });
        });
        
        // If not in a post, check comments
        if (!postInfo) {
            postInfo = await new Promise((resolve) => {
                mainDb.get(`
                    SELECT c.post_id, posts.content as post_content, posts.is_anonymous
                    FROM comments c
                    JOIN posts ON c.post_id = posts.id
                    WHERE c.attachment_path = ?
                `, [`/photo/${photoId}`], (err, row) => {
                    resolve(row);
                });
            });
        }
        
        // Check if current user has this photo saved
        let isSaved = false;
        let albumType = null;
        if (currentUserId) {
            const isGif = photo.file_path && photo.file_path.endsWith('.gif');
            const albumTitle = isGif ? 'GIF-ки' : 'Фотографии';
            albumType = isGif ? 'gif' : 'photo';
            
            const album = await new Promise((resolve) => {
                mainDb.get(`
                    SELECT id FROM user_photo_albums 
                    WHERE user_id = ? AND title LIKE ?
                `, [currentUserId, albumTitle + ' %'], (err, row) => {
                    resolve(row);
                });
            });
            
            if (album) {
                const saved = await new Promise((resolve) => {
                    mainDb.get(`
                        SELECT 1 FROM album_photos 
                        WHERE album_id = ? AND photo_id = ?
                    `, [album.id, photoId], (err, row) => {
                        resolve(row);
                    });
                });
                isSaved = !!saved;
            }
        }
        
        const publicRole = await getPublicRoleForUser(photo.uploaded_by);
        res.json({
            id: photo.id,
            url: `/photo/${photoId}`,
            pageUrl: `/photo/${photoId}/page`,
            uploadedBy: photo.uploaded_by,
            username: photo.username || 'Unknown',
            profilePicture: photo.profile_picture,
            ...publicRole,
            createdAt: new Date(photo.created_at * 1000).toISOString(),
            postId: postInfo?.post_id || null,
            postContent: postInfo?.post_content || null,
            isAnonymous: postInfo?.is_anonymous || 0,
            isSaved: isSaved,
            isGif: photo.file_path && photo.file_path.endsWith('.gif')
        });
        
    } catch (error) {
        console.error('API photo error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 3. HTML page with OG metadata - for social sharing
app.get('/photo/:id/page', optionalAuth, async (req, res) => {
    try {
        const photoId = parseInt(req.params.id);
        
        const photo = await new Promise((resolve, reject) => {
            mainDb.get(`
                SELECT p.id as photo_id, p.file_path, p.uploaded_by, p.created_at,
                       pf.post_id, posts.content as post_content, posts.is_anonymous,
                       u.username, u.profile_picture
                FROM photos p
                JOIN post_files pf ON p.id = CAST(REPLACE(pf.file_path, '/photo/', '') AS INTEGER)
                JOIN posts ON pf.post_id = posts.id
                LEFT JOIN users u ON p.uploaded_by = u.id
                WHERE p.id = ?
            `, [photoId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!photo) return res.status(404).sendFile(path.join(__dirname, '404.html'));
        
        const siteUrl = 'https://fortport.ru';
        const imageUrl = `${siteUrl}/photo/${photoId}`;
        const title = photo.is_anonymous ? 'Анонимная публикация' : `Фото от ${photo.username}`;
        const description = photo.post_content ? 
            photo.post_content.substring(0, 150) + (photo.post_content.length > 150 ? '…' : '') : 
            'Фотография на ФортПорте';
        
        let html = fs.readFileSync(path.join(__dirname, 'photo.html'), 'utf8');
        
        const metadata = `
            <title>${escapeHtml(title)}</title>
            <meta name="description" content="${escapeHtml(description)}">
            <meta property="og:type" content="image">
            <meta property="og:url" content="${siteUrl}/photo/${photoId}/page">
            <meta property="og:title" content="${escapeHtml(title)}">
            <meta property="og:description" content="${escapeHtml(description)}">
            <meta property="og:image" content="${escapeHtml(imageUrl)}">
            <meta name="twitter:card" content="summary_large_image">
            <meta name="twitter:title" content="${escapeHtml(title)}">
            <meta name="twitter:description" content="${escapeHtml(description)}">
            <meta name="twitter:image" content="${escapeHtml(imageUrl)}">
            <script>window.PHOTO_ID = ${photoId};</script>
        `;
        
        html = html.replace('</head>', `${metadata}\n</head>`);
        res.send(html);
        
    } catch (error) {
        console.error('Photo page error:', error);
        res.status(500).send('Server error');
    }
});

app.post('/api/photos/save', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const { photoId } = req.body;
        
        if (!photoId) {
            return res.status(400).json({ error: 'photoId required' });
        }
        
        // Check if photo exists and get its type
        const photo = await new Promise((resolve) => {
            mainDb.get('SELECT id, file_path, created_at FROM photos WHERE id = ?', [photoId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!photo) {
            return res.status(404).json({ error: 'Photo not found' });
        }
        
        // Determine if it's a GIF or regular image
        const isGif = photo.file_path && photo.file_path.endsWith('.gif');
        const albumTitle = isGif ? `GIF-ки` : `Фотографии`;
        
        // Get or create the user's appropriate system album.
        const owner = await dbGet(mainDb, 'SELECT username FROM users WHERE id = ?', [userId]);
        if (!owner) {
            return res.status(404).json({ error: 'User not found' });
        }

        let album = await dbGet(mainDb, `
            SELECT id FROM user_photo_albums
            WHERE user_id = ? AND title LIKE ?
            ORDER BY is_system DESC, id ASC
            LIMIT 1
        `, [userId, albumTitle + ' %']);

        if (!album) {
            const createdAt = Math.floor(Date.now() / 1000);
            const result = await dbRun(mainDb, `
                INSERT INTO user_photo_albums (user_id, title, created_at, is_system)
                VALUES (?, ?, ?, 1)
            `, [userId, `${albumTitle} ${owner.username}`, createdAt]);
            album = { id: result.lastID };
        }
        
        // Check if already in album
        const existing = await new Promise((resolve) => {
            mainDb.get(`
                SELECT 1 FROM album_photos 
                WHERE album_id = ? AND photo_id = ?
            `, [album.id, photoId], (err, row) => {
                resolve(row);
            });
        });
        
        if (existing) {
            return res.json({ success: true, alreadySaved: true, isGif: isGif });
        }
        
        // Add to album
        await new Promise((resolve, reject) => {
            mainDb.run(`
                INSERT OR IGNORE INTO album_photos (album_id, photo_id, added_by, added_at)
                VALUES (?, ?, ?, ?)
            `, [album.id, photoId, userId, Math.floor(Date.now() / 1000)], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        res.json({ success: true, isGif: isGif });
        
    } catch (error) {
        console.error('Save photo error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/photo/:id - Delete a photo
app.delete('/api/photo/:id', authenticate, async (req, res) => {
    try {
        const photoId = parseInt(req.params.id);
        const userId = req.userId;
        
        // Check if user owns the photo
        const photo = await new Promise((resolve) => {
            mainDb.get('SELECT uploaded_by, file_path FROM photos WHERE id = ?', [photoId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!photo) {
            return res.status(404).json({ error: 'Photo not found' });
        }
        
        if (photo.uploaded_by !== userId) {
            return res.status(403).json({ error: 'Not authorized to delete this photo' });
        }
        
        // Delete from album_photos
        await new Promise((resolve) => {
            mainDb.run('DELETE FROM album_photos WHERE photo_id = ?', [photoId], (err) => {
                resolve();
            });
        });
        
        // Delete from post_files
        await new Promise((resolve) => {
            mainDb.run('DELETE FROM post_files WHERE file_path = ?', [`/photo/${photoId}`], (err) => {
                resolve();
            });
        });
        
        // Delete only files inside FortPort-managed media directories.
        deleteManagedMediaFile(photo.file_path);
        
        // Delete from photos table
        await new Promise((resolve, reject) => {
            mainDb.run('DELETE FROM photos WHERE id = ?', [photoId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Delete photo error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


// ============================================================
// VIDEO ROUTES - Same pattern
// ============================================================

// 1. Serve the actual video file
app.get('/video/:id', async (req, res) => {
    try {
        const videoId = parseInt(req.params.id);
        const video = await new Promise((resolve) => {
            mainDb.get('SELECT file_path FROM videos WHERE id = ?', [videoId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!video) return res.status(404).send('Video not found');
        
        res.setHeader('Content-Type', 'video/mp4');
        res.sendFile(path.join(__dirname, video.file_path));
        
    } catch (error) {
        console.error('Video serve error:', error);
        res.status(500).send('Server error');
    }
});

// 2. JSON metadata
app.get('/api/video/:id', optionalAuth, async (req, res) => {
    try {
        const videoId = parseInt(req.params.id);
        
        const video = await new Promise((resolve, reject) => {
            mainDb.get(`
                SELECT 
                    v.id, v.file_path, v.title, v.description, v.uploaded_by, v.created_at,
                    pf.post_id, posts.content as post_content, posts.is_anonymous,
                    u.username, u.profile_picture
                FROM videos v
                JOIN post_files pf ON v.id = CAST(REPLACE(pf.file_path, '/video/', '') AS INTEGER)
                JOIN posts ON pf.post_id = posts.id
                LEFT JOIN users u ON v.uploaded_by = u.id
                WHERE v.id = ?
            `, [videoId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!video) return res.status(404).json({ error: 'Video not found' });
        
        res.json({
            id: video.id,
            url: `/video/${videoId}`,
            pageUrl: `/video/${videoId}/page`,
            title: video.title || '',
            description: video.description || '',
            uploadedBy: video.uploaded_by,
            username: video.is_anonymous ? null : video.username,
            createdAt: new Date(video.created_at * 1000).toISOString(),
            postId: video.post_id,
            postContent: video.post_content,
            isAnonymous: video.is_anonymous === 1
        });
        
    } catch (error) {
        console.error('API video error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 3. HTML page with OG metadata
app.get('/video/:id/page', optionalAuth, async (req, res) => {
    try {
        const videoId = parseInt(req.params.id);
        
        const video = await new Promise((resolve, reject) => {
            mainDb.get(`
                SELECT v.id as video_id, v.file_path, v.title, v.description, v.uploaded_by, v.created_at,
                       pf.post_id, posts.content as post_content, posts.is_anonymous,
                       u.username, u.profile_picture
                FROM videos v
                JOIN post_files pf ON v.id = CAST(REPLACE(pf.file_path, '/video/', '') AS INTEGER)
                JOIN posts ON pf.post_id = posts.id
                LEFT JOIN users u ON v.uploaded_by = u.id
                WHERE v.id = ?
            `, [videoId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!video) return res.status(404).sendFile(path.join(__dirname, '404.html'));
        
        const siteUrl = 'https://fortport.ru';
        const videoUrl = `${siteUrl}/video/${videoId}`;
        const title = video.is_anonymous ? 'Анонимное видео' : `Видео от ${video.username}`;
        const description = video.post_content || video.description || 'Видео на ФортПорте';
        
        let html = fs.readFileSync(path.join(__dirname, 'video.html'), 'utf8');
        
        const metadata = `
            <title>${escapeHtml(title)}</title>
            <meta name="description" content="${escapeHtml(description)}">
            <meta property="og:type" content="video.other">
            <meta property="og:url" content="${siteUrl}/video/${videoId}/page">
            <meta property="og:title" content="${escapeHtml(title)}">
            <meta property="og:description" content="${escapeHtml(description)}">
            <meta property="og:video" content="${escapeHtml(videoUrl)}">
            <meta property="og:video:type" content="video/mp4">
            <meta name="twitter:card" content="player">
            <meta name="twitter:title" content="${escapeHtml(title)}">
            <meta name="twitter:description" content="${escapeHtml(description)}">
            <meta name="twitter:player" content="${escapeHtml(videoUrl)}">
            <script>window.VIDEO_ID = ${videoId};</script>
        `;
        
        html = html.replace('</head>', `${metadata}\n</head>`);
        res.send(html);
        
    } catch (error) {
        console.error('Video page error:', error);
        res.status(500).send('Server error');
    }
});


// ============================================================
// AUDIO ROUTES - JSON only (no HTML page)
// ============================================================

// 1. Serve the actual audio file
app.get('/audio/:id', async (req, res) => {
    try {
        const audioId = parseInt(req.params.id);
        const audio = await new Promise((resolve) => {
            mainDb.get('SELECT file_path FROM audio WHERE id = ?', [audioId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!audio) return res.status(404).send('Audio not found');
        
        res.sendFile(path.join(__dirname, audio.file_path));
        
    } catch (error) {
        console.error('Audio serve error:', error);
        res.status(500).send('Server error');
    }
});

// 2. JSON metadata only
app.get('/api/audio/:id', optionalAuth, async (req, res) => {
    try {
        const audioId = parseInt(req.params.id);
        
        const audio = await new Promise((resolve, reject) => {
            mainDb.get(`
                SELECT 
                    a.id, a.file_path, a.name, a.artist_name, a.genre,
                    a.uploaded_by, a.created_at,
                    pf.post_id, posts.content as post_content, posts.is_anonymous,
                    u.username, u.profile_picture
                FROM audio a
                JOIN post_files pf ON a.id = CAST(REPLACE(pf.file_path, '/audio/', '') AS INTEGER)
                JOIN posts ON pf.post_id = posts.id
                LEFT JOIN users u ON a.uploaded_by = u.id
                WHERE a.id = ?
            `, [audioId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!audio) return res.status(404).json({ error: 'Audio not found' });
        
        res.json({
            id: audio.id,
            url: `/audio/${audioId}`,
            name: audio.name || 'Без названия',
            artistName: audio.artist_name || 'Неизвестно',
            genre: audio.genre || '',
            uploadedBy: audio.uploaded_by,
            username: audio.is_anonymous ? null : audio.username,
            createdAt: new Date(audio.created_at * 1000).toISOString(),
            postId: audio.post_id,
            postContent: audio.post_content,
            isAnonymous: audio.is_anonymous === 1
        });
        
    } catch (error) {
        console.error('API audio error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


// ============ DYNAMIC POST PAGE WITH METADATA ============
app.get('/post', optionalAuth, async (req, res) => {
    const postId = req.query.id;
    
    if (!postId) {
        return res.redirect('/');
    }
    
    try {
        // Fetch the full post data using fetchPosts with postId
        const result = await fetchPosts({
            postId: parseInt(postId),
            currentUserId: req.userId || 0
        });
        
        const post = result.posts[0];
        
        if (!post) {
            return res.status(404).sendFile(path.join(__dirname, '404.html'));
        }
        
        // --- FETCH BACKGROUND IMAGE ---
        let backgroundImage = null;
        
        // Priority 1: Community background if post is in a community
        if (post.community) {
            const community = await new Promise((resolve) => {
                mainDb.get(`
                    SELECT profile_background FROM communities WHERE id = ?
                `, [parseInt(post.community)], (err, row) => {
                    resolve(row);
                });
            });
            if (community && community.profile_background) {
                backgroundImage = community.profile_background;
            }
        }
        
        // Priority 2: User background if no community background found
        if (!backgroundImage && post.userId) {
            const user = await new Promise((resolve) => {
                mainDb.get(`
                    SELECT profile_background FROM users WHERE id = ?
                `, [post.userId], (err, row) => {
                    resolve(row);
                });
            });
            if (user && user.profile_background) {
                backgroundImage = user.profile_background;
            }
        }
        
        // Generate metadata
        let title = '';
        let description = '';
        let imageUrl = '';
        let siteName = 'ФортПорт';
        
        // Extract content preview
        if (post.content && post.content.trim()) {
            description = post.content.trim().substring(0, 150);
            if (post.content.length > 150) description += '…';
        } else {
            description = `Публикация от ${post.username || 'пользователя'}`;
        }
        
        // Set title
        if (post.content && post.content.trim()) {
            title = post.content.trim().substring(0, 60);
            if (post.content.length > 60) title += '…';
        } else {
            title = `Публикация от ${post.username || 'пользователя'} | ФортПорт`;
        }
        
        // Get first image from post files
        if (post.files && post.files.length > 0) {
            const firstFile = post.files[0];
            if (firstFile.startsWith('/photo/') || firstFile.startsWith('/images/')) {
                imageUrl = `https://fortport.ru${firstFile}`;
            }
        }
        
        if (!imageUrl) {
            imageUrl = 'https://fortport.ru/fortport-og.jpg';
        }
        
        // Read the base HTML template
        let html = fs.readFileSync(path.join(__dirname, 'post.html'), 'utf8');
        
        // Build background style
        let backgroundStyle = '';
        if (backgroundImage) {
            backgroundStyle = `
                <style>
                    body {
                        background-image: url('${backgroundImage}') !important;
                        background-size: cover !important;
                        background-position: center !important;
                        background-attachment: fixed !important;
                    }
                </style>
            `;
        }
        
        // Build metadata HTML to inject
        const metadata = `
            <!-- Primary Meta Tags -->
            <title>${escapeHtml(title)}</title>
            <meta name="title" content="${escapeHtml(title)}">
            <meta name="description" content="${escapeHtml(description)}">
            
            <!-- Open Graph / Facebook -->
            <meta property="og:type" content="article">
            <meta property="og:url" content="https://fortport.ru/post?id=${postId}">
            <meta property="og:title" content="${escapeHtml(title)}">
            <meta property="og:description" content="${escapeHtml(description)}">
            <meta property="og:image" content="${escapeHtml(imageUrl)}">
            <meta property="og:site_name" content="${escapeHtml(siteName)}">
            
            <!-- Twitter -->
            <meta property="twitter:card" content="summary_large_image">
            <meta property="twitter:url" content="https://fortport.ru/post?id=${postId}">
            <meta property="twitter:title" content="${escapeHtml(title)}">
            <meta property="twitter:description" content="${escapeHtml(description)}">
            <meta property="twitter:image" content="${escapeHtml(imageUrl)}">
            
            <!-- Additional meta tags -->
            <meta name="author" content="${escapeHtml(post.username || 'Аноним')}">
            <meta property="article:published_time" content="${post.createdAt}">
            
            ${backgroundStyle}
            
            <!-- Pass post data to JavaScript -->
            <script>
                window.POST_ID = ${postId};
                window.POST_DATA = ${JSON.stringify(post)};
                window.BACKGROUND_IMAGE = ${backgroundImage ? JSON.stringify(backgroundImage) : 'null'};
            </script>
        `;
        
        // Inject metadata into the head section
        html = html.replace('</head>', `${metadata}\n</head>`);
        
        res.send(html);
        
    } catch (error) {
        console.error('Error generating post page:', error);
        res.status(500).sendFile(path.join(__dirname, 'post.html'));
    }
});

// Helper function to escape HTML
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

app.get('/new_community', (req, res) => {
  res.sendFile(path.join(__dirname, 'new_community.html'))
})

// ============ USER ROUTES ============

app.post('/api/register', registrationLimiter, async (req, res) => {
  try {
    const { username, password, email } = req.body;
    
    if (!username || !password || !email) {
      return res.status(400).json({ success: false, error: 'Заполните все поля' });
    }
    
    if (password.length < 7) {
      return res.status(400).json({ success: false, error: 'Пароль слишком короткий' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Некорректный email' });
    }
    
    // Check if username exists
    mainDb.get(`SELECT id FROM users WHERE username = ?`, [username], async (err, existingUser) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ success: false, error: 'Server error' });
      }
      
      if (existingUser) {
        return res.status(400).json({ success: false, error: 'Имя занято' });
      }
      
      // Check if email already used
      mainDb.get(`SELECT id, email_verified FROM users WHERE email = ?`, [email], async (err, existingEmail) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ success: false, error: 'Server error' });
        }
        
        if (existingEmail) {
          return res.status(400).json({ success: false, error: 'Email уже используется' });
        }
        
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const userId = Date.now();
        const createdAt = Math.floor(Date.now() / 1000);
        
        // Insert user
        mainDb.run(`
          INSERT INTO users (id, username, email, password_hash, email_verified, created_at, profile_picture, status, searchable)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [userId, username, email, hashedPassword, 0, createdAt, null, '', 1], async function(err) {
          if (err) {
            console.error('Insert error:', err);
            return res.status(500).json({ success: false, error: 'Server error' });
          }
          
          // Generate verification token
          const token = generateVerificationToken(userId, email);
          const emailSent = await sendVerificationEmail(email, username, token, req);
          
          if (!emailSent) {
            console.error(`Failed to send verification email to ${email}`);
          }
          
          // Insert default settings. Keep callbacks attached so a constraint
          // error is logged instead of becoming an unhandled Statement event.
          mainDb.run(`INSERT INTO user_settings_privacy (user_id) VALUES (?)`, [userId], settingsErr => {
            if (settingsErr) console.error('Failed to create privacy settings:', settingsErr);
          });
          mainDb.run(`INSERT INTO user_settings_customization (user_id) VALUES (?)`, [userId], settingsErr => {
            if (settingsErr) console.error('Failed to create customization settings:', settingsErr);
          });
          
          console.log(`📧 New user registered: ${username} (${email}) - awaiting verification`);
          
          res.json({
            success: true,
            message: 'Регистрация успешна! Проверьте email для подтверждения',
            userId: userId,
            requiresVerification: true
          });
        });
      });
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.get('/api/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).send('Отсутствует токен подтверждения');
    }
    
    const payload = verifyToken(token);
    
    if (!payload) {
      return res.status(400).send('Недействительная или просроченная ссылка');
    }
    
    const { userId, email } = payload;
    
    // Check if user exists and email matches
    mainDb.get(`SELECT id, email, email_verified FROM users WHERE id = ? AND email = ?`, 
      [userId, email], async (err, user) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).send('Ошибка сервера');
        }
        
        if (!user) {
          return res.status(404).send('Пользователь не найден');
        }
        
        if (user.email_verified === 1) {
          return res.send('Email уже подтверждён. Вы можете войти.');
        }
        
        // Mark email as verified
        mainDb.run(`UPDATE users SET email_verified = 1 WHERE id = ?`, [userId], (err) => {
          if (err) {
            console.error('Update error:', err);
            return res.status(500).send('Ошибка сервера');
          }
          
          console.log(`Email verified for user ${userId}`);
          
          // Send HTML response with redirect
          res.send(`
            <html>
              <head>
                <meta http-equiv="refresh" content="3;url=/login.html">
                <style>
                  body { font-family: Arial; text-align: center; padding: 50px; background: #c7eaf5; }
                  .success { color: #4CAF50; font-size: 24px; margin-bottom: 20px; }
                  .message { color: #666; }
                </style>
              </head>
              <body>
                <div class="success">Email подтверждён!</div>
                <div class="message">Перенаправление на страницу входа...</div>
              </body>
            </html>
          `);
        });
      });
    
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).send('Ошибка сервера');
  }
});

app.post('/api/resend-verification', accountEmailLimiter, async (req, res) => {
  try {
    const { userId, email } = req.body;
    
    if (!userId || !email) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }
    
    mainDb.get(`SELECT id, username, email, email_verified FROM users WHERE id = ? AND email = ?`, 
      [userId, email], async (err, user) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ success: false, error: 'Server error' });
        }
        
        if (!user) {
          return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        }
        
        if (user.email_verified === 1) {
          return res.status(400).json({ success: false, error: 'Email уже подтверждён' });
        }
        
        const token = generateVerificationToken(userId, email);
        // FIXED: Pass req as the 4th parameter
        const emailSent = await sendVerificationEmail(email, user.username, token, req);
        
        if (!emailSent) {
          return res.status(500).json({ success: false, error: 'Не удалось отправить email' });
        }
        
        res.json({ success: true, message: 'Новое письмо отправлено' });
      });
    
  } catch (error) {
    console.error('Resend error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Login endpoint
app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { identifier, password } = req.body;
    
    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }
    
    // Check if identifier is email or username
    const isEmail = identifier.includes('@') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    
    let query, param;
    if (isEmail) {
      query = `SELECT * FROM users WHERE email = ?`;
      param = identifier;
    } else {
      query = `SELECT * FROM users WHERE username = ?`;
      param = identifier;
    }
    
    mainDb.get(query, [param], async (err, user) => {
      if (err || !user) {
        return res.status(400).json({ success: false, error: 'Неверный логин или пароль' });
      }
      
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(400).json({ success: false, error: 'Неверный логин или пароль' });
      }
      
      // Check if this is a REAL email (not a temp.local placeholder)
      const isRealEmail = user.email && !user.email.endsWith('@temp.local');
      
      // Only require verification for real emails that aren't verified
      if (isRealEmail && user.email_verified !== 1) {
        return res.status(403).json({ 
          success: false, 
          error: 'Подтвердите email перед входом. Проверьте почту.',
          requiresVerification: true,
          userId: user.id
        });
      }
      
      // Check if user needs to add a real email (has temp.local or no email)
      const needsEmail = !user.email || user.email.endsWith('@temp.local');
      
      // Check if user is admin from admins table
      mainDb.get(`SELECT 1 FROM admins WHERE user_id = ?`, [user.id], (err, isAdminRow) => {
        const isAdmin = !!isAdminRow;
        
        // Create session
        createSession(user.id).then(sessionId => {
          res.cookie('sessionId', sessionId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000
          });
          
          res.json({
            success: true,
            user: {
              id: user.id,
              username: user.username,
              isAdmin: isAdmin,
              createdAt: new Date(user.created_at * 1000).toISOString(),
              profilePicture: user.profile_picture || null
            },
            needsEmail: needsEmail
          });
        }).catch(err => {
          console.error('Session creation error:', err);
          res.status(500).json({ success: false, error: 'Server error' });
        });
      });
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.post('/api/add-email', authenticate, accountEmailLimiter, async (req, res) => {
  try {
    const userId = req.userId;
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Некорректный email' });
    }
    
    // Check if email already used by another user (excluding temp.local ones)
    mainDb.get(`SELECT id FROM users WHERE email = ? AND id != ? AND email NOT LIKE '%@temp.local'`, [email, userId], async (err, existing) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ success: false, error: 'Server error' });
      }
      
      if (existing) {
        return res.status(400).json({ success: false, error: 'Email уже используется другим пользователем' });
      }
      
      // Get user to check if they already have a real email
      mainDb.get(`SELECT username, email FROM users WHERE id = ?`, [userId], async (err, user) => {
        if (err || !user) {
          return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        // If user already has a real email (not temp.local), ask them to update instead
        if (user.email && !user.email.endsWith('@temp.local')) {
          return res.status(400).json({ success: false, error: 'У вас уже есть email. Используйте настройки для его изменения.' });
        }
        
        // Generate verification token
        const token = generateVerificationToken(userId, email);
        
        // Send verification email
        const emailSent = await sendVerificationEmail(email, user.username, token, req);
        
        if (!emailSent) {
          return res.status(500).json({ success: false, error: 'Не удалось отправить email' });
        }
        
        // Update user with new email (not verified yet)
        mainDb.run(`UPDATE users SET email = ?, email_verified = 0 WHERE id = ?`, [email, userId], (err) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ success: false, error: 'Server error' });
          }
          
          console.log(`📧 Email added for user ${userId}: ${email} (awaiting verification)`);
          res.json({ success: true, message: 'Письмо с подтверждением отправлено' });
        });
      });
    });
    
  } catch (error) {
    console.error('Add email error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.post('/api/logout', async (req, res) => {
  const sessionId = req.cookies.sessionId;
  if (sessionId) {
    await deleteSession(sessionId);
  }
  res.clearCookie('sessionId', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });
  res.json({ success: true });
});

// Search users
app.get('/api/users/search', async (req, res) => {
    const query = req.query.q || '';
    if (query.length < 1) return res.json([]);

    try {
        const users = await dbAll(mainDb, `
            SELECT u.id, u.username, u.profile_picture AS profilePicture, u.status
            FROM users u
            WHERE u.username LIKE ? AND u.searchable = 1
            LIMIT 50
        `, [`%${query}%`]);
        res.json(await addPublicRoles(users));
    } catch (error) {
        console.error('User search failed:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

app.get('/api/isAdmin', authenticate, async (req, res) => {
    try {
        const capabilities = await getUserCapabilities(req.userId);
        res.json({
            ...capabilities,
            canModerate: capabilities.isAdmin || capabilities.isDeveloper || capabilities.isModerator
        });
    } catch (error) {
        console.error('Capability check error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/users/bio/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
    mainDb.get(`
      SELECT 
        id, username, profile_picture, profile_background, status,
        description, date_of_birth, home_country, education,
        workplace, hobbies, fandoms, religion
      FROM users 
      WHERE id = ?
    `, [userId], (err, user) => {
      if (err) {
        console.error('Bio fetch error:', err);
        return res.status(500).json({ error: 'Server error' });
      }
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      res.json({
        id: user.id,
        username: user.username,
        profilePicture: user.profile_picture || null,
        profileBackground: user.profile_background || null,
        status: user.status || '',
        description: user.description || '',
        dateOfBirth: user.date_of_birth || '',
        homeCountry: user.home_country || '',
        education: user.education || '',
        workplace: user.workplace || '',
        hobbies: user.hobbies || '',
        fandoms: user.fandoms || '',
        religion: user.religion || ''
      });
    });
    
  } catch (error) {
    console.error('Bio fetch error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/seq/:userId', authenticate, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (userId !== req.userId) return res.status(403).json({ error: 'Access denied' });
    
    mainDb.get(`
      SELECT 
        show_posts_feed, show_posts_profile, show_info_profile,
        anonymous_page, show_friends_list, show_communities_list,
        show_audios, show_photos, allow_messages_from
      FROM user_settings_privacy 
      WHERE user_id = ?
    `, [userId], (err, settings) => {
      if (err) {
        console.error('Privacy fetch error:', err);
        return res.status(500).json({ error: 'Server error' });
      }
      
      // Return defaults if no settings row exists
      res.json({
        showPostsFeed: settings?.show_posts_feed ?? 0,
        showPostsProfile: settings?.show_posts_profile ?? 0,
        showInfoProfile: settings?.show_info_profile ?? 0,
        anonymousPage: settings?.anonymous_page ?? 0,
        showFriendsList: settings?.show_friends_list ?? 0,
        showCommunitiesList: settings?.show_communities_list ?? 0,
        showAudios: settings?.show_audios ?? 0,
        showPhotos: settings?.show_photos ?? 0,
        allowMessagesFrom: settings?.allow_messages_from ?? 0
      });
    });
    
  } catch (error) {
    console.error('Privacy fetch error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/cust/:userId', authenticate, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (userId !== req.userId) return res.status(403).json({ error: 'Access denied' });
    
    mainDb.get(`
      SELECT 
        custom_background, notification_sound, chat_message_sound,
        post_sent_sound, friend_online_sound, friend_request_sound
      FROM user_settings_customization 
      WHERE user_id = ?
    `, [userId], (err, settings) => {
      if (err) {
        console.error('Customization fetch error:', err);
        return res.status(500).json({ error: 'Server error' });
      }
      
      // Return defaults if no settings row exists
      res.json({
        customBackground: settings?.custom_background || null,
        notificationSound: settings?.notification_sound ?? 1,
        chatMessageSound: settings?.chat_message_sound ?? 1,
        postSentSound: settings?.post_sent_sound ?? 1,
        friendOnlineSound: settings?.friend_online_sound ?? 1,
        friendRequestSound: settings?.friend_request_sound ?? 1
      });
    });
    
  } catch (error) {
    console.error('Customization fetch error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ PHOTOS ROUTE ============

// GET /api/users/photos - Get all photos of a user
app.get('/api/users/photos', optionalAuth, async (req, res) => {
    try {
        const targetUserId = parseInt(req.query.userId);
        const currentUserId = req.userId || null;
        
        if (!targetUserId) {
            return res.status(400).json({ error: 'userId required' });
        }
        
        // Get the user's photo album
        const album = await new Promise((resolve) => {
            mainDb.get(`
                SELECT id FROM user_photo_albums 
                WHERE user_id = ? AND title LIKE 'Фотографии %'
            `, [targetUserId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!album) {
            return res.json({ photos: [] });
        }
        
        // Get all photos from the album - order by added_at DESC (newest first)
        const photos = await new Promise((resolve, reject) => {
            mainDb.all(`
                SELECT p.id, p.file_path, p.uploaded_by, p.created_at, ap.added_at
                FROM album_photos ap
                JOIN photos p ON ap.photo_id = p.id
                WHERE ap.album_id = ?
                ORDER BY ap.added_at DESC
            `, [album.id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        res.json({ photos });
        
    } catch (error) {
        console.error('Error fetching photos:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============ VIDEOS ROUTE ============

// GET /api/users/videos - Get all videos of a user
app.get('/api/users/videos', optionalAuth, async (req, res) => {
    try {
        const targetUserId = parseInt(req.query.userId);
        const currentUserId = req.userId || null;
        
        if (!targetUserId) {
            return res.status(400).json({ error: 'userId required' });
        }
        
        // Get the user's video album
        const album = await new Promise((resolve) => {
            mainDb.get(`
                SELECT id FROM user_photo_albums 
                WHERE user_id = ? AND title LIKE 'Видеозаписи %'
            `, [targetUserId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!album) {
            return res.json({ videos: [] });
        }
        
        // Get all videos from the album
        const videos = await new Promise((resolve, reject) => {
            mainDb.all(`
                SELECT v.id, v.file_path, v.title, v.description, v.uploaded_by, v.like_count, v.created_at
                FROM album_videos av
                JOIN videos v ON av.video_id = v.id
                WHERE av.album_id = ?
                ORDER BY v.created_at DESC
            `, [album.id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        res.json({ videos });
        
    } catch (error) {
        console.error('Error fetching videos:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============ GIFS ROUTE ============

// GET /api/users/gifs - Get all GIFs from user's GIF album
app.get('/api/users/gifs', optionalAuth, async (req, res) => {
    try {
        const targetUserId = parseInt(req.query.userId);
        const currentUserId = req.userId || null;
        
        if (!targetUserId) {
            return res.status(400).json({ error: 'userId required' });
        }
        
        // Check if user exists
        const user = await new Promise((resolve) => {
            mainDb.get('SELECT id FROM users WHERE id = ?', [targetUserId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Get the user's GIF album
        const album = await new Promise((resolve) => {
            mainDb.get(`
                SELECT id FROM user_photo_albums 
                WHERE user_id = ? AND title LIKE 'GIF-ки %'
            `, [targetUserId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!album) {
            return res.json({ gifs: [] });
        }
        
        // If viewing own profile - always allowed
        if (currentUserId === targetUserId) {
            const gifs = await new Promise((resolve, reject) => {
                mainDb.all(`
                    SELECT p.id, p.file_path, p.uploaded_by, p.created_at
                    FROM album_photos ap
                    JOIN photos p ON ap.photo_id = p.id
                    WHERE ap.album_id = ?
                    ORDER BY p.created_at DESC
                `, [album.id], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            
            return res.json({ gifs });
        }
        
        // Check privacy setting (use show_photos)
        const privacy = await new Promise((resolve) => {
            mainDb.get(`
                SELECT show_photos FROM user_settings_privacy WHERE user_id = ?
            `, [targetUserId], (err, row) => {
                resolve(row || { show_photos: 0 });
            });
        });
        
        // 0 = show to anyone, 1 = friends only, 2 = no one
        if (privacy.show_photos === 2) {
            return res.json({ gifs: [] });
        }
        
        if (privacy.show_photos === 1) {
            if (!currentUserId) {
                return res.json({ gifs: [] });
            }
            
            const isFriend = await new Promise((resolve) => {
                mainDb.get(`
                    SELECT 1 FROM user_connections 
                    WHERE ((user_sender_id = ? AND user_reciever_id = ?) OR
                           (user_sender_id = ? AND user_reciever_id = ?))
                    AND status = 1
                `, [currentUserId, targetUserId, targetUserId, currentUserId], (err, row) => {
                    resolve(!!row);
                });
            });
            
            if (!isFriend) {
                return res.json({ gifs: [] });
            }
        }
        
        // Public or friends - return gifs
        const gifs = await new Promise((resolve, reject) => {
            mainDb.all(`
                SELECT p.id, p.file_path, p.uploaded_by, p.created_at
                FROM album_photos ap
                JOIN photos p ON ap.photo_id = p.id
                WHERE ap.album_id = ?
                ORDER BY p.created_at DESC
            `, [album.id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        res.json({ gifs });
        
    } catch (error) {
        console.error('Error fetching gifs:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============ AUDIO ROUTES ===========

// GET /api/users/audios - Get all audios of a user (with privacy check)
app.get('/api/users/audios', optionalAuth, async (req, res) => {
    try {
        const targetUserId = parseInt(req.query.userId);
        const currentUserId = req.userId || null;
        
        if (!targetUserId) {
            return res.status(400).json({ error: 'userId required' });
        }
        
        // Check if user exists
        const user = await new Promise((resolve) => {
            mainDb.get('SELECT id FROM users WHERE id = ?', [targetUserId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Get current user's library IDs (if logged in)
        let userLibraryIds = [];
        if (currentUserId) {
            const library = await new Promise((resolve) => {
                mainDb.all(`
                    SELECT audio_id FROM user_audio_library WHERE user_id = ?
                `, [currentUserId], (err, rows) => {
                    resolve(rows || []);
                });
            });
            userLibraryIds = library.map(row => row.audio_id);
        }
        
        // If viewing own profile - always allowed
        if (currentUserId === targetUserId) {
            const audios = await new Promise((resolve, reject) => {
                mainDb.all(`
                    SELECT a.id, a.file_path, a.name, a.artist_name, a.genre, 
                           a.uploaded_by, a.created_at, ual.position,
                           1 as in_library
                    FROM user_audio_library ual
                    JOIN audio a ON ual.audio_id = a.id
                    WHERE ual.user_id = ?
                    ORDER BY ual.position ASC
                `, [targetUserId], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            
            return res.json({ audios });
        }
        
        // Check privacy setting (default: 0 = show to anyone)
        const privacy = await new Promise((resolve) => {
            mainDb.get(`
                SELECT show_audios FROM user_settings_privacy WHERE user_id = ?
            `, [targetUserId], (err, row) => {
                resolve(row || { show_audios: 0 });
            });
        });
        
        // 0 = show to anyone, 1 = friends only, 2 = no one
        if (privacy.show_audios === 2) {
            return res.json({ audios: [] });
        }
        
        if (privacy.show_audios === 1) {
            if (!currentUserId) {
                return res.json({ audios: [] });
            }
            
            const isFriend = await new Promise((resolve) => {
                mainDb.get(`
                    SELECT 1 FROM user_connections 
                    WHERE ((user_sender_id = ? AND user_reciever_id = ?) OR
                           (user_sender_id = ? AND user_reciever_id = ?))
                    AND status = 1
                `, [currentUserId, targetUserId, targetUserId, currentUserId], (err, row) => {
                    resolve(!!row);
                });
            });
            
            if (!isFriend) {
                return res.json({ audios: [] });
            }
        }
        
        // Public or friends - return audios with in_library flag
        const audios = await new Promise((resolve, reject) => {
            mainDb.all(`
                SELECT a.id, a.file_path, a.name, a.artist_name, a.genre, 
                       a.uploaded_by, a.created_at,
                       CASE WHEN ? IN (SELECT audio_id FROM user_audio_library WHERE user_id = ?) THEN 1 ELSE 0 END as in_library
                FROM audio a
                WHERE a.id IN (
                    SELECT audio_id FROM user_audio_library WHERE user_id = ?
                )
                ORDER BY a.created_at DESC
            `, [currentUserId, currentUserId, targetUserId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        res.json({ audios });
        
    } catch (error) {
        console.error('Error fetching audios:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


// GET /api/users/audios/playlists - Get user's audio playlists
app.get('/api/users/audios/playlists', optionalAuth, async (req, res) => {
    try {
        const userId = parseInt(req.query.userId);
        const currentUserId = req.userId || null;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId required' });
        }
        
        // If viewing own profile
        if (currentUserId === userId) {
            const playlists = await new Promise((resolve, reject) => {
                mainDb.all(`
                    SELECT ap.id, ap.name, ap.description, ap.created_by, ap.created_at, ap.is_public,
                           (SELECT COUNT(*) FROM playlist_audios WHERE playlist_id = ap.id) as audio_count
                    FROM user_audio_playlists uap
                    JOIN audio_playlists ap ON uap.playlist_id = ap.id
                    WHERE uap.user_id = ?
                    ORDER BY ap.name ASC
                `, [userId], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            
            return res.json({ playlists });
        }
        
        // For other users - only show public playlists
        const playlists = await new Promise((resolve, reject) => {
            mainDb.all(`
                SELECT ap.id, ap.name, ap.description, ap.created_by, ap.created_at, ap.is_public,
                       (SELECT COUNT(*) FROM playlist_audios WHERE playlist_id = ap.id) as audio_count,
                       u.username as creator_name
                FROM audio_playlists ap
                JOIN users u ON ap.created_by = u.id
                WHERE ap.is_public = 1
                ORDER BY ap.name ASC
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        res.json({ playlists });
        
    } catch (error) {
        console.error('Error fetching audio playlists:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/users/audios/:audioId - Add audio to user's library
app.post('/api/users/audios/:audioId', authenticate, async (req, res) => {
    try {
        const audioId = parseInt(req.params.audioId);
        const userId = req.userId;
        
        // Check if audio exists
        const audio = await new Promise((resolve) => {
            mainDb.get('SELECT id FROM audio WHERE id = ?', [audioId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!audio) {
            return res.status(404).json({ error: 'Audio not found' });
        }
        
        // Check if already in library
        const existing = await new Promise((resolve) => {
            mainDb.get(`
                SELECT 1 FROM user_audio_library WHERE user_id = ? AND audio_id = ?
            `, [userId, audioId], (err, row) => {
                resolve(row);
            });
        });
        
        if (existing) {
            return res.status(400).json({ error: 'Audio already in library' });
        }
        
        // Shift all existing positions down by 1
        await dbRun(mainDb, `
            UPDATE user_audio_library 
            SET position = position + 1 
            WHERE user_id = ?
        `, [userId]);
        
        // Insert at position 1 (top)
        mainDb.run(`
            INSERT INTO user_audio_library (user_id, audio_id, added_at, position)
            VALUES (?, ?, ?, 1)
        `, [userId, audioId, Math.floor(Date.now() / 1000)], function(err) {
            if (err) {
                console.error('Error adding audio:', err);
                return res.status(500).json({ error: 'Failed to add audio' });
            }
            res.json({ success: true });
        });
        
    } catch (error) {
        console.error('Error adding audio:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/users/audios/:audioId - Remove audio from user's library
app.delete('/api/users/audios/:audioId', authenticate, async (req, res) => {
    try {
        const audioId = parseInt(req.params.audioId);
        const userId = req.userId;
        
        mainDb.run(`
            DELETE FROM user_audio_library WHERE user_id = ? AND audio_id = ?
        `, [userId, audioId], function(err) {
            if (err) {
                console.error('Error removing audio:', err);
                return res.status(500).json({ error: 'Failed to remove audio' });
            }
            res.json({ success: true });
        });
        
    } catch (error) {
        console.error('Error removing audio:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/users/audios/:audioId - Change order of audio in library
app.put('/api/users/audios/:audioId', authenticate, async (req, res) => {
    try {
        const audioId = parseInt(req.params.audioId);
        const userId = req.userId;
        const { newPosition } = req.body;
        
        if (newPosition === undefined || newPosition < 1) {
            return res.status(400).json({ error: 'newPosition required and must be >= 1' });
        }
        
        // Get current position
        const current = await new Promise((resolve) => {
            mainDb.get(`
                SELECT position FROM user_audio_library WHERE user_id = ? AND audio_id = ?
            `, [userId, audioId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!current) {
            return res.status(404).json({ error: 'Audio not in library' });
        }
        
        const oldPos = current.position;
        
        if (oldPos === newPosition) {
            return res.json({ success: true });
        }
        
        // Get max position
        const maxPos = await new Promise((resolve) => {
            mainDb.get(`
                SELECT MAX(position) as max FROM user_audio_library WHERE user_id = ?
            `, [userId], (err, row) => {
                resolve(row?.max || 0);
            });
        });
        
        if (newPosition > maxPos) {
            return res.status(400).json({ error: 'Position exceeds library size' });
        }
        
        // Shift positions
        if (oldPos < newPosition) {
            // Moving down - shift items between oldPos+1 and newPosition up by 1
            await dbRun(mainDb, `
                UPDATE user_audio_library 
                SET position = position - 1 
                WHERE user_id = ? AND position > ? AND position <= ?
            `, [userId, oldPos, newPosition]);
        } else {
            // Moving up - shift items between newPosition and oldPos-1 down by 1
            await dbRun(mainDb, `
                UPDATE user_audio_library 
                SET position = position + 1 
                WHERE user_id = ? AND position >= ? AND position < ?
            `, [userId, newPosition, oldPos]);
        }
        
        // Update target position
        mainDb.run(`
            UPDATE user_audio_library 
            SET position = ? 
            WHERE user_id = ? AND audio_id = ?
        `, [newPosition, userId, audioId], function(err) {
            if (err) {
                console.error('Error updating position:', err);
                return res.status(500).json({ error: 'Failed to update position' });
            }
            res.json({ success: true });
        });
        
    } catch (error) {
        console.error('Error updating audio position:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/audios/:audioId - Change audio metadata
app.put('/api/audios/:audioId', authenticate, async (req, res) => {
    try {
        const audioId = parseInt(req.params.audioId);
        const userId = req.userId;
        const { name, artistName, genre } = req.body;
        
        // Check if user owns this audio
        const audio = await new Promise((resolve) => {
            mainDb.get(`
                SELECT uploaded_by FROM audio WHERE id = ?
            `, [audioId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!audio) {
            return res.status(404).json({ error: 'Audio not found' });
        }
        
        if (audio.uploaded_by !== userId) {
            return res.status(403).json({ error: 'Only the uploader can edit this audio' });
        }
        
        const updates = [];
        const params = [];
        
        if (name !== undefined) {
            updates.push('name = ?');
            params.push(name);
        }
        if (artistName !== undefined) {
            updates.push('artist_name = ?');
            params.push(artistName);
        }
        if (genre !== undefined) {
            updates.push('genre = ?');
            params.push(genre);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        params.push(audioId);
        
        mainDb.run(`
            UPDATE audio SET ${updates.join(', ')} WHERE id = ?
        `, params, function(err) {
            if (err) {
                console.error('Error updating audio:', err);
                return res.status(500).json({ error: 'Failed to update audio' });
            }
            res.json({ success: true });
        });
        
    } catch (error) {
        console.error('Error updating audio:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/audios/playlists/audio/:audioId - Add audio to a playlist
app.post('/api/audios/playlists/audio/:audioId', authenticate, async (req, res) => {
    try {
        const audioId = parseInt(req.params.audioId);
        const userId = req.userId;
        const { playlistId } = req.body;
        
        if (!playlistId) {
            return res.status(400).json({ error: 'playlistId required' });
        }
        
        // Check if playlist exists and user is creator
        const playlist = await new Promise((resolve) => {
            mainDb.get(`
                SELECT created_by FROM audio_playlists WHERE id = ?
            `, [playlistId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!playlist) {
            return res.status(404).json({ error: 'Playlist not found' });
        }
        
        if (playlist.created_by !== userId) {
            return res.status(403).json({ error: 'Only the playlist creator can add songs' });
        }
        
        // Check if audio exists
        const audio = await new Promise((resolve) => {
            mainDb.get('SELECT id FROM audio WHERE id = ?', [audioId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!audio) {
            return res.status(404).json({ error: 'Audio not found' });
        }
        
        // Check if already in playlist
        const existing = await new Promise((resolve) => {
            mainDb.get(`
                SELECT 1 FROM playlist_audios WHERE playlist_id = ? AND audio_id = ?
            `, [playlistId, audioId], (err, row) => {
                resolve(row);
            });
        });
        
        if (existing) {
            return res.status(400).json({ error: 'Audio already in playlist' });
        }
        
        // Get max position
        const maxPos = await new Promise((resolve) => {
            mainDb.get(`
                SELECT MAX(position) as max FROM playlist_audios WHERE playlist_id = ?
            `, [playlistId], (err, row) => {
                resolve(row?.max || 0);
            });
        });
        
        mainDb.run(`
            INSERT INTO playlist_audios (playlist_id, audio_id, position, added_at, added_by)
            VALUES (?, ?, ?, ?, ?)
        `, [playlistId, audioId, maxPos + 1, Math.floor(Date.now() / 1000), userId], function(err) {
            if (err) {
                console.error('Error adding audio to playlist:', err);
                return res.status(500).json({ error: 'Failed to add audio to playlist' });
            }
            res.json({ success: true });
        });
        
    } catch (error) {
        console.error('Error adding audio to playlist:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/users/audios/playlists/:audioId - Change order of audio in playlist
app.put('/api/users/audios/playlists/:audioId', authenticate, async (req, res) => {
    try {
        const audioId = parseInt(req.params.audioId);
        const userId = req.userId;
        const { playlistId, newPosition } = req.body;
        
        if (!playlistId || newPosition === undefined || newPosition < 1) {
            return res.status(400).json({ error: 'playlistId and newPosition required' });
        }
        
        // Check if user owns the playlist
        const playlist = await new Promise((resolve) => {
            mainDb.get(`
                SELECT created_by FROM audio_playlists WHERE id = ?
            `, [playlistId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!playlist) {
            return res.status(404).json({ error: 'Playlist not found' });
        }
        
        if (playlist.created_by !== userId) {
            return res.status(403).json({ error: 'Only the playlist creator can reorder' });
        }
        
        // Get current position
        const current = await new Promise((resolve) => {
            mainDb.get(`
                SELECT position FROM playlist_audios WHERE playlist_id = ? AND audio_id = ?
            `, [playlistId, audioId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!current) {
            return res.status(404).json({ error: 'Audio not in playlist' });
        }
        
        const oldPos = current.position;
        
        if (oldPos === newPosition) {
            return res.json({ success: true });
        }
        
        // Get max position
        const maxPos = await new Promise((resolve) => {
            mainDb.get(`
                SELECT MAX(position) as max FROM playlist_audios WHERE playlist_id = ?
            `, [playlistId], (err, row) => {
                resolve(row?.max || 0);
            });
        });
        
        if (newPosition > maxPos) {
            return res.status(400).json({ error: 'Position exceeds playlist size' });
        }
        
        // Shift positions
        if (oldPos < newPosition) {
            await dbRun(mainDb, `
                UPDATE playlist_audios 
                SET position = position - 1 
                WHERE playlist_id = ? AND position > ? AND position <= ?
            `, [playlistId, oldPos, newPosition]);
        } else {
            await dbRun(mainDb, `
                UPDATE playlist_audios 
                SET position = position + 1 
                WHERE playlist_id = ? AND position >= ? AND position < ?
            `, [playlistId, newPosition, oldPos]);
        }
        
        mainDb.run(`
            UPDATE playlist_audios 
            SET position = ? 
            WHERE playlist_id = ? AND audio_id = ?
        `, [newPosition, playlistId, audioId], function(err) {
            if (err) {
                console.error('Error updating position:', err);
                return res.status(500).json({ error: 'Failed to update position' });
            }
            res.json({ success: true });
        });
        
    } catch (error) {
        console.error('Error updating playlist position:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/users/playlists/:playlistId - Remove a playlist from user's list
app.delete('/api/users/playlists/:playlistId', authenticate, async (req, res) => {
    try {
        const playlistId = parseInt(req.params.playlistId);
        const userId = req.userId;
        
        mainDb.run(`
            DELETE FROM user_audio_playlists WHERE user_id = ? AND playlist_id = ?
        `, [userId, playlistId], function(err) {
            if (err) {
                console.error('Error removing playlist:', err);
                return res.status(500).json({ error: 'Failed to remove playlist' });
            }
            res.json({ success: true });
        });
        
    } catch (error) {
        console.error('Error removing playlist:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/audios/playlists/:playlistId/audio/:audioId - Delete an audio from a playlist
app.delete('/api/audios/playlists/:playlistId/audio/:audioId', authenticate, async (req, res) => {
    try {
        const playlistId = parseInt(req.params.playlistId);
        const audioId = parseInt(req.params.audioId);
        const userId = req.userId;
        
        // Check if user owns the playlist
        const playlist = await new Promise((resolve) => {
            mainDb.get(`
                SELECT created_by FROM audio_playlists WHERE id = ?
            `, [playlistId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!playlist) {
            return res.status(404).json({ error: 'Playlist not found' });
        }
        
        if (playlist.created_by !== userId) {
            return res.status(403).json({ error: 'Only the playlist creator can remove songs' });
        }
        
        // Get position to reorder after deletion
        const removed = await new Promise((resolve) => {
            mainDb.get(`
                SELECT position FROM playlist_audios WHERE playlist_id = ? AND audio_id = ?
            `, [playlistId, audioId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!removed) {
            return res.status(404).json({ error: 'Audio not in playlist' });
        }
        
        const removedPos = removed.position;
        
        // Delete the audio
        mainDb.run(`
            DELETE FROM playlist_audios WHERE playlist_id = ? AND audio_id = ?
        `, [playlistId, audioId], function(err) {
            if (err) {
                console.error('Error removing audio from playlist:', err);
                return res.status(500).json({ error: 'Failed to remove audio' });
            }
            
            // Shift remaining positions down
            mainDb.run(`
                UPDATE playlist_audios 
                SET position = position - 1 
                WHERE playlist_id = ? AND position > ?
            `, [playlistId, removedPos], shiftErr => {
                if (shiftErr) console.error('Error compacting playlist positions:', shiftErr);
            });
            
            res.json({ success: true });
        });
        
    } catch (error) {
        console.error('Error removing audio from playlist:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/audios/playlists/:playlistId - Delete a playlist
app.delete('/api/audios/playlists/:playlistId', authenticate, async (req, res) => {
    try {
        const playlistId = parseInt(req.params.playlistId);
        const userId = req.userId;
        
        // Check if user is creator
        const playlist = await new Promise((resolve) => {
            mainDb.get(`
                SELECT created_by FROM audio_playlists WHERE id = ?
            `, [playlistId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!playlist) {
            return res.status(404).json({ error: 'Playlist not found' });
        }
        
        if (playlist.created_by !== userId) {
            return res.status(403).json({ error: 'Only the playlist creator can delete it' });
        }
        
        // Delete playlist (cascade will handle playlist_audios and user_audio_playlists)
        mainDb.run(`DELETE FROM audio_playlists WHERE id = ?`, [playlistId], function(err) {
            if (err) {
                console.error('Error deleting playlist:', err);
                return res.status(500).json({ error: 'Failed to delete playlist' });
            }
            res.json({ success: true });
        });
        
    } catch (error) {
        console.error('Error deleting playlist:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/audios/playlists/:playlistId - Create a playlist
app.post('/api/audios/playlists/:playlistId', authenticate, async (req, res) => {
    try {
        const playlistId = parseInt(req.params.playlistId);
        const userId = req.userId;
        const { name, description, isPublic } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'name required' });
        }
        
        // Check if playlist already exists
        const existing = await new Promise((resolve) => {
            mainDb.get('SELECT id FROM audio_playlists WHERE id = ?', [playlistId], (err, row) => {
                resolve(row);
            });
        });
        
        if (existing) {
            return res.status(400).json({ error: 'Playlist already exists' });
        }
        
        mainDb.run(`
            INSERT INTO audio_playlists (id, name, description, created_by, created_at, is_public)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [playlistId, name, description || '', userId, Math.floor(Date.now() / 1000), isPublic ? 1 : 0], function(err) {
            if (err) {
                console.error('Error creating playlist:', err);
                return res.status(500).json({ error: 'Failed to create playlist' });
            }
            
            // Add creator to user_audio_playlists
            mainDb.run(`
                INSERT INTO user_audio_playlists (user_id, playlist_id, added_at)
                VALUES (?, ?, ?)
            `, [userId, playlistId, Math.floor(Date.now() / 1000)], linkErr => {
                if (linkErr) {
                    console.error('Error linking playlist to creator:', linkErr);
                    return res.status(500).json({ error: 'Failed to link playlist to creator' });
                }
                res.json({ success: true, playlistId });
            });
        });
        
    } catch (error) {
        console.error('Error creating playlist:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/audios/playlists/:playlistId - Change playlist metadata
app.put('/api/audios/playlists/:playlistId', authenticate, async (req, res) => {
    try {
        const playlistId = parseInt(req.params.playlistId);
        const userId = req.userId;
        const { name, description, isPublic } = req.body;
        
        // Check if user is creator
        const playlist = await new Promise((resolve) => {
            mainDb.get(`
                SELECT created_by FROM audio_playlists WHERE id = ?
            `, [playlistId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!playlist) {
            return res.status(404).json({ error: 'Playlist not found' });
        }
        
        if (playlist.created_by !== userId) {
            return res.status(403).json({ error: 'Only the playlist creator can edit it' });
        }
        
        const updates = [];
        const params = [];
        
        if (name !== undefined) {
            updates.push('name = ?');
            params.push(name);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description);
        }
        if (isPublic !== undefined) {
            updates.push('is_public = ?');
            params.push(isPublic ? 1 : 0);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        params.push(playlistId);
        
        mainDb.run(`
            UPDATE audio_playlists SET ${updates.join(', ')} WHERE id = ?
        `, params, function(err) {
            if (err) {
                console.error('Error updating playlist:', err);
                return res.status(500).json({ error: 'Failed to update playlist' });
            }
            res.json({ success: true });
        });
        
    } catch (error) {
        console.error('Error updating playlist:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/users/playlists/:playlistId - Add a playlist to user's list
app.post('/api/users/playlists/:playlistId', authenticate, async (req, res) => {
    try {
        const playlistId = parseInt(req.params.playlistId);
        const userId = req.userId;
        
        // Check if playlist exists and is public
        const playlist = await new Promise((resolve) => {
            mainDb.get(`
                SELECT id, is_public, created_by FROM audio_playlists WHERE id = ?
            `, [playlistId], (err, row) => {
                resolve(row);
            });
        });
        
        if (!playlist) {
            return res.status(404).json({ error: 'Playlist not found' });
        }
        
        if (!playlist.is_public && playlist.created_by !== userId) {
            return res.status(403).json({ error: 'Cannot access private playlist' });
        }
        
        // Check if already added
        const existing = await new Promise((resolve) => {
            mainDb.get(`
                SELECT 1 FROM user_audio_playlists WHERE user_id = ? AND playlist_id = ?
            `, [userId, playlistId], (err, row) => {
                resolve(row);
            });
        });
        
        if (existing) {
            return res.status(400).json({ error: 'Playlist already in your list' });
        }
        
        mainDb.run(`
            INSERT INTO user_audio_playlists (user_id, playlist_id, added_at)
            VALUES (?, ?, ?)
        `, [userId, playlistId, Math.floor(Date.now() / 1000)], function(err) {
            if (err) {
                console.error('Error adding playlist:', err);
                return res.status(500).json({ error: 'Failed to add playlist' });
            }
            res.json({ success: true });
        });
        
    } catch (error) {
        console.error('Error adding playlist:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/audios - Upload an audio file
app.post('/api/audios', authenticate, uploadAudio.single('audio'), async (req, res) => {
    try {
        const userId = req.userId;
        const { name, artistName, genre } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ error: 'Audio file required' });
        }
        
        const file = req.file;
        const mimeType = file.mimetype;
        
        if (!mimeType.startsWith('audio/')) {
            return res.status(400).json({ error: 'File must be audio' });
        }
        
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const tempPath = path.join(__dirname, 'audios', 'temp_' + unique);
        const finalPath = path.join(__dirname, 'audios', unique + '.mp3');
        
        fs.writeFileSync(tempPath, file.buffer);
        
        await new Promise((resolve, reject) => {
            const ffmpeg = require('fluent-ffmpeg');
            const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
            ffmpeg.setFfmpegPath(ffmpegPath);
            ffmpeg(tempPath)
                .audioCodec('libmp3lame')
                .audioBitrate('96k')
                .audioChannels(1)
                .outputOptions(['-q:a 6'])
                .on('end', () => {
                    safeUnlinkTemporaryFile(tempPath);
                    resolve();
                })
                .on('error', (err) => {
                    safeUnlinkTemporaryFile(tempPath);
                    safeUnlinkTemporaryFile(finalPath);
                    reject(err);
                })
                .save(finalPath);
        });
        
        const filePath = '/audios/' + unique + '.mp3';
        const createdAt = Math.floor(Date.now() / 1000);
        
        const audioId = await new Promise((resolve, reject) => {
            mainDb.run(`
                INSERT INTO audio (file_path, name, artist_name, genre, uploaded_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [filePath, name || 'Без названия', artistName || 'Неизвестно', genre || '', userId, createdAt], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
        
        res.json({
            success: true,
            audio: {
                id: audioId,
                filePath: filePath,
                name: name || 'Без названия',
                artistName: artistName || 'Неизвестно',
                genre: genre || '',
                uploadedBy: userId,
                createdAt: new Date(createdAt * 1000).toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error uploading audio:', error);
        res.status(500).json({ error: 'Failed to upload audio' });
    }
});

// ============ POST ROUTES ============

app.get('/api/comments/:commentId/replies', async (req, res) => {
    const commentId = parseFloat(req.params.commentId);
    
    mainDb.all(`
        SELECT c.*, u.username 
        FROM comments c
        LEFT JOIN users u ON c.user_id = u.id
        WHERE c.parent_comment_id = ?
        ORDER BY c.created_at ASC
    `, [commentId], (err, replies) => {
        if (err) {
            console.error('Error fetching replies:', err);
            return res.status(500).json({ error: 'Failed to load replies' });
        }
        
        const formattedReplies = replies.map(reply => ({
            id: reply.id,
            userId: reply.user_id,
            username: reply.username,
            content: reply.content,
            reference: reply.parent_comment_id,
            attachment: reply.attachment_path,
            attachmentType: reply.attachment_type,
            createdAt: new Date(reply.created_at * 1000).toISOString(),
            likes: [],
            likeCount: 0,
            reply_count: 0
        }));
        
        res.json(formattedReplies);
    });
});


// GET all posts
app.get('/api/posts', optionalAuth, async (req, res) => {
    const userId = req.userId || null;
    if (userId !== 1773499483205) return res.status(403).json({ error: 'Access denied' });

    try {
        const result = await fetchPosts({
            type: 'feed',
            before: null,
            limit: null, 
            currentUserId: userId
        });
        res.json(result.posts);
    } catch (err) {
        console.error('All posts error:', err);
        res.status(500).json({ error: 'Failed to load posts' });
    }
});

// GET some feed (chronological) posts
app.get('/api/posts/feed/:lastPostId', optionalAuth, async (req, res) => {
    const userId = req.userId || null;
    let lastPostId = parseInt(req.params.lastPostId);
    const filter = req.query.filter || null
    const sort = req.query.sort || null
    const timeRange = req.query.timeRange || null

    try {
        const result = await fetchPosts({
            userId: filter == 'friends' ? 'friends' : filter == 'recommended' ? 'not_friends' : -1,
            communityId: filter == 'subscriptions' ? 'subscriptions' : filter == 'recommended' ? 'not_subscriptions' :  -1,
            before: lastPostId === -1 ? null : lastPostId,
            limit: 15,
            currentUserId: userId,
	    timeSpan: timeRange,
	    sortBy: sort
        });
        res.json(result);
    } catch (err) {
        console.error('Feed error:', err);
        res.status(500).json({ error: 'Failed to load feed' });
    }
});

app.post('/api/posts/flag', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const { postId, flagType, notes } = req.body;
        
        if (!postId || !flagType) {
            return res.status(400).json({ error: 'postId and flagType required' });
        }
        
        const validTypes = ['spam', 'unmarked_nsfw', 'harassment', 'hatespeech', 'illegal'];
        if (!validTypes.includes(flagType)) {
            return res.status(400).json({ error: 'Invalid flag type' });
        }
        
        const result = await new Promise((resolve, reject) => {
            mainDb.run(`
                INSERT INTO mod_posts_flagged (post_id, submitted_by, submitted_at, flag_type, notes)
                SELECT ?, ?, ?, ?, ?
                WHERE EXISTS (SELECT 1 FROM posts WHERE id = ?)
                AND NOT EXISTS (SELECT 1 FROM mod_posts_flagged WHERE post_id = ? AND submitted_by = ? AND resolved = 0)
            `, [postId, userId, Math.floor(Date.now() / 1000), flagType, notes || null, postId, postId, userId], function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
        
        if (result.changes === 0) {
            const post = await new Promise((resolve) => {
                mainDb.get('SELECT id FROM posts WHERE id = ?', [postId], (err, row) => resolve(row));
            });
            if (!post) return res.status(404).json({ error: 'Post not found' });
            return res.status(400).json({ error: 'You have already flagged this post' });
        }
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Flag error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/posts/flag', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const { postId } = req.body;
        
        if (!postId) {
            return res.status(400).json({ error: 'postId required' });
        }
        
        const result = await new Promise((resolve, reject) => {
            mainDb.run(`
                DELETE FROM mod_posts_flagged 
                WHERE post_id = ? AND submitted_by = ? AND resolved = 0
            `, [postId, userId], function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Flag not found or already resolved' });
        }
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Remove flag error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/mod/flag/resolve', authenticate, requireModerator, async (req, res) => {
    try {
        const flagId = Number(req.body.flagId);
        const legacyActionMap = {
            'non-issue': 'dismiss',
            minor: 'resolve',
            heavy: 'resolve'
        };
        const action = legacyActionMap[req.body.violation];

        if (!Number.isSafeInteger(flagId) || !action) {
            return res.status(400).json({
                error: 'Legacy destructive moderation actions are disabled. Use an explicit moderation action.'
            });
        }

        const now = Math.floor(Date.now() / 1000);
        const result = await dbRun(mainDb, `
            UPDATE mod_posts_flagged
            SET resolved = 1,
                resolved_by = ?,
                resolved_at = ?,
                violation = ?,
                status = ?,
                resolution_action = ?
            WHERE id = ? AND resolved = 0
        `, [req.userId, now, req.body.violation, action === 'dismiss' ? 'dismissed' : 'resolved', action, flagId]);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Flag not found or already resolved' });
        }

        await dbRun(mainDb, `
            INSERT INTO moderation_audit_log
                (moderator_user_id, flag_id, action, details, created_at)
            VALUES (?, ?, ?, ?, ?)
        `, [req.userId, flagId, `legacy_${action}`, JSON.stringify({ violation: req.body.violation }), now]);

        res.json({ success: true, action });
    } catch (error) {
        console.error('Resolve flag error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/mod/flagged-posts', authenticate, requireModerator, async (req, res) => {
    try {
        const result = await new Promise((resolve, reject) => {
            mainDb.get(`
                SELECT json_group_array(
                    json_object(
                        'id', mf.id,
                        'postId', mf.post_id,
                        'submittedBy', mf.submitted_by,
                        'submittedAt', mf.submitted_at,
                        'flagType', mf.flag_type,
                        'notes', mf.notes,
                        'violation', mf.violation,
                        'resolved', mf.resolved,
                        'submitterName', u.username,
                        'postContent', p.content,
                        'isAnonymous', p.is_anonymous,
                        'postAuthorId', p.user_id,
                        'postAuthorName', CASE WHEN p.is_anonymous = 0 THEN pu.username ELSE NULL END,
                        'violationCount', (
                            SELECT COUNT(*) 
                            FROM mod_posts_flagged mf2
                            WHERE mf2.post_id IN (SELECT id FROM posts WHERE user_id = p.user_id)
                            AND mf2.resolved = 1 
                            AND mf2.violation IN ('minor', 'heavy')
                        )
                    )
                ) as flags_json
                FROM mod_posts_flagged mf
                JOIN posts p ON mf.post_id = p.id
                LEFT JOIN users u ON mf.submitted_by = u.id
                LEFT JOIN users pu ON p.user_id = pu.id
                WHERE mf.resolved = 0
                ORDER BY mf.submitted_at DESC
            `, (err, row) => {
                if (err) {
                    console.error('Database error:', err);
                    reject(err);
                } else {
                    const flags = row.flags_json ? JSON.parse(row.flags_json) : [];
                    resolve(flags);
                }
            });
        });
        
        res.json({ flags: result });
        
    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/mod/reports/:flagId/action', authenticate, requireModerator, async (req, res) => {
    const flagId = Number(req.params.flagId);
    const action = String(req.body.action || '');
    const validActions = ['dismiss', 'resolve', 'hide', 'unhide'];

    if (!Number.isSafeInteger(flagId) || !validActions.includes(action)) {
        return res.status(400).json({ error: 'Invalid moderation action' });
    }

    try {
        const flag = await dbGet(mainDb, `
            SELECT mf.id, mf.post_id, mf.resolved, p.user_id AS post_author_id
            FROM mod_posts_flagged mf
            LEFT JOIN posts p ON p.id = mf.post_id
            WHERE mf.id = ?
        `, [flagId]);
        if (!flag) return res.status(404).json({ error: 'Report not found' });

        const now = Math.floor(Date.now() / 1000);
        await dbRun(mainDb, 'BEGIN IMMEDIATE TRANSACTION');
        try {
            if (action === 'hide' || action === 'unhide') {
                if (!flag.post_id || !flag.post_author_id) {
                    throw Object.assign(new Error('Reported post no longer exists'), { status: 404 });
                }
                const hidden = action === 'hide' ? 1 : 0;
                await dbRun(mainDb, `
                    INSERT INTO post_moderation_state
                        (post_id, hidden, hidden_by, hidden_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(post_id) DO UPDATE SET
                        hidden = excluded.hidden,
                        hidden_by = excluded.hidden_by,
                        hidden_at = excluded.hidden_at
                `, [flag.post_id, hidden, req.userId, now]);
            } else {
                const status = action === 'dismiss' ? 'dismissed' : 'resolved';
                await dbRun(mainDb, `
                    UPDATE mod_posts_flagged
                    SET resolved = 1,
                        resolved_by = ?,
                        resolved_at = ?,
                        status = ?,
                        resolution_action = ?
                    WHERE id = ?
                `, [req.userId, now, status, action, flagId]);
            }

            await dbRun(mainDb, `
                INSERT INTO moderation_audit_log
                    (moderator_user_id, flag_id, post_id, action, details, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                req.userId,
                flagId,
                flag.post_id || null,
                action,
                JSON.stringify({ postAuthorId: flag.post_author_id || null }),
                now
            ]);
            await dbRun(mainDb, 'COMMIT');
        } catch (error) {
            await dbRun(mainDb, 'ROLLBACK').catch(() => {});
            throw error;
        }

        res.json({ success: true, action, postId: flag.post_id });
    } catch (error) {
        console.error('Moderation report action error:', error);
        res.status(error.status || 500).json({ error: error.message || 'Server error' });
    }
});

app.get('/api/mod/flagged-posts/:postId', authenticate, requireModerator, async (req, res) => {
    try {
        const postId = parseInt(req.params.postId);
        
        const flags = await new Promise((resolve, reject) => {
            mainDb.all(`
                SELECT 
                    json_group_array(
                        json_object(
                            'id', mf.id,
                            'submittedBy', mf.submitted_by,
                            'submittedAt', mf.submitted_at,
                            'flagType', mf.flag_type,
                            'submitterName', u.username,
                            'resolved', mf.resolved,
                            'violation', mf.violation
                        )
                    ) as flags_json
                FROM mod_posts_flagged mf
                LEFT JOIN users u ON mf.submitted_by = u.id
                WHERE mf.post_id = ?
                ORDER BY mf.submitted_at DESC
            `, [postId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        const flagsArray = flags.length > 0 && flags[0].flags_json ? JSON.parse(flags[0].flags_json) : [];
        res.json({ flags: flagsArray });
        
    } catch (error) {
        console.error('Get post flags error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/users/:userId/violations', authenticate, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const currentUserId = req.userId;
        const capabilities = await getUserCapabilities(currentUserId);
        const canModerate = capabilities.isAdmin || capabilities.isDeveloper || capabilities.isModerator;
        
        if (!canModerate && userId !== currentUserId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const result = await new Promise((resolve) => {
            mainDb.get(`
                SELECT COUNT(*) as count 
                FROM mod_posts_flagged 
                WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)
                AND resolved = 1 
                AND violation IN ('minor', 'heavy')
            `, [userId], (err, row) => {
                resolve(row || { count: 0 });
            });
        });
        
        res.json({ userId, violationCount: result?.count || 0 });
        
    } catch (error) {
        console.error('Violation count error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/posts', authenticate, uploadMedia.array('files', 10), async (req, res) => {
    try {
        const userId = req.userId;
        const isAnonymous = req.body.isAnonymous === 'true';
        const content = req.body.content || '';
        const communityId = req.body.community && req.body.community !== '' ? parseInt(req.body.community) : null;
        const showFeed = req.body.showFeed || 1;
        const isSpoiler = req.body.isSpoiler || 0;
        const isNsfw = req.body.isNsfw || 0;
        const spoilerPreview = req.body.spoilerPreview || '';

        // --- POLL DATA ---
        let pollData = null;
        try {
            pollData = req.body.poll ? JSON.parse(req.body.poll) : null;
        } catch (e) {
            pollData = null;
        }

        // --- EXISTING FILES FROM LIBRARY ---
        let existingFiles = [];
        try {
            existingFiles = req.body.existingFiles ? JSON.parse(req.body.existingFiles) : [];
        } catch (e) {
            existingFiles = [];
        }

        // --- NEW FILE UPLOADS ---
        const files = req.files || [];
        const filePaths = [];
        const fileTypes = [];
        const fileNames = [];
        const newPhotoIds = [];
        const newVideoIds = [];
        const newGifIds = [];
        const newAudioIds = [];

        // Get user for album titles
        const user = await new Promise((resolve) => {
            mainDb.get(`SELECT username FROM users WHERE id = ?`, [userId], (err, row) => {
                resolve(row);
            });
        });
        const username = user?.username || '';

        // 1. Handle canonical media references from the user's library. Never
        // trust a client-supplied path: only existing /photo, /video and /audio IDs
        // are accepted and normalized before being linked to a post.
        if (!Array.isArray(existingFiles) || existingFiles.length + files.length > 10) {
            return res.status(400).json({ error: 'A post can contain at most 10 files' });
        }

        for (const existing of existingFiles) {
            const mediaType = existing?.type;
            const routeMatch = typeof existing?.path === 'string'
                ? existing.path.match(/^\/(photo|video|audio)\/(\d+)$/)
                : null;
            if (!routeMatch || !['image', 'gif', 'video', 'audio'].includes(mediaType)) {
                return res.status(400).json({ error: 'Invalid existing media reference' });
            }

            const routeType = routeMatch[1];
            const mediaId = Number(routeMatch[2]);
            const expectedRouteType = mediaType === 'image' || mediaType === 'gif' ? 'photo' : mediaType;
            if (!Number.isSafeInteger(mediaId) || routeType !== expectedRouteType) {
                return res.status(400).json({ error: 'Existing media type does not match its path' });
            }

            let mediaRow;
            if (routeType === 'photo') {
                mediaRow = await dbGet(mainDb, 'SELECT id, file_path FROM photos WHERE id = ?', [mediaId]);
            } else if (routeType === 'video') {
                mediaRow = await dbGet(mainDb, 'SELECT id FROM videos WHERE id = ?', [mediaId]);
            } else {
                mediaRow = await dbGet(mainDb, 'SELECT id, name FROM audio WHERE id = ?', [mediaId]);
            }
            if (!mediaRow) {
                return res.status(404).json({ error: 'Existing media not found' });
            }

            const normalizedPath = `/${routeType}/${mediaId}`;
            const storedType = mediaType === 'gif' ? 'image' : mediaType;
            filePaths.push(normalizedPath);
            fileTypes.push(storedType);
            fileNames.push(mediaType === 'audio' ? (mediaRow.name || existing.name || 'Аудиозапись') : null);

            if (mediaType === 'image') newPhotoIds.push(mediaId);
            else if (mediaType === 'gif') newGifIds.push(mediaId);
            else if (mediaType === 'video') newVideoIds.push(mediaId);
            else if (mediaType === 'audio') newAudioIds.push(mediaId);
        }

        // 2. Process new file uploads
        for (const file of files) {
            const mimeType = file.mimetype;
            const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
            let folder = 'images';
            let filename = unique;
            let finalPath;
            let fileType = '';
            let metadataId = null;

            // GIF - preserve animation only after validating the real file signature.
            if (mimeType === 'image/gif') {
                if (!isValidGifBuffer(file.buffer)) {
                    const error = new Error('Invalid GIF file');
                    error.statusCode = 415;
                    throw error;
                }
                folder = 'images';
                filename = unique + '.gif';
                finalPath = path.join(__dirname, folder, filename);
                fs.writeFileSync(finalPath, file.buffer);
                fileType = 'gif';

                metadataId = await new Promise((resolve, reject) => {
                    mainDb.run(`
                        INSERT INTO photos (file_path, uploaded_by, created_at)
                        VALUES (?, ?, ?)
                    `, [`/${folder}/${filename}`, userId, Math.floor(Date.now() / 1000)], function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    });
                });
                if (metadataId) newGifIds.push(metadataId);
            }
            // Images (convert to webp)
            else if (mimeType.startsWith('image/')) {
                folder = 'images';
                filename = unique + '.webp';
                finalPath = path.join(__dirname, folder, filename);
                await sharp(file.buffer)
                    .resize({ width: 1200, withoutEnlargement: true })
                    .webp({ quality: 80 })
                    .toFile(finalPath);
                fileType = 'image';

                metadataId = await new Promise((resolve, reject) => {
                    mainDb.run(`
                        INSERT INTO photos (file_path, uploaded_by, created_at)
                        VALUES (?, ?, ?)
                    `, [`/${folder}/${filename}`, userId, Math.floor(Date.now() / 1000)], function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    });
                });
                if (metadataId) newPhotoIds.push(metadataId);
            }
            // Video
            else if (mimeType.startsWith('video/')) {
                folder = 'videos';
                const tempPath = path.join(__dirname, folder, 'temp_' + filename);
                finalPath = path.join(__dirname, folder, filename + '.mp4');
                fs.writeFileSync(tempPath, file.buffer);
                await new Promise((resolve, reject) => {
                    const ffmpeg = require('fluent-ffmpeg');
                    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
                    ffmpeg.setFfmpegPath(ffmpegPath);
                    ffmpeg(tempPath)
                        .videoCodec('libx264')
                        .audioCodec('aac')
                        .size('?x480')
                        .outputOptions(['-preset veryfast', '-crf 32', '-b:v 500k', '-movflags +faststart'])
                        .on('end', () => {
                            safeUnlinkTemporaryFile(tempPath);
                            resolve();
                        })
                        .on('error', (err) => {
                            safeUnlinkTemporaryFile(tempPath);
                            safeUnlinkTemporaryFile(finalPath);
                            reject(err);
                        })
                        .save(finalPath);
                });
                fileType = 'video';

                metadataId = await new Promise((resolve, reject) => {
                    mainDb.run(`
                        INSERT INTO videos (file_path, uploaded_by, created_at)
                        VALUES (?, ?, ?)
                    `, [`/${folder}/${filename}.mp4`, userId, Math.floor(Date.now() / 1000)], function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    });
                });
                if (metadataId) newVideoIds.push(metadataId);
            }
            // Audio - NOW PROCESSED PROPERLY
            else if (mimeType.startsWith('audio/')) {
                folder = 'audios';
                const tempPath = path.join(__dirname, folder, 'temp_' + filename);
                finalPath = path.join(__dirname, folder, filename + '.mp3');
                fs.writeFileSync(tempPath, file.buffer);
                await new Promise((resolve, reject) => {
                    const ffmpeg = require('fluent-ffmpeg');
                    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
                    ffmpeg.setFfmpegPath(ffmpegPath);
                    ffmpeg(tempPath)
                        .audioCodec('libmp3lame')
                        .audioBitrate('96k')
                        .audioChannels(1)
                        .outputOptions(['-q:a 5'])
                        .on('end', () => {
                            safeUnlinkTemporaryFile(tempPath);
                            resolve();
                        })
                        .on('error', (err) => {
                            console.error('Audio conversion error:', err);
                            safeUnlinkTemporaryFile(tempPath);
                            safeUnlinkTemporaryFile(finalPath);
                            reject(err);
                        })
                        .save(finalPath);
                });
                fileType = 'audio';
                
                const originalAudioName = path.basename(file.originalname || 'Аудиозапись', path.extname(file.originalname || '')) || 'Аудиозапись';
                metadataId = await new Promise((resolve, reject) => {
                    mainDb.run(`
                        INSERT INTO audio (file_path, name, artist_name, genre, uploaded_by, created_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [`/${folder}/${filename}.mp3`, originalAudioName, 'Неизвестно', '', userId, Math.floor(Date.now() / 1000)], function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    });
                });
                if (metadataId) newAudioIds.push(metadataId);
            }

            if (metadataId) {
                let routePath;
                if (fileType === 'image' || fileType === 'gif') {
                    routePath = `/photo/${metadataId}`;
                } else if (fileType === 'video') {
                    routePath = `/video/${metadataId}`;
                } else if (fileType === 'audio') {
                    routePath = `/audio/${metadataId}`;
                }
                filePaths.push(routePath);
                fileTypes.push(fileType);
                fileNames.push(fileType === 'audio'
                    ? (path.basename(file.originalname || 'Аудиозапись', path.extname(file.originalname || '')) || 'Аудиозапись')
                    : null);
            }
        }

        // 3. Get or create albums with proper added_at
        const now = Math.floor(Date.now() / 1000);
        
        // Get or create Photo Album
        let photoAlbum = await new Promise((resolve) => {
            mainDb.get(`
                SELECT id FROM user_photo_albums 
                WHERE user_id = ? AND title = ?
            `, [userId, `Фотографии ${username}`], (err, row) => {
                resolve(row);
            });
        });
        if (!photoAlbum && (newPhotoIds.length > 0 || newGifIds.length > 0)) {
            photoAlbum = await new Promise((resolve) => {
                mainDb.run(`
                    INSERT INTO user_photo_albums (user_id, title, created_at, is_system)
                    VALUES (?, ?, ?, 1)
                `, [userId, `Фотографии ${username}`, now], function(err) {
                    if (err) resolve(null);
                    else mainDb.get(`SELECT id FROM user_photo_albums WHERE rowid = ?`, [this.lastID], (err, row) => {
                        resolve(row);
                    });
                });
            });
        }

        // Get or create Video Album
        let videoAlbum = await new Promise((resolve) => {
            mainDb.get(`
                SELECT id FROM user_photo_albums 
                WHERE user_id = ? AND title = ?
            `, [userId, `Видеозаписи ${username}`], (err, row) => {
                resolve(row);
            });
        });
        if (!videoAlbum && newVideoIds.length > 0) {
            videoAlbum = await new Promise((resolve) => {
                mainDb.run(`
                    INSERT INTO user_photo_albums (user_id, title, created_at, is_system)
                    VALUES (?, ?, ?, 1)
                `, [userId, `Видеозаписи ${username}`, now], function(err) {
                    if (err) resolve(null);
                    else mainDb.get(`SELECT id FROM user_photo_albums WHERE rowid = ?`, [this.lastID], (err, row) => {
                        resolve(row);
                    });
                });
            });
        }

        // Get or create GIF Album
        let gifAlbum = await new Promise((resolve) => {
            mainDb.get(`
                SELECT id FROM user_photo_albums 
                WHERE user_id = ? AND title = ?
            `, [userId, `GIF-ки ${username}`], (err, row) => {
                resolve(row);
            });
        });
        if (!gifAlbum && newGifIds.length > 0) {
            gifAlbum = await new Promise((resolve) => {
                mainDb.run(`
                    INSERT INTO user_photo_albums (user_id, title, created_at, is_system)
                    VALUES (?, ?, ?, 1)
                `, [userId, `GIF-ки ${username}`, now], function(err) {
                    if (err) resolve(null);
                    else mainDb.get(`SELECT id FROM user_photo_albums WHERE rowid = ?`, [this.lastID], (err, row) => {
                        resolve(row);
                    });
                });
            });
        }

        // 4. Add to albums with added_at
        if (photoAlbum && newPhotoIds.length > 0) {
            await runPrepared(
                mainDb,
                `INSERT OR IGNORE INTO album_photos (album_id, photo_id, added_by, added_at) VALUES (?, ?, ?, ?)`,
                newPhotoIds.map(id => [photoAlbum.id, id, userId, now])
            );
        }

        if (gifAlbum && newGifIds.length > 0) {
            await runPrepared(
                mainDb,
                `INSERT OR IGNORE INTO album_photos (album_id, photo_id, added_by, added_at) VALUES (?, ?, ?, ?)`,
                newGifIds.map(id => [gifAlbum.id, id, userId, now])
            );
        }

        if (videoAlbum && newVideoIds.length > 0) {
            await runPrepared(
                mainDb,
                `INSERT OR IGNORE INTO album_videos (album_id, video_id, added_by, added_at) VALUES (?, ?, ?, ?)`,
                newVideoIds.map(id => [videoAlbum.id, id, userId, now])
            );
        }

        // Audio albums - create/get audio album and add
        if (newAudioIds.length > 0) {
            const audioAlbumTitle = `Аудиозаписи ${username}`;
            let audioAlbum = await new Promise((resolve) => {
                mainDb.get(`
                    SELECT id FROM user_photo_albums 
                    WHERE user_id = ? AND title = ?
                `, [userId, audioAlbumTitle], (err, row) => {
                    resolve(row);
                });
            });
            
            if (!audioAlbum) {
                audioAlbum = await new Promise((resolve) => {
                    mainDb.run(`
                        INSERT INTO user_photo_albums (user_id, title, created_at, is_system)
                        VALUES (?, ?, ?, 1)
                    `, [userId, audioAlbumTitle, now], function(err) {
                        if (err) resolve(null);
                        else mainDb.get(`SELECT id FROM user_photo_albums WHERE rowid = ?`, [this.lastID], (err, row) => {
                            resolve(row);
                        });
                    });
                });
            }

            if (audioAlbum) {
                // Use album_videos table for audios too (or create separate)
                // Actually, we need album_audios table or use album_photos with negative IDs
                // For now, let's just track them separately
                // We'll use album_photos but store audio IDs with a flag
                // Actually, let's just handle audio albums separately later
                // For now, audio files are uploaded and stored properly
                console.log(`📀 Audio album ${audioAlbumTitle} created with ${newAudioIds.length} tracks`);
            }
        }

        const postId = Date.now();
        const createdAt = Math.floor(Date.now() / 1000);

        // Insert post
        mainDb.run(`
            INSERT INTO posts (id, user_id, community_id, content, is_anonymous, created_at, searchable, show_in_feed, is_spoiler, is_nsfw, spoiler_preview)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        `, [postId, isAnonymous ? null : userId, communityId, content, isAnonymous ? 1 : 0, createdAt, showFeed, isSpoiler, isNsfw, spoilerPreview], async function(err) {
            if (err) {
                console.error('Error creating post:', err);
                return res.status(500).json({ success: false, error: 'Failed to create post' });
            }

            // Insert files with explicit Statement error handling.
            if (filePaths.length > 0) {
                try {
                    await runPrepared(
                        mainDb,
                        `
                            INSERT INTO post_files (post_id, file_path, file_type, file_order, display_name)
                            VALUES (?, ?, ?, ?, ?)
                        `,
                        filePaths.map((filePath, index) => [
                            postId,
                            filePath,
                            fileTypes[index],
                            index,
                            fileNames[index] || null
                        ])
                    );
                } catch (fileError) {
                    console.error('Error attaching files to post:', fileError);
                    return res.status(500).json({ success: false, error: 'Failed to attach files' });
                }
            }

            // Poll creation
            let pollResult = null;
            if (pollData && pollData.choices && pollData.choices.length > 0) {
                try {
                    const pollId = await new Promise((resolve, reject) => {
                        mainDb.run(`
                            INSERT INTO polls (post_id, title, multiple_choice, expires_at)
                            VALUES (?, ?, ?, ?)
                        `, [postId, pollData.title || 'Опрос', pollData.multiple_choice ? 1 : 0, pollData.expires_at || null], function(err) {
                            if (err) reject(err);
                            else resolve(this.lastID);
                        });
                    });

                    await runPrepared(
                        mainDb,
                        `
                            INSERT INTO poll_choices (poll_id, choice_order, content, image_path)
                            VALUES (?, ?, ?, ?)
                        `,
                        pollData.choices.map((choice, index) => [
                            pollId,
                            index,
                            choice.text || 'Вариант ' + (index + 1),
                            choice.image || null
                        ])
                    );

                    pollResult = {
                        id: pollId,
                        title: pollData.title || 'Опрос',
                        multiChoice: pollData.multiple_choice || false,
                        expiresAt: pollData.expires_at || null,
                        choices: pollData.choices.map((c, i) => ({
                            id: null,
                            text: c.text || 'Вариант ' + (i + 1),
                            image: c.image || null,
                            votes: 0,
                            userVoted: false
                        })),
                        totalVotes: 0
                    };
                } catch (pollErr) {
                    console.error('Error creating poll:', pollErr);
                }
            }

            // Invalidate caches if you have them
            // invalidateFeedCache();
            // if (communityId) invalidateCommunityCache(communityId);
            // if (!isAnonymous && userId) invalidateProfileCache(userId);

            res.json({
                success: true,
                post: {
                    id: postId,
                    userId: isAnonymous ? null : userId,
                    content: content,
                    files: filePaths,
                    fileTypes: fileTypes,
                    fileNames: fileNames,
                    community: communityId ? String(communityId) : '',
                    isAnonymous: isAnonymous,
                    createdAt: new Date(createdAt * 1000).toISOString(),
                    likes: [],
                    likeCount: 0,
                    comments: [],
                    spoiler: isSpoiler || 0,
                    nsfw: isNsfw || 0,
                    spoilerPreview: spoilerPreview || '',
                    poll: pollResult
                }
            });
        });

    } catch (error) {
        console.error('Post creation error:', error);
        res.status(500).json({ success: false, error: 'Failed to create post' });
    }
});


async function processAttachment(file, userId) {
    const fileType = file.mimetype.split('/')[0];
    const isGif = file.mimetype === 'image/gif';
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = isGif ? unique + '.gif' : unique + ext;
    let mediaId = null;
    const now = Math.floor(Date.now() / 1000);
    
    const user = await new Promise((resolve) => {
        mainDb.get(`SELECT username FROM users WHERE id = ?`, [userId], (err, row) => {
            resolve(row);
        });
    });
    const username = user?.username || '';
    
    if (fileType === 'image') {
        if (isGif) {
            if (!isValidGifBuffer(file.buffer)) throw new Error('Invalid GIF file');
            const gifPath = path.join(__dirname, 'images', filename);
            fs.writeFileSync(gifPath, file.buffer);
            const result = await new Promise((resolve, reject) => {
                mainDb.run(`
                    INSERT INTO photos (file_path, uploaded_by, created_at)
                    VALUES (?, ?, ?)
                `, [`/images/${filename}`, userId, now], function(err) {
                    if (err) reject(err);
                    else resolve(this);
                });
            });
            mediaId = result.lastID;
            
            // Get or create GIF album
            let album = await new Promise((resolve) => {
                mainDb.get(`
                    SELECT id FROM user_photo_albums 
                    WHERE user_id = ? AND title = ?
                `, [userId, `GIF-ки ${username}`], (err, row) => {
                    resolve(row);
                });
            });
            
            if (!album) {
                album = await new Promise((resolve) => {
                    mainDb.run(`
                        INSERT INTO user_photo_albums (user_id, title, created_at)
                        VALUES (?, ?, ?)
                    `, [userId, `GIF-ки ${username}`, now], function(err) {
                        if (err) resolve(null);
                        else mainDb.get(`SELECT id FROM user_photo_albums WHERE rowid = ?`, [this.lastID], (err, row) => {
                            resolve(row);
                        });
                    });
                });
            }
            
            if (album && mediaId) {
                await new Promise((resolve) => {
                    mainDb.run(`
                        INSERT OR IGNORE INTO album_photos (album_id, photo_id, added_by, added_at)
                        VALUES (?, ?, ?, ?)
                    `, [album.id, mediaId, userId, now], (err) => {
                        resolve();
                    });
                });
            }
            
            return { path: `/photo/${mediaId}`, type: 'image', mediaId: mediaId, isGif: true };
        } else {
            // Regular image
            const finalPath = path.join(__dirname, 'images', filename);
            await sharp(file.buffer)
                .resize({ width: 600, withoutEnlargement: true })
                .webp({ quality: 70 })
                .toFile(finalPath);
            const result = await new Promise((resolve, reject) => {
                mainDb.run(`
                    INSERT INTO photos (file_path, uploaded_by, created_at)
                    VALUES (?, ?, ?)
                `, [`/images/${filename}`, userId, now], function(err) {
                    if (err) reject(err);
                    else resolve(this);
                });
            });
            mediaId = result.lastID;
            
            // Get or create Photo album
            let album = await new Promise((resolve) => {
                mainDb.get(`
                    SELECT id FROM user_photo_albums 
                    WHERE user_id = ? AND title = ?
                `, [userId, `Фотографии ${username}`], (err, row) => {
                    resolve(row);
                });
            });
            
            if (!album) {
                album = await new Promise((resolve) => {
                    mainDb.run(`
                        INSERT INTO user_photo_albums (user_id, title, created_at)
                        VALUES (?, ?, ?)
                    `, [userId, `Фотографии ${username}`, now], function(err) {
                        if (err) resolve(null);
                        else mainDb.get(`SELECT id FROM user_photo_albums WHERE rowid = ?`, [this.lastID], (err, row) => {
                            resolve(row);
                        });
                    });
                });
            }
            
            if (album && mediaId) {
                await new Promise((resolve) => {
                    mainDb.run(`
                        INSERT OR IGNORE INTO album_photos (album_id, photo_id, added_by, added_at)
                        VALUES (?, ?, ?, ?)
                    `, [album.id, mediaId, userId, now], (err) => {
                        resolve();
                    });
                });
            }
            
            return { path: `/photo/${mediaId}`, type: 'image', mediaId: mediaId, isGif: false };
        }
    } else if (fileType === 'video') {
        const tempPath = path.join(__dirname, 'videos', 'temp_' + filename);
        const finalPath = path.join(__dirname, 'videos', filename);
        fs.writeFileSync(tempPath, file.buffer);
        
        const ffmpeg = require('fluent-ffmpeg');
        const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
        ffmpeg.setFfmpegPath(ffmpegPath);
        
        await new Promise((resolve, reject) => {
            ffmpeg(tempPath)
                .videoCodec('libx264')
                .audioCodec('aac')
                .size('?x240')
                .outputOptions(['-crf 51', '-preset ultrafast', '-b:v 64k', '-maxrate 128k', '-bufsize 128k', '-movflags +faststart'])
                .on('end', () => {
                    safeUnlinkTemporaryFile(tempPath);
                    resolve();
                })
                .on('error', (err) => {
                    safeUnlinkTemporaryFile(tempPath);
                    safeUnlinkTemporaryFile(finalPath);
                    reject(err);
                })
                .save(finalPath);
        });
        const result = await new Promise((resolve, reject) => {
            mainDb.run(`
                INSERT INTO videos (file_path, uploaded_by, created_at)
                VALUES (?, ?, ?)
            `, [`/videos/${filename}`, userId, now], function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
        mediaId = result.lastID;
        
        // Get or create Video album
        let album = await new Promise((resolve) => {
            mainDb.get(`
                SELECT id FROM user_photo_albums 
                WHERE user_id = ? AND title = ?
            `, [userId, `Видеозаписи ${username}`], (err, row) => {
                resolve(row);
            });
        });
        
        if (!album) {
            album = await new Promise((resolve) => {
                mainDb.run(`
                    INSERT INTO user_photo_albums (user_id, title, created_at)
                    VALUES (?, ?, ?)
                `, [userId, `Видеозаписи ${username}`, now], function(err) {
                    if (err) resolve(null);
                    else mainDb.get(`SELECT id FROM user_photo_albums WHERE rowid = ?`, [this.lastID], (err, row) => {
                        resolve(row);
                    });
                });
            });
        }
        
        if (album && mediaId) {
            await new Promise((resolve) => {
                mainDb.run(`
                    INSERT OR IGNORE INTO album_videos (album_id, video_id, added_by, added_at)
                    VALUES (?, ?, ?, ?)
                `, [album.id, mediaId, userId, now], (err) => {
                    resolve();
                });
            });
        }
        
        return { path: `/video/${mediaId}`, type: 'video', mediaId: mediaId, isGif: false };
    } else if (fileType === 'audio') {
        const tempPath = path.join(__dirname, 'audios', 'temp_' + filename);
        const finalPath = path.join(__dirname, 'audios', filename.replace(ext, '.mp3'));
        fs.writeFileSync(tempPath, file.buffer);
        
        const ffmpeg = require('fluent-ffmpeg');
        const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
        ffmpeg.setFfmpegPath(ffmpegPath);
        
        await new Promise((resolve, reject) => {
            ffmpeg(tempPath)
                .audioCodec('libmp3lame')
                .audioBitrate('96k')
                .audioChannels(1)
                .outputOptions(['-q:a 9'])
                .on('end', () => {
                    safeUnlinkTemporaryFile(tempPath);
                    resolve();
                })
                .on('error', (err) => {
                    safeUnlinkTemporaryFile(tempPath);
                    safeUnlinkTemporaryFile(finalPath);
                    reject(err);
                })
                .save(finalPath);
        });

        const audioPath = '/audios/' + filename.replace(ext, '.mp3');
        const originalName = path.basename(file.originalname || 'Аудиозапись', path.extname(file.originalname || '')) || 'Аудиозапись';
        const result = await dbRun(mainDb, `
            INSERT INTO audio (file_path, name, artist_name, genre, uploaded_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [audioPath, originalName, 'Неизвестно', '', userId, now]);
        mediaId = result.lastID;

        return { path: `/audio/${mediaId}`, type: 'audio', mediaId, isGif: false, name: originalName };
    }
    
    return { path: null, type: null, mediaId: null, isGif: false };
}

app.post('/api/posts/:id/comments', authenticate, uploadMedia.single('attachment'), async (req, res) => {
    try {
        const postId = parseInt(req.params.id);
        const content = req.body.content;
        const refId = req.body.refId;
        const isSpoiler = ['1', 'true', 'on'].includes(
            String(req.body.isSpoiler || '').toLowerCase()
        );
        const userId = req.userId;
        
        if (!content && !req.file && !req.body.existingAttachment) {
            return res.status(400).json({ error: 'Content or attachment required' });
        }
        
        const user = await new Promise((resolve, reject) => {
            mainDb.get(`SELECT username FROM users WHERE id = ?`, [userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        let attachmentPath = null;
        let attachmentType = null;
        let mediaId = null;
        let isGif = false;
        
        let existingAttachment = null;
        try {
            if (req.body.existingAttachment) {
                existingAttachment = JSON.parse(req.body.existingAttachment);
            }
        } catch (e) {}

        const now = Math.floor(Date.now() / 1000);
        const username = user.username || '';

        if (req.file) {
            // NEW FILE UPLOAD
            const result = await processAttachment(req.file, userId);
            attachmentPath = result.path;
            attachmentType = result.type;
            mediaId = result.mediaId;
            isGif = req.file.mimetype === 'image/gif';
            
            // Add to album with added_at
            if (mediaId && attachmentType === 'image') {
                let albumTitle = isGif ? `GIF-ки ${username}` : `Фотографии ${username}`;
                
                // Get or create album
                let album = await new Promise((resolve) => {
                    mainDb.get(`
                        SELECT id FROM user_photo_albums 
                        WHERE user_id = ? AND title = ?
                    `, [userId, albumTitle], (err, row) => {
                        resolve(row);
                    });
                });
                
                if (!album) {
                    album = await new Promise((resolve) => {
                        mainDb.run(`
                            INSERT INTO user_photo_albums (user_id, title, created_at)
                            VALUES (?, ?, ?)
                        `, [userId, albumTitle, now], function(err) {
                            if (err) resolve(null);
                            else mainDb.get(`SELECT id FROM user_photo_albums WHERE rowid = ?`, [this.lastID], (err, row) => {
                                resolve(row);
                            });
                        });
                    });
                }
                
                if (album) {
                    await new Promise((resolve) => {
                        mainDb.run(`
                            INSERT OR IGNORE INTO album_photos (album_id, photo_id, added_by, added_at)
                            VALUES (?, ?, ?, ?)
                        `, [album.id, mediaId, userId, now], (err) => {
                            resolve();
                        });
                    });
                }
            }
        } else if (existingAttachment && existingAttachment.path) {
            // EXISTING FILE FROM LIBRARY
            attachmentPath = existingAttachment.path;
            attachmentType = 'image';
            isGif = existingAttachment.isGif || false;
            
            if (attachmentPath.startsWith('/photo/')) {
                const id = parseInt(attachmentPath.replace('/photo/', ''));
                if (!isNaN(id)) mediaId = id;
            } else if (attachmentPath.startsWith('/video/')) {
                const id = parseInt(attachmentPath.replace('/video/', ''));
                if (!isNaN(id)) { mediaId = id; attachmentType = 'video'; }
            } else if (attachmentPath.startsWith('/audio/')) {
                const id = parseInt(attachmentPath.replace('/audio/', ''));
                if (!isNaN(id)) { mediaId = id; attachmentType = 'audio'; }
            }
        }
        
        const commentId = Math.floor(Math.random() * 9e12) + 1e12;
        const createdAt = Math.floor(Date.now() / 1000);
        
        await new Promise((resolve, reject) => {
            mainDb.run(`
                INSERT INTO comments (
                    id,
                    post_id,
                    user_id,
                    parent_comment_id,
                    content,
                    attachment_path,
                    attachment_type,
                    is_spoiler,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                commentId,
                postId,
                userId,
                refId || null,
                content || '',
                attachmentPath,
                attachmentType,
                isSpoiler ? 1 : 0,
                createdAt
            ], function(err) {
                if (err) reject(err);
                else resolve();
            });
        });
        
        res.json({
            success: true,
            comment: {
                id: commentId,
                userId: userId,
                username: user.username,
                content: content || '',
                reference: refId || null,
                isSpoiler,
                attachment: attachmentPath,
                attachmentType: attachmentType,
                createdAt: new Date(createdAt * 1000).toISOString(),
                likes: [],
                likeCount: 0
            }
        });
        
        // Notifications (unchanged)
        if (!refId) {
            mainDb.get(`SELECT user_id, is_anonymous FROM posts WHERE id = ?`, [postId], (err, post) => {
                if (!err && post && post.is_anonymous !== 1 && post.user_id !== userId) {
                    createNotification(post.user_id, 'comment_on_post', commentId);
                }
            });
        } else {
            mainDb.get(`SELECT user_id FROM comments WHERE id = ?`, [refId], (err, parentComment) => {
                if (!err && parentComment && parentComment.user_id !== userId) {
                    createNotification(parentComment.user_id, 'reply_to_comment', commentId);
                }
            });
        }
        
    } catch (error) {
        console.error('Comment error:', error);
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

app.post('/api/posts/:id/like', authenticate, (req, res) => {
    const postId = parseInt(req.params.id);
    const userId = req.userId;
    
    mainDb.get(`SELECT user_id, is_anonymous FROM posts WHERE id = ?`, [postId], (err, post) => {
        if (err || !post) {
            return res.status(404).json({ error: 'Post not found' });
        }
        
        mainDb.get(`SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?`, [postId, userId], (err, existingLike) => {
            if (err) {
                console.error('Like check error:', err);
                return res.status(500).json({ error: 'Failed to process like' });
            }
            
            mainDb.get(`SELECT 1 FROM post_dislikes WHERE post_id = ? AND user_id = ?`, [postId, userId], (err, existingDislike) => {
                if (err) {
                    console.error('Dislike check error:', err);
                    return res.status(500).json({ error: 'Failed to process like' });
                }
                
                if (existingLike) {
                    // UNLIKE: Remove the like
                    mainDb.run(`DELETE FROM post_likes WHERE post_id = ? AND user_id = ?`, [postId, userId], (err) => {
                        if (err) {
                            console.error('Unlike error:', err);
                            return res.status(500).json({ error: 'Failed to unlike' });
                        }
                        
                        mainDb.get(`SELECT 
                            (SELECT COUNT(*) FROM post_likes WHERE post_id = ?) as likeCount,
                            (SELECT COUNT(*) FROM post_dislikes WHERE post_id = ?) as dislikeCount`,
                        [postId, postId], (err, counts) => {
                            res.json({ 
                                success: true, 
                                liked: false, 
                                disliked: false,
                                likeCount: counts.likeCount,
                                dislikeCount: counts.dislikeCount
                            });
                        });
                    });
                } else {
                    // LIKE: Remove any existing dislike first, then add like
                    const removeDislike = existingDislike ? 
                        new Promise((resolve) => {
                            mainDb.run(`DELETE FROM post_dislikes WHERE post_id = ? AND user_id = ?`, [postId, userId], (err) => {
                                if (err) console.error('Dislike removal error:', err);
                                resolve();
                            });
                        }) : Promise.resolve();
                    
                    removeDislike.then(() => {
                        mainDb.run(`INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)`, [postId, userId], (err) => {
                            if (err) {
                                console.error('Like error:', err);
                                return res.status(500).json({ error: 'Failed to like' });
                            }
                            
                            mainDb.get(`SELECT 
                                (SELECT COUNT(*) FROM post_likes WHERE post_id = ?) as likeCount,
                                (SELECT COUNT(*) FROM post_dislikes WHERE post_id = ?) as dislikeCount`,
                            [postId, postId], (err, counts) => {
                                // Send notification only if not own post and not anonymous
                                if (post && !post.is_anonymous && post.user_id !== userId) {
                                    createNotification(post.user_id, 'like_on_post', postId);
                                }
                                res.json({ 
                                    success: true, 
                                    liked: true, 
                                    disliked: false,
                                    likeCount: counts.likeCount,
                                    dislikeCount: counts.dislikeCount
                                });
                            });
                        });
                    });
                }
            });
        });
    });
});
app.post('/api/posts/:id/dislike', authenticate, (req, res) => {
    const postId = parseInt(req.params.id);
    const userId = req.userId;
    
    // First, check if post exists
    mainDb.get(`SELECT user_id, is_anonymous FROM posts WHERE id = ?`, [postId], (err, post) => {
        if (err || !post) {
            return res.status(404).json({ error: 'Post not found' });
        }
        
        // Get current states
        mainDb.get(`SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?`, [postId, userId], (err, existingLike) => {
            if (err) {
                console.error('Like check error:', err);
                return res.status(500).json({ error: 'Failed to process dislike' });
            }
            
            mainDb.get(`SELECT 1 FROM post_dislikes WHERE post_id = ? AND user_id = ?`, [postId, userId], (err, existingDislike) => {
                if (err) {
                    console.error('Dislike check error:', err);
                    return res.status(500).json({ error: 'Failed to process dislike' });
                }
                
                if (existingDislike) {
                    // UNDISLIKE: Remove the dislike
                    mainDb.run(`DELETE FROM post_dislikes WHERE post_id = ? AND user_id = ?`, [postId, userId], (err) => {
                        if (err) {
                            console.error('Undislike error:', err);
                            return res.status(500).json({ error: 'Failed to undislike' });
                        }
                        
                        // Get updated counts
                        mainDb.get(`SELECT 
                            (SELECT COUNT(*) FROM post_likes WHERE post_id = ?) as likeCount,
                            (SELECT COUNT(*) FROM post_dislikes WHERE post_id = ?) as dislikeCount`,
                        [postId, postId], (err, counts) => {
                            res.json({ 
                                success: true, 
                                liked: false, 
                                disliked: false,
                                likeCount: counts.likeCount,
                                dislikeCount: counts.dislikeCount
                            });
                        });
                    });
                } else {
                    // DISLIKE: Remove any existing like first, then add dislike
                    const removeLike = existingLike ? 
                        new Promise((resolve) => {
                            mainDb.run(`DELETE FROM post_likes WHERE post_id = ? AND user_id = ?`, [postId, userId], (err) => {
                                if (err) console.error('Like removal error:', err);
                                resolve();
                            });
                        }) : Promise.resolve();
                    
                    removeLike.then(() => {
                        mainDb.run(`INSERT INTO post_dislikes (post_id, user_id) VALUES (?, ?)`, [postId, userId], (err) => {
                            if (err) {
                                console.error('Dislike error:', err);
                                return res.status(500).json({ error: 'Failed to dislike' });
                            }
                            
                            // Get updated counts
                            mainDb.get(`SELECT 
                                (SELECT COUNT(*) FROM post_likes WHERE post_id = ?) as likeCount,
                                (SELECT COUNT(*) FROM post_dislikes WHERE post_id = ?) as dislikeCount`,
                            [postId, postId], (err, counts) => {
                                res.json({ 
                                    success: true, 
                                    liked: false, 
                                    disliked: true,
                                    likeCount: counts.likeCount,
                                    dislikeCount: counts.dislikeCount
                                });
                            });
                        });
                    });
                }
            });
        });
    });
});

app.post('/api/polls/vote', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        let { choiceId, choiceIds } = req.body;
        
        // Handle both single and multi-choice
        if (!choiceId && !choiceIds) {
            return res.status(400).json({ error: 'choiceId or choiceIds required' });
        }
        
        // If single choice, convert to array
        if (choiceId) {
            choiceIds = [choiceId];
        }
        
        if (!choiceIds || choiceIds.length === 0) {
            return res.status(400).json({ error: 'No choices provided' });
        }
        
        // Get poll info from first choice
        const firstChoice = await new Promise((resolve, reject) => {
            mainDb.get(`
                SELECT pc.id, pc.poll_id, p.multiple_choice, p.expires_at
                FROM poll_choices pc
                JOIN polls p ON pc.poll_id = p.id
                WHERE pc.id = ?
            `, [choiceIds[0]], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!firstChoice) {
            return res.status(404).json({ error: 'Choice not found' });
        }
        
        // Check if poll expired
        if (firstChoice.expires_at && firstChoice.expires_at < Math.floor(Date.now() / 1000)) {
            return res.status(400).json({ error: 'Poll has expired' });
        }
        
        // For multi-choice, validate all choices belong to same poll
        if (firstChoice.multiple_choice && choiceIds.length > 1) {
            for (const id of choiceIds) {
                const check = await new Promise((resolve) => {
                    mainDb.get(`SELECT poll_id FROM poll_choices WHERE id = ?`, [id], (err, row) => {
                        resolve(row);
                    });
                });
                if (!check || check.poll_id !== firstChoice.poll_id) {
                    return res.status(400).json({ error: 'All choices must belong to the same poll' });
                }
            }
        }
        
        // For single choice, remove existing votes
        if (!firstChoice.multiple_choice) {
            await new Promise((resolve) => {
                mainDb.run(`
                    DELETE FROM poll_votes
                    WHERE choice_id IN (SELECT id FROM poll_choices WHERE poll_id = ?) AND user_id = ?
                `, [firstChoice.poll_id, userId], () => resolve());
            });
        }
        
        // Insert votes. Always handle Statement errors: sqlite3 emits an
        // unhandled "error" event when stmt.run() has no callback.
        await runPrepared(
            mainDb,
            `INSERT OR IGNORE INTO poll_votes (choice_id, user_id) VALUES (?, ?)`,
            choiceIds.map(id => [id, userId])
        );
        
        // Get updated vote counts for the poll
        const updatedChoices = await new Promise((resolve, reject) => {
            mainDb.all(`
                SELECT 
                    pc.id,
                    pc.content,
                    pc.image_path,
                    COUNT(pv.id) as votes,
                    EXISTS(
                        SELECT 1 FROM poll_votes pv2 
                        WHERE pv2.choice_id = pc.id 
                        AND pv2.user_id = ?
                    ) as user_voted
                FROM poll_choices pc
                LEFT JOIN poll_votes pv ON pv.choice_id = pc.id
                WHERE pc.poll_id = ?
                GROUP BY pc.id
                ORDER BY pc.choice_order
            `, [userId, firstChoice.poll_id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        const totalVotes = await new Promise((resolve) => {
            mainDb.get(`
                SELECT COUNT(DISTINCT user_id) as count
                FROM poll_votes pv
                JOIN poll_choices pc ON pc.id = pv.choice_id
                WHERE pc.poll_id = ?
            `, [firstChoice.poll_id], (err, row) => {
                resolve(row ? row.count : 0);
            });
        });
        
        res.json({
            success: true,
            choices: updatedChoices.map(c => ({
                id: c.id,
                text: c.content,
                image: c.image_path,
                votes: c.votes,
                userVoted: !!c.user_voted
            })),
            totalVotes: totalVotes || 0
        });
        
    } catch (error) {
        console.error('Vote error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/polls/vote', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const { choiceId } = req.body;

        if (!choiceId) {
            return res.status(400).json({ error: 'choiceId required' });
        }

        // Check if vote exists
        const vote = await new Promise((resolve, reject) => {
            mainDb.get(`
                SELECT pv.id, pc.poll_id
                FROM poll_votes pv
                JOIN poll_choices pc ON pc.id = pv.choice_id
                WHERE pv.choice_id = ? AND pv.user_id = ?
            `, [choiceId, userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!vote) {
            return res.status(404).json({ error: 'Vote not found' });
        }

        // Delete the vote
        await new Promise((resolve, reject) => {
            mainDb.run(`
                DELETE FROM poll_votes
                WHERE choice_id = ? AND user_id = ?
            `, [choiceId, userId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Get updated vote counts for the poll
        const updatedChoices = await new Promise((resolve, reject) => {
            mainDb.all(`
                SELECT 
                    pc.id,
                    pc.content,
                    pc.image_path,
                    COUNT(pv.id) as votes,
                    EXISTS(
                        SELECT 1 FROM poll_votes pv2 
                        WHERE pv2.choice_id = pc.id 
                        AND pv2.user_id = ?
                    ) as user_voted
                FROM poll_choices pc
                LEFT JOIN poll_votes pv ON pv.choice_id = pc.id
                WHERE pc.poll_id = ?
                GROUP BY pc.id
                ORDER BY pc.choice_order
            `, [userId, vote.poll_id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        const totalVotes = updatedChoices.reduce((sum, c) => sum + c.votes, 0);

        res.json({
            success: true,
            choices: updatedChoices.map(c => ({
                id: c.id,
                text: c.content,
                image: c.image_path,
                votes: c.votes,
                userVoted: !!c.user_voted
            })),
            totalVotes: totalVotes
        });

    } catch (error) {
        console.error('Delete vote error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/posts/:postId/comments/:commentId/like', authenticate, (req, res) => {
    const commentId = req.params.commentId;
    const userId = req.userId;
    
    mainDb.get(`SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ?`, [commentId, userId], (err, existing) => {
        if (err) {
            console.error('Comment like check error:', err);
            return res.status(500).json({ error: 'Failed to process like' });
        }
        
        if (existing) {
            mainDb.run(`DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?`, [commentId, userId], (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to unlike' });
                }
                mainDb.get(`SELECT COUNT(*) as count FROM comment_likes WHERE comment_id = ?`, [commentId], (err, row) => {
                    res.json({ success: true, liked: false, likeCount: row.count });
                });
            });
        } else {
            mainDb.run(`INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)`, [commentId, userId], (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to like' });
                }
                mainDb.get(`SELECT COUNT(*) as count FROM comment_likes WHERE comment_id = ?`, [commentId], (err, row) => {
                    res.json({ success: true, liked: true, likeCount: row.count });
                });
		if (!existing) {
    mainDb.get(`SELECT user_id FROM comments WHERE id = ?`, [commentId], (err, comment) => {
        if (!err && comment && comment.user_id !== userId) {
            createNotification(comment.user_id, 'like_on_comment', commentId);
        }
    });
}
            });
        }
    });
});

app.get('/api/comments/:commentId', async (req, res) => {
    const commentId = parseFloat(req.params.commentId);
    
    mainDb.get(`
        SELECT 
            c.id,
            c.user_id,
            u.username,
            c.content,
            c.parent_comment_id as reference,
            c.is_spoiler,
            c.attachment_path,
            c.attachment_type,
            c.created_at,
            c.likes,
            c.like_count
        FROM comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.id = ?
    `, [commentId], (err, comment) => {
        if (err) {
            console.error('Error fetching comment:', err);
            return res.status(500).json({ error: 'Failed to load comment' });
        }
        
        if (!comment) {
            return res.status(404).json({ error: 'Comment not found' });
        }
        
        // Parse likes if stored as JSON string
        let likes = [];
        if (comment.likes) {
            try {
                likes = JSON.parse(comment.likes);
            } catch (e) {
                likes = [];
            }
        }
        
        res.json({
            id: comment.id,
            userId: comment.user_id,
            username: comment.username,
            content: comment.content,
            reference: comment.reference || -1,
            isSpoiler: Boolean(comment.is_spoiler),
            attachment: comment.attachment_path,
            attachmentType: comment.attachment_type,
            createdAt: new Date(comment.created_at * 1000).toISOString(),
            likes: likes,
            likeCount: comment.like_count || 0,
            reply_count: 0
        });
    });
});

app.put('/api/posts/:id', authenticate, uploadMedia.array('files', 10), async (req, res) => {
    const postId = Number(req.params.id);
    const userId = req.userId;

    if (!Number.isSafeInteger(postId)) {
        return res.status(400).json({ error: 'Invalid post ID' });
    }

    try {
        const post = await dbGet(
            mainDb,
            'SELECT id, user_id, is_anonymous FROM posts WHERE id = ?',
            [postId]
        );
        if (!post) return res.status(404).json({ error: 'Post not found' });
        if (post.is_anonymous || post.user_id !== userId) {
            return res.status(403).json({ error: 'Not authorized to edit this post' });
        }

        let attachmentOrder;
        try {
            attachmentOrder = JSON.parse(req.body.attachmentOrder || '[]');
        } catch {
            return res.status(400).json({ error: 'Invalid attachment order' });
        }

        if (!Array.isArray(attachmentOrder) || attachmentOrder.length > 10) {
            return res.status(400).json({ error: 'A post can contain at most 10 files' });
        }

        const uploadedFiles = req.files || [];
        const referencedUploadIndexes = attachmentOrder
            .filter(item => item?.kind === 'new')
            .map(item => Number(item.uploadIndex));
        if (
            referencedUploadIndexes.length !== uploadedFiles.length ||
            referencedUploadIndexes.some((index, position, indexes) =>
                !Number.isInteger(index) || index < 0 || index >= uploadedFiles.length || indexes.indexOf(index) !== position
            )
        ) {
            return res.status(400).json({ error: 'Invalid uploaded attachment order' });
        }

        const currentFiles = await dbAll(
            mainDb,
            'SELECT file_path, file_type, display_name FROM post_files WHERE post_id = ?',
            [postId]
        );
        const currentFileKeys = new Set(currentFiles.map(file => `${file.file_type}\n${file.file_path}`));
        const processedUploads = new Map();

        for (const uploadIndex of referencedUploadIndexes) {
            const result = await processAttachment(uploadedFiles[uploadIndex], userId);
            if (!result.path || !result.type) {
                return res.status(415).json({ error: 'Unsupported attachment type' });
            }
            processedUploads.set(uploadIndex, result);
        }

        const finalFiles = [];
        for (const item of attachmentOrder) {
            if (item?.kind === 'existing') {
                const filePath = typeof item.path === 'string' ? item.path : '';
                const fileType = typeof item.type === 'string' ? item.type : '';
                if (!currentFileKeys.has(`${fileType}\n${filePath}`)) {
                    return res.status(400).json({ error: 'Invalid existing attachment' });
                }
                const currentFile = currentFiles.find(file => file.file_path === filePath && file.file_type === fileType);
                finalFiles.push({ path: filePath, type: fileType, name: currentFile?.display_name || null });
            } else if (item?.kind === 'new') {
                const result = processedUploads.get(Number(item.uploadIndex));
                if (!result) return res.status(400).json({ error: 'Missing uploaded attachment' });
                finalFiles.push({ path: result.path, type: result.type, name: result.name || uploadedFiles[Number(item.uploadIndex)]?.originalname || null });
            } else {
                return res.status(400).json({ error: 'Invalid attachment entry' });
            }
        }

        await dbRun(mainDb, 'BEGIN IMMEDIATE TRANSACTION');
        try {
            await dbRun(mainDb, 'UPDATE posts SET content = ? WHERE id = ?', [req.body.content || '', postId]);
            await dbRun(mainDb, 'DELETE FROM post_files WHERE post_id = ?', [postId]);
            for (let index = 0; index < finalFiles.length; index++) {
                const file = finalFiles[index];
                await dbRun(mainDb, `
                    INSERT INTO post_files (post_id, file_path, file_type, file_order, display_name)
                    VALUES (?, ?, ?, ?, ?)
                `, [postId, file.path, file.type, index, file.name || null]);
            }
            await dbRun(mainDb, 'COMMIT');
        } catch (error) {
            await dbRun(mainDb, 'ROLLBACK').catch(() => {});
            throw error;
        }

        res.json({
            success: true,
            post: {
                id: postId,
                content: req.body.content || '',
                files: finalFiles.map(file => file.path),
                fileTypes: finalFiles.map(file => file.type),
                fileNames: finalFiles.map(file => file.name || null)
            }
        });
    } catch (error) {
        console.error('Update error:', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Failed to update post' });
    }
});

app.delete('/api/posts/:id', authenticate, async (req, res) => {
    const postId = Number(req.params.id);
    const userId = req.userId;
    if (!Number.isSafeInteger(postId)) return res.status(400).json({ error: 'Invalid post ID' });

    try {
        const post = await dbGet(mainDb, 'SELECT user_id, is_anonymous FROM posts WHERE id = ?', [postId]);
        if (!post) return res.status(404).json({ error: 'Post not found' });

        const isOwner = post.user_id === userId && !post.is_anonymous;
        const capabilities = isOwner ? null : await getUserCapabilities(userId);
        const canModerate = Boolean(capabilities && (
            capabilities.isAdmin || capabilities.isDeveloper || capabilities.isModerator
        ));
        if (!isOwner && !canModerate) return res.status(403).json({ error: 'Not authorized' });

        if (canModerate) {
            await dbRun(mainDb, `
                INSERT INTO moderation_audit_log
                    (moderator_user_id, post_id, action, details, created_at)
                VALUES (?, ?, 'delete_post', ?, ?)
            `, [userId, postId, JSON.stringify({ ownerId: post.user_id }), Math.floor(Date.now() / 1000)]);
        }
        await dbRun(mainDb, 'DELETE FROM profile_pinned_posts WHERE post_id = ?', [postId]);
        deletePostFiles(postId, () => {
            deletePostData(postId, res).catch(error => {
                console.error('Delete post data error:', error);
                if (!res.headersSent) res.status(500).json({ error: 'Failed to delete post' });
            });
        });
    } catch (error) {
        console.error('Delete post authorization error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

function deletePostFiles(postId, callback) {
    // Get all files first to delete from disk
    mainDb.all(`SELECT file_path FROM post_files WHERE post_id = ?`, [postId], (err, files) => {
        if (files) {
            files.forEach(file => deleteManagedMediaFile(file.file_path));
        }
        callback();
    });
}

async function deletePostData(postId, res) {
    await dbRun(mainDb, 'BEGIN IMMEDIATE TRANSACTION');
    try {
        await dbRun(mainDb, 'DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE post_id = ?)', [postId]);
        await dbRun(mainDb, 'DELETE FROM comments WHERE post_id = ?', [postId]);
        await dbRun(mainDb, 'DELETE FROM post_likes WHERE post_id = ?', [postId]);
        await dbRun(mainDb, 'DELETE FROM post_dislikes WHERE post_id = ?', [postId]);
        await dbRun(mainDb, 'DELETE FROM post_files WHERE post_id = ?', [postId]);
        await dbRun(mainDb, 'DELETE FROM post_tags WHERE post_id = ?', [postId]);
        await dbRun(mainDb, 'DELETE FROM posts WHERE id = ?', [postId]);
        await dbRun(mainDb, 'COMMIT');
        res.json({ success: true });
    } catch (error) {
        await dbRun(mainDb, 'ROLLBACK').catch(() => {});
        throw error;
    }
}

// Get single post by ID
app.get('/api/posts/:id', optionalAuth, async (req, res) => {
    const postId = parseInt(req.params.id);
    const currentUserId = req.userId || 0;

    if (!postId || isNaN(postId)) {
        return res.status(400).json({ error: 'Invalid post ID' });
    }

    try {
        const result = await fetchPosts({
            postId: postId,
            currentUserId: currentUserId
        });

        if (!result.posts || result.posts.length === 0) {
            return res.status(404).json({ error: 'Post not found' });
        }

        res.json(result.posts[0]);
    } catch (err) {
        console.error('Single post error:', err);
        res.status(500).json({ error: 'Failed to load post' });
    }
});

// ============ PROFILE ROUTES ============
app.get('/api/users', async (req, res) => {
  try {
    const users = await dbAll(mainDb, `
      SELECT u.id, u.username, u.profile_picture, u.status
      FROM users u
      WHERE u.searchable = 1
      ORDER BY u.username ASC
    `);
    const safeUsers = users.map(user => ({
      id: user.id,
      username: user.username,
      profilePicture: user.profile_picture || null,
      status: user.status || ''
    }));
    res.json(await addPublicRoles(safeUsers));
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

app.get('/api/users/:userId/friends', optionalAuth, async (req, res) => {
    const profileUserId = parseInt(req.params.userId);
    const currentUserId = req.userId || null;
    
    // Check if user exists first
    mainDb.get(`SELECT id FROM users WHERE id = ?`, [profileUserId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // If viewing own profile - always allowed
        if (currentUserId == profileUserId) {
            return getFriendsList(profileUserId, res);
        }
        
        // Get privacy setting - default to 0 (visible to anyone)
        mainDb.get(
            `SELECT show_friends_list FROM user_settings_privacy WHERE user_id = ?`,
            [profileUserId],
            (err, row) => {
                if (err) {
                    console.error('Privacy check error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }
                
                // Default to 0 - visible to anyone
                const setting = row ? row.show_friends_list : 0;
                
                // 0 - show to anyone
                if (setting == 0) {
                    return getFriendsList(profileUserId, res);
                }
                
                // 2 - show to no one (except self, already handled)
                if (setting == 2) {
                    return res.json([]);
                }
                
                // 1 - show only to friends
                if (setting == 1) {
                    if (!currentUserId) {
                        return res.json([]);
                    }
                    
                    // Check if current user is friends with profile user
                    mainDb.get(
                        `SELECT 1 FROM user_connections 
                         WHERE ((user_sender_id = ? AND user_reciever_id = ?) OR
                                (user_sender_id = ? AND user_reciever_id = ?))
                         AND status = 1`,
                        [currentUserId, profileUserId, profileUserId, currentUserId],
                        (err, isFriend) => {
                            if (err) {
                                console.error('Friend check error:', err);
                                return res.status(500).json({ error: 'Server error' });
                            }
                            
                            if (!isFriend) {
                                return res.json([]);
                            }
                            
                            getFriendsList(profileUserId, res);
                        }
                    );
                } else {
                    return res.json([]);
                }
            }
        );
    });
});

function getFriendsList(userId, res) {
    mainDb.all(
        `SELECT DISTINCT u.id, u.username, u.profile_picture
         FROM user_connections uc
         JOIN users u ON (
             (uc.user_sender_id = ? AND uc.user_reciever_id = u.id) OR
             (uc.user_reciever_id = ? AND uc.user_sender_id = u.id)
         )
         WHERE uc.status = 1
         ORDER BY u.username ASC`,
        [userId, userId],
        async (err, friends) => {
            if (err) {
                console.error('Error fetching friends:', err);
                return res.status(500).json({ error: 'Failed to load friends' });
            }
            if (!friends || friends.length === 0) return res.json([]);

            const formattedFriends = friends.map(f => ({
                id: f.id,
                username: f.username,
                profilePicture: f.profile_picture || null
            }));
            try {
                res.json(await addPublicRoles(formattedFriends));
            } catch (error) {
                console.error('Failed to enrich friend roles:', error);
                res.status(500).json({ error: 'Failed to load friends' });
            }
        }
    );
}

function getFriends(userId) {
    return new Promise((resolve, reject) => {
        mainDb.all(
            `SELECT DISTINCT u.id, u.username, u.profile_picture
             FROM user_connections uc
             JOIN users u ON (
                 (uc.user_sender_id = ? AND uc.user_reciever_id = u.id) OR
                 (uc.user_reciever_id = ? AND uc.user_sender_id = u.id)
             )
             WHERE uc.status = 1
             ORDER BY u.username ASC`,
            [userId, userId],
            (err, friends) => {
                if (err) {
                    console.error('Error fetching friends:', err);
                    reject(err);  // Pass error to the caller
                    return;
                }
                
                if (!friends || friends.length === 0) {
                    resolve([]);  // Return empty array
                    return;
                }
                
                const formattedFriends = friends.map(f => ({
                    id: f.id,
                    username: f.username,
                    profilePicture: f.profile_picture || null
                }));
                
                resolve(formattedFriends);  // Return the data
            }
        );
    });
}

function getCommunities(userId) {
    return new Promise((resolve, reject) => {
        mainDb.all(
            `SELECT community_id
             FROM community_subscribers
             WHERE user_id = ?
	    `,
            [userId],
            (err, communities) => {
                if (err) {
                    console.error('Error fetching communities:', err);
                    reject(err);  // Pass error to the caller
                    return;
                }
                
                if (!communities || communities.length === 0) {
                    resolve([]);  // Return empty array
                    return;
                }
                
                const formattedCommunities = communities.map(c => ({id: c.community_id}));
                
                resolve(formattedCommunities);  // Return the data
            }
        );
    });
}

app.get('/api/users/:userId/communities', optionalAuth, async (req, res) => {
    const profileUserId = parseInt(req.params.userId);
    const currentUserId = req.userId || null;
    
    // Check if user exists first
    mainDb.get(`SELECT id FROM users WHERE id = ?`, [profileUserId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // If viewing own profile - always allowed
        if (currentUserId == profileUserId) {
            return getCommunitiesList(profileUserId, res);
        }
        
        // Get privacy setting - default to 0 (visible to anyone)
        mainDb.get(
            `SELECT show_communities_list FROM user_settings_privacy WHERE user_id = ?`,
            [profileUserId],
            (err, row) => {
                if (err) {
                    console.error('Privacy check error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }
                
                // Default to 0 - visible to anyone
                const setting = row ? row.show_communities_list : 0;
                
                // 0 - show to anyone
                if (setting == 0) {
                    return getCommunitiesList(profileUserId, res);
                }
                
                // 2 - show to no one (except self, already handled)
                if (setting == 2) {
                    return res.json([]);
                }
                
                // 1 - show only to friends
                if (setting == 1) {
                    if (!currentUserId) {
                        return res.json([]);
                    }
                    
                    // Check if current user is friends with profile user
                    mainDb.get(
                        `SELECT 1 FROM user_connections 
                         WHERE ((user_sender_id = ? AND user_reciever_id = ?) OR
                                (user_sender_id = ? AND user_reciever_id = ?))
                         AND status = 1`,
                        [currentUserId, profileUserId, profileUserId, currentUserId],
                        (err, isFriend) => {
                            if (err) {
                                console.error('Friend check error:', err);
                                return res.status(500).json({ error: 'Server error' });
                            }
                            
                            if (!isFriend) {
                                return res.json([]);
                            }
                            
                            getCommunitiesList(profileUserId, res);
                        }
                    );
                } else {
                    return res.json([]);
                }
            }
        );
    });
});

// GET /api/users/:userId/commIds - Optimized endpoint returning only community IDs and names
app.get('/api/users/:userId/commIds', optionalAuth, async (req, res) => {
    try {
        const targetUserId = parseInt(req.params.userId);

        if (isNaN(targetUserId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const communities = await dbAll(mainDb, `
            SELECT c.id, c.username
            FROM community_subscribers cs
            JOIN communities c ON cs.community_id = c.id
            WHERE cs.user_id = ?
            ORDER BY c.id ASC
        `, [targetUserId]);

        res.json(communities);
    } catch (error) {
        console.error('Error fetching user community IDs:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

function getCommunitiesList(userId, res) {
    mainDb.all(
        `SELECT c.id, c.username, c.profile_picture, c.type
         FROM community_subscribers cs
         JOIN communities c ON cs.community_id = c.id
         WHERE cs.user_id = ?
         ORDER BY c.username ASC`,
        [userId],
        (err, communities) => {
            if (err) {
                console.error('Error fetching communities:', err);
                return res.status(500).json({ error: 'Failed to load communities' });
            }

            if (!communities || communities.length === 0) {
                return res.json([]);
            }

            const formattedCommunities = communities.map(c => ({
                id: c.id,
                username: c.username,
                profilePicture: c.profile_picture || null,
                type: c.type || 'community'
            }));

            res.json(formattedCommunities);
        }
    );
}

app.post('/api/announcements', authenticate, requireDeveloper, async (req, res) => {
    try {
        const text = String(req.body.text || '').trim();
        const expiresAt = req.body.expiresAt == null ? null : Number(req.body.expiresAt);
        if (!text || text.length > 1000) {
            return res.status(400).json({ error: 'Announcement text must contain 1-1000 characters' });
        }
        if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000))) {
            return res.status(400).json({ error: 'Invalid expiration time' });
        }

        const now = Math.floor(Date.now() / 1000);
        const result = await dbRun(mainDb, `
            INSERT INTO global_announcements
                (sender_user_id, text, created_at, expires_at, is_active)
            VALUES (?, ?, ?, ?, 1)
        `, [req.userId, text, now, expiresAt]);
        const sender = await dbGet(mainDb, 'SELECT username FROM users WHERE id = ?', [req.userId]);

        res.status(201).json({
            success: true,
            announcement: {
                id: result.lastID,
                text,
                senderUserId: req.userId,
                senderUsername: sender?.username || '',
                createdAt: new Date(now * 1000).toISOString(),
                expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
                isActive: true
            }
        });
    } catch (error) {
        console.error('Create announcement error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/announcements/history', authenticate, requireDeveloper, async (req, res) => {
    try {
        const announcements = await dbAll(mainDb, `
            SELECT ga.id, ga.text, ga.created_at, ga.expires_at, ga.is_active,
                   ga.sender_user_id, u.username AS sender_username,
                   COUNT(gad.user_id) AS dismissal_count
            FROM global_announcements ga
            JOIN users u ON u.id = ga.sender_user_id
            LEFT JOIN global_announcement_dismissals gad ON gad.announcement_id = ga.id
            GROUP BY ga.id
            ORDER BY ga.created_at DESC
            LIMIT 200
        `);
        res.json({
            announcements: announcements.map(item => ({
                id: item.id,
                text: item.text,
                senderUserId: item.sender_user_id,
                senderUsername: item.sender_username,
                createdAt: new Date(item.created_at * 1000).toISOString(),
                expiresAt: item.expires_at ? new Date(item.expires_at * 1000).toISOString() : null,
                isActive: Boolean(item.is_active),
                dismissalCount: item.dismissal_count || 0
            }))
        });
    } catch (error) {
        console.error('Announcement history error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/announcements/:announcementId/dismiss', authenticate, async (req, res) => {
    const announcementId = Number(req.params.announcementId);
    if (!Number.isSafeInteger(announcementId)) {
        return res.status(400).json({ error: 'Invalid announcement ID' });
    }

    try {
        const announcement = await dbGet(
            mainDb,
            'SELECT id FROM global_announcements WHERE id = ?',
            [announcementId]
        );
        if (!announcement) return res.status(404).json({ error: 'Announcement not found' });

        await dbRun(mainDb, `
            INSERT OR IGNORE INTO global_announcement_dismissals
                (announcement_id, user_id, dismissed_at)
            VALUES (?, ?, ?)
        `, [announcementId, req.userId, Math.floor(Date.now() / 1000)]);
        res.json({ success: true });
    } catch (error) {
        console.error('Dismiss announcement error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.patch('/api/announcements/:announcementId', authenticate, requireDeveloper, async (req, res) => {
    const announcementId = Number(req.params.announcementId);
    if (!Number.isSafeInteger(announcementId) || typeof req.body.isActive !== 'boolean') {
        return res.status(400).json({ error: 'Invalid announcement update' });
    }

    try {
        const result = await dbRun(mainDb, `
            UPDATE global_announcements SET is_active = ? WHERE id = ?
        `, [req.body.isActive ? 1 : 0, announcementId]);
        if (result.changes === 0) return res.status(404).json({ error: 'Announcement not found' });
        res.json({ success: true, isActive: req.body.isActive });
    } catch (error) {
        console.error('Update announcement error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/session/bootstrap', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const [user, capabilities, mascot, announcements] = await Promise.all([
            dbGet(mainDb, `
                SELECT id, username, profile_picture, status, description, created_at
                FROM users WHERE id = ?
            `, [userId]),
            getUserCapabilities(userId),
            dbGet(mainDb, `
                SELECT bricked, hand_holding, petting_record
                FROM user_mascot_status WHERE user_id = ?
            `, [userId]),
            dbAll(mainDb, `
                SELECT ga.id, ga.text, ga.created_at, ga.expires_at,
                       ga.sender_user_id, u.username AS sender_username
                FROM global_announcements ga
                JOIN users u ON u.id = ga.sender_user_id
                LEFT JOIN global_announcement_dismissals gad
                  ON gad.announcement_id = ga.id AND gad.user_id = ?
                WHERE ga.is_active = 1
                  AND (ga.expires_at IS NULL OR ga.expires_at > ?)
                  AND gad.announcement_id IS NULL
                ORDER BY ga.created_at DESC
            `, [userId, Math.floor(Date.now() / 1000)])
        ]);

        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({
            authenticated: true,
            user: {
                id: user.id,
                username: user.username,
                profilePicture: user.profile_picture || '/default-avatar.jpg',
                status: user.status || '',
                description: user.description || '',
                createdAt: new Date(user.created_at * 1000).toISOString(),
                ...capabilities
            },
            mascot: {
                bricked: mascot ? 0 : -1,
                handHolding: mascot ? Boolean(mascot.hand_holding) : true,
                pettingRecord: mascot?.petting_record || 0
            },
            announcements: announcements.map(item => ({
                id: item.id,
                text: item.text,
                senderUserId: item.sender_user_id,
                senderUsername: item.sender_username,
                createdAt: new Date(item.created_at * 1000).toISOString(),
                expiresAt: item.expires_at ? new Date(item.expires_at * 1000).toISOString() : null
            }))
        });
    } catch (error) {
        console.error('Session bootstrap error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get user by ID with postCount
app.get('/api/users/:userId', async (req, res) => {
    const userId = parseInt(req.params.userId);
    
    mainDb.get(`
        SELECT u.id, u.username, u.profile_picture, u.status, u.description, u.created_at, u.searchable,
               COALESCE(ums.petting_record, 0) AS petting_record
        FROM users u
        LEFT JOIN user_mascot_status ums ON ums.user_id = u.id
        WHERE u.id = ?
    `, [userId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Get post count
        mainDb.get(`SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND is_anonymous = 0`, [userId], (err, postCount) => {
            
            // Get communities
            mainDb.all(`
                SELECT c.id, c.username, c.profile_picture
                FROM community_subscribers cs
                JOIN communities c ON cs.community_id = c.id
                WHERE cs.user_id = ?
            `, [userId], (err, communities) => {
                
                // Get friends - CHECK BOTH COLUMNS
                mainDb.all(`
                    SELECT DISTINCT u.id, u.username, u.profile_picture
                    FROM user_connections uc
                    JOIN users u ON (
                        (uc.user_sender_id = ? AND uc.user_reciever_id = u.id) OR
                        (uc.user_reciever_id = ? AND uc.user_sender_id = u.id)
                    )
                    WHERE uc.status = 1
                `, [userId, userId], (err, friends) => {
                    
                    // Get pending requests - WHERE user is the RECIPIENT
                    mainDb.all(`
                        SELECT u.id, u.username, u.profile_picture
                        FROM user_connections uc
                        JOIN users u ON uc.user_sender_id = u.id
                        WHERE uc.user_reciever_id = ? AND uc.status = 0
                    `, [userId], (err, pending) => {
                        
                        // Get outgoing pending requests - WHERE user is the SENDER
                        mainDb.all(`
                            SELECT u.id, u.username, u.profile_picture
                            FROM user_connections uc
                            JOIN users u ON uc.user_reciever_id = u.id
                            WHERE uc.user_sender_id = ? AND uc.status = 0
                        `, [userId], async (err, outgoing) => {
                            try {
                                const publicRole = await getPublicRoleForUser(user.id);
                                res.json({
                                    id: user.id,
                                    username: user.username,
                                    profilePicture: user.profile_picture,
                                    status: user.status || '',
                                    description: user.description || '',
                                    communities: communities.map(c => c.id),
                                    friends: friends.map(f => f.id),
                                    pending: pending.map(p => p.id),
                                    outgoing: outgoing.map(o => o.id),
                                    postCount: postCount.count,
                                    ...publicRole,
                                    pettingRecord: user.petting_record || 0,
                                    createdAt: new Date(user.created_at * 1000).toISOString()
                                });
                            } catch (roleError) {
                                console.error('Failed to load public user role:', roleError);
                                res.status(500).json({ error: 'Server error' });
                            }
                        });
                    });
                });
            });
        });
    });
});

async function canViewUserPosts(profileUserId, currentUserId) {
    // If viewing own profile - always visible
    if (currentUserId === profileUserId) return true;
    
    // Get privacy setting for the profile user
    const privacy = await new Promise((resolve) => {
        mainDb.get(`SELECT show_posts_profile FROM user_settings_privacy WHERE user_id = ?`, 
            [profileUserId], (err, row) => {
            resolve(row || { show_posts_profile: 0 });
        });
    });
    
    const setting = privacy.show_posts_profile;
    
    // 0 - show to anyone
    if (setting === 0) return true;
    
    // 2 - show to no one (except owner, already checked)
    if (setting === 2) return false;
    
    // 1 - show only to friends
    if (setting === 1) {
        // Check if users are friends (bidirectional)
        const friendCheck = await new Promise((resolve) => {
            mainDb.get(`
                SELECT 1 FROM user_connections 
                WHERE ((user_sender_id = ? AND user_reciever_id = ?) OR
                       (user_sender_id = ? AND user_reciever_id = ?))
                AND status = 1
            `, [currentUserId, profileUserId, profileUserId, currentUserId], (err, row) => {
                resolve(!!row);
            });
        });
        return friendCheck;
    }
    
    return false;
}

// Get posts by user ID (not username)
app.get('/api/users/:userId/posts', optionalAuth, async (req, res) => {
    const targetUserId = parseInt(req.params.userId);
    const currentUserId = req.userId || null;
    const before = req.query.before ? parseInt(req.query.before) : null;
    const limit = parseInt(req.query.limit) || 15;

    const canView = await canViewUserPosts(targetUserId, currentUserId);
    if (!canView) return res.json([]);

    try {
        const result = await fetchPosts({
            userId: targetUserId,
            communityId: -1,
            before: before,
            limit: limit,
            currentUserId: currentUserId
        });
        const pinned = result.posts.find(post => post.isPinned);
        const posts = pinned
            ? [pinned, ...result.posts.filter(post => post.id !== pinned.id)]
            : result.posts;
        res.json(posts);
    } catch (err) {
        console.error('Profile posts error:', err);
        res.status(500).json({ error: 'Failed to load posts' });
    }
});

app.put('/api/profile/pinned-post', authenticate, async (req, res) => {
    try {
        const postId = Number(req.body.postId);
        if (!Number.isSafeInteger(postId)) {
            return res.status(400).json({ error: 'Valid postId required' });
        }
        const post = await dbGet(mainDb, `
            SELECT id FROM posts
            WHERE id = ? AND user_id = ? AND is_anonymous = 0
        `, [postId, req.userId]);
        if (!post) return res.status(404).json({ error: 'Post not found or cannot be pinned' });

        await dbRun(mainDb, `
            INSERT INTO profile_pinned_posts (user_id, post_id, pinned_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                post_id = excluded.post_id,
                pinned_at = excluded.pinned_at
        `, [req.userId, postId, Math.floor(Date.now() / 1000)]);
        res.json({ success: true, postId });
    } catch (error) {
        console.error('Pin post error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/profile/pinned-post', authenticate, async (req, res) => {
    try {
        const postId = req.body?.postId ? Number(req.body.postId) : null;
        const params = [req.userId];
        let sql = 'DELETE FROM profile_pinned_posts WHERE user_id = ?';
        if (Number.isSafeInteger(postId)) {
            sql += ' AND post_id = ?';
            params.push(postId);
        }
        const result = await dbRun(mainDb, sql, params);
        res.json({ success: true, removed: result.changes > 0 });
    } catch (error) {
        console.error('Unpin post error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/users/mascot/petting-record', authenticate, async (req, res) => {
    try {
        const record = Math.max(0, Math.min(1000000, Number.parseInt(req.body.record, 10) || 0));
        await dbRun(mainDb, `
            INSERT INTO user_mascot_status (user_id, bricked, hand_holding, petting_record)
            VALUES (?, 0, 1, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                petting_record = MAX(user_mascot_status.petting_record, excluded.petting_record)
        `, [req.userId, record]);
        const row = await dbGet(mainDb, 'SELECT petting_record FROM user_mascot_status WHERE user_id = ?', [req.userId]);
        res.json({ success: true, pettingRecord: row?.petting_record || 0 });
    } catch (error) {
        console.error('Petting record error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update user status
app.post('/api/users/update-status', authenticate, uploadMedia.none(), async (req, res) => {
  try {
    const { status } = req.body;
    const userId = req.userId; // From session!
    
    mainDb.run(`
      UPDATE users 
      SET status = ? 
      WHERE id = ?
    `, [status || '', userId], function(err) {
      if (err) {
        console.error('Error updating status:', err);
        return res.status(500).json({ error: 'Server error' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      res.json({ success: true });
    });
    
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/:username/public-key', (req, res) => {
  try {
    const usersPath = path.join(__dirname, 'api', 'users.json')
    const users = JSON.parse(fs.readFileSync(usersPath))
    
    const user = users.find(u => u.username === req.params.username)
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    res.json({ 
      publicKey: user.publicKey || null 
    })
    
  } catch (error) {
    console.error('Error fetching public key:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

app.delete('/api/mod/users/:userId/avatar', authenticate, requireModerator, async (req, res) => {
    try {
        const targetUserId = Number(req.params.userId);
        if (!Number.isSafeInteger(targetUserId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }
        const user = await dbGet(mainDb, 'SELECT id, profile_picture FROM users WHERE id = ?', [targetUserId]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.profile_picture && user.profile_picture.startsWith('/images/')) {
            deleteManagedMediaFile(user.profile_picture);
        }

        await dbRun(mainDb, 'UPDATE users SET profile_picture = NULL WHERE id = ?', [targetUserId]);
        await dbRun(mainDb, `
            INSERT INTO moderation_audit_log
                (moderator_user_id, post_id, action, details, created_at)
            VALUES (?, NULL, 'delete_user_avatar', ?, ?)
        `, [req.userId, JSON.stringify({ targetUserId, oldProfilePicture: user.profile_picture }), Math.floor(Date.now() / 1000)]);
        res.json({ success: true, userId: targetUserId, profilePicture: '/default-avatar.jpg' });
    } catch (error) {
        console.error('Delete user avatar error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/users/update', authenticate, uploadImage.single('profilePicture'), async (req, res) => {
  try {
    const { username } = req.body;
    const userId = req.userId; // From session!
    
    // First, get current user data
    mainDb.get(`SELECT username, profile_picture FROM users WHERE id = ?`, [userId], async (err, user) => {
      if (err || !user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      
      // Check if username is taken (if changing)
      if (username !== user.username) {
        mainDb.get(`SELECT id FROM users WHERE username = ? AND id != ?`, [username, userId], (err, existing) => {
          if (err) {
            console.error('Username check error:', err);
            return res.status(500).json({ success: false, error: 'Server error' });
          }
          
          if (existing) {
            return res.status(400).json({ success: false, error: 'Username taken' });
          }
          
          proceedWithUpdate();
        });
      } else {
        proceedWithUpdate();
      }
      
      async function proceedWithUpdate() {
        const oldUsername = user.username;
        let newProfilePicture = user.profile_picture;
        
        // Handle profile picture
        if (req.file && req.file.mimetype.startsWith('image/')) {
          // Delete old profile picture if exists
          if (user.profile_picture) {
            deleteManagedMediaFile(user.profile_picture);
          }
          
          const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.webp';
          const imagePath = path.join(__dirname, 'images', filename);
          
          await sharp(req.file.buffer)
            .resize(300, 300, { fit: 'cover' })
            .webp({ quality: 80 })
            .toFile(imagePath);
          
          newProfilePicture = '/images/' + filename;
        }
        
        // Update user in database
        mainDb.run(`
          UPDATE users 
          SET username = ?, profile_picture = ?
          WHERE id = ?
        `, [username, newProfilePicture, userId], function(err) {
          if (err) {
            console.error('Update error:', err);
            return res.status(500).json({ success: false, error: 'Server error' });
          }
          
          // Update posts if username changed (and posts are not anonymous)
          if (username !== oldUsername) {
            mainDb.run(`
              UPDATE posts 
              SET username = ? 
              WHERE user_id = ? AND is_anonymous = 0
            `, [username, userId], (err) => {
              if (err) {
                console.error('Error updating posts username:', err);
                // Don't fail the request, just log the error
              }
            });
          }
          
          res.json({
            success: true,
            profilePicture: newProfilePicture
          });
        });
      }
    });
    
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.post('/api/users/update/bio', authenticate, uploadImage.fields([
    { name: 'profilePicture', maxCount: 1 },
    { name: 'profileBackground', maxCount: 1 }
]), async (req, res) => {
  try {
    const userId = req.userId;
    const {
      username,
      status,
      description,
      date_of_birth,
      home_country,
      education,
      workplace,
      hobbies,
      fandoms,
      religion
    } = req.body;
    
    // Build dynamic update query
    const updates = [];
    const params = [];
    
    // Handle username separately (needs uniqueness check)
    if (username !== undefined) {
      const existingUser = await new Promise((resolve, reject) => {
        mainDb.get(`SELECT id FROM users WHERE username = ? AND id != ?`, [username, userId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      
      if (existingUser) {
        return res.status(400).json({ success: false, error: 'Username already taken' });
      }
      updates.push('username = ?');
      params.push(username);
    }
    
    // Handle profile picture
    let profilePicture = null;
    let profilePhotoId = null;
    if (req.files && req.files.profilePicture && req.files.profilePicture[0]) {
      const file = req.files.profilePicture[0];
      if (file.mimetype.startsWith('image/')) {
        // Delete old profile picture
        const oldUser = await new Promise((resolve, reject) => {
          mainDb.get(`SELECT profile_picture FROM users WHERE id = ?`, [userId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        
        if (oldUser && oldUser.profile_picture) {
          deleteManagedMediaFile(oldUser.profile_picture);
        }
        
        const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.webp';
        const imagePath = path.join(__dirname, 'images', filename);
        
        await sharp(file.buffer)
          .resize(300, 300, { fit: 'cover' })
          .webp({ quality: 80 })
          .toFile(imagePath);
        
        profilePicture = '/images/' + filename;
        
        // Insert into photos table
        const result = await new Promise((resolve, reject) => {
          mainDb.run(`
            INSERT INTO photos (file_path, uploaded_by, created_at)
            VALUES (?, ?, ?)
          `, [profilePicture, userId, Math.floor(Date.now() / 1000)], function(err) {
            if (err) reject(err);
            else resolve(this);
          });
        });
        profilePhotoId = result.lastID;
        
        // Add to user's photo album
        const album = await new Promise((resolve) => {
          mainDb.get(`
            SELECT id FROM user_photo_albums 
            WHERE user_id = ? AND title LIKE 'Фотографии %'
          `, [userId], (err, row) => {
            resolve(row);
          });
        });
        
        if (album && profilePhotoId) {
          await new Promise((resolve) => {
            mainDb.run(`
              INSERT OR IGNORE INTO album_photos (album_id, photo_id, added_by)
              VALUES (?, ?, ?)
            `, [album.id, profilePhotoId, userId], (err) => {
              resolve();
            });
          });
        }
        
        updates.push('profile_picture = ?');
        params.push(profilePicture);
      }
    }
    
    // Handle profile BACKGROUND image
    let profileBackground = null;
    if (req.files && req.files.profileBackground && req.files.profileBackground[0]) {
      const file = req.files.profileBackground[0];
      if (file.mimetype.startsWith('image/')) {
        // Delete old background
        const oldUser = await new Promise((resolve, reject) => {
          mainDb.get(`SELECT profile_background FROM users WHERE id = ?`, [userId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        
        if (oldUser && oldUser.profile_background) {
          deleteManagedMediaFile(oldUser.profile_background);
        }
        
        const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.webp';
        const imagePath = path.join(__dirname, 'images', filename);
        
        await sharp(file.buffer)
          .resize({ width: 1920, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(imagePath);
        
        profileBackground = '/images/' + filename;
        
        // Insert into photos table (backgrounds go to photos too)
        const result = await new Promise((resolve, reject) => {
          mainDb.run(`
            INSERT INTO photos (file_path, uploaded_by, created_at)
            VALUES (?, ?, ?)
          `, [profileBackground, userId, Math.floor(Date.now() / 1000)], function(err) {
            if (err) reject(err);
            else resolve(this);
          });
        });
        const bgPhotoId = result.lastID;
        
        // Add to user's photo album
        const album = await new Promise((resolve) => {
          mainDb.get(`
            SELECT id FROM user_photo_albums 
            WHERE user_id = ? AND title LIKE 'Фотографии %'
          `, [userId], (err, row) => {
            resolve(row);
          });
        });
        
        if (album && bgPhotoId) {
          await new Promise((resolve) => {
            mainDb.run(`
              INSERT OR IGNORE INTO album_photos (album_id, photo_id, added_by)
              VALUES (?, ?, ?)
            `, [album.id, bgPhotoId, userId], (err) => {
              resolve();
            });
          });
        }
        
        updates.push('profile_background = ?');
        params.push(profileBackground);
      }
    }
    
    // Handle bio fields
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status || '');
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description || '');
    }
    if (date_of_birth !== undefined) {
      updates.push('date_of_birth = ?');
      params.push(date_of_birth || '');
    }
    if (home_country !== undefined) {
      updates.push('home_country = ?');
      params.push(home_country || '');
    }
    if (education !== undefined) {
      updates.push('education = ?');
      params.push(education || '');
    }
    if (workplace !== undefined) {
      updates.push('workplace = ?');
      params.push(workplace || '');
    }
    if (hobbies !== undefined) {
      updates.push('hobbies = ?');
      params.push(hobbies || '');
    }
    if (fandoms !== undefined) {
      updates.push('fandoms = ?');
      params.push(fandoms || '');
    }
    if (religion !== undefined) {
      updates.push('religion = ?');
      params.push(religion || '');
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }
    
    params.push(userId);
    
    mainDb.run(`
      UPDATE users SET ${updates.join(', ')} WHERE id = ?
    `, params, function(err) {
      if (err) {
        console.error('Bio update error:', err);
        return res.status(500).json({ success: false, error: 'Server error' });
      }
      
      res.json({
        success: true,
        updated: updates.map(u => u.split(' ')[0]),
        profilePicture: profilePicture,
        profileBackground: profileBackground
      });
    });
    
  } catch (error) {
    console.error('Bio update error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.post('/api/users/update/seq', authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    const {
      show_posts_feed,
      show_posts_profile,
      show_info_profile,
      anonymous_page,
      show_friends_list,
      show_communities_list,
      show_audios,
      show_photos,
      allow_messages_from
    } = req.body;
    
    // Build dynamic update query
    const updates = [];
    const params = [];
    
    if (show_posts_feed !== undefined) {
      updates.push('show_posts_feed = ?');
      params.push(show_posts_feed ? 1 : 0);
    }
    if (show_posts_profile !== undefined) {
      updates.push('show_posts_profile = ?');
      params.push(show_posts_profile ? 1 : 0);
    }
    if (show_info_profile !== undefined) {
      updates.push('show_info_profile = ?');
      params.push(show_info_profile ? 1 : 0);
    }
    if (anonymous_page !== undefined) {
      updates.push('anonymous_page = ?');
      params.push(anonymous_page ? 1 : 0);
    }
    if (show_friends_list !== undefined) {
      updates.push('show_friends_list = ?');
      params.push(show_friends_list ? 1 : 0);
    }
    if (show_communities_list !== undefined) {
      updates.push('show_communities_list = ?');
      params.push(show_communities_list ? 1 : 0);
    }
    if (show_audios !== undefined) {
      updates.push('show_audios = ?');
      params.push(show_audios ? 1 : 0);
    }
    if (show_photos !== undefined) {
      updates.push('show_photos = ?');
      params.push(show_photos ? 1 : 0);
    }
    if (allow_messages_from !== undefined) {
      updates.push('allow_messages_from = ?');
      params.push(allow_messages_from);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }
    
    params.push(userId);
    
    // Check if user has privacy settings row
    mainDb.get(`SELECT user_id FROM user_settings_privacy WHERE user_id = ?`, [userId], (err, exists) => {
      if (err) {
        console.error('Privacy check error:', err);
        return res.status(500).json({ success: false, error: 'Server error' });
      }
      
      if (!exists) {
        // Insert default row first
        mainDb.run(`INSERT INTO user_settings_privacy (user_id) VALUES (?)`, [userId], (err) => {
          if (err) {
            console.error('Privacy insert error:', err);
            return res.status(500).json({ success: false, error: 'Server error' });
          }
          proceedWithUpdate();
        });
      } else {
        proceedWithUpdate();
      }
      
      function proceedWithUpdate() {
        mainDb.run(`
          UPDATE user_settings_privacy SET ${updates.join(', ')} WHERE user_id = ?
        `, params, function(err) {
          if (err) {
            console.error('Privacy update error:', err);
            return res.status(500).json({ success: false, error: 'Server error' });
          }
          
          res.json({ success: true });
        });
      }
    });
    
  } catch (error) {
    console.error('Privacy update error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.post('/api/users/update/cust', authenticate, uploadImage.single('custom_background'), async (req, res) => {
  try {
    const userId = req.userId;
    const {
      notification_sound,
      chat_message_sound,
      post_sent_sound,
      friend_online_sound,
      friend_request_sound
    } = req.body;
    
    // Build dynamic update query for settings
    const updates = [];
    const params = [];
    
    if (notification_sound !== undefined) {
      updates.push('notification_sound = ?');
      params.push(notification_sound ? 1 : 0);
    }
    if (chat_message_sound !== undefined) {
      updates.push('chat_message_sound = ?');
      params.push(chat_message_sound ? 1 : 0);
    }
    if (post_sent_sound !== undefined) {
      updates.push('post_sent_sound = ?');
      params.push(post_sent_sound ? 1 : 0);
    }
    if (friend_online_sound !== undefined) {
      updates.push('friend_online_sound = ?');
      params.push(friend_online_sound ? 1 : 0);
    }
    if (friend_request_sound !== undefined) {
      updates.push('friend_request_sound = ?');
      params.push(friend_request_sound ? 1 : 0);
    }
    
    // Handle custom background image
    let customBackground = null;
    if (req.file && req.file.mimetype.startsWith('image/')) {
      const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.webp';
      const imagePath = path.join(__dirname, 'images', filename);
      
      await sharp(req.file.buffer)
        .resize({ width: 1920, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(imagePath);
      
      customBackground = '/images/' + filename;
      updates.push('custom_background = ?');
      params.push(customBackground);
    }
    
    // Check if user has customization settings row
    mainDb.get(`SELECT user_id FROM user_settings_customization WHERE user_id = ?`, [userId], (err, exists) => {
      if (err) {
        console.error('Customization check error:', err);
        return res.status(500).json({ success: false, error: 'Server error' });
      }
      
      if (!exists) {
        // Insert default row first
        mainDb.run(`INSERT INTO user_settings_customization (user_id) VALUES (?)`, [userId], (err) => {
          if (err) {
            console.error('Customization insert error:', err);
            return res.status(500).json({ success: false, error: 'Server error' });
          }
          proceedWithUpdate();
        });
      } else {
        proceedWithUpdate();
      }
      
      function proceedWithUpdate() {
        if (updates.length === 0) {
          return res.json({ success: true, customBackground });
        }
        
        params.push(userId);
        
        mainDb.run(`
          UPDATE user_settings_customization SET ${updates.join(', ')} WHERE user_id = ?
        `, params, function(err) {
          if (err) {
            console.error('Customization update error:', err);
            return res.status(500).json({ success: false, error: 'Server error' });
          }
          
          res.json({ success: true, customBackground });
        });
      }
    });
    
  } catch (error) {
    console.error('Customization update error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Delete a comment
app.delete('/api/posts/:postId/comments/:commentId', authenticate, (req, res) => {
    const postId = parseInt(req.params.postId);
    const commentId = parseFloat(req.params.commentId);
    const userId = req.userId;
    
    // Get comment and check permissions
    mainDb.get(`
        SELECT c.*, p.user_id as post_user_id, p.is_anonymous 
        FROM comments c
        JOIN posts p ON c.post_id = p.id
        WHERE c.id = ? AND c.post_id = ?
    `, [commentId, postId], (err, comment) => {
        if (err || !comment) {
            return res.status(404).json({ error: 'Comment not found' });
        }
        
        const isCommentOwner = comment.user_id === userId;
        
        if (!isCommentOwner) {
            // Check if admin or post owner
            mainDb.get(`SELECT 1 FROM admins WHERE user_id = ?`, [userId], (err, isAdmin) => {
                const isPostOwner = comment.post_user_id === userId && !comment.is_anonymous;
                
                if (!isAdmin && !isPostOwner) {
                    return res.status(403).json({ error: 'Not authorized' });
                }
                
                // Delete comment - CASCADE handles likes automatically
                mainDb.run(`DELETE FROM comments WHERE id = ?`, [commentId], (err) => {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to delete comment' });
                    }
                    
                    // Delete attachment file from disk (CASCADE doesn't delete files)
                    if (comment.attachment_path) {
                        deleteManagedMediaFile(comment.attachment_path);
                    }
                    
                    res.json({ success: true });
                });
            });
        } else {
            // Comment owner - delete
            mainDb.run(`DELETE FROM comments WHERE id = ?`, [commentId], (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to delete comment' });
                }
                
                if (comment.attachment_path) {
                    deleteManagedMediaFile(comment.attachment_path);
                }
                
                res.json({ success: true });
            });
        }
    });
});

// ============ FRIENDS ROUTES ============

// Отправить заявку в друзья
app.post('/api/friends/request', authenticate, async (req, res) => {
    try {
        const fromUserId = req.userId;
        const toUserId = Number(req.body.toUserId);
        if (!Number.isSafeInteger(toUserId) || toUserId === fromUserId) {
            return res.status(400).json({ error: 'Valid recipient required' });
        }
        const toUser = await dbGet(mainDb, 'SELECT id FROM users WHERE id = ?', [toUserId]);
        if (!toUser) return res.status(404).json({ error: 'User not found' });

        const existing = await dbGet(mainDb, `
            SELECT user_sender_id, user_reciever_id, status
            FROM user_connections
            WHERE (user_sender_id = ? AND user_reciever_id = ?)
               OR (user_sender_id = ? AND user_reciever_id = ?)
        `, [fromUserId, toUserId, toUserId, fromUserId]);

        if (existing?.status === 1) return res.status(409).json({ error: 'Already friends' });
        if (existing?.status === 0) {
            if (existing.user_sender_id === toUserId) {
                return res.status(409).json({ error: 'This user already sent you a request', incoming: true });
            }
            return res.status(409).json({ error: 'Request already sent' });
        }

        await dbRun(mainDb, `
            INSERT INTO user_connections (user_reciever_id, user_sender_id, status)
            VALUES (?, ?, 0)
        `, [toUserId, fromUserId]);
        await createNotification(toUserId, 'friend_request', fromUserId);
        res.json({ success: true });
    } catch (error) {
        console.error('Friend request error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/friends/accept', authenticate, async (req, res) => {
    try {
        const currentUserId = req.userId;
        const requesterUserId = Number(req.body.requesterUserId);
        if (!Number.isSafeInteger(requesterUserId)) {
            return res.status(400).json({ error: 'Valid requester required' });
        }
        const result = await dbRun(mainDb, `
            UPDATE user_connections
            SET status = 1
            WHERE user_reciever_id = ? AND user_sender_id = ? AND status = 0
        `, [currentUserId, requesterUserId]);
        if (result.changes === 0) return res.status(404).json({ error: 'No pending request found' });
        await createNotification(requesterUserId, 'friend_request_accepted', currentUserId);
        res.json({ success: true });
    } catch (error) {
        console.error('Accept friend error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/friends/reject', authenticate, async (req, res) => {
    try {
        const currentUserId = req.userId;
        const requesterUserId = Number(req.body.requesterUserId);
        if (!Number.isSafeInteger(requesterUserId)) {
            return res.status(400).json({ error: 'Valid requester required' });
        }
        const result = await dbRun(mainDb, `
            DELETE FROM user_connections
            WHERE user_reciever_id = ? AND user_sender_id = ? AND status = 0
        `, [currentUserId, requesterUserId]);
        if (result.changes === 0) return res.status(404).json({ error: 'No pending request found' });
        res.json({ success: true });
    } catch (error) {
        console.error('Reject friend error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Получить список друзей и заявок
// Get friends list by user ID
app.get('/api/friends/:userId', optionalAuth, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const isOwnProfile = req.userId === userId;
        
        // Check if user exists
        mainDb.get(`SELECT id FROM users WHERE id = ?`, [userId], (err, user) => {
            if (err || !user) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            // Get accepted friends (status = 1) - where user is either sender or receiver
            mainDb.all(`
                SELECT DISTINCT u.id, u.username, u.profile_picture, u.status
                FROM user_connections uc
                JOIN users u ON (
                    (uc.user_sender_id = ? AND uc.user_reciever_id = u.id) OR
                    (uc.user_reciever_id = ? AND uc.user_sender_id = u.id)
                )
                WHERE uc.status = 1
            `, [userId, userId], async (err, friends) => {
                if (err) {
                    console.error('Get friends error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }

                const formattedFriends = await addPublicRoles(friends.map(friend => ({
                    id: friend.id,
                    username: friend.username,
                    profilePicture: friend.profile_picture,
                    status: friend.status || ''
                })));
                
                // Pending requests are private and only visible to the authenticated profile owner.
                mainDb.all(`
                    SELECT u.id, u.username, u.profile_picture
                    FROM user_connections uc
                    JOIN users u ON uc.user_sender_id = u.id
                    WHERE uc.user_reciever_id = ? AND uc.status = 0 AND ? = 1
                `, [userId, isOwnProfile ? 1 : 0], async (err, pending) => {
                    if (err) {
                        console.error('Get pending error:', err);
                        return res.status(500).json({ error: 'Server error' });
                    }

                    const formattedPending = await addPublicRoles(pending.map(requester => ({
                        id: requester.id,
                        username: requester.username,
                        profilePicture: requester.profile_picture
                    })));
                    
                    // Get subscribers count (from community_subscribers table)
                    mainDb.get(`
                        SELECT COUNT(*) as count FROM community_subscribers WHERE user_id = ?
                    `, [userId], (err, subscribers) => {
                        res.json({
                            friends: formattedFriends,
                            pending: formattedPending,
                            subscribersCount: subscribers ? subscribers.count : 0
                        });
                    });
                });
            });
        });
    } catch (error) {
        console.error('Get friends error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Remove friend - using userId
app.post('/api/friends/remove', authenticate, async (req, res) => {
    try {
        const currentUserId = req.userId;
        const friendId = Number(req.body.friendId);
        if (!Number.isSafeInteger(friendId)) {
            return res.status(400).json({ error: 'Valid friend required' });
        }
        
        // Delete the connection in both directions (status = 1 for accepted friends)
        mainDb.run(`
            DELETE FROM user_connections 
            WHERE (user_sender_id = ? AND user_reciever_id = ? AND status = 1)
               OR (user_sender_id = ? AND user_reciever_id = ? AND status = 1)
        `, [currentUserId, friendId, friendId, currentUserId], function(err) {
            if (err) {
                console.error('Remove friend error:', err);
                return res.status(500).json({ error: 'Server error' });
            }
            
            res.json({ success: true });
        });
    } catch (error) {
        console.error('Remove friend error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Отменить отправленную заявку
app.post('/api/friends/cancel', authenticate, async (req, res) => {
    try {
        const fromUserId = req.userId;
        const toUserId = Number(req.body.toUserId);
        if (!Number.isSafeInteger(toUserId)) {
            return res.status(400).json({ error: 'Valid recipient required' });
        }
        
        // Delete only the authenticated user's outgoing pending request.
        mainDb.run(`
            DELETE FROM user_connections 
            WHERE user_sender_id = ? AND user_reciever_id = ? AND status = 0
        `, [fromUserId, toUserId], function(err) {
            if (err) {
                console.error('Cancel request error:', err);
                return res.status(500).json({ error: 'Server error' });
            }
            
            res.json({ success: true });
        });
    } catch (error) {
        console.error('Cancel request error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============ COMMUNITIES ROUTES ============

// Search communities (by name OR description)
app.get('/api/communities/search', (req, res) => {
    const query = req.query.q || '';
    
    if (query.length < 1) {
        return res.json([]);
    }
    
    mainDb.all(`
        SELECT id, username, profile_picture as profilePicture, type, description, status,
               (SELECT COUNT(*) FROM community_subscribers WHERE community_id = c.id) as subCount
        FROM communities c
        WHERE username LIKE ? OR description LIKE ? OR status LIKE ?
        LIMIT 50
    `, [`%${query}%`, `%${query}%`, `%${query}%`], (err, communities) => {
        if (err) {
            return res.status(500).json({ error: 'Search failed' });
        }
        res.json(communities);
    });
});

app.get('/api/communities/all', async (req, res) => {
  console.log('/api/communities/all was called!') // DEBUG
  try {
    mainDb.all(`
      SELECT id, username, type, owner_id as owner
      FROM communities
    `, (err, comms) => {
      if (err) {
        console.error('Error fetching communities:', err);
        return res.status(500).json({ error: 'Server error' });
      }
      
      console.log('Found communities:', comms.length); // DEBUG - the satisfying log!
      
      if (comms.length === 0) {
        return res.json([]);
      }
      
      // Get moderators for each community
      const communityIds = comms.map(c => c.id);
      const placeholders = communityIds.map(() => '?').join(',');
      
      mainDb.all(`
        SELECT community_id, user_id
        FROM community_moderators
        WHERE community_id IN (${placeholders})
      `, communityIds, (err, moderators) => {
        if (err) {
          console.error('Error fetching moderators:', err);
          return res.status(500).json({ error: 'Server error' });
        }
        
        // Group moderators by community_id
        const moderatorsByCommunity = {};
        moderators.forEach(mod => {
          if (!moderatorsByCommunity[mod.community_id]) {
            moderatorsByCommunity[mod.community_id] = [];
          }
          moderatorsByCommunity[mod.community_id].push(mod.user_id);
        });
        
        const result = comms.map(comm => ({
          id: comm.id,
          username: comm.username,
          type: comm.type,
          moderators: moderatorsByCommunity[comm.id] || [],
          owner: comm.owner
        }));
        
        res.json(result);
      });
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/communities/new', authenticate, uploadImage.single('profilePicture'), async (req, res) => {
  try {
    const { username, type, rules, description } = req.body;
    const userId = req.userId;
    
    if (!username) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }
    
    // Use the authenticated user as the community creator.
    mainDb.get(`SELECT id FROM users WHERE id = ?`, [userId], async (err, user) => {
      if (err || !user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Check if community name already taken
      mainDb.get(`SELECT id FROM communities WHERE username = ?`, [username], async (err, existing) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Server error' });
        }
        
        if (existing) {
          return res.status(400).json({ success: false, error: 'Community name already taken' });
        }
        
        // Handle profile picture if uploaded
        let profilePicturePath = null;
        if (req.file) {
          const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.webp';
          const imagePath = path.join(__dirname, 'images', filename);
          await sharp(req.file.buffer)
            .resize({ width: 300, height: 300, fit: 'cover' })
            .webp({ quality: 80 })
            .toFile(imagePath);
          profilePicturePath = '/images/' + filename;
        }
        
        const communityId = Date.now();
        const createdAt = Math.floor(Date.now() / 1000);
        
        // Insert community
        mainDb.run(`
          INSERT INTO communities (id, username, type, created_at, profile_picture, description, rules, status, owner_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [communityId, username, type || 'community', createdAt, profilePicturePath, description || '', rules || '', '', user.id], function(err) {
          if (err) {
            console.error('Insert community error:', err);
            return res.status(500).json({ success: false, error: 'Server error' });
          }
          
          // Add owner as moderator
          mainDb.run(`
            INSERT INTO community_moderators (community_id, user_id)
            VALUES (?, ?)
          `, [communityId, user.id], moderatorErr => {
            if (moderatorErr) console.error('Failed to add community owner as moderator:', moderatorErr);
          });
          
          // Add owner as subscriber
          mainDb.run(`
            INSERT INTO community_subscribers (community_id, user_id)
            VALUES (?, ?)
          `, [communityId, user.id], subscriberErr => {
            if (subscriberErr) console.error('Failed to add community owner as subscriber:', subscriberErr);
          });
          
          res.json({
            success: true,
            comm: {
              id: communityId,
              username: username,
              createdAt: new Date(createdAt * 1000).toISOString()
            }

          });
        });
      });
    });
    
  } catch (error) {
    console.error('Community creation error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Get community settings data
app.get('/api/community/:id/settings', authenticate, async (req, res) => {
    try {
        const communityId = parseInt(req.params.id);
        
        const access = await dbGet(mainDb, `
            SELECT c.owner_id,
                   EXISTS(
                       SELECT 1 FROM community_moderators cm
                       WHERE cm.community_id = c.id AND cm.user_id = ?
                   ) AS is_moderator
            FROM communities c WHERE c.id = ?
        `, [req.userId, communityId]);
        if (!access) return res.status(404).json({ error: 'Community not found' });
        if (access.owner_id !== req.userId && !access.is_moderator) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const community = await new Promise((resolve, reject) => {
            mainDb.get(`SELECT * FROM communities WHERE id = ?`, [communityId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!community) return res.status(404).json({ error: 'Community not found' });
        
        // Get moderators
        const moderators = await new Promise((resolve, reject) => {
            mainDb.all(`
                SELECT u.id, u.username, u.profile_picture 
                FROM community_moderators cm
                JOIN users u ON cm.user_id = u.id
                WHERE cm.community_id = ?
            `, [communityId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        // Get subscribers
        const subscribers = await new Promise((resolve, reject) => {
            mainDb.all(`
                SELECT u.id, u.username, u.profile_picture 
                FROM community_subscribers cs
                JOIN users u ON cs.user_id = u.id
                WHERE cs.community_id = ?
            `, [communityId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        const [moderatorsWithRoles, subscribersWithRoles] = await Promise.all([
            addPublicRoles(moderators),
            addPublicRoles(subscribers)
        ]);

        res.json({
            ...community,
            moderators: moderatorsWithRoles,
            subscribers: subscribersWithRoles
        });
    } catch (err) {
        console.error('Error fetching community settings:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update community settings
app.post('/api/community/:id/update', authenticate, uploadImage.fields([
    { name: 'profilePicture', maxCount: 1 },
    { name: 'profileBackground', maxCount: 1 }
]), async (req, res) => {
    try {
        const communityId = parseInt(req.params.id);
        const { name, status, description, rules, type } = req.body;
        const access = await dbGet(mainDb, `
            SELECT c.owner_id,
                   EXISTS(
                       SELECT 1 FROM community_moderators cm
                       WHERE cm.community_id = c.id AND cm.user_id = ?
                   ) AS is_moderator
            FROM communities c WHERE c.id = ?
        `, [req.userId, communityId]);
        if (!access) return res.status(404).json({ error: 'Community not found' });
        if (access.owner_id !== req.userId && !access.is_moderator) {
            return res.status(403).json({ error: 'Not authorized' });
        }
        
        const updates = [];
        const params = [];
        
        if (name !== undefined) {
            updates.push('username = ?');
            params.push(name);
        }
        if (status !== undefined) {
            updates.push('status = ?');
            params.push(status);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description);
        }
        if (rules !== undefined) {
            updates.push('rules = ?');
            params.push(rules);
        }
        if (type !== undefined) {
            updates.push('type = ?');
            params.push(type);
        }
        
        // Handle profile picture
        let profilePicture = null;
        if (req.files && req.files.profilePicture && req.files.profilePicture[0]) {
            const file = req.files.profilePicture[0];
            const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.webp';
            const imagePath = path.join(__dirname, 'images', filename);
            
            await sharp(file.buffer)
                .resize(300, 300, { fit: 'cover' })
                .webp({ quality: 80 })
                .toFile(imagePath);
            
            profilePicture = '/images/' + filename;
            updates.push('profile_picture = ?');
            params.push(profilePicture);
        }
        
        // Handle profile background
        let profileBackground = null;
        if (req.files && req.files.profileBackground && req.files.profileBackground[0]) {
            const file = req.files.profileBackground[0];
            const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.webp';
            const imagePath = path.join(__dirname, 'images', filename);
            
            await sharp(file.buffer)
                .webp({ quality: 80 })
                .toFile(imagePath);
            
            profileBackground = '/images/' + filename;
            updates.push('profile_background = ?');
            params.push(profileBackground);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }
        
        params.push(communityId);
        
        mainDb.run(`UPDATE communities SET ${updates.join(', ')} WHERE id = ?`, params, (err) => {
            if (err) {
                console.error('Update error:', err);
                return res.status(500).json({ success: false, error: 'Server error' });
            }
            
            res.json({
                success: true,
                profilePicture,
                profileBackground
            });
        });
    } catch (err) {
        console.error('Update error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete community
app.post('/api/community/:id/delete', authenticate, async (req, res) => {
    try {
        const communityId = parseInt(req.params.id);
        const userId = req.userId;
        
        // Check if user is owner
        const community = await new Promise((resolve, reject) => {
            mainDb.get(`SELECT owner_id FROM communities WHERE id = ?`, [communityId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!community) return res.status(404).json({ error: 'Community not found' });
        if (community.owner_id !== userId) return res.status(403).json({ error: 'Not authorized' });
        
        // Delete community (cascade will handle related tables)
        mainDb.run(`DELETE FROM communities WHERE id = ?`, [communityId], (err) => {
            if (err) {
                console.error('Delete error:', err);
                return res.status(500).json({ error: 'Server error' });
            }
            res.json({ success: true });
        });
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Promote user to moderator
app.post('/api/community/:id/promote', authenticate, async (req, res) => {
    try {
        const communityId = parseInt(req.params.id);
        const { userId: targetUserId } = req.body;
        const currentUserId = req.userId;
        
        // Check if current user is owner
        const community = await new Promise((resolve, reject) => {
            mainDb.get(`SELECT owner_id FROM communities WHERE id = ?`, [communityId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!community) return res.status(404).json({ error: 'Community not found' });
        if (community.owner_id !== currentUserId) return res.status(403).json({ error: 'Not authorized' });
        
        mainDb.run(`INSERT OR IGNORE INTO community_moderators (community_id, user_id) VALUES (?, ?)`, 
            [communityId, targetUserId], (err) => {
            if (err) {
                console.error('Promote error:', err);
                return res.status(500).json({ error: 'Server error' });
            }
            res.json({ success: true });
        });
    } catch (err) {
        console.error('Promote error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Remove user from community (subscriber or moderator)
app.post('/api/community/:id/remove-user', authenticate, async (req, res) => {
    try {
        const communityId = parseInt(req.params.id);
        const { userId: targetUserId } = req.body;
        const currentUserId = req.userId;
        
        const community = await new Promise((resolve, reject) => {
            mainDb.get(`SELECT owner_id FROM communities WHERE id = ?`, [communityId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!community) return res.status(404).json({ error: 'Community not found' });
        if (community.owner_id !== currentUserId) return res.status(403).json({ error: 'Not authorized' });
        
        await dbRun(
            mainDb,
            'DELETE FROM community_moderators WHERE community_id = ? AND user_id = ?',
            [communityId, targetUserId]
        );
        await dbRun(
            mainDb,
            'DELETE FROM community_subscribers WHERE community_id = ? AND user_id = ?',
            [communityId, targetUserId]
        );
        
        res.json({ success: true });
    } catch (err) {
        console.error('Remove error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Modify community (update name, status, description, rules, profile picture)
app.post('/api/communities/:id/modify', authenticate, uploadImage.single('profilePicture'), async (req, res) => {
  try {
    const communityId = parseInt(req.params.id);
    const { username, status, description, rules } = req.body;
    const userId = req.userId; // From authenticate middleware
    
    // First check if user has permission (owner or moderator)
    mainDb.get(`
      SELECT c.owner_id, 
             (SELECT COUNT(*) FROM community_moderators WHERE community_id = c.id AND user_id = ?) as is_moderator
      FROM communities c
      WHERE c.id = ?
    `, [userId, communityId], async (err, community) => {
      if (err || !community) {
        return res.status(404).json({ error: 'Community not found' });
      }
      
      const isOwner = community.owner_id === userId;
      const isModerator = community.is_moderator > 0;
      
      if (!isOwner && !isModerator) {
        return res.status(403).json({ error: 'Not authorized to edit this community' });
      }
      
      // Check if new username is taken (if changing)
      if (username !== undefined) {
        mainDb.get(`SELECT id FROM communities WHERE username = ? AND id != ?`, [username, communityId], (err, existing) => {
          if (err) {
            return res.status(500).json({ error: 'Server error' });
          }
          if (existing) {
            return res.status(400).json({ error: 'Community name already taken' });
          }
          proceedWithUpdate();
        });
      } else {
        proceedWithUpdate();
      }
      
      function proceedWithUpdate() {
        // Build dynamic update query
        const updates = [];
        const values = [];
        
        if (username !== undefined) {
          updates.push('username = ?');
          values.push(username);
        }
        if (status !== undefined) {
          updates.push('status = ?');
          values.push(status);
        }
        if (description !== undefined) {
          updates.push('description = ?');
          values.push(description);
        }
        if (rules !== undefined) {
          updates.push('rules = ?');
          values.push(rules);
        }
        
        // Handle profile picture
        const handleProfilePicture = (picturePath) => {
          if (picturePath) {
            updates.push('profile_picture = ?');
            values.push(picturePath);
          }
          
          if (updates.length === 0) {
            return res.json({ success: true });
          }
          
          values.push(communityId);
          mainDb.run(`
            UPDATE communities 
            SET ${updates.join(', ')}
            WHERE id = ?
          `, values, (err) => {
            if (err) {
              console.error('Update error:', err);
              return res.status(500).json({ error: 'Server error' });
            }
            res.json({ success: true });
          });
        };
        
        // Process profile picture if uploaded
        if (req.file) {
          const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.webp';
          const imagePath = path.join(__dirname, 'images', filename);
          sharp(req.file.buffer)
            .resize({ width: 300, height: 300, fit: 'cover' })
            .webp({ quality: 80 })
            .toFile(imagePath)
            .then(() => {
              handleProfilePicture('/images/' + filename);
            })
            .catch(err => {
              console.error('Image processing error:', err);
              handleProfilePicture(null);
            });
        } else {
          handleProfilePicture(null);
        }
      }
    });
  } catch (error) {
    console.error('Error modifying community:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get posts by community ID (using community field)
app.get('/api/communities/:id/posts', optionalAuth, async (req, res) => {
    const communityId = parseInt(req.params.id);
    const currentUserId = req.userId || null;
    const before = req.query.before ? parseInt(req.query.before) : null;
    const limit = parseInt(req.query.limit) || 15;

    try {
        const result = await fetchPosts({
            userId: -1,
            communityId: communityId,
            before: before,
            limit: limit,
            currentUserId: currentUserId
        });
        res.json(result.posts);
    } catch (err) {
        console.error('Community posts error:', err);
        res.status(500).json({ error: 'Failed to load posts' });
    }
});

// JOIN DA COMMINTIE (using authenticate)
app.post('/api/communities/:id/join', authenticate, async (req, res) => {
    const communityId = parseInt(req.params.id);
    const userId = req.userId; // From authenticate middleware
    
    mainDb.run(`
        INSERT OR IGNORE INTO community_subscribers (community_id, user_id)
        VALUES (?, ?)
    `, [communityId, userId], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to join' });
        }
        res.json({ success: true });
    });
});

// Leaf DA COMMINTIE (using authenticate)
app.post('/api/communities/:id/leave', authenticate, async (req, res) => {
    const communityId = parseInt(req.params.id);
    const userId = req.userId; // From authenticate middleware
    
    mainDb.run(`
        DELETE FROM community_subscribers WHERE community_id = ? AND user_id = ?
    `, [communityId, userId], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to leave' });
        }
        res.json({ success: true });
    });
});

// Get community by ID
app.get('/api/communities/:id', optionalAuth, async (req, res) => {
    const commId = parseInt(req.params.id);
    const currentUserId = req.userId || null;
    
    mainDb.get(`
        SELECT * FROM communities WHERE id = ?
    `, [commId], (err, community) => {
        if (err || !community) {
            return res.status(404).json({ error: 'Community not found' });
        }
        
        // Get post count
        mainDb.get(`SELECT COUNT(*) as count FROM posts WHERE community_id = ?`, [commId], (err, postCount) => {
            // Get subscribers count
            mainDb.get(`SELECT COUNT(*) as count FROM community_subscribers WHERE community_id = ?`, [commId], (err, subCount) => {
                // Get moderators
                mainDb.all(`SELECT user_id FROM community_moderators WHERE community_id = ?`, [commId], (err, moderators) => {
                    
                    // Check if current user is subscribed
                    let isSubscribed = false;
                    const checkSubscription = (callback) => {
                        if (currentUserId) {
                            mainDb.get(`
                                SELECT 1 FROM community_subscribers 
                                WHERE community_id = ? AND user_id = ?
                            `, [commId, currentUserId], (err, sub) => {
                                isSubscribed = !!sub;
                                callback();
                            });
                        } else {
                            callback();
                        }
                    };
                    
                    checkSubscription(() => {
                        // Build subscribers array - only contains current user's ID if subscribed
                        const subscribersArray = (isSubscribed && currentUserId) ? [currentUserId] : [];
                        
                        res.json({
                            id: community.id,
                            username: community.username,
                            profilePicture: community.profile_picture,
                            type: community.type,
                            description: community.description || '',
                            rules: community.rules || '',
                            status: community.status || '',
                            subscribers: subscribersArray,
                            subscriberCount: subCount.count,
                            moderators: moderators.map(m => m.user_id),
                            owner: community.owner_id,
                            postCount: postCount.count,
                            profileBackground: community.profile_background,
                            createdAt: new Date(community.created_at * 1000).toISOString()
                        });
                    });
                });
            });
        });
    });
});

// Get all communities of a user by userId
app.get('/api/user/communities/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    
    mainDb.all(`
        SELECT c.id, c.username, c.profile_picture, c.type, 
               (SELECT COUNT(*) FROM community_subscribers WHERE community_id = c.id) as subCount
        FROM community_subscribers cs
        JOIN communities c ON cs.community_id = c.id
        WHERE cs.user_id = ?
    `, [userId], (err, communities) => {
        if (err) {
            console.error('Error loading communities:', err);
            return res.status(500).json({ error: 'Failed to load communities' });
        }
        
        // Transform to match frontend expected format
        const formattedCommunities = communities.map(comm => ({
            id: comm.id,
            username: comm.username,
            profilePicture: comm.profile_picture,
            type: comm.type,
            subCount: comm.subCount
        }));
        
        res.json({ communities: formattedCommunities });
    });
});

// ============ LONGPOLLING CHAT ROUTES ====

const globalWaitingClients = new Map(); // userId -> [{ res }]

// Helper to notify global clients
function notifyGlobal(userId, data) {
    const clients = globalWaitingClients.get(userId) || [];
    const toRemove = [];
    
    clients.forEach((client, index) => {
        try {
            client.res.json(data);
            toRemove.push(index);
        } catch (err) {
            console.error('Failed to notify global client:', err);
            toRemove.push(index);
        }
    });
    
    if (toRemove.length > 0) {
        const remaining = clients.filter((_, i) => !toRemove.includes(i));
        if (remaining.length > 0) {
            globalWaitingClients.set(userId, remaining);
        } else {
            globalWaitingClients.delete(userId);
        }
    }
}

app.get('/api/users/chats/wait', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        
        // Set timeout (60 seconds)
        const timeout = setTimeout(() => {
            const clients = globalWaitingClients.get(userId) || [];
            const index = clients.findIndex(c => c.res === res);
            if (index !== -1) {
                clients.splice(index, 1);
                if (clients.length === 0) {
                    globalWaitingClients.delete(userId);
                }
            }
            res.status(204).end();
        }, 60000);
        
        // Add client to waiting list
        if (!globalWaitingClients.has(userId)) {
            globalWaitingClients.set(userId, []);
        }
        globalWaitingClients.get(userId).push({ res });
        
        req.on('close', () => {
            clearTimeout(timeout);
            const clients = globalWaitingClients.get(userId) || [];
            const index = clients.findIndex(c => c.res === res);
            if (index !== -1) {
                clients.splice(index, 1);
                if (clients.length === 0) {
                    globalWaitingClients.delete(userId);
                }
            }
        });
        
    } catch (error) {
        console.error('Global polling error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Store waiting clients
const waitingClients = new Map(); // chatId -> [{ res, userId }]

// Helper to notify all waiting clients for a chat
function notifyChat(chatId, data) {
    const clients = waitingClients.get(chatId) || [];
    const toRemove = [];
console.log(chatId)

    clients.forEach((client, index) => {
        try {
            client.res.json(data);
            toRemove.push(index);
        } catch (err) {
            console.error('Failed to notify client:', err);
            toRemove.push(index);
        }
    });
    
    if (toRemove.length > 0) {
        const remaining = clients.filter((_, i) => !toRemove.includes(i));
        if (remaining.length > 0) {
            waitingClients.set(chatId, remaining);
        } else {
            waitingClients.delete(chatId);
        }
    }
}

// GET /api/chats/:chatId/wait - Long polling for new messages in a chat
app.get('/api/chats/:chatId/wait', authenticate, async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const userId = req.userId;
        
        // Check access
        const hasAccess = await hasChatAccess(userId, chatId);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // Set timeout (60 seconds)
        const timeout = setTimeout(() => {
            // Remove client from waiting list
            const clients = waitingClients.get(chatId) || [];
            const index = clients.findIndex(c => c.res === res);
            if (index !== -1) {
                clients.splice(index, 1);
                if (clients.length === 0) {
                    waitingClients.delete(chatId);
                }
            }
            res.status(204).end(); // No content, just timeout
        }, 60000);
        
        // Add client to waiting list
        if (!waitingClients.has(chatId)) {
            waitingClients.set(chatId, []);
        }
        waitingClients.get(chatId).push({ res, userId });
        
        // Clean up timeout if connection closes
        req.on('close', () => {
            clearTimeout(timeout);
            const clients = waitingClients.get(chatId) || [];
            const index = clients.findIndex(c => c.res === res);
            if (index !== -1) {
                clients.splice(index, 1);
                if (clients.length === 0) {
                    waitingClients.delete(chatId);
                }
            }
        });
        
    } catch (error) {
        console.error('Long polling error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


// ============ NEW CHAT ROUTES ============

// Helper function to check if user has access to a chat
async function hasChatAccess(userId, chatId) {
    const membership = await dbGet(mainDb, `
        SELECT 1 FROM users_chats
        WHERE user_id = ? AND chat_id = ?
        LIMIT 1
    `, [userId, chatId]);
    return Boolean(membership);
}

app.post('/api/chats/create', authenticate, async (req, res) => {
    const userId = req.userId;
    const otherUserId = Number(req.body.userId);
    if (!Number.isSafeInteger(otherUserId) || otherUserId === userId) {
        return res.status(400).json({ error: 'Valid other user required' });
    }

    try {
        const otherUser = await dbGet(mainDb, `
            SELECT id, username, profile_picture, status
            FROM users WHERE id = ?
        `, [otherUserId]);
        if (!otherUser) return res.status(404).json({ error: 'User not found' });

        const chatId = [userId, otherUserId].sort((a, b) => a - b).join('_');
        await dbRun(mainDb, 'BEGIN IMMEDIATE TRANSACTION');
        try {
            await dbRun(mainDb, 'INSERT OR IGNORE INTO chats (id, type) VALUES (?, ?)', [chatId, 'direct']);
            await dbRun(mainDb, 'INSERT OR IGNORE INTO users_chats (user_id, chat_id) VALUES (?, ?)', [userId, chatId]);
            await dbRun(mainDb, 'INSERT OR IGNORE INTO users_chats (user_id, chat_id) VALUES (?, ?)', [otherUserId, chatId]);
            await dbRun(mainDb, 'COMMIT');
        } catch (error) {
            await dbRun(mainDb, 'ROLLBACK').catch(() => {});
            throw error;
        }

        const publicRole = await getPublicRoleForUser(otherUser.id);
        res.json({
            chatId,
            chat: {
                chatId,
                userId: otherUser.id,
                username: otherUser.username,
                profilePicture: otherUser.profile_picture || '/default-avatar.jpg',
                status: otherUser.status || '',
                ...publicRole
            }
        });
    } catch (error) {
        console.error('Create chat error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/users/chats/unread - Get total unread messages count for user
app.get('/api/users/chats/unread', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        
        const result = await new Promise((resolve, reject) => {
            mainDb.get(`
                SELECT COUNT(*) as count 
                FROM messages m
                JOIN users_chats uc ON m.chat_id = uc.chat_id
                WHERE uc.user_id = ? AND m.user_id != ? AND m.is_read = 0
            `, [userId, userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        res.json({ unreadCount: result?.count || 0 });
        
    } catch (error) {
        console.error('Error getting unread count:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/chats/messages/:chatId - Get last 60 messages with pagination
app.get('/api/chats/messages/:chatId', authenticate, async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const userId = req.userId;
        const beforeMessageId = req.query.before ? parseInt(req.query.before) : null;
        const limit = 60;
        
        // Check access
        const hasAccess = await hasChatAccess(userId, chatId);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied to this chat' });
        }
        
        let query = `
            SELECT 
                m.id, m.chat_id, m.user_id, m.message_text, 
                m.file_paths, m.file_types, m.is_read, m.created_at, 
                m.reference_id, m.edited,
                u.username, u.profile_picture
            FROM messages m
            JOIN users u ON m.user_id = u.id
            WHERE m.chat_id = ?
        `;
        
        let params = [chatId];
        
        if (beforeMessageId) {
            // Get message timestamp to paginate properly
            const beforeMessage = await new Promise((resolve, reject) => {
                mainDb.get(`SELECT created_at FROM messages WHERE id = ? AND chat_id = ?`, 
                    [beforeMessageId, chatId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            if (beforeMessage) {
                query += ` AND m.created_at < ?`;
                params.push(beforeMessage.created_at);
            } else {
                return res.status(404).json({ error: 'Reference message not found' });
            }
        }
        
        query += ` ORDER BY m.created_at DESC LIMIT ?`;
        params.push(limit);
        
        mainDb.all(query, params, async (err, messages) => {
            if (err) {
                console.error('Error fetching messages:', err);
                return res.status(500).json({ error: 'Failed to load messages' });
            }
            
            // Reverse to chronological order
            const chronologicalMessages = messages.reverse();
            const formattedMessages = await Promise.all(
                chronologicalMessages.map(formatChatMessage)
            );
            const nextMessageId = messages.length === limit ? messages[messages.length - 1].id : null;
            
            res.json({
                messages: formattedMessages,
                nextMessageId: nextMessageId
            });
        });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/chats/messages/:chatId/before/:messageId', authenticate, async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const userId = req.userId;
        const messageId = parseInt(req.params.messageId);
        const limit = 60;
        
        // Check access
        const hasAccess = await hasChatAccess(userId, chatId);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied to this chat' });
        }
        
        // Get messages with ID less than the given messageId
        const query = `
            SELECT 
                m.id, m.chat_id, m.user_id, m.message_text, 
                m.file_paths, m.file_types, m.is_read, m.created_at, 
                m.reference_id, m.edited,
                u.username, u.profile_picture
            FROM messages m
            JOIN users u ON m.user_id = u.id
            WHERE m.chat_id = ? AND m.id < ?
            ORDER BY m.id DESC
            LIMIT ?
        `;
        
        mainDb.all(query, [chatId, messageId, limit], async (err, messages) => {
            if (err) {
                console.error('Error fetching messages:', err);
                return res.status(500).json({ error: 'Failed to load messages' });
            }
            
            // Reverse to chronological order (oldest to newest)
            const chronologicalMessages = messages.reverse();
            const formattedMessages = await Promise.all(
                chronologicalMessages.map(formatChatMessage)
            );
            
            // Return the oldest message ID from this batch for pagination
            const oldestMessageId = messages.length === limit ? messages[0].id : null;
            
            res.json({
                messages: formattedMessages,
                oldestMessageId: oldestMessageId
            });
        });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

//SEND A MESSAGE
app.post('/api/chats/messages/:chatId', authenticate, uploadMedia.array('files', 10), async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const userId = req.userId;
        const { messageText, referenceId } = req.body;
        
        // Check access
        const hasAccess = await hasChatAccess(userId, chatId);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied to this chat' });
        }
        
        // Process files
        const files = req.files || [];
        const filePaths = [];
        const fileTypes = [];
        
        for (const file of files) {
            const mimeType = file.mimetype;
            const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
            
            let folder = 'images';
            let filename = unique;
            let finalPath;
            
            // Handle GIF specially
            if (mimeType === 'image/gif') {
                folder = 'images';
                filename = unique + '.gif';
                finalPath = path.join(__dirname, folder, filename);
                fs.writeFileSync(finalPath, file.buffer);
                const filePath = '/' + folder + '/' + filename;
                filePaths.push(filePath);
                fileTypes.push('gif');
                await dbRun(mainDb, `
                    INSERT INTO photos (file_path, uploaded_by, created_at)
                    VALUES (?, ?, ?)
                `, [filePath, userId, Math.floor(Date.now() / 1000)]);
            }
            // Handle images (convert to webp but preserve gifs)
            else if (mimeType.startsWith('image/')) {
                folder = 'images';
                filename = unique + '.webp';
                finalPath = path.join(__dirname, folder, filename);
                await sharp(file.buffer)
                    .resize({ width: 1200, withoutEnlargement: true })
                    .webp({ quality: 80 })
                    .toFile(finalPath);
                const filePath = '/' + folder + '/' + filename;
                filePaths.push(filePath);
                fileTypes.push('image');
                await dbRun(mainDb, `
                    INSERT INTO photos (file_path, uploaded_by, created_at)
                    VALUES (?, ?, ?)
                `, [filePath, userId, Math.floor(Date.now() / 1000)]);
            }
            else if (mimeType.startsWith('video/')) {
                folder = 'videos';
                filename = unique + '.mp4';
                finalPath = path.join(__dirname, folder, filename);
                fs.writeFileSync(finalPath, file.buffer);
                filePaths.push('/' + folder + '/' + filename);
                fileTypes.push('video');
            }
            else if (mimeType.startsWith('audio/')) {
                folder = 'audios';
                filename = unique + '.mp3';
                finalPath = path.join(__dirname, folder, filename);
                fs.writeFileSync(finalPath, file.buffer);
                filePaths.push('/' + folder + '/' + filename);
                fileTypes.push('audio');
            }
        }
        
        const finalReferenceId = referenceId && referenceId !== '-1' ? referenceId : null;
        
        mainDb.run(`
            INSERT INTO messages (chat_id, user_id, message_text, file_paths, file_types, created_at, is_read, reference_id, edited)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 0, ?, 0)
        `, [chatId, userId, messageText || '', filePaths.join(','), fileTypes.join(','), finalReferenceId], async function(err) {
            if (err) {
                console.error('Error sending message:', err);
                return res.status(500).json({ error: 'Failed to send message' });
            }
            
            // Get the latest message from the other user that was just read
            const latestRead = await new Promise((resolve, reject) => {
                mainDb.get(
                    `SELECT MAX(id) as id FROM messages 
                     WHERE chat_id = ? AND user_id != ? AND is_read = 1`,
                    [chatId, userId],
                    (err, row) => err ? reject(err) : resolve(row)
                );
            });
            
            // Mark all messages from other participants as read
            mainDb.run(`
                UPDATE messages 
                SET is_read = 1 
                WHERE chat_id = ? AND user_id != ?
            `, [chatId, userId], function(readErr) {
                if (readErr) {
                    console.error('Error marking messages as read:', readErr);
                }
            });
            
            // Get the full message to send back
            mainDb.get(`
                SELECT 
                    m.id, m.chat_id, m.user_id, m.message_text, 
                    m.file_paths, m.file_types, m.is_read, m.created_at, 
                    m.reference_id, m.edited,
                    u.username, u.profile_picture
                FROM messages m
                JOIN users u ON m.user_id = u.id
                WHERE m.id = ?
            `, [this.lastID], async (err, msg) => {
                if (err) {
                    console.error('Error fetching new message:', err);
                    return res.status(500).json({ error: 'Failed to send message' });
                }
                
                const formattedMsg = await formatChatMessage(msg);
                
                // Notify B about new message
                notifyChat(chatId, {
                    type: 'new_message',
                    message: formattedMsg
                });
                
                // Get B's user ID
                const participants = await new Promise((resolve, reject) => {
                    mainDb.all(
                        `SELECT user_id FROM users_chats WHERE chat_id = ? AND user_id != ?`,
                        [chatId, userId],
                        (err, rows) => err ? reject(err) : resolve(rows)
                    );
                });
                
                // Notify B globally
                for (const participant of participants) {
                    notifyGlobal(participant.user_id, {
                        type: 'new_message_global',
                        chatId: chatId,
                        message: formattedMsg
                    });
                    
                    // ALSO notify B that their messages were read
                    notifyChat(chatId, {
                        type: 'messages_read',
                        chatId: chatId,
                        lastReadMessageId: latestRead?.id || null
                    });
                    
                    notifyGlobal(participant.user_id, {
                        type: 'messages_read_global',
                        chatId: chatId,
                        lastReadMessageId: latestRead?.id || null
                    });
                }
                
                res.json({
                    success: true,
                    messageId: this.lastID
                });
            });
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/chats/messages/message/:messageId - Get single message with access check
app.get('/api/chats/messages/message/:messageId', authenticate, async (req, res) => {
    try {
        const messageId = parseInt(req.params.messageId);
        const userId = req.userId;
        
        // Get message with chat info
        const message = await new Promise((resolve, reject) => {
            mainDb.get(`
                SELECT m.*, u.username, u.profile_picture, m.chat_id
                FROM messages m
                JOIN users u ON m.user_id = u.id
                WHERE m.id = ?
            `, [messageId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }
        
        // Check access to the chat
        const hasAccess = await hasChatAccess(userId, message.chat_id);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        res.json(await formatChatMessage(message));
    } catch (error) {
        console.error('Error fetching message:', error);
        res.status(500).json({ error: 'Server error' });
    }
}); 

// POST /api/users/chats/favourite/:chatId - Toggle favourite status
app.post('/api/users/chats/favourite/:chatId', authenticate, async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const userId = req.userId;
        
        // Check if user has access to this chat
        const hasAccess = await hasChatAccess(userId, chatId);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied to this chat' });
        }
        
        // Check if already favourited
        const existing = await new Promise((resolve, reject) => {
            mainDb.get(`SELECT 1 FROM chat_favourites WHERE chat_id = ? AND user_id = ?`, 
                [chatId, userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (existing) {
            // Remove favourite
            mainDb.run(`DELETE FROM chat_favourites WHERE chat_id = ? AND user_id = ?`, 
                [chatId, userId], (err) => {
                if (err) {
                    console.error('Error removing favourite:', err);
                    return res.status(500).json({ error: 'Failed to remove favourite' });
                }
                res.json({ success: true, favourited: false });
            });
        } else {
            // Add favourite
            mainDb.run(`INSERT INTO chat_favourites (chat_id, user_id) VALUES (?, ?)`, 
                [chatId, userId], (err) => {
                if (err) {
                    console.error('Error adding favourite:', err);
                    return res.status(500).json({ error: 'Failed to add favourite' });
                }
                res.json({ success: true, favourited: true });
            });
        }
    } catch (error) {
        console.error('Error toggling favourite:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/users/chats/read/:chatId', authenticate, async (req, res) => {
    console.log('bitch');
    try {
        const chatId = req.params.chatId; // Keep as string
        const userId = req.userId;
        
        const hasAccess = await hasChatAccess(userId, chatId);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        mainDb.run(`
            UPDATE messages 
            SET is_read = 1 
            WHERE chat_id = ? AND user_id != ?
        `, [chatId, String(userId)], function(err) {
            if (err) {
                console.error('Error marking messages as read:', err);
                return res.status(500).json({ error: 'Failed to mark as read' });
            }
            
            console.log('✅ Updated rows:', this.changes);
            
            mainDb.all(
                `SELECT user_id FROM users_chats WHERE chat_id = ? AND user_id != ?`,
                [chatId, String(userId)],
                (err, participants) => {
                    if (err) {
                        console.error('Error getting participants:', err);
                        return res.status(500).json({ error: 'Failed to get participants' });
                    }

                    notifyChat(chatId, {
                        type: 'read_all',
                        chatId: chatId
                    });
                    
                    if (participants && participants.length > 0) {
                        participants.forEach(p => {
                            notifyGlobal(p.user_id, {
                                type: 'read_all_global',
                                chatId: chatId
                            });
                        });
                    }
                    
                    res.json({ success: true, updatedCount: this.changes });
                }
            );
        });
    } catch (error) {
        console.error('Error marking messages as read:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/users/chats/:userId - Get all chats for user (favourites + others)
app.get('/api/users/chats/:userId', authenticate, async (req, res) => {
    try {
        console.log('=== CHATS ROUTE CALLED ===');
        const currentUserId = req.userId;
        const targetUserId = parseInt(req.params.userId);
        
        if (targetUserId !== currentUserId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const participants = await new Promise((resolve, reject) => {
            mainDb.all(
                `SELECT chat_id FROM users_chats WHERE user_id = ?`,
                [currentUserId],
                (err, rows) => err ? reject(err) : resolve(rows)
            );
        });
        
        if (!participants || participants.length === 0) {
            return res.json({ favouriteChats: [], userChats: [] });
        }
        
        const chatIds = participants.map(p => p.chat_id);
        const placeholders = chatIds.map(() => '?').join(',');
        
        const chats = await new Promise((resolve, reject) => {
            mainDb.all(
                `SELECT id as chat_id, type FROM chats WHERE id IN (${placeholders})`,
                chatIds,
                (err, rows) => err ? reject(err) : resolve(rows)
            );
        });
        
        const chatPromises = chats.map(async (chat) => {
            const chatId = chat.chat_id;
            const type = chat.type;
            
            let chatInfo;
            if (type === 'direct') {
                const otherParticipant = await new Promise((resolve, reject) => {
                    mainDb.get(
                        `SELECT user_id FROM users_chats WHERE chat_id = ? AND user_id != ?`,
                        [chatId, currentUserId],
                        (err, row) => err ? reject(err) : resolve(row)
                    );
                });
                
                if (!otherParticipant) return null;
                
                const user = await dbGet(
                    mainDb,
                    'SELECT id, username, status, profile_picture FROM users WHERE id = ?',
                    [otherParticipant.user_id]
                );
                const publicRole = await getPublicRoleForUser(Number(otherParticipant.user_id));

                chatInfo = {
                    userId: Number(otherParticipant.user_id),
                    username: user?.username || 'Unknown',
                    status: user?.status || null,
                    profilePicture: user?.profile_picture || null,
                    ...publicRole
                };
            } else if (type === 'group') {

                const groupChat = await new Promise((resolve, reject) => {
                    mainDb.get(
                        `SELECT username, status, profile_picture FROM chats_groupchats WHERE chat_id = ?`,
                        [chatId],
                        (err, row) => err ? reject(err) : resolve(row)
                    );
                });
                
                chatInfo = {
                    username: groupChat?.username || 'Группа',
                    status: groupChat?.status || null,
                    profilePicture: groupChat?.profile_picture || null
                };
            }
            
            const lastMessage = await new Promise((resolve, reject) => {
		    mainDb.get(
		        `SELECT message_text, created_at, file_paths, file_types, is_read, user_id 
		         FROM messages WHERE chat_id = ? 
		         ORDER BY created_at DESC LIMIT 1`,
		        [chatId],
		        (err, row) => err ? reject(err) : resolve(row)
		    );
		});
            
            return {
		    chatId: chatId,
		    type: type,
		    status: chatInfo?.status || null,
		    username: chatInfo?.username || 'Unknown',
		    profilePicture: chatInfo?.profilePicture || null,
                    userId: chatInfo?.userId || null,
                    isOwner: Boolean(chatInfo?.isOwner),
                    isDeveloper: Boolean(chatInfo?.isDeveloper),
                    isModerator: Boolean(chatInfo?.isModerator),
                    displayRole: chatInfo?.displayRole || null,
		    lastMessage: lastMessage?.message_text || 
	               (lastMessage?.file_paths ? '[Файл]' : 'Нет сообщений'),
		    lastMessageSenderId: lastMessage?.user_id || null, // ADD THIS
		    lastMessageTime: lastMessage?.created_at || null,
                lastMessageFile: lastMessage?.file_paths?.split(',')[0] || null,
                lastMessageFileType: lastMessage?.file_types?.split(',')[0] || null,
                lastMessageIsRead: lastMessage?.is_read || null,
                unreadCount: 0
            };
        });
        
        let userChats = (await Promise.all(chatPromises)).filter(chat => chat !== null);
        
        const unreadCounts = await new Promise((resolve, reject) => {
            mainDb.all(
                `SELECT chat_id, COUNT(*) as unread_count 
                 FROM messages 
                 WHERE chat_id IN (${placeholders}) AND user_id != ? AND is_read = 0
                 GROUP BY chat_id`,
                [...chatIds, currentUserId],
                (err, rows) => err ? reject(err) : resolve(rows)
            );
        });
        
        const unreadMap = {};
        unreadCounts.forEach(u => {
            unreadMap[u.chat_id] = u.unread_count;
        });
        
        const favourites = await new Promise((resolve, reject) => {
            mainDb.all(
                `SELECT chat_id FROM chat_favourites WHERE user_id = ?`,
                [currentUserId],
                (err, rows) => err ? reject(err) : resolve(rows)
            );
        });
        
        const favouriteIds = new Set(favourites.map(f => f.chat_id));
        
        const finalFavourites = [];
        const finalUserChats = [];
        
        userChats.forEach(chat => {
            chat.unreadCount = unreadMap[chat.chatId] || 0;
            
            if (favouriteIds.has(chat.chatId)) {
                finalFavourites.push(chat);
            } else {
                finalUserChats.push(chat);
            }
        });
        
        finalFavourites.sort((a, b) => 
            new Date(b.lastMessageTime) - new Date(a.lastMessageTime)
        );
        finalUserChats.sort((a, b) => 
            new Date(b.lastMessageTime) - new Date(a.lastMessageTime)
        );
        
        console.log('Favourite chats:', finalFavourites.length);
        console.log('User chats:', finalUserChats.length);
        
        res.json({ favouriteChats: finalFavourites, userChats: finalUserChats });
        
    } catch (error) {
        console.error('Error in chats route:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Helper function to finalize chats with unread counts and favourites
function finalizeChats(chatIds, favouriteChats, userChats, res) {
    const placeholders = chatIds.map(() => '?').join(',');
    
    // Get unread counts for all chats
    mainDb.all(`
        SELECT 
            chat_id,
            COUNT(*) as unread_count
        FROM messages 
        WHERE chat_id IN (${placeholders}) AND user_id != ? AND is_read = 0
        GROUP BY chat_id
    `, [...chatIds, res.req.userId], (err, unreadCounts) => {
        if (err) {
            console.error('Error fetching unread counts:', err);
        }
        
        const unreadMap = {};
        if (unreadCounts) {
            unreadCounts.forEach(u => {
                unreadMap[u.chat_id] = u.unread_count;
            });
        }
        
        // Get favourites for all chats
        mainDb.all(`
            SELECT chat_id FROM chat_favourites WHERE user_id = ?
        `, [res.req.userId], (err, favourites) => {
            if (err) {
                console.error('Error fetching favourites:', err);
            }
            
            const favouriteIds = new Set();
            if (favourites) {
                favourites.forEach(f => favouriteIds.add(f.chat_id));
            }
            
            // Apply unread counts and separate into favourite/user arrays
            const finalFavourites = [];
            const finalUserChats = [];
            
            // Process userChats (temporary array with all chats)
            userChats.forEach(chat => {
                chat.unreadCount = unreadMap[chat.chatId] || 0;
                
                if (favouriteIds.has(chat.chatId)) {
                    finalFavourites.push(chat);
                } else {
                    finalUserChats.push(chat);
                }
            });
            
            // Sort by last message time (newest first)
            //finalFavourites.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
            finalUserChats.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
            
            console.log('Favourite chats:', finalFavourites.length);
            console.log('User chats:', finalUserChats.length);
            
            res.json({ favouriteChats: finalFavourites, userChats: finalUserChats });
        });
    });
}

// Remove a conversation from the current user's list. A participant must not
// be able to destroy shared messages and attachments for everybody else.
app.delete('/api/users/chats/:chatId', authenticate, async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const userId = req.userId;
        const hasAccess = await hasChatAccess(userId, chatId);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied to this chat' });
        }

        await dbRun(mainDb, 'BEGIN IMMEDIATE TRANSACTION');
        try {
            await dbRun(mainDb, 'DELETE FROM chat_favourites WHERE user_id = ? AND chat_id = ?', [userId, chatId]);
            const membershipResult = await dbRun(mainDb, 'DELETE FROM users_chats WHERE user_id = ? AND chat_id = ?', [userId, chatId]);
            const remainingMembership = await dbGet(mainDb, 'SELECT 1 FROM users_chats WHERE chat_id = ? LIMIT 1', [chatId]);

            if (!remainingMembership) {
                const fileRows = await dbAll(mainDb, `
                    SELECT file_paths FROM messages
                    WHERE chat_id = ? AND file_paths IS NOT NULL AND file_paths != ''
                `, [chatId]);
                await dbRun(mainDb, 'DELETE FROM messages WHERE chat_id = ?', [chatId]);
                await dbRun(mainDb, 'DELETE FROM chat_favourites WHERE chat_id = ?', [chatId]);
                await dbRun(mainDb, 'DELETE FROM chats WHERE id = ?', [chatId]);
                await dbRun(mainDb, 'COMMIT');

                fileRows.forEach(row => {
                    String(row.file_paths || '')
                        .split(',')
                        .filter(Boolean)
                        .forEach(deleteManagedMediaFile);
                });
                return res.json({ success: true, removedForCurrentUser: true, chatDeleted: true });
            }

            await dbRun(mainDb, 'COMMIT');
            return res.json({
                success: true,
                removedForCurrentUser: membershipResult.changes > 0,
                chatDeleted: false
            });
        } catch (error) {
            await dbRun(mainDb, 'ROLLBACK').catch(() => {});
            throw error;
        }
    } catch (error) {
        console.error('Error removing chat for user:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/chats/messages/read/:messageId - Mark message and all before as read
app.post('/api/chats/messages/read/:messageId', authenticate, async (req, res) => {
    try {
        const messageId = parseInt(req.params.messageId);
        const userId = req.userId;
        
        // Get message to find chat_id and timestamp
        const message = await new Promise((resolve, reject) => {
            mainDb.get(`SELECT chat_id, created_at FROM messages WHERE id = ?`, 
                [messageId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }
        
        // Check access
        const hasAccess = await hasChatAccess(userId, message.chat_id);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // Mark all messages in this chat up to this message as read
        mainDb.run(`
            UPDATE messages 
            SET is_read = 1 
            WHERE chat_id = ? AND created_at <= ? AND user_id != ?
        `, [message.chat_id, message.created_at, userId], function(err) {
            if (err) {
                console.error('Error marking messages as read:', err);
                return res.status(500).json({ error: 'Failed to mark as read' });
            }
            
            res.json({ success: true, updatedCount: this.changes });
        });
    } catch (error) {
        console.error('Error marking messages as read:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/users/chats/read/all - Mark all messages in all user's chats as read
app.post('/api/users/chats/read/all', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        
        // Get all chat IDs the user is in
        const chats = await new Promise((resolve, reject) => {
            mainDb.all(`SELECT chat_id FROM users_chats WHERE user_id = ?`, 
                [userId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        if (chats.length === 0) {
            return res.json({ success: true, updatedCount: 0 });
        }
        
        const chatIds = chats.map(c => c.chat_id);
        const placeholders = chatIds.map(() => '?').join(',');
        
        // Mark all messages in those chats as read
        mainDb.run(`
            UPDATE messages 
            SET is_read = 1 
            WHERE chat_id IN (${placeholders}) AND user_id != ?
        `, [...chatIds, userId], function(err) {
            if (err) {
                console.error('Error marking all as read:', err);
                return res.status(500).json({ error: 'Failed to mark as read' });
            }
            
            res.json({ success: true, updatedCount: this.changes });
        });
    } catch (error) {
        console.error('Error marking all as read:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE
app.delete('/api/chats/messages/message', authenticate, async (req, res) => {
    try {
        const { messageId } = req.body;
        const userId = req.userId;
        
        if (!messageId) {
            return res.status(400).json({ error: 'Message ID required' });
        }
        
        // Get message details
        const message = await new Promise((resolve, reject) => {
            mainDb.get(`SELECT * FROM messages WHERE id = ?`, 
                [messageId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }
        
        // Check if user owns this message
        if (message.user_id !== userId) {
            return res.status(403).json({ error: 'Only the message owner can delete it' });
        }
        
        // Delete attached files from disk
        if (message.file_paths) {
            message.file_paths.split(',').forEach(filePath => deleteManagedMediaFile(filePath));
        }
        
        // Delete the message
        mainDb.run(`DELETE FROM messages WHERE id = ?`, [messageId], (err) => {
            if (err) {
                console.error('Error deleting message:', err);
                return res.status(500).json({ error: 'Failed to delete message' });
            }
            
            res.json({ success: true });
        });
    } catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/chats/messages/message
app.put('/api/chats/messages/message', authenticate, uploadMedia.array('newFiles', 10), async (req, res) => {
    try {
        const { messageId, newText, deleteFiles } = req.body;
        const userId = req.userId;
        
        if (!messageId) {
            return res.status(400).json({ error: 'Message ID required' });
        }
        
        // Get current message
        const message = await new Promise((resolve, reject) => {
            mainDb.get(`SELECT * FROM messages WHERE id = ?`, 
                [messageId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }
        
        // Check ownership
        if (message.user_id !== userId) {
            return res.status(403).json({ error: 'Only the message owner can edit it' });
        }
        
        // Parse existing files
        let existingFiles = message.file_paths ? message.file_paths.split(',') : [];
        let existingTypes = message.file_types ? message.file_types.split(',') : [];
        
        // Delete specified files
        let deleteFilesArray = [];
        if (deleteFiles) {
            deleteFilesArray = typeof deleteFiles === 'string' ? JSON.parse(deleteFiles) : deleteFiles;
        }
        
        deleteFilesArray.forEach(filePathToDelete => {
            const index = existingFiles.indexOf(filePathToDelete);
            if (index !== -1) {
                // Remove from arrays
                existingFiles.splice(index, 1);
                existingTypes.splice(index, 1);
                
                // Delete only managed local media paths from the stored message.
                deleteManagedMediaFile(filePathToDelete);
            }
        });
        
        // Add new files
        const newFiles = req.files || [];
        
        for (const file of newFiles) {
            const mimeType = file.mimetype;
            const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
            
            let folder = 'images';
            let filename = unique;
            let finalPath;
            let fileType = '';
            
            if (mimeType === 'image/gif') {
                folder = 'images';
                filename = unique + '.gif';
                finalPath = path.join(__dirname, folder, filename);
                fs.writeFileSync(finalPath, file.buffer);
                existingFiles.push('/' + folder + '/' + filename);
                existingTypes.push('gif');
            }
            else if (mimeType.startsWith('image/')) {
                folder = 'images';
                filename = unique + '.webp';
                finalPath = path.join(__dirname, folder, filename);
                await sharp(file.buffer)
                    .resize({ width: 1200, withoutEnlargement: true })
                    .webp({ quality: 80 })
                    .toFile(finalPath);
                existingFiles.push('/' + folder + '/' + filename);
                existingTypes.push('image');
            }
            else if (mimeType.startsWith('video/')) {
                folder = 'videos';
                filename = unique + '.mp4';
                finalPath = path.join(__dirname, folder, filename);
                fs.writeFileSync(finalPath, file.buffer);
                existingFiles.push('/' + folder + '/' + filename);
                existingTypes.push('video');
            }
            else if (mimeType.startsWith('audio/')) {
                folder = 'audios';
                filename = unique + '.mp3';
                finalPath = path.join(__dirname, folder, filename);
                fs.writeFileSync(finalPath, file.buffer);
                existingFiles.push('/' + folder + '/' + filename);
                existingTypes.push('audio');
            }
        }
        
        // Update the message
        mainDb.run(`
            UPDATE messages 
            SET message_text = ?, file_paths = ?, file_types = ?, edited = 1
            WHERE id = ?
        `, [newText || '', existingFiles.join(','), existingTypes.join(','), messageId], (err) => {
            if (err) {
                console.error('Error editing message:', err);
                return res.status(500).json({ error: 'Failed to edit message' });
            }
            
            res.json({ 
                success: true, 
                message: {
                    id: messageId,
                    messageText: newText || '',
                    filePaths: existingFiles,
                    fileTypes: existingTypes,
                    edited: true
                }
            });
        });
    } catch (error) {
        console.error('Error editing message:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

//======= MASCOT ROUTES ==============

app.get('/api/users/mascot/status', authenticate, async (req, res) => {
    const userId = req.userId;
    
    mainDb.get(`
        SELECT bricked, hand_holding 
        FROM user_mascot_status 
        WHERE user_id = ?
    `, [userId], async (err, status) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        // If no row exists, return default -1 (first time)
        if (!status) {
            return res.json({ bricked: -1, hand_holding: 1 });
        }
        
        res.json({ 
            bricked: 0,
            hand_holding: status.hand_holding 
        });
    });
});

app.put('/api/users/mascot/status', authenticate, async (req, res) => {
    try {
        await dbRun(mainDb, `
            INSERT INTO user_mascot_status (user_id, bricked, hand_holding)
            VALUES (?, 0, 1)
            ON CONFLICT(user_id) DO UPDATE SET bricked = 0
        `, [req.userId]);
        res.json({ success: true, bricked: 0 });
    } catch (error) {
        console.error('Set mascot status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/users/mascot/status', authenticate, async (req, res) => {
    const userId = req.userId;
    
    // Get current status
    mainDb.get(`
        SELECT bricked 
        FROM user_mascot_status 
        WHERE user_id = ?
    `, [userId], async (err, status) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        let newStatus;
        
        // If no row exists, create one with bricked = 0
        if (!status) {
            mainDb.run(`
                INSERT INTO user_mascot_status (user_id, bricked, hand_holding)
                VALUES (?, 0, 1)
            `, [userId], function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Failed to create status' });
                }
                res.json({ bricked: 0 });
            });
            return;
        }
        
        newStatus = 0;
        
        mainDb.run(`
            UPDATE user_mascot_status
            SET bricked = 0
            WHERE user_id = ?
        `, [userId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to update status' });
            }
            res.json({ bricked: newStatus });
        });
    });
});

// GET /api/mascot/news - Get unread news for user
app.get('/api/users/mascot/news', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        
        // Check how many news entries exist total
        mainDb.get(`SELECT COUNT(*) as count FROM mascot_news`, [], (err, total) => {
            console.log('📰 Total news in DB:', total?.count || 0);
        });
        
        const unreadNews = await new Promise((resolve, reject) => {
            mainDb.all(`
                SELECT mn.id, mn.title, mn.content
                FROM mascot_news mn
                LEFT JOIN user_mascot_news umn ON mn.id = umn.news_id AND umn.user_id = ?
                WHERE umn.user_id IS NULL
                ORDER BY mn.id DESC
            `, [userId], (err, rows) => {
                if (err) reject(err);
                else {
                    console.log('📰 Unread news for user', userId, ':', rows.length);
                    resolve(rows);
                }
            });
        });
        
        res.json({ news: unreadNews });
        
    } catch (error) {
        console.error('Error fetching mascot news:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/mascot/news/read - Mark news as read
app.post('/api/users/mascot/news', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const { newsId } = req.body;
        
        if (!newsId) {
            return res.status(400).json({ error: 'newsId required' });
        }
        
        // Check if already read
        const existing = await new Promise((resolve) => {
            mainDb.get(
                `SELECT 1 FROM user_mascot_news WHERE user_id = ? AND news_id = ?`,
                [userId, newsId],
                (err, row) => resolve(row)
            );
        });
        
        if (existing) {
            return res.json({ success: true, alreadyRead: true });
        }
        
        mainDb.run(`
            INSERT INTO user_mascot_news (user_id, news_id)
            VALUES (?, ?)
        `, [userId, newsId], function(err) {
            if (err) {
                console.error('Error marking news as read:', err);
                return res.status(500).json({ error: 'Failed to mark as read' });
            }
            res.json({ success: true });
        });
        
    } catch (error) {
        console.error('Error marking news as read:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/mascot/handholding - Get hand-holding progress
app.get('/api/users/mascot/handholding', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        
        // First check if user has mascot status
        const status = await new Promise((resolve) => {
            mainDb.get(
                `SELECT hand_holding FROM user_mascot_status WHERE user_id = ?`,
                [userId],
                (err, row) => resolve(row)
            );
        });
        
        // If no status or hand_holding is 0, return null
        if (!status || status.hand_holding === 0) {
            return res.json({ hand_holding: 0, progress: null });
        }
        
        // Get hand-holding progress
        const progress = await new Promise((resolve) => {
            mainDb.get(
                `SELECT * FROM user_mascot_hh WHERE user_id = ?`,
                [userId],
                (err, row) => resolve(row)
            );
        });
        
        res.json({ 
            hand_holding: 1,
            progress: progress || {
                main_feed: 0,
                friends: 0,
                chats: 0,
                audios: 0,
                videos: 0,
                profiles: 0,
                ports: 0,
                settings: 0,
                communities: 0,
                community_settings: 0
            }
        });
        
    } catch (error) {
        console.error('Error fetching handholding:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/users/mascot/handholding - Update hand-holding progress
app.post('/api/users/mascot/handholding', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        const { step, complete } = req.body;
        
        // If complete is true, mark hand-holding as done
        if (complete === true) {
            mainDb.run(`
                UPDATE user_mascot_status 
                SET hand_holding = 0 
                WHERE user_id = ?
            `, [userId], function(err) {
                if (err) {
                    console.error('Error completing handholding:', err);
                    return res.status(500).json({ error: 'Failed to complete hand-holding' });
                }
                res.json({ success: true, hand_holding: 0 });
            });
            return;
        }
        
        // Otherwise, update a specific step
        if (!step) {
            return res.status(400).json({ error: 'step or complete required' });
        }
        
        // Valid steps
        const validSteps = [
            'main_feed', 'friends', 'chats', 'audios', 'videos',
            'profiles', 'ports', 'settings', 'communities', 'community_settings'
        ];
        
        if (!validSteps.includes(step)) {
            return res.status(400).json({ error: 'Invalid step' });
        }
        
        // Check if user has hand_holding enabled
        const status = await new Promise((resolve) => {
            mainDb.get(
                `SELECT hand_holding FROM user_mascot_status WHERE user_id = ?`,
                [userId],
                (err, row) => resolve(row)
            );
        });
        
        if (!status || status.hand_holding === 0) {
            return res.status(403).json({ error: 'Hand-holding is disabled' });
        }
        
        // Check if row exists, if not create it
        const exists = await new Promise((resolve) => {
            mainDb.get(
                `SELECT 1 FROM user_mascot_hh WHERE user_id = ?`,
                [userId],
                (err, row) => resolve(row)
            );
        });
        
        if (!exists) {
            await dbRun(mainDb, `
                INSERT INTO user_mascot_hh (user_id) VALUES (?)
            `, [userId]);
        }
        
        // Update the step
        mainDb.run(`
            UPDATE user_mascot_hh 
            SET ${step} = 1, updated_at = strftime('%s', 'now')
            WHERE user_id = ?
        `, [userId], function(err) {
            if (err) {
                console.error('Error updating handholding:', err);
                return res.status(500).json({ error: 'Failed to update' });
            }
            res.json({ success: true });
        });
        
    } catch (error) {
        console.error('Error updating handholding:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============ MASCOT DATA ROUTES ============

// GET /api/mascot/data/user/:userId - Get user stats for mascot
app.get('/api/mascot/data/user/:userId', authenticate, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const currentUserId = req.userId;
        
        // Check if viewing own profile or can view
        if (userId !== currentUserId) {
            // Check privacy settings
            const privacy = await new Promise((resolve) => {
                mainDb.get(
                    `SELECT show_posts_profile FROM user_settings_privacy WHERE user_id = ?`,
                    [userId],
                    (err, row) => resolve(row || { show_posts_profile: 0 })
                );
            });
            
            // If privacy is 2 (no one), return minimal data
            if (privacy.show_posts_profile === 2) {
                return res.json({
                    postCount: '?',
                    likeCount: '?',
                    dislikeCount: '?',
                    commentCount: '?',
                    topCommunity: 'неизвестно'
                });
            }
        }
        
        // Get post count
        const postCount = await new Promise((resolve) => {
            mainDb.get(
                `SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND is_anonymous = 0`,
                [userId],
                (err, row) => resolve(row ? row.count : 0)
            );
        });
        
        // Get like count (likes received on user's posts)
        const likeCount = await new Promise((resolve) => {
            mainDb.get(
                `SELECT COUNT(*) as count FROM post_likes pl
                 JOIN posts p ON pl.post_id = p.id
                 WHERE p.user_id = ? AND p.is_anonymous = 0`,
                [userId],
                (err, row) => resolve(row ? row.count : 0)
            );
        });
        
        // Get dislike count
        const dislikeCount = await new Promise((resolve) => {
            mainDb.get(
                `SELECT COUNT(*) as count FROM post_dislikes pd
                 JOIN posts p ON pd.post_id = p.id
                 WHERE p.user_id = ? AND p.is_anonymous = 0`,
                [userId],
                (err, row) => resolve(row ? row.count : 0)
            );
        });
        
        // Get comment count
        const commentCount = await new Promise((resolve) => {
            mainDb.get(
                `SELECT COUNT(*) as count FROM comments c
                 JOIN posts p ON c.post_id = p.id
                 WHERE p.user_id = ? AND p.is_anonymous = 0`,
                [userId],
                (err, row) => resolve(row ? row.count : 0)
            );
        });
        
        // Get top community (most active)
        const topCommunity = await new Promise((resolve) => {
            mainDb.get(
                `SELECT c.username 
                 FROM posts p
                 JOIN communities c ON p.community_id = c.id
                 WHERE p.user_id = ? AND p.is_anonymous = 0 AND p.community_id IS NOT NULL
                 GROUP BY p.community_id
                 ORDER BY COUNT(*) DESC
                 LIMIT 1`,
                [userId],
                (err, row) => resolve(row ? row.username : 'неизвестно')
            );
        });
        
        res.json({
            postCount: postCount || 0,
            likeCount: likeCount || 0,
            dislikeCount: dislikeCount || 0,
            commentCount: commentCount || 0,
            topCommunity: topCommunity || 'неизвестно'
        });
        
    } catch (error) {
        console.error('Mascot user data error:', error);
        res.status(500).json({ 
            postCount: '?',
            likeCount: '?',
            dislikeCount: '?',
            commentCount: '?',
            topCommunity: 'неизвестно'
        });
    }
});

// GET /api/mascot/data/community/:communityId - Get community stats for mascot
app.get('/api/mascot/data/community/:communityId', authenticate, async (req, res) => {
    try {
        const communityId = parseInt(req.params.communityId);
        
        // Check if community exists
        const community = await new Promise((resolve) => {
            mainDb.get(
                `SELECT id, username FROM communities WHERE id = ?`,
                [communityId],
                (err, row) => resolve(row)
            );
        });
        
        if (!community) {
            return res.status(404).json({ error: 'Community not found' });
        }
        
        // Get post count
        const postCount = await new Promise((resolve) => {
            mainDb.get(
                `SELECT COUNT(*) as count FROM posts WHERE community_id = ?`,
                [communityId],
                (err, row) => resolve(row ? row.count : 0)
            );
        });
        
        // Get total likes on community posts
        const likeCount = await new Promise((resolve) => {
            mainDb.get(
                `SELECT COUNT(*) as count FROM post_likes pl
                 JOIN posts p ON pl.post_id = p.id
                 WHERE p.community_id = ?`,
                [communityId],
                (err, row) => resolve(row ? row.count : 0)
            );
        });
        
        // Get total dislikes on community posts
        const dislikeCount = await new Promise((resolve) => {
            mainDb.get(
                `SELECT COUNT(*) as count FROM post_dislikes pd
                 JOIN posts p ON pd.post_id = p.id
                 WHERE p.community_id = ?`,
                [communityId],
                (err, row) => resolve(row ? row.count : 0)
            );
        });
        
        // Get comment count on community posts
        const commentCount = await new Promise((resolve) => {
            mainDb.get(
                `SELECT COUNT(*) as count FROM comments c
                 JOIN posts p ON c.post_id = p.id
                 WHERE p.community_id = ?`,
                [communityId],
                (err, row) => resolve(row ? row.count : 0)
            );
        });
        
        res.json({
            postCount: postCount || 0,
            likeCount: likeCount || 0,
            dislikeCount: dislikeCount || 0,
            commentCount: commentCount || 0
        });
        
    } catch (error) {
        console.error('Mascot community data error:', error);
        res.status(500).json({ 
            postCount: '?',
            likeCount: '?',
            dislikeCount: '?',
            commentCount: '?'
        });
    }
});

// GET /api/mascot/data/feed - Get feed stats (total posts, users, etc.)
app.get('/api/mascot/data/feed', authenticate, async (req, res) => {
    try {
        const totalUsers = await new Promise((resolve) => {
            mainDb.get(
                `SELECT COUNT(*) as count FROM users`,
                [],
                (err, row) => resolve(row ? row.count : 0)
            );
        });
        
        const totalPosts = await new Promise((resolve) => {
            mainDb.get(
                `SELECT COUNT(*) as count FROM posts`,
                [],
                (err, row) => resolve(row ? row.count : 0)
            );
        });
        
        const totalCommunities = await new Promise((resolve) => {
            mainDb.get(
                `SELECT COUNT(*) as count FROM communities`,
                [],
                (err, row) => resolve(row ? row.count : 0)
            );
        });
        
        res.json({
            totalUsers: totalUsers || 0,
            totalPosts: totalPosts || 0,
            totalCommunities: totalCommunities || 0
        });
        
    } catch (error) {
        console.error('Mascot feed data error:', error);
        res.json({ totalUsers: '?', totalPosts: '?', totalCommunities: '?' });
    }
});


//======= NOTIFICATIONs ROUTES =======

const notificationWaitingClients = new Map(); // userId -> [{ res }]

// Helper to notify notification clients
function notifyNotificationClient(userId, data) {
    const clients = notificationWaitingClients.get(userId) || [];
    const toRemove = [];
    
    clients.forEach((client, index) => {
        try {
            client.res.json(data);
            toRemove.push(index);
        } catch (err) {
            console.error('Failed to notify notification client:', err);
            toRemove.push(index);
        }
    });
    
    if (toRemove.length > 0) {
        const remaining = clients.filter((_, i) => !toRemove.includes(i));
        if (remaining.length > 0) {
            notificationWaitingClients.set(userId, remaining);
        } else {
            notificationWaitingClients.delete(userId);
        }
    }
}

// GET /api/users/notifications/wait - Long polling for notifications
app.get('/api/users/notifications/wait', authenticate, async (req, res) => {
    try {
        const userId = req.userId;
        
        // Set timeout (60 seconds)
        const timeout = setTimeout(() => {
            const clients = notificationWaitingClients.get(userId) || [];
            const index = clients.findIndex(c => c.res === res);
            if (index !== -1) {
                clients.splice(index, 1);
                if (clients.length === 0) {
                    notificationWaitingClients.delete(userId);
                }
            }
            res.status(204).end();
        }, 60000);
        
        // Add client to waiting list
        if (!notificationWaitingClients.has(userId)) {
            notificationWaitingClients.set(userId, []);
        }
        notificationWaitingClients.get(userId).push({ res });
        
        req.on('close', () => {
            clearTimeout(timeout);
            const clients = notificationWaitingClients.get(userId) || [];
            const index = clients.findIndex(c => c.res === res);
            if (index !== -1) {
                clients.splice(index, 1);
                if (clients.length === 0) {
                    notificationWaitingClients.delete(userId);
                }
            }
        });
        
    } catch (error) {
        console.error('Notification polling error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get all notifications for a user (formatted)
app.get('/api/users/notifications/:userId', optionalAuth, async (req, res) => {
    const userId = parseInt(req.params.userId);
    const currentUserId = req.userId || null;
    
    // If viewing someone else's notifications, deny access
    if (currentUserId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    // Fetch all unread notifications for this user
    mainDb.all(`
        SELECT notification_id, time_created_at, notification_type, source
        FROM user_notifications
        WHERE user_id = ?
        ORDER BY time_created_at DESC
    `, [userId], async (err, notifications) => {
        if (err) {
            console.error('Error fetching notifications:', err);
            return res.status(500).json({ error: 'Failed to load notifications' });
        }
        
        const formattedNotifications = [];
        
        for (const notif of notifications) {
            let formattedNotif = {
                id: notif.notification_id,
                type: notif.notification_type,
                createdAt: new Date(notif.time_created_at * 1000).toISOString(),
                read: false // All fetched notifications are unread by definition
            };
            
            try {
                switch (notif.notification_type) {
                    case 'comment_on_post':
    // Source is comment ID
    const commentData = await new Promise((resolve, reject) => {
        mainDb.get(`
            SELECT c.content, c.user_id as commenter_id, p.id as post_id, p.content as post_content,
                   u.username as commenter_name, u.profile_picture as commenter_picture,
                   CASE WHEN p.is_anonymous = 0 THEN pu.username ELSE NULL END as poster_name
            FROM comments c
            JOIN posts p ON c.post_id = p.id
            JOIN users u ON c.user_id = u.id
            LEFT JOIN users pu ON p.user_id = pu.id
            WHERE c.id = ?
        `, [notif.source], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
    
    if (commentData) {
        const postPreview = commentData.post_content ? 
            (commentData.post_content.length > 20 ? commentData.post_content.substring(0, 20) + '...' : commentData.post_content) : 
            '[публикация с медиа]';
        const commentPreview = commentData.content ? 
            (commentData.content.length > 70 ? commentData.content.substring(0, 70) + '...' : commentData.content) : 
            '[комментарий с медиа]';
        
        formattedNotif.text = `У вашей публикации "${postPreview}" новый комментарий от ${commentData.commenter_name}!`;
        formattedNotif.preview = commentPreview;
        formattedNotif.sourceId = commentData.post_id;
        formattedNotif.postId = commentData.post_id;
        formattedNotif.commentId = Number(notif.source);
        formattedNotif.sourceType = 'post';
        formattedNotif.requesterId = commentData.commenter_id;
        formattedNotif.requesterName = commentData.commenter_name;
        formattedNotif.requesterPicture = commentData.commenter_picture;
        Object.assign(formattedNotif, await getPublicRoleForUser(commentData.commenter_id));
    }
    break;
                        
                    case 'reply_to_comment':
    // Source is comment ID (the reply)
    const replyData = await new Promise((resolve, reject) => {
        mainDb.get(`
            SELECT c.content as reply_content, c.user_id as replier_id, 
                   pc.content as parent_content, u.username as replier_name, u.profile_picture as replier_picture,
                   p.id as post_id
            FROM comments c
            JOIN comments pc ON c.parent_comment_id = pc.id
            JOIN users u ON c.user_id = u.id
            JOIN posts p ON c.post_id = p.id
            WHERE c.id = ?
        `, [notif.source], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
    
    if (replyData) {
        const parentPreview = replyData.parent_content ? 
            (replyData.parent_content.length > 40 ? replyData.parent_content.substring(0, 40) + '...' : replyData.parent_content) : 
            '[комментарий с медиа]';
        const replyPreview = replyData.reply_content ? 
            (replyData.reply_content.length > 70 ? replyData.reply_content.substring(0, 70) + '...' : replyData.reply_content) : 
            '[ответ с медиа]';
        
        formattedNotif.text = `${replyData.replier_name} ответил на ваш комментарий "${parentPreview}"`;
        formattedNotif.preview = replyPreview;
        formattedNotif.sourceId = replyData.post_id;
        formattedNotif.postId = replyData.post_id;
        formattedNotif.commentId = Number(notif.source);
        formattedNotif.sourceType = 'post';
        formattedNotif.requesterId = replyData.replier_id;
        formattedNotif.requesterName = replyData.replier_name;
        formattedNotif.requesterPicture = replyData.replier_picture;
        Object.assign(formattedNotif, await getPublicRoleForUser(replyData.replier_id));
    }
    break;
                        
                    case 'like_on_post':
                        // Source is post ID - likes are anonymous
                        const postData = await new Promise((resolve, reject) => {
                            mainDb.get(`
                                SELECT content, is_anonymous
                                FROM posts
                                WHERE id = ?
                            `, [notif.source], (err, row) => {
                                if (err) reject(err);
                                else resolve(row);
                            });
                        });
                        
                        if (postData) {
                            const postPreview = postData.content ? 
                                (postData.content.length > 30 ? postData.content.substring(0, 30) + '...' : postData.content) : 
                                '[публикация с медиа]';
                            
                            formattedNotif.text = `Ваша публикация "${postPreview}" получила Балл!`;
                            formattedNotif.sourceId = parseInt(notif.source);
                            formattedNotif.sourceType = 'post';
                        }
                        break;
                        
                    case 'like_on_comment':
                        // Source is comment ID - likes are anonymous
                        const commentLikeData = await new Promise((resolve, reject) => {
                            mainDb.get(`
                                SELECT c.content, p.id as post_id
                                FROM comments c
                                JOIN posts p ON c.post_id = p.id
                                WHERE c.id = ?
                            `, [notif.source], (err, row) => {
                                if (err) reject(err);
                                else resolve(row);
                            });
                        });
                        
                        if (commentLikeData) {
                            const commentPreview = commentLikeData.content ? 
                                (commentLikeData.content.length > 50 ? commentLikeData.content.substring(0, 50) + '...' : commentLikeData.content) : 
                                '[комментарий с медиа]';
                            
                            formattedNotif.text = `С вашим комментарием "${commentPreview}" согласились!`;
                            formattedNotif.sourceId = commentLikeData.post_id;
                            formattedNotif.sourceType = 'post';
                        }
                        break;
                        
                    case 'friend_request':
    // Source is user ID of requester - include profile picture
    const requesterData = await new Promise((resolve, reject) => {
        mainDb.get(`
            SELECT username, profile_picture
            FROM users
            WHERE id = ?
        `, [notif.source], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
    
    if (requesterData) {
        formattedNotif.text = `${requesterData.username} хочет к вам подключиться!`;
        formattedNotif.preview = `${requesterData.username} отправил(а) вам заявку в друзья.`;
        formattedNotif.sourceId = parseInt(notif.source);
        formattedNotif.sourceType = 'user';
        formattedNotif.requesterId = Number(notif.source);
        formattedNotif.requesterName = requesterData.username;
        formattedNotif.requesterPicture = requesterData.profile_picture;
        Object.assign(formattedNotif, await getPublicRoleForUser(Number(notif.source)));
    }
    break;
                        
                    case 'friend_request_accepted':
    const accepterData = await new Promise((resolve, reject) => {
        mainDb.get(`
            SELECT username, profile_picture
            FROM users
            WHERE id = ?
        `, [notif.source], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
    
    if (accepterData) {
        formattedNotif.text = `${accepterData.username} принял(а) ваш запрос на подключение!`;
        formattedNotif.preview = `Теперь вы друзья с ${accepterData.username}.`;
        formattedNotif.sourceId = parseInt(notif.source);
        formattedNotif.sourceType = 'user';
        formattedNotif.requesterId = Number(notif.source);
        formattedNotif.requesterName = accepterData.username;
        formattedNotif.requesterPicture = accepterData.profile_picture;
        Object.assign(formattedNotif, await getPublicRoleForUser(Number(notif.source)));
    }
    break;
                }
                
                formattedNotifications.push(formattedNotif);
            } catch (error) {
                console.error(`Error formatting notification ${notif.notification_id}:`, error);
                // Still add a basic notification
                formattedNotifications.push({
                    id: notif.notification_id,
                    type: notif.notification_type,
                    createdAt: new Date(notif.time_created_at * 1000).toISOString(),
                    text: 'Новое уведомление',
                    read: false
                });
            }
        }
        
        res.json(formattedNotifications);
    });
});

// Mark a single notification as read (delete it)
app.post('/api/users/notifications/read/:notifId', authenticate, async (req, res) => {
    const notifId = parseInt(req.params.notifId);
    const userId = req.userId;
    
    // Verify notification belongs to user before deleting
    mainDb.get(`
        SELECT user_id FROM user_notifications WHERE notification_id = ?
    `, [notifId], (err, notif) => {
        if (err) {
            console.error('Error checking notification:', err);
            return res.status(500).json({ error: 'Server error' });
        }
        
        if (!notif) {
            return res.status(404).json({ error: 'Notification not found' });
        }
        
        if (notif.user_id !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // Delete = mark as read
        mainDb.run(`
            DELETE FROM user_notifications WHERE notification_id = ?
        `, [notifId], (err) => {
            if (err) {
                console.error('Error deleting notification:', err);
                return res.status(500).json({ error: 'Failed to mark as read' });
            }
            
            res.json({ success: true });
        });
    });
});

app.post('/api/users/notifications/:userId/read', authenticate, async (req, res) => {
    const userId = parseInt(req.params.userId);
    const currentUserId = req.userId;
    
    if (userId !== currentUserId) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    // Delete all notifications for this user
    mainDb.run(`
        DELETE FROM user_notifications WHERE user_id = ?
    `, [userId], function(err) {
        if (err) {
            console.error('Error deleting all notifications:', err);
            return res.status(500).json({ error: 'Failed to mark all as read' });
        }
        
        res.json({ success: true, deletedCount: this.changes });
    });
});

// Get unread count (for badge)
app.get('/api/users/notifications/:userId/count', optionalAuth, async (req, res) => {
    const userId = parseInt(req.params.userId);
    const currentUserId = req.userId;
    
    if (currentUserId !== userId) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    mainDb.get(`
        SELECT COUNT(*) as count FROM user_notifications WHERE user_id = ?
    `, [userId], (err, row) => {
        if (err) {
            console.error('Error counting notifications:', err);
            return res.status(500).json({ error: 'Server error' });
        }
        
        res.json({ count: row.count });
    });
});

app.get('/api/verify-session', authenticate, async (req, res) => {
    try {
        const capabilities = await getUserCapabilities(req.userId);
        res.json({
            authenticated: true,
            userId: req.userId,
            ...capabilities
        });
    } catch (error) {
        console.error('Verify session error:', error);
        res.status(500).json({ error: 'Server error' });
    }
})

app.use((error, req, res, next) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
        const status = error.code === 'LIMIT_FILE_SIZE' || error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
            ? 413
            : 400;
        return res.status(status).json({ error: error.message });
    }
    if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message || 'Request rejected' });
    }
    console.error('Unhandled request error:', error);
    return res.status(500).json({ error: 'Server error' });
});

//const PORT = 3000;
//const HOST = '::';

// SSL certificate paths
const sslPath = path.join(__dirname, 'ssl');
const options = {
    key: fs.readFileSync(path.join(sslPath, 'certificate.key')),
    cert: fs.readFileSync(path.join(sslPath, 'certificate.crt')),
    ca: fs.readFileSync(path.join(sslPath, 'certificate_ca.crt'))  // CA bundle
};

// Create TWO separate HTTPS servers with the same app
const httpsServer443 = https.createServer(options, app);
const httpsServer3000 = https.createServer(options, app);

// Listen on port 443 (main)
httpsServer443.listen(443, () => {
    console.log('🔒 HTTPS server running on port 443');
});

// Listen on port 3000 (legacy/deprecated)
httpsServer3000.listen(3000, () => {
    console.log('⚠️ HTTPS server also running on port 3000 (deprecated - will be removed)');
});

// HTTP server (redirects to HTTPS)
//http.createServer((req, res) => {
//    const host = req.headers.host;
//    res.writeHead(301, { Location: `https://${host}${req.url}` });
//    res.end();
//}).listen(80, () => {
//    console.log('DEBUG HTTP redirect server on port 80');
//});

//app.listen(PORT, HOST, () => {
//  console.log(`Server running at http://localhost:${PORT}/`);
//  console.log(`Also accessible on your local network IP`);
//});