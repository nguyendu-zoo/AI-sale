import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

const safeExceptionNames = new Set([
  'Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'EvalError', 'AggregateError',
  'AbortError', 'TimeoutError', 'HttpException', 'InternalServerErrorException', 'NotImplementedException',
  'BadGatewayException', 'ServiceUnavailableException', 'GatewayTimeoutException', 'HttpVersionNotSupportedException',
  'PrismaClientKnownRequestError', 'PrismaClientUnknownRequestError', 'PrismaClientInitializationError',
  'PrismaClientValidationError', 'PrismaClientRustPanicError',
]);
const safePrismaCodes = new Set([
  'P1000', 'P1001', 'P1002', 'P1003', 'P1008', 'P1010', 'P1011', 'P1013', 'P1017',
  'P2000', 'P2001', 'P2002', 'P2003', 'P2004', 'P2005', 'P2006', 'P2007', 'P2008', 'P2009',
  'P2010', 'P2011', 'P2012', 'P2013', 'P2014', 'P2015', 'P2016', 'P2017', 'P2018', 'P2019',
  'P2020', 'P2021', 'P2022', 'P2023', 'P2024', 'P2025', 'P2026', 'P2027', 'P2028', 'P2029',
  'P2030', 'P2031', 'P2032', 'P2033', 'P2034', 'P2035', 'P2036', 'P2037',
]);

function diagnostics(error: unknown) {
  // Names/codes can be arbitrary strings on thrown values. Log only known labels;
  // messages, stacks, Prisma metadata and connection URLs must stay out of logs.
  const exceptionName = error instanceof Error
    ? safeExceptionNames.has(error.name) ? error.name : 'Error'
    : 'UnknownError';
  const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code
    : error instanceof Prisma.PrismaClientInitializationError ? error.errorCode : undefined;
  const prismaCode = code && safePrismaCodes.has(code) ? code : undefined;
  return { exceptionName, ...(prismaCode ? { prismaCode } : {}) };
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');
  catch(error: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    let status = 500;
    let extra: Record<string, unknown> = {};
    let message: string | string[] = 'Lỗi hệ thống. Vui lòng thử lại sau.';
    if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      if (typeof body === 'object') extra = body as Record<string, unknown>;
      message = typeof body === 'string' ? body : (body as { message: string | string[] }).message;
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') { status = 409; message = 'Dữ liệu đã tồn tại.'; }
      if (error.code === 'P2025' || error.code === 'P2003') { status = 404; message = 'Không tìm thấy dữ liệu liên quan.'; }
    }
    if (status >= 500) this.logger.error(JSON.stringify({ event: 'request_failed', method: request.method, path: request.path, status, ...diagnostics(error) }));
    response.status(status).json({ ...extra, statusCode: status, message });
  }
}
