const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { initDB, getDb } = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const JWT_SECRET = 'super_secret_key_change_in_production';

// إعداد Multer لرفع الملفات بأسماء فريدة
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // حد 10 ميجابايت

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'غير مصرح' });
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'رمز غير صالح' });
    req.userId = decoded.id;
    next();
  });
};

const fetchCatchmailMessages = async (email) => {
  try {
    const res = await axios.get(`https://api.catchmail.io/api/v1/mailbox?address=${email}`);
    return res.data || [];
  } catch (error) {
    return [];
  }
};

// --- التحقق من الجلسة (للبقاء مسجلاً عند التحديث) ---
app.get('/api/me', authenticate, (req, res) => {
  const db = getDb();
  db.get(`SELECT id, username, temp_email, profile_pic, bg_pic, bio FROM users WHERE id = ?`, [req.userId], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    res.json({ user });
  });
});

// --- المصادقة ---
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  const tempEmail = `${username.replace(/\s+/g, '').toLowerCase()}@catchmail.io`;
  const hashedPassword = await bcrypt.hash(password, 10);
  const db = getDb();

  db.run(`INSERT INTO users (username, password, temp_email) VALUES (?, ?, ?)`, 
    [username, hashedPassword, tempEmail], function(err) {
      if (err) return res.status(400).json({ error: 'اسم المستخدم موجود بالفعل' });
      res.json({ message: 'تم التسجيل بنجاح', tempEmail });
    }
  );
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const db = getDb();
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err || !user) return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });
    
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, username: user.username, temp_email: user.temp_email, profile_pic: user.profile_pic, bg_pic: user.bg_pic, bio: user.bio } });
  });
});

// --- رفع الملفات ---
app.post('/api/upload', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
  res.json({ url: `/uploads/${req.file.filename}`, type: req.file.mimetype, name: req.file.originalname });
});

// --- الملف الشخصي ---
app.post('/api/profile/update', authenticate, upload.fields([{ name: 'profile_pic' }, { name: 'bg_pic' }]), (req, res) => {
  const userId = req.userId;
  const { bio } = req.body;
  const db = getDb();
  
  let profilePic = req.files['profile_pic'] ? `/uploads/${req.files['profile_pic'][0].filename}` : null;
  let bgPic = req.files['bg_pic'] ? `/uploads/${req.files['bg_pic'][0].filename}` : null;

  let query = `UPDATE users SET `;
  let params = [];
  if (profilePic) { query += `profile_pic = ?, `; params.push(profilePic); }
  if (bgPic) { query += `bg_pic = ?, `; params.push(bgPic); }
  if (bio) { query += `bio = ?, `; params.push(bio); }
  query = query.slice(0, -2) + ` WHERE id = ?`;
  params.push(userId);

  db.run(query, params, function(err) {
    if (err) return res.status(500).json({ error: 'فشل التحديث' });
    res.json({ message: 'تم تحديث الملف الشخصي' });
  });
});

// --- الأصدقاء ---
app.post('/api/friends/add', authenticate, (req, res) => {
  const userId = req.userId;
  const { friendIdentifier } = req.body;
  const db = getDb();
  
  db.get(`SELECT id FROM users WHERE username = ? OR temp_email = ?`, [friendIdentifier, friendIdentifier], (err, friend) => {
    if (err || !friend) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (friend.id === userId) return res.status(400).json({ error: 'لا يمكنك إضافة نفسك' });

    db.run(`INSERT OR IGNORE INTO friendships (user_id, friend_id, status) VALUES (?, ?, 'accepted')`, 
      [userId, friend.id], function(err) {
        if (err) return res.status(400).json({ error: 'فشل في الإضافة' });
        res.json({ message: 'تمت إضافة الصديق بنجاح', friendId: friend.id });
      }
    );
  });
});

app.get('/api/friends', authenticate, (req, res) => {
  const db = getDb();
  db.all(`SELECT u.id, u.username, u.temp_email, u.profile_pic FROM friendships f 
          JOIN users u ON f.friend_id = u.id WHERE f.user_id = ? AND f.status = 'accepted'`, 
    [req.userId], (err, friends) => {
      if (err) return res.status(500).json({ error: 'خطأ في قاعدة البيانات' });
      res.json(friends);
    }
  );
});

// --- الرسائل ---
app.get('/api/messages/:friendId', authenticate, (req, res) => {
  const db = getDb();
  db.all(`SELECT * FROM messages WHERE 
          (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) 
          ORDER BY timestamp ASC`, 
    [req.userId, req.params.friendId, req.params.friendId, req.userId], 
    (err, messages) => {
      if (err) return res.status(500).json({ error: 'خطأ في قاعدة البيانات' });
      res.json(messages);
    }
  );
});

app.get('/api/catchmail', authenticate, async (req, res) => {
  const db = getDb();
  db.get(`SELECT temp_email FROM users WHERE id = ?`, [req.userId], async (err, user) => {
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const messages = await fetchCatchmailMessages(user.temp_email);
    res.json(messages);
  });
});

// --- Socket.io ---
io.on('connection', (socket) => {
  socket.on('join_chat', (userId) => {
    socket.join(userId);
  });

  socket.on('send_message', (data) => {
    const { sender_id, receiver_id, content, file_url, file_type } = data;
    const db = getDb();
    db.run(`INSERT INTO messages (sender_id, receiver_id, content, file_url, file_type) VALUES (?, ?, ?, ?, ?)`, 
      [sender_id, receiver_id, content, file_url, file_type], function(err) {
        if (!err) {
          io.to(receiver_id).emit('receive_message', { ...data, id: this.lastID, timestamp: new Date() });
        }
      }
    );
  });

  socket.on('webrtc_offer', (data) => io.to(data.receiver_id).emit('webrtc_offer', data));
  socket.on('webrtc_answer', (data) => io.to(data.receiver_id).emit('webrtc_answer', data));
  socket.on('webrtc_ice_candidate', (data) => io.to(data.receiver_id).emit('webrtc_ice_candidate', data));
  socket.on('end_call_signal', (data) => io.to(data.receiver_id).emit('call_ended'));
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  server.listen(PORT, () => console.log(`الخادم يعمل على http://localhost:${PORT}`));
}).catch(err => console.error('فشل تهيئة قاعدة البيانات:', err));