import { Module } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service';
import { SalesService } from './sales.service';
import { WebhookController } from './webhook.controller';

@Module({ providers: [IntegrationsService, SalesService], controllers: [WebhookController], exports: [SalesService, IntegrationsService] })
export class SalesModule {}
