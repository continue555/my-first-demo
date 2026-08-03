import STAGE_DEFINITIONS from '@shared/stage-defs.json';
const BASE = '/api';

function getToken() {
  return sessionStorage.getItem('token');
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : '';
}

function getCsrfToken() {
  return getCookie('csrf');
}

function handleUnauthorized() {
  sessionStorage.clear();
  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
}

export async function request(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const csrf = getCsrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const res = await fetch(`${BASE}${url}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized();
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
    const csrf = getCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const res = await fetch(`${BASE}${url}`, { headers });
    if (res.status === 401) handleUnauthorized();
    if (!res.ok) throw new Error('下载失败');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = res.headers.get('Content-Disposition')?.match(/filename=(.+)/)?.[1] || 'export.xlsx';
    a.click();
  }
};

export { STAGE_DEFINITIONS as STAGE_DEFS };

// 文件上传 API（支持进度回调）
export function uploadFile(orderId, file, stageKey, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/orders/${orderId}/files`);
    const token = getToken();
    const csrf = getCsrfToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.timeout = 120000;
    xhr.upload.onprogress = event => {
      if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 401) handleUnauthorized();
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { data = { error: '上传失败' }; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || '上传失败'));
    };
    xhr.onerror = () => reject(new Error('上传失败'));
    xhr.ontimeout = () => reject(new Error('上传超时'));
    const formData = new FormData();
    formData.append('file', file);
    if (stageKey) formData.append('stage_key', stageKey);
    xhr.send(formData);
  });
}

export async function getFiles(orderId) {
  return api.get(`/orders/${orderId}/files`);
}

export async function deleteFile(fileId) {
  return api.del(`/files/${fileId}`);
}

export async function createExportJob(payload) {
  return api.post('/export/jobs', payload);
}

export async function getExportJob(jobId) {
  return api.get(`/export/jobs/${jobId}`);
}

export async function downloadExportJob(jobId) {
  await api.download(`/export/jobs/${jobId}/download`);
}

export async function getFilePreviewTicket(fileId) {
  const data = await api.get(`/files/${fileId}/ticket`);
  return data.url;
}
