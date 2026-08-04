<template>
  <div>
    <div class="page-header"><h2>操作日志</h2></div>
    <div class="card">
      <div class="search-bar" style="margin-bottom:16px;">
        <input v-model="orderId" type="text" placeholder="按订单编号筛选..." @keydown.enter="load(1)">
        <button class="btn btn-outline btn-sm" @click="load(1)">搜索</button>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr><th>时间</th><th>用户</th><th>操作</th><th>详情</th></tr>
          </thead>
          <tbody>
            <tr v-for="l in logs" :key="l.id">
              <td style="white-space:nowrap;">{{ l.created_at }}</td>
              <td>{{ l.username }}</td>
              <td><span class="status-badge" :class="'status-' + (l.action.includes('删除') ? 'delayed' : l.action.includes('创建') ? 'in_progress' : 'completed')">{{ l.action }}</span></td>
              <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;">{{ l.detail || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="logs.length === 0" class="empty-state"><div class="icon">📝</div><p>暂无操作日志</p></div>
      <div v-if="totalPages > 1" class="pagination">
        <button class="btn btn-outline btn-sm" :disabled="page <= 1" @click="load(1)">首页</button>
        <button class="btn btn-outline btn-sm" :disabled="page <= 1" @click="load(page-1)">上一页</button>
        <span style="font-size:13px;color:var(--text-secondary);">第 {{ page }} / {{ totalPages }} 页 (共 {{ total }} 条)</span>
        <button class="btn btn-outline btn-sm" :disabled="page >= totalPages" @click="load(page+1)">下一页</button>
        <button class="btn btn-outline btn-sm" :disabled="page >= totalPages" @click="load(totalPages)">末页</button>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue';
import { api } from '@/api';
import { useToastStore } from '@/stores/toast';
const toast = useToastStore();
const logs = ref([]);
const page = ref(1);
const total = ref(0);
const totalPages = ref(0);
const orderId = ref('');

async function load(p) {
  page.value = p || 1;
  try {
    let url = '/audit?page=' + page.value;
    if (orderId.value) url += '&order_no=' + encodeURIComponent(orderId.value);
    const d = await api.get(url);
    logs.value = d.logs || [];
    total.value = d.total || 0;
    totalPages.value = Math.ceil(total.value / 30);
  } catch (e) {
    toast.show(e.message, 'error');
  }
}
onMounted(() => load(1));
</script>
