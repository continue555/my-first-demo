function parseCookies(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) {
      const key = part.slice(0, index).trim();
      try {
        result[key] = decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        // 畸形百分号编码直接丢弃该 Cookie，避免抛异常
      }
    }
  }
  return result;
}

module.exports = { parseCookies };
