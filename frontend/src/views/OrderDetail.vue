<template>
  <div v-if="order">
    <div v-if="overdueInfo" class="overdue-banner" :class="overdueInfo.cssClass === 'overdue-red' ? 'overdue-red-banner' : 'overdue-green-banner'">
      {{ overdueInfo.cssClass === 'overdue-red' ? '此订单已超期！计划交货日期 ' + order.planned_delivery_date + ' 已过，请尽快处理' : '此订单如期完成（实际 ' + order.actual_delivery_date + ' <= 计划 ' + order.planned_delivery_date + '）' }}
    </div>
    <div class="page-header">
      <h2>订单详情 - {{ order.order_no }}</h2>
      <div class="actions">
        <button class="btn btn-outline" @click="$router.push('/orders')">返回列表</button>
        <button class="btn btn-outline btn-sm" @click="openEdit">编辑</button>
        <button class="btn btn-outline btn-sm" @click="exportOrder">导出Excel</button>
        <button v-if="auth.canDeleteOrder" class="btn btn-danger btn-sm" @click="deleteOrder">删除订单</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">基本信息</div>
      <div class="detail-grid">
        <div class="detail-item"><div class="label">订单编号</div><div class="value">{{ order.order_no }}</div></div>
        <div v-if="!auth.isProduction" class="detail-item"><div class="label">客户名称</div><div class="value">{{ order.customer_name }}</div></div>
        <div class="detail-item"><div class="label">项目名称</div><div class="value">{{ order.project_name }}</div></div>
        <div class="detail-item"><div class="label">产品型号</div><div class="value">{{ order.product_model || '-' }}</div></div>
        <div class="detail-item"><div class="label">数量</div><div class="value">{{ order.quantity }}</div></div>
        <div v-if="!auth.isProduction" class="detail-item"><div class="label">合同金额</div><div class="value">{{ order.contract_amount ? '¥' + Number(order.contract_amount).toLocaleString() : '-' }}</div></div>
        <div class="detail-item"><div class="label">计划交货日期</div><div class="value">{{ order.planned_delivery_date || '-' }}</div></div>
        <div class="detail-item" :class="overdueInfo?.rowClass">
          <div class="label">实际交货日期<span v-if="overdueInfo" :class="overdueInfo.stampClass">{{ overdueInfo.stampText }}</span></div>
          <div class="value" :class="overdueInfo?.cssClass">{{ order.actual_delivery_date || '-' }}</div>
        </div>
        <div class="detail-item"><div class="label">订单状态</div><div class="value"><span class="status-badge" :class="'status-' + order.status">{{ statusText(order.status) }}</span></div></div>
        <div class="detail-item"><div class="label">创建人</div><div class="value">{{ order.creator_name || '-' }}</div></div>
        <div style="grid-column:1/-1;"><div class="label">备注</div><div class="value">{{ order.notes || '-' }}</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">流程进度</div>
      <ul class="stage-list">
        <template v-for="s in mainStages" :key="s.stage_key">
          <li class="stage-item" :class="[getOverdueInfo(s)?.rowClass]">
            <div class="stage-indicator" :class="s.status" :style="overdueStyle(getOverdueInfo(s))"></div>
            <div class="stage-info">
              <div class="stage-name">{{ s.stage_name }}<span v-if="getOverdueInfo(s)" :class="getOverdueInfo(s).stampClass">{{ getOverdueInfo(s).stampText }}</span></div>
              <div class="stage-dates">
                <span v-if="s.start_date">开始: {{ s.start_date }}</span>
                <span v-if="s.planned_end_date"> | 计划完成: {{ s.planned_end_date }}</span>
                <span v-if="s.actual_end_date"> | <span :class="getOverdueInfo(s)?.cssClass">实际完成: {{ s.actual_end_date }}</span></span>
                <span v-if="s.operator_name"> | 操作人: {{ s.operator_name }}</span>
              </div>
            </div>
            <span class="status-badge" :class="getOverdueInfo(s)?.cssClass === 'overdue-red' && s.status === 'completed' ? 'status-overdue-completed' : 'status-' + s.status">
              {{ getOverdueInfo(s)?.cssClass === 'overdue-red' && s.status === 'completed' ? '超期完成' : statusText(s.status) }}
            </span>
            <div class="stage-actions">
              <template v-if="auth.canOperateStage(s)">
                <button v-if="s.status === 'pending'" class="btn btn-success btn-sm" @click="updateStage(s, 'in_progress')">开始</button>
                <button v-if="s.status === 'in_progress'" class="btn btn-primary btn-sm" @click="updateStage(s, 'completed')">完成</button>
                <button v-if="!s.start_date || !s.planned_end_date || auth.isAdmin || auth.isManagement" class="btn btn-outline btn-sm" @click="showTimeModal(s)">⏱</button>
              </template>
              <span v-else-if="!auth.isUserDept(s.department_id)" style="font-size:11px;color:var(--text-secondary)">无权限</span>
            </div>
          </li>
          <!-- 生产制造子流程 -->
          <div v-if="s.stage_key === 'production_order'" class="sub-stages" :style="canShowSubStages ? '' : 'display:none'">
            <template v-for="(ps, pIdx) in productionStages" :key="ps.stage_key">
              <!-- 物料采购并行分组标识 -->
              <div v-if="pIdx > 0 && isPurchaseStage(ps) && !isPurchaseStage(productionStages[pIdx - 1])" class="purchase-group-header">
                === 物料采购（并行） ===
              </div>
              <li class="stage-item sub-stage" :class="[getOverdueInfo(ps)?.rowClass]">
                <div class="stage-indicator" :class="ps.status" :style="overdueStyle(getOverdueInfo(ps))"></div>
                <div class="stage-info">
                  <div class="stage-name">→ {{ ps.stage_name }}<span v-if="getOverdueInfo(ps)" :class="getOverdueInfo(ps).stampClass">{{ getOverdueInfo(ps).stampText }}</span></div>
                  <div class="stage-dates">
                    <template v-if="isPurchaseStage(ps)">
                      <span v-if="ps.start_date">下单时间: {{ ps.start_date }}</span>
                      <span v-if="ps.planned_end_date"> | 计划到货: {{ ps.planned_end_date }}</span>
                      <span v-if="ps.actual_end_date"> | <span :class="getOverdueInfo(ps)?.cssClass">到货时间: {{ ps.actual_end_date }}</span></span>
                    </template>
                    <template v-else>
                      <span v-if="ps.start_date">开始: {{ ps.start_date }}</span>
                      <span v-if="ps.planned_end_date"> | 计划完成: {{ ps.planned_end_date }}</span>
                      <span v-if="ps.actual_end_date"> | <span :class="getOverdueInfo(ps)?.cssClass">实际完成: {{ ps.actual_end_date }}</span></span>
                    </template>
                    <span v-if="ps.operator_name"> | 操作人: {{ ps.operator_name }}</span>
                  </div>
                </div>
                <span class="status-badge" :class="getOverdueInfo(ps)?.cssClass === 'overdue-red' && ps.status === 'completed' ? 'status-overdue-completed' : 'status-' + ps.status">
                  {{ getOverdueInfo(ps)?.cssClass === 'overdue-red' && ps.status === 'completed' ? '超期完成' : statusText(ps.status) }}
                </span>
                <div class="stage-actions">
                  <template v-if="auth.canOperateStage(ps)">
                    <button v-if="ps.status === 'pending'" class="btn btn-success btn-sm" @click="updateStage(ps, 'in_progress')">开始</button>
                    <button v-if="ps.status === 'in_progress'" class="btn btn-primary btn-sm" @click="updateStage(ps, 'completed')">完成</button>
                    <button v-if="ps.status === 'in_progress'" class="btn btn-warning btn-sm" @click="updateStage(ps, 'delayed')">延期</button>
                    <button v-if="ps.status === 'delayed'" class="btn btn-success btn-sm" @click="updateStage(ps, 'in_progress')">恢复</button>
                    <button v-if="ps.status === 'delayed'" class="btn btn-primary btn-sm" @click="updateStage(ps, 'completed')">完成</button>
                    <button v-if="!ps.start_date || !ps.planned_end_date || auth.isAdmin || auth.isManagement" class="btn btn-outline btn-sm" @click="showTimeModal(ps)">⏱</button>
                  </template>
                  <span v-else-if="!auth.isUserDept(ps.department_id)" style="font-size:11px;color:var(--text-secondary)">无权限</span>
                </div>
              </li>
            </template>
          </div>
        </template>
      </ul>
    </div>

    <!-- 附件 -->
    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
        <span>附件</span>
        <label class="btn btn-primary btn-sm" style="cursor:pointer;">
          + 上传文件
          <input type="file" hidden @change="onFileSelect" accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.txt,.png,.jpg,.jpeg,.gif,.webp,.bmp">
        </label>
      </div>
      <div v-if="uploading" style="text-align:center;padding:20px;color:var(--text-secondary);font-size:13px;">上传中...</div>
      <div v-else-if="files.length === 0" style="text-align:center;padding:20px;color:var(--text-secondary);font-size:13px;">暂无附件</div>
      <div v-else class="file-list">
        <div v-for="f in files" :key="f.id" class="file-item">
          <div v-if="isImage(f.mime_type)" class="file-thumb" @click="previewImage(f)">
            <img :src="getPreviewUrl(f.id)" :alt="f.original_name" loading="lazy">
          </div>
          <div v-else class="file-icon">{{ fileIcon(f.mime_type) }}</div>
          <div class="file-info">
            <div class="file-name" :title="f.original_name">{{ f.original_name }}</div>
            <div class="file-meta">{{ formatSize(f.file_size) }} · {{ f.uploader_name || '未知' }} · {{ f.created_at?.slice(0,16) }}</div>
          </div>
          <div class="file-actions">
            <button class="btn btn-outline btn-sm" @click="downloadFile(f.id)">下载</button>
            <button v-if="canDeleteFile(f)" class="btn btn-danger btn-sm" @click="removeFile(f.id)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <OrderEditModal :visible="showEdit" :order="editForm" :show-actual-date="true" @close="showEdit = false" @save="saveEdit" />

    <!-- 时间设置弹窗 -->
    <div v-if="timeModal.visible" class="modal-overlay" @click.self="timeModal.visible = false">
      <div class="modal">
        <h3>设置时间 - {{ timeModal.stageName }}</h3>
        <div class="form-group"><label>{{ timeModal.isPurchase ? '下单时间' : '开始时间' }}</label><input v-model="timeModal.startDate" type="datetime-local"></div>
        <div class="form-group"><label>{{ timeModal.isPurchase ? '计划到货时间' : '计划完成时间' }}</label><input v-model="timeModal.plannedEnd" type="datetime-local"></div>
        <div class="modal-actions">
          <button class="btn btn-outline" @click="timeModal.visible = false">取消</button>
          <button class="btn btn-primary" @click="saveTime">保存</button>
        </div>
      </div>
    </div>

    <!-- 图片预览弹窗 -->
    <div v-if="previewModal.visible" class="modal-overlay" @click.self="previewModal.visible = false">
      <div class="image-preview-modal">
        <div class="image-preview-header">
          <span>{{ previewModal.file?.original_name }}</span>
          <button class="btn btn-outline btn-sm" @click="previewModal.visible = false">关闭</button>
        </div>
        <div class="image-preview-body">
          <img v-if="previewModal.file" :src="getPreviewUrl(previewModal.file.id)" :alt="previewModal.file.original_name">
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
import { uploadFile, getFiles, deleteFile, getDownloadUrl } from '@/api';
import { getOverdueInfo, statusText } from '@/utils';
import OrderEditModal from '@/components/OrderEditModal.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToastStore();
const modal = useModalStore();

