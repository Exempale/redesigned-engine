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
    // Allow all file types for comments
    // For posts, we might still want to restrict, but let's handle that in the route
    cb(null, true)
  }
})

const cookieParser = require('cookie-parser')
// Add this after your other middleware
app.use(cookieParser())

async function verifyCommunityAccess(req, res, next) {
    const communityId = parseInt(req.params.id);
    const userId = req.userId;
    
    const commPath = path.join(__dirname, 'api', 'communities.json');
    const comms = JSON.parse(fs.readFileSync(commPath));
    const community = comms.find(c => c.id === communityId);
    
    if (!community) return res.status(404).json({ error: 'Not found' });
    
    const isOwner = community.owner === userId;
    const isModerator = community.moderators?.includes(userId);
    
    if (!isOwner && !isModerator) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    next();
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

app.get('/login', (req, res) => {  // FIXED: Changed from /register to /login
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
    const { username, password } = req.body
    
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Заполните все поля' })
    }
    
    if (password.length < 7) {
      return res.status(400).json({ success: false, error: 'Пароль слишком короткий' })
    }
    
    const usersPath = path.join(__dirname, 'api', 'users.json')
    
    let users = []
    try {
      const usersData = fs.readFileSync(usersPath)
      users = JSON.parse(usersData)
    } catch (err) {
      users = []
    }
    
    const existingUser = users.find(u => u.username === username)
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Имя занято' })
    }
    
    const hashedPassword = await bcrypt.hash(password, saltRounds)
    
    const newUser = {
  id: Date.now(),
  username: username,
  password: hashedPassword,
  createdAt: new Date().toISOString(),
  isAdmin: false,
  profilePicture: null,
  communities: [],
  friends: [],
  pending: [],
  subscribers: [],
  status: '',
}
    
    users.push(newUser)
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
    
    res.json({ 
      success: true, 
      user: { 
        id: newUser.id, 
        username: newUser.username,
        createdAt: newUser.createdAt
      } 
    })
    
  } catch (error) {
    console.error('Registration error:', error)
    res.status(500).json({ success: false, error: 'Server error' })
  }
})

// Login endpoint
app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body
    
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Missing fields' })
    }
    
    const usersPath = path.join(__dirname, 'api', 'users.json')
    const users = JSON.parse(fs.readFileSync(usersPath))
    
    const user = users.find(u => u.username === username)
    if (!user) {
      return res.status(400).json({ success: false, error: 'Неверное имя или пароль' })
    }
    
    const match = await bcrypt.compare(password, user.password)
    if (!match) {
      return res.status(400).json({ success: false, error: 'Неверное имя или пароль' })
    }
    
    // Create session
    const sessionId = await createSession(user.id);
    
    // Set HTTP-only cookie
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
        isAdmin: user.isAdmin || false,
        createdAt: user.createdAt,
        profilePicture: user.profilePicture || null
      }
    })
    
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ success: false, error: 'Server error' })
  }
})

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
    try {
        const query = req.query.q || ''
        const usersPath = path.join(__dirname, 'api', 'users.json')
        const users = JSON.parse(fs.readFileSync(usersPath))
        
        if (query.length < 1) {
            return res.json([])
        }
        
        const searchTerm = query.toLowerCase()
        const results = users
            .filter(user => {
                // Skip users with searchable: false
                if (user.searchable === false) return false
                // Match username
                return user.username.toLowerCase().includes(searchTerm)
            })
            .map(user => ({
                id: user.id,
                username: user.username,
                profilePicture: user.profilePicture || null,
		status: user.status || ''
            }))
            .slice(0, 50) // Limit to 50 results
        
        res.json(results)
    } catch (error) {
        console.error('Search error:', error)
        res.status(500).json({ error: 'Search failed' })
    }
})

// ============ POST ROUTES ============
// GET all posts
app.get('/api/posts', (req, res) => {
  try {
    const postsPath = path.join(__dirname, 'api', 'posts.json')
    const postsData = fs.readFileSync(postsPath, 'utf8')
    const posts = JSON.parse(postsData)
    
    // Transform posts to ensure backward compatibility
    const transformedPosts = posts.map(post => {
      // If it's an old post with imagePath but no files array
      if (post.imagePath && !post.files) {
        return {
          ...post,
          files: [post.imagePath],  // Create files array from imagePath
          fileTypes: ['image']       // Set fileType as image
        }
      }
      
      // Ensure new posts have all fields
      return {
        ...post,
        files: post.files || [],
        fileTypes: post.fileTypes || [],
        community: post.community || '',
        isAnonymous: post.isAnonymous || false
      }
    })
    
    res.json(transformedPosts)
  } catch (error) {
    console.error('Error fetching posts:', error)
    res.status(500).json({ error: 'Failed to load posts' })
  }
})

