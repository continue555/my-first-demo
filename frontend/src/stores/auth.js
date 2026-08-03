import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '@/api';
import { canOperateStage as canOperateStageRule, isUserDept as isUserDeptRule } from '@/utils/stage-permissions';

export const useAuthStore = defineStore('auth', () => {
  const token = ref(sessionStorage.getItem('token') || (sessionStorage.getItem('auth_mode') === 'cookie' ? 'cookie' : ''));
  const user = ref(null);

  try {
    const saved = sessionStorage.getItem('user');
    if (saved) user.value = JSON.parse(saved);
    if (user.value && !sessionStorage.getItem('session_user_id')) {
      sessionStorage.setItem('session_user_id', String(user.value.id));
    }
  } catch { /* ignore */ }

  const isLoggedIn = computed(() => !!token.value && !!user.value);
  const isAdmin = computed(() => user.value?.role === 'admin');
  const isManagement = computed(() => user.value?.role === 'management');
  const isSales = computed(() => user.value?.role === 'sales');
  const isFinance = computed(() => user.value?.role === 'finance');
  const isProduction = computed(() => user.value?.role === 'production');
  const isMold = computed(() => user.value?.role === 'mold');
  const isMaterialFollow = computed(() => user.value?.role === 'material_follow');

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
    token.value = 'cookie';
    user.value = data.user;
    sessionStorage.removeItem('token');
    sessionStorage.setItem('auth_mode', 'cookie');
    sessionStorage.setItem('user', JSON.stringify(data.user));
    sessionStorage.setItem('session_user_id', String(data.user.id));
  }

  async function logout() {
    try { await api.post('/auth/logout'); } catch {}
    token.value = '';
    user.value = null;
    sessionStorage.clear();
  }

  function canOperateStage(stage) {
    return canOperateStageRule(user.value, stage);
  }

  function isUserDept(deptId) {
    return isUserDeptRule(user.value, deptId);
  }

    async function refreshUser() {
    if (!token.value) return;
    try {
      const data = await api.get('/auth/me');
      if (data.user) {
        const boundUserId = sessionStorage.getItem('session_user_id');
        if (boundUserId && String(data.user.id) !== boundUserId) {
          await logout();
          return;
        }
        user.value = data.user;
        sessionStorage.setItem('user', JSON.stringify(data.user));
      }
    } catch {}
  }
  const unreadCount = ref(0);
  async function refreshUnreadCount() { try { const d = await api.get("/notifications?unread=true"); unreadCount.value = d.unreadCount || 0; } catch {} }

  return {
    token, user, isLoggedIn, isAdmin, isManagement, isSales, isFinance, isProduction, isMold, isMaterialFollow,
    canViewDashboard, canManageOrders, canDeleteOrder,
    unreadCount, refreshUnreadCount, login, logout, refreshUser, canOperateStage, isUserDept
  };
});
