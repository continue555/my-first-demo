<template>
  <div>
    <div class="page-header">
      <h2>通知中心</h2>
      <button class="btn btn-outline btn-sm" @click="markAllRead">全部已读</button>
    </div>
    <div class="card">
      <div v-if="notifs.length === 0" class="empty-state"><div class="icon">🔔</div><p>暂无通知</p></div>
      <div v-else>
        <template v-for="g in groups" :key="g.key">
          <div v-if="g.type === 'single'" class="notif-row" :class="{ read: g.allRead, clickable: !!g.items[0].order_id }" @click="goOrder(g.items[0])">
            <span style="font-size:18px;">{{ g.allRead ? '🔕' : '🔔' }}</span>
            <div style="flex:1;">
              <div style="font-size:14px;">{{ g.items[0].message }}</div>
              <div style="font-size:12px;color:var(--text-secondary);">{{ g.items[0].created_at }} {{ g.items[0].order_no ? '| ' + g.items[0].order_no : '' }}</div>
            </div>
            <button v-if="!g.allRead" class="btn btn-outline btn-sm" @click.stop="markRead(g.items[0].id)">已读</button>
          </div>
          <div v-else class="notif-group">
            <div class="notif-row group-summary" :class="{ read: g.allRead, clickable: true }" @click="toggleGroup(g.key)">
              <span style="font-size:18px;">{{ g.allRead ? '🔕' : '🔔' }}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:14px;">{{ g.summary }}</div>
                <div style="font-size:12px;color:var(--text-secondary);">{{ g.items[0].created_at }} {{ g.items[0].order_no ? '| ' + g.items[0].order_no : '' }} · 共 {{ g.items.length }} 条</div>
              </div>
              <button v-if="!g.allRead" class="btn btn-outline btn-sm" @click.stop="markGroupRead(g)">全部已读</button>
              <span class="group-toggle">{{ isExpanded(g.key) ? '收起' : '展开' }}</span>
            </div>
            <div v-if="isExpanded(g.key)" class="group-children">
              <div v-for="n in g.items" :key="n.id" class="notif-row" :class="{ read: n.is_read, clickable: !!n.order_id }" @click="goOrder(n)">
                <span style="font-size:16px;">{{ n.is_read ? '🔕' : '🔔' }}</span>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;">{{ n.message }}</div>
                  <div style="font-size:12px;color:var(--text-secondary);">{{ n.created_at }} {{ n.order_no ? '| ' + n.order_no : '' }}</div>
                </div>
                <button v-if="!n.is_read" class="btn btn-outline btn-sm" @click.stop="markRead(n.id)">已读</button>
              </div>
            </div>
          </div>
        </template>
        <div v-if="notifs.length >= notifLimit" style="text-align:center;padding:12px 0;">
          <button class="btn btn-outline btn-sm" @click="loadMore">加载更多</button>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api } from '@/api';
import { useToastStore } from '@/stores/toast';
import { navigateTo } from '@/utils/navigation';
import { groupNotifications } from '@/utils/notifications';
const toast = useToastStore(); const notifs = ref([]); const notifLimit = ref(50); let pollTimer = null;
const expandedKeys = ref(new Set());
const groups = computed(() => groupNotifications(notifs.value));
function isExpanded(key) { return expandedKeys.value.has(key); }
function toggleGroup(key) {
  const next = new Set(expandedKeys.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  expandedKeys.value = next;
}
async function load() { try { const d = await api.get('/notifications?limit=' + notifLimit.value); notifs.value = d.notifications || []; } catch (e) { toast.show(e.message, 'error'); } }
function loadMore() { notifLimit.value += 50; load(); }
async function markRead(id) { try { await api.put('/notifications/'+id+'/read'); load(); } catch {} }
async function markGroupRead(g) {
  for (const n of g.items) {
    if (!n.is_read) { try { await api.put('/notifications/'+n.id+'/read'); } catch {} }
  }
  load();
}
async function markAllRead() { try { await api.put('/notifications/read-all'); toast.show('已全部标记为已读'); load(); } catch {} }
async function goOrder(n) { if (!n.order_id) return; if (!n.is_read) await markRead(n.id); navigateTo('/orders/'+n.order_id); }
onMounted(() => { load(); pollTimer = setInterval(load, 60000); });
onUnmounted(() => { if (pollTimer) clearInterval(pollTimer); });
</script>
<style scoped>
.notif-row {
  padding:14px 16px; margin:8px 0; border-radius:10px; background:#fff;
  border:1px solid var(--border); display:flex; align-items:center; gap:12px;
  transition: border-color var(--transition), box-shadow var(--transition);
}
.notif-row:not(.read) { border-color:#c7d2fe; background:#f5f6ff; }
.notif-row.read { opacity:0.55; }
.notif-row.clickable { cursor:pointer; }
.notif-row.clickable:hover { border-color:#a5b4fc; box-shadow: var(--shadow); }
.notif-group { margin: 8px 0; }
.group-summary { margin: 0 0 6px; }
.group-children { padding-left: 18px; }
.group-children .notif-row { margin: 6px 0; }
.group-toggle { font-size: 12px; color: #1a73e8; white-space: nowrap; }
</style>
