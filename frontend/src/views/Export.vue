<template>
  <div>
    <div class="page-header"><h2>数据导出</h2></div>
    <div v-if="loading" class="empty-state">
      <div class="icon">⏳</div>
      <p>正在导出，请稍候...</p>
    </div>
    <div v-else class="export-options">
      <div class="export-card" @click="exportAll">
        <div class="icon">📊</div>
        <h4>导出全部订单</h4>
        <p>导出所有订单的基本信息及完整流程数据</p>
      </div>
      <div class="export-card" @click="showStatus = true">
        <div class="icon">📋</div>
        <h4>按状态导出</h4>
        <p>选择特定状态的订单进行导出</p>
      </div>
    </div>
    <div v-if="showStatus && !loading" class="card" style="margin-top:20px;">
      <div class="card-title">选择状态导出</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn btn-outline" @click="exportByStatus('')">全部</button>
        <button class="btn btn-outline" @click="exportByStatus('pending')">未开始</button>
        <button class="btn btn-outline" @click="exportByStatus('in_progress')">进行中</button>
        <button class="btn btn-outline" @click="exportByStatus('completed')">已完成</button>
        <button class="btn btn-outline" @click="exportByStatus('delayed')">已延期</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { api } from '@/api';
import { useToastStore } from '@/stores/toast';

const toast = useToastStore();
const showStatus = ref(false);
const loading = ref(false);

async function exportAll() {
  loading.value = true;
  try {
    await api.download('/export/orders');
    toast.show('导出成功');
  } catch (e) {
    toast.show(e.message, 'error');
  } finally {
    loading.value = false;
  }
}

async function exportByStatus(status) {
  loading.value = true;
  try {
    await api.download(`/export/orders${status ? '?status=' + status : ''}`);
    toast.show('导出成功');
  } catch (e) {
    toast.show(e.message, 'error');
  } finally {
    loading.value = false;
  }
}
</script>
