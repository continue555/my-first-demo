const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data.db');
const BACKUP_DIR = path.join(__dirname, 'backups');
const MAX_BACKUPS = 7;

function backup() {
  if (!fs.existsSync(DB_FILE)) {
    console.log('数据文件不存在，跳过备份');
    return;
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const backupFile = path.join(BACKUP_DIR, `data_${date}.db`);
  fs.copyFileSync(DB_FILE, backupFile);
  console.log(`备份完成: ${backupFile}`);

  // 清理7天前的备份
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('data_') && f.endsWith('.db'))
    .sort()
    .reverse();

  while (files.length > MAX_BACKUPS) {
    const old = files.pop();
    fs.unlinkSync(path.join(BACKUP_DIR, old));
    console.log(`清理旧备份: ${old}`);
  }
}

backup();