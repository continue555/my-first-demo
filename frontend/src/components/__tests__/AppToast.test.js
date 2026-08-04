import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import AppToast from '../AppToast.vue';
import { useToastStore } from '@/stores/toast';

describe('AppToast', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders toast with type class', () => {
    const toast = useToastStore();
    toast.show('保存成功', 'success');
    const wrapper = mount(AppToast);
    expect(wrapper.find('.toast-success').text()).toContain('保存成功');
  });

  it('renders error toast', () => {
    const toast = useToastStore();
    toast.show('操作失败', 'error');
    const wrapper = mount(AppToast);
    expect(wrapper.find('.toast-error').text()).toContain('操作失败');
  });

  it('auto dismisses after 3 seconds', async () => {
    const toast = useToastStore();
    toast.show('提示');
    const wrapper = mount(AppToast);
    expect(wrapper.findAll('.toast')).toHaveLength(1);
    vi.advanceTimersByTime(3001);
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('.toast')).toHaveLength(0);
  });
});
