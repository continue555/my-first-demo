import { describe, it, expect } from 'vitest';
import { canOperateStage, isUserDept } from '@/utils/stage-permissions';

describe('canOperateStage', () => {
  it('admin and management can operate any stage', () => {
    expect(canOperateStage({ role: 'admin' }, { department_id: 9 })).toBe(true);
    expect(canOperateStage({ role: 'management' }, { department_id: 9 })).toBe(true);
  });

  it('sales can only operate sales department stages', () => {
    expect(canOperateStage({ role: 'sales', department_id: 1 }, { department_id: 1 })).toBe(true);
    expect(canOperateStage({ role: 'sales', department_id: 1 }, { department_id: 4 })).toBe(false);
  });

  it('finance can only operate finance department stages', () => {
    expect(canOperateStage({ role: 'finance', department_id: 3 }, { department_id: 3 })).toBe(true);
    expect(canOperateStage({ role: 'finance', department_id: 3 }, { department_id: 1 })).toBe(false);
  });

  it('production sees own and child departments', () => {
    expect(canOperateStage({ role: 'production', department_id: 2, child_dept_ids: [4, 5] }, { department_id: 4 })).toBe(true);
    expect(canOperateStage({ role: 'production', department_id: 2, child_dept_ids: [4, 5] }, { department_id: 8 })).toBe(false);
  });

  it('mold and material follow are limited to own department', () => {
    expect(canOperateStage({ role: 'mold', department_id: 11 }, { department_id: 11 })).toBe(true);
    expect(canOperateStage({ role: 'mold', department_id: 11 }, { department_id: 5 })).toBe(false);
    expect(canOperateStage({ role: 'material_follow', department_id: 12 }, { department_id: 12 })).toBe(true);
  });
});

describe('isUserDept', () => {
  it('admin and management see all departments', () => {
    expect(isUserDept({ role: 'admin' }, 1)).toBe(true);
    expect(isUserDept({ role: 'management' }, 9)).toBe(true);
  });

  it('production sees own and child departments', () => {
    expect(isUserDept({ role: 'production', department_id: 2, child_dept_ids: [4] }, 4)).toBe(true);
    expect(isUserDept({ role: 'production', department_id: 2, child_dept_ids: [4] }, 8)).toBe(false);
  });
});
