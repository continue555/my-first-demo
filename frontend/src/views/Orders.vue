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
        <input v-model="search" type="text" placeholder="搜索订单编号/客户/项目..." @input="loadOrders(1)">
        <select v-model="status" @change="loadOrders(1)">
          <option value="">全部状态</option>
          <option value="pending">未开始</option>
          <option value="in_progress">进行中</option>
          <option value="completed">已完成</option>
          <option value="delayed">已延期</option>
          <option value="cancelled">已取消</option>
        </select>
        <div class="filter-row">
          <input v-model="dateFrom" type="date" @change="loadOrders(1)">
          <span style="font-size:12px;color:var(--text-secondary);">至</span>
          <input v-model="dateTo" type="date" @change="loadOrders(1)">
        </div>
      </div>
      <div v-if="selectedOrders.size > 0" class="batch-bar">
        <span>已选 {{ selectedOrders.size }} 项</span>
        <button class="btn btn-outline btn-sm" @click="batchExport">📥 批量导出</button>
        <button class="btn btn-outline btn-sm" @click="clearBatch">取消选择</button>
      </div>
      <div v-if="loading" class="empty-state"><div class="icon">⏳</div><p>加载中...</p></div>
      <div v-else-if='orders.length === 0' class='empty-state'>
        <div class="icon">📋</div>
        <p>暂无匹配的订单</p>
      </div>
      <div v-else class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th style="width:30px;"><input type="checkbox" class="batch-checkbox" :checked="allSelected" @change="toggleSelectAll"></th>
              <th>订单编号</th><th v-if="!auth.isProduction">客户</th><th>项目</th><th>产品型号</th><th>数量</th>
              <th v-if="!auth.isProduction">金额</th>
              <th>计划交货</th><th>状态</th><th>进度</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in orders" :key="o.id" :class="getOverdueInfo(o)?.rowClass">
              <td><input v-model="selectedOrders" type="checkbox" class="batch-checkbox" :value="o.id"></td>
              <td>
                <strong>{{ o.order_no }}</strong>
                <span v-if="getOverdueInfo(o)" :class="getOverdueInfo(o).stampClass">{{ getOverdueInfo(o).stampText }}</span>
              </td>
              <td v-if="!auth.isProduction">{{ o.customer_name }}</td>
              <td>{{ o.project_name }}</td>
              <td>{{ o.product_model || '-' }}</td>
              <td>{{ o.quantity }}</td>
              <td v-if="!auth.isProduction">{{ o.contract_amount ? '¥' + Number(o.contract_amount).toLocaleString() : '-' }}</td>
              <td>{{ o.planned_delivery_date || '-' }}</td>
              <td><span class="status-badge" :class="'status-' + o.status">{{ statusText(o.status) }}</span></td>
              <td>
                <div class="progress-bar-bg"><div class="progress-bar-fill" :style="{ width: (o.progress || 0) + '%' }"></div></div>
                <span style="font-size:11px;color:var(--text-secondary)">{{ o.progress || 0 }}%</span>
              </td>
              <td>
                <button class="btn btn-outline btn-sm" @click="$router.push(`/orders/${o.id}`)">详情</button>
                <button v-if="auth.canManageOrders" class="btn btn-outline btn-sm" @click="openEdit(o.id)">编辑</button>
                
                <button v-if="auth.canDeleteOrder" class="btn btn-danger btn-sm" @click="deleteOrder(o.id)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
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
        <div class="form-group"><label>客户名称 *</label><input v-model="newOrder.customer_name" type="text" placeholder="签约客户公司名称"></div>
        <div class="form-group"><label>项目名称 *</label><input v-model="newOrder.project_name" type="text" placeholder="项目/产品名称"></div>
        <div class="form-group"><label>产品型号</label><input v-model="newOrder.product_model" type="text" placeholder="吹瓶机型号"></div>
        <div class="form-group"><label>数量</label><input v-model="newOrder.quantity" type="number" min="1"></div>
        <div class="form-group"><label>合同金额</label><input v-model="newOrder.contract_amount" type="number" step="0.01" placeholder="合同总金额"></div>
        <div class="form-group"><label>计划交货日期</label><input v-model="newOrder.planned_delivery_date" type="date"></div>
        <div class="form-group"><label>备注</label><textarea v-model="newOrder.notes" rows="2" placeholder="其他说明"></textarea></div>
        <div class="modal-actions">
          <button class="btn btn-outline" @click="showCreate = false">取消</button>
          <button class="btn btn-primary" @click="createOrder">创建订单</button>
        </div>
      </div>
    </div>

    <!-- 编辑订单弹窗 -->
    <OrderEditModal :visible="showEdit" :order="editForm" @close="showEdit = false" @save="updateOrder" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { useModalStore } from '@/stores/modal';
