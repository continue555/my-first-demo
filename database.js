const { Pool, types } = require('pg');
const { runMigrations } = require('./migrations/migrate');
// 让 pg 返回时间戳作为字符串，避免 JSON 序列化时转为 UTC
types.setTypeParser(types.builtins.TIMESTAMP, val => val);
types.setTypeParser(types.builtins.TIMESTAMPTZ, val => val);
const bcrypt = require('bcryptjs');

let pool = null;
let db = null;

function convertSQL(sql) {
  return sql
    .replace(/datetime\('now', '\+8 hours'\)/g, "NOW() AT TIME ZONE 'Asia/Shanghai'")
    .replace(/datetime\('now'\)/g, "NOW()")
    .replace(/last_insert_rowid\(\)/g, "LASTVAL()");
}

class PgStatement {
  constructor(pool, sql) {
    this._pool = pool;
    let idx = 0;
    this._sql = convertSQL(sql.replace(/\?/g, () => `$${++idx}`));
  }
  async get(...params) {
    const result = await this._pool.query(this._sql, params);
    return result.rows[0] || null;
  }
  async all(...params) {
    const result = await this._pool.query(this._sql, params);
    return result.rows;
  }
  async run(...params) {
    const isInsert = this._sql.trim().toUpperCase().startsWith("INSERT");
    const sql = isInsert ? this._sql + " RETURNING id" : this._sql;
    const result = await this._pool.query(sql, params);
    return { lastInsertRowid: result.rows[0]?.id || null, changes: result.rowCount };
  }
}

class PgWrapper {
  constructor(pool) { this._pool = pool; }
  prepare(sql) { return new PgStatement(this._pool, sql); }
  async save() { /* PostgreSQL auto-saves */ }
  async exec(sql) {
    const converted = convertSQL(sql);
    for (const stmt of converted.split(';').filter(s => s.trim())) {
      if (stmt.trim()) await this._pool.query(stmt);
    }
  }
}

const TABLE_DEFS = ""; // 已迁移到 migrations/

async function initDatabase() {
  pool = new Pool({
    host: process.env.PG_HOST || '127.0.0.1',
    port: parseInt(process.env.PG_PORT || '5432'),
    database: process.env.PG_DATABASE || 'blowing_machine',
    user: process.env.PG_USER || 'blowing',
    password: process.env.PG_PASSWORD || 'blowing123'
  });
  await pool.query('SELECT 1');
  console.log('[DB] PostgreSQL 连接成功');
  db = new PgWrapper(pool);
  await runMigrations(pool);
  console.log('[DB] 表结构创建完成');
  const deptCount = await db.prepare('SELECT COUNT(*) as cnt FROM departments').get();
  if (parseInt(deptCount.cnt) === 0) await seedData();
  return db;
}

async function seedData() {
  const depts = [[1,'销售部门',null,'负责客户开发、合同签订、订单跟踪'],[2,'生产部门',null,'负责产品制造全流程管理'],[3,'财务部门',null,'负责资金管理、成本核算、收款确认'],[4,'技术部',2,'负责技术方案制定、图纸设计'],[5,'采购部',2,'负责物料采购计划与执行'],[6,'仓库',2,'负责物料入库、存储、配料'],[7,'装配部',2,'负责产品组装'],[8,'调试部',2,'负责产品调试与测试'],[9,'发货部',2,'负责产品发货'],[10,'审批部',null,'负责制造审批'],[11,'模具部',2,'负责模具设计与采购'],[12,'物料跟进部',2,'负责跟进五大件采购到货情况']];
  for (const d of depts) await db.prepare('INSERT INTO departments (id, name, parent_id, description) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING').run(...d);
  const hash = bcrypt.hashSync('123456', 10);
  const users = [[1,'admin',hash,'系统管理员',null,'admin'],[2,'zongjingli',hash,'总经理',null,'management'],[3,'xiaoshou1',hash,'张销售',1,'sales'],[4,'xiaoshou2',hash,'李销售',1,'sales'],[5,'shengchan1',hash,'刘生产主管',2,'production'],[6,'jishu1',hash,'王技术',4,'production'],[7,'caigou1',hash,'赵采购',5,'production'],[8,'cangku1',hash,'钱仓库',6,'production'],[9,'zhuangpei1',hash,'孙装配',7,'production'],[10,'tiaoshi1',hash,'周调试',8,'production'],[11,'caiwu1',hash,'吴财务',3,'finance'],[12,'fahuo1',hash,'发货员',9,'production'],[13,'shenpi1',hash,'审批员',10,'production'],[14,'mujv1',hash,'胡彩静',11,'mold'],[15,'wuliao1',hash,'物料跟进',12,'material_follow']];
  for (const u of users) await db.prepare('INSERT INTO users (id, username, password, name, department_id, role) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (username) DO NOTHING').run(...u);
  console.log('[DB] 种子数据已初始化');
}

function getDb() { return db; }

async function logAudit(userId, username, action, targetType, targetId, detail) {
  if (!db) return;
  await db.prepare('INSERT INTO audit_logs (user_id, username, action, target_type, target_id, detail) VALUES ($1,$2,$3,$4,$5,$6)')
    .run(userId, username, action, targetType, targetId, detail || null);
}

module.exports = { initDatabase, getDb, logAudit };
