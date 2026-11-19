import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Run against an already started local MOCK API and Vite server:
// pnpm test:browser
// Credentials exist only in process memory; cleanup deletes this run's fixtures.
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { PrismaClient } = requireApi('@prisma/client');
const { hash } = requireApi('bcryptjs');
const web = process.env.BROWSER_WEB_URL || 'http://localhost:5173';
const api = process.env.BROWSER_API_URL || 'http://127.0.0.1:3000';
const health = await (await fetch(`${api}/api/health`)).json();
assert.equal(health.mode, 'mock', 'Browser smoke only runs against explicitly MOCK integrations');
assert.ok(['localhost', '127.0.0.1'].includes(new URL(web).hostname), 'Browser fixtures are local-only');
assert.ok(['localhost', '127.0.0.1'].includes(new URL(api).hostname), 'API fixtures are local-only');
assert.ok(process.env.DATABASE_URL && ['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname), 'Database fixtures require a local DATABASE_URL');
const run = randomBytes(6).toString('hex');
const adminEmail = `browser-admin-${run}@test.invalid`;
const managerEmail = `browser-manager-${run}@test.invalid`;
const password = randomBytes(24).toString('base64url');
const pageId = `browser-${run}`;
const customerId = `customer-${run}`;
const pageName = `QA local ${run}`;
const db = new PrismaClient();
let browser;
let currentPage;
const failures = [];
const passed = [];
const check = (name) => { passed.push(name); console.log(`PASS ${name}`); };

async function until(read, accepts, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accepts(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}

async function login(page, email) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.getByRole('heading', { name: 'Trung tâm hội thoại' }).waitFor();
}

async function noOverflow(page, label) {
  // Ant Design animates sidebar widths after a viewport change. Assert the settled layout.
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, undefined, { timeout: 3000 }).catch(() => undefined);
  const bounds = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
  assert.ok(bounds.width <= bounds.viewport + 1, `${label}: document width ${bounds.width} exceeds viewport ${bounds.viewport}`);
}

try {
  await db.user.create({ data: { email: adminEmail, name: 'Browser QA admin', role: 'SUPER_ADMIN', passwordHash: await hash(password, 4), emailVerifiedAt: new Date() } });
  await db.page.create({ data: { id: pageId, name: pageName, externalPageId: `mock-browser-${run}`, settings: { segmentRules: { POPULAR: [0.05], MID: [0.03], PREMIUM: [0.02] } } } });
  await db.product.create({ data: { pageId, sku: `QA-${run}`, name: 'Bình hoa kiểm thử trình duyệt', description: 'Gốm men lam thủ công dành cho không gian sống.', segment: 'POPULAR', basePrice: 200000, minPrice: 300000, maxPrice: 340000, stock: 10 } });
  await mkdir('.tools/browser', { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-first-run', '--disable-features=msEdgeSidebarV2'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, locale: 'vi-VN' });
  const page = await context.newPage();
  currentPage = page;
  page.on('pageerror', error => failures.push(error.message));
  page.setDefaultTimeout(20000);
  await page.goto(web, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Đăng nhập không gian làm việc' }).waitFor();
  await noOverflow(page, 'desktop login');
  await page.screenshot({ path: '.tools/browser/login-desktop.png', fullPage: true });
  check('Desktop login renders without overflow');

  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await page.getByLabel('Họ và tên', { exact: true }).fill('Browser QA manager');
  await page.getByLabel('Email', { exact: true }).fill(managerEmail);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  const [registration] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/auth/register'), { timeout: 60000 }),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(registration.status(), 201, 'UI registration must succeed using real local SMTP');
  const mailbox = await until(async () => {
    const body = await (await fetch('http://127.0.0.1:8025/api/v1/messages')).json();
    return body.messages.find(message => message.To.some(to => to.Address === managerEmail));
  }, Boolean, 'verification email in Mailpit');
  const mail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${mailbox.ID}`)).json();
  const token = mail.Text.match(/token=([a-f0-9]{64})/)?.[1];
  assert.ok(token, 'Actual SMTP email must contain verification link');
  await page.goto(`${web}/verify-email?token=${token}`);
  await page.getByRole('button', { name: 'Xác thực email', exact: true }).click();
  await page.getByText('Email đã được xác thực. Bạn có thể đăng nhập.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Đến trang đăng nhập', exact: true }).click();
  await login(page, managerEmail);
  await page.getByText('Bạn chưa được cấp quyền Fanpage. Liên hệ Super Admin để được phân công.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('menuitem', { name: /Fanpage & kết nối/ }).count(), 0, 'Managers cannot access admin navigation');
  check('UI register → SMTP verification → manager login with no page access');
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, 'mobile empty workspace');
  await page.screenshot({ path: '.tools/browser/manager-mobile.png', fullPage: true });
  check('Mobile manager workspace has no horizontal overflow');
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await page.getByRole('heading', { name: 'Đăng nhập không gian làm việc' }).waitFor();
  await noOverflow(page, 'mobile login');
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto(`${web}/?pageId=${pageId}`);
  await login(page, adminEmail);
  await page.getByText(pageName, { exact: true }).first().waitFor();
  await page.getByText('Chế độ demo local', { exact: false }).waitFor();
  await page.getByRole('button', { name: /Mô phỏng tin nhắn/ }).click();
  await page.getByLabel('Mã khách hàng mô phỏng', { exact: true }).fill(customerId);
  await page.getByLabel('Tên hiển thị', { exact: true }).fill('Khách QA local');
  await page.getByLabel('Nội dung tin nhắn', { exact: true }).fill(`Cho tôi hỏi QA-${run}`);
  await page.getByRole('button', { name: 'Gửi sự kiện mô phỏng', exact: true }).click();
  await until(() => db.conversation.findUnique({ where: { pageId_customerId: { pageId, customerId } }, include: { messages: true } }), item => item?.messages.some(message => message.sender === 'AI' && message.deliveryStatus === 'SENT'), 'queued AI reply');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /Khách QA local/ }).waitFor();
  await page.getByRole('button', { name: /Khách QA local/ }).click();
  await page.getByText('340.000 ₫', { exact: false }).first().waitFor();
  check('UI mock inbound → Redis queue → deterministic AI quote and realtime inbox');
  await page.getByRole('button', { name: /Tiếp quản/ }).click();
  await page.getByLabel('Bật tắt AI hội thoại', { exact: true }).waitFor();
  await until(() => db.conversation.findUnique({ where: { pageId_customerId: { pageId, customerId } } }), item => item?.aiEnabled === false && item.status === 'TAKEN_OVER', 'manual takeover');
  await page.getByLabel('Nội dung trả lời khách hàng', { exact: true }).fill('Nhân viên QA đang hỗ trợ bạn.');
  const [replyResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/reply') && response.request().method() === 'POST'),
    page.getByRole('button', { name: /Gửi trả lời/ }).click(),
  ]);
  assert.equal(replyResponse.status(), 201);
  assert.equal((await replyResponse.json()).deliveryStatus, 'SENT');
  await page.locator('.message-bubble').getByText('Nhân viên QA đang hỗ trợ bạn.', { exact: true }).waitFor();
  const conversation = await db.conversation.findUniqueOrThrow({ where: { pageId_customerId: { pageId, customerId } } });
  assert.equal(conversation.aiEnabled, false);
  const sent = await db.message.count({ where: { conversationId: conversation.id, sender: 'HUMAN', deliveryStatus: 'SENT' } });
  assert.equal(sent, 1);
  check('UI takeover and manual reply use cookie/CSRF API and disable conversation AI');
  await page.screenshot({ path: '.tools/browser/inbox-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, 'mobile inbox');
  await page.screenshot({ path: '.tools/browser/inbox-mobile.png', fullPage: true });
  check('Mobile conversation list and chat render without horizontal overflow');
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByRole('menuitem', { name: /Fanpage & kết nối/ }).click();
  await page.getByRole('button', { name: /Lưu cấu hình Fanpage/ }).waitFor();
  await page.getByLabel('Tên hiển thị', { exact: true }).fill(`${pageName} đã cập nhật`);
  await page.getByRole('button', { name: /Lưu cấu hình Fanpage/ }).click();
  await until(() => db.page.findUnique({ where: { id: pageId } }), item => item?.name === `${pageName} đã cập nhật`, 'UI settings save');
  check('Super Admin saves page settings through validated API');
  for (const [name, heading] of [['Sản phẩm', 'Danh mục sản phẩm'], ['Thông báo', 'Thông báo & chuyển tiếp'], ['Nhân viên', 'Nhân viên & phân quyền'], ['Nhật ký hoạt động', 'Nhật ký hoạt động']]) {
    await page.getByRole('menuitem', { name: new RegExp(name) }).click();
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
  }
  assert.deepEqual(failures, [], 'No unhandled browser JavaScript errors');
  check('Products, notifications, user permissions, audit screens render without JS errors');
  console.log(JSON.stringify({ result: 'PASS', checks: passed.length, mode: 'mock', screenshots: '.tools/browser' }));
} catch (error) {
  await currentPage?.screenshot({ path: '.tools/browser/failure.png', fullPage: true });
  throw error;
} finally {
  await browser?.close();
  const users = [adminEmail, managerEmail];
  await db.auditLog.deleteMany({ where: { OR: [{ pageId }, { actor: { email: { in: users } } }] } });
  await db.quote.deleteMany({ where: { conversation: { pageId } } });
  await db.page.deleteMany({ where: { id: pageId } });
  await db.user.deleteMany({ where: { email: { in: users } } });
  await db.$disconnect();
}
