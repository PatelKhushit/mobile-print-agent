const axios = require('axios');
const assert = require('assert');

const API = process.env.TEST_API || 'http://localhost:4200';
const c = axios.create({ baseURL: API, validateStatus: () => true });

function ok(cond, label) {
  if (!cond) throw new Error('FAILED: ' + label);
  console.log('PASS: ' + label);
}

async function main() {
  // --- bootstrap: first registered user becomes super admin ---
  const adminEmail = `admin-${Date.now()}@test.local`;
  let res = await c.post('/api/auth/register', { email: adminEmail, password: 'adminpass123', name: 'Admin' });
  ok(res.status === 201 && res.data.user.role === 'admin', 'first registered user becomes admin');
  const adminToken = res.data.token;
  const adminAuth = { headers: { Authorization: `Bearer ${adminToken}` } };

  // --- create two shops ---
  async function createShop(n) {
    const ownerEmail = `owner${n}-${Date.now()}@test.local`;
    const r = await c.post(
      '/api/admin/shops',
      {
        shopName: `Test Shop ${n}`,
        ownerEmail,
        ownerPassword: 'ownerpass123',
      },
      adminAuth
    );
    ok(r.status === 201, `shop ${n} created`);
    return { ...r.data.shop, ownerEmail };
  }
  const shopA = await createShop('A');
  const shopB = await createShop('B');
  ok(shopA.shopId !== shopB.shopId, 'shops got distinct shopIds');

  // --- register an agent for each shop, then a printer for each ---
  async function registerAgentAndPrinter(shopId, suffix) {
    const agentId = `AGENT-TEST-${suffix}-${Date.now()}`;
    const r = await c.post('/api/agents/register', { agentId, name: agentId, shopId });
    ok(r.status === 200 && r.data.shopId === shopId, `agent ${suffix} paired to ${shopId}`);
    const agentAuthHeaders = { headers: { 'X-Agent-Id': agentId, 'X-Agent-Secret': r.data.token } };

    // heartbeat so the agent shows online + reports the printer as present
    const printerId = `PRN-TEST-${suffix}-${Date.now()}`;
    const localPrinterName = `Test Printer ${suffix}`;
    await c.post('/api/agents/heartbeat', { printers: [localPrinterName], version: '1.0.0' }, agentAuthHeaders);
    const pr = await c.post(
      '/api/printers/register',
      { printerId, name: localPrinterName, localPrinterName, protocol: 'windows' },
      agentAuthHeaders
    );
    ok(pr.status === 200 && pr.data.printer.shopId === shopId, `printer ${suffix} denormalized shopId=${shopId}`);
    return { agentId, printerId, agentAuthHeaders };
  }
  const A = await registerAgentAndPrinter(shopA.shopId, 'A');
  const B = await registerAgentAndPrinter(shopB.shopId, 'B');

  // --- super admin list shows both shops with correct per-shop printer counts ---
  res = await c.get('/api/admin/shops', adminAuth);
  const listedA = res.data.shops.find((s) => s.shopId === shopA.shopId);
  const listedB = res.data.shops.find((s) => s.shopId === shopB.shopId);
  ok(listedA.printers.total === 1 && listedB.printers.total === 1, 'admin shop list shows 1 printer each');

  // --- legacy global /api/printers must NOT include shop-scoped printers ---
  res = await c.get('/api/printers');
  ok(
    !res.data.printers.some((p) => p.printerId === A.printerId || p.printerId === B.printerId),
    'legacy global printer list excludes shop-scoped printers'
  );

  // --- QR public info + session issuance ---
  res = await c.get(`/api/shops/${shopA.shopId}/public`, { params: { t: 'WRONG_TOKEN' } });
  ok(res.status === 404, 'wrong QR token rejected on public info endpoint');

  // fetch real qrToken via admin regenerate (also exercises spec 44)
  const qrRes = await c.post(`/api/admin/shops/${shopA.shopId}/qr/regenerate`, {}, adminAuth);
  ok(qrRes.status === 200 && qrRes.data.qrUrl.includes(shopA.shopId), 'QR regenerate returns a shop-specific URL');
  const tokenMatch = qrRes.data.qrUrl.match(/[?&]t=([a-f0-9]+)/);
  const shopAQrToken = tokenMatch[1];

  res = await c.get(`/api/shops/${shopA.shopId}/public`, { params: { t: shopAQrToken } });
  ok(res.status === 200 && res.data.shopName === shopA.shopName, 'correct QR token returns correct shop name');

  const sessionRes = await c.post(`/api/shops/${shopA.shopId}/session`, { t: shopAQrToken });
  ok(sessionRes.status === 200 && sessionRes.data.token, 'customer session issued for shop A');
  const custA = { headers: { Authorization: `Bearer ${sessionRes.data.token}` } };

  // --- CORE ISOLATION TEST: shop A's session must only see shop A's printer ---
  res = await c.get(`/api/shops/${shopA.shopId}/printers`, custA);
  ok(
    res.data.printers.length === 1 && res.data.printers[0].printerId === A.printerId,
    "shop A customer session sees only shop A's printer"
  );

  // shop A's session must be rejected when addressing shop B's URL
  res = await c.get(`/api/shops/${shopB.shopId}/printers`, custA);
  ok(res.status === 403, "shop A's session forbidden from shop B's printer list");

  // even a forged printerId from shop B must be rejected on job creation
  res = await c.post(
    '/api/print-jobs',
    { printerId: B.printerId, fileUrl: `${API}/public/sample-test-page.pdf`, copies: 1 },
    custA
  );
  ok(res.status === 403, "shop A's session cannot create a job against shop B's printerId");

  // --- legitimate job creation + duplicate/idempotency protection ---
  const idempotencyKey = 'test-idem-' + Date.now();
  const jobRes1 = await c.post(
    '/api/print-jobs',
    { printerId: A.printerId, fileUrl: `${API}/public/sample-test-page.pdf`, copies: 1, idempotencyKey },
    custA
  );
  ok(jobRes1.status === 201, 'shop A customer creates a legit job against shop A printer');
  const jobRes2 = await c.post(
    '/api/print-jobs',
    { printerId: A.printerId, fileUrl: `${API}/public/sample-test-page.pdf`, copies: 1, idempotencyKey },
    custA
  );
  ok(jobRes2.data.jobId === jobRes1.data.jobId, 'retried request with same idempotencyKey returns same job (no duplicate)');

  // --- agent only ever claims jobs for printers it owns ---
  const pending = await c.get('/api/print-jobs/pending', A.agentAuthHeaders);
  ok(pending.data.job && pending.data.job.jobId === jobRes1.data.jobId, "shop A's agent claims the job");
  const pendingB = await c.get('/api/print-jobs/pending', B.agentAuthHeaders);
  ok(pendingB.data.job === null, "shop B's agent has nothing to claim (isolation holds end-to-end)");

  // --- shop owner self-service is scoped server-side, ignoring any client shopId ---
  const ownerLogin = await c.post('/api/auth/login', { email: shopA.ownerEmail, password: 'ownerpass123' });
  ok(
    ownerLogin.status === 200 && ownerLogin.data.user.role === 'shop_owner' && ownerLogin.data.user.shopId === shopA.shopId,
    "shop A owner's JWT carries role=shop_owner and the correct shopId"
  );
  const ownerAAuth = { headers: { Authorization: `Bearer ${ownerLogin.data.token}` } };

  res = await c.get('/api/shop/printers', ownerAAuth);
  ok(
    res.data.printers.length === 1 && res.data.printers[0].printerId === A.printerId,
    "shop A owner dashboard sees only shop A's printer (server-derived, not client-supplied)"
  );

  res = await c.get('/api/shop/me', ownerAAuth);
  ok(res.data.shop.shopId === shopA.shopId && res.data.qrDataUrl.startsWith('data:image/png'), 'shop owner /me returns own shop + a real QR image');

  // a shop owner must not be able to touch admin-only endpoints
  res = await c.get('/api/admin/shops', ownerAAuth);
  ok(res.status === 403, 'shop owner is forbidden from the super-admin shops endpoint');

  // --- regression: legacy personal-use flow (admin JWT) is completely unaffected ---
  const legacyPrinterId = `PRN-LEGACY-${Date.now()}`;
  await c.post(
    '/api/printers/register',
    { printerId: legacyPrinterId, name: 'Legacy Printer', localPrinterName: 'Legacy Printer', protocol: 'windows' },
    { headers: { 'X-Agent-Id': 'LEGACY-AGENT-DOES-NOT-EXIST', 'X-Agent-Secret': 'x' } }
  ).catch(() => {}); // expected to fail auth - agent was never registered; just confirms no crash
  const legacyAgent = await c.post('/api/agents/register', { agentId: `LEGACY-AGENT-${Date.now()}`, name: 'Legacy' });
  ok(legacyAgent.data.shopId === null, 'agent registered without shopId stays legacy/standalone (shopId null)');
  const legacyAgentAuth = { headers: { 'X-Agent-Id': legacyAgent.data.agentId, 'X-Agent-Secret': legacyAgent.data.token } };
  await c.post('/api/agents/heartbeat', { printers: ['Legacy Printer 2'], version: '1.0.0' }, legacyAgentAuth);
  const legacyPrinterId2 = `PRN-LEGACY2-${Date.now()}`;
  const legacyPrinterRes = await c.post(
    '/api/printers/register',
    { printerId: legacyPrinterId2, name: 'Legacy Printer 2', localPrinterName: 'Legacy Printer 2', protocol: 'windows' },
    legacyAgentAuth
  );
  ok(legacyPrinterRes.data.printer.shopId === null, 'printer registered by a shopless agent stays shopId=null');
  res = await c.get('/api/printers');
  ok(res.data.printers.some((p) => p.printerId === legacyPrinterId2), 'legacy printer appears in the legacy global list exactly as before');
  const legacyJob = await c.post(
    '/api/print-jobs',
    { printerId: legacyPrinterId2, fileUrl: `${API}/public/sample-test-page.pdf`, copies: 1 },
    adminAuth
  );
  ok(legacyJob.status === 201, 'legacy admin-JWT job creation on a standalone printer still works unchanged');

  console.log('\nALL ISOLATION + REGRESSION TESTS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
