<template>
  <div v-if="loading" class="detail-state">
    <div class="detail-spinner"></div>
    <p>加载中...</p>
  </div>
  <div v-else-if="loadError" class="detail-state detail-error">
    <p>{{ loadError }}</p>
    <button class="btn btn-primary" @click="retry">重试</button>
  </div>
  <div v-else-if="!order" class="detail-state">
    <p>暂无订单数据</p>
  </div>
  <div v-else>
    <div v-if="overdueInfo" class="overdue-banner" :class="overdueInfo.cssClass === 'overdue-red' ? 'overdue-red-banner' : 'overdue-green-banner'">
      {{ overdueInfo.cssClass === 'overdue-red' ? '此订单已超期！计划交货日期 ' + order.planned_delivery_date + ' 已过，请尽快处理' : '此订单如期完成（实际 ' + order.actual_delivery_date + ' <= 计划 ' + order.planned_delivery_date + '）' }}
    </div>
    <div class="page-header">
      <h2>订单详情 - {{ order.order_no }}</h2>
      <div class="actions">
        <button class="btn btn-outline" @click="backToList">返回列表</button>
        <button class="btn btn-outline btn-sm" @click="exportOrder">导出Excel</button>
        <button v-if="auth.canDeleteOrder" class="btn btn-danger btn-sm" @click="deleteOrder">删除订单</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
        <span>基本信息</span>
        <label v-if="auth.isAdmin || auth.isManagement || auth.isSales" class="btn btn-primary btn-sm" style="cursor:pointer;">
          + 上传文件
          <input type="file" hidden @change="onFileSelect" accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.txt,.png,.jpg,.jpeg,.gif,.webp,.bmp">
        </label>
      </div>
      <div class="detail-grid">
        <div class="detail-item"><div class="label">订单编号</div><div class="value">{{ order.order_no }}</div></div>
        <div class="detail-item"><div class="label">计划交货日期</div><div class="value">{{ order.planned_delivery_date || '-' }}</div></div>
        <div class="detail-item" :class="overdueInfo?.rowClass">
          <div class="label">实际发货时间<span v-if="overdueInfo" :class="overdueInfo.stampClass">{{ overdueInfo.stampText }}</span></div>
          <div class="value" :class="overdueInfo?.cssClass">{{ order.actual_delivery_date || '-' }}</div>
        </div>
        <div class="detail-item"><div class="label">订单状态</div><div class="value"><span class="status-badge" :class="'status-' + order.status">{{ statusText(order.status) }}</span></div></div>
        <div class="detail-item"><div class="label">创建人</div><div class="value">{{ order.creator_name || '-' }}</div></div>
      </div>
      <div class="attachment-section">
        <div class="attachment-title">附件</div>
        <div v-if="uploading" style="text-align:center;padding:12px 0;color:var(--text-secondary);font-size:13px;">
          上传中... {{ uploadProgress }}%
          <div style="height:6px;background:#e5e7eb;border-radius:3px;max-width:300px;margin:8px auto;overflow:hidden;">
            <div :style="{ width: uploadProgress + '%', height: '100%', background: '#1a73e8' }"></div>
          </div>
        </div>
        <div v-else-if="files.length === 0" style="text-align:center;padding:12px 0;color:var(--text-secondary);font-size:13px;">暂无附件</div>
        <div v-else class="file-list">
          <div v-for="f in files" :key="f.id" class="file-item">
            <button v-if="isImage(f.mime_type)" type="button" class="file-thumb" :aria-label="'预览附件 ' + f.original_name" @click="previewImage(f)">
              <img v-if="f.previewUrl" :src="f.previewUrl" :alt="f.original_name" loading="lazy">
            </button>
            <div v-else class="file-icon">{{ fileIcon(f.mime_type) }}</div>
            <div class="file-info">
              <div class="file-name" :title="f.original_name">{{ f.original_name }}</div>
              <div class="file-meta">{{ formatSize(f.file_size) }} · {{ f.uploader_name || '未知' }} · {{ f.created_at?.slice(0,16) }}</div>
            </div>
            <div class="file-actions">
              <button v-if="canPreview(f)" class="btn btn-outline btn-sm" @click="previewDocument(f)">预览</button>
              <button class="btn btn-outline btn-sm" @click="downloadFile(f)">下载</button>
              <button v-if="canDeleteFile(f)" class="btn btn-danger btn-sm" @click="removeFile(f.id)">删除</button>
            </div>
          </div>
        </div>
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
                <span v-if="s.start_date">开始: {{ fmtDate(s.start_date) }}</span>
                <span v-if="s.planned_end_date"> | 计划完成: {{ fmtDate(s.planned_end_date) }}</span>
                <span v-if="s.actual_end_date"> | <span :class="getOverdueInfo(s)?.cssClass">实际完成: {{ fmtDate(s.actual_end_date) }}</span></span>
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
                <button v-if="!s.start_date || !s.planned_end_date || auth.isAdmin || auth.isManagement" class="btn btn-outline btn-sm" aria-label="设置时间" @click="showTimeModal(s)">⏱</button>
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
                      <span v-if="ps.start_date">下单时间: {{ fmtDate(ps.start_date) }}</span>
                      <span v-if="ps.planned_end_date"> | 计划到货: {{ fmtDate(ps.planned_end_date) }}</span>
                      <span v-if="ps.actual_end_date"> | <span :class="getOverdueInfo(ps)?.cssClass">完成时间: {{ fmtDate(ps.actual_end_date) }}</span></span>
                    </template>
                    <template v-else>
                      <span v-if="ps.start_date">开始: {{ fmtDate(ps.start_date) }}</span>
                      <span v-if="ps.planned_end_date"> | 计划完成: {{ fmtDate(ps.planned_end_date) }}</span>
                      <span v-if="ps.actual_end_date"> | <span :class="getOverdueInfo(ps)?.cssClass">{{ isFollowUpStage(ps) ? '实际到货时间: ' + fmtDate(ps.actual_end_date) : '实际完成: ' + fmtDate(ps.actual_end_date) }}</span></span>
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
                    <button v-if="!ps.start_date || !ps.planned_end_date || auth.isAdmin || auth.isManagement" class="btn btn-outline btn-sm" aria-label="设置时间" @click="showTimeModal(ps)">⏱</button>
                  </template>
                  <span v-else-if="!auth.isUserDept(ps.department_id)" style="font-size:11px;color:var(--text-secondary)">无权限</span>
                </div>
              </li>
            </template>
          </div>
        </template>
      </ul>
    </div>

    <!-- 时间设置弹窗 -->
    <div v-if="timeModal.visible" class="modal-overlay" @click.self="timeModal.visible = false">
      <div class="modal">
        <h3>设置时间 - {{ timeModal.stageName }}</h3>
        <div class="form-group"><label>{{ timeModal.isPurchase ? '下单日期' : '开始日期' }}</label><input v-model="timeModal.startDate" type="date"></div>
        <div class="form-group">
          <label>{{ timeModal.isPurchase ? '计划到货日期' : '计划完成日期' }}</label>
          <input v-model="timeModal.plannedEnd" type="date" :disabled="timeModal.plannedLocked">
          <div v-if="timeModal.plannedLocked" class="time-lock-hint">由采购计划到货自动生成，无需手动填写</div>
        </div>
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
          <img v-if="previewModal.file?.previewUrl" :src="previewModal.file.previewUrl" :alt="previewModal.file.original_name">
        </div>
      </div>
    </div>
    <div v-if="docPreview.visible" class="modal-overlay" @click.self="closeDocPreview()">
      <div class="doc-preview-modal">
        <div class="image-preview-header">
          <span>{{ docPreview.file?.original_name }}</span>
          <button class="btn btn-outline btn-sm" @click="closeDocPreview()">关闭</button>
        </div>
        <div v-if="docPreview.type === 'pdf' && docPreview.url" class="doc-preview-body pdf">
          <iframe :src="docPreview.url"></iframe>
        </div>
        <div v-else class="doc-preview-body">
          <div v-if="docLoading" style="text-align:center;color:var(--text-secondary);padding:40px 0;">加载中...</div>
          <div ref="docPreviewBody"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { useModalStore } from '@/stores/modal';
