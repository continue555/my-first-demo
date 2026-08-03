function parseCookies(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) {
      const key = part.slice(0, index).trim();
      result[key] = decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return result;
}

module.exports = { parseCookies };