const order = ref(null);
const stages = ref([]);
const showEdit = ref(false);
const editForm = ref({});

const timeModal = ref({ visible: false, orderId: null, stageKey: '', stageName: '', startDate: '', plannedEnd: '' });
const files = ref([]);
const uploading = ref(false);
const previewModal = ref({ visible: false, file: null });

const PURCHASE_STAGE_KEYS = ['purchase_frame', 'purchase_mold_frame', 'purchase_electrical', 'purchase_cover'];
function isPurchaseStage(stage) { return stage && PURCHASE_STAGE_KEYS.includes(stage.stage_key); }

const mainStages = computed(() => stages.value.filter(s => !s.parent_stage_key));
const productionStages = computed(() => stages.value.filter(s => s.parent_stage_key === 'production'));
const canShowSubStages = computed(() => {
  const prodOrder = mainStages.value.find(s => s.stage_key === 'production_order');
  return prodOrder && prodOrder.status !== 'pending';
});

const overdueInfo = computed(() => getOverdueInfo(order.value));

function overdueStyle(oi) {
  if (!oi) return '';
  const color = oi.cssClass === 'overdue-red' ? '#dc2626' : '#16a34a';
  return `background:${color};box-shadow:0 0 0 2px ${color};`;
}

let pollTimer = null;