app.post('/api/posts', authenticate, upload.array('files', 10), async (req, res) => {
  try {
    const postsPath = path.join(__dirname, 'api', 'posts.json')
    const postsData = fs.readFileSync(postsPath)
    const posts = JSON.parse(postsData)
    
    const files = req.files || []
    const filePaths = []
    const fileTypes = []
    
    // Get userId from authenticated session, NOT from request body!
    const userId = req.userId;
    const isAnonymous = req.body.isAnonymous === 'true';
    
    // Process files (your existing compression code)
    for (const file of files) {
      const mimeType = file.mimetype.split('/')[0]
      const unique = Date.now() + '-' + Math.round(Math.random() * 1E9)
      const ext = path.extname(file.originalname)
      const filename = unique + ext
      
      let folder = 'images'
      let finalPath = path.join(__dirname, folder, filename)
      
      if (mimeType === 'image') {
        // Compress images with Sharp
        folder = 'images'
        finalPath = path.join(__dirname, folder, filename)
        await sharp(file.buffer)
          .resize({ width: 1200, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(finalPath)
        fileTypes.push('image')
      }
      else if (mimeType === 'video') {
        // Compress video with FFmpeg
        folder = 'videos'
        const tempPath = path.join(__dirname, folder, 'temp_' + filename)
        finalPath = path.join(__dirname, folder, filename.replace(ext, '.mp4'))
        
        // Save temp file
        fs.writeFileSync(tempPath, file.buffer)
        
        // Compress video
        await new Promise((resolve, reject) => {
          const ffmpeg = require('fluent-ffmpeg')
          const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
          ffmpeg.setFfmpegPath(ffmpegPath)
          
          ffmpeg(tempPath)
            .videoCodec('libx264')
            .audioCodec('aac')
            .size('?x480') // Max height 480p
            .outputOptions([
                '-preset veryfast', // MUCH FASTER than medium/ultrafast
                '-crf 32',          // Lower quality = smaller file
                '-b:v 500k',        // Cap bitrate
                '-movflags +faststart'
            ])
            .on('end', () => {
              fs.unlinkSync(tempPath)
              resolve()
            })
            .on('error', (err) => {
              console.error('FFmpeg error:', err)
              reject(err)
            })
            .save(finalPath)
        })
        fileTypes.push('video')
      }
      else if (mimeType === 'audio') {
        // Compress audio with FFmpeg
        folder = 'audios'
        const tempPath = path.join(__dirname, folder, 'temp_' + filename)
        finalPath = path.join(__dirname, folder, filename.replace(ext, '.mp3'))
        
        fs.writeFileSync(tempPath, file.buffer)
        
        await new Promise((resolve, reject) => {
          const ffmpeg = require('fluent-ffmpeg')
          const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
          ffmpeg.setFfmpegPath(ffmpegPath)
          
          ffmpeg(tempPath)
            .audioCodec('libmp3lame')
            .audioBitrate('96k')
            .audioChannels(1)
            .outputOptions(['-q:a 5'])
            .on('end', () => {
              fs.unlinkSync(tempPath)
              resolve()
            })
            .on('error', (err) => {
              console.error('FFmpeg error:', err)
              reject(err)
            })
            .save(finalPath)
        })
        fileTypes.push('audio')
      }
      
      filePaths.push('/' + folder + '/' + path.basename(finalPath))
    }

     const newPost = {
      id: Date.now(),
      userId: isAnonymous ? null : userId,
      content: req.body.content || '',
      files: filePaths,
      fileTypes: fileTypes,
      community: req.body.community || '',
      isAnonymous: isAnonymous,
      createdAt: new Date().toISOString(),
      likes: [],
      likeCount: 0,
      comments: []
    }
    
    posts.push(newPost)
    fs.writeFileSync(postsPath, JSON.stringify(posts, null, 2))
    
    res.json({ success: true, post: newPost })
    
  } catch (error) {
    console.error('Post creation error:', error)
    res.status(500).json({ success: false, error: 'Failed to create post' })
  }
})


app.post('/api/posts/:id/comments', authenticate, upload.single('attachment'), async (req, res) => {
  try {
    const postId = parseInt(req.params.id)
    const content = req.body.content
    const userId = req.userId  // From session, NOT from request body!
    
    if (!content) {
      return res.status(400).json({ error: 'Content required' })
    }
    
    const postsPath = path.join(__dirname, 'api', 'posts.json')
    const postsData = fs.readFileSync(postsPath)
    let posts = JSON.parse(postsData)
    
    const postIndex = posts.findIndex(p => p.id === postId)
    if (postIndex === -1) return res.status(404).json({ error: 'Post not found' })
    
    if (!posts[postIndex].comments) posts[postIndex].comments = []
    
    // Get user for username display
    const usersPath = path.join(__dirname, 'api', 'users.json')
    const users = JSON.parse(fs.readFileSync(usersPath))
    const user = users.find(u => u.id === userId)
    
    // Handle attachment (your existing code)
    let attachmentPath = null
    let attachmentType = null
    
    if (req.file) {
      const fileType = req.file.mimetype.split('/')[0] // 'image', 'video', 'audio'
      const unique = Date.now() + '-' + Math.round(Math.random() * 1E9)
      const ext = path.extname(req.file.originalname)
      const filename = unique + ext
      
      // Choose folder based on type
      let folder = 'images'
      let finalPath = path.join(__dirname, folder, filename)
      
      if (fileType === 'image') {
        // Compress images with Sharp (existing)
        folder = 'images'
        finalPath = path.join(__dirname, folder, filename)
        await sharp(req.file.buffer)
          .resize({ width: 600, withoutEnlargement: true }) // Smaller for comments
          .webp({ quality: 70 })
          .toFile(finalPath)
      }
      else if (fileType === 'video') {
        // Compress video with FFmpeg
        folder = 'videos'
        const tempPath = path.join(__dirname, folder, 'temp_' + filename)
        finalPath = path.join(__dirname, folder, filename)
        
        // Save temp file
        fs.writeFileSync(tempPath, req.file.buffer)
        
        // Compress video using fluent-ffmpeg
        await new Promise((resolve, reject) => {
          const ffmpeg = require('fluent-ffmpeg')
          const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
          ffmpeg.setFfmpegPath(ffmpegPath)
          
          ffmpeg(tempPath)
           .videoCodec('libx264')
      .audioCodec('aac')
      .size('?x240') // CRUSH resolution to 144p (YouTube low quality) [citation:1]
      .outputOptions([
        '-crf 51',        // MAXIMUM CRUSH - 51 is absolute worst quality allowed [citation:8][citation:9]
        '-preset ultrafast', // Fastest encoding, but also slightly worse compression [citation:1][citation:6]
        '-b:v 64k',       // Force low bitrate [citation:1]
        '-maxrate 128k',  // Never exceed this [citation:1]
        '-bufsize 128k',  // Small buffer
        '-movflags +faststart',
        '-profile:v baseline',
        '-level 1.3',     // Lowest level for maximum compatibility and size
      ])
            .on('end', () => {
              fs.unlinkSync(tempPath) // Delete temp file
              resolve()
            })
            .on('error', (err) => {
              console.error('FFmpeg error:', err)
              reject(err)
            })
            .save(finalPath)
        })
        
        // Get compressed file size
        const stats = fs.statSync(finalPath)
        console.log(`Video compressed: ${(req.file.size / 1024).toFixed(2)}KB → ${(stats.size / 1024).toFixed(2)}KB`)
      }
      else if (fileType === 'audio') {
        // Compress audio with FFmpeg
        folder = 'audios'
        const tempPath = path.join(__dirname, folder, 'temp_' + filename)
        finalPath = path.join(__dirname, folder, filename.replace(ext, '.mp3'))
        
        // Save temp file
        fs.writeFileSync(tempPath, req.file.buffer)
        
        // Compress audio to MP3
        await new Promise((resolve, reject) => {
          const ffmpeg = require('fluent-ffmpeg')
          const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
          ffmpeg.setFfmpegPath(ffmpegPath)
          
          ffmpeg(tempPath)
            .audioCodec('libmp3lame')
            .audioBitrate('96k') // Good quality, small size [citation:2]
            .audioChannels(1)     // Mono (halves size)
            .outputOptions([
              '-q:a 9' // VBR quality (0-9, lower is better)
            ])
            .on('end', () => {
              fs.unlinkSync(tempPath) // Delete temp file
              resolve()
            })
            .on('error', (err) => {
              console.error('FFmpeg error:', err)
              reject(err)
            })
            .save(finalPath)
        })
        
        const stats = fs.statSync(finalPath)
      }
      
      attachmentPath = '/' + folder + '/' + path.basename(finalPath)
      attachmentType = fileType
    }
    
    const newComment = {
      id: Date.now() + Math.random(),
      userId: userId,
      username: user ? user.username : 'Unknown',
      content: content || '',
      attachment: attachmentPath,
      attachmentType: attachmentType,
      createdAt: new Date().toISOString(),
      likes: [],
      likeCount: 0
    }
    
    posts[postIndex].comments.push(newComment)
    fs.writeFileSync(postsPath, JSON.stringify(posts, null, 2))
    
    res.json({ 
      success: true, 
      comment: newComment,
      commentCount: posts[postIndex].comments.length
    })
    
  } catch (error) {
    console.error('Comment error:', error)
    res.status(500).json({ error: 'Failed to add comment' })
  }
})

app.post('/api/posts/:id/like', authenticate, (req, res) => {
  try {
    const postId = parseInt(req.params.id)
    const userId = req.userId  // From session!
    
    const postsPath = path.join(__dirname, 'api', 'posts.json')
    const postsData = fs.readFileSync(postsPath)
    let posts = JSON.parse(postsData)
    
    const postIndex = posts.findIndex(p => p.id === postId)
    if (postIndex === -1) {
      return res.status(404).json({ error: 'Post not found' })
    }
    
    if (!posts[postIndex].likes) posts[postIndex].likes = []
    
    const alreadyLiked = posts[postIndex].likes.includes(userId)
    
    if (alreadyLiked) {
      posts[postIndex].likes = posts[postIndex].likes.filter(id => id !== userId)
    } else {
      posts[postIndex].likes.push(userId)
    }
    
    posts[postIndex].likeCount = posts[postIndex].likes.length
    
    fs.writeFileSync(postsPath, JSON.stringify(posts, null, 2))
    
    res.json({ 
      success: true, 
      liked: !alreadyLiked,
      likeCount: posts[postIndex].likeCount
    })
    
  } catch (error) {
    console.error('Like error:', error)
    res.status(500).json({ error: 'Failed to process like' })
  }
})

app.post('/api/posts/:postId/comments/:commentId/like', authenticate, (req, res) => {
  try {
    const postId = parseInt(req.params.postId)
    const commentId = parseFloat(req.params.commentId)
    const userId = req.userId  // From session!
    
    const postsPath = path.join(__dirname, 'api', 'posts.json')
    const postsData = fs.readFileSync(postsPath)
    let posts = JSON.parse(postsData)
    
    const postIndex = posts.findIndex(p => p.id === postId)
    if (postIndex === -1) return res.status(404).json({ error: 'Post not found' })
    
    const post = posts[postIndex]
    if (!post.comments) return res.status(404).json({ error: 'Comments not found' })
    
    const commentIndex = post.comments.findIndex(c => c.id === commentId)
    if (commentIndex === -1) return res.status(404).json({ error: 'Comment not found' })
    
    const comment = post.comments[commentIndex]
    if (!comment.likes) comment.likes = []
    
    const alreadyLiked = comment.likes.includes(userId)
    
    if (alreadyLiked) {
      comment.likes = comment.likes.filter(id => id !== userId)
    } else {
      comment.likes.push(userId)
    }
    
    comment.likeCount = comment.likes.length
    
    fs.writeFileSync(postsPath, JSON.stringify(posts, null, 2))
    
    res.json({ 
      success: true, 
      liked: !alreadyLiked,
      likeCount: comment.likeCount
    })
    
  } catch (error) {
    console.error('Comment like error:', error)
    res.status(500).json({ error: 'Failed to like comment' })
  }
})

app.put('/api/posts/:id', upload.single('image'), authenticate, async (req, res) => {
  try {
    const postId = parseInt(req.params.id)
    const postsPath = path.join(__dirname, 'api', 'posts.json')
    
    const postsData = fs.readFileSync(postsPath)
    let posts = JSON.parse(postsData)
    
    const postIndex = posts.findIndex(post => post.id === postId)
    
    if (postIndex === -1) {
      return res.status(404).json({ error: 'Post not found' })
    }
    
    const oldPost = posts[postIndex]
    
    posts[postIndex].content = req.body.content || ''
    
    if (req.file) {
      if (oldPost.imagePath) {
        const oldImageFilename = oldPost.imagePath.replace('/images/', '')
        const oldImagePath = path.join(__dirname, 'images', oldImageFilename)
        try {
          fs.unlinkSync(oldImagePath)
        } catch (err) {
          console.log('Old image not found:', err)
        }
      }
      
      const unique = Date.now() + '-' + Math.round(Math.random() * 1E9)
      const filename = unique + '.webp'
      const imagePath = path.join(__dirname, 'images', filename)
      
      await sharp(req.file.buffer)
        .resize({ width: 1200, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(imagePath)
      
      posts[postIndex].imagePath = '/images/' + filename
    }
    
    fs.writeFileSync(postsPath, JSON.stringify(posts, null, 2))
    
    res.json({ success: true, post: posts[postIndex] })
    
  } catch (error) {
    console.error('Update error:', error)
    res.status(500).json({ error: 'Failed to update post' })
  }
})

app.delete('/api/posts/:id', authenticate, (req, res) => {
  try {
    const postId = parseInt(req.params.id)
    const userId = req.userId  // From session!
    const postsPath = path.join(__dirname, 'api', 'posts.json')
    
    const postsData = fs.readFileSync(postsPath)
    let posts = JSON.parse(postsData)
    
    const postIndex = posts.findIndex(p => p.id === postId)
    if (postIndex === -1) {
      return res.status(404).json({ error: 'Post not found' })
    }
    
    const post = posts[postIndex];
    
    // Check ownership
    if (post.userId !== userId && post.isAnonymous !== true) {
      // Also check if admin
      const usersPath = path.join(__dirname, 'api', 'users.json')
      const users = JSON.parse(fs.readFileSync(usersPath))
      const user = users.find(u => u.id === userId);
      
      if (!user || !user.isAdmin) {
        return res.status(403).json({ error: 'Not authorized to delete this post' });
      }
    }
    
    const deletedPost = posts.splice(postIndex, 1)[0];
    
    // Delete ALL files
    if (deletedPost && deletedPost.files) {
      deletedPost.files.forEach(filePath => {
        const fullPath = path.join(__dirname, filePath)
        try {
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath)
        } catch (err) {
          console.log('File not found:', fullPath)
        }
      })
    }
    
    fs.writeFileSync(postsPath, JSON.stringify(posts, null, 2))
    
    res.json({ success: true })
    
  } catch (error) {
    console.error('Delete error:', error)
    res.status(500).json({ error: 'Failed to delete post' })
  }
})

// Get single post by ID
app.get('/api/posts/:id', (req, res) => {
  try {
    const postId = parseInt(req.params.id)
    const postsPath = path.join(__dirname, 'api', 'posts.json')
    const postsData = fs.readFileSync(postsPath)
    const posts = JSON.parse(postsData)
    const post = posts.find(p => p.id === postId)
    if (!post) return res.status(404).json({ error: 'Post not found' })
    res.json(post)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ============ PROFILE ROUTES ============
app.get('/api/users', (req, res) => {
  try {
    const usersPath = path.join(__dirname, 'api', 'users.json')
    const users = JSON.parse(fs.readFileSync(usersPath))
    
    const safeUsers = users.map(user => ({
      id: user.id,    
      username: user.username,
      profilePicture: user.profilePicture || null,
      status: user.status || ''
    }))
    
    res.json(safeUsers)
  } catch (error) {
    console.error('Error fetching users:', error)
    res.status(500).json({ error: 'Failed to load users' })
  }
})

// Get user by ID with postCount
app.get('/api/users/:userId', (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const usersPath = path.join(__dirname, 'api', 'users.json');
    const postsPath = path.join(__dirname, 'api', 'posts.json');
    
    const users = JSON.parse(fs.readFileSync(usersPath));
    const posts = JSON.parse(fs.readFileSync(postsPath));
    
    const user = users.find(u => u.id === userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Count posts by this user (excluding anonymous posts on profile)
    const postCount = posts.filter(p => p.userId === userId && !p.isAnonymous).length;
    
    res.json({
      id: user.id,
      username: user.username,
      profilePicture: user.profilePicture || null,
      communities: user.communities || [],
      friends: user.friends || [],
      pending: user.pending || [],
      subscribers: user.subscribers || [],
      postCount: postCount,
      status: user.status || [],
      createdAt: user.createdAt
    });
    
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get posts by user ID (not username)
app.get('/api/users/:userId/posts', (req, res) => {
  try {
    const userId = parseInt(req.params.userId)
    
    const postsPath = path.join(__dirname, 'api', 'posts.json')
    const posts = JSON.parse(fs.readFileSync(postsPath))
    
    // Filter by userId, exclude anonymous posts
    const userPosts = posts.filter(post => {
      if (post.userId !== userId) return false
      if (post.isAnonymous === true) return false
      return true
    })
    
    res.json(userPosts)
  } catch (error) {
    console.error('Error fetching user posts:', error)
    res.status(500).json({ error: 'Failed to load posts' })
  }
})

// Update user status
app.post('/api/users/update-status', authenticate, upload.none(), async (req, res) => {
  try {
    const { status } = req.body
    const userId = req.userId  // From session!
    
    const usersPath = path.join(__dirname, 'api', 'users.json')
    const usersData = fs.readFileSync(usersPath)
    let users = JSON.parse(usersData)
    
    const userIndex = users.findIndex(u => u.id === userId)
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    users[userIndex].status = status || ''
    
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
    
    res.json({ success: true })
    
  } catch (error) {
    console.error('Error updating status:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

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
    const { username } = req.body
    const userId = req.userId  // From session!
    
    const usersPath = path.join(__dirname, 'api', 'users.json')
    const usersData = fs.readFileSync(usersPath)
    let users = JSON.parse(usersData)
    
    const userIndex = users.findIndex(u => u.id === userId)
    if (userIndex === -1) return res.status(404).json({ success: false, error: 'User not found' })
    
    // Check if username is taken
    if (username !== users[userIndex].username && users.some(u => u.username === username)) {
      return res.status(400).json({ success: false, error: 'Username taken' })
    }
    
    const oldUsername = users[userIndex].username;
    
    // Update username
    users[userIndex].username = username
    
    // Handle profile picture
    if (req.file && req.file.mimetype.startsWith('image/')) {
      if (users[userIndex].profilePicture) {
        const oldPath = path.join(__dirname, 'images', path.basename(users[userIndex].profilePicture))
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
      }
      
      const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.webp'
      const imagePath = path.join(__dirname, 'images', filename)
      
      await sharp(req.file.buffer)
        .resize(300, 300, { fit: 'cover' })
        .webp({ quality: 80 })
        .toFile(imagePath)
      
      users[userIndex].profilePicture = '/images/' + filename
    }
    
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
    
    // Update posts if username changed
    if (username !== oldUsername) {
      const postsPath = path.join(__dirname, 'api', 'posts.json')
      const postsData = fs.readFileSync(postsPath)
      let posts = JSON.parse(postsData)
      
      posts = posts.map(p => {
        if (p.username === oldUsername && !p.isAnonymous) {
          return { ...p, username }
        }
        return p
      })
      
      fs.writeFileSync(postsPath, JSON.stringify(posts, null, 2))
    }
    
    res.json({ 
      success: true,
      profilePicture: users[userIndex].profilePicture
    })
    
  } catch (error) {
    console.error('Update error:', error)
    res.status(500).json({ success: false, error: 'Server error' })
  }
})

// Delete a comment
app.delete('/api/posts/:postId/comments/:commentId', authenticate, (req, res) => {
  try {
    const postId = parseInt(req.params.postId)
    const commentId = parseFloat(req.params.commentId)
    const userId = req.userId  // From session!
    
    const postsPath = path.join(__dirname, 'api', 'posts.json')
    const postsData = fs.readFileSync(postsPath)
    let posts = JSON.parse(postsData)
    
    const postIndex = posts.findIndex(p => p.id === postId)
    if (postIndex === -1) {
      return res.status(404).json({ error: 'Post not found' })
    }
    
    const commentIndex = posts[postIndex].comments.findIndex(c => c.id === commentId)
    if (commentIndex === -1) {
      return res.status(404).json({ error: 'Comment not found' })
    }
    
    const comment = posts[postIndex].comments[commentIndex];
    
    // Check ownership
    if (comment.userId !== userId) {
      // Check if admin
      const usersPath = path.join(__dirname, 'api', 'users.json')
      const users = JSON.parse(fs.readFileSync(usersPath))
      const user = users.find(u => u.id === userId);
      
      if (!user || !user.isAdmin) {
        return res.status(403).json({ error: 'Not authorized to delete this comment' });
      }
    }
    
    // Delete attachment file if exists
    if (comment.attachment) {
      const filePath = path.join(__dirname, comment.attachment)
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      } catch (err) {
        console.log('Attachment file not found:', err)
      }
    }
    
    // Remove comment
    posts[postIndex].comments.splice(commentIndex, 1)
    
    fs.writeFileSync(postsPath, JSON.stringify(posts, null, 2))
    
    res.json({ success: true })
    
  } catch (error) {
    console.error('Delete comment error:', error)
    res.status(500).json({ error: 'Failed to delete comment' })
  }
})

// ============ FRIENDS ROUTES ============

// Отправить заявку в друзья (using userIds)
app.post('/api/friends/request', async (req, res) => {
    console.log(req.body)
  try {
    const { fromUserId, toUserId } = req.body
    
    const usersPath = path.join(__dirname, 'api', 'users.json')
    const usersData = fs.readFileSync(usersPath)
    let users = JSON.parse(usersData)
    
    const fromUser = users.find(u => u.id === fromUserId)
    const toUser = users.find(u => u.id === toUserId)
    
    if (!fromUser || !toUser) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    // Инициализируем массивы
    if (!fromUser.friends) fromUser.friends = []
    if (!toUser.friends) toUser.friends = []
    if (!toUser.pending) toUser.pending = []
    
    // Проверяем, не друзья ли уже
    if (fromUser.friends.includes(toUser.id) || toUser.friends.includes(fromUser.id)) {
      return res.status(400).json({ error: 'Already friends' })
    }
    
    // Проверяем, не отправлял ли он уже заявку
    if (toUser.pending.includes(fromUser.id)) {
      return res.status(400).json({ error: 'Request already sent' })
    }
    
    // Добавляем отправителя в pending ПОЛУЧАТЕЛЯ
    toUser.pending.push(fromUser.id)
    
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
    
    res.json({ success: true })
    
  } catch (error) {
    console.error('Friend request error:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

// Принять заявку в друзья (using userIds)
app.post('/api/friends/accept', async (req, res) => {
  try {
    const { currentUserId, requesterUserId } = req.body
    
    const usersPath = path.join(__dirname, 'api', 'users.json')
    const usersData = fs.readFileSync(usersPath)
    let users = JSON.parse(usersData)
    
    const currentUser = users.find(u => u.id === currentUserId)
    const requester = users.find(u => u.id === requesterUserId)
    
    if (!currentUser || !requester) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    // Инициализируем массивы
    if (!currentUser.friends) currentUser.friends = []
    if (!requester.friends) requester.friends = []
    if (!currentUser.pending) currentUser.pending = []
    
    // Проверяем, есть ли заявка
    if (!currentUser.pending.includes(requester.id)) {
      return res.status(400).json({ error: 'No pending request' })
    }
    
    // Удаляем из pending текущего пользователя
    currentUser.pending = currentUser.pending.filter(id => id !== requester.id)
    
    // Добавляем друг друга в friends
    if (!currentUser.friends.includes(requester.id)) {
      currentUser.friends.push(requester.id)
    }
    if (!requester.friends.includes(currentUser.id)) {
      requester.friends.push(currentUser.id)
    }
    
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
    
    res.json({ success: true })
    
  } catch (error) {
    console.error('Accept friend error:', error)
    res.status(500).json({ error: 'Server error' })
  }
})


// Отклонить заявку (using userIds)
app.post('/api/friends/reject', async (req, res) => {
  try {
    const { currentUserId, requesterUserId } = req.body
    
    const usersPath = path.join(__dirname, 'api', 'users.json')
    const usersData = fs.readFileSync(usersPath)
    let users = JSON.parse(usersData)
    
    const currentUser = users.find(u => u.id === currentUserId)
    const requester = users.find(u => u.id === requesterUserId)
    
    if (!currentUser || !requester) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    if (!currentUser.pending) currentUser.pending = []
    
    // Просто удаляем из pending
    currentUser.pending = currentUser.pending.filter(id => id !== requester.id)
    
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
    
    res.json({ success: true })
    
  } catch (error) {
    console.error('Reject friend error:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

// Получить список друзей и заявок
// Get friends list by user ID
app.get('/api/friends/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId)
    const usersPath = path.join(__dirname, 'api', 'users.json')
    const usersData = fs.readFileSync(usersPath)
    let users = JSON.parse(usersData)
    
    const currentUser = users.find(u => u.id === userId)
    
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    const friends = currentUser.friends || []
    const pending = currentUser.pending || []
    const subscribers = currentUser.subscribers || []
    
    const friendsData = friends.map(friendId => {
      const friend = users.find(u => u.id === friendId)
      return friend ? {
        id: friend.id,
        username: friend.username,
        profilePicture: friend.profilePicture || null,
	status: friend.status || ''
      } : null
    }).filter(f => f !== null)
    
    const pendingData = pending.map(pendingId => {
      const requester = users.find(u => u.id === pendingId)
      return requester ? {
        id: requester.id,
        username: requester.username,
        profilePicture: requester.profilePicture || null
      } : null
    }).filter(r => r !== null)
    
    res.json({
      friends: friendsData,
      pending: pendingData,
      subscribersCount: subscribers.length
    })
    
  } catch (error) {
    console.error('Get friends error:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

// Remove friend - using userId
app.post('/api/friends/remove', async (req, res) => {
  try {
    const { currentUserId, friendId } = req.body
    
    const usersPath = path.join(__dirname, 'api', 'users.json')
    const usersData = fs.readFileSync(usersPath)
    let users = JSON.parse(usersData)
    
    const currentUser = users.find(u => u.id === currentUserId)
    const friend = users.find(u => u.id === friendId)
    
    if (!currentUser || !friend) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    if (!currentUser.friends) currentUser.friends = []
    if (!friend.friends) friend.friends = []
    
    // Remove each other from friends arrays
    currentUser.friends = currentUser.friends.filter(id => id !== friend.id)
    friend.friends = friend.friends.filter(id => id !== currentUser.id)
    
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
    
    res.json({ success: true })
    
  } catch (error) {
    console.error('Remove friend error:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

// Отменить отправленную заявку
app.post('/api/friends/cancel', async (req, res) => {
  try {
    const { fromUsername, toUsername } = req.body
    
    const usersPath = path.join(__dirname, 'api', 'users.json')
    const usersData = fs.readFileSync(usersPath)
    let users = JSON.parse(usersData)
    
    const fromUser = users.find(u => u.username === fromUsername)
    const toUser = users.find(u => u.username === toUsername)
    
    if (!fromUser || !toUser) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    if (!toUser.pending) toUser.pending = []
    
    // Удаляем fromUser из pending получателя
    toUser.pending = toUser.pending.filter(id => id !== fromUser.id)
    
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
    
    res.json({ success: true })
    
  } catch (error) {
    console.error('Cancel request error:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

// ============ COMMUNITIES ROUTES ============

// Get all communities (simple list for display)
app.get('/api/communities', async (req, res) => {
  try {
    const commPath = path.join(__dirname, 'api', 'communities.json')
    
    if (!fs.existsSync(commPath)) {
      return res.json([])
    }
    
    const commsData = fs.readFileSync(commPath)
    const comms = JSON.parse(commsData)
    
    // Return only needed data
    res.json(comms.map(comm => ({
      id: comm.id,
      username: comm.username,
      profilePicture: comm.profilePicture || null,
      type: comm.type || 'community'
    })))
  } catch (error) {
    console.error('Error fetching communities:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

// Search communities (by name OR description)
app.get('/api/communities/search', (req, res) => {
    try {
        const query = req.query.q || ''
        const commPath = path.join(__dirname, 'api', 'communities.json')
        
        let communities = []
        try {
            const commData = fs.readFileSync(commPath)
            communities = JSON.parse(commData)
        } catch (err) {
            communities = []
        }
        
        if (query.length < 1) {
            return res.json([])
        }
        
        const searchTerm = query.toLowerCase()
        const results = communities
            .filter(comm => {
                // Skip communities with searchable: false (if you add this field later)
                if (comm.searchable === false) return false
                
                // Search in username
                const nameMatch = comm.username.toLowerCase().includes(searchTerm)
                // Search in description (if exists)
                const descMatch = comm.description && comm.description.toLowerCase().includes(searchTerm)
                // Search in status (if exists)
                const statusMatch = comm.status && comm.status.toLowerCase().includes(searchTerm)
                
                return nameMatch || descMatch || statusMatch
            })
            .map(comm => ({
                id: comm.id,
                username: comm.username,
                profilePicture: comm.profilePicture || null,
                type: comm.type || 'community',
                description: comm.description || '',
                status: comm.status || '',
        	subCount: comm.subscribers.length
            }))
            .slice(0, 50) // Limit to 50 results
        
        res.json(results)
    } catch (error) {
        console.error('Community search error:', error)
        res.status(500).json({ error: 'Search failed' })
    }
})

app.get('/api/communities/all', async (req, res) => {
  console.log('/api/communities/all was called!') // DEBUG
  try {
    const commPath = path.join(__dirname, 'api', 'communities.json')
    console.log('Looking for file at:', commPath) // DEBUG
    
    if (!fs.existsSync(commPath)) {
      console.log('File not found!') // DEBUG
      return res.json([])
    }
    
    const commsData = fs.readFileSync(commPath)
    const comms = JSON.parse(commsData)
    console.log('Found communities:', comms.length) // DEBUG
    
    res.json(comms.map(comm => ({
      id: comm.id,
      username: comm.username,
      type: comm.type,
      moderators: comm.moderators || [],
      owner: comm.owner
    })))
  } catch (error) {
    console.error('Error:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/communities/new', upload.single('profilePicture'), async (req, res) => {
  try {
    const { username, createdBy, type, rules, description } = req.body
    console.log(req.body)
    if (!username || !createdBy) {
      return res.status(400).json({ success: false, error: 'Missing fields' })
    }
    
    const commPath = path.join(__dirname, 'api', 'communities.json')
    
    // Get user data
    const usersPath = path.join(__dirname, 'api', 'users.json')
    const usersData = fs.readFileSync(usersPath)
    let users = JSON.parse(usersData)
    
    const currentUser = users.find(u => u.username === createdBy)
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' })
    }

    let comms = []
    try {
      const commsData = fs.readFileSync(commPath)
      comms = JSON.parse(commsData)
    } catch (err) {
      comms = []
    }
    
    const existingComm = comms.find(u => u.username === username)
    if (existingComm) {
      return res.status(400).json({ success: false, error: 'Community name already taken' })
    }
    

    // Handle profile picture if uploaded
    let profilePicturePath = null
    if (req.file) {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1E9)
      const ext = path.extname(req.file.originalname)
      const filename = unique + ext
      const imagePath = path.join(__dirname, 'images', filename)
      
      // Optional: compress with sharp
      if (req.file.mimetype.startsWith('image/')) {
        const sharp = require('sharp')
        await sharp(req.file.buffer)
          .resize({ width: 300, height: 300, fit: 'cover' })
          .webp({ quality: 80 })
          .toFile(imagePath.replace(ext, '.webp'))
        profilePicturePath = '/images/' + filename.replace(ext, '.webp')
      } else {
        fs.writeFileSync(imagePath, req.file.buffer)
        profilePicturePath = '/images/' + filename
      }
    }
    
    const newCommunity = {
      id: Date.now(),
      username: username,
      type: type || 'community',
      createdAt: new Date().toISOString(),
      profilePicture: profilePicturePath,
      subscribers: [currentUser.id],
      moderators: [currentUser.id],
      owner: currentUser.id,
      status: '',
      rules: rules || '',
      description: description || ''
    }
    const newCommunityId = newCommunity.id
    console.log(`=== NEW COMMUNITY ===`)
    console.log(`name: ${newCommunity.username}`)
    comms.push(newCommunity)
    fs.writeFileSync(commPath, JSON.stringify(comms, null, 2))
    currentUser.communities.push(newCommunityId)
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
    
    
    res.json({ 
      success: true, 
      comm: { 
        id: newCommunity.id, 
        username: newCommunity.username,
        createdAt: newCommunity.createdAt
      } 
    })
    
  } catch (error) {
    console.error('Community creation error:', error)
    res.status(500).json({ success: false, error: 'Server error' })
  }
})

// Modify community (update name, status, description, rules, profile picture)
app.post('/api/communities/:id/modify', authenticate, verifyCommunityAccess, upload.single('profilePicture'), async (req, res) => {
  try {
    const communityId = parseInt(req.params.id)
    const { username, status, description, rules } = req.body
    const currentUserId = parseInt(req.body.currentUserId) // You'll need to send this from client
    
    const commPath = path.join(__dirname, 'api', 'communities.json')
    const commsData = fs.readFileSync(commPath)
    let comms = JSON.parse(commsData)
    
    const communityIndex = comms.findIndex(c => c.id === communityId)
    if (communityIndex === -1) {
      return res.status(404).json({ error: 'Community not found' })
    }
    
    const community = comms[communityIndex]
    
    // Check permissions
    const isOwner = community.owner === currentUserId
    const isModerator = community.moderators?.includes(currentUserId)
    if (!isOwner && !isModerator) {
      return res.status(403).json({ error: 'Not authorized to edit this community' })
    }
    
    // Apply updates only for fields that are present
    if (username !== undefined) {
      // Check if username is taken by another community
      const nameTaken = comms.some(c => c.username === username && c.id !== communityId)
      if (nameTaken) {
        return res.status(400).json({ error: 'Community name already taken' })
      }
      comms[communityIndex].username = username
    }
    
    if (status !== undefined) comms[communityIndex].status = status
    if (description !== undefined) comms[communityIndex].description = description
    if (rules !== undefined) comms[communityIndex].rules = rules
    
    // Handle profile picture
    if (req.file) {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1E9)
      const ext = path.extname(req.file.originalname)
      const filename = unique + ext
      const imagePath = path.join(__dirname, 'images', filename)
      
      if (req.file.mimetype.startsWith('image/')) {
        await sharp(req.file.buffer)
          .resize({ width: 300, height: 300, fit: 'cover' })
          .webp({ quality: 80 })
          .toFile(imagePath.replace(ext, '.webp'))
        comms[communityIndex].profilePicture = '/images/' + filename.replace(ext, '.webp')
      } else {
        fs.writeFileSync(imagePath, req.file.buffer)
        comms[communityIndex].profilePicture = '/images/' + filename
      }
    }
    
    fs.writeFileSync(commPath, JSON.stringify(comms, null, 2))
    
    res.json({ success: true })
  } catch (error) {
    console.error('Error modifying community:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

// Get posts by community ID (using community field)
app.get('/api/communities/:id/posts', async (req, res) => {
  try {
    const commId = parseInt(req.params.id)
    const postsPath = path.join(__dirname, 'api', 'posts.json')
    
    // Read posts
    let posts = []
    try {
      const postsData = fs.readFileSync(postsPath)
      posts = JSON.parse(postsData)
    } catch (err) {
      console.log('Posts file not found or empty');
    }
    
    // Filter posts where community field matches the ID (as string)
    const communityPosts = posts
      .filter(p => String(p.community) === String(commId))
      .sort((a, b) => b.id - a.id)
    
    res.json(communityPosts)
    
  } catch (error) {
    console.error('Error fetching community posts:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

// JOIN DA COMMINTIE (fixed version)
app.post('/api/communities/:id/join', async (req, res) => {
  try {
    const communityId = parseInt(req.params.id)
    const { username } = req.body
    
    if (!username || !communityId) {
      return res.status(400).json({ error: 'Missing fields' })
    }
    
    // Get user
    const usersPath = path.join(__dirname, 'api', 'users.json')
    const usersData = fs.readFileSync(usersPath)
    let users = JSON.parse(usersData)
    
    const currentUser = users.find(u => u.username === username)
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    // Get community
    const commPath = path.join(__dirname, 'api', 'communities.json')
    const commData = fs.readFileSync(commPath)
    let comms = JSON.parse(commData)
    
    const currentCommunity = comms.find(c => c.id === communityId)
    if (!currentCommunity) {
      return res.status(404).json({ error: 'Community not found' })
    }
    
    // Initialize arrays if needed
    if (!currentUser.communities) currentUser.communities = []
    if (!currentCommunity.subscribers) currentCommunity.subscribers = []
    
    // Add user ID to community subscribers
    if (!currentCommunity.subscribers.includes(currentUser.id)) {
      currentCommunity.subscribers.push(currentUser.id)
    }
    
    // Add community ID to user communities
    if (!currentUser.communities.includes(communityId)) {
      currentUser.communities.push(communityId)
    }
    
    // Save both files
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
    fs.writeFileSync(commPath, JSON.stringify(comms, null, 2))
    
    res.json({ success: true })
    
  } catch (error) {
    console.error('Join community error:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

// Leaf DA COMMINTIE (actually fixed with numbers)
app.post('/api/communities/:id/leave', async (req, res) => {
  try {
    const communityId = parseInt(req.params.id) // Parse to number
    const { username } = req.body
    
    if (!username || !communityId) {
      return res.status(400).json({ error: 'Missing fields' })
    }
    
    const usersPath = path.join(__dirname, 'api', 'users.json')
    const usersData = fs.readFileSync(usersPath)
    let users = JSON.parse(usersData)

    const commPath = path.join(__dirname, 'api', 'communities.json')
    const commData = fs.readFileSync(commPath)
    let comms = JSON.parse(commData)
    
    // Find by number
    const currentCommunity = comms.find(c => c.id === communityId)
    const currentUser = users.find(u => u.username === username)

    if (!currentUser || !currentCommunity) {
      return res.status(404).json({ error: 'User or community not found' })
    }
    
    // Filter by number (strict equality works now)
    if (currentCommunity.subscribers) {
      currentCommunity.subscribers = currentCommunity.subscribers.filter(id => id !== currentUser.id)
    }
    
    if (currentUser.communities) {
      currentUser.communities = currentUser.communities.filter(id => id !== communityId)
    }
    
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2))
    fs.writeFileSync(commPath, JSON.stringify(comms, null, 2))
    
    res.json({ success: true })
    
  } catch (error) {
    console.error('Leave community error:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

// Get community by ID
app.get('/api/communities/:id', async (req, res) => {
  try {
    const commId = parseInt(req.params.id)
    const commPath = path.join(__dirname, 'api', 'communities.json')
    const postsPath = path.join(__dirname, 'api', 'posts.json')
    
    // Read communities
    const commsData = fs.readFileSync(commPath)
    const comms = JSON.parse(commsData)
    
    // Find community
    const community = comms.find(c => c.id === commId)
    
    if (!community) {
      return res.status(404).json({ error: 'Community not found' })
    }
    
    // Count posts for this community
    let postCount = 0
    try {
      const postsData = fs.readFileSync(postsPath)
      const posts = JSON.parse(postsData)
      postCount = posts.filter(p => p.communityId === commId).length
    } catch (err) {
      // Posts file might not exist yet
    }
    
    // Return community data
    res.json({
      id: community.id,
      username: community.username,
      profilePicture: community.profilePicture || null,
      type: community.type || 'community',
      description: community.description || '',
      rules: community.rules || '',
      status: community.status || '',
      subscribers: community.subscribers || [],
      moderators: community.moderators || [],
      owner: community.owner,
      postCount: postCount,
      createdAt: community.createdAt
    })
    
  } catch (error) {
    console.error('Error fetching community:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

// Get all communities of a user by userId
app.get('/api/user/communities/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId)
    
    // Get user data
    const usersPath = path.join(__dirname, 'api', 'users.json')
    const usersData = fs.readFileSync(usersPath)
    const users = JSON.parse(usersData)
    
    const currentUser = users.find(u => u.id === userId)
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    // Get community IDs the user is subscribed to
    const communityIds = currentUser.communities || []
    
    // Get ALL communities data to look up names and pfps
    const commPath = path.join(__dirname, 'api', 'communities.json')
    const commsData = fs.readFileSync(commPath)
    const comms = JSON.parse(commsData)
    
    // Map IDs to actual community data
    const communitiesData = communityIds
      .map(id => comms.find(c => c.id === id))
      .filter(c => c !== null)
      .map(c => ({
        id: c.id,
        username: c.username,
        profilePicture: c.profilePicture || null,
	type: c.type,
        subCount: c.subscribers.length
      }))
    
    res.json({ communities: communitiesData })
    
  } catch (error) {
    console.error('Get communities error:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

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
        
        const usersPath = path.join(__dirname, 'api', 'users.json');
        const usersData = fs.readFileSync(usersPath);
        const users = JSON.parse(usersData);
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
    console.log('🔒 HTTPS server running on port 3000');
});

// HTTP server (redirects to HTTPS)
http.createServer((req, res) => {
    const host = req.headers.host;
    res.writeHead(301, { Location: `https://${host}${req.url}` });
    res.end();
}).listen(80, () => {
    console.log('↪️ HTTP redirect server on port 80');
});

//app.listen(PORT, HOST, () => {
//  console.log(`Server running at http://localhost:${PORT}/`);
//  console.log(`Also accessible on your local network IP`);
//});