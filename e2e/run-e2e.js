const { chromium, devices } = require('playwright');

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

(async () => {
  const browser = await chromium.launch();

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await desktop.newPage();
  track(page);
  let createResp = null;
  page.on('response', r => {
    if (r.url().includes('/api/orders') && r.request().method() === 'POST') {
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

  const mobile = await browser.newContext({ ...devices['iPhone 13'] });
  const mp = await mobile.newPage();
  track(mp);
  await check('mobile login and bottom nav', async () => {
    await login(mp, 'admin', '123456');
    await mp.waitForSelector('.mobile-bottom-nav', { timeout: 30000 });
    await mp.goto(BASE + '/orders', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await mp.waitForSelector('.order-card', { timeout: 30000 });
  });
  await check('mobile more menu', async () => {
    await mp.locator('.mb-nav-item').nth(3).click();
    await mp.waitForSelector('.mobile-more-sheet', { timeout: 10000 });
    const count = await mp.locator('.mobile-more-item').count();
    if (count !== 5) throw new Error('expected 5 more items, got ' + count);
  });
  await check('mobile order detail and back', async () => {
    await mp.goto(BASE + '/orders', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await mp.waitForSelector('.order-card', { timeout: 30000 });
    await mp.locator('.order-card').first().locator('button').first().click();
    await mp.waitForSelector('.detail-grid', { timeout: 30000 });
    await mp.goBack({ timeout: 30000 });
    await mp.waitForSelector('.order-card', { timeout: 30000 });
  });
  await mobile.close();

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
