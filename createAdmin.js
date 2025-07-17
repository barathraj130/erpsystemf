const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const db = new sqlite3.Database('./database.sqlite');

bcrypt.hash('admin', 10, (err, hash) => {
  db.run(`INSERT INTO users (username, password, role, email, active_company_id) VALUES (?, ?, ?, ?, ?)`,
    ['admin', hash, 'admin', 'admin@example.com', 1], (err) => {
      if (err) console.error(err.message);
      else console.log('✅ Admin user inserted.');
  });
});

