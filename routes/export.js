const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const exportService = require('../services/export-service');

const router = express.Router();

function getDownloadBase(req) {
  return req.protocol + '://' + req.get('host');
}

function sendXlsx(res, xlsx) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${xlsx.filename}`);
  res.send(xlsx.buffer);
}

// 批量导出（全部/按状态）
router.get('/orders', authMiddleware, requireRole('admin', 'management'), async (req, res) => {
  const result = await exportService.runListExport({
    query: req.query,
    downloadBase: getDownloadBase(req),
    userId: req.user.id
  });
  if (result.xlsx) return sendXlsx(res, result.xlsx);
  res.status(result.status).json(result.body);
});

// 批量导出（按ID选择）
router.get('/orders/batch', authMiddleware, requireRole('admin', 'management'), async (req, res) => {
  const result = await exportService.runBatchExport({
    ids: req.query.ids,
    downloadBase: getDownloadBase(req),
    userId: req.user.id
  });
  if (result.xlsx) return sendXlsx(res, result.xlsx);
  res.status(result.status).json(result.body);
});

router.post('/jobs', authMiddleware, requireRole('admin', 'management'), async (req, res) => {
  const result = await exportService.createExportJob({
    user: req.user,
    body: req.body,
    downloadBase: getDownloadBase(req)
  });
  res.status(result.status).json(result.body);
});

router.get('/jobs/:id', authMiddleware, requireRole('admin', 'management'), async (req, res) => {
  const result = await exportService.getExportJob(req.params.id);
  res.status(result.status).json(result.body);
});

router.get('/jobs/:id/download', authMiddleware, requireRole('admin', 'management'), async (req, res) => {
  const result = await exportService.getExportJobDownload(req.params.id);
  if (result.status !== 200) return res.status(result.status).json(result.body);
  res.download(result.filePath);
});

// 单个订单导出
router.get('/order/:id', authMiddleware, requireRole('admin', 'management'), async (req, res) => {
  const result = await exportService.runSingleOrderExport({
    id: req.params.id,
    downloadBase: getDownloadBase(req),
    userId: req.user.id
  });
  if (result.xlsx) return sendXlsx(res, result.xlsx);
  res.status(result.status).json(result.body);
});

module.exports = { router };
