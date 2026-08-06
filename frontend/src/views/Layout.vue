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
          <span class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></span> <span>仪表盘</span>
        </router-link>
        <router-link
          to="/orders"
          class="nav-item"
          :class="{ active: $route.name === 'Orders' || $route.name === 'OrderDetail' }"
        >
          <span class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg></span> <span>订单管理</span>
        </router-link>
        <router-link
          to="/todos"
          class="nav-item"
          :class="{ active: $route.name === 'Todos' }"
        >
          <span class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></span> <span>我的待办</span>
        </router-link>
        <router-link
          v-if="auth.isAdmin || auth.isManagement"
          to="/export"
          class="nav-item"
          :class="{ active: $route.name === 'Export' }"
        >
          <span class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></span> <span>数据导出</span>
        </router-link>
        <router-link
          to="/notifications"
          class="nav-item"
          :class="{ active: $route.name === 'Notifications' }"
        >
          <span class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></span> <span>通知</span>
          <span v-if="auth.unreadCount > 0" class="badge">{{ auth.unreadCount }}</span>
        </router-link>
        <router-link
          v-if="auth.isAdmin"
          to="/users"
          class="nav-item"
          :class="{ active: $route.name === 'Users' }"
        >
          <span class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span> <span>用户管理</span>
        </router-link>
        <router-link
          v-if="auth.isAdmin"
          to="/audit"
          class="nav-item"
          :class="{ active: $route.name === 'AuditLog' }"
        >
          <span class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></span> <span>操作日志</span>
        </router-link>
      </nav>
      <div class="sidebar-footer">
        <div class="user-info">
          {{ auth.user?.name }} ({{ roleLabel }})
        </div>
        <button type="button" class="logout-btn" @click="showChangePassword" title="修改密码">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span class="footer-text">修改密码</span>
        </button>
        <button type="button" class="logout-btn" @click="doLogout" title="退出登录">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span class="footer-text">退出登录</span>
        </button>
      </div>
    </aside>

    <header class="mobile-topbar">
      <span class="mobile-title">吹瓶机管理系统</span>
      <span class="mobile-user">{{ auth.user?.name }}</span>
    </header>

    <nav class="mobile-bottom-nav">
      <router-link
        v-if="auth.canViewDashboard"
        to="/"
        class="mb-nav-item"
        :class="{ active: $route.name === 'Dashboard' }"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        <span>首页</span>
      </router-link>
      <router-link
        to="/orders"
        class="mb-nav-item"
        :class="{ active: $route.name === 'Orders' || $route.name === 'OrderDetail' }"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
        <span>订单</span>
      </router-link>
      <router-link
        to="/notifications"
        class="mb-nav-item"
        :class="{ active: $route.name === 'Notifications' }"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        <span>通知</span>
        <span v-if="auth.unreadCount > 0" class="mb-badge">{{ auth.unreadCount }}</span>
      </router-link>
      <router-link
        to="/todos"
        class="mb-nav-item"
        :class="{ active: $route.name === 'Todos' }"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        <span>待办</span>
      </router-link>
      <button type="button" class="mb-nav-item" :class="{ active: showMore }" @click="showMore = true">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
        <span>更多</span>
      </button>
    </nav>

    <div v-if="showMore" class="mobile-more-overlay" @click.self="showMore = false">
      <div class="mobile-more-sheet">
        <div class="mobile-more-title">更多功能</div>
        <button v-if="auth.isAdmin || auth.isManagement" type="button" class="mobile-more-item" @click="goMore('/export')">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>数据导出</span>
        </button>
        <button v-if="auth.isAdmin" type="button" class="mobile-more-item" @click="goMore('/users')">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span>用户管理</span>
        </button>
        <button v-if="auth.isAdmin" type="button" class="mobile-more-item" @click="goMore('/audit')">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          <span>操作日志</span>
        </button>
        <button type="button" class="mobile-more-item" @click="showChangePassword">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span>修改密码</span>
        </button>
        <button type="button" class="mobile-more-item danger" @click="doLogout">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span>退出登录</span>
        </button>
      </div>
    </div>

    <main class="main-content">
      <transition name="page" mode="out-in"><router-view /></transition>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { navigateTo } from '@/utils/navigation';
import { roleLabel as roleLabelText } from '@/utils/labels';

const auth = useAuthStore();

let notifTimer = null;
const showMore = ref(false);

const roleLabel = computed(() => roleLabelText(auth.user?.role));

