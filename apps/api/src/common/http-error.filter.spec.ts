import { ArgumentsHost, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HttpErrorFilter } from './http-error.filter';

const secret = 'test-only-private-value-do-not-log';

function invoke(error: unknown) {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', path: '/api/example' }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  new HttpErrorFilter().catch(error, host);
  return response;
}

describe('HTTP error diagnostics', () => {
  let log: jest.SpyInstance;
  beforeEach(() => { log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined); });
  afterEach(() => { jest.restoreAllMocks(); });
  const record = () => JSON.parse(log.mock.calls[0]![0] as string) as Record<string, unknown>;

  it('logs a safe exception label without the message, stack or custom properties', () => {
    const error = Object.assign(new TypeError(`postgresql://user:${secret}@host/db`), { details: secret });
    const response = invoke(error);
    expect(record()).toEqual({ event: 'request_failed', method: 'GET', path: '/api/example', status: 500, exceptionName: 'TypeError' });
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(response.json.mock.calls)).not.toContain(secret);
    expect(response.status).toHaveBeenCalledWith(500);
  });

  it('does not log an attacker-controlled exception name or code', () => {
    const error = Object.assign(new Error(secret), { name: secret, code: secret });
    invoke(error);
    expect(record().exceptionName).toBe('Error');
    expect(record().prismaCode).toBeUndefined();
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });

  it('logs allowlisted initialization codes without logging connection credentials', () => {
    invoke(new Prisma.PrismaClientInitializationError(`Connection failed: ${secret}`, 'test-version', 'P1001'));
    expect(record()).toMatchObject({ exceptionName: 'PrismaClientInitializationError', prismaCode: 'P1001', status: 500 });
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });

  it('logs allowlisted known request codes without Prisma metadata', () => {
    invoke(new Prisma.PrismaClientKnownRequestError(secret, { code: 'P2021', clientVersion: 'test-version', meta: { privateValue: secret } }));
    expect(record()).toMatchObject({ exceptionName: 'PrismaClientKnownRequestError', prismaCode: 'P2021' });
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });

  it('omits unknown Prisma error codes and arbitrary thrown objects', () => {
    invoke(new Prisma.PrismaClientKnownRequestError(secret, { code: secret, clientVersion: 'test-version' }));
    expect(record().prismaCode).toBeUndefined();
    log.mockClear();
    invoke({ name: secret, message: secret, code: 'P1001' });
    expect(record().exceptionName).toBe('UnknownError');
    expect(record().prismaCode).toBeUndefined();
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });

  it.each([
    [new NotFoundException(), 404],
    [new UnauthorizedException(), 401],
    [new Prisma.PrismaClientKnownRequestError(secret, { code: 'P2002', clientVersion: 'test-version' }), 409],
    [new Prisma.PrismaClientKnownRequestError(secret, { code: 'P2003', clientVersion: 'test-version' }), 404],
    [new Prisma.PrismaClientKnownRequestError(secret, { code: 'P2025', clientVersion: 'test-version' }), 404],
  ])('preserves status mapping for %p', (error, expectedStatus) => {
    const response = invoke(error);
    expect(response.status).toHaveBeenCalledWith(expectedStatus);
    expect(log).not.toHaveBeenCalled();
  });

  it('preserves readiness status and details', () => {
    const response = invoke(new ServiceUnavailableException({ status: 'degraded', database: false, redis: false }));
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 503, status: 'degraded', database: false, redis: false }));
    expect(record().exceptionName).toBe('ServiceUnavailableException');
  });
});
