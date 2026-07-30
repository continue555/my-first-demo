<template>
  <div class="toast-container">
    <transition-group name="toast">
      <div
        v-for="item in toast.messages"
        :key="item.id"
        class="toast"
        :class="`toast-${item.type}`"
      >
        {{ item.msg }}
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { useToastStore } from '@/stores/toast';
const toast = useToastStore();
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.toast {
  padding: 14px 24px;
  border-radius: 8px;
  color: #fff;
  font-size: 14px;
  max-width: 400px;
  animation: slideIn 0.3s ease;
}
.toast-success { background: #0d9488; }
.toast-error { background: #ef4444; }
.toast-warning { background: #f59e0b; }

@keyframes slideIn {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

.toast-enter-active, .toast-leave-active { transition: all 0.3s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(100%); }
</style>
