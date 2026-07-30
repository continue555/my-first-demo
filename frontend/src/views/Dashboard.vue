<template>
  <div>
    <div class="page-header">
      <h2>仪表盘 <span v-if="refreshing" class="dash-refresh-indicator show">刷新中...</span></h2>
    </div>
    <div class="stats-row">
      <div class="stat-card" @click="$router.push('/orders')" style="cursor:pointer;">
        <div class="stat-icon total">📋</div>
        <div class="stat-body"><div class="stat-number">{{ stats.total }}</div><div class="stat-label">总订单数</div></div>
      </div>
      <div class="stat-card" @click="$router.push('/orders')" style="cursor:pointer;">
        <div class="stat-icon progress">🔄</div>
        <div class="stat-body"><div class="stat-number">{{ stats.inProgress }}</div><div class="stat-label">进行中</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon done">✅</div>
        <div class="stat-body"><div class="stat-number">{{ stats.completed }}</div><div class="stat-label">已完成</div></div>
      </div>
    </div>
    <div class="dashboard-layout">
      <div class="dashboard-card">
        <div class="dashboard-card-header">
          <span class="dash-title">最近订单</span>
          <span class="dash-link" @click="$router.push('/orders')">查看全部 →</span>
        </div>
        <div class="dashboard-card-body">
          <div v-if="recentOrders.length === 0" class="dash-empty">暂无订单</div>
          <div
            v-for="o in recentOrders"
            :key="o.id"
            class="dash-order-row"
            :class="getOverdueInfo(o)?.rowClass"
            @click="$router.push(`/orders/${o.id}`)"
          >
            <div class="dash-order-info">
              <div class="dash-order-no">
                {{ o.order_no }}
                <span v-if="getOverdueInfo(o)" :class="getOverdueInfo(o).stampClass">{{ getOverdueInfo(o).stampText }}</span>
              </div>
              <div class="dash-order-customer">{{ o.customer_name }} · {{ o.project_name }}</div>
            </div>
            <span class="status-badge" :class="'status-' + o.status">{{ statusText(o.status) }}</span>
            <div class="dash-order-progress">
              <div class="progress-bar-bg"><div class="progress-bar-fill" :style="{ width: (o.progress || 0) + '%' }"></div></div>
            </div>
          </div>
        </div>
      </div>
      <div>
        <div class="dashboard-card" style="margin-bottom:20px;">
          <div class="dashboard-card-header"><span class="dash-title">订单概览</span></div>
          <div class="mini-stats">
            <div class="mini-stat delay"><div class="mini-num">{{ stats.delayed }}</div><div class="mini-label">已延期</div></div>
            <div class="mini-stat wait"><div class="mini-num">{{ stats.pending }}</div><div class="mini-label">待处理</div></div>
            <div class="mini-stat cancel" style="grid-column:1/-1;"><div class="mini-num">{{ stats.cancelled || 0 }}</div><div class="mini-label">已取消</div></div>
          </div>
        </div>
        <div class="dashboard-card">
          <div class="dashboard-card-header">
            <span class="dash-title">最近通知</span>
            <span class="dash-link" @click="$router.push('/notifications')">查看全部 →</span>
          </div>
          <div class="dashboard-card-body">
            <div v-if="recentNotifs.length === 0" class="dash-empty">暂无通知</div>
            <div
              v-for="n in recentNotifs"
              :key="n.id"
              class="dash-notif-row"
              :class="{ read: n.is_read }"
            >
              <div class="dash-notif-dot" :class="n.is_read ? 'read' : 'unread'"></div>
              <div class="dash-notif-content">
                <div>{{ n.message }}</div>
                <div class="dash-notif-time">{{ n.created_at?.slice(0,16) }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { api } from '@/api';
import { getOverdueInfo, statusText } from '@/utils';

const stats = ref({ total: 0, inProgress: 0, completed: 0, delayed: 0, pending: 0, cancelled: 0 });
const recentOrders = ref([]);
const recentNotifs = ref([]);
const refreshing = ref(false);
let timer = null;

async function loadData() {
  try {
    const [statsData, orderData, notifData] = await Promise.all([
      api.get('/orders/stats'),
      api.get('/orders?limit=5'),
      api.get('/notifications?limit=5')
    ]);
    const s = statsData.stats;
    stats.value = { total: s.total, inProgress: s.inProgress, completed: s.completed, delayed: s.delayed, pending: s.pending, cancelled: s.cancelled || 0 };
    recentOrders.value = orderData.orders || [];
    recentNotifs.value = notifData.notifications || [];
  } catch { /* ignore */ }
}

onMounted(() => {
  loadData();
  timer = setInterval(async () => {
    refreshing.value = true;
    await loadData();
    setTimeout(() => refreshing.value = false, 1000);
  }, 30000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.stats-row {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 24px;
}
.stat-card {
  background: #fff; border-radius: 14px; box-shadow: 0 2px 12px rgba(0,0,0,0.05);
  padding: 24px 20px; display: flex; align-items: center; gap: 16px;
  border: 1px solid #e5e7eb; transition: transform 0.2s, box-shadow 0.2s;
}
.stat-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,0.1); }
.stat-icon { width: 56px; height: 56px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 26px; flex-shrink: 0; }
.stat-icon.total { background: linear-gradient(135deg, #e8f0fe, #d2e3fc); color: #1a73e8; }
.stat-icon.progress { background: linear-gradient(135deg, #fef3c7, #fde68a); color: #d97706; }
.stat-icon.done { background: linear-gradient(135deg, #d1fae5, #a7f3d0); color: #059669; }
.stat-number { font-size: 30px; font-weight: 700; line-height: 1.1; }
.stat-label { font-size: 13px; color: #6b7280; margin-top: 4px; }

.dashboard-layout { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; }
@media (max-width: 900px) { .stats-row { grid-template-columns: 1fr; } .dashboard-layout { grid-template-columns: 1fr; } }

.dashboard-card { background: #fff; border-radius: 14px; box-shadow: 0 2px 12px rgba(0,0,0,0.05); border: 1px solid #e5e7eb; overflow: hidden; }
.dashboard-card-header { padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; background: #fafbfc; }
.dash-title { font-size: 15px; font-weight: 600; }
.dash-link { font-size: 12px; color: #1a73e8; cursor: pointer; }
.dash-link:hover { text-decoration: underline; }
.mini-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 16px; }
.mini-stat { background: #fafbfc; border-radius: 10px; padding: 14px 12px; text-align: center; border: 1px solid #e5e7eb; }
.mini-num { font-size: 22px; font-weight: 700; }
.mini-label { font-size: 11px; color: #6b7280; margin-top: 2px; }
.mini-stat.delay .mini-num { color: #ef4444; }
.mini-stat.wait .mini-num { color: #6b7280; }
.mini-stat.cancel .mini-num { color: #7c3aed; }

.dash-order-row { display: flex; align-items: center; padding: 14px 20px; border-bottom: 1px solid #e5e7eb; cursor: pointer; transition: background 0.15s; gap: 14px; }
.dash-order-row:last-child { border-bottom: none; }
.dash-order-row:hover { background: #f8fafc; }
.dash-order-info { flex: 1; min-width: 0; }
.dash-order-no { font-size: 13px; font-weight: 600; }
.dash-order-customer { font-size: 12px; color: #6b7280; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dash-order-progress { width: 90px; flex-shrink: 0; }
.progress-bar-bg { height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; }
.progress-bar-fill { height: 100%; background: #0d9488; border-radius: 3px; transition: width 0.3s; }

.dash-notif-row { padding: 11px 16px; font-size: 12px; display: flex; gap: 8px; align-items: flex-start; border-bottom: 1px solid #e5e7eb; }
.dash-notif-row:last-child { border-bottom: none; }
.dash-notif-row.read { opacity: 0.45; }
.dash-notif-dot { width: 7px; height: 7px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; }
.dash-notif-dot.unread { background: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,0.15); }
.dash-notif-dot.read { background: #d1d5db; }
.dash-notif-content { flex: 1; line-height: 1.4; }
.dash-notif-time { font-size: 11px; color: #6b7280; margin-top: 2px; }
.dash-empty { padding: 32px 20px; text-align: center; color: #6b7280; font-size: 13px; }

.status-badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
.status-pending { background: #e5e7eb; color: #6b7280; }
.status-in_progress { background: #fef3c7; color: #d97706; }
.status-completed { background: #d1fae5; color: #059669; }
.status-delayed { background: #fee2e2; color: #dc2626; }
.status-cancelled { background: #f3f4f6; color: #9ca3af; text-decoration: line-through; }

.dash-refresh-indicator { font-size: 11px; color: #6b7280; opacity: 0; transition: opacity 0.3s; margin-left: 8px; }
.dash-refresh-indicator.show { opacity: 1; }

.overdue-red-row { background: #fef2f2 !important; }
.overdue-red-stamp { display: inline-block; background: #dc2626; color: #fff; font-size: 11px; padding: 1px 6px; border-radius: 3px; margin-left: 6px; vertical-align: middle; }
.overdue-green-row { background: #f0fdf4 !important; }
.overdue-green-stamp { display: inline-block; background: #16a34a; color: #fff; font-size: 11px; padding: 1px 6px; border-radius: 3px; margin-left: 6px; vertical-align: middle; }
</style>
