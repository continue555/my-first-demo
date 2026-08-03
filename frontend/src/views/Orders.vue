<template>
  <div>
    <div class="page-header">
      <h2>订单管理</h2>
      <div class="actions">
        <button v-if="auth.canManageOrders" class="btn btn-primary" @click="showCreate = true">+ 新建订单</button>
      </div>
    </div>
    <div class="card">
      <div class="search-bar">
        <input v-model="search" type="text" placeholder="搜索订单编号" @input="loadOrders(1)">
        <select v-model="status" @change="loadOrders(1)">
          <option value="">全部状态</option>
          <option value="pending">未开始</option>
          <option value="in_progress">进行中</option>
          <option value="completed">已完成</option>
        </select>
        <div class="filter-row">
          <input v-model="dateFrom" type="date" @change="loadOrders(1)">
          <span style="font-size:12px;color:var(--text-secondary);">至</span>
          <input v-model="dateTo" type="date" @change="loadOrders(1)">
        </div>
      </div>
      <div v-if="selectedOrders.length > 0" class="batch-bar">
        <span>已选 {{ selectedOrders.length }} 项</span>
        <button class="btn btn-outline btn-sm" @click="batchExport">📥 批量导出</button>
        <button class="btn btn-outline btn-sm" @click="clearBatch">取消选择</button>
      </div>
      <div v-if="loading" class="empty-state"><div class="icon">⏳</div><p>加载中...</p></div>
      <div v-else-if='orders.length === 0' class='empty-state'>
        <div class="icon">📋</div>
        <p>暂无匹配的订单</p>
      </div>
      <div v-else>
        <div class="order-cards mobile-only">
          <div v-for="o in orders" :key="o.id" class="order-card" :class="getOverdueInfo(o)?.rowClass">
            <div class="order-card-top">
              <label class="order-card-check"><input v-model="selectedOrders" type="checkbox" class="batch-checkbox" :value="o.id"></label>
              <div class="order-card-no">
                <strong>{{ o.order_no }}</strong>
                <span v-if="getOverdueInfo(o)" :class="getOverdueInfo(o).stampClass">{{ getOverdueInfo(o).stampText }}</span>
              </div>
              <span class="status-badge" :class="'status-' + o.status">{{ statusText(o.status) }}</span>
            </div>
            <div class="order-card-meta">计划交货：{{ o.planned_delivery_date || '-' }}</div>
            <div class="order-card-progress">
              <div class="progress-bar-bg"><div class="progress-bar-fill" :style="{ width: (o.progress || 0) + '%' }"></div></div>
              <span>{{ o.progress || 0 }}%</span>
            </div>
            <div class="order-card-actions">
              <button class="btn btn-outline btn-sm" @click="goDetail(o.id)">详情</button>
              <button v-if="auth.canDeleteOrder" class="btn btn-danger btn-sm" @click="deleteOrder(o.id)">删除</button>
            </div>
          </div>
        </div>
        <div class="table-wrapper desktop-only">
          <table>
            <thead>
              <tr>
                <th style="width:30px;"><input type="checkbox" class="batch-checkbox" :checked="allSelected" @change="toggleSelectAll"></th>
                <th>订单编号</th><th>计划交货</th><th>状态</th><th>进度</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in orders" :key="o.id" :class="getOverdueInfo(o)?.rowClass">
                <td><input v-model="selectedOrders" type="checkbox" class="batch-checkbox" :value="o.id"></td>
                <td>
                  <strong>{{ o.order_no }}</strong>
                  <span v-if="getOverdueInfo(o)" :class="getOverdueInfo(o).stampClass">{{ getOverdueInfo(o).stampText }}</span>
                </td>
                <td>{{ o.planned_delivery_date || '-' }}</td>
                <td><span class="status-badge" :class="'status-' + o.status">{{ statusText(o.status) }}</span></td>
                <td>
                  <div class="progress-bar-bg"><div class="progress-bar-fill" :style="{ width: (o.progress || 0) + '%' }"></div></div>
                  <span style="font-size:11px;color:var(--text-secondary)">{{ o.progress || 0 }}%</span>
                </td>
                <td>
                  <button class="btn btn-outline btn-sm" @click="goDetail(o.id)">详情</button>
                  <button v-if="auth.canDeleteOrder" class="btn btn-danger btn-sm" @click="deleteOrder(o.id)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-if="totalPages > 1" class="pagination">
        <button class="btn btn-outline btn-sm" :disabled="page <= 1" @click="loadOrders(1)">首页</button>
        <button class="btn btn-outline btn-sm" :disabled="page <= 1" @click="loadOrders(page - 1)">上一页</button>
        <span style="font-size:13px;color:var(--text-secondary);">第 {{ page }} / {{ totalPages }} 页 (共 {{ total }} 条)</span>
        <button class="btn btn-outline btn-sm" :disabled="page >= totalPages" @click="loadOrders(page + 1)">下一页</button>
        <button class="btn btn-outline btn-sm" :disabled="page >= totalPages" @click="loadOrders(totalPages)">末页</button>
      </div>
    </div>

    <!-- 新建订单弹窗 -->
    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal">
        <h3>新建订单</h3>
        <div class="form-group"><label>订单编号 *</label><input v-model="newOrder.order_no" type="text" placeholder="输入订单编号"></div>
        <div class="form-group"><label>计划交货日期 *</label><input v-model="newOrder.planned_delivery_date" type="date"></div>
        <div class="modal-actions">
          <button class="btn btn-outline" @click="showCreate = false">取消</button>
          <button class="btn btn-primary" @click="createOrder">创建订单</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { useModalStore } from '@/stores/modal';
import { api } from '@/api';
import { createExportJob, getExportJob, downloadExportJob } from '@/api';
import { getOverdueInfo, statusText } from '@/utils';
import { navigateTo } from '@/utils/navigation';

