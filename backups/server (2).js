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
const mainDbPath = path.join(__dirname, 'api', 'main.db');
const mainDb = new sqlite3.Database(mainDbPath);
const { generateVerificationToken, sendVerificationEmail } = require('./config/email');
const { verifyToken } = require('./config/email');
//const { generateVerificationToken, sendVerificationEmail } = require('./config/email');
require('dotenv').config();
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
    message: { error: 'Too many login attempts. Try again later.' }
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
app.use(express.json())
app.use(express.static(__dirname))
app.use('/images', express.static('images'))
app.use('/videos', express.static('videos'))  // NEW
app.use('/audios', express.static('audios'))  // NEW

// MULTER CONFIGURATION
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, true)
  }
})

const uploadUserBackground = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Not an image'), false);
    }
  }
});

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
  const sessionId = req.cookies.sessionId;
  
  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  sessionsDb.get(`
    SELECT user_id FROM sessions 
    WHERE session_id = ? AND expires_at > ?
  `, [sessionId, Date.now()], (err, row) => {
    if (err || !row) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    
    // Attach userId to request for use in route handlers
    req.userId = row.user_id;
    next();
  });
}



// Optional: middleware that doesn't block unauthenticated users
async function optionalAuth(req, res, next) {
    const sessionId = req.cookies.sessionId;
    
    if (sessionId) {
        sessionsDb.get(`
            SELECT user_id FROM sessions 
            WHERE session_id = ? AND expires_at > ?
        `, [sessionId, Date.now()], (err, row) => {
            if (!err && row) {
                req.userId = row.user_id;
            }
            next();
        });
    } else {
        next();
    }
}

// Generate a new session
async function createSession(userId) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
  
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