async function load() {
  try {
    const data = await api.get(`/orders/${route.params.id}`);
    order.value = data.order;
    stages.value = data.stages || [];
    loadFiles();
  } catch (e) {
    toast.show(e.message, 'error');
  }
}

async function loadFiles() {
  try {
    const data = await getFiles(route.params.id);
    files.value = data.files || [];
  } catch {}
}

async function onFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  uploading.value = true;
  try {
    await uploadFile(order.value.id, file);
    toast.show('文件上传成功');
    loadFiles();
  } catch (e) {
    toast.show(e.message, 'error');
  } finally {
    uploading.value = false;
    e.target.value = '';
  }
}

function downloadFile(id) {
  fetch(`/api/files/${id}/download`, {
    headers: { Authorization: `Bearer ${sessionStorage.getItem('token')}` }
  }).then(r => {
    if (!r.ok) throw new Error('下载失败');
    return r.blob();
  }).then(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const disp = blob.type || 'application/octet-stream';
    a.download = 'file';
    a.click();
    URL.revokeObjectURL(a.href);
  }).catch(e => toast.show(e.message, 'error'));
}

function removeFile(id) {
  modal.open({
    title: '确认删除',
    content: '<p style="margin:16px 0;color:var(--text-secondary);">确定要删除此文件吗？</p>',
    showConfirm: true,
    onConfirm: async () => {
      try {
        await deleteFile(id);
        toast.show('文件已删除');
        loadFiles();
      } catch (e) {
        toast.show(e.message, 'error');
      }
    }
  });
}

