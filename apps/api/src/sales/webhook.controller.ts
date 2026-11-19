import { Controller, Get, Headers, HttpCode, Post, Query, RawBodyRequest, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { SalesService } from './sales.service';

@Public()
@ApiTags('Messenger Webhook')
@Controller('webhooks/messenger')
export class WebhookController {
  constructor(private readonly sales: SalesService) {}
  @Get()
  @ApiOperation({ summary: 'Meta webhook verification' })
  verify(@Query('hub.mode') mode?: string, @Query('hub.verify_token') token?: string, @Query('hub.challenge') challenge?: string): string {
    return this.sales.verifyWebhook(mode, token, challenge);
  }
  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive HMAC-verified Meta events into durable queue' })
  async receive(@Req() request: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature?: string): Promise<{ received: true }> {
    await this.sales.receiveWebhook(request.rawBody ?? Buffer.alloc(0), signature);
    return { received: true };
  }
}
