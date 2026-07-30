<template>
  <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <h3>{{ title }}</h3>
      <div class="form-group"><label>客户名称</label><input v-model="form.customer_name" type="text"></div>
      <div class="form-group"><label>项目名称</label><input v-model="form.project_name" type="text"></div>
      <div class="form-group"><label>产品型号</label><input v-model="form.product_model" type="text"></div>
      <div class="form-group"><label>数量</label><input v-model.number="form.quantity" type="number" min="1"></div>
      <div class="form-group"><label>合同金额</label><input v-model.number="form.contract_amount" type="number" step="0.01"></div>
      <div class="form-group"><label>计划交货日期</label><input v-model="form.planned_delivery_date" type="date"></div>
      <div v-if="showActualDate" class="form-group"><label>实际交货日期</label><input v-model="form.actual_delivery_date" type="date"></div>
      <div class="form-group"><label>备注</label><textarea v-model="form.notes" rows="2"></textarea></div>
      <div class="modal-actions">
        <button class="btn btn-outline" @click="$emit('close')">取消</button>
        <button class="btn btn-primary" @click="handleSave">保存</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  visible: Boolean,
  title: { type: String, default: '编辑订单' },
  order: { type: Object, default: () => ({}) },
  showActualDate: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'save']);

const form = ref({});

watch(() => props.visible, (val) => {
  if (val && props.order) {
    form.value = { ...props.order };
  }
});

function handleSave() {
  if (!form.value.customer_name || !form.value.project_name) {
    return;
  }
  emit('save', { ...form.value });
}
</script>