function canDeleteFile(f) {
  if (!auth.user) return false;
  return auth.isAdmin || auth.isManagement || f.uploaded_by === auth.user.id;
}

function fileIcon(mime) {
  if (!mime) return '📄';
  if (mime.startsWith('image/')) return '🖼';
  if (mime.includes('pdf')) return '📕';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return '📊';
  if (mime.includes('zip') || mime.includes('rar')) return '📦';
  return '📄';
}

function isImage(mime) {
  return mime && mime.startsWith('image/');
}

function getPreviewUrl(fileId) {
  const token = sessionStorage.getItem('token');
  return `/api/files/${fileId}/preview?token=${token}`;
}

function previewImage(file) {
  previewModal.value = { visible: true, file };
}

function formatSize(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function updateStage(stage, status) {
  // 点击"开始"时，检查是否已设置时间
  if (status === 'in_progress' && stage.status === 'pending' && (!stage.start_date || !stage.planned_end_date)) {
    toast.show('请先设置开始时间和计划完成时间', 'error');
    showTimeModal(stage);
    return;
  }
  try {
    await api.put(`/orders/${order.value.id}/stages/${stage.stage_key}`, { status });
    toast.show('流程状态更新成功');
    load();
  } catch (e) {
    toast.show(e.message, 'error');
  }
}

function showTimeModal(stage) {
  timeModal.value = {
    visible: true, orderId: order.value.id, stageKey: stage.stage_key,
    stageName: stage.stage_name, startDate: stage.start_date || '', plannedEnd: stage.planned_end_date || '',
    isPurchase: isPurchaseStage(stage)
  };
}

async function saveTime() {
  try {
    await api.put(`/orders/${timeModal.value.orderId}/stages/${timeModal.value.stageKey}/time`, {
      start_date: timeModal.value.startDate, planned_end_date: timeModal.value.plannedEnd
    });
    toast.show('时间更新成功');
    timeModal.value.visible = false;
    load();
  } catch (e) {
    toast.show(e.message, 'error');
  }
}

function openEdit() {
  editForm.value = { ...order.value };
  showEdit.value = true;
}

async function saveEdit(formData) {
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
    await api.put(`/orders/${order.value.id}`, body);
    toast.show('订单更新成功');
    showEdit.value = false;
    load();
  } catch (e) {
    toast.show(e.message, 'error');
  }
}

function deleteOrder() {
  modal.open({
    title: '确认操作',
    content: `<p style="margin:16px 0;color:var(--text-secondary);">确定要删除此订单吗？此操作不可撤销！</p>`,
    showConfirm: true,
    onConfirm: async () => {
      try {
        await api.del(`/orders/${order.value.id}`);
        toast.show('订单已删除');
        router.push('/orders');
      } catch (e) {
        toast.show(e.message, 'error');
      }
    }
  });
}

async function exportOrder() {
  try {
    await api.download(`/export/order/${order.value.id}`);
    toast.show('导出成功');
  } catch (e) {
    toast.show(e.message, 'error');
  }
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
.file-thumb {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  flex-shrink: 0;
  background: var(--bg-secondary, #f5f5f5);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border, #e0e0e0);
  transition: transform 0.2s, box-shadow 0.2s;
}
.file-thumb:hover {
  transform: scale(1.05);
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}
.file-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-preview-modal {
  background: #fff;
  border-radius: 8px;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.image-preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, #e0e0e0);
  font-weight: 500;
  gap: 16px;
}
.image-preview-header span {
  max-width: 400px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.image-preview-body {
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  background: #f9f9f9;
}
.image-preview-body img {
  max-width: 100%;
  max-height: calc(90vh - 100px);
  object-fit: contain;
  border-radius: 4px;
 box-shadow: 0 2px 12px rgba(0,0,0,0.1);
}
.purchase-group-header {
  padding: 8px 0 4px 0;
  font-size: 12px;
  font-weight: 600;
  color: #f59e0b;
  letter-spacing: 1px;
  text-align: center;
  border-top: 1px dashed #e5e7eb;
  margin-top: 8px;
}
</style>

