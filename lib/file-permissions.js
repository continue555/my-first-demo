function canDeleteFile(user) {
  return !!(user && (user.role === 'admin' || user.role === 'management'));
}

module.exports = { canDeleteFile };
