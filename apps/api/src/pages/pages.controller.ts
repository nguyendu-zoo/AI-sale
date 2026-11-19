import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, MaxLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { Prisma, Page } from '@prisma/client';
import { z } from 'zod';
import { AuthRequest } from '../auth/auth.guard';
import { RbacService } from '../auth/rbac.service';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/encryption.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SalesService } from '../sales/sales.service';

class CreatePageDto {
  @ApiProperty({ minLength: 2, maxLength: 100 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(2, 100) name!: string;
  @ApiProperty({ description: 'Facebook Page ID; mã riêng khi chạy mock.', maxLength: 100 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 100) externalPageId!: string;
}
const mappingKeys = ['sku','name','segment','description','dimensions','imageUrl','stock','active','basePrice','minPrice','maxPrice'] as const;
const settingsSchema = z.object({
  demo: z.boolean().optional(),
  aiInstructions: z.string().max(2000).optional(),
  sheet: z.object({ spreadsheetId: z.string().max(200), tab: z.string().max(100), mapping: z.partialRecord(z.enum(mappingKeys), z.string().max(100)) }).optional(),
  segmentRules: z.object({ POPULAR: z.array(z.number().min(0).max(1)).max(10), MID: z.array(z.number().min(0).max(1)).max(10), PREMIUM: z.array(z.number().min(0).max(1)).max(10) }).optional(),
  telegramChatId: z.string().max(100).optional(),
}).strict();
class UpdatePageDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 100 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @ValidateIf((_object, value) => value !== undefined) @IsString() @Length(2, 100) name?: string;
  @ApiPropertyOptional({ minLength: 1, maxLength: 100, description: 'Super Admin được đổi ID khi Fanpage chưa có lịch sử hội thoại/webhook. Đổi ID sẽ tắt AI và xóa token Messenger cũ nếu không cung cấp token mới.' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @ValidateIf((_object, value) => value !== undefined) @IsString() @Length(1, 100) externalPageId?: string;
  @ApiPropertyOptional()
  @IsOptional() @IsBoolean() aiEnabled?: boolean;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'sheet:{spreadsheetId,tab,mapping}; segmentRules:{POPULAR:number[],MID:number[],PREMIUM:number[]}; telegramChatId; demo. Nấc giảm 0..1, tối đa 10 nấc/phân khúc.' })
  @IsOptional() settings?: unknown;
  @ApiPropertyOptional({ writeOnly: true, maxLength: 8000, description: 'Chuỗi rỗng xóa token. API không trả lại giá trị.' })
  @IsOptional() @IsString() @MaxLength(8000) messengerToken?: string;
  @ApiPropertyOptional({ writeOnly: true, maxLength: 16000, description: 'Service account JSON; chuỗi rỗng xóa credential.' })
  @IsOptional() @IsString() @MaxLength(16000) googleCredentials?: string;
  @ApiPropertyOptional({ writeOnly: true, maxLength: 8000 })
  @IsOptional() @IsString() @MaxLength(8000) telegramToken?: string;
}
class SimulateDto {
  @ApiProperty({ maxLength: 100 })
  @IsString() @Length(1, 100) customerId!: string;
  @ApiProperty({ maxLength: 2000 })
  @IsString() @Length(1, 2000) text!: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional() @IsString() @Length(1, 100) customerName?: string;
}
export const safePage = (page: Page, admin = true) => ({
  id: page.id, name: page.name, externalPageId: page.externalPageId, aiEnabled: page.aiEnabled,
  lastSyncedAt: page.lastSyncedAt, syncError: page.syncError, createdAt: page.createdAt,
  settings: admin ? page.settings : {},
  integrations: { messenger: !!page.messengerTokenEnc, google: !!page.googleCredentialsEnc, telegram: !!page.telegramTokenEnc },
  messengerConfigured: !!page.messengerTokenEnc, googleConfigured: !!page.googleCredentialsEnc, telegramConfigured: !!page.telegramTokenEnc,
});

@ApiTags('Fanpages')
@ApiCookieAuth()
@Controller('pages')
export class PagesController {
  constructor(private readonly db: PrismaService, private readonly rbac: RbacService, private readonly encryption: EncryptionService, private readonly realtime: RealtimeService, private readonly sales: SalesService) {}
  private validateExternalPageId(value: string) {
    const valid = process.env.INTEGRATIONS_MODE === 'live' ? /^\d+$/.test(value) : /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
    if (!valid) throw new BadRequestException(process.env.INTEGRATIONS_MODE === 'live'
      ? 'Facebook Page ID phải chỉ gồm chữ số; không nhập URL Facebook.'
      : 'Facebook Page ID không hợp lệ. Nhập ID số hoặc mã mock gồm chữ, số, dấu gạch ngang/gạch dưới.');
  }
  private duplicatePageId(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('Facebook Page ID này đã được gắn với một Fanpage khác.');
    }
    throw error;
  }
  @Get() async list(@Req() req: AuthRequest) {
    const pages = await this.db.page.findMany({ where: req.user.role === 'SUPER_ADMIN' ? {} : { members: { some: { userId: req.user.id } } }, orderBy: { name: 'asc' } });
    return pages.map(p => safePage(p, req.user.role === 'SUPER_ADMIN'));
  }
  @Post() async create(@Req() req: AuthRequest, @Body() dto: CreatePageDto) {
    this.rbac.admin(req.user);
    this.validateExternalPageId(dto.externalPageId);
    const page = await this.db.$transaction(async tx => {
      const created = await tx.page.create({ data: dto });
      await tx.auditLog.create({ data: { actorId: req.user.id, pageId: created.id, action: 'PAGE_CREATED' } });
      return created;
    }).catch(error => this.duplicatePageId(error));
    return safePage(page);
  }
  @Patch(':pageId') async update(@Req() req: AuthRequest, @Param('pageId') pageId: string, @Body() dto: UpdatePageDto) {
    this.rbac.admin(req.user);
    if (dto.externalPageId !== undefined) this.validateExternalPageId(dto.externalPageId);
    let settings: Prisma.InputJsonValue | undefined;
    if (dto.settings !== undefined) {
      const parsed = settingsSchema.safeParse(dto.settings);
      if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
      settings = parsed.data as Prisma.InputJsonValue;
    }
    if (dto.googleCredentials) {
      try { const value = JSON.parse(dto.googleCredentials); if (!value.client_email || !value.private_key) throw new Error(); }
      catch { throw new BadRequestException('Google credentials phải là service account JSON hợp lệ.'); }
    }
    const page = await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pageId}))`;
      const current = await tx.page.findUnique({ where: { id: pageId } });
      if (!current) throw new NotFoundException();
      const bindingChanged = dto.externalPageId !== undefined && dto.externalPageId !== current.externalPageId;
      if (bindingChanged) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'page-binding:' + pageId}))`;
        const duplicate = await tx.page.findUnique({ where: { externalPageId: dto.externalPageId! }, select: { id: true } });
        if (duplicate && duplicate.id !== pageId) throw new ConflictException('Facebook Page ID này đã được gắn với một Fanpage khác.');
        const [conversationCount, webhookCount] = await Promise.all([
          tx.conversation.count({ where: { pageId } }),
          tx.webhookEvent.count({ where: { pageId } }),
        ]);
        if (conversationCount || webhookCount) throw new ConflictException('Fanpage đã có lịch sử hội thoại hoặc webhook. Hãy tạo Fanpage mới để gắn Page ID khác và giữ nguyên lịch sử cũ.');
      }
      const messengerToken = dto.messengerToken?.trim();
      const updated = await tx.page.update({ where: { id: pageId }, data: {
        name: dto.name, externalPageId: dto.externalPageId, aiEnabled: bindingChanged ? false : dto.aiEnabled, settings,
        ...(dto.messengerToken !== undefined || bindingChanged ? { messengerTokenEnc: messengerToken ? this.encryption.encrypt(messengerToken) : null } : {}),
        ...(dto.googleCredentials !== undefined ? { googleCredentialsEnc: dto.googleCredentials ? this.encryption.encrypt(dto.googleCredentials) : null } : {}),
        ...(dto.telegramToken !== undefined ? { telegramTokenEnc: dto.telegramToken ? this.encryption.encrypt(dto.telegramToken) : null } : {}),
      } });
      await tx.auditLog.create({ data: { actorId: req.user.id, pageId, action: 'PAGE_UPDATED', metadata: {
        fields: Object.keys(dto),
        ...(bindingChanged ? { externalPageIdChange: { from: current.externalPageId, to: dto.externalPageId! }, aiPaused: true, messengerTokenCleared: !messengerToken } : {}),
      } } });
      return updated;
    }, { timeout: 20000 }).catch(error => this.duplicatePageId(error));
    await this.realtime.emitPage(pageId, 'page_update', {});
    return safePage(page);
  }
  @Get(':pageId/products') async products(@Req() req: AuthRequest, @Param('pageId') pageId: string) {
    await this.rbac.page(req.user, pageId);
    const products = await this.db.product.findMany({ where: { pageId }, orderBy: { name: 'asc' } });
    return products;
  }
  @Post(':pageId/sync') async sync(@Req() req: AuthRequest, @Param('pageId') pageId: string) {
    this.rbac.admin(req.user); return this.sales.syncPage(pageId);
  }
  @Post(':pageId/simulate') async simulate(@Req() req: AuthRequest, @Param('pageId') pageId: string, @Body() dto: SimulateDto) {
    this.rbac.admin(req.user);
    if (process.env.INTEGRATIONS_MODE !== 'mock') throw new BadRequestException('Chỉ hỗ trợ mô phỏng khi INTEGRATIONS_MODE=mock.');
    return this.sales.simulate(pageId, dto);
  }
  @Get(':pageId/notifications') async notifications(@Req() req: AuthRequest, @Param('pageId') pageId: string) {
    await this.rbac.page(req.user, pageId);
    return this.db.notification.findMany({ where: { pageId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
  @Put(':pageId/members/:userId') async grant(@Req() req: AuthRequest, @Param('pageId') pageId: string, @Param('userId') userId: string) {
    this.rbac.admin(req.user);
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pageId}))`;
      await tx.pageMember.upsert({ where: { userId_pageId: { userId, pageId } }, create: { userId, pageId }, update: {} });
      await tx.auditLog.create({ data: { actorId: req.user.id, pageId, action: 'PAGE_ACCESS_GRANTED', metadata: { userId } } });
      return { message: 'Đã cấp quyền fanpage.' };
    });
  }
  @Delete(':pageId/members/:userId') async revoke(@Req() req: AuthRequest, @Param('pageId') pageId: string, @Param('userId') userId: string) {
    this.rbac.admin(req.user);
    await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pageId}))`;
      await tx.pageMember.deleteMany({ where: { userId, pageId } });
      await tx.auditLog.create({ data: { actorId: req.user.id, pageId, action: 'PAGE_ACCESS_REVOKED', metadata: { userId } } });
    });
    await this.realtime.revoke(userId, pageId);
    return { message: 'Đã thu hồi quyền fanpage.' };
  }
}

@ApiTags('Administration')
@ApiCookieAuth()
@Controller()
export class AdminController {
  constructor(private readonly db: PrismaService, private readonly rbac: RbacService) {}
  @Get('users') async users(@Req() req: AuthRequest) {
    this.rbac.admin(req.user);
    return this.db.user.findMany({ select: { id: true, email: true, name: true, role: true, emailVerifiedAt: true, createdAt: true, memberships: { select: { pageId: true, page: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  }
  @Get('audit') async audit(@Req() req: AuthRequest, @Query('pageId') pageId?: string) {
    this.rbac.admin(req.user);
    return this.db.auditLog.findMany({ where: pageId ? { pageId } : {}, include: { actor: { select: { name: true, email: true } }, page: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  }
}
