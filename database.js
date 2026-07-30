const { Pool } = require('pg');
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

const TABLE_DEFS = `
  CREATE TABLE IF NOT EXISTS departments (id SERIAL PRIMARY KEY, name TEXT NOT NULL, parent_id INTEGER DEFAULT NULL REFERENCES departments(id), description TEXT);
  CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, name TEXT NOT NULL, department_id INTEGER REFERENCES departments(id), role TEXT NOT NULL, created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Shanghai'));
  CREATE TABLE IF NOT EXISTS orders (id SERIAL PRIMARY KEY, order_no TEXT UNIQUE NOT NULL, customer_name TEXT NOT NULL, project_name TEXT NOT NULL, product_model TEXT, quantity INTEGER DEFAULT 1, contract_amount REAL, planned_delivery_date TEXT, actual_delivery_date TEXT, status TEXT DEFAULT 'pending', notes TEXT, created_by INTEGER REFERENCES users(id), created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Shanghai'), updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Shanghai'));
  CREATE TABLE IF NOT EXISTS process_stages (id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, stage_key TEXT NOT NULL, stage_name TEXT NOT NULL, stage_order INTEGER NOT NULL, parent_stage_key TEXT, department_id INTEGER REFERENCES departments(id), depends_on TEXT, start_date TEXT, planned_end_date TEXT, actual_end_date TEXT, status TEXT DEFAULT 'pending', operator_id INTEGER, operator_name TEXT, notes TEXT, created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Shanghai'), updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Shanghai'));
  CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE, message TEXT NOT NULL, recipient_dept_id INTEGER, is_read INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Shanghai'));
  CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, user_id INTEGER, username TEXT, action TEXT NOT NULL, target_type TEXT, target_id INTEGER, detail TEXT, created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Shanghai'));
  CREATE TABLE IF NOT EXISTS order_files (id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, original_name TEXT NOT NULL, stored_name TEXT NOT NULL, mime_type TEXT, file_size INTEGER, uploaded_by INTEGER, stage_key TEXT, created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Shanghai'));
`;

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
  await db.exec(TABLE_DEFS);
  console.log('[DB] 表结构创建完成');
  const deptCount = await db.prepare('SELECT COUNT(*) as cnt FROM departments').get();
  if (parseInt(deptCount.cnt) === 0) await seedData();
  return db;
}

async function seedData() {
  const depts = [[1,'销售部门',null,'负责客户开发、合同签订、订单跟踪'],[2,'生产部门',null,'负责产品制造全流程管理'],[3,'财务部门',null,'负责资金管理、成本核算、收款确认'],[4,'技术部',2,'负责技术方案制定、图纸设计'],[5,'采购部',2,'负责物料采购计划与执行'],[6,'仓库',2,'负责物料入库、存储、配料'],[7,'装配部',2,'负责产品组装'],[8,'调试部',2,'负责产品调试与测试']];
  for (const d of depts) await db.prepare('INSERT INTO departments (id, name, parent_id, description) VALUES ($1,$2,$3,$4)').run(...d);
  const hash = bcrypt.hashSync('123456', 10);
  const users = [[1,'admin',hash,'系统管理员',null,'admin'],[2,'zongjingli',hash,'总经理',null,'management'],[3,'xiaoshou1',hash,'张销售',1,'sales'],[4,'xiaoshou2',hash,'李销售',1,'sales'],[5,'shengchan1',hash,'刘生产主管',2,'production'],[6,'jishu1',hash,'王技术',4,'production'],[7,'caigou1',hash,'赵采购',5,'production'],[8,'cangku1',hash,'钱仓库',6,'production'],[9,'zhuangpei1',hash,'孙装配',7,'production'],[10,'tiaoshi1',hash,'周调试',8,'production'],[11,'caiwu1',hash,'吴财务',3,'finance']];
  for (const u of users) await db.prepare('INSERT INTO users (id, username, password, name, department_id, role) VALUES ($1,$2,$3,$4,$5,$6)').run(...u);
  console.log('[DB] 种子数据已初始化');
}

function getDb() { return db; }

async function logAudit(userId, username, action, targetType, targetId, detail) {
  if (!db) return;
  await db.prepare('INSERT INTO audit_logs (user_id, username, action, target_type, target_id, detail) VALUES ($1,$2,$3,$4,$5,$6)')
    .run(userId, username, action, targetType, targetId, detail || null);
}

module.exports = { initDatabase, getDb, logAudit };