// Delete session on logout
async function deleteSession(sessionId) {
  return new Promise((resolve, reject) => {
    sessionsDb.run(`DELETE FROM sessions WHERE session_id = ?`, [sessionId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ============ NOTIFICATION HELPER FUNCTIONS ============

async function createNotification(userId, type, source) {
    // Validate notification type
    const validTypes = ['comment_on_post', 'reply_to_comment', 'like_on_post', 'like_on_comment', 'friend_request', 'friend_request_accepted'];
    if (!validTypes.includes(type)) {
        console.error('Invalid notification type:', type);
        return false;
    }
    
    const timeCreatedAt = Math.floor(Date.now() / 1000);
    
    return new Promise((resolve, reject) => {
        mainDb.run(`
            INSERT INTO user_notifications (user_id, time_created_at, notification_type, source)
            VALUES (?, ?, ?, ?)
        `, [userId, timeCreatedAt, type, String(source)], function(err) {
            if (err) {
                console.error('Error creating notification:', err);
                reject(err);
            } else {
                console.log(`Notification created: ${type} for user ${userId} from source ${source}`);
                resolve(this.lastID);
            }
        });
    });
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

app.get('/community', (req, res) => {
  res.sendFile(path.join(__dirname, 'community.html'))
})

app.get('/new_community', (req, res) => {
  res.sendFile(path.join(__dirname, 'new_community.html'))
})

// ============ USER ROUTES ============

app.post('/api/register', async (req, res) => {
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
          
          // Insert default settings
          mainDb.run(`INSERT INTO user_settings_privacy (user_id) VALUES (?)`, [userId]);
          mainDb.run(`INSERT INTO user_settings_customization (user_id) VALUES (?)`, [userId]);
          
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

app.post('/api/resend-verification', async (req, res) => {
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

app.post('/api/add-email', async (req, res) => {
  try {
    const { userId, email } = req.body;
    
    if (!userId || !email) {
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
  res.clearCookie('sessionId');
  res.json({ success: true });
});

// Search users
app.get('/api/users/search', (req, res) => {
    const query = req.query.q || '';
    
    if (query.length < 1) {
        return res.json([]);
    }
    
    mainDb.all(`
        SELECT id, username, profile_picture as profilePicture, status
        FROM users 
        WHERE username LIKE ? AND searchable = 1
        LIMIT 50
    `, [`%${query}%`], (err, users) => {
        if (err) {
            return res.status(500).json({ error: 'Search failed' });
        }
        res.json(users);
    });
});

app.get('/api/isAdmin', authenticate, (req, res) => {
    const userId = req.userId;
    
    mainDb.get(`
        SELECT 1 FROM admins WHERE user_id = ?
    `, [userId], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Server error' });
        }
        res.json({ isAdmin: !!row });
    });
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

app.get('/api/users/seq/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
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

app.get('/api/users/cust/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
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
app.get('/api/posts', optionalAuth, (req, res) => {
    const userId = req.userId || null;
    
    mainDb.all(`
        SELECT p.*, 
               CASE WHEN p.is_anonymous = 0 THEN u.username ELSE NULL END as username,
               u.profile_picture as user_profile_picture
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        ORDER BY p.created_at DESC
    `, (err, posts) => {
        if (err) {
            console.error('Error fetching posts:', err);
            return res.status(500).json({ error: 'Failed to load posts' });
        }
        
        if (posts.length === 0) {
            return res.json([]);
        }
        
        const postIds = posts.map(p => p.id);
        const placeholders = postIds.map(() => '?').join(',');
        
        // Get files
        mainDb.all(`
            SELECT post_id, file_path, file_type, file_order 
            FROM post_files 
            WHERE post_id IN (${placeholders})
            ORDER BY post_id, file_order
        `, postIds, (err, files) => {
            if (err) {
                console.error('Error fetching files:', err);
                return res.status(500).json({ error: 'Failed to load files' });
            }
            
            const filesByPost = {};
            files.forEach(file => {
                if (!filesByPost[file.post_id]) {
                    filesByPost[file.post_id] = { files: [], fileTypes: [] };
                }
                filesByPost[file.post_id].files.push(file.file_path);
                filesByPost[file.post_id].fileTypes.push(file.file_type);
            });
            
            // Get post likes - SIMPLE: just get all likes for these posts
            mainDb.all(`
                SELECT post_id, user_id 
                FROM post_likes 
                WHERE post_id IN (${placeholders})
            `, postIds, (err, postLikes) => {
                if (err) {
                    console.error('Error fetching post likes:', err);
                    return res.status(500).json({ error: 'Failed to load likes' });
                }
                
                // Build likeCount and check if user liked each post
                const likeCounts = {};
                const userLikedPosts = new Set();
                
                postLikes.forEach(like => {
                    // Count likes per post
                    likeCounts[like.post_id] = (likeCounts[like.post_id] || 0) + 1;
                    // Track if current user liked this post
                    if (userId && like.user_id === userId) {
                        userLikedPosts.add(like.post_id);
                    }
                });
                
                // Get comments
                mainDb.all(`
                    SELECT c.*, u.username 
                    FROM comments c
                    LEFT JOIN users u ON c.user_id = u.id
                    WHERE c.post_id IN (${placeholders})
                    ORDER BY c.created_at ASC
                `, postIds, (err, comments) => {
                    if (err) {
                        console.error('Error fetching comments:', err);
                        return res.status(500).json({ error: 'Failed to load comments' });
                    }
                    
                    const commentsByPost = {};
                    comments.forEach(comment => {
                        if (!commentsByPost[comment.post_id]) {
                            commentsByPost[comment.post_id] = [];
                        }
                        commentsByPost[comment.post_id].push({
                            id: comment.id,
                            userId: comment.user_id,
                            reference: comment.paernt_comment_id,
                            username: comment.username,
                            content: comment.content,
                            attachment: comment.attachment_path,
                            attachmentType: comment.attachment_type,
                            createdAt: new Date(comment.created_at * 1000).toISOString(),
                            likes: [],
                            likeCount: 0
                        });
                    });
                    
                    // Get comment likes
                    const commentIds = comments.map(c => c.id);
                    if (commentIds.length > 0) {
                        const commentPlaceholders = commentIds.map(() => '?').join(',');
                        mainDb.all(`
                            SELECT comment_id, user_id
                            FROM comment_likes 
                            WHERE comment_id IN (${commentPlaceholders})
                        `, commentIds, (err, commentLikes) => {
                            const commentLikeCounts = {};
                            const userLikedComments = new Set();
                            
                            commentLikes.forEach(like => {
                                commentLikeCounts[like.comment_id] = (commentLikeCounts[like.comment_id] || 0) + 1;
                                if (userId && like.user_id === userId) {
                                    userLikedComments.add(like.comment_id);
                                }
                            });
                            
                            // Attach likes to comments
                            for (const postId in commentsByPost) {
                                commentsByPost[postId] = commentsByPost[postId].map(comment => ({
                                    ...comment,
                                    likeCount: commentLikeCounts[comment.id] || 0,
                                    likes: userLikedComments.has(comment.id) && userId ? [userId] : []
                                }));
                            }
                            
                            // Build final response
                            const finalPosts = posts.map(post => ({
                                id: post.id,
                                userId: post.is_anonymous ? null : post.user_id,
                                username: post.username,
                                content: post.content,
                                files: filesByPost[post.id]?.files || [],
                                fileTypes: filesByPost[post.id]?.fileTypes || [],
                                community: post.community_id ? String(post.community_id) : '',
                                isAnonymous: post.is_anonymous === 1,
                                createdAt: new Date(post.created_at * 1000).toISOString(),
                                likeCount: likeCounts[post.id] || 0,
                                likes: userLikedPosts.has(post.id) && userId ? [userId] : [],
                                comments: commentsByPost[post.id] || [],
                                isSpoiler: post.is_spoiler || false,
                                isNsfw: post.is_nsfw || false,
                                spoilerPreview: post.spoiler_preview || ''
                            }));
                            
                            res.json(finalPosts);
                        });
                    } else {
                        // No comments, just return posts
                        const finalPosts = posts.map(post => ({
                            id: post.id,
                            userId: post.is_anonymous ? null : post.user_id,
                            username: post.username,
                            content: post.content,
                            files: filesByPost[post.id]?.files || [],
                            fileTypes: filesByPost[post.id]?.fileTypes || [],
                            community: post.community_id ? String(post.community_id) : '',
                            isAnonymous: post.is_anonymous === 1,
                            createdAt: new Date(post.created_at * 1000).toISOString(),
                            likeCount: likeCounts[post.id] || 0,
                            likes: userLikedPosts.has(post.id) && userId ? [userId] : [],
                            comments: [],
                            isSpoiler: post.is_spoiler || false,
                            isNsfw: post.is_nsfw || false,
                            spoilerPreview: post.spoiler_preview || ''
                        }));
                        
                        res.json(finalPosts);
                    }
                });
            });
        });
    });
});

// GET some feed (chronological) posts
app.get('/api/posts/feed/:lastPostId', optionalAuth, (req, res) => {
    const userId = req.userId || null;
    let lastPostId = parseInt(req.params.lastPostId);
    const limit = 50;
    
    // If lastPostId is -1, we want the newest posts
    let query = `
        SELECT p.*, 
               CASE WHEN p.is_anonymous = 0 THEN u.username ELSE NULL END as username,
               u.profile_picture as user_profile_picture,
               usp.show_posts_feed,
               usp.show_posts_profile
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN user_settings_privacy usp ON u.id = usp.user_id
        WHERE p.show_in_feed = 1
    `;
    
    let params = [];
    
    // Apply privacy filters
    if (userId) {
        // User is logged in - apply friend-based filtering
        query += ` AND (
            -- Show posts from users who have show_posts_feed = 1
            (usp.show_posts_feed = 1)
            OR 
            -- For users with show_posts_profile = 1 (friends only), check if they're friends
            (usp.show_posts_profile = 1 AND EXISTS (
                SELECT 1 FROM user_connections uc 
                WHERE ((uc.user_sender_id = p.user_id AND uc.user_reciever_id = ? AND uc.status = 1)
                    OR (uc.user_sender_id = ? AND uc.user_reciever_id = p.user_id AND uc.status = 1))
            ))
            OR
            -- If user has no privacy settings, treat as public (show_posts_feed = 1 by default)
            (usp.user_id IS NULL)
        )`;
        params.push(userId, userId);
    } else {
        // User is not logged in - only show posts from users who have show_posts_feed = 1
        // AND NOT from users with show_posts_profile = 2 (no one)
        query += ` AND (usp.show_posts_feed = 1 OR usp.user_id IS NULL)
                   AND (usp.show_posts_profile != 2 OR usp.user_id IS NULL)`;
    }
    
    // Add ID filtering for pagination
    if (lastPostId !== -1) {
        query += ` AND p.id < ?`;
        params.push(lastPostId);
    }
    
    query += ` ORDER BY p.id DESC LIMIT ?`;
    params.push(limit);
    
    mainDb.all(query, params, (err, posts) => {
        if (err) {
            console.error('Error fetching posts:', err);
            return res.status(500).json({ error: 'Failed to load posts' });
        }
        
        if (posts.length === 0) {
            return res.json({ posts: [], nextPostId: null });
        }
        
        const postIds = posts.map(p => p.id);
        const placeholders = postIds.map(() => '?').join(',');
        const nextPostId = posts[posts.length - 1].id;
        
        // Get files
        mainDb.all(`
            SELECT post_id, file_path, file_type, file_order 
            FROM post_files 
            WHERE post_id IN (${placeholders})
            ORDER BY post_id, file_order
        `, postIds, (err, files) => {
            if (err) {
                console.error('Error fetching files:', err);
                return res.status(500).json({ error: 'Failed to load files' });
            }
            
            const filesByPost = {};
            files.forEach(file => {
                if (!filesByPost[file.post_id]) {
                    filesByPost[file.post_id] = { files: [], fileTypes: [] };
                }
                filesByPost[file.post_id].files.push(file.file_path);
                filesByPost[file.post_id].fileTypes.push(file.file_type);
            });
            
            // Get post likes
            mainDb.all(`
                SELECT post_id, user_id 
                FROM post_likes 
                WHERE post_id IN (${placeholders})
            `, postIds, (err, postLikes) => {
                if (err) {
                    console.error('Error fetching post likes:', err);
                    return res.status(500).json({ error: 'Failed to load likes' });
                }
                
                const likeCounts = {};
                const userLikedPosts = new Set();
                
                postLikes.forEach(like => {
                    likeCounts[like.post_id] = (likeCounts[like.post_id] || 0) + 1;
                    if (userId && like.user_id === userId) {
                        userLikedPosts.add(like.post_id);
                    }
                });
                
                // Get comments
                mainDb.all(`
                    SELECT c.*, u.username 
                    FROM comments c
                    LEFT JOIN users u ON c.user_id = u.id
                    WHERE c.post_id IN (${placeholders})
                    ORDER BY c.created_at ASC
                `, postIds, (err, comments) => {
                    if (err) {
                        console.error('Error fetching comments:', err);
                        return res.status(500).json({ error: 'Failed to load comments' });
                    }
                    
                    const commentsByPost = {};
                    comments.forEach(comment => {
                        if (!commentsByPost[comment.post_id]) {
                            commentsByPost[comment.post_id] = [];
                        }
                        commentsByPost[comment.post_id].push({
                            id: comment.id,
                            userId: comment.user_id,
                            reference: comment.parent_comment_id,
                            username: comment.username,
                            content: comment.content,
                            attachment: comment.attachment_path,
                            attachmentType: comment.attachment_type,
                            createdAt: new Date(comment.created_at * 1000).toISOString(),
                            likes: [],
                            likeCount: 0
                        });
                    });
                    
                    // Get comment likes
                    const commentIds = comments.map(c => c.id);
                    if (commentIds.length > 0) {
                        const commentPlaceholders = commentIds.map(() => '?').join(',');
                        mainDb.all(`
                            SELECT comment_id, user_id
                            FROM comment_likes 
                            WHERE comment_id IN (${commentPlaceholders})
                        `, commentIds, (err, commentLikes) => {
                            const commentLikeCounts = {};
                            const userLikedComments = new Set();
                            
                            commentLikes.forEach(like => {
                                commentLikeCounts[like.comment_id] = (commentLikeCounts[like.comment_id] || 0) + 1;
                                if (userId && like.user_id === userId) {
                                    userLikedComments.add(like.comment_id);
                                }
                            });
                            
                            for (const postId in commentsByPost) {
                                commentsByPost[postId] = commentsByPost[postId].map(comment => ({
                                    ...comment,
                                    likeCount: commentLikeCounts[comment.id] || 0,
                                    likes: userLikedComments.has(comment.id) && userId ? [userId] : []
                                }));
                            }
                            
                            const finalPosts = posts.map(post => ({
                                id: post.id,
                                userId: post.is_anonymous ? null : post.user_id,
                                username: post.username,
                                content: post.content,
                                files: filesByPost[post.id]?.files || [],
                                fileTypes: filesByPost[post.id]?.fileTypes || [],
                                community: post.community_id ? String(post.community_id) : '',
                                isAnonymous: post.is_anonymous === 1,
                                createdAt: new Date(post.created_at * 1000).toISOString(),
                                likeCount: likeCounts[post.id] || 0,
                                likes: userLikedPosts.has(post.id) && userId ? [userId] : [],
                                comments: commentsByPost[post.id] || [],
                                isSpoiler: post.is_spoiler || false,
                                isNsfw: post.is_nsfw || false,
                                spoilerPreview: post.spoiler_preview || ''
                            }));
                            
                            res.json({ posts: finalPosts, nextPostId: posts.length === limit ? nextPostId : null });
                        });
                    } else {
                        const finalPosts = posts.map(post => ({
                            id: post.id,
                            userId: post.is_anonymous ? null : post.user_id,
                            username: post.username,
                            content: post.content,
                            files: filesByPost[post.id]?.files || [],
                            fileTypes: filesByPost[post.id]?.fileTypes || [],
                            community: post.community_id ? String(post.community_id) : '',
                            isAnonymous: post.is_anonymous === 1,
                            createdAt: new Date(post.created_at * 1000).toISOString(),
                            likeCount: likeCounts[post.id] || 0,
                            likes: userLikedPosts.has(post.id) && userId ? [userId] : [],
                            comments: [],
                            isSpoiler: post.is_spoiler || false,
                            isNsfw: post.is_nsfw || false,
                            spoilerPreview: post.spoiler_preview || ''
                        }));
                        
                        res.json({ posts: finalPosts, nextPostId: posts.length === limit ? nextPostId : null });
                    }
                });
            });
        });
    });
});


app.post('/api/posts', authenticate, upload.array('files', 10), async (req, res) => {
    try {
        const userId = req.userId;
        const isAnonymous = req.body.isAnonymous === 'true';
        const content = req.body.content || '';
        const communityId = req.body.community && req.body.community !== '' ? parseInt(req.body.community) : null;
        
        const files = req.files || [];
        const filePaths = [];
        const fileTypes = [];
        
        // Process files (your existing compression code)
        for (const file of files) {
            const mimeType = file.mimetype.split('/')[0];
            const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const ext = path.extname(file.originalname);
            const filename = unique + ext;
            
            let folder = 'images';
            let finalPath = path.join(__dirname, folder, filename);
            
            if (mimeType === 'image') {
                folder = 'images';
                finalPath = path.join(__dirname, folder, filename);
                await sharp(file.buffer)
                    .resize({ width: 1200, withoutEnlargement: true })
                    .webp({ quality: 80 })
                    .toFile(finalPath);
                fileTypes.push('image');
            }
            else if (mimeType === 'video') {
                folder = 'videos';
                const tempPath = path.join(__dirname, folder, 'temp_' + filename);
                finalPath = path.join(__dirname, folder, filename.replace(ext, '.mp4'));
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
                            fs.unlinkSync(tempPath);
                            resolve();
                        })
                        .on('error', (err) => reject(err))
                        .save(finalPath);
                });
                fileTypes.push('video');
            }
            else if (mimeType === 'audio') {
                folder = 'audios';
                const tempPath = path.join(__dirname, folder, 'temp_' + filename);
                finalPath = path.join(__dirname, folder, filename.replace(ext, '.mp3'));
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
                            fs.unlinkSync(tempPath);
                            resolve();
                        })
                        .on('error', (err) => reject(err))
                        .save(finalPath);
                });
                fileTypes.push('audio');
            }
            
            filePaths.push('/' + folder + '/' + path.basename(finalPath));
        }
        
        const postId = Date.now();
        const createdAt = Math.floor(Date.now() / 1000);
        
        // Insert post
        mainDb.run(`
            INSERT INTO posts (id, user_id, community_id, content, is_anonymous, created_at, searchable, show_in_feed)
            VALUES (?, ?, ?, ?, ?, ?, 1, 1)
        `, [postId, isAnonymous ? null : userId, communityId, content, isAnonymous ? 1 : 0, createdAt], function(err) {
            if (err) {
                console.error('Error creating post:', err);
                return res.status(500).json({ success: false, error: 'Failed to create post' });
            }
            
            // Insert files
            if (filePaths.length > 0) {
                const fileStmt = mainDb.prepare(`
                    INSERT INTO post_files (post_id, file_path, file_type, file_order)
                    VALUES (?, ?, ?, ?)
                `);
                for (let i = 0; i < filePaths.length; i++) {
                    fileStmt.run([postId, filePaths[i], fileTypes[i], i]);
                }
                fileStmt.finalize();
            }
            console.log("- - new Post ! - - ")
            res.json({
                success: true,
                post: {
                    id: postId,
                    userId: isAnonymous ? null : userId,
                    content: content,
                    files: filePaths,
                    fileTypes: fileTypes,
                    community: communityId ? String(communityId) : '',
                    isAnonymous: isAnonymous,
                    createdAt: new Date(createdAt * 1000).toISOString(),
                    likes: [],
                    likeCount: 0,
                    comments: []
                }
		
            });
        });
        
    } catch (error) {
        console.error('Post creation error:', error);
        res.status(500).json({ success: false, error: 'Failed to create post' });
    }
});


app.post('/api/posts/:id/comments', authenticate, upload.single('attachment'), async (req, res) => {
    try {
        const postId = parseInt(req.params.id);
        const content = req.body.content;
        const refId = req.body.refId;
        const userId = req.userId;
        
        if (!content) {
            return res.status(400).json({ error: 'Content required' });
        }
        
        // Get user for username
        mainDb.get(`SELECT username FROM users WHERE id = ?`, [userId], (err, user) => {
            if (err || !user) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            // Handle attachment
            let attachmentPath = null;
            let attachmentType = null;
            
            const processComment = (attachmentPath, attachmentType) => {
                const commentId = Date.now() + Math.random();
                const createdAt = Math.floor(Date.now() / 1000);
                
                mainDb.run(`
                    INSERT INTO comments (id, post_id, user_id, parent_comment_id, content, attachment_path, attachment_type, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [commentId, postId, userId, refId, content, attachmentPath, attachmentType, createdAt], function(err) {
                    if (err) {
                        console.error('Comment insert error:', err);
                        return res.status(500).json({ error: 'Failed to add comment' });
                    }
                    
                    res.json({
                        success: true,
                        comment: {
                            id: commentId,
                            userId: userId,
                            username: user.username,
                            content: content,
                            reference: refId,
                            attachment: attachmentPath,
                            attachmentType: attachmentType,
                            createdAt: new Date(createdAt * 1000).toISOString(),
                            likes: [],
                            likeCount: 0
                        }
                    });
			if (!refId) { // Only if it's a top-level comment, not a reply
    //createNotification(post.user_id, 'comment_on_post', commentId);
} else {
    // Get parent comment's user_id
    mainDb.get(`SELECT user_id FROM comments WHERE id = ?`, [refId], (err, parentComment) => {
        if (!err && parentComment && parentComment.user_id !== userId) {
            //createNotification(parentComment.user_id, 'reply_to_comment', commentId);
        }
    });
}
                });
            };
            
            // Process attachment if exists (your existing compression code)
            if (req.file) {
                const fileType = req.file.mimetype.split('/')[0];
                const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const ext = path.extname(req.file.originalname);
                const filename = unique + ext;
                
                let folder = 'images';
                let finalPath = path.join(__dirname, folder, filename);
                
                if (fileType === 'image') {
                    finalPath = path.join(__dirname, 'images', filename);
                    sharp(req.file.buffer)
                        .resize({ width: 600, withoutEnlargement: true })
                        .webp({ quality: 70 })
                        .toFile(finalPath)
                        .then(() => {
                            processComment('/images/' + filename, 'image');
                        })
                        .catch(err => {
                            console.error('Image processing error:', err);
                            processComment(null, null);
                        });
                } else if (fileType === 'video') {
                    const tempPath = path.join(__dirname, 'videos', 'temp_' + filename);
                    finalPath = path.join(__dirname, 'videos', filename);
                    fs.writeFileSync(tempPath, req.file.buffer);
                    
                    const ffmpeg = require('fluent-ffmpeg');
                    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
                    ffmpeg.setFfmpegPath(ffmpegPath);
                    
                    ffmpeg(tempPath)
                        .videoCodec('libx264')
                        .audioCodec('aac')
                        .size('?x240')
                        .outputOptions(['-crf 51', '-preset ultrafast', '-b:v 64k', '-maxrate 128k', '-bufsize 128k', '-movflags +faststart'])
                        .on('end', () => {
                            fs.unlinkSync(tempPath);
                            processComment('/videos/' + filename, 'video');
                        })
                        .on('error', (err) => {
                            console.error('FFmpeg error:', err);
                            fs.unlinkSync(tempPath);
                            processComment(null, null);
                        })
                        .save(finalPath);
                } else if (fileType === 'audio') {
                    const tempPath = path.join(__dirname, 'audios', 'temp_' + filename);
                    finalPath = path.join(__dirname, 'audios', filename.replace(ext, '.mp3'));
                    fs.writeFileSync(tempPath, req.file.buffer);
                    
                    const ffmpeg = require('fluent-ffmpeg');
                    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
                    ffmpeg.setFfmpegPath(ffmpegPath);
                    
                    ffmpeg(tempPath)
                        .audioCodec('libmp3lame')
                        .audioBitrate('96k')
                        .audioChannels(1)
                        .outputOptions(['-q:a 9'])
                        .on('end', () => {
                            fs.unlinkSync(tempPath);
                            processComment('/audios/' + filename.replace(ext, '.mp3'), 'audio');
                        })
                        .on('error', (err) => {
                            console.error('FFmpeg error:', err);
                            fs.unlinkSync(tempPath);
                            processComment(null, null);
                        })
                        .save(finalPath);
                } else {
                    processComment(null, null);
                }
            } else {
                processComment(null, null);
            }
        });
        
    } catch (error) {
        console.error('Comment error:', error);
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

app.post('/api/posts/:id/like', authenticate, (req, res) => {
    const postId = parseInt(req.params.id);
    const userId = req.userId;
    
    // Check if already liked
    mainDb.get(`SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?`, [postId, userId], (err, existing) => {
        if (err) {
            console.error('Like check error:', err);
            return res.status(500).json({ error: 'Failed to process like' });
        }
        
        if (existing) {
            // Unlike
            mainDb.run(`DELETE FROM post_likes WHERE post_id = ? AND user_id = ?`, [postId, userId], (err) => {
                if (err) {
                    console.error('Unlike error:', err);
                    return res.status(500).json({ error: 'Failed to unlike' });
                }
                
                // Get new count
                mainDb.get(`SELECT COUNT(*) as count FROM post_likes WHERE post_id = ?`, [postId], (err, row) => {
                    res.json({ success: true, liked: false, likeCount: row.count });
                });
            });
        } else {
            // Like
            mainDb.run(`INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)`, [postId, userId], (err) => {
                if (err) {
                    console.error('Like error:', err);
                    return res.status(500).json({ error: 'Failed to like' });
                }
                
                mainDb.get(`SELECT COUNT(*) as count FROM post_likes WHERE post_id = ?`, [postId], (err, row) => {
                    res.json({ success: true, liked: true, likeCount: row.count });
                });
		if (!existing) {
    // Get post owner (if not anonymous and not self-like)
    mainDb.get(`SELECT user_id, is_anonymous FROM posts WHERE id = ?`, [postId], (err, post) => {
        if (!err && post && !post.is_anonymous && post.user_id !== userId) {
            createNotification(post.user_id, 'like_on_post', postId);
        }
    });
}
            });
        }
    });
});

app.post('/api/posts/:postId/comments/:commentId/like', authenticate, (req, res) => {
    const commentId = parseFloat(req.params.commentId);
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
            attachment: comment.attachment_path,
            attachmentType: comment.attachment_type,
            createdAt: new Date(comment.created_at * 1000).toISOString(),
            likes: likes,
            likeCount: comment.like_count || 0,
            reply_count: 0
        });
    });
});

app.put('/api/posts/:id', upload.single('image'), authenticate, async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const userId = req.userId;
    const { content } = req.body;
    
    // First check if post exists and user owns it
    mainDb.get(`
      SELECT id, user_id, is_anonymous 
      FROM posts 
      WHERE id = ?
    `, [postId], async (err, post) => {
      if (err || !post) {
        return res.status(404).json({ error: 'Post not found' });
      }
      
      // Check ownership (can't edit anonymous posts, can't edit others' posts)
      if (post.is_anonymous || post.user_id !== userId) {
        return res.status(403).json({ error: 'Not authorized to edit this post' });
      }
      
      // Update post content
      mainDb.run(`
        UPDATE posts 
        SET content = ? 
        WHERE id = ?
      `, [content || '', postId], async (err) => {
        if (err) {
          console.error('Error updating post content:', err);
          return res.status(500).json({ error: 'Failed to update post' });
        }
        
        // Handle image upload (replacing old one)
        if (req.file) {
          // Get existing files for this post
          mainDb.all(`SELECT file_path FROM post_files WHERE post_id = ?`, [postId], (err, existingFiles) => {
            if (err) {
              console.error('Error fetching existing files:', err);
            }
            
            // Delete old image files from disk
            if (existingFiles) {
              existingFiles.forEach(file => {
                const oldPath = path.join(__dirname, file.file_path);
                try {
                  if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
                } catch (err) {
                  console.log('Old image not found:', oldPath);
                }
              });
            }
            
            // Delete old file records from database
            mainDb.run(`DELETE FROM post_files WHERE post_id = ?`, [postId], (err) => {
              if (err) {
                console.error('Error deleting old file records:', err);
              }
              
              // Save new image
              const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
              const filename = unique + '.webp';
              const imagePath = path.join(__dirname, 'images', filename);
              
              sharp(req.file.buffer)
                .resize({ width: 1200, withoutEnlargement: true })
                .webp({ quality: 80 })
                .toFile(imagePath)
                .then(() => {
                  mainDb.run(`
                    INSERT INTO post_files (post_id, file_path, file_type, file_order)
                    VALUES (?, ?, ?, ?)
                  `, [postId, '/images/' + filename, 'image', 0], (err) => {
                    if (err) {
                      console.error('Error saving new image record:', err);
                    }
                    
                    // Get updated post for response
                    mainDb.get(`SELECT * FROM posts WHERE id = ?`, [postId], (err, updatedPost) => {
                      res.json({
                        success: true,
                        post: {
                          id: updatedPost.id,
                          content: updatedPost.content,
                          imagePath: '/images/' + filename
                        }
                      });
                    });
                  });
                })
                .catch(err => {
                  console.error('Sharp error:', err);
                  res.json({ success: true, post: { id: postId, content: content || '' } });
                });
            });
          });
        } else {
          // No new image, just return success
          res.json({ success: true, post: { id: postId, content: content || '' } });
        }
      });
    });
    
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

app.delete('/api/posts/:id', authenticate, (req, res) => {
    const postId = parseInt(req.params.id);
    const userId = req.userId;
    
    // First check if user owns the post or is admin
    mainDb.get(`SELECT user_id, is_anonymous FROM posts WHERE id = ?`, [postId], (err, post) => {
        if (err || !post) {
            return res.status(404).json({ error: 'Post not found' });
        }
        
        const isOwner = post.user_id === userId && !post.is_anonymous;
        
        if (!isOwner) {
            // Check if admin
            mainDb.get(`SELECT 1 FROM admins WHERE user_id = ?`, [userId], (err, isAdmin) => {
                if (err || !isAdmin) {
                    return res.status(403).json({ error: 'Not authorized' });
                }
                deletePostFiles(postId, () => {
                    deletePostData(postId, res);
                });
            });
        } else {
            deletePostFiles(postId, () => {
                deletePostData(postId, res);
            });
        }
    });
});

function deletePostFiles(postId, callback) {
    // Get all files first to delete from disk
    mainDb.all(`SELECT file_path FROM post_files WHERE post_id = ?`, [postId], (err, files) => {
        if (files) {
            files.forEach(file => {
                const fullPath = path.join(__dirname, file.file_path);
                try {
                    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
                } catch (err) {
                    console.log('File not found:', fullPath);
                }
            });
        }
        callback();
    });
}

function deletePostData(postId, res) {
    // Delete in correct order (foreign keys)
    mainDb.run(`DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE post_id = ?)`, [postId]);
    mainDb.run(`DELETE FROM comments WHERE post_id = ?`, [postId]);
    mainDb.run(`DELETE FROM post_likes WHERE post_id = ?`, [postId]);
    mainDb.run(`DELETE FROM post_files WHERE post_id = ?`, [postId]);
    mainDb.run(`DELETE FROM post_tags WHERE post_id = ?`, [postId]);
    mainDb.run(`DELETE FROM posts WHERE id = ?`, [postId], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to delete post' });
        }
        res.json({ success: true });
    });
}

// Get single post by ID
app.get('/api/posts/:id', optionalAuth, (req, res) => {
    const postId = parseInt(req.params.id);
    const currentUserId = req.userId || null;
    
    mainDb.get(`
        SELECT p.*, 
               CASE WHEN p.is_anonymous = 0 THEN u.username ELSE NULL END as username,
               u.profile_picture as user_profile_picture
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.id = ?
    `, [postId], (err, post) => {
        if (err) {
            console.error('Error fetching post:', err);
            return res.status(500).json({ error: 'Server error' });
        }
        
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }
        
        // Get files
        mainDb.all(`
            SELECT file_path, file_type, file_order 
            FROM post_files 
            WHERE post_id = ?
            ORDER BY file_order
        `, [postId], (err, files) => {
            if (err) {
                console.error('Error fetching files:', err);
                return res.status(500).json({ error: 'Server error' });
            }
            
            const filePaths = files.map(f => f.file_path);
            const fileTypes = files.map(f => f.file_type);
            
            // Get like count and check if user liked
            mainDb.all(`
                SELECT user_id FROM post_likes WHERE post_id = ?
            `, [postId], (err, likes) => {
                if (err) {
                    console.error('Error fetching likes:', err);
                    return res.status(500).json({ error: 'Server error' });
                }
                
                const likeCount = likes.length;
                const userLiked = currentUserId ? likes.some(like => like.user_id === currentUserId) : false;
                const likeUserIds = likes.map(like => like.user_id);
                
                // Get comments
                mainDb.all(`
                    SELECT c.*, u.username 
                    FROM comments c
                    LEFT JOIN users u ON c.user_id = u.id
                    WHERE c.post_id = ?
                    ORDER BY c.created_at ASC
                `, [postId], (err, comments) => {
                    if (err) {
                        console.error('Error fetching comments:', err);
                        return res.status(500).json({ error: 'Server error' });
                    }
                    
                    // Get comment likes
                    const commentIds = comments.map(c => c.id);
                    if (commentIds.length > 0) {
                        const placeholders = commentIds.map(() => '?').join(',');
                        mainDb.all(`
                            SELECT comment_id, user_id
                            FROM comment_likes 
                            WHERE comment_id IN (${placeholders})
                        `, commentIds, (err, commentLikes) => {
                            const commentLikeCounts = {};
                            const userLikedComments = {};
                            
                            commentLikes.forEach(like => {
                                commentLikeCounts[like.comment_id] = (commentLikeCounts[like.comment_id] || 0) + 1;
                                if (currentUserId && like.user_id === currentUserId) {
                                    userLikedComments[like.comment_id] = true;
                                }
                            });
                            
                            const formattedComments = comments.map(comment => ({
                                id: comment.id,
                                userId: comment.user_id,
                                username: comment.username,
                                content: comment.content,
                                reference: comment.parent_comment_id,
                                attachment: comment.attachment_path,
                                attachmentType: comment.attachment_type,
                                createdAt: new Date(comment.created_at * 1000).toISOString(),
                                likeCount: commentLikeCounts[comment.id] || 0,
                                likes: userLikedComments[comment.id] ? [currentUserId] : []
                            }));
                            
                            const result = {
                                id: post.id,
                                userId: post.is_anonymous ? null : post.user_id,
                                username: post.username,
                                content: post.content,
                                files: filePaths,
                                fileTypes: fileTypes,
                                community: post.community_id ? String(post.community_id) : '',
                                isAnonymous: post.is_anonymous === 1,
                                createdAt: new Date(post.created_at * 1000).toISOString(),
                                likeCount: likeCount,
                                likes: userLiked ? [currentUserId] : [],
                                comments: formattedComments
                            };
                            
                            res.json(result);
                        });
                    } else {
                        const result = {
                            id: post.id,
                            userId: post.is_anonymous ? null : post.user_id,
                            username: post.username,
                            content: post.content,
                            files: filePaths,
                            fileTypes: fileTypes,
                            community: post.community_id ? String(post.community_id) : '',
                            isAnonymous: post.is_anonymous === 1,
                            createdAt: new Date(post.created_at * 1000).toISOString(),
                            likeCount: likeCount,
                            likes: userLiked ? [currentUserId] : [],
                            comments: []
                        };
                        
                        res.json(result);
                    }
                });
            });
        });
    });
});

// ============ PROFILE ROUTES ============
app.get('/api/users', (req, res) => {
  try {
    mainDb.all(`
      SELECT id, username, profile_picture, status 
      FROM users 
      WHERE searchable = 1
      ORDER BY username ASC
    `, (err, users) => {
      if (err) {
        console.error('Error fetching users:', err);
        return res.status(500).json({ error: 'Failed to load users' });
      }
      
      const safeUsers = users.map(user => ({
        id: user.id,
        username: user.username,
        profilePicture: user.profile_picture || null,
        status: user.status || ''
      }));
      
      res.json(safeUsers);
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// Get user by ID with postCount
app.get('/api/users/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    
    mainDb.get(`
        SELECT id, username, profile_picture, status, description, created_at, searchable
        FROM users WHERE id = ?
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
                        `, [userId], (err, outgoing) => {
                            
                            res.json({
                                id: user.id,
                                username: user.username,
                                profilePicture: user.profile_picture,
                                status: user.status || '',
                                description: user.description || '',
                                communities: communities.map(c => c.id),
                                friends: friends.map(f => f.id),
                                pending: pending.map(p => p.id),      // People who requested ME
                                outgoing: outgoing.map(o => o.id),    // People I requested
                                postCount: postCount.count,
                                createdAt: new Date(user.created_at * 1000).toISOString()
                            });
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
    const userId = parseInt(req.params.userId);
    const currentUserId = req.userId || null;
    
    // Check if user exists
    mainDb.get(`SELECT id, username FROM users WHERE id = ?`, [userId], async (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Check privacy
        const canView = await canViewUserPosts(userId, currentUserId);
        
        if (!canView) {
            // Return empty posts array if not authorized
            return res.json([]);
        }
        
        // Get posts with privacy filter
        mainDb.all(`
            SELECT p.*, 
                   CASE WHEN p.is_anonymous = 0 THEN u.username ELSE NULL END as username,
                   u.profile_picture as user_profile_picture
            FROM posts p
            LEFT JOIN users u ON p.user_id = u.id
            WHERE p.user_id = ? AND p.is_anonymous = 0
            ORDER BY p.created_at DESC
        `, [userId], (err, posts) => {
            if (err) {
                console.error('Error fetching user posts:', err);
                return res.status(500).json({ error: 'Failed to load posts' });
            }
            
            if (posts.length === 0) {
                return res.json([]);
            }
            
            const postIds = posts.map(p => p.id);
            const placeholders = postIds.map(() => '?').join(',');
            
            // Get files
            mainDb.all(`
                SELECT post_id, file_path, file_type, file_order 
                FROM post_files 
                WHERE post_id IN (${placeholders})
                ORDER BY post_id, file_order
            `, postIds, (err, files) => {
                if (err) {
                    console.error('Error fetching files:', err);
                    return res.status(500).json({ error: 'Failed to load files' });
                }
                
                const filesByPost = {};
                files.forEach(file => {
                    if (!filesByPost[file.post_id]) {
                        filesByPost[file.post_id] = { files: [], fileTypes: [] };
                    }
                    filesByPost[file.post_id].files.push(file.file_path);
                    filesByPost[file.post_id].fileTypes.push(file.file_type);
                });
                
                // Get post likes
                mainDb.all(`
                    SELECT post_id, user_id 
                    FROM post_likes 
                    WHERE post_id IN (${placeholders})
                `, postIds, (err, postLikes) => {
                    if (err) {
                        console.error('Error fetching post likes:', err);
                        return res.status(500).json({ error: 'Failed to load likes' });
                    }
                    
                    const likeCounts = {};
                    const userLikedPosts = {};
                    
                    postLikes.forEach(like => {
                        likeCounts[like.post_id] = (likeCounts[like.post_id] || 0) + 1;
                        if (currentUserId && like.user_id === currentUserId) {
                            userLikedPosts[like.post_id] = true;
                        }
                    });
                    
                    // Get comments with reference field
                    mainDb.all(`
                        SELECT c.*, u.username 
                        FROM comments c
                        LEFT JOIN users u ON c.user_id = u.id
                        WHERE c.post_id IN (${placeholders})
                        ORDER BY c.created_at ASC
                    `, postIds, (err, comments) => {
                        if (err) {
                            console.error('Error fetching comments:', err);
                            return res.status(500).json({ error: 'Failed to load comments' });
                        }
                        
                        const commentsByPost = {};
                        comments.forEach(comment => {
                            if (!commentsByPost[comment.post_id]) {
                                commentsByPost[comment.post_id] = [];
                            }
                            commentsByPost[comment.post_id].push({
                                id: comment.id,
                                userId: comment.user_id,
                                reference: comment.parent_comment_id,  // IMPORTANT: Add this!
                                username: comment.username,
                                content: comment.content,
                                attachment: comment.attachment_path,
                                attachmentType: comment.attachment_type,
                                createdAt: new Date(comment.created_at * 1000).toISOString(),
                                likes: [],
                                likeCount: 0
                            });
                        });
                        
                        // Get comment likes
                        const commentIds = comments.map(c => c.id);
                        if (commentIds.length > 0) {
                            const commentPlaceholders = commentIds.map(() => '?').join(',');
                            mainDb.all(`
                                SELECT comment_id, user_id
                                FROM comment_likes 
                                WHERE comment_id IN (${commentPlaceholders})
                            `, commentIds, (err, commentLikes) => {
                                const commentLikeCounts = {};
                                const userLikedComments = {};
                                
                                commentLikes.forEach(like => {
                                    commentLikeCounts[like.comment_id] = (commentLikeCounts[like.comment_id] || 0) + 1;
                                    if (currentUserId && like.user_id === currentUserId) {
                                        userLikedComments[like.comment_id] = true;
                                    }
                                });
                                
                                for (const postId in commentsByPost) {
                                    commentsByPost[postId] = commentsByPost[postId].map(comment => ({
                                        ...comment,
                                        likeCount: commentLikeCounts[comment.id] || 0,
                                        likes: userLikedComments[comment.id] ? [currentUserId] : []
                                    }));
                                }
                                
                                const finalPosts = posts.map(post => ({
                                    id: post.id,
                                    userId: post.user_id,
                                    username: post.username,
                                    content: post.content,
                                    files: filesByPost[post.id]?.files || [],
                                    fileTypes: filesByPost[post.id]?.fileTypes || [],
                                    community: post.community_id ? String(post.community_id) : '',
                                    isAnonymous: post.is_anonymous === 1,
                                    createdAt: new Date(post.created_at * 1000).toISOString(),
                                    likeCount: likeCounts[post.id] || 0,
                                    likes: userLikedPosts[post.id] ? [currentUserId] : [],
                                    comments: commentsByPost[post.id] || [],
                            	    isSpoiler: post.is_spoiler || false,
                            	    isNsfw: post.is_nsfw || false,
                            	    spoilerPreview: post.spoiler_preview || ''
                                }));
                                
                                res.json(finalPosts);
                            });
                        } else {
                            const finalPosts = posts.map(post => ({
                                id: post.id,
                                userId: post.user_id,
                                username: post.username,
                                content: post.content,
                                files: filesByPost[post.id]?.files || [],
                                fileTypes: filesByPost[post.id]?.fileTypes || [],
                                community: post.community_id ? String(post.community_id) : '',
                                isAnonymous: post.is_anonymous === 1,
                                createdAt: new Date(post.created_at * 1000).toISOString(),
                                likeCount: likeCounts[post.id] || 0,
                                likes: userLikedPosts[post.id] ? [currentUserId] : [],
                                comments: [],
                            	isSpoiler: post.is_spoiler || false,
                            	isNsfw: post.is_nsfw || false,
                            	spoilerPreview: post.spoiler_preview || ''
                            }));
                            
                            res.json(finalPosts);
                        }
                    });
                });
            });
        });
    });
});

// Update user status
app.post('/api/users/update-status', authenticate, upload.none(), async (req, res) => {
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

app.post('/api/users/update', authenticate, upload.single('profilePicture'), async (req, res) => {
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
            const oldPath = path.join(__dirname, 'images', path.basename(user.profile_picture));
            try {
              if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            } catch (err) {
              console.log('Old profile picture not found:', oldPath);
            }
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

app.post('/api/users/update/bio', authenticate, upload.fields([
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
          const oldPath = path.join(__dirname, oldUser.profile_picture);
          try {
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
          } catch (err) {
            console.log('Old profile picture not found:', oldPath);
          }
        }
        
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
          const oldPath = path.join(__dirname, oldUser.profile_background);
          try {
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
          } catch (err) {
            console.log('Old background not found:', oldPath);
          }
        }
        
        const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.webp';
        const imagePath = path.join(__dirname, 'images', filename);
        
        await sharp(file.buffer)
          .resize({ width: 1920, withoutEnlargement: true })  // Full HD width max
          .webp({ quality: 80 })
          .toFile(imagePath);
        
        profileBackground = '/images/' + filename;
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

app.post('/api/users/update/cust', authenticate, upload.single('custom_background'), async (req, res) => {
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
                        const fullPath = path.join(__dirname, comment.attachment_path);
                        try {
                            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
                        } catch (err) {
                            console.log('File not found:', fullPath);
                        }
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
                    const fullPath = path.join(__dirname, comment.attachment_path);
                    try {
                        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
                    } catch (err) {
                        console.log('File not found:', fullPath);
                    }
                }
                
                res.json({ success: true });
            });
        }
    });
});

// ============ FRIENDS ROUTES ============

// Отправить заявку в друзья (using userIds)
app.post('/api/friends/request', async (req, res) => {
    console.log(req.body);
    try {
        const { fromUserId, toUserId } = req.body;
        
        // Check if users exist
        mainDb.get(`SELECT id FROM users WHERE id = ?`, [fromUserId], (err, fromUser) => {
            if (err || !fromUser) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            mainDb.get(`SELECT id FROM users WHERE id = ?`, [toUserId], (err, toUser) => {
                if (err || !toUser) {
                    return res.status(404).json({ error: 'User not found' });
                }
                
                // Check if already friends (status = 1)
                mainDb.get(`
                    SELECT status FROM user_connections 
                    WHERE (user_sender_id = ? AND user_reciever_id = ?)
                       OR (user_sender_id = ? AND user_reciever_id = ?)
                `, [fromUserId, toUserId, toUserId, fromUserId], (err, existing) => {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).json({ error: 'Server error' });
                    }
                    
                    if (existing) {
                        if (existing.status === 1) {
                            return res.status(400).json({ error: 'Already friends' });
                        }
                        if (existing.status === 0) {
                            return res.status(400).json({ error: 'Request already sent' });
                        }
                    }
                    
                    // Insert friend request (status = 0 means pending)
                    mainDb.run(`
                        INSERT INTO user_connections (user_reciever_id, user_sender_id, status)
                        VALUES (?, ?, 0)
                    `, [toUserId, fromUserId], (err) => {
                        if (err) {
                            console.error('Insert error:', err);
                            return res.status(500).json({ error: 'Server error' });
                        }
                        
                        res.json({ success: true });
			createNotification(toUserId, 'friend_request', fromUserId);
                    });
                });
            });
        });
    } catch (error) {
        console.error('Friend request error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Принять заявку в друзья (using userIds)
app.post('/api/friends/accept', async (req, res) => {
    try {
        const { currentUserId, requesterUserId } = req.body;
        
        // Update the connection status to accepted (1)
        mainDb.run(`
            UPDATE user_connections 
            SET status = 1 
            WHERE user_reciever_id = ? AND user_sender_id = ? AND status = 0
        `, [currentUserId, requesterUserId], function(err) {
            if (err) {
                console.error('Accept error:', err);
                return res.status(500).json({ error: 'Server error' });
            }
            
            if (this.changes === 0) {
                return res.status(400).json({ error: 'No pending request found' });
            }
            
            res.json({ success: true });
		createNotification(requesterUserId, 'friend_request_accepted', currentUserId);
        });
    } catch (error) {
        console.error('Accept friend error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


// Отклонить заявку (using userIds)
app.post('/api/friends/reject', async (req, res) => {
    try {
        const { currentUserId, requesterUserId } = req.body;
        
        // Delete the pending request
        mainDb.run(`
            DELETE FROM user_connections 
            WHERE user_reciever_id = ? AND user_sender_id = ? AND status = 0
        `, [currentUserId, requesterUserId], function(err) {
            if (err) {
                console.error('Reject error:', err);
                return res.status(500).json({ error: 'Server error' });
            }
            
            if (this.changes === 0) {
                return res.status(400).json({ error: 'No pending request found' });
            }
            
            res.json({ success: true });
        });
    } catch (error) {
        console.error('Reject friend error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Получить список друзей и заявок
// Get friends list by user ID
app.get('/api/friends/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        
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
            `, [userId, userId], (err, friends) => {
                if (err) {
                    console.error('Get friends error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }
                
                // Format friends with camelCase field names
                const formattedFriends = friends.map(friend => ({
                    id: friend.id,
                    username: friend.username,
                    profilePicture: friend.profile_picture,
                    status: friend.status || ''
                }));
                
                // Get pending requests (status = 0) - where current user is receiver
                mainDb.all(`
                    SELECT u.id, u.username, u.profile_picture
                    FROM user_connections uc
                    JOIN users u ON uc.user_sender_id = u.id
                    WHERE uc.user_reciever_id = ? AND uc.status = 0
                `, [userId], (err, pending) => {
                    if (err) {
                        console.error('Get pending error:', err);
                        return res.status(500).json({ error: 'Server error' });
                    }
                    
                    // Format pending with camelCase field names
                    const formattedPending = pending.map(req => ({
                        id: req.id,
                        username: req.username,
                        profilePicture: req.profile_picture
                    }));
                    
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
app.post('/api/friends/remove', async (req, res) => {
    try {
        const { currentUserId, friendId } = req.body;
        
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
app.post('/api/friends/cancel', async (req, res) => {
    try {
        const { fromUserId, toUserId } = req.body;
        
        // Delete the pending request where fromUserId is sender and toUserId is receiver
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

app.post('/communities/new', upload.single('profilePicture'), async (req, res) => {
  try {
    const { username, createdBy, type, rules, description } = req.body;
    console.log(req.body);
    
    if (!username || !createdBy) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }
    
    // Get user ID from username
    mainDb.get(`SELECT id FROM users WHERE username = ?`, [createdBy], async (err, user) => {
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
          const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
          const ext = path.extname(req.file.originalname);
          const filename = unique + ext;
          const imagePath = path.join(__dirname, 'images', filename);
          
          if (req.file.mimetype.startsWith('image/')) {
            await sharp(req.file.buffer)
              .resize({ width: 300, height: 300, fit: 'cover' })
              .webp({ quality: 80 })
              .toFile(imagePath.replace(ext, '.webp'));
            profilePicturePath = '/images/' + filename.replace(ext, '.webp');
          } else {
            fs.writeFileSync(imagePath, req.file.buffer);
            profilePicturePath = '/images/' + filename;
          }
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
          `, [communityId, user.id]);
          
          // Add owner as subscriber
          mainDb.run(`
            INSERT INTO community_subscribers (community_id, user_id)
            VALUES (?, ?)
          `, [communityId, user.id]);
          
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

// Modify community (update name, status, description, rules, profile picture)
app.post('/api/communities/:id/modify', authenticate, upload.single('profilePicture'), async (req, res) => {
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
          const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
          const ext = path.extname(req.file.originalname);
          const filename = unique + ext;
          const imagePath = path.join(__dirname, 'images', filename);
          
          if (req.file.mimetype.startsWith('image/')) {
            sharp(req.file.buffer)
              .resize({ width: 300, height: 300, fit: 'cover' })
              .webp({ quality: 80 })
              .toFile(imagePath.replace(ext, '.webp'))
              .then(() => {
                handleProfilePicture('/images/' + filename.replace(ext, '.webp'));
              })
              .catch(err => {
                console.error('Image processing error:', err);
                handleProfilePicture(null);
              });
          } else {
            fs.writeFileSync(imagePath, req.file.buffer);
            handleProfilePicture('/images/' + filename);
          }
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
app.get('/api/communities/:id/posts', optionalAuth, (req, res) => {
    const commId = parseInt(req.params.id);
    const currentUserId = req.userId || null;
    
    mainDb.all(`
        SELECT p.*, 
               CASE WHEN p.is_anonymous = 0 THEN u.username ELSE NULL END as username,
               u.profile_picture as user_profile_picture
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.community_id = ? 
        ORDER BY p.created_at DESC
    `, [commId], (err, posts) => {
        if (err) {
            console.error('Error fetching community posts:', err);
            return res.status(500).json({ error: 'Failed to load posts' });
        }
        
        if (posts.length === 0) {
            return res.json([]);
        }
        
        const postIds = posts.map(p => p.id);
        const placeholders = postIds.map(() => '?').join(',');
        
        // Get files
        mainDb.all(`
            SELECT post_id, file_path, file_type, file_order 
            FROM post_files 
            WHERE post_id IN (${placeholders})
            ORDER BY post_id, file_order
        `, postIds, (err, files) => {
            if (err) {
                console.error('Error fetching files:', err);
                return res.status(500).json({ error: 'Failed to load files' });
            }
            
            const filesByPost = {};
            files.forEach(file => {
                if (!filesByPost[file.post_id]) {
                    filesByPost[file.post_id] = { files: [], fileTypes: [] };
                }
                filesByPost[file.post_id].files.push(file.file_path);
                filesByPost[file.post_id].fileTypes.push(file.file_type);
            });
            
            // Get post likes
            mainDb.all(`
                SELECT post_id, user_id 
                FROM post_likes 
                WHERE post_id IN (${placeholders})
            `, postIds, (err, postLikes) => {
                if (err) {
                    console.error('Error fetching post likes:', err);
                    return res.status(500).json({ error: 'Failed to load likes' });
                }
                
                const likeCounts = {};
                const userLikedPosts = {};
                
                postLikes.forEach(like => {
                    likeCounts[like.post_id] = (likeCounts[like.post_id] || 0) + 1;
                    if (currentUserId && like.user_id === currentUserId) {
                        userLikedPosts[like.post_id] = true;
                    }
                });
                
                // Get comments
                mainDb.all(`
                    SELECT c.*, u.username 
                    FROM comments c
                    LEFT JOIN users u ON c.user_id = u.id
                    WHERE c.post_id IN (${placeholders})
                    ORDER BY c.created_at ASC
                `, postIds, (err, comments) => {
                    if (err) {
                        console.error('Error fetching comments:', err);
                        return res.status(500).json({ error: 'Failed to load comments' });
                    }
                    
                    const commentsByPost = {};
                    comments.forEach(comment => {
                        if (!commentsByPost[comment.post_id]) {
                            commentsByPost[comment.post_id] = [];
                        }
                        commentsByPost[comment.post_id].push({
    				id: comment.id,
    				userId: comment.user_id,
    				reference: comment.parent_comment_id,
    				username: comment.username,
    				content: comment.content,
    				attachment: comment.attachment_path,
    				attachmentType: comment.attachment_type,
    				createdAt: new Date(comment.created_at * 1000).toISOString(),
   				likes: [],
    				likeCount: 0
				});
                    });
                    
                    // Get comment likes
                    const commentIds = comments.map(c => c.id);
                    if (commentIds.length > 0) {
                        const commentPlaceholders = commentIds.map(() => '?').join(',');
                        mainDb.all(`
                            SELECT comment_id, user_id
                            FROM comment_likes 
                            WHERE comment_id IN (${commentPlaceholders})
                        `, commentIds, (err, commentLikes) => {
                            const commentLikeCounts = {};
                            const userLikedComments = {};
                            
                            commentLikes.forEach(like => {
                                commentLikeCounts[like.comment_id] = (commentLikeCounts[like.comment_id] || 0) + 1;
                                if (currentUserId && like.user_id === currentUserId) {
                                    userLikedComments[like.comment_id] = true;
                                }
                            });
                            
                            for (const postId in commentsByPost) {
                                commentsByPost[postId] = commentsByPost[postId].map(comment => ({
                                    ...comment,
                                    likeCount: commentLikeCounts[comment.id] || 0,
                                    likes: userLikedComments[comment.id] ? [currentUserId] : []
                                }));
                            }
                            
                            const finalPosts = posts.map(post => ({
                                id: post.id,
                                userId: post.is_anonymous ? null : post.user_id,
                                username: post.username,
                                content: post.content,
                                files: filesByPost[post.id]?.files || [],
                                fileTypes: filesByPost[post.id]?.fileTypes || [],
                                community: String(commId),
                                isAnonymous: post.is_anonymous === 1,
                                createdAt: new Date(post.created_at * 1000).toISOString(),
                                likeCount: likeCounts[post.id] || 0,
                                likes: userLikedPosts[post.id] ? [currentUserId] : [],
                                comments: commentsByPost[post.id] || []
                            }));
                            
                            res.json(finalPosts);
                        });
                    } else {
                        const finalPosts = posts.map(post => ({
                            id: post.id,
                            userId: post.is_anonymous ? null : post.user_id,
                            username: post.username,
                            content: post.content,
                            files: filesByPost[post.id]?.files || [],
                            fileTypes: filesByPost[post.id]?.fileTypes || [],
                            community: String(commId),
                            isAnonymous: post.is_anonymous === 1,
                            createdAt: new Date(post.created_at * 1000).toISOString(),
                            likeCount: likeCounts[post.id] || 0,
                            likes: userLikedPosts[post.id] ? [currentUserId] : [],
                            comments: []
                        }));
                        
                        res.json(finalPosts);
                    }
                });
            });
        });
    });
});

// JOIN DA COMMINTIE (fixed version)
app.post('/api/communities/:id/join', async (req, res) => {
    const communityId = parseInt(req.params.id);
    const { username } = req.body;
    
    if (!username) {
        return res.status(400).json({ error: 'Username required' });
    }
    
    // Get user ID
    mainDb.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        mainDb.run(`
            INSERT OR IGNORE INTO community_subscribers (community_id, user_id)
            VALUES (?, ?)
        `, [communityId, user.id], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to join' });
            }
            res.json({ success: true });
        });
    });
});

// Leaf DA COMMINTIE (actually fixed with numbers)
app.post('/api/communities/:id/leave', async (req, res) => {
    const communityId = parseInt(req.params.id);
    const { username } = req.body;
    
    if (!username) {
        return res.status(400).json({ error: 'Username required' });
    }
    
    mainDb.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        mainDb.run(`
            DELETE FROM community_subscribers WHERE community_id = ? AND user_id = ?
        `, [communityId, user.id], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to leave' });
            }
            res.json({ success: true });
        });
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

// ============ CHAT ROUTES ============

// Get all chats for a user with unread count
app.get('/api/user_chats/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    
    db.all(`
        SELECT c.chat_id, 
               (SELECT m.message_text FROM messages m 
                WHERE m.chat_id = c.chat_id 
                ORDER BY m.created_at DESC LIMIT 1) as last_message_text,
               (SELECT m.file_paths FROM messages m 
                WHERE m.chat_id = c.chat_id 
                ORDER BY m.created_at DESC LIMIT 1) as last_message_files,
               (SELECT m.created_at FROM messages m 
                WHERE m.chat_id = c.chat_id 
                ORDER BY m.created_at DESC LIMIT 1) as last_message_time,
               (SELECT COUNT(*) FROM messages m 
                WHERE m.chat_id = c.chat_id AND m.sender_id != ? AND m.is_read = 0) as unread_count
        FROM chats c
        WHERE c.chat_id LIKE '%${userId}%'
        ORDER BY last_message_time DESC
    `, [userId], (err, rows) => {
        if (err) {
            console.error('Error loading chats:', err);
            return res.status(500).json({ error: 'Failed to load chats' });
        }
        
        if (!rows || rows.length === 0) {
            return res.json([]);
        }
        
        // Get all unique user IDs from chats to fetch from mainDb
        const userIds = new Set();
        rows.forEach(row => {
            const participants = row.chat_id.split('_').map(Number);
            const otherUserId = participants.find(id => id !== userId);
            if (otherUserId) userIds.add(otherUserId);
        });
        
        if (userIds.size === 0) {
            return res.json([]);
        }
        
        const placeholders = Array.from(userIds).map(() => '?').join(',');
        mainDb.all(`
            SELECT id, username, profile_picture
            FROM users
            WHERE id IN (${placeholders})
        `, Array.from(userIds), (err, users) => {
            if (err) {
                console.error('Error fetching users:', err);
                return res.status(500).json({ error: 'Failed to load user data' });
            }
            
            const userMap = {};
            users.forEach(u => { userMap[u.id] = u; });
            
            const result = rows.map(row => {
                const participants = row.chat_id.split('_').map(Number);
                const otherUserId = participants.find(id => id !== userId);
                const otherUser = userMap[otherUserId];
                
                let preview = 'Нет сообщений';
                if (row.last_message_text) {
                    preview = row.last_message_text;
                } else if (row.last_message_files) {
                    preview = '[Файл]';
                }
                
                return {
                    chatId: row.chat_id,
                    withUser: otherUser ? otherUser.username : 'Unknown',
                    withUserId: otherUserId,
                    lastMessage: preview,
                    lastMessageTime: row.last_message_time || '',
                    unreadCount: row.unread_count || 0
                };
            });
            
            res.json(result);
        });
    });
});

// Get all messages for a chat (returns string format for compatibility)
app.get('/api/chat_messages/:chatId', authenticate, (req, res) => {
    const chatId = req.params.chatId;
    
    db.all(`
        SELECT id, sender_id, message_text, file_paths, file_types, created_at, reference_id
        FROM messages 
        WHERE chat_id = ? 
        ORDER BY created_at ASC
    `, [chatId], (err, rows) => {
        if (err) {
            console.error('Error loading messages:', err);
            return res.status(500).json({ error: 'Failed to load messages' });
        }
        
        const messages = rows.map(row => {
            // Reconstruct the exact same format as before: timestamp_senderId:encryptedMessage|files:...
            let messageStr = `${row.created_at}_${row.sender_id}:${row.message_text || ''}`;
            if (row.file_paths) {
                messageStr += `|files:${row.file_paths}`;
            }
		if (row.reference_id) {
                messageStr += `|ref:${row.reference_id}`;
            }
		messageStr += `|id:${row.id}`;
            return messageStr;
        });
        	
        res.json(messages);
    });
});

// Get all messages for a chat (returns string format for compatibility)
app.get('/api/chat_messages/get/:messageId', authenticate, (req, res) => {
    const messageId = req.params.messageId;
    
    db.get(`
        SELECT id, sender_id, message_text, file_paths, file_types, created_at, reference_id 
        FROM messages 
        WHERE id = ? 
    `, [messageId], (err, row) => {
        if (err) {
            console.error('Error loading messages:', err);
            return res.status(500).json({ error: 'Failed to load messages' });
        }
        
        let messageStr = `${row.created_at}_${row.sender_id}:${row.message_text || ''}`;
        res.send(messageStr);
    });
});

// Mark messages as read in a chat
app.post('/api/chat_messages/:chatId/read', authenticate, (req, res) => {
    const chatId = req.params.chatId;
    const { userId } = req.body;
    
    if (!userId) {
        return res.status(400).json({ error: 'User ID required' });
    }
    
    db.run(`
        UPDATE messages 
        SET is_read = 1 
        WHERE chat_id = ? AND sender_id != ? AND is_read = 0
    `, [chatId, userId], function(err) {
        if (err) {
            console.error('Error marking messages as read:', err);
            return res.status(500).json({ error: 'Failed to mark messages as read' });
        }
        
        res.json({ success: true, updatedCount: this.changes });
    });
});

// Send message
app.post('/api/chat_messages/:chatId', authenticate, upload.array('files', 10), async (req, res) => {
    const chatId = req.params.chatId;
    const { message, fromUserId, toUserId, referenceId } = req.body;
    
	let finalReferenceId = referenceId;
	if (referenceId === -1 || referenceId === '-1') {
	    finalReferenceId = null;
	} else {
	    finalReferenceId = referenceId || null;
	}

    if (!fromUserId || !toUserId) {
        return res.status(400).json({ error: 'Missing user IDs' });
    }
    
    // Ensure chat exists
    db.get('SELECT chat_id FROM chats WHERE chat_id = ?', [chatId], (err, row) => {
        if (!row) {
            const participants = [parseInt(fromUserId), parseInt(toUserId)].sort((a,b) => a-b);
            const newChatId = participants.join('_');
            db.run('INSERT INTO chats (chat_id) VALUES (?)', [newChatId], (err) => {
                if (err) console.error('Error creating chat:', err);
            });
        }
        
        // Process files
        const files = req.files || [];
        const filePaths = [];
        const fileTypes = [];
        
        const processFiles = async () => {
            for (const file of files) {
                const mimeType = file.mimetype.split('/')[0];
                const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const ext = path.extname(file.originalname);
                const filename = unique + ext;
                
                let folder = 'images';
                if (mimeType === 'video') folder = 'videos';
                if (mimeType === 'audio') folder = 'audios';
                
                const finalPath = path.join(__dirname, folder, filename);
                fs.writeFileSync(finalPath, file.buffer);
                
                filePaths.push('/' + folder + '/' + filename);
                fileTypes.push(mimeType);
            }
            
            db.run(`
                INSERT INTO messages (chat_id, sender_id, message_text, file_paths, file_types, created_at, is_read, reference_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                chatId,
                parseInt(fromUserId),
                message || '',
                filePaths.join(','),
                fileTypes.join(','),
                new Date().toISOString(),
                0,
                finalReferenceId
            ], function(err) {
                if (err) {
                    console.error('Error saving message:', err);
                    return res.status(500).json({ error: 'Failed to save message' });
                }
                
                console.log(`💬 Message sent: ${fromUserId} → ${toUserId}`);
                res.json({ 
                    success: true, 
                    messageId: this.lastID,
                    referenceId: referenceId || null
                });
            });
        };
        
        processFiles();
    });
});


//======= NOTIFICATIONs ROUTES =======

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
                                       u.username as commenter_name, 
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
                            formattedNotif.sourceType = 'post';
                        }
                        break;
                        
                    case 'reply_to_comment':
                        // Source is comment ID (the reply)
                        const replyData = await new Promise((resolve, reject) => {
                            mainDb.get(`
                                SELECT c.content as reply_content, c.user_id as replier_id, 
                                       pc.content as parent_content, u.username as replier_name,
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
                            formattedNotif.sourceType = 'post';
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
                        // Source is user ID of requester
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
                            formattedNotif.requesterName = requesterData.username;
                            formattedNotif.requesterPicture = requesterData.profile_picture;
                        }
                        break;
                        
                    case 'friend_request_accepted':
                        // Source is user ID of accepter
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

app.get('/api/verify-session', authenticate, (req, res) => {
    res.json({ 
        authenticated: true, 
        userId: req.userId 
    })
})

//const PORT = 3000;
//const HOST = '::';

// SSL certificate paths
const sslPath = path.join(__dirname, 'ssl');
const options = {
    key: fs.readFileSync(path.join(sslPath, 'certificate.key')),
    cert: fs.readFileSync(path.join(sslPath, 'certificate.crt')),
    ca: fs.readFileSync(path.join(sslPath, 'certificate_ca.crt'))  // CA bundle
};

// HTTPS server
https.createServer(options, app).listen(3000, () => {
    console.log('🔒 DEBUG HTTPS server running on port 3000');
});

// HTTP server (redirects to HTTPS)
http.createServer((req, res) => {
    const host = req.headers.host;
    res.writeHead(301, { Location: `https://${host}${req.url}` });
    res.end();
}).listen(80, () => {
    console.log('↪️ DEBUG HTTP redirect server on port 80');
});

//app.listen(PORT, HOST, () => {
//  console.log(`Server running at http://localhost:${PORT}/`);
//  console.log(`Also accessible on your local network IP`);
//});