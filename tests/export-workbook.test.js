const test = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const { buildSingleOrderWorkbook } = require('../services/export-service');

test('single order workbook contains order, stages and attachments', async () => {
  const order = {
    order_no: 'ORD-2026-0001', customer_name: '客户甲', project_name: '项目乙',
    product_model: 'CM-01', quantity: 2, contract_amount: 100000,
    planned_delivery_date: '2026-08-01', actual_delivery_date: null,
    status: 'pending', creator_name: '管理员', created_at: '2026-08-01T09:00:00', notes: '备注内容'
  };
  const stages = [
    { stage_order: 1, stage_name: '签订合同', status: 'completed', start_date: '2026-08-01T09:00', planned_end_date: '2026-08-02T09:00', actual_end_date: '2026-08-01T18:00', operator_name: '张销售', notes: null },
    { stage_order: 2, stage_name: '财务确认定金', status: 'pending', start_date: null, planned_end_date: null, actual_end_date: null, operator_name: null, notes: null }
  ];
  const files = [
    { id: 7, original_name: '合同.pdf', mime_type: 'application/pdf', file_size: 1024, uploader_name: '管理员', created_at: '2026-08-01T10:00:00' }
  ];

  const wb = await buildSingleOrderWorkbook(order, stages, files, 'http://example.com', 1);
  const buf = await wb.xlsx.writeBuffer();
  const parsed = new ExcelJS.Workbook();
  await parsed.xlsx.load(buf);

  assert.deepEqual(parsed.worksheets.map(w => w.name), ['订单概要', '流程明细', '文件附件']);

  let text = '';
  let hasDownloadLink = false;
  for (const ws of parsed.worksheets) {
    ws.eachRow(row => row.eachCell(cell => {
      text += ' ' + cell.text;
      if (cell.value && typeof cell.value === 'object' && cell.value.hyperlink) {
        if (String(cell.value.hyperlink).includes('/api/files/7/download?ticket=')) hasDownloadLink = true;
      }
    }));
  }

  assert.ok(text.includes('ORD-2026-0001'));
  assert.ok(text.includes('签订合同'));
  assert.ok(text.includes('财务确认定金'));
  assert.ok(text.includes('合同.pdf'));
  assert.ok(hasDownloadLink);
});
