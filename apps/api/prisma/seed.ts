import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { isEmail } from 'class-validator';

const db = new PrismaClient();
const pages = [
  { id: 'demo-maison', name: 'MaiSon • Gốm Bát Tràng', externalPageId: '100000000000001' },
  { id: 'demo-phuc-khang', name: 'Phúc Khang • Gốm Việt', externalPageId: '100000000000002' }
];

async function main() {
  // These are labeled local fixtures. They do not establish any external API connection.
  for (const page of pages) {
    await db.page.upsert({ where: { id: page.id }, update: {}, create: {
      ...page,
      settings: {
        demo: true,
        segmentRules: { POPULAR: [0.05, 0.05, 0.02], MID: [0.03, 0.03, 0.02], PREMIUM: [0.02, 0.02] },
        sheet: { spreadsheetId: '', tab: 'Products', mapping: { sku: 'SKU', name: 'Tên sản phẩm', segment: 'Phân khúc', description: 'Mô tả', dimensions: 'Kích thước', imageUrl: 'Ảnh', stock: 'Tồn kho', active: 'Đang bán', basePrice: 'Giá gốc', minPrice: 'Giá min', maxPrice: 'Giá max' } }
      }
    }});
    const products = [
      { sku: 'BT-001', name: 'Bình hoa men rạn', segment: 'POPULAR' as const, description: 'Bình gốm Bát Tràng men rạn thủ công, phù hợp trang trí phòng khách.', dimensions: 'Cao 28 cm', basePrice: 200000, minPrice: 300000, maxPrice: 340000, stock: 24 },
      { sku: 'BT-002', name: 'Bộ trà hoa lam', segment: 'MID' as const, description: 'Bộ ấm trà họa tiết hoa lam, gồm 1 ấm và 6 chén.', dimensions: 'Ấm 600 ml', basePrice: 450000, minPrice: 690000, maxPrice: 820000, stock: 12 },
      { sku: 'BT-003', name: 'Lộc bình vẽ vàng', segment: 'PREMIUM' as const, description: 'Lộc bình trang trí cao cấp, hoàn thiện thủ công.', dimensions: 'Cao 60 cm', basePrice: 1800000, minPrice: 2800000, maxPrice: 3200000, stock: 5 }
    ];
    for (const product of products) {
      await db.product.upsert({ where: { pageId_sku: { pageId: page.id, sku: product.sku } }, update: {}, create: { ...product, pageId: page.id } });
    }
  }
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    if (!isEmail(email)) throw new Error('SEED_ADMIN_EMAIL must be a valid email address.');
    if (password.length < 12 || Buffer.byteLength(password) > 72) throw new Error('SEED_ADMIN_PASSWORD must be 12+ characters and at most 72 UTF-8 bytes.');
    const existing = await db.user.findUnique({ where: { email }, select: { role: true } });
    if (existing && existing.role !== 'SUPER_ADMIN') throw new Error('The seed email already belongs to a non-admin account. Choose a new SEED_ADMIN_EMAIL; seed will not silently promote existing accounts.');
    await db.user.upsert({ where: { email }, update: {}, create: { email, name: 'Quản trị hệ thống', passwordHash: await hash(password, 12), role: 'SUPER_ADMIN', emailVerifiedAt: new Date() } });
    console.log('Initial local Super Admin ensured. Existing account role/password never overwritten.');
  } else {
    console.log('SEED_ADMIN_EMAIL/PASSWORD chưa được cấu hình; không tạo tài khoản quản trị.');
  }
  console.log('Seed complete: 2 DEMO Fanpages, 6 DEMO products. No external service connection was attempted.');
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Seed failed'); process.exitCode = 1; }).finally(() => db.$disconnect());
