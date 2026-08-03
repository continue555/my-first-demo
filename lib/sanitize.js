module.exports = function sanitize(str) {
  if (!str) return "";
  return String(str).replace(/[<>"']/g, '').slice(0, 200);
};
