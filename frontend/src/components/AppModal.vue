<template>
  <transition name="fade">
    <div v-if="modal.visible" class="modal-overlay" @click.self="modal.close">
      <div class="modal">
        <h3 v-if="modal.title">{{ modal.title }}</h3>
        <component :is="modal.content" v-if="typeof modal.content === 'object'" />
        <div v-else-if="modal.content" v-html="modal.content" />
        <div v-if="modal.showConfirmBtn" class="modal-actions">
          <button class="btn btn-outline" @click="modal.close">取消</button>
          <button class="btn btn-danger" @click="modal.confirm">确认</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { useModalStore } from '@/stores/modal';
const modal = useModalStore();
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  width: 560px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  padding: 32px;
}
.modal h3 { font-size: 18px; margin-bottom: 20px; }
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
