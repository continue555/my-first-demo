import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useModalStore = defineStore('modal', () => {
  const visible = ref(false);
  const title = ref('');
  const content = ref(null);
  const confirmCallback = ref(null);
  const showConfirmBtn = ref(false);

  function open({ title: t = '', content: c = null, onConfirm = null, showConfirm = false }) {
    title.value = t;
    content.value = c;
    confirmCallback.value = onConfirm;
    showConfirmBtn.value = showConfirm;
    visible.value = true;
  }

  function close() {
    visible.value = false;
    title.value = '';
    content.value = null;
    confirmCallback.value = null;
    showConfirmBtn.value = false;
  }

  function confirm() {
    if (confirmCallback.value) confirmCallback.value();
    close();
  }

  return { visible, title, content, confirmCallback, showConfirmBtn, open, close, confirm };
});
