const { chromium, devices } = require('playwright');
const fs = require('fs');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3000';
const results = [];
let failures = 0;
let pageErrors = [];

function track(page) {
  page.on('pageerror', e => pageErrors.push(e.message));
}

async function check(name, fn) {
  try {
    await fn();
    results.push('PASS ' + name);
  } catch (e) {
    failures++;
    results.push('FAIL ' + name + ': ' + e.message);
  }
}

async function login(page, username, password) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.fill('input[type=text]', username);
  await page.fill('input[type=password]', password);
  await page.click('button.btn-primary');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 45000 });
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - window.innerWidth;
  });
  if (overflow > 1) throw new Error('horizontal overflow ' + overflow + 'px');
}

async function assertMobileChrome(page) {
  const info = await page.evaluate(() => {
    const nav = document.querySelector('.mobile-bottom-nav');
    const navRect = nav ? nav.getBoundingClientRect() : null;
    const items = [...document.querySelectorAll('.mb-nav-item')].map(el => el.getBoundingClientRect().height);
    const viewport = document.querySelector('meta[name=viewport]');
    return {
      navVisible: !!nav && navRect.height > 0,
      navBottom: navRect ? navRect.bottom : 0,
      innerHeight: window.innerHeight,
      itemHeights: items,
      viewportFitCover: viewport ? viewport.content.includes('viewport-fit=cover') : false,
      safeAreaSupported: CSS.supports('padding-bottom: env(safe-area-inset-bottom)')
    };
  });
  if (!info.navVisible) throw new Error('bottom nav not visible');
  if (info.navBottom > info.innerHeight + 1) throw new Error('bottom nav extends past viewport');
  if (info.itemHeights.some(h => h < 40)) throw new Error('nav item too short: ' + JSON.stringify(info.itemHeights));
  if (!info.viewportFitCover) throw new Error('viewport-fit=cover missing');
  if (!info.safeAreaSupported) throw new Error('safe-area env not supported');
}

