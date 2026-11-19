import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { createTransport } from 'nodemailer';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const safeUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role, emailVerifiedAt: u.emailVerifiedAt });

@Injectable()
export class AuthService {
  constructor(private readonly db: PrismaService) {}
  async register(name: string, email: string, password: string) {
    email = email.trim().toLowerCase();
    const existing = await this.db.user.findUnique({ where: { email } });
    if (!existing) {
      const user = await this.db.user.create({ data: { name, email, passwordHash: await hash(password, 12), role: 'PAGE_MANAGER' } });
      await this.issueVerification(user);
    }
    return { message: 'Nếu email hợp lệ, hướng dẫn xác thực đã được gửi. Vui lòng kiểm tra hộp thư.' };
  }
  async issueVerification(user: User) {
    const token = randomBytes(32).toString('hex');
    await this.db.emailVerification.create({ data: { userId: user.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 3600_000) } });
    const url = `${process.env.WEB_URL || 'http://localhost:5173'}/verify-email?token=${token}`;
    const configuredHost = process.env.SMTP_HOST || '127.0.0.1';
    // Loopback avoids Windows sandbox DNS timeouts; preserve the configured TLS host in production.
    const smtpHost = process.env.NODE_ENV !== 'production' && configuredHost.toLowerCase() === 'localhost' ? '127.0.0.1' : configuredHost;
    const transport = createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT || 1025),
      secure: process.env.SMTP_SECURE === 'true',
      requireTLS: process.env.NODE_ENV === 'production',
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
      disableFileAccess: true,
      disableUrlAccess: true,
      ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
    });
    try {
      await transport.sendMail({ from: process.env.MAIL_FROM || 'AI Sales <noreply@localhost>', to: user.email, subject: 'Xác thực tài khoản AI Sales Agent', text: `Mở liên kết sau để xác thực email (hết hạn sau 1 giờ):\n${url}\nNếu bạn không đăng ký, hãy bỏ qua email này.` });
    } catch (error: unknown) {
      const failure = error as { code?: string; command?: string };
      new Logger(AuthService.name).warn(JSON.stringify({ event: 'verification_email_failed', code: failure.code || 'UNKNOWN', command: failure.command || 'UNKNOWN' }));
      throw new BadRequestException('Chưa gửi được email xác thực. Kiểm tra SMTP hoặc Mailpit rồi yêu cầu gửi lại.');
    }
  }
  async resend(email: string) {
    const user = await this.db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (user && !user.emailVerifiedAt) await this.issueVerification(user);
    return { message: 'Nếu tài khoản cần xác thực, email mới đã được gửi.' };
  }
  async verify(token: string) {
    await this.db.$transaction(async tx => {
      const verification = await tx.emailVerification.findUnique({ where: { tokenHash: digest(token) } });
      if (!verification || verification.expiresAt.getTime() < Date.now()) throw new BadRequestException('Liên kết không hợp lệ hoặc đã hết hạn.');
      const consumed = await tx.emailVerification.deleteMany({ where: { id: verification.id } });
      if (consumed.count !== 1) throw new BadRequestException('Liên kết đã được sử dụng.');
      await tx.user.update({ where: { id: verification.userId }, data: { emailVerifiedAt: new Date() } });
      await tx.emailVerification.deleteMany({ where: { userId: verification.userId } });
    });
    return { message: 'Email đã được xác thực. Bạn có thể đăng nhập.' };
  }
  async login(email: string, password: string) {
    const user = await this.db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    // A real bcrypt comparison also runs on missing users to avoid a fast enumeration path.
    const valid = await compare(password, user?.passwordHash || '$2b$12$x6pXzfm9cA4xxijtiRTwA.fevH4e9N0phsFKQKZbYIG8pvsoG3yF.');
    if (!user || !valid) throw new UnauthorizedException('Email hoặc mật khẩu không đúng.');
    if (!user.emailVerifiedAt) throw new ForbiddenException('Vui lòng xác thực email trước khi đăng nhập.');
    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(32).toString('hex');
    await this.db.session.create({ data: { userId: user.id, tokenHash: digest(token), csrfHash: digest(csrf), expiresAt: new Date(Date.now() + 7 * 86400_000) } });
    return { user: safeUser(user), token, csrf };
  }
  async session(token?: string) {
    if (!token || token.length > 128) throw new UnauthorizedException();
    const session = await this.db.session.findUnique({ where: { tokenHash: digest(token) }, include: { user: true } });
    if (!session || session.expiresAt.getTime() <= Date.now() || !session.user.emailVerifiedAt) throw new UnauthorizedException();
    return session;
  }
  async logout(token: string) { await this.db.session.deleteMany({ where: { tokenHash: digest(token) } }); }
}
