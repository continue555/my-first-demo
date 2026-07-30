<template>
  <div id="app">
    <router-view />
    <AppToast />
    <AppModal />
  </div>
</template>

<script setup>
import AppToast from '@/components/AppToast.vue';
import AppModal from '@/components/AppModal.vue';
</script>
