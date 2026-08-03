import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const routes = [
  { path: '/login', name: 'Login', component: () => import('@/views/Login.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('@/views/Layout.vue'),
    children: [
      { path: '', name: 'Dashboard', component: () => import('@/views/Dashboard.vue') },
      { path: 'orders', name: 'Orders', component: () => import('@/views/Orders.vue') },
      { path: 'orders/:id', name: 'OrderDetail', component: () => import('@/views/OrderDetail.vue') },
      { path: 'export', name: 'Export', component: () => import('@/views/Export.vue'), meta: { adminOrManagement: true } },
      { path: 'notifications', name: 'Notifications', component: () => import('@/views/Notifications.vue') },
      { path: 'users', name: 'Users', component: () => import('@/views/Users.vue'), meta: { adminOnly: true } },
      { path: 'audit', name: 'AuditLog', component: () => import('@/views/AuditLog.vue'), meta: { adminOnly: true } }
    ]
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    return savedPosition || { top: 0 };
  }
});

router.beforeEach((to, from, next) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.isLoggedIn) {
    next('/login');
  } else if (to.path === '/login' && auth.isLoggedIn && !to.query.changePassword) {
    next('/');
  } else if (to.meta.adminOnly && !auth.isAdmin) {
    next('/');
  } else if (to.meta.adminOrManagement && !auth.isAdmin && !auth.isManagement) {
    next('/');
  } else {
    next();
  }
});

export default router;
