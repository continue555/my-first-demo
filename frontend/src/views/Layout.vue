<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>吹瓶机管理系统</h2>
        <div class="dept-tag">{{ auth.user?.dept_name || '全局管理' }}</div>
      </div>
      <nav class="nav-menu">
        <router-link
          v-if="auth.canViewDashboard"
          to="/"
          class="nav-item"
          :class="{ active: $route.name === 'Dashboard' }"
        >
          <span class="icon">📊</span> <span>仪表盘</span>
        </router-link>
        <router-link
          to="/orders"
          class="nav-item"
          :class="{ active: $route.name === 'Orders' || $route.name === 'OrderDetail' }"
        >
          <span class="icon">📋</span> <span>订单管理</span>
        </router-link>
        <router-link
          v-if="auth.isAdmin || auth.isManagement"
          to="/export"
          class="nav-item"
          :class="{ active: $route.name === 'Export' }"
        >
          <span class="icon">📥</span> <span>数据导出</span>
        </router-link>
        <router-link
          to="/notifications"
          class="nav-item"
          :class="{ active: $route.name === 'Notifications' }"
        >
          <span class="icon">🔔</span> <span>通知</span>
          <span v-if="auth.unreadCount > 0" class="badge">{{ auth.unreadCount }}</span>
        </router-link>
        <router-link
          v-if="auth.isAdmin"
          to="/users"
          class="nav-item"
          :class="{ active: $route.name === 'Users' }"
        >
          <span class="icon">👥</span> <span>用户管理</span>
        </router-link>
        <router-link
          v-if="auth.isAdmin"
          to="/audit"
          class="nav-item"
          :class="{ active: $route.name === 'AuditLog' }"
        >
          <span class="icon">📝</span> <span>操作日志</span>
        </router-link>
      </nav>
      <div class="sidebar-footer">
        <div class="user-info">
          {{ auth.user?.name }} ({{ roleLabel }})
        </div>
        <div class="logout-btn" @click="showChangePassword">修改密码</div>
        <div class="logout-btn" @click="doLogout">退出登录</div>
      </div>
    </aside>

    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { api } from '@/api';

const auth = useAuthStore();
const router = useRouter();
const toast = useToastStore();

let notifTimer = null;
let checkTimer = null;

const roleLabel = computed(() => {
  const map = { admin: '管理员', management: '总经理', sales: '销售', production: '生产', finance: '财务' };
  return map[auth.user?.role] || auth.user?.role;
});

async function loadNotifCount() {
  await auth.refreshUnreadCount();
}

async function checkOverdue() {
  try {
    const data = await api.post('/notifications/check-overdue');
    if (data.created > 0) {
      await auth.refreshUnreadCount();
      data.newNotifs?.forEach(n => {
        toast.show(n.message, 'warning');
        if ('Notification' in window && Notification.permission === 'granted') {
          try { new Notification('流程超期提醒', { body: n.message, icon: '/favicon.ico' }); } catch { /* ignore */ }
        }
      });
    }
  } catch { /* ignore */ }
}

function showChangePassword() {
  router.push('/login?changePassword=1');
}

function doLogout() {
  auth.logout();
  if (notifTimer) clearInterval(notifTimer);
  if (checkTimer) clearInterval(checkTimer);
  router.push('/login');
}

onMounted(() => {
  loadNotifCount();
  notifTimer = setInterval(loadNotifCount, 30000);
  checkOverdue();
  checkTimer = setInterval(checkOverdue, 30000);
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
});

onUnmounted(() => {
  if (notifTimer) clearInterval(notifTimer);
  if (checkTimer) clearInterval(checkTimer);
});
</script>

<style scoped>
.app-layout { display: flex; min-height: 100vh; }
.sidebar {
  position: fixed; left: 0; top: 0; bottom: 0;
  width: 240px; background: #1e3a5f; color: #fff;
  z-index: 100; display: flex; flex-direction: column;
}
.sidebar-header { padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); }
.sidebar-header h2 { font-size: 18px; font-weight: 600; }
.dept-tag {
  display: inline-block; margin-top: 6px; padding: 2px 10px;
  background: rgba(255,255,255,0.15); border-radius: 12px; font-size: 12px;
}
.nav-menu { flex: 1; padding: 12px 0; }
.nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 24px; color: rgba(255,255,255,0.7);
  cursor: pointer; transition: all 0.2s; font-size: 14px;
  border-left: 3px solid transparent; text-decoration: none;
}
.nav-item:hover { color: #fff; background: rgba(255,255,255,0.05); }
.nav-item.active { color: #fff; background: rgba(255,255,255,0.1); border-left-color: #f59e0b; }
.nav-item .icon { font-size: 18px; width: 24px; text-align: center; }
.badge {
  margin-left: auto; background: #ef4444; color: #fff;
  font-size: 11px; padding: 1px 7px; border-radius: 10px;
  min-width: 20px; text-align: center;
}
.sidebar-footer {
  padding: 16px 20px; border-top: 1px solid rgba(255,255,255,0.1);
  font-size: 13px; color: rgba(255,255,255,0.6);
}
.sidebar-footer .user-info { margin-bottom: 8px; }
.sidebar-footer .logout-btn { color: rgba(255,255,255,0.5); cursor: pointer; font-size: 12px; }
.sidebar-footer .logout-btn:hover { color: #fff; }
.main-content { margin-left: 240px; padding: 24px; min-height: 100vh; flex: 1; }

@media (max-width: 768px) {
  .sidebar { width: 60px; }
  .sidebar-header h2, .sidebar-header .dept-tag, .nav-item span:not(.icon), .sidebar-footer { display: none; }
  .nav-item { padding: 12px; justify-content: center; }
  .main-content { margin-left: 60px; padding: 16px; }
}
</style>
