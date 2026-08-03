function canAccessFile(user, file) {
  if (!user) return false;
  return user.role === 'admin' || user.role === 'management' || (file && file.uploaded_by === user.id);
}

function canDeleteFile(user) {
  return !!(user && (user.role === 'admin' || user.role === 'management'));
}

module.exports = { canAccessFile, canDeleteFile };
