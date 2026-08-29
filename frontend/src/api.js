import axios from 'axios';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

const client = axios.create({ baseURL: BACKEND_URL, timeout: 15000 });

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

export async function createPrintJob({ fileUrl, copies, color, printerId }) {
  const { data } = await client.post('/api/print-jobs', { fileUrl, copies, color, printerId });
  return data; // { success, jobId, status }
}

export async function getPrintJob(jobId) {
  const { data } = await client.get(`/api/print-jobs/${jobId}`);
  return data.job;
}

export async function getAvailablePrinters() {
  const { data } = await client.get('/api/printers');
  return data.printers; // [{ agentId, printerName }]
}

export { BACKEND_URL };
