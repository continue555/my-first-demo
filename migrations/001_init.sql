-- 001_init.sql
-- 初始数据库表结构

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER DEFAULT NULL REFERENCES departments(id),
  description TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id),
  role TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Shanghai')
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_no TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  project_name TEXT NOT NULL,
  product_model TEXT,
  quantity INTEGER DEFAULT 1,
  contract_amount REAL,
  planned_delivery_date TEXT,
  actual_delivery_date TEXT,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Shanghai'),
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Shanghai')
);

CREATE TABLE IF NOT EXISTS process_stages (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  stage_name TEXT NOT NULL,
  stage_order INTEGER NOT NULL,
  parent_stage_key TEXT,
  department_id INTEGER REFERENCES departments(id),
  depends_on TEXT,
  start_date TEXT,
  planned_end_date TEXT,
  actual_end_date TEXT,
  status TEXT DEFAULT 'pending',
  operator_id INTEGER,
  operator_name TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Shanghai'),
  updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Shanghai')
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  recipient_dept_id INTEGER,
  is_read INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Shanghai')
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  detail TEXT,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Shanghai')
);

CREATE TABLE IF NOT EXISTS order_files (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  uploaded_by INTEGER,
  stage_key TEXT,
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Asia/Shanghai')
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_process_stages_order ON process_stages(order_id);
CREATE INDEX IF NOT EXISTS idx_notifications_dept ON notifications(recipient_dept_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_order_files_order ON order_files(order_id);
