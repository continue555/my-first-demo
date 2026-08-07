process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const database = require('../database');
const { register, updateUser } = require('../services/auth-service');

function fakeDb(getHandler) {
  return {
    prepare(sql) {
      return {
        async get(...params) {
          if (getHandler) return getHandler(sql, params);
          return null;
        },
        async all() {
          return [];
        },
        async run() {
          return { changes: 1, lastInsertRowid: 1 };
        }
      };
    }
  };
}

const admin = { id: 1, name: '管理员' };
const { changePassword } = require('../services/auth-service');

test('register rejects missing department', async () => {
  const original = database.getDb;
  database.getDb = () => fakeDb(sql => {
    if (sql.includes('FROM users')) return null;
    if (sql.includes('FROM departments')) return null;
    return null;
  });
  try {
    const r = await register(admin, {
      username: 'no_dept',
      password: '123456',
      name: 'NoDept',
      role: 'sales',
      department_id: 999
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, '部门不存在');
  } finally {
    database.getDb = original;
  }
});

test('updateUser rejects missing department', async () => {
  const original = database.getDb;
  database.getDb = () => fakeDb(sql => {
    if (sql.includes('SELECT * FROM users WHERE id = ?')) {
      return { id: 5, username: 'u', name: 'U', role: 'sales', department_id: 1 };
    }
    if (sql.includes('FROM departments')) return null;
    return null;
  });
  try {
    const r = await updateUser(admin, 5, { department_id: 999 });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, '部门不存在');
  } finally {
    database.getDb = original;
  }
});

test('changePassword returns 404 when user no longer exists', async () => {
  const original = database.getDb;
  database.getDb = () => fakeDb(() => null);
  try {
    const r = await changePassword(999, { oldPassword: '123456', newPassword: '654321' });
    assert.equal(r.status, 404);
  } finally {
    database.getDb = original;
  }
});