import { api } from '@/api';
import { uploadFile, getFiles, deleteFile, getFilePreviewTicket } from '@/api';
import { getOverdueInfo, statusText } from '@/utils';
import { navigateTo } from '@/utils/navigation';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToastStore();
const modal = useModalStore();

const order = ref(null);
const stages = ref([]);
const loading = ref(true);
const loadError = ref('');

const timeModal = ref({ visible: false, orderId: null, stageKey: '', stageName: '', startDate: '', plannedEnd: '' });
const files = ref([]);
const uploading = ref(false);
const uploadProgress = ref(0);
const previewModal = ref({ visible: false, file: null });
const docPreview = ref({ visible: false, file: null, type: null, url: null });
const docPreviewBody = ref(null);
let docxFitTimer = null;
const docLoading = ref(false);

const PURCHASE_STAGE_KEYS = ['purchase_frame', 'purchase_mold_frame', 'purchase_electrical', 'purchase_cover', 'mold_design_purchase'];
function isPurchaseStage(stage) { return stage && PURCHASE_STAGE_KEYS.includes(stage.stage_key); }
const FOLLOW_UP_STAGE_KEYS = ['frame_follow_up', 'mold_frame_follow_up', 'electrical_follow_up', 'cover_follow_up', 'mold_design_follow_up'];
function isFollowUpStage(stage) { return stage && FOLLOW_UP_STAGE_KEYS.includes(stage.stage_key); }

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

