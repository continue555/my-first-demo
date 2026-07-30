import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useToastStore = defineStore('toast', () => {
  const messages = ref([]);
  let id = 0;

  function show(msg, type = 'success') {
    const item = { id: ++id, msg, type };
    messages.value.push(item);
    setTimeout(() => {
      messages.value = messages.value.filter(m => m.id !== item.id);
    }, 3000);
  }

  return { messages, show };
});
