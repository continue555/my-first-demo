<template>
  <div class="login-page">
    <!-- 修改密码模式 -->
    <div v-if="isChangePwd" class="login-card">
      <h1>修改密码</h1>
      <p class="subtitle">{{ auth.user?.name }} ({{ auth.user?.username }})</p>
      <div class="form-group">
        <label>原密码</label>
        <input v-model="oldPwd" type="password" placeholder="请输入原密码" @keydown.enter="doChangePwd">
      </div>
      <div class="form-group">
        <label>新密码</label>
        <input v-model="newPwd" type="password" placeholder="请输入新密码" @keydown.enter="doChangePwd">
      </div>
      <div v-if="error" style="color:#ef4444;font-size:13px;margin-bottom:16px;">{{ error }}</div>
      <div v-if="success" style="color:#16a34a;font-size:13px;margin-bottom:16px;">{{ success }}</div>
      <button class="btn btn-primary btn-block" :disabled="loading" @click="doChangePwd">
        {{ loading ? '修改中...' : '确认修改' }}
      </button>
      <button class="btn btn-outline btn-block" style="margin-top:12px;" @click="router.push('/')">返回</button>
    </div>

    <!-- 登录模式 -->
    <div v-else class="login-card">
      <h1>吹瓶机管理系统</h1>
      <p class="subtitle">Bottle Blowing Machine Management System</p>
      <div class="form-group">
        <label>用户名</label>
        <input v-model="username" type="text" placeholder="请输入用户名" autocomplete="username" @keydown.enter="doLogin">
      </div>
      <div class="form-group">
        <label>密码</label>
        <input v-model="password" type="password" placeholder="请输入密码" autocomplete="current-password" @keydown.enter="doLogin">
      </div>
      <div v-if="error" style="color:#ef4444;font-size:13px;margin-bottom:16px;">{{ error }}</div>
      <button class="btn btn-primary btn-block" :disabled="loading" @click="doLogin">
        {{ loading ? '登录中...' : '登 录' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api';

const username = ref('');
const password = ref('');
const oldPwd = ref('');
const newPwd = ref('');
const error = ref('');
const success = ref('');
const loading = ref(false);
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const isChangePwd = computed(() => route.query.changePassword === '1');

async function doLogin() {
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    await auth.login(username.value.trim(), password.value);
    router.push(auth.canViewDashboard ? '/' : '/orders');
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function doChangePwd() {
  if (!oldPwd.value || !newPwd.value) {
    error.value = '请填写原密码和新密码';
    return;
  }
  if (newPwd.value.length < 6) {
    error.value = '新密码长度不能少于6位';
    return;
  }
  loading.value = true;
  error.value = '';
  success.value = '';
  try {
    await api.put('/auth/change-password', { oldPassword: oldPwd.value, newPassword: newPwd.value });
    success.value = '密码修改成功，请重新登录';
    setTimeout(() => { auth.logout(); router.push('/login'); }, 2000);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #1e3a5f 0%, #1a73e8 50%, #0d9488 100%);
}
.login-card {
  background: #fff; padding: 40px; border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  width: 400px; max-width: 90vw;
}
.login-card h1 { font-size: 24px; text-align: center; color: #1e3a5f; margin-bottom: 8px; }
.subtitle { text-align: center; color: #6b7280; margin-bottom: 32px; font-size: 14px; }
.form-group { margin-bottom: 20px; }
.form-group label { display: block; margin-bottom: 6px; font-weight: 500; font-size: 14px; }
.form-group input {
  width: 100%; padding: 10px 14px; border: 1px solid #e5e7eb;
  border-radius: 8px; font-size: 14px; transition: border-color 0.2s;
}
.form-group input:focus { outline: none; border-color: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,0.1); }
.btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 6px; padding: 10px 20px; border: none; border-radius: 8px;
  font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s;
}
.btn-primary { background: #1a73e8; color: #fff; }
.btn-primary:hover { background: #1557b0; }
.btn-block { width: 100%; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
