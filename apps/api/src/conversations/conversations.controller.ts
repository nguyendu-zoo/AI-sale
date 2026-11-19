import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsString, Length } from 'class-validator';
import { ConversationStatus } from '@prisma/client';
import { AuthRequest } from '../auth/auth.guard';
import { RbacService } from '../auth/rbac.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SalesService } from '../sales/sales.service';
class AiDto { @ApiProperty() @IsBoolean() enabled!: boolean; }
class ReplyDto { @ApiProperty({ minLength: 1, maxLength: 2000 }) @IsString() @Length(1, 2000) text!: string; }
@ApiTags('Conversations')
@ApiCookieAuth()
@Controller('pages/:pageId/conversations')
export class ConversationsController {
  constructor(private readonly db: PrismaService, private readonly rbac: RbacService, private readonly realtime: RealtimeService, private readonly sales: SalesService) {}
  @ApiQuery({ name: 'status', enum: ConversationStatus, required: false })
  @ApiQuery({ name: 'search', required: false })
  @Get() async list(@Req() req: AuthRequest, @Param('pageId') pageId: string, @Query('status') status?: string, @Query('search') search?: string) {
    await this.rbac.page(req.user, pageId);
    if (status && !Object.values(ConversationStatus).includes(status as ConversationStatus)) throw new BadRequestException('Trạng thái không hợp lệ.');
    return this.db.conversation.findMany({ where: { pageId, ...(status ? { status: status as ConversationStatus } : {}), ...(search ? { OR: [{ customerName: { contains: search.slice(0, 100), mode: 'insensitive' as const } }, { customerId: { contains: search.slice(0, 100) } }] } : {}) }, include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 }, quotes: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { updatedAt: 'desc' }, take: 100 });
  }
  @Get(':id') async get(@Req() req: AuthRequest, @Param('pageId') pageId: string, @Param('id') id: string) {
    await this.rbac.page(req.user, pageId);
    const conversation = await this.db.conversation.findFirst({ where: { id, pageId }, include: { messages: { orderBy: { createdAt: 'asc' }, take: 500 }, quotes: { include: { product: true }, orderBy: { createdAt: 'desc' }, take: 100 }, interestedProduct: true } });
    if (!conversation) throw new NotFoundException();
    return conversation;
  }
  @Patch(':id/ai') async ai(@Req() req: AuthRequest, @Param('pageId') pageId: string, @Param('id') id: string, @Body() dto: AiDto) {
    return this.changeState(req, pageId, id, dto.enabled, dto.enabled ? 'AI_ACTIVE' : 'TAKEN_OVER');
  }
  @Post(':id/takeover') async takeover(@Req() req: AuthRequest, @Param('pageId') pageId: string, @Param('id') id: string) {
    return this.changeState(req, pageId, id, false, 'TAKEN_OVER');
  }
  private async changeState(req: AuthRequest, pageId: string, id: string, enabled: boolean, status: ConversationStatus) {
    await this.rbac.page(req.user, pageId);
    const result = await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pageId}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      // Recheck membership inside the mutation transaction as well.
      if (req.user.role !== 'SUPER_ADMIN' && !await tx.pageMember.findUnique({ where: { userId_pageId: { userId: req.user.id, pageId } } })) throw new NotFoundException();
      if (!await tx.conversation.findFirst({ where: { id, pageId } })) throw new NotFoundException();
      const updated = await tx.conversation.update({ where: { id }, data: { aiEnabled: enabled, status, version: { increment: 1 }, ...(enabled ? { handoffReason: null } : {}) } });
      await tx.auditLog.create({ data: { pageId, actorId: req.user.id, action: enabled ? 'CONVERSATION_AI_RESUMED' : 'CONVERSATION_TAKEN_OVER', metadata: { conversationId: id } } });
      return updated;
    }, { timeout: 20000 });
    await this.realtime.emitPage(pageId, 'page_update', {});
    return result;
  }
  @Post(':id/reply') async reply(@Req() req: AuthRequest, @Param('pageId') pageId: string, @Param('id') id: string, @Body() dto: ReplyDto) {
    await this.rbac.page(req.user, pageId);
    return this.sales.sendHuman(pageId, id, req.user.id, dto.text);
  }
}
