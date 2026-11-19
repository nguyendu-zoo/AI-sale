import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { RbacService } from './rbac.service';
@Global()
@Module({ controllers: [AuthController], providers: [AuthService, RbacService, { provide: APP_GUARD, useClass: AuthGuard }], exports: [AuthService, RbacService] })
export class AuthModule {}
