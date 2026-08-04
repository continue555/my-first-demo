import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import AppModal from '../AppModal.vue';
import { useModalStore } from '@/stores/modal';

describe('AppModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('renders nothing while closed', () => {
    const wrapper = mount(AppModal);
    expect(wrapper.find('.modal-overlay').exists()).toBe(false);
  });

  it('renders title, content and confirm button when open', () => {
    const modal = useModalStore();
    modal.open({ title: '确认操作', content: '<p>确定删除吗？</p>', showConfirm: true });
    const wrapper = mount(AppModal);
    expect(wrapper.text()).toContain('确认操作');
    expect(wrapper.text()).toContain('确定删除吗？');
    expect(wrapper.find('.modal-actions .btn-danger').exists()).toBe(true);
  });

  it('confirm triggers onConfirm and closes', async () => {
    const modal = useModalStore();
    const onConfirm = vi.fn();
    modal.open({ title: '确认', content: '<p>x</p>', showConfirm: true, onConfirm });
    const wrapper = mount(AppModal);
    await wrapper.find('.modal-actions .btn-danger').trigger('click');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(modal.visible).toBe(false);
  });

  it('cancel closes without confirming', async () => {
    const modal = useModalStore();
    const onConfirm = vi.fn();
    modal.open({ title: '确认', content: '<p>x</p>', showConfirm: true, onConfirm });
    const wrapper = mount(AppModal);
    await wrapper.find('.modal-actions .btn-outline').trigger('click');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(modal.visible).toBe(false);
  });
});
