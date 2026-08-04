require('dotenv').config();
const { initDatabase } = require('../database');
const { checkOverdue } = require('../services/notifications-service');

(async () => {
  await initDatabase();
  const result = await checkOverdue();
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', ...result.body }));
  process.exit(0);
})().catch(e => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', message: e.message, stack: e.stack }));
  process.exit(1);
});
