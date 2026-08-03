const ExcelJS = require('exceljs');

const BASE = process.env.BASE || 'http://localhost:3000';
let token = '';

async function login() {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' })
  });
  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  for (const c of cookies) {
    const m = c.match(/token=([^;]+)/);
    if (m) token = decodeURIComponent(m[1]);
  }
  if (!token) throw new Error('login failed');
}

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text.slice(0, 120); }
  return { status: res.status, body: json };
}

async function main() {
  await login();
  const createdIds = [];

  console.log('=== 并发同编号创建 ===');
  const raceNo = 'RACE-' + Date.now();
  const results = await Promise.all(
    Array.from({ length: 10 }, () => req('POST', '/api/orders', {
      order_no: raceNo, customer_name: 'Race', project_name: 'Race', planned_delivery_date: '2026-08-10'
    }))
  );
  const statusCounts = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  console.log('status counts:', JSON.stringify(statusCounts));
  if (statusCounts[500]) throw new Error('concurrent duplicate order produced 500');
  if (statusCounts[201] !== 1) throw new Error('expected exactly one created order');

  const created = results.find(r => r.status === 201);
  if (created.body.orderId) createdIds.push(created.body.orderId);

  console.log('=== 并发阶段推进 ===');
  const stageOrder = await req('POST', '/api/orders', {
    order_no: 'STAGE-' + Date.now(),
    customer_name: 'Stage', project_name: 'Stage', planned_delivery_date: '2026-08-10'
  });
  if (stageOrder.status !== 201 || !stageOrder.body.orderId) throw new Error('stage order create failed');
  const soid = stageOrder.body.orderId;
  createdIds.push(soid);
  await req('PUT', `/api/orders/${soid}/stages/contract_sign/time`, { start_date: '2026-08-01T09:00', planned_end_date: '2026-08-02T09:00' });
  const starts = await Promise.all(Array.from({ length: 5 }, () => req('PUT', `/api/orders/${soid}/stages/contract_sign`, { status: 'in_progress' })));
  if (starts.some(r => r.status === 500)) throw new Error('concurrent stage start produced 500');
  await req('PUT', `/api/orders/${soid}/stages/contract_sign`, { status: 'completed' });
  const comps = await Promise.all(Array.from({ length: 5 }, () => req('PUT', `/api/orders/${soid}/stages/contract_sign`, { status: 'completed' })));
  if (comps.some(r => r.status === 500)) throw new Error('concurrent stage complete produced 500');
  const stageDetail = await req('GET', `/api/orders/${soid}`);
  const stage = (stageDetail.body.stages || []).find(s => s.stage_key === 'contract_sign');
  console.log('concurrent stage final status:', stage && stage.status);
  if (!stage || stage.status !== 'completed') throw new Error('stage final status not completed');

  console.log('=== 批量导出 50 单 ===');
  for (let i = 0; i < 50; i++) {
    const r = await req('POST', '/api/orders', {
      order_no: 'STRESS-' + Date.now() + '-' + i,
      customer_name: 'Stress', project_name: 'Stress', planned_delivery_date: '2026-08-10'
    });
    if (r.status !== 201 || !r.body.orderId) throw new Error('stress order create failed: ' + r.status);
    createdIds.push(r.body.orderId);
  }

  const job = await req('POST', '/api/export/jobs', { ids: createdIds.slice(0, 50) });
  if (job.status !== 202 || !job.body.jobId) throw new Error('job create failed');
  let done = false;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    const st = await req('GET', '/api/export/jobs/' + job.body.jobId);
    if (st.body.status === 'done') { done = true; break; }
    if (st.body.status === 'error') throw new Error('job error: ' + (st.body.error || ''));
  }
  if (!done) throw new Error('job timeout');

  const dl = await fetch(BASE + '/api/export/jobs/' + job.body.jobId + '/download', {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (dl.status !== 200) throw new Error('download failed');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await dl.arrayBuffer()));
  const sheet = wb.worksheets[0];
  console.log('export order rows:', sheet.rowCount);
  if (sheet.rowCount < 51) throw new Error('export row count too small');

  for (const id of createdIds) {
    await req('DELETE', '/api/orders/' + id).catch(() => {});
  }
  console.log('cleaned orders:', createdIds.length);
  console.log('=== STRESS OK ===');
}

main().catch(e => { console.error('STRESS FAIL:', e.message); process.exit(1); });
