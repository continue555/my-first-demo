const { parseCookies } = require('../lib/cookies');

function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/auth/login' || req.path === '/auth/logout') return next();
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) return next();

  const cookieToken = parseCookies(req.headers.cookie).csrf;
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'CSRF token invalid' });
  }
  next();
}

module.exports = { csrfProtection };
