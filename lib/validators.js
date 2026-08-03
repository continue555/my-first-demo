const { z } = require('zod');

const ALLOWED_ROLES = ['admin', 'management', 'sales', 'production', 'finance', 'mold', 'material_follow'];
const roleSchema = z.string().refine(v => ALLOWED_ROLES.includes(v), '不支持的角色类型');
const passwordSchema = z.string().min(6, '密码至少6位').max(100);

const registerSchema = z.object({
  username: z.string().trim().min(1, '请填写完整信息').max(50),
  password: passwordSchema,
  name: z.string().trim().min(1, '请填写完整信息').max(50),
  department_id: z.coerce.number().int().positive().optional().nullable(),
  role: roleSchema
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, '请填写完整信息'),
  newPassword: passwordSchema
});

const resetPasswordSchema = z.object({
  newPassword: passwordSchema
});

const updateUserSchema = z.object({
  name: z.string().trim().min(1, '姓名不能为空').max(50).optional(),
  department_id: z.coerce.number().int().positive().optional().nullable(),
  role: roleSchema.optional()
}).refine(v => Object.keys(v).length > 0, '没有需要更新的字段');

const exportJobSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'delayed']).optional(),
  ids: z.array(z.coerce.number().int().positive()).max(500).optional()
}).refine(v => (v.ids && v.ids.length > 0) || !!v.status, '请选择订单或状态');

function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    return { error: r.error.issues[0]?.message || '参数格式不正确' };
  }
  return { data: r.data };
}

module.exports = {
  registerSchema,
  changePasswordSchema,
  resetPasswordSchema,
  updateUserSchema,
  exportJobSchema,
  parse
};
