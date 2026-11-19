import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// Run with Node 22.12+ from the repository root against the existing local servers:
// node scripts/page-settings-browser.mjs
// Only this run's temporary fixtures are changed; credentials stay in memory.
if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); }
  catch { throw new Error('Could not load the local test environment. Use Node 22.12+ and configure the project .env.'); }
}
const localHosts = ['localhost', '127.0.0.1', '[::1]'];
function assertLocal(value, label) {
  let hostname;
  try { hostname = new URL(value).hostname; } catch { throw new Error(`${label} must be a valid local URL.`); }
  assert.ok(localHosts.includes(hostname), `${label} must use a loopback host.`);
}
const web = process.env.BROWSER_WEB_URL || 'http://localhost:5173';
const api = process.env.BROWSER_API_URL || 'http://127.0.0.1:3000';
assertLocal(web, 'Browser regression');
assertLocal(api, 'API');
assertLocal(process.env.DATABASE_URL, 'Fixture database');
const healthResponse = await fetch(`${api}/api/health`);
assert.equal(healthResponse.status, 200, 'The local API must be running');
assert.equal((await healthResponse.json()).mode, 'mock', 'Fixtures may only run with mock integrations');

const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { PrismaClient } = requireApi('@prisma/client');
const { hash } = requireApi('bcryptjs');
const db = new PrismaClient();
const run = randomBytes(8).toString('hex');
const adminEmail = `page-settings-admin-${run}@test.invalid`;
const managerEmail = `page-settings-manager-${run}@test.invalid`;
const password = randomBytes(24).toString('base64url');
const fixturePageId = `page-settings-${run}`;
const pageName = `Page settings QA ${run}`;
const originalId = `9${Date.now()}${randomBytes(2).readUInt16BE().toString().padStart(5, '0')}`;
const replacementId = `${originalId}1`;
const blockedId = `${originalId}2`;
const checks = [];
const pageErrors = [];
let browser;
let currentPage;

