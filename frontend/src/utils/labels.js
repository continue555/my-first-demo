import roleLabels from '@shared/role-labels.json';

export function roleLabel(role) {
  return roleLabels[role] || role;
}

export { roleLabels };
