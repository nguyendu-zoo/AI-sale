import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.service';
import { CommonModule } from './common/encryption.service';
import { AuthModule } from './auth/auth.module';
import { RealtimeModule } from './realtime/realtime.service';
import { SalesModule } from './sales/sales.module';
import { PagesController, AdminController } from './pages/pages.controller';
import { ConversationsController } from './conversations/conversations.controller';
import { HealthController } from './health.controller';
@Module({ imports: [PrismaModule, CommonModule, AuthModule, RealtimeModule, SalesModule], controllers: [PagesController, AdminController, ConversationsController, HealthController] })
export class AppModule {}
