const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { verifyDownloadTicket } = require('../lib/download-ticket');
const filesService = require('../services/files-service');

const router = express.Router();

// multer 配置：限制 20MB，只允许常见文档/图片类型
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, filesService.UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  }
});

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

router.get('/orders/:id/files', authMiddleware, async (req, res) => {
  const result = await filesService.listOrderFiles(req.params.id);
  res.status(result.status).json(result.body);
});

router.get('/files/:id/ticket', authMiddleware, async (req, res) => {
  const result = await filesService.createPreviewTicket(req.params.id, req.user.id);
  res.status(result.status).json(result.body);
});

router.post('/orders/:id/files', authMiddleware, requireRole('admin', 'management', 'sales'), async (req, res) => {
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

    const result = await filesService.saveUploadedFile({
      orderId: req.params.id,
      user: req.user,
      file: req.file,
      stageKey: req.body.stage_key
    });
    res.status(result.status).json(result.body);
  });
});

function serveFile(res, file, filePath, inline) {
  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', inline ? 'inline' : `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(filePath);
}

async function serveFileById(req, res, inline) {
  const result = await filesService.resolveFile(req.params.id);
  if (result.status !== 200) {
    return res.status(result.status).json(result.body);
  }
  serveFile(res, result.file, result.filePath, inline);
}

router.get('/files/:id/preview', async (req, res) => {
  if (req.query.ticket) {
    const info = verifyDownloadTicket(req.query.ticket);
    if (!info || info.fileId !== parseInt(req.params.id)) {
      return res.status(403).json({ error: '下载链接无效或已过期' });
    }
    return serveFileById(req, res, true);
  }
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = 'Bearer ' + req.query.token;
  }
  authMiddleware(req, res, async () => serveFileById(req, res, true));
});

router.get('/files/:id/download', async (req, res) => {
  if (req.query.ticket) {
    const info = verifyDownloadTicket(req.query.ticket);
    if (!info || info.fileId !== parseInt(req.params.id)) {
      return res.status(403).json({ error: '下载链接无效或已过期' });
    }
    return serveFileById(req, res, false);
  }
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = 'Bearer ' + req.query.token;
  }
  authMiddleware(req, res, async () => serveFileById(req, res, false));
});

router.delete('/files/:id', authMiddleware, async (req, res) => {
  const result = await filesService.deleteFile(req.user, req.params.id);
  res.status(result.status).json(result.body);
});

module.exports = router;
