import STAGE_DEFINITIONS from '@shared/stage-defs.json';
const BASE = '/api';

function getToken() {
  return sessionStorage.getItem('token');
}

export async function request(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${url}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) {
    const statusMap = { 400: '请求参数错误', 401: '未登录或登录已过期', 403: '没有操作权限', 404: '数据不存在', 500: '服务器内部错误' };
    throw new Error(data.error || statusMap[res.status] || '网络错误');
  }
  return data;
}

export const api = {
  get(url) { return request(url); },
  post(url, body) { return request(url, { method: 'POST', body: JSON.stringify(body) }); },
  put(url, body) { return request(url, { method: 'PUT', body: JSON.stringify(body) }); },
  del(url) { return request(url, { method: 'DELETE' }); },
  async download(url) {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${BASE}${url}`, { headers });
    if (!res.ok) throw new Error('下载失败');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = res.headers.get('Content-Disposition')?.match(/filename=(.+)/)?.[1] || 'export.xlsx';
    a.click();
  }
};

export { STAGE_DEFINITIONS as STAGE_DEFS };

// 文件上传下载 API
export async function uploadFile(orderId, file, stageKey) {
  const token = getToken();
  const formData = new FormData();
  formData.append('file', file);
  if (stageKey) formData.append('stage_key', stageKey);

  const res = await fetch(`${BASE}/orders/${orderId}/files`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '上传失败');
  return data;
}

export async function getFiles(orderId) {
  return api.get(`/orders/${orderId}/files`);
}

export async function deleteFile(fileId) {
  return api.del(`/files/${fileId}`);
}

export function getDownloadUrl(fileId) {
  const token = getToken();
  return `${BASE}/files/${fileId}/download?token=${token}`;
}