function passed(label) { checks.push(label); console.log(`PASS ${label}`); }
async function login(page, email) {
  await page.goto(`${web}/?pageId=${encodeURIComponent(fixturePageId)}`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.getByRole('heading', { name: 'Trung tâm hội thoại', exact: true }).waitFor();
}
async function openSettings(page) {
  await page.getByRole('menuitem', { name: /Fanpage & kết nối/ }).click();
  await page.getByLabel('Facebook Page ID', { exact: true }).waitFor();
}
const settingsResponse = (page) => page.waitForResponse(response => response.url().endsWith(`/api/pages/${fixturePageId}`) && response.request().method() === 'PATCH');
const readFixture = () => db.page.findUniqueOrThrow({ where: { id: fixturePageId } });

try {
  const passwordHash = await hash(password, 4);
  await db.user.create({ data: { email: adminEmail, name: 'Page settings QA admin', passwordHash, role: 'SUPER_ADMIN', emailVerifiedAt: new Date() } });
  const manager = await db.user.create({ data: { email: managerEmail, name: 'Page settings QA manager', passwordHash, role: 'PAGE_MANAGER', emailVerifiedAt: new Date() } });
  await db.page.create({ data: { id: fixturePageId, name: pageName, externalPageId: originalId, aiEnabled: true, settings: { demo: true, segmentRules: { POPULAR: [0.05], MID: [], PREMIUM: [] } }, members: { create: { userId: manager.id } } } });
  await mkdir('.tools/browser', { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-first-run', '--disable-features=msEdgeSidebarV2'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, locale: 'vi-VN' });
  const page = await context.newPage();
  currentPage = page;
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await login(page, adminEmail);
  await openSettings(page);
  const pageIdInput = page.getByLabel('Facebook Page ID', { exact: true });
  assert.equal(await pageIdInput.isEditable(), true, 'Super Admin Page ID input is editable');
  assert.equal(await pageIdInput.inputValue(), originalId);
  const save = page.getByRole('button', { name: /Lưu thông tin Fanpage/ });
  assert.equal(await save.isVisible(), true, 'Identity card has a visible save action');
  passed('Super Admin can edit Page ID and save from the identity card');

  await page.getByLabel('Tên hiển thị', { exact: true }).fill(`  ${pageName} updated  `);
  const [nameResponse] = await Promise.all([settingsResponse(page), save.click()]);
  assert.equal(nameResponse.status(), 200, 'Name-only update should save without a binding confirmation');
  const named = await readFixture();
  assert.equal(named.name, `${pageName} updated`);
  assert.equal(named.externalPageId, originalId);
  assert.equal(named.aiEnabled, true, 'Name-only updates preserve the AI setting');
  assert.equal(named.settings.demo, true, 'Existing unrelated settings are preserved');
  passed('Name-only save trims the value and preserves Page ID, AI and demo settings');

  await pageIdInput.fill(`  ${replacementId}  `);
  const [refreshedPages] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/pages') && response.request().method() === 'GET'),
    page.getByRole('button', { name: 'Làm mới', exact: true }).click(),
  ]);
  // Let React apply the refreshed Page object before inspecting the draft.
  await refreshedPages.finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await pageIdInput.inputValue(), `  ${replacementId}  `, 'Realtime/page refresh must preserve unsaved input');
  passed('Refreshing Page data preserves unsaved settings');

  await save.click();
  const confirm = page.getByRole('dialog').filter({ has: page.getByText('Đổi Facebook Page ID?', { exact: true }) });
  await confirm.waitFor();
  assert.ok((await confirm.innerText()).includes(originalId));
  assert.ok((await confirm.innerText()).includes(replacementId));
  await confirm.getByRole('button', { name: 'Giữ cấu hình', exact: true }).click();
  assert.equal((await readFixture()).externalPageId, originalId, 'Cancel must not update the binding');
  await save.click();
  const [bindingResponse] = await Promise.all([
    settingsResponse(page),
    page.getByRole('button', { name: 'Đổi Page ID và lưu', exact: true }).click(),
  ]);
  assert.equal(bindingResponse.status(), 200);
  const bound = await readFixture();
  assert.equal(bound.externalPageId, replacementId, 'Trimmed Page ID is persisted');
  assert.equal(bound.aiEnabled, false, 'Changed binding pauses AI');
  await page.getByText('Đã đổi Page ID. AI đang tạm tắt để bạn kiểm tra lại kết nối Messenger.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('AI tư vấn toàn Fanpage', { exact: true }).getAttribute('aria-checked'), 'false', 'Saved form reflects server-forced AI pause');
  assert.equal(await page.getByLabel('Page Access Token mới', { exact: true }).inputValue(), '');
  passed('Binding confirmation supports cancel, then saves the trimmed ID and pauses AI');

  await page.goto(`${web}/?pageId=${encodeURIComponent(fixturePageId)}`, { waitUntil: 'networkidle' });
  await openSettings(page);
  assert.equal(await page.getByLabel('Facebook Page ID', { exact: true }).inputValue(), replacementId);
  assert.equal(await page.getByLabel('Tên hiển thị', { exact: true }).inputValue(), `${pageName} updated`);
  await page.screenshot({ path: '.tools/browser/page-settings-editable.png', fullPage: true });
  passed('Updated name and Page ID survive a full browser reload');

  await db.conversation.create({ data: { pageId: fixturePageId, customerId: `fixture-customer-${run}` } });
  await page.getByLabel('Facebook Page ID', { exact: true }).fill(blockedId);
  await page.getByRole('button', { name: /Lưu thông tin Fanpage/ }).click();
  const [blockedResponse] = await Promise.all([
    settingsResponse(page),
    page.getByRole('button', { name: 'Đổi Page ID và lưu', exact: true }).click(),
  ]);
  assert.equal(blockedResponse.status(), 409, 'Historical Page binding must be protected');
  await page.getByText('Fanpage đã có lịch sử hội thoại hoặc webhook. Hãy tạo Fanpage mới để gắn Page ID khác và giữ nguyên lịch sử cũ.', { exact: true }).waitFor();
  assert.equal((await readFixture()).externalPageId, replacementId);
  assert.equal(await page.getByLabel('Facebook Page ID', { exact: true }).inputValue(), blockedId, 'Failed save preserves the draft');
  passed('Historical Page conflict is explained and leaves the draft and stored binding intact');

  const managerContext = await browser.newContext({ viewport: { width: 1440, height: 1080 }, locale: 'vi-VN' });
  const managerPage = await managerContext.newPage();
  managerPage.setDefaultTimeout(20000);
  managerPage.on('pageerror', error => pageErrors.push(error.message));
  await login(managerPage, managerEmail);
  assert.equal(await managerPage.getByRole('menuitem', { name: /Fanpage & kết nối/ }).count(), 0);
  const deniedStatus = await managerPage.evaluate(async (id) => {
    const csrf = document.cookie.split('; ').find(item => item.startsWith('csrf_token='))?.slice('csrf_token='.length);
    const response = await fetch(`/api/pages/${id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf || '') }, body: JSON.stringify({ name: 'Unauthorized fixture edit' }) });
    return response.status;
  }, fixturePageId);
  assert.equal(deniedStatus, 403, 'Page Managers cannot bypass UI permission checks');
  assert.equal((await readFixture()).name, `${pageName} updated`);
  passed('Page Manager has no admin navigation and direct settings PATCH is forbidden');
  assert.deepEqual(pageErrors, [], 'No unhandled browser JavaScript errors');
  console.log(JSON.stringify({ result: 'PASS', checks: checks.length, mode: 'mock', screenshot: '.tools/browser/page-settings-editable.png' }));
} catch (error) {
  await currentPage?.screenshot({ path: '.tools/browser/page-settings-failure.png', fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  await browser?.close();
  const fixtureEmails = [adminEmail, managerEmail];
  await db.auditLog.deleteMany({ where: { OR: [{ pageId: fixturePageId }, { actor: { email: { in: fixtureEmails } } }] } });
  await db.page.deleteMany({ where: { id: fixturePageId } });
  await db.user.deleteMany({ where: { email: { in: fixtureEmails } } });
  await db.$disconnect();
}
