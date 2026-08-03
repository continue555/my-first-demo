const crypto = require('crypto');

const tickets = new Map();
const TTL = 10 * 60 * 1000;

function createDownloadTicket(fileId, userId) {
  const token = crypto.randomBytes(16).toString('hex');
  tickets.set(token, { fileId, userId, expires: Date.now() + TTL });
  return token;
}

function verifyDownloadTicket(token) {
  const ticket = tickets.get(token);
  if (!ticket) return null;
  if (Date.now() > ticket.expires) {
    tickets.delete(token);
    return null;
  }
  return ticket;
}

setInterval(() => {
  const now = Date.now();
  for (const [token, ticket] of tickets) {
    if (now > ticket.expires) tickets.delete(token);
  }
}, 5 * 60 * 1000);

module.exports = { createDownloadTicket, verifyDownloadTicket };