function fmtDate(v) {
  return v ? String(v).slice(0, 10) : '';
}

let pollTimer = null;

async function load() {
  if (!order.value) loading.value = true;
  loadError.value = '';
  try {
    const data = await api.get(`/orders/${route.params.id}`);
    order.value = data.order;
    stages.value = data.stages || [];
    loadFiles();
  } catch (e) {
    loadError.value = e.message;
    toast.show(e.message, 'error');
  } finally {
    loading.value = false;
  }
}

function retry() {
  load();
}

function backToList() {
  navigateTo('/orders');
}

async function loadFiles() {
  try {
    const data = await getFiles(route.params.id);
    files.value = data.files || [];
    for (const f of files.value) {
      if (isImage(f.mime_type)) {
        getFilePreviewTicket(f.id)
          .then(url => { f.previewUrl = url; })
          .catch(() => {});
      }
    }
  } catch {}
}

async function onFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  uploading.value = true;
  uploadProgress.value = 0;
  try {
    await uploadFile(order.value.id, file, undefined, progress => { uploadProgress.value = progress; });
    toast.show('文件上传成功');
    loadFiles();
  } catch (e) {
    toast.show(e.message, 'error');
  } finally {
    uploading.value = false;
    uploadProgress.value = 0;
    e.target.value = '';
  }
}

