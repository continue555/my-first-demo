const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getDb, logAudit } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// multer 配置：限制 20MB，只允许常见文档/图片类型
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  }
});


// 文件魔数验证：检查文件头是否匹配声明的 MIME 类型
const MAGIC_BYTES = {
  "image/jpeg": [[0xFF, 0xD8, 0xFF]],
  "image/png": [[0x89, 0x50, 0x4E, 0x47]],
  "image/gif": [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]],
  "image/bmp": [[0x42, 0x4D]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]],
  "application/msword": [[0x50, 0x4B, 0x03, 0x04]],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [[0x50, 0x4B, 0x03, 0x04]],
  "application/vnd.ms-excel": [[0x50, 0x4B, 0x03, 0x04]],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [[0x50, 0x4B, 0x03, 0x04]],
  "application/zip": [[0x50, 0x4B, 0x03, 0x04]],
  "application/x-rar-compressed": [[0x52, 0x61, 0x72, 0x21]],
  "text/plain": []
};

function validateMagicBytes(filePath, mimeType) {
  const magics = MAGIC_BYTES[mimeType];
  if (!magics || magics.length === 0) return true; // 没有定义魔数的类型跳过
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(16);
  fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);
  for (const magic of magics) {
    const matches = magic.every((byte, i) => buf[i] === byte);
    if (matches) return true;
  }
  return false;
}

const ALLOWED_TYPES = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/gif',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip', 'application/x-rar-compressed',
  'text/plain', 'image/bmp', 'image/webp'
];

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型：' + file.mimetype));
    }
  }
});

// 获取订单文件列表
router.get('/orders/:id/files', authMiddleware, async (req, res) => {
  const db = getDb();
  const files = await db.prepare(`
    SELECT f.*, u.name as uploader_name
    FROM order_files f
    LEFT JOIN users u ON f.uploaded_by = u.id
    WHERE f.order_id = ?
    ORDER BY f.created_at DESC
  `).all(req.params.id);
  res.json({ files });
});

// 上传文件
router.post('/orders/:id/files', authMiddleware, async (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: '文件大小不能超过 20MB' });
        }
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: '请选择要上传的文件' });
    }

    // 验证文件头
    if (!validateMagicBytes(req.file.path, req.file.mimetype)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: '文件内容与类型不匹配，请检查文件' });
    }

    const db = getDb();
    const { stage_key } = req.body;

    await db.prepare(`
      INSERT INTO order_files (order_id, original_name, stored_name, mime_type, file_size, uploaded_by, stage_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.user.id, stage_key || null);

    const order = await db.prepare('SELECT order_no FROM orders WHERE id = ?').get(req.params.id);
    await logAudit(req.user.id, req.user.name, '上传附件', 'order', parseInt(req.params.id), `订单: ${order?.order_no}, 文件: ${req.file.originalname}`);

    res.status(201).json({ message: '文件上传成功', filename: req.file.originalname });
  });
});

// 预览文件（内联显示，用于图片缩略图）
router.get('/files/:id/preview', async (req, res) => {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = 'Bearer ' + req.query.token;
  }
  authMiddleware(req, res, async () => {
  const db = getDb();
  const file = await db.prepare('SELECT * FROM order_files WHERE id = ?').get(req.params.id);
  if (!file) {
    return res.status(404).json({ error: '文件不存在' });
  }
  if (req.user.role !== 'admin' && req.user.role !== 'management' && file.uploaded_by !== req.user.id) {
    return res.status(403).json({ error: '无权访问此文件' });
  }

  const filePath = path.join(UPLOAD_DIR, file.stored_name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '文件已丢失' });
  }

  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(filePath);
  });
});

// 下载文件
router.get('/files/:id/download', async (req, res) => {
  // 支持 Authorization header 和 ?token= 两种方式
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = 'Bearer ' + req.query.token;
  }
  authMiddleware(req, res, async () => {
  const db = getDb();
  const file = await db.prepare('SELECT * FROM order_files WHERE id = ?').get(req.params.id);
  if (!file) {
    return res.status(404).json({ error: '文件不存在' });
  }
  if (req.user.role !== 'admin' && req.user.role !== 'management' && file.uploaded_by !== req.user.id) {
    return res.status(403).json({ error: '无权访问此文件' });
  }

  const filePath = path.join(UPLOAD_DIR, file.stored_name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '文件已丢失' });
  }

  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
  res.sendFile(filePath);
  });
});

// 删除文件
router.delete('/files/:id', authMiddleware, async (req, res) => {
  const db = getDb();
  const file = await db.prepare('SELECT * FROM order_files WHERE id = ?').get(req.params.id);
  if (!file) {
    return res.status(404).json({ error: '文件不存在' });
  }
  if (req.user.role !== 'admin' && req.user.role !== 'management' && file.uploaded_by !== req.user.id) {
    return res.status(403).json({ error: '无权访问此文件' });
  }

  // 权限：上传者自己、管理员、总经理可以删除
  if (file.uploaded_by !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'management') {
    return res.status(403).json({ error: '无权删除此文件' });
  }

  const filePath = path.join(UPLOAD_DIR, file.stored_name);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  await db.prepare('DELETE FROM order_files WHERE id = ?').run(req.params.id);

  const order = await db.prepare('SELECT order_no FROM orders WHERE id = ?').get(file.order_id);
  await logAudit(req.user.id, req.user.name, '删除附件', 'order', file.order_id, `订单: ${order?.order_no}, 文件: ${file.original_name}`);

  res.json({ message: '文件已删除' });
});

module.exports = router;