function goMore(path) {
  showMore.value = false;
  navigateTo(path);
}

async function loadNotifCount() {
  await auth.refreshUnreadCount();
}

function showChangePassword() {
  showMore.value = false;
  navigateTo('/login?changePassword=1');
}

async function doLogout() {
  await auth.logout();
  if (notifTimer) clearInterval(notifTimer);
  navigateTo('/login');
}

onMounted(() => {
  auth.refreshUser();
  loadNotifCount();
  notifTimer = setInterval(loadNotifCount, 30000);
});

onUnmounted(() => {
  if (notifTimer) clearInterval(notifTimer);
});
</script>

<style scoped>
.app-layout { display: flex; min-height: 100vh; min-height: 100dvh; }
.sidebar {
  position: fixed; left: 0; top: 0; bottom: 0;
  width: 240px; background: #1e3a5f; color: #fff;
  z-index: 100; display: flex; flex-direction: column;
}
.sidebar-header { padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); }
.sidebar-header h2 { font-size: 17px; font-weight: 700; letter-spacing: 0; }
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
.nav-item:hover { color: #fff; background: rgba(255,255,255,0.08); }
.nav-item.active { color: #fff; background: linear-gradient(90deg, rgba(79,70,229,0.3) 0%, transparent 100%); border-left-color: var(--primary); }
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
.sidebar-footer .logout-btn {
  color: rgba(255,255,255,0.5);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  background: none;
  border: none;
  padding: 0;
  display: block;
  width: 100%;
  text-align: left;
}
.sidebar-footer .logout-btn:hover { color: #fff; }
.sidebar-footer .logout-btn svg { display: none; }
.main-content { margin-left: 240px; padding: 24px; min-height: 100vh; min-height: 100dvh; flex: 1; }
.mobile-topbar,
.mobile-bottom-nav,
.mobile-more-overlay {
  display: none;
}

@media (max-width: 768px) {
  .sidebar { display: none; }
  .mobile-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: fixed;
    top: 0; left: 0; right: 0;
    height: 52px;
    padding: 0 16px;
    background: #1e3a5f;
    color: #fff;
    z-index: 200;
  }
  .mobile-title { font-size: 15px; font-weight: 700; }
  .mobile-user { font-size: 12px; color: rgba(255,255,255,0.75); }
  .mobile-bottom-nav {
    display: flex;
    position: fixed;
    left: 0; right: 0; bottom: 0;
    height: calc(56px + env(safe-area-inset-bottom, 0px));
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: #fff;
    border-top: 1px solid var(--border);
    z-index: 200;
  }
  .mb-nav-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    color: var(--text-secondary);
    font-size: 11px;
    text-decoration: none;
    cursor: pointer;
    position: relative;
    background: none;
    border: none;
    padding: 0;
    font-family: inherit;
  }
  .mb-nav-item.active { color: var(--primary); }
  .mb-nav-item svg { width: 21px; height: 21px; }
  .mb-badge {
    position: absolute;
    top: 4px;
    left: calc(50% + 6px);
    background: #ef4444;
    color: #fff;
    font-size: 10px;
    min-width: 16px;
    height: 16px;
    line-height: 16px;
    text-align: center;
    border-radius: 8px;
    padding: 0 4px;
  }
  .mobile-more-overlay {
    display: flex;
    align-items: flex-end;
    position: fixed;
    inset: 0;
    background: rgba(15,23,42,0.5);
    z-index: 300;
  }
  .mobile-more-sheet {
    width: 100%;
    background: #fff;
    border-radius: 16px 16px 0 0;
    padding: 8px 0 calc(8px + env(safe-area-inset-bottom, 0px));
  }
  .mobile-more-title {
    padding: 12px 16px 8px;
    font-size: 13px;
    font-weight: 700;
    color: var(--text-secondary);
  }
  .mobile-more-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    font-size: 15px;
    cursor: pointer;
    background: none;
    border: none;
    width: 100%;
    text-align: left;
    font-family: inherit;
    color: var(--text);
  }
  .mobile-more-item:active { background: var(--bg); }
  .mobile-more-item.danger { color: #dc2626; }
  .main-content { margin-left: 0; padding: 64px 12px calc(64px + env(safe-area-inset-bottom, 0px)); min-width: 0; }
}
.page-enter-active, .page-leave-active { transition: opacity 0.15s ease; }
.page-enter-from, .page-leave-to { opacity: 0; }</style>