function downloadFile(f) {
  const headers = {};
  const token = sessionStorage.getItem('token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  fetch(`/api/files/${f.id}/download`, { headers }).then(r => {
    if (!r.ok) throw new Error('下载失败');
    return r.blob();
  }).then(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const disp = blob.type || 'application/octet-stream';
    a.download = f.original_name || 'file';
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
  return auth.isAdmin || auth.isManagement;
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

function previewImage(file) {
  previewModal.value = { visible: true, file };
}

function getPreviewType(f) {
  if (!f) return null;
  const name = (f?.original_name || '').toLowerCase();
  if (isImage(f.mime_type)) return 'image';
  if (f.mime_type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (f.mime_type?.includes('word') || name.endsWith('.doc') || name.endsWith('.docx')) return 'word';
  if (f.mime_type?.includes('sheet') || f.mime_type?.includes('excel') || /\.(xlsx?|csv)$/.test(name)) return 'excel';
  if (f.mime_type?.startsWith('text/') || name.endsWith('.txt')) return 'text';
  return null;
}

function canPreview(f) {
  return !!getPreviewType(f);
}

async function previewDocument(file) {
  const type = getPreviewType(file);
  if (!type || type === 'image') return;
  resetDocxFit();
  docPreview.value = { visible: true, file, type, url: null };
  if (!route.query.preview) {
    router.push({ query: { ...route.query, preview: String(file.id) } });
  }
  docLoading.value = true;
  try {
    const url = await getFilePreviewTicket(file.id);
    if (type === 'pdf') {
      docPreview.value.url = url;
      return;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error('预览失败');
    await new Promise(r => setTimeout(r, 50));
    if (docPreviewBody.value) docPreviewBody.value.innerHTML = '';
    if (type === 'word') {
      const blob = await res.blob();
      const { renderAsync } = await import('docx-preview');
      await renderAsync(blob, docPreviewBody.value, undefined, {
        className: 'docx',
        ignoreWidth: true,
        ignoreHeight: true,
        breakPages: false
      });
      fitDocxToContainer();
      docxFitTimer = setTimeout(() => {
        resetDocxFit();
        fitDocxToContainer();
      }, 600);
      window.addEventListener('resize', onPreviewResize);
    } else if (type === 'excel') {
      const name = (file.original_name || '').toLowerCase();
      if (name.endsWith('.csv')) {
        docPreviewBody.value.textContent = await res.text();
      } else if (name.endsWith('.xlsx')) {
        const readXlsxFile = (await import('read-excel-file')).default;
        const rows = await readXlsxFile(await res.arrayBuffer());
        const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        docPreviewBody.value.innerHTML = '<table><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
      } else {
        docPreviewBody.value.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:40px 0;">旧版 Excel 文件暂不支持在线预览，请下载后查看</div>';
      }
    } else if (type === 'text') {
      docPreviewBody.value.textContent = await res.text();
    }
  } catch (e) {
    toast.show(e.message, 'error');
  } finally {
    docLoading.value = false;
  }
}

function fitDocxToContainer() {
  const body = docPreviewBody.value;
  const docx = body?.querySelector('.docx');
  if (!body || !docx || !window.matchMedia('(max-width: 768px)').matches) return;
  const wrapper = docx.parentElement?.classList.contains('docx-wrapper') ? docx.parentElement : null;
  if (wrapper) {
    wrapper.style.padding = '0';
    wrapper.style.background = 'transparent';
  }
  docx.style.alignSelf = 'flex-start';
  requestAnimationFrame(() => {
    const docxRect = docx.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    let minLeft = docxRect.left;
    let maxRight = docxRect.right;
    for (const el of docx.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.left < minLeft) minLeft = r.left;
      if (r.right > maxRight) maxRight = r.right;
    }
    const contentWidth = maxRight - minLeft;
    const availableWidth = body.clientWidth - 32;
    const scale = contentWidth > availableWidth ? availableWidth / contentWidth : 1;
    const targetLeft = bodyRect.left + 16;
    const scaledMinLeft = docxRect.left + (minLeft - docxRect.left) * scale;
    const shift = targetLeft - scaledMinLeft;
    docx.style.transformOrigin = 'top left';
    docx.style.transform = scale < 1 ? `translate(${shift}px, 0) scale(${scale})` : '';
    body.style.height = scale < 1 ? `${Math.ceil(docxRect.height * scale)}px` : '';
    body.style.overflowX = scale < 1 ? 'hidden' : '';
  });
}

function resetDocxFit() {
  if (docxFitTimer) {
    clearTimeout(docxFitTimer);
    docxFitTimer = null;
  }
  const body = docPreviewBody.value;
  const docx = body?.querySelector('.docx');
  const wrapper = body?.querySelector('.docx-wrapper');
  if (wrapper) {
    wrapper.style.padding = '';
    wrapper.style.background = '';
  }
  if (docx) {
    docx.style.transform = '';
    docx.style.transformOrigin = '';
    docx.style.alignSelf = '';
  }
  if (body) {
    body.style.height = '';
    body.style.overflowX = '';
  }
}

function onPreviewResize() {
  resetDocxFit();
  fitDocxToContainer();
}

function closeDocPreview({ fromRoute = false } = {}) {
  resetDocxFit();
  window.removeEventListener('resize', onPreviewResize);
  docPreview.value.visible = false;
  if (!fromRoute && route.query.preview) {
    router.back();
  }
}

watch(() => route.query.preview, (preview) => {
  if (!preview && docPreview.value.visible) {
    closeDocPreview({ fromRoute: true });
  }
});

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
    isPurchase: isPurchaseStage(stage),
    plannedLocked: isFollowUpStage(stage) || stage.stage_key === 'material_in'
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

function deleteOrder() {
  modal.open({
    title: '确认操作',
    content: `<p style="margin:16px 0;color:var(--text-secondary);">确定要删除此订单吗？此操作不可撤销！</p>`,
    showConfirm: true,
    onConfirm: async () => {
      try {
        await api.del(`/orders/${order.value.id}`);
        toast.show('订单已删除');
        navigateTo('/orders');
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
  window.removeEventListener('resize', onPreviewResize);
  resetDocxFit();
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
  appearance: none;
  font-family: inherit;
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
  margin: 12px 0 4px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 700;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 999px;
  text-align: center;
  letter-spacing: 0;
}
.detail-state {
  padding: 64px 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 14px;
}
.detail-state p { margin: 0 0 16px; }
.detail-spinner {
  width: 34px;
  height: 34px;
  margin: 0 auto 14px;
  border: 3px solid #dbeafe;
  border-top-color: #1a73e8;
  border-radius: 50%;
  animation: detail-spin 0.8s linear infinite;
}
@keyframes detail-spin { to { transform: rotate(360deg); } }
.attachment-section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border, #e5e7eb);
}
.attachment-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
}
.time-lock-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}
.doc-preview-modal {
  background: #fff;
  border-radius: 8px;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.doc-preview-body {
  padding: 16px;
  overflow: auto;
  background: #f8fafc;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}
.doc-preview-body :deep(.docx) {
  overflow: visible;
}
.doc-preview-body.pdf {
  padding: 0;
}
.doc-preview-body.pdf iframe {
  width: 100%;
  height: 70vh;
  border: 0;
}
@media (max-width: 768px) {
  .doc-preview-modal {
    width: 100vw;
    max-width: 100vw;
    height: 100vh;
    max-height: 100vh;
    border-radius: 0;
  }
  .doc-preview-body.pdf iframe {
    height: calc(100vh - 49px);
  }
}
</style>
