import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve('.env');
if (existsSync(target)) {
  console.log('.env đã tồn tại; giữ nguyên cấu hình và secret.');
  process.exit(0);
}
const password = randomBytes(24).toString('hex');
let template = readFileSync(resolve('.env.example'), 'utf8');
template = template.replace(/^POSTGRES_PASSWORD=$/m, `POSTGRES_PASSWORD=${password}`);
template = template.replaceAll('SET_LOCAL_PASSWORD', password);
template = template.replace(/^ENCRYPTION_KEY=$/m, `ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`);
template = template.replace(/^META_APP_SECRET=$/m, `META_APP_SECRET=${randomBytes(32).toString('hex')}`);
template = template.replace(/^META_VERIFY_TOKEN=$/m, `META_VERIFY_TOKEN=${randomBytes(24).toString('hex')}`);
writeFileSync(target, template, { flag: 'wx', mode: 0o600 });
console.log('Đã tạo .env cho local mock, mật khẩu PostgreSQL và khóa mã hóa ngẫu nhiên.');
console.log('META_APP_SECRET/META_VERIFY_TOKEN hiện là khóa kiểm thử local; thay bằng cấu hình Meta thật trước khi dùng live.');
console.log('Điền SEED_ADMIN_EMAIL và SEED_ADMIN_PASSWORD trong .env rồi chạy pnpm db:seed nếu cần Super Admin.');
