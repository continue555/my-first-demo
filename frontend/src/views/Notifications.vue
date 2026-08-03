<template>
  <div>
    <div class="page-header">
      <h2>通知中心</h2>
      <button class="btn btn-outline btn-sm" @click="markAllRead">全部已读</button>
    </div>
    <div class="card">
      <div v-if="notifs.length === 0" class="empty-state"><div class="icon">🔔</div><p>暂无通知</p></div>
      <div v-else>
        <div v-for="n in notifs" :key="n.id" class="notif-row" :class="{ read: n.is_read, clickable: !!n.order_id }" @click="goOrder(n)">
          <span style="font-size:18px;">{{ n.is_read ? '🔕' : '🔔' }}</span>
          <div style="flex:1;">
            <div style="font-size:14px;">{{ n.message }}</div>
            <div style="font-size:12px;color:var(--text-secondary);">{{ n.created_at }} {{ n.order_no ? '| ' + n.order_no : '' }}</div>
          </div>
          <button v-if="!n.is_read" class="btn btn-outline btn-sm" @click.stop="markRead(n.id)">已读</button>
        </div>
        <div v-if="notifs.length >= notifLimit" style="text-align:center;padding:12px 0;">
          <button class="btn btn-outline btn-sm" @click="loadMore">加载更多</button>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { api } from '@/api';
import { useToastStore } from '@/stores/toast';
import { navigateTo } from '@/utils/navigation';
const toast = useToastStore(); const notifs = ref([]); const notifLimit = ref(50); let pollTimer = null;
async function load() { try { const d = await api.get('/notifications?limit=' + notifLimit.value); notifs.value = d.notifications || []; } catch (e) { toast.show(e.message, 'error'); } }
function loadMore() { notifLimit.value += 50; load(); }
async function markRead(id) { try { await api.put('/notifications/'+id+'/read'); load(); } catch {} }
async function markAllRead() { try { await api.put('/notifications/read-all'); toast.show('已全部标记为已读'); load(); } catch {} }
async function goOrder(n) { if (!n.order_id) return; if (!n.is_read) await markRead(n.id); navigateTo('/orders/'+n.order_id); }
onMounted(() => { load(); pollTimer = setInterval(load, 60000); });
onUnmounted(() => { if (pollTimer) clearInterval(pollTimer); });
</script>
<style scoped>
.notif-row { padding:14px 0; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:12px; }
.notif-row.read { opacity:0.6; }
.notif-row.clickable { cursor:pointer; }
.notif-row.clickable:hover { background:#f9fafb; }
</style>
