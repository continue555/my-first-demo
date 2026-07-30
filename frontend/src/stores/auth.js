import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '@/api';

export const useAuthStore = defineStore('auth', () => {
  const token = ref(sessionStorage.getItem('token') || '');
  const user = ref(null);

  try {
    const saved = sessionStorage.getItem('user');
    if (saved) user.value = JSON.parse(saved);
  } catch { /* ignore */ }

  const isLoggedIn = computed(() => !!token.value && !!user.value);
  const isAdmin = computed(() => user.value?.role === 'admin');
  const isManagement = computed(() => user.value?.role === 'management');
  const isSales = computed(() => user.value?.role === 'sales');
  const isFinance = computed(() => user.value?.role === 'finance');
  const isProduction = computed(() => user.value?.role === 'production');

  const canViewDashboard = computed(() => {
    return ['admin', 'management', 'sales', 'finance'].includes(user.value?.role);
  });

  const canManageOrders = computed(() => {
    return ['admin', 'management', 'sales'].includes(user.value?.role);
  });

  const canDeleteOrder = computed(() => {
    return ['admin', 'management', 'sales'].includes(user.value?.role);
  });

  async function login(username, password) {
    const data = await api.post('/auth/login', { username, password });
    token.value = data.token;
    user.value = data.user;
    sessionStorage.setItem('token', data.token);
    sessionStorage.setItem('user', JSON.stringify(data.user));
  }

  function logout() {
    token.value = '';
    user.value = null;
    sessionStorage.clear();
  }

  function canOperateStage(stage) {
    if (!user.value) return false;
    const role = user.value.role;
    if (role === 'admin' || role === 'management') return true;
    const deptId = stage.department_id;
    if (!deptId) return false;
    if (role === 'sales' && deptId === 1) return true;
    if (role === 'finance' && deptId === 3) return true;
    if (role === 'production') {
      const userDeptId = user.value.department_id;
      const childIds = user.value.child_dept_ids || [];
      return deptId === userDeptId || childIds.includes(deptId);
    }
    return false;
  }

  function isUserDept(deptId) {
    if (!user.value || !deptId) return false;
    if (user.value.role === 'admin' || user.value.role === 'management') return true;
    const childIds = user.value.child_dept_ids || [];
    return deptId === user.value.department_id || childIds.includes(deptId);
  }

    async function refreshUser() {
    if (!token.value) return;
    try {
      const data = await api.get('/auth/me');
      if (data.user) {
        user.value = data.user;
        sessionStorage.setItem('user', JSON.stringify(data.user));
      }
    } catch {}
  }
  const unreadCount = ref(0);
  async function refreshUnreadCount() { try { const d = await api.get("/notifications?unread=true"); unreadCount.value = d.unreadCount || 0; } catch {} }

  return {
    token, user, isLoggedIn, isAdmin, isManagement, isSales, isFinance, isProduction,
    canViewDashboard, canManageOrders, canDeleteOrder,
    unreadCount, refreshUnreadCount, login, logout, refreshUser, canOperateStage, isUserDept
  };
});
