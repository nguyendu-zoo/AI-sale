import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { User } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { AuthService, digest } from './auth.service';

export type AuthRequest = Request & { user: User };
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const origin = request.get('origin');
    if (unsafe && origin && origin !== (process.env.WEB_URL || 'http://localhost:5173')) throw new ForbiddenException('Origin không hợp lệ.');
    if (this.reflector.getAllAndOverride<boolean>('public', [context.getHandler(), context.getClass()])) return true;
    const session = await this.auth.session(request.cookies?.session_token);
    request.user = session.user;
    if (unsafe) {
      const csrf = request.get('x-csrf-token');
      if (!csrf || !timingSafeEqual(Buffer.from(digest(csrf)), Buffer.from(session.csrfHash))) throw new ForbiddenException('CSRF token không hợp lệ.');
    }
    return true;
  }
}
