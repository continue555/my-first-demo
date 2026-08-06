<template>
  <div>
    <div class="page-header">
      <h2>我的待办</h2>
      <span class="todo-count">共 {{ todos.length }} 项</span>
    </div>
    <div class="card">
      <div v-if="loading" class="empty-state">
        <div class="icon">⏳</div>
        <p>加载中...</p>
      </div>
      <div v-else-if="todos.length === 0" class="empty-state">
        <div class="icon">✅</div>
        <p>暂无待办</p>
      </div>
      <div v-else class="todo-list">
        <div
          v-for="t in todos"
          :key="t.order_id"
          class="todo-item"
          :class="t.overdue ? 'overdue-red-row' : ''"
          @click="goDetail(t.order_id)"
        >
          <div class="todo-main">
            <div class="todo-order-no">
              {{ t.order_no }}
              <span v-if="t.overdue" class="overdue-red-stamp">超期</span>
            </div>
            <div class="todo-stage">当前节点：{{ t.stage_name }}<span v-if="t.dept_name"> · {{ t.dept_name }}</span></div>
          </div>
          <div class="todo-meta">
            <span class="status-badge" :class="t.category === 'ready' ? 'status-pending' : 'status-in_progress'">
              {{ t.category === 'ready' ? '待开始' : '进行中' }}
            </span>
            <span class="todo-date">计划完成：{{ t.planned_end_date || '-' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { getTodos } from '@/api';
import { navigateTo } from '@/utils/navigation';

const todos = ref([]);
const loading = ref(true);

async function loadTodos() {
  try {
    const data = await getTodos();
    todos.value = data.todos || [];
  } finally {
    loading.value = false;
  }
}

function goDetail(id) {
  navigateTo(`/orders/${id}`);
}

onMounted(loadTodos);
</script>

<style scoped>
.todo-count { font-size: 13px; color: var(--text-secondary); }
.todo-list { padding: 4px 0; }
.todo-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.15s;
}
.todo-item:last-child { border-bottom: none; }
.todo-item:hover { background: #f8fafc; }
.todo-main { flex: 1; min-width: 0; }
.todo-order-no { font-size: 14px; font-weight: 600; }
.todo-stage { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }
.todo-meta { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.todo-date { font-size: 12px; color: var(--text-secondary); }

@media (max-width: 768px) {
  .todo-item { flex-direction: column; align-items: flex-start; gap: 8px; }
}
</style>
