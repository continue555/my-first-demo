const fs = require("fs");
const path = require("path");

// 确保 schema_version 表存在
const CREATE_VERSION_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Shanghai')
  );
`;

async function runMigrations(pool) {
  // 创建版本表
  await pool.query(CREATE_VERSION_TABLE);

  // 获取已应用的迁移
  const result = await pool.query("SELECT version FROM schema_version ORDER BY version");
  const applied = new Set(result.rows.map(r => r.version));

  // 扫描迁移文件
  const migrationsDir = path.join(__dirname, "..", "migrations");
  if (!fs.existsSync(migrationsDir)) {
    console.log("[迁移] 无迁移目录，跳过");
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    // 从文件名提取版本号：001_init.sql -> 1
    const match = file.match(/^(\d+)_/);
    if (!match) continue;
    const version = parseInt(match[1]);

    if (applied.has(version)) {
      console.log(`[迁移] ${file} 已应用，跳过`);
      continue;
    }

    // 读取并执行 SQL
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`[迁移] 执行 ${file}...`);

    await pool.query(sql);

    // 记录已应用
    await pool.query(
      "INSERT INTO schema_version (version, name) VALUES ($1, $2)",
      [version, file]
    );
    console.log(`[迁移] ${file} 完成`);
  }

  console.log("[迁移] 全部完成");
}

module.exports = { runMigrations };
