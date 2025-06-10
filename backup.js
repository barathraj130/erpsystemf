// backup.js
const fs = require('fs');
const path = require('path');

// --- AFTER (Correct) ---
const dbPath = path.join(__dirname, 'database.sqlite'); // adjust if needed // adjust if needed
const backupFolder = path.join(__dirname, 'backups');

if (!fs.existsSync(backupFolder)) {
  fs.mkdirSync(backupFolder);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupFolder, `erp-backup-${timestamp}.db`);

fs.copyFileSync(dbPath, backupPath);

console.log(`✅ Backup created at: ${backupPath}`);
