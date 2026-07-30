<template>
  <div>
    <div class="page-header"><h2>操作日志</h2></div>
    <div class="card">
      <div v-if="logs.length === 0" class="empty-state">
        <div class="icon">📝</div>
        <p>暂无操作日志</p>
      </div>
      <div v-else>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>操作人</th><th>操作</th><th>对象</th><th>详情</th><th>时间</th></tr></thead>
            <tbody>
              <tr v-for="l in logs" :key="l.id">
                <td>{{ l.username || '-' }}</td>
                <td>{{ actionIcons[l.action] || '' }} {{ l.action }}</td>
                <td>{{ l.target_type || '-' }}</td>
                <td style="font-size:12px;">{{ l.detail || '-' }}</td>
                <td style="font-size:12px;">{{ l.created_at?.slice(0,16) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="totalPages > 1" class="pagination">
          <button class="btn btn-outline btn-sm" :disabled="page <= 1" @click="load(1)">首页</button>
          <button class="btn btn-outline btn-sm" :disabled="page <= 1" @click="load(page - 1)">上一页</button>
          <span style="font-size:13px;color:var(--text-secondary);">第 {{ page }} / {{ totalPages }} 页 (共 {{ total }} 条)</span>
          <button class="btn btn-outline btn-sm" :disabled="page >= totalPages" @click="load(page + 1)">下一页</button>
          <button class="btn btn-outline btn-sm" :disabled="page >= totalPages" @click="load(totalPages)">末页</button>
        </div>
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

const actionIcons = {
  '创建订单': '📝', '编辑订单': '✏️', '删除订单': '🗑️', '取消订单': '🚫', '更新阶段': '🔄',
  '创建用户': '👤', '编辑用户': '✏️', '删除用户': '🗑️', '重置密码': '🔑'
};

async function load(p = 1) {
  page.value = p;
  try {
    const data = await api.get(`/audit?page=${p}&limit=20`);
    logs.value = data.logs || [];
    total.value = data.total || 0;
    totalPages.value = Math.ceil(total.value / 20);
  } catch (e) {
    toast.show(e.message, 'error');
  }
}

onMounted(() => load(1));
</script>
