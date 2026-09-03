const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'chat.db');
const db = new sqlite3.Database(dbPath);

const initDB = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        temp_email TEXT UNIQUE,
        profile_pic TEXT DEFAULT '',
        bg_pic TEXT DEFAULT '',
        bio TEXT DEFAULT ''
      )`, (err) => {
        if (err) return reject(err);
        
        db.run(`CREATE TABLE IF NOT EXISTS friendships (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          friend_id INTEGER,
          status TEXT DEFAULT 'accepted',
          FOREIGN KEY(user_id) REFERENCES users(id),
          FOREIGN KEY(friend_id) REFERENCES users(id)
        )`, (err) => {
          if (err) return reject(err);

          // تم إضافة file_url و file_type لدعم رفع الملفات
          db.run(`CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER,
            receiver_id INTEGER,
            content TEXT,
            file_url TEXT,
            file_type TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(sender_id) REFERENCES users(id),
            FOREIGN KEY(receiver_id) REFERENCES users(id)
          )`, (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
      });
    });
  });
};

const getDb = () => db;
module.exports = { initDB, getDb };