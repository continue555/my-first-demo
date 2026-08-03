import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './styles/global.css';

const CHUNK_RELOAD_KEY = '__codex_chunk_reload__';

function reloadOnce() {
  if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return;
  sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
  window.location.reload();
}

// 懒加载 chunk 失败时自动刷新一次，避免订单详情等页面因旧缓存资源变成空白。
window.addEventListener('vite:preloadError', reloadOnce);
window.addEventListener('unhandledrejection', (event) => {
  const message = String(event.reason?.message || event.reason || '');
  if (message.includes('Failed to fetch dynamically imported module')) reloadOnce();
});

const app = createApp(App);
app.config.errorHandler = (err, instance, info) => {
  console.error('[Vue error]', err, info);
  const appEl = document.getElementById('app');
  if (appEl && !document.getElementById('app-global-error')) {
    const div = document.createElement('div');
    div.id = 'app-global-error';
    div.style.cssText = 'position:fixed;inset:0;z-index:99998;background:#fff;display:flex;align-items:center;justify-content:center;color:#dc2626;font-size:14px;';
    div.textContent = '页面出现错误，请刷新重试';
    appEl.appendChild(div);
  }
};
app.use(createPinia());
app.use(router);
app.mount('#app');
sessionStorage.removeItem(CHUNK_RELOAD_KEY);

// 启动时预加载各页面 chunk，避免首次点击“详情”时才发起网络请求。
[
  () => import('@/views/Layout.vue'),
  () => import('@/views/Dashboard.vue'),
  () => import('@/views/Orders.vue'),
  () => import('@/views/OrderDetail.vue'),
  () => import('@/views/Export.vue'),
  () => import('@/views/Notifications.vue'),
  () => import('@/views/Users.vue'),
  () => import('@/views/AuditLog.vue')
].forEach(preload => preload().catch(() => {}));
