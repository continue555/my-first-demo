<template>
  <div>
    <div class="page-header">
      <h2>通知中心</h2>
      <button class="btn btn-outline btn-sm" @click="markAllRead">全部已读</button>
    </div>
    <div class="card">
      <div v-if="notifs.length === 0" class="empty-state">
        <div class="icon">🔔</div>
        <p>暂无通知</p>
      </div>
      <div v-else>
        <div
          v-for="n in notifs"
          :key="n.id"
          class="notif-row"
          :class="{ read: n.is_read, clickable: !!n.order_id }"
          @click="goOrder(n)"
        >
          <span style="font-size:18px;">{{ n.is_read ? '🔕' : '🔔' }}</span>
          <div style="flex:1;">
            <div style="font-size:14px;">{{ n.message }}</div>
            <div style="font-size:12px;color:var(--text-secondary);">{{ n.created_at }} {{ n.order_no ? '| ' + n.order_no : '' }}</div>
          </div>
          <button v-if="!n.is_read" class="btn btn-outline btn-sm" @click.stop="markRead(n.id)">已读</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api';
import { useToastStore } from '@/stores/toast';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const toast = useToastStore();
const auth = useAuthStore();
const notifs = ref([]);
let pollTimer = null;

async function load() {
  try {
    const data = await api.get('/notifications');
    notifs.value = data.notifications || [];
  } catch (e) {
    toast.show(e.message, 'error');
  }
}

async function markRead(id) {
  try {
    await api.put(`/notifications/${id}/read`);
    load();
    await auth.refreshUnreadCount();
  } catch { /* ignore */ }
}

async function markAllRead() {
  try {
    await api.put('/notifications/read-all');
    toast.show('已全部标记为已读');
    load();
    await auth.refreshUnreadCount();
  } catch { /* ignore */ }
}

function goOrder(n) {
  if (!n.order_id) return;
  if (!n.is_read) markRead(n.id);
  router.push(`/orders/${n.order_id}`);
}

onMounted(() => {
  load();
  pollTimer = setInterval(load, 60000);
});
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<style scoped>
.notif-row {
  padding: 14px 0; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 12px;
  transition: background 0.15s;
}
.notif-row.read { opacity: 0.6; }
.notif-row.clickable { cursor: pointer; }
.notif-row.clickable:hover { background: #f9fafb; }
</style>