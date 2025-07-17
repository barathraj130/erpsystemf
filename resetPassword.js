const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const db = new sqlite3.Database('./database.sqlite');

const newPassword = 'admin';

bcrypt.hash(newPassword, 10, (err, hash) => {
  if (err) return console.error('Hashing error:', err);

  db.run(`UPDATE users SET password = ? WHERE username = 'admin'`, [hash], function(err) {
    if (err) return console.error('❌ Update failed:', err.message);
    console.log('✅ Admin password updated to "admin"');
  });
});