import { api } from '@/api';
import { getOverdueInfo, statusText } from '@/utils';
import OrderEditModal from '@/components/OrderEditModal.vue';

const auth = useAuthStore();
const toast = useToastStore();
const modal = useModalStore();

const search = ref('');
const status = ref('');
const dateFrom = ref('');
const dateTo = ref('');
const orders = ref([]);
const page = ref(1);
const total = ref(0);
const totalPages = ref(0);
const loading = ref(false);
const selectedOrders = ref(new Set());

const showCreate = ref(false);
const newOrder = ref({ customer_name: '', project_name: '', product_model: '', quantity: 1, contract_amount: '', planned_delivery_date: '', notes: '' });

const showEdit = ref(false);
const editId = ref(null);
const editForm = ref({});

const allSelected = computed(() => {
  return orders.value.length > 0 && orders.value.every(o => selectedOrders.value.has(o.id));
});

let pollTimer = null;

async function loadOrders(p = 1) {
  page.value = p;
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

async function createOrder() {
  if (!newOrder.value.customer_name || !newOrder.value.project_name) {
    toast.show('客户名称和项目名称为必填项', 'error');
    return;
  }
  try {
    const body = { ...newOrder.value, quantity: parseInt(newOrder.value.quantity) || 1, contract_amount: parseFloat(newOrder.value.contract_amount) || null };
    await api.post('/orders', body);
    toast.show('订单创建成功');
    showCreate.value = false;
    newOrder.value = { customer_name: '', project_name: '', product_model: '', quantity: 1, contract_amount: '', planned_delivery_date: '', notes: '' };
    loadOrders(1);
  } catch (e) {
    toast.show(e.message, 'error');
  }
}

async function openEdit(id) {
  try {
    const data = await api.get(`/orders/${id}`);
    const o = data.order;
    editId.value = id;
    editForm.value = { ...o };
    showEdit.value = true;
  } catch (e) {
    toast.show(e.message, 'error');
  }
}

async function updateOrder(formData) {
  if (!formData.customer_name || !formData.project_name) {
    toast.show('客户名称和项目名称为必填项', 'error');
    return;
  }
  try {
    const body = {
      customer_name: formData.customer_name,
      project_name: formData.project_name,
      product_model: formData.product_model || '',
      quantity: parseInt(formData.quantity) || 1,
      contract_amount: parseFloat(formData.contract_amount) || null,
      planned_delivery_date: formData.planned_delivery_date || null,
      actual_delivery_date: formData.actual_delivery_date || null,
      notes: formData.notes || ''
    };
    await api.put(`/orders/${editId.value}`, body);
    toast.show('订单更新成功');
    showEdit.value = false;
    loadOrders(page.value);
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
    orders.value.forEach(o => selectedOrders.value.add(o.id));
  } else {
    selectedOrders.value.clear();
  }
}

function clearBatch() {
  selectedOrders.value.clear();
}

async function batchExport() {
  if (selectedOrders.value.size === 0) {
    toast.show('请先选择订单', 'error');
    return;
  }
  const params = new URLSearchParams();
  selectedOrders.value.forEach(id => params.append('ids', id));
  await api.download(`/export/orders/batch?${params}`);
  toast.show('批量导出成功');
}

onMounted(() => {
  loadOrders(1);
  pollTimer = setInterval(() => loadOrders(page.value), 60000);
});
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<style scoped>
</style>