async function runMobileFlow(page, label) {
  await login(page, 'admin', '123456');
  await page.waitForSelector('.mobile-bottom-nav', { timeout: 30000 });
  await assertMobileChrome(page);

  await page.goto(BASE + '/orders', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.order-card', { timeout: 30000 });
  await assertNoHorizontalOverflow(page);

  await page.locator('.order-card').first().locator('button').first().click();
  await page.waitForSelector('.detail-grid', { timeout: 30000 });
  await assertNoHorizontalOverflow(page);
  await page.goBack({ timeout: 30000 });
  await page.waitForSelector('.order-card', { timeout: 30000 });

  await page.goto(BASE + '/notifications', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(800);
  await assertNoHorizontalOverflow(page);

  await page.locator('.mb-nav-item', { hasText: '待办' }).click();
  await page.waitForURL(/\/todos$/, { timeout: 15000 });
  await page.waitForTimeout(800);
  await assertNoHorizontalOverflow(page);
  await page.goto(BASE + '/orders', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.order-card', { timeout: 30000 });

  await page.locator('.mb-nav-item').nth(4).click();
  await page.waitForSelector('.mobile-more-sheet', { timeout: 10000 });
  const count = await page.locator('.mobile-more-item').count();
  if (count !== 5) throw new Error(label + ': expected 5 more items, got ' + count);
}

async function buildXlsxBuffer() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = 'e2e-excel-cell';
  ws.getCell('A2').value = '订单编号';
  return wb.xlsx.writeBuffer();
}

async function buildDocxBuffer() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>e2e-word-cell</w:t></w:r></w:p></w:body></w:document>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function getOrderId(page, orderNo) {
  await page.goto(BASE + '/orders', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('tbody tr', { timeout: 30000 });
  await page.locator('tbody tr', { hasText: orderNo }).locator('button').first().click();
  await page.waitForSelector('.detail-grid', { timeout: 30000 });
  const id = new URL(page.url()).pathname.split('/').pop();
  if (!/^\d+$/.test(id)) throw new Error('cannot resolve order id from url: ' + page.url());
  return id;
}

(async () => {
  const browser = await chromium.launch();

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await desktop.newPage();
  track(page);
  let createResp = null;
  page.on('response', r => {
    if (r.url().split('?')[0].endsWith('/api/orders') && r.request().method() === 'POST') {
      r.text().then(t => { createResp = { status: r.status(), body: t }; }).catch(() => {});
    }
  });

  await check('admin login', async () => {
    await login(page, 'admin', '123456');
    const path = await page.evaluate(() => location.pathname);
    if (path.startsWith('/login')) throw new Error('still on login');
  });

  const orderNo = 'E2E-' + Date.now();
  await check('create order via UI', async () => {
    try {
      await page.goto(BASE + '/orders', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForSelector('.page-header .btn-primary', { timeout: 30000 });
      await page.locator('.page-header .btn-primary').click();
      await page.waitForSelector('.modal', { timeout: 10000 });
      await page.locator('.modal input[type=text]').fill(orderNo);
      await page.locator('.modal input[type=date]').fill('2026-08-30');
      await page.locator('.modal .modal-actions .btn-primary').click();
      await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 }).catch(() => {});
      await page.waitForSelector('.table-wrapper', { timeout: 30000 });
      const row = page.locator('tbody tr', { hasText: orderNo });
      if ((await row.count()) === 0) throw new Error('order row not found');
    } catch (e) {
      const extra = await page.evaluate(() => ({ modal: !!document.querySelector('.modal'), body: (document.body.innerText || '').slice(0, 300) })).catch(() => ({}));
      throw new Error(e.message + ' | api=' + JSON.stringify(createResp) + ' | state=' + JSON.stringify(extra));
    }
  });

  await check('open order detail and back', async () => {
    await page.locator('tbody tr', { hasText: orderNo }).locator('button').first().click();
    await page.waitForSelector('.detail-grid', { timeout: 30000 });
    await page.goBack({ timeout: 30000 });
    await page.waitForSelector('.table-wrapper', { timeout: 30000 });
  });

  await check('orders list shows current stage', async () => {
    await page.goto(BASE + '/orders', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('tbody tr', { timeout: 30000 });
    const row = page.locator('tbody tr', { hasText: orderNo });
    if ((await row.count()) === 0) throw new Error('order row missing');
    const text = await row.innerText();
    if (!text.includes('签订合同')) throw new Error('current stage not shown: ' + text.slice(0, 200));
  });

  await check('todo page shows current node and navigates to detail', async () => {
    await page.goto(BASE + '/todos', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.todo-item', { timeout: 30000 });
    const row = page.locator('.todo-item', { hasText: orderNo });
    if ((await row.count()) === 0) throw new Error('todo row missing');
    const text = await row.innerText();
    if (!text.includes('签订合同')) throw new Error('todo current stage missing: ' + text.slice(0, 200));
    await row.click();
    await page.waitForSelector('.detail-grid', { timeout: 30000 });
    const path = new URL(page.url()).pathname;
    if (!/^\/orders\/\d+$/.test(path)) throw new Error('todo did not navigate to detail: ' + path);
  });

  await check('stage completion requires confirmation', async () => {
    await page.goto(BASE + '/orders', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('tbody tr', { timeout: 30000 });
    await page.locator('tbody tr', { hasText: orderNo }).locator('button').first().click();
    await page.waitForSelector('.detail-grid', { timeout: 30000 });
    const orderId = new URL(page.url()).pathname.split('/').pop();
    await page.evaluate(async id => {
      const csrf = decodeURIComponent((document.cookie.match(/(?:^|; )csrf=([^;]*)/) || [])[1] || '');
      await fetch('/api/orders/' + id + '/stages/contract_sign/time', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ start_date: '2026-08-01', planned_end_date: '2026-08-02' })
      });
    }, orderId);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.detail-grid', { timeout: 30000 });

    const stageItem = page.locator('.stage-item', { hasText: '签订合同' });
    await stageItem.locator('button', { hasText: '开始' }).click();
    await page.waitForFunction(
      () => [...document.querySelectorAll('.stage-item')].some(el =>
        el.textContent.includes('签订合同') && el.textContent.includes('进行中')
      ),
      null,
      { timeout: 15000 }
    );

    await stageItem.locator('button', { hasText: '完成' }).click();
    const confirmModal = page.locator('.modal-overlay .modal', { hasText: '确认完成' });
    await confirmModal.waitFor({ timeout: 10000 });
    await confirmModal.locator('.modal-actions .btn-outline').click();
    await page.waitForSelector('.modal-overlay', { state: 'detached', timeout: 10000 }).catch(() => {});
    const afterCancel = await stageItem.innerText();
    if (!afterCancel.includes('进行中')) throw new Error('stage completed without confirmation');

    await stageItem.locator('button', { hasText: '完成' }).click();
    await confirmModal.waitFor({ timeout: 10000 });
    await confirmModal.locator('.modal-actions .btn-danger').click();
    await page.waitForFunction(() => !document.querySelector('.modal-overlay'), null, { timeout: 10000 });
    await page.waitForFunction(
      () => [...document.querySelectorAll('.stage-item')].some(el =>
        el.textContent.includes('签订合同') && el.textContent.includes('已完成')
      ),
      null,
      { timeout: 15000 }
    );
  });

  await check('overdue badge shown on orders list, detail and todos', async () => {
    const overdueNo = 'E2E-OVERDUE-' + Date.now();
    await page.goto(BASE + '/orders', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.page-header .btn-primary', { timeout: 30000 });
    await page.locator('.page-header .btn-primary').click();
    await page.waitForSelector('.modal', { timeout: 10000 });
    await page.locator('.modal input[type=text]').fill(overdueNo);
    await page.locator('.modal input[type=date]').fill('2026-09-30');
    await page.locator('.modal .modal-actions .btn-primary').click();
    await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 }).catch(() => {});
    await page.waitForSelector('.table-wrapper', { timeout: 30000 });
    const row = page.locator('tbody tr', { hasText: overdueNo });
    if ((await row.count()) === 0) throw new Error('overdue order row missing');
    await row.locator('button').first().click();
    await page.waitForSelector('.detail-grid', { timeout: 30000 });
    const orderId = new URL(page.url()).pathname.split('/').pop();
    if (!/^\d+$/.test(orderId)) throw new Error('cannot resolve order id: ' + page.url());
    await page.evaluate(async id => {
      const csrf = decodeURIComponent((document.cookie.match(/(?:^|; )csrf=([^;]*)/) || [])[1] || '');
      await fetch('/api/orders/' + id + '/stages/contract_sign/time', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ start_date: '2020-01-01', planned_end_date: '2020-01-02' })
      });
    }, orderId);
    await page.goto(BASE + '/orders', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('tbody tr', { timeout: 30000 });
    const overdueRow = page.locator('tbody tr', { hasText: overdueNo });
    if ((await overdueRow.count()) === 0) throw new Error('overdue order row missing');
    if (!(await overdueRow.innerText()).includes('超期')) throw new Error('orders list overdue stamp missing');
    await overdueRow.locator('button').first().click();
    await page.waitForSelector('.detail-grid', { timeout: 30000 });
    if (!(await page.locator('.detail-grid').innerText()).includes('当前节点超期')) {
      throw new Error('detail overdue badge missing');
    }
    await page.goto(BASE + '/todos', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.todo-item', { timeout: 30000 });
    const todo = page.locator('.todo-item', { hasText: overdueNo });
    if ((await todo.count()) === 0) throw new Error('overdue todo missing');
    if (!(await todo.innerText()).includes('超期')) throw new Error('todo overdue stamp missing');
  });

  await check('upload attachment and preview via UI', async () => {
    await page.goto(BASE + '/orders', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.locator('tbody tr', { hasText: orderNo }).locator('button').first().click();
    await page.waitForSelector('.detail-grid', { timeout: 30000 });
    await page.locator('.card-title input[type=file]').setInputFiles({
      name: 'e2e-upload.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('e2e attachment content')
    });
    await page.waitForSelector('.file-item', { timeout: 15000 });
    const item = page.locator('.file-item', { hasText: 'e2e-upload.txt' });
    if ((await item.count()) === 0) throw new Error('uploaded file not listed');
    await item.locator('button', { hasText: '预览' }).click();
    await page.waitForSelector('.doc-preview-modal', { timeout: 15000 });
    await page.waitForFunction(
      () => {
        const body = document.querySelector('.doc-preview-body');
        return body && body.textContent.includes('e2e attachment content');
      },
      null,
      { timeout: 15000 }
    );
    const previewText = await page.locator('.doc-preview-body').innerText();
    if (!previewText.includes('e2e attachment content')) throw new Error('preview content missing');
    await page.locator('.doc-preview-modal .image-preview-header button').click();
    await page.waitForSelector('.doc-preview-modal', { state: 'detached', timeout: 10000 }).catch(() => {});
  });

  await check('excel preview renders in browser', async () => {
    const orderId = await getOrderId(page, orderNo);
    const buffer = Buffer.from(await buildXlsxBuffer());
    await page.locator('.card-title input[type=file]').setInputFiles({
      name: 'e2e.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer
    });
    await page.waitForSelector('.file-item', { timeout: 15000 });
    const item = page.locator('.file-item', { hasText: 'e2e.xlsx' });
    if ((await item.count()) === 0) throw new Error('excel file not listed');
    await item.locator('button', { hasText: '预览' }).click();
    await page.waitForSelector('.doc-preview-modal', { timeout: 15000 });
    await page.waitForFunction(
      () => {
        const body = document.querySelector('.doc-preview-body');
        return body && body.textContent.includes('e2e-excel-cell');
      },
      null,
      { timeout: 20000 }
    );
    await page.locator('.doc-preview-modal .image-preview-header button').click();
    await page.waitForSelector('.doc-preview-modal', { state: 'detached', timeout: 10000 }).catch(() => {});
  });

  await check('word preview renders in browser', async () => {
    const orderId = await getOrderId(page, orderNo);
    const buffer = Buffer.from(await buildDocxBuffer());
    await page.locator('.card-title input[type=file]').setInputFiles({
      name: 'e2e.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer
    });
    await page.waitForSelector('.file-item', { timeout: 15000 });
    const item = page.locator('.file-item', { hasText: 'e2e.docx' });
    if ((await item.count()) === 0) throw new Error('docx file not listed');
    await item.locator('button', { hasText: '预览' }).click();
    await page.waitForSelector('.doc-preview-modal .docx', { timeout: 30000 });
    await page.waitForFunction(
      () => {
        const docx = document.querySelector('.doc-preview-modal .docx');
        return docx && docx.textContent.includes('e2e-word-cell');
      },
      null,
      { timeout: 30000 }
    );
    await page.locator('.doc-preview-modal .image-preview-header button').click();
    await page.waitForSelector('.doc-preview-modal', { state: 'detached', timeout: 10000 }).catch(() => {});
  });

  await check('browser downloads single order export', async () => {
    const orderId = await getOrderId(page, orderNo);
    const url = BASE + '/api/export/order/' + orderId;
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(u => {
      const a = document.createElement('a');
      a.href = u;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, url);
    const download = await downloadPromise;
    const filePath = await download.path();
    if (!filePath) throw new Error('download has no file');
    const buf = fs.readFileSync(filePath);
    if (buf.length < 1000) throw new Error('export file too small: ' + buf.length);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    let text = '';
    for (const ws of wb.worksheets) ws.eachRow(row => row.eachCell(cell => { text += ' ' + cell.text; }));
    if (!text.includes(orderNo) || !text.includes('签订合同')) throw new Error('export content missing');
  });

  await check('create and delete user via UI', async () => {
    const username = 'e2euser_' + Date.now();
    await page.goto(BASE + '/users', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.page-header .btn-primary', { timeout: 30000 });
    await page.locator('.page-header .btn-primary').click();
    await page.waitForSelector('.modal', { timeout: 10000 });
    const modal = page.locator('.modal');
    await modal.locator('input[type=text]').nth(0).fill(username);
    await modal.locator('input[type=password]').fill('123456');
    await modal.locator('input[type=text]').nth(1).fill('E2E 用户');
    await modal.locator('select').nth(0).selectOption('sales');
    await modal.locator('select').nth(1).selectOption('1');
    await modal.locator('.modal-actions .btn-primary').click();
    const row = page.locator('tbody tr', { hasText: username });
    await row.first().waitFor({ timeout: 15000 });
    if ((await row.count()) === 0) throw new Error('user row not found');
    await row.locator('button', { hasText: '删除' }).click();
    await page.waitForSelector('.modal-overlay', { timeout: 10000 });
    await page.locator('.modal-overlay .modal-actions .btn-danger').click();
    await page.waitForFunction(
      u => ![...document.querySelectorAll('tbody tr')].some(r => r.textContent.includes(u)),
      username,
      { timeout: 15000 }
    );
  });

  await check('batch export via UI', async () => {
    await page.goto(BASE + '/orders', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('tbody input[type=checkbox]', { timeout: 30000 });
    const boxes = page.locator('tbody input[type=checkbox]');
    await boxes.nth(0).check();
    if ((await boxes.count()) > 1) await boxes.nth(1).check();
    await page.waitForSelector('.batch-bar', { timeout: 10000 });
    await page.locator('.batch-bar button', { hasText: '批量导出' }).click();
    await page.waitForSelector('.toast-success', { timeout: 45000 });
    const toastText = await page.locator('.toast-success').last().innerText();
    if (!toastText.includes('导出成功')) throw new Error('batch export toast missing: ' + toastText);
  });

  await check('notifications page renders', async () => {
    await page.goto(BASE + '/notifications', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1000);
    if (await page.locator('#app-global-error').count()) throw new Error('error overlay');
  });

  await check('logout works', async () => {
    await page.goto(BASE + '/orders', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.sidebar-footer .logout-btn', { timeout: 10000 });
    await page.locator('.sidebar-footer .logout-btn').last().click();
    await page.waitForFunction(() => location.pathname.startsWith('/login'), null, { timeout: 30000 });
  });
  await desktop.close();

  const mobileMatrix = [
    { name: 'iOS iPhone 13', context: { ...devices['iPhone 13'] } },
    { name: 'iOS iPhone SE', context: { ...devices['iPhone SE (3rd gen)'] } },
    { name: 'Android Pixel 7', context: { ...devices['Pixel 7'] } }
  ];
  for (const entry of mobileMatrix) {
    const mobile = await browser.newContext(entry.context);
    const mp = await mobile.newPage();
    track(mp);
    await check(entry.name + ' flow', () => runMobileFlow(mp, entry.name));
    await mobile.close();
  }

  const wechat = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003123) NetType/WIFI Language/zh_CN',
    isMobile: true,
    hasTouch: true
  });
  const wp = await wechat.newPage();
  track(wp);
  await check('WeChat browser flow', () => runMobileFlow(wp, 'WeChat'));
  await wechat.close();

  const nonAdmin = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const np = await nonAdmin.newPage();
  track(np);
  await check('non-admin blocked from users page', async () => {
    await login(np, 'jishu1', '123456');
    await np.goto(BASE + '/users', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await np.waitForTimeout(1200);
    if (np.url().includes('/users')) throw new Error('non-admin reached /users');
  });
  await nonAdmin.close();

  if (pageErrors.length) {
    failures++;
    results.push('FAIL page errors: ' + pageErrors.join(' | '));
  } else {
    results.push('PASS no page errors');
  }

  console.log(results.join('\n'));
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error('FATAL', e.message);
  process.exit(1);
});
