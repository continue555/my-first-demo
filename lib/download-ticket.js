const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const tickets = new Map();
const TTL = 10 * 60 * 1000;
const TICKETS_FILE = path.join(__dirname, '..', 'uploads', 'download-tickets.json');

function saveTickets() {
  try {
    const dir = path.dirname(TICKETS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = [...tickets.entries()].map(([token, t]) => ({ token, ...t }));
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[Tickets] 保存失败:', e.message);
  }
}

function loadTickets() {
  try {
    if (!fs.existsSync(TICKETS_FILE)) return;
    const list = JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf8'));
    const now = Date.now();
    for (const item of list) {
      if (item.token && item.expires && item.expires > now) {
        tickets.set(item.token, { fileId: item.fileId, userId: item.userId, expires: item.expires });
      }
    }
  } catch (e) {
    console.error('[Tickets] 恢复失败:', e.message);
  }
}

function createDownloadTicket(fileId, userId) {
  const token = crypto.randomBytes(16).toString('hex');
  tickets.set(token, { fileId, userId, expires: Date.now() + TTL });
  saveTickets();
  return token;
}

function verifyDownloadTicket(token) {
  const ticket = tickets.get(token);
  if (!ticket) return null;
  if (Date.now() > ticket.expires) {
    tickets.delete(token);
    saveTickets();
    return null;
  }
  return ticket;
}

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [token, ticket] of tickets) {
    if (now > ticket.expires) {
      tickets.delete(token);
      changed = true;
    }
  }
  if (changed) saveTickets();
}, 5 * 60 * 1000);

loadTickets();

module.exports = { createDownloadTicket, verifyDownloadTicket };
