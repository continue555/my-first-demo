const test = require('node:test');
const assert = require('node:assert');
const { sendBusinessWebhook } = require('../lib/webhook');

test('webhook skips when url not configured', async () => {
  const original = process.env.BIZ_WEBHOOK_URL;
  delete process.env.BIZ_WEBHOOK_URL;
  const origFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called++; return { ok: true }; };
  try {
    assert.equal(await sendBusinessWebhook('hello'), false);
    assert.equal(called, 0);
  } finally {
    if (original === undefined) delete process.env.BIZ_WEBHOOK_URL;
    else process.env.BIZ_WEBHOOK_URL = original;
    globalThis.fetch = origFetch;
  }
});

test('webhook posts text payload when configured', async () => {
  const original = process.env.BIZ_WEBHOOK_URL;
  process.env.BIZ_WEBHOOK_URL = 'https://example.test/hook';
  const origFetch = globalThis.fetch;
  let body = null;
  globalThis.fetch = async (url, opts) => { body = { url, opts }; return { ok: true, status: 200 }; };
  try {
    assert.equal(await sendBusinessWebhook('订单超期提醒'), true);
    assert.equal(body.url, 'https://example.test/hook');
    const parsed = JSON.parse(body.opts.body);
    assert.equal(parsed.msgtype, 'text');
    assert.equal(parsed.text.content, '订单超期提醒');
  } finally {
    if (original === undefined) delete process.env.BIZ_WEBHOOK_URL;
    else process.env.BIZ_WEBHOOK_URL = original;
    globalThis.fetch = origFetch;
  }
});

test('webhook failure returns false', async () => {
  const original = process.env.BIZ_WEBHOOK_URL;
  process.env.BIZ_WEBHOOK_URL = 'https://example.test/hook';
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    assert.equal(await sendBusinessWebhook('hello'), false);
  } finally {
    if (original === undefined) delete process.env.BIZ_WEBHOOK_URL;
    else process.env.BIZ_WEBHOOK_URL = original;
    globalThis.fetch = origFetch;
  }
});