const auth = useAuthStore();
const toast = useToastStore();
const modal = useModalStore();
const route = useRoute();
const router = useRouter();

const search = ref('');
const status = ref('');
const dateFrom = ref('');
const dateTo = ref('');
const orders = ref([]);
const page = ref(1);
const total = ref(0);
const totalPages = ref(0);
const loading = ref(false);
const selectedOrders = ref([]);

const showCreate = ref(false);
const newOrder = ref({ order_no: '', planned_delivery_date: '' });


const allSelected = computed(() => {
  return orders.value.length > 0 && orders.value.every(o => selectedOrders.value.includes(o.id));
});

let pollTimer = null;

function syncQuery() {
  const q = {};
  if (search.value) q.search = search.value;
  if (status.value) q.status = status.value;
  if (dateFrom.value) q.startDate = dateFrom.value;
  if (dateTo.value) q.endDate = dateTo.value;
  if (page.value > 1) q.page = String(page.value);
  try {
    sessionStorage.setItem('orders-filters', JSON.stringify(q));
  } catch { /* ignore */ }
  const next = JSON.stringify(q);
  const cur = JSON.stringify(route.query || {});
  if (cur !== next) {
    router.replace({ query: q });
  }
}

async function loadOrders(p = 1) {
  page.value = p;
  syncQuery();
  try {
    const params = new URLSearchParams({ search: search.value, status: status.value, page: String(p), limit: '15' });
    if (dateFrom.value) params.set('startDate', dateFrom.value);
    if (dateTo.value) params.set('endDate', dateTo.value);
    const data = await api.get(`/orders?${params}`);
    orders.value = data.orders || [];
    total.value = data.total || 0;
    totalPages.value = Math.ceil(total.value / 15);
  } catch (e) {
    toast.show(e.message, 'error');
  }
}

function goDetail(id) {
  navigateTo(`/orders/${id}`);
}

async function createOrder() {
  if (!newOrder.value.order_no || !newOrder.value.order_no.trim()) {
    toast.show('订单编号为必填项', 'error');
    return;
  }
  if (!newOrder.value.planned_delivery_date) {
    toast.show('计划交货日期为必填项', 'error');
    return;
  }
  try {
    const orderNo = newOrder.value.order_no.trim();
    const body = {
      order_no: orderNo,
      customer_name: orderNo,
      project_name: orderNo,
      product_model: '',
      quantity: 1,
      contract_amount: null,
      planned_delivery_date: newOrder.value.planned_delivery_date || null,
      notes: ''
    };
    await api.post('/orders', body);
    toast.show('订单创建成功');
    showCreate.value = false;
    newOrder.value = { order_no: '', planned_delivery_date: '' };
    loadOrders(1);
  } catch (e) {
    toast.show(e.message, 'error');
  }
}

function deleteOrder(id) {
  modal.open({
    title: '确认操作',
    content: `<p style="margin:16px 0;color:var(--text-secondary);">确定要删除此订单吗？此操作不可撤销！</p>`,
    showConfirm: true,
    onConfirm: async () => {
      try {
        await api.del(`/orders/${id}`);
        toast.show('订单已删除');
        loadOrders(page.value);
      } catch (e) {
        toast.show(e.message, 'error');
      }
    }
  });
}

function toggleSelectAll(e) {
  if (e.target.checked) {
    selectedOrders.value = orders.value.map(o => o.id);
  } else {
    selectedOrders.value = [];
  }
}

function clearBatch() {
  selectedOrders.value = [];
}

async function batchExport() {
  if (selectedOrders.value.length === 0) {
    toast.show('请先选择订单', 'error');
    return;
  }
  try {
    const { jobId } = await createExportJob({ ids: selectedOrders.value });
    for (let i = 0; i < 600; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const job = await getExportJob(jobId);
      if (job.status === 'done') {
        await downloadExportJob(jobId);
        toast.show('批量导出成功');
        return;
      }
      if (job.status === 'error') throw new Error(job.error || '导出失败');
    }
    throw new Error('导出超时，请重试');
  } catch (e) {
    toast.show(e.message, 'error');
  }
}

onMounted(() => {
  const hasQuery = Object.keys(route.query || {}).length > 0;
  if (!hasQuery && window.matchMedia('(max-width: 768px)').matches) {
    try {
      const saved = JSON.parse(sessionStorage.getItem('orders-filters') || '{}');
      search.value = saved.search || '';
      status.value = saved.status || '';
      dateFrom.value = saved.startDate || '';
      dateTo.value = saved.endDate || '';
      const sp = parseInt(saved.page, 10);
      page.value = Number.isFinite(sp) && sp > 0 ? sp : 1;
    } catch { /* ignore */ }
  } else {
    search.value = String(route.query.search || '');
    status.value = String(route.query.status || '');
    dateFrom.value = String(route.query.startDate || '');
    dateTo.value = String(route.query.endDate || '');
    const p = parseInt(route.query.page, 10);
    page.value = Number.isFinite(p) && p > 0 ? p : 1;
  }
  loadOrders(page.value);
  pollTimer = setInterval(() => loadOrders(page.value), 60000);
});
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<style scoped>
.order-cards { padding-bottom: 4px; }
.order-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
  padding: 12px;
  margin-bottom: 12px;
}
.order-card-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.order-card-check { display: flex; align-items: center; flex-shrink: 0; }
.order-card-no {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.4;
}
.order-card-no strong {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}
.order-card-meta {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
.order-card-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  font-size: 11px;
  color: var(--text-secondary);
}
.order-card-progress .progress-bar-bg { flex: 1; min-width: 0; }
.order-card-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.filter-row span {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
</style>
