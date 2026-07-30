<template>
  <div>
    <div class="page-header">
      <h2>用户管理</h2>
      <button class="btn btn-primary" @click="showCreate = true">+ 新增用户</button>
    </div>
    <div class="card">
      <div v-if="users.length === 0" class="empty-state">
        <div class="icon">👥</div>
        <p>暂无用户</p>
      </div>
      <div v-else class="table-wrapper">
        <table>
          <thead><tr><th>用户名</th><th>姓名</th><th>角色</th><th>部门</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td><strong>{{ u.username }}</strong></td>
              <td>{{ u.name }}</td>
              <td>{{ roleNames[u.role] || u.role }}</td>
              <td>{{ u.dept_name || '-' }}</td>
              <td>
                <button class="btn btn-outline btn-sm" @click="openEdit(u)">编辑</button>
                <button class="btn btn-outline btn-sm" @click="openResetPwd(u)">重置密码</button>
                <button class="btn btn-danger btn-sm" @click="deleteUser(u)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 新增用户 -->
    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal">
        <h3>新增用户</h3>
        <div class="form-group"><label>用户名 *</label><input v-model="newUser.username" type="text" placeholder="登录用户名"></div>
        <div class="form-group"><label>密码 *</label><input v-model="newUser.password" type="password" placeholder="初始密码"></div>
        <div class="form-group"><label>姓名 *</label><input v-model="newUser.name" type="text" placeholder="真实姓名"></div>
        <div class="form-group"><label>角色 *</label>
          <select v-model="newUser.role">
            <option value="">请选择</option>
            <option value="admin">管理员</option>
            <option value="management">总经理</option>
            <option value="sales">销售</option>
            <option value="production">生产</option>
            <option value="finance">财务</option>
          </select>
        </div>
        <div class="form-group"><label>部门</label>
          <select v-model="newUser.department_id">
            <option value="">请选择</option>
            <option value="1">销售部</option>
            <option value="2">生产部</option>
            <option value="3">财务部</option>
            <option value="4">技术部</option>
            <option value="5">采购部</option>
            <option value="6">仓库部</option>
            <option value="7">装配部</option>
            <option value="8">调试部</option>\n<option value="9">发货部</option>\n<option value="10">审批部</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline" @click="showCreate = false">取消</button>
          <button class="btn btn-primary" @click="createUser">创建</button>
        </div>
      </div>
    </div>

    <!-- 编辑用户 -->
    <div v-if="showEdit" class="modal-overlay" @click.self="showEdit = false">
      <div class="modal">
        <h3>编辑用户 - {{ editUser.username }}</h3>
        <div class="form-group"><label>姓名</label><input v-model="editUser.name" type="text"></div>
        <div class="form-group"><label>角色</label>
          <select v-model="editUser.role">
            <option value="admin">管理员</option>
            <option value="management">总经理</option>
            <option value="sales">销售</option>
            <option value="production">生产</option>
            <option value="finance">财务</option>
          </select>
        </div>
        <div class="form-group"><label>部门</label>
          <select v-model="editUser.department_id">
            <option value="">请选择</option>
            <option value="1">销售部</option>
            <option value="2">生产部</option>
            <option value="3">财务部</option>
            <option value="4">技术部</option>
            <option value="5">采购部</option>
            <option value="6">仓库部</option>
            <option value="7">装配部</option>
            <option value="8">调试部</option>\n<option value="9">发货部</option>\n<option value="10">审批部</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline" @click="showEdit = false">取消</button>
          <button class="btn btn-primary" @click="updateUser">保存</button>
        </div>
      </div>
    </div>

    <!-- 重置密码 -->
    <div v-if="showReset" class="modal-overlay" @click.self="showReset = false">
      <div class="modal">
        <h3>重置密码 - {{ resetUser.username }}</h3>
        <div class="form-group"><label>新密码</label><input v-model="resetPwd" type="password" placeholder="请输入新密码"></div>
        <div class="modal-actions">
          <button class="btn btn-outline" @click="showReset = false">取消</button>
          <button class="btn btn-primary" @click="doResetPwd">确认重置</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '@/api';
import { useToastStore } from '@/stores/toast';
import { useModalStore } from '@/stores/modal';

const toast = useToastStore();
const modal = useModalStore();
const users = ref([]);
const roleNames = { admin: '管理员', management: '总经理', sales: '销售', production: '生产', finance: '财务' };

const showCreate = ref(false);
const newUser = ref({ username: '', password: '', name: '', role: '', department_id: '' });

const showEdit = ref(false);
const editUser = ref({});

const showReset = ref(false);
const resetUser = ref({});
const resetPwd = ref('');

async function load() {
  try {
    const data = await api.get('/auth/users');
    users.value = data.users || [];
  } catch (e) {
    toast.show(e.message, 'error');
  }
}

async function createUser() {
  const u = newUser.value;
  if (!u.username || !u.password || !u.name || !u.role) {
    toast.show('请填写必填字段', 'error');
    return;
  }
  try {
    await api.post('/auth/register', {
      username: u.username, password: u.password, name: u.name, role: u.role,
      department_id: parseInt(u.department_id) || null
    });
    toast.show('用户创建成功');
    showCreate.value = false;
    newUser.value = { username: '', password: '', name: '', role: '', department_id: '' };
    load();
  } catch (e) {
    toast.show(e.message, 'error');
  }
}

function openEdit(u) {
  editUser.value = { ...u, department_id: u.department_id || '' };
  showEdit.value = true;
}

async function updateUser() {
  if (!editUser.value.name) {
    toast.show('姓名不能为空', 'error');
    return;
  }
  try {
    await api.put(`/auth/users/${editUser.value.id}`, {
      name: editUser.value.name, role: editUser.value.role,
      department_id: parseInt(editUser.value.department_id) || null
    });
    toast.show('用户信息更新成功');
    showEdit.value = false;
    load();
  } catch (e) {
    toast.show(e.message, 'error');
  }
}

function deleteUser(u) {
  modal.open({
    title: '确认操作',
    content: `<p style="margin:16px 0;color:var(--text-secondary);">确定要删除用户 "${u.username}" 吗？此操作不可撤销！</p>`,
    showConfirm: true,
    onConfirm: async () => {
      try {
        await api.del(`/auth/users/${u.id}`);
        toast.show('用户已删除');
        load();
      } catch (e) {
        toast.show(e.message, 'error');
      }
    }
  });
}

function openResetPwd(u) {
  resetUser.value = u;
  resetPwd.value = '';
  showReset.value = true;
}

async function doResetPwd() {
  if (!resetPwd.value) {
    toast.show('请输入新密码', 'error');
    return;
  }
  try {
    await api.put(`/auth/users/${resetUser.value.id}/reset-password`, { newPassword: resetPwd.value });
    toast.show('密码已重置');
    showReset.value = false;
  } catch (e) {
    toast.show(e.message, 'error');
  }
}

onMounted(load);
</script>

<style scoped>
</style>
