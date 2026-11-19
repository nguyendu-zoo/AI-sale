import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsByteLength, IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { Response } from 'express';
import { AuthService, safeUser } from './auth.service';
import { AuthRequest } from './auth.guard';
import { Public } from './public.decorator';

class EmailDto { @ApiProperty({ format: 'email', maxLength: 254 }) @IsEmail() @MaxLength(254) email!: string; }
class LoginDto extends EmailDto { @ApiProperty({ format: 'password', minLength: 12, maxLength: 72, description: 'Tối đa 72 byte UTF-8.' }) @IsString() @Length(12, 72) @IsByteLength(12, 72) password!: string; }
class RegisterDto extends LoginDto { @ApiProperty({ minLength: 2, maxLength: 100 }) @IsString() @Length(2, 100) name!: string; }
class VerifyDto { @ApiProperty({ minLength: 64, maxLength: 64 }) @IsString() @Length(64, 64) token!: string; }
@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Post('register') register(@Body() dto: RegisterDto) { return this.auth.register(dto.name, dto.email, dto.password); }
  @Public() @Post('verify-email') verify(@Body() dto: VerifyDto) { return this.auth.verify(dto.token); }
  @Public() @Post('resend-verification') resend(@Body() dto: EmailDto) { return this.auth.resend(dto.email); }
  @Public() @Post('login') async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(dto.email, dto.password);
    const options = { secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: 7 * 86400_000 };
    response.cookie('session_token', result.token, { ...options, httpOnly: true });
    response.cookie('csrf_token', result.csrf, { ...options, httpOnly: false });
    response.setHeader('Cache-Control', 'no-store');
    return { user: result.user };
  }
  @Get('me') me(@Req() request: AuthRequest) { return { user: safeUser(request.user) }; }
  @Post('logout') async logout(@Req() request: AuthRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies.session_token);
    response.clearCookie('session_token', { path: '/' }); response.clearCookie('csrf_token', { path: '/' });
    return { message: 'Đã đăng xuất.' };
  }
}
