import axios from 'axios';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const TOKEN_KEY = 'printSystemAuthToken';
const USER_KEY = 'printSystemUser';
// Deliberately a separate storage key from TOKEN_KEY/USER_KEY above - a
// customer QR session and a shop-owner/admin login must never collide if
// both happen to exist in the same browser (spec section 73: customer
// never needs a login at all, so it gets its own independent credential).
const CUSTOMER_TOKEN_KEY = 'printSystemCustomerSession';

const client = axios.create({ baseURL: BACKEND_URL, timeout: 15000 });

client.interceptors.request.use((cfg) => {
  const token = getToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Used only by the QR customer print flow - never carries a mobile-user JWT.
const customerClient = axios.create({ baseURL: BACKEND_URL, timeout: 15000 });

customerClient.interceptors.request.use((cfg) => {
  const token = getCustomerToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

export function getCustomerToken() {
  return sessionStorage.getItem(CUSTOMER_TOKEN_KEY);
}

export function setCustomerToken(token) {
  sessionStorage.setItem(CUSTOMER_TOKEN_KEY, token);
}

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

export async function createPrintJob({ printerId, fileUrl, copies, color, paperSize, orientation, duplex }) {
  const idempotencyKey =
    (window.crypto?.randomUUID && window.crypto.randomUUID()) || `${Date.now()}-${Math.random()}`;
  const { data } = await client.post('/api/print-jobs', {
    printerId,
    fileUrl,
    copies,
    color,
    paperSize,
    orientation,
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

// --- Super admin: shops -----------------------------------------------
export async function adminListShops() {
  const { data } = await client.get('/api/admin/shops');
  return data.shops;
}

export async function adminCreateShop(fields) {
  const { data } = await client.post('/api/admin/shops', fields);
  return data.shop;
}

export async function adminUpdateShop(shopId, fields) {
  const { data } = await client.patch(`/api/admin/shops/${shopId}`, fields);
  return data.shop;
}

export async function adminRegenerateShopQr(shopId) {
  const { data } = await client.post(`/api/admin/shops/${shopId}/qr/regenerate`);
  return data; // { success, qrUrl, qrDataUrl }
}

// --- Shop owner self-service --------------------------------------------
export async function getMyShop() {
  const { data } = await client.get('/api/shop/me');
  return data; // { shop, qrUrl, qrDataUrl }
}

export async function getMyShopPrinters() {
  const { data } = await client.get('/api/shop/printers');
  return data.printers;
}

export async function setMyShopPrinterAvailable(printerId, available) {
  const { data } = await client.patch(`/api/shop/printers/${printerId}`, { available });
  return data.printer;
}

export async function getMyShopAgents() {
  const { data } = await client.get('/api/shop/agents');
  return data.agents;
}

export async function generateAgentPairingCode() {
  const { data } = await client.post('/api/shop/agent/pairing-code');
  return data; // { success, pairingCode, expiresAt }
}

export async function getMyShopJobs(limit = 50) {
  const { data } = await client.get('/api/shop/jobs', { params: { limit } });
  return data.jobs;
}

// --- Customer QR print flow (uses its own session token, see customerClient) ---
export async function getShopPublicInfo(shopId, qrToken) {
  const { data } = await client.get(`/api/shops/${shopId}/public`, { params: { t: qrToken } });
  return data; // { shopId, shopName }
}

export async function startCustomerSession(shopId, qrToken) {
  const { data } = await client.post(`/api/shops/${shopId}/session`, { t: qrToken });
  setCustomerToken(data.token);
  return data; // { token, shopName, expiresIn }
}

export async function getShopPrinters(shopId) {
  const { data } = await customerClient.get(`/api/shops/${shopId}/printers`);
  return data.printers;
}

export async function uploadPdfAsCustomer(file, onProgress) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await customerClient.post('/api/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (evt) => {
      if (onProgress && evt.total) onProgress(Math.round((evt.loaded / evt.total) * 100));
    },
  });
  return data;
}

export async function createShopPrintJob({ printerId, fileUrl, copies, color, paperSize, orientation, duplex }) {
  const idempotencyKey =
    (window.crypto?.randomUUID && window.crypto.randomUUID()) || `${Date.now()}-${Math.random()}`;
  const { data } = await customerClient.post('/api/print-jobs', {
    printerId,
    fileUrl,
    copies,
    color,
    paperSize,
    orientation,
    duplex,
    idempotencyKey,
  });
  return data; // { success, jobId, status }
}

export { BACKEND_URL };
