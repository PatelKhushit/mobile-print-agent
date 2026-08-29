import axios from 'axios';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const TOKEN_KEY = 'printSystemAuthToken';
const USER_KEY = 'printSystemUser';

const client = axios.create({ baseURL: BACKEND_URL, timeout: 15000 });

client.interceptors.request.use((cfg) => {
  const token = getToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export async function login(email, password) {
  const { data } = await client.post('/api/auth/login', { email, password });
  setToken(data.token);
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data;
}

export async function register(email, password, name) {
  const { data } = await client.post('/api/auth/register', { email, password, name });
  setToken(data.token);
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data;
}

export async function changePassword(currentPassword, newPassword) {
  const { data } = await client.post('/api/auth/change-password', { currentPassword, newPassword });
  return data;
}

export async function getSamplePdfUrl() {
  const { data } = await client.get('/api/sample-pdf');
  return data.fileUrl;
}

export async function uploadPdf(file, onProgress) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await client.post('/api/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (evt) => {
      if (onProgress && evt.total) onProgress(Math.round((evt.loaded / evt.total) * 100));
    },
  });
  return data; // { success, fileUrl, fileName, fileSize }
}

export async function createPrintJob({ printerId, fileUrl, copies, color, paperSize, duplex }) {
  const idempotencyKey =
    (window.crypto?.randomUUID && window.crypto.randomUUID()) || `${Date.now()}-${Math.random()}`;
  const { data } = await client.post('/api/print-jobs', {
    printerId,
    fileUrl,
    copies,
    color,
    paperSize,
    duplex,
    idempotencyKey,
  });
  return data; // { success, jobId, status }
}

export async function getPrintJob(jobId) {
  const { data } = await client.get(`/api/print-jobs/${jobId}`);
  return data.job;
}

export async function cancelPrintJob(jobId) {
  const { data } = await client.post(`/api/print-jobs/${jobId}/cancel`);
  return data; // { success, jobId, status }
}

export async function getAuditLog(limit = 100) {
  const { data } = await client.get('/api/print-jobs/admin/audit-log', { params: { limit } });
  return data.entries;
}

export async function getAvailablePrinters() {
  const { data } = await client.get('/api/printers');
  return data.printers; // [{ printerId, name, location, agentId, status }]
}

export async function adminListPrinters() {
  const { data } = await client.get('/api/printers/admin/all');
  return data.printers;
}

export async function adminUpdatePrinter(printerId, fields) {
  const { data } = await client.patch(`/api/printers/${printerId}`, fields);
  return data.printer;
}

export async function adminDeletePrinter(printerId) {
  await client.delete(`/api/printers/${printerId}`);
}

export async function adminTestPrint(printerId) {
  const { data } = await client.post(`/api/printers/${printerId}/test-print`);
  return data; // { success, jobId, status }
}

export { BACKEND_URL };
