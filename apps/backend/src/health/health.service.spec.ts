import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { HealthService } from './health.service.js';

describe('HealthService.check', () => {
  let service: HealthService;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [HealthService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(HealthService);
  });

  it('throws ServiceUnavailableException when the database query fails', async () => {
    prisma.$queryRaw.mockRejectedValue(
      new Error('Connection terminated unexpectedly'),
    );

    await expect(service.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('answers 503 with a message that carries no database internals', async () => {
    prisma.$queryRaw.mockRejectedValue(
      new Error('postgres://user:secret@db-host:5432/sigap failed'),
    );

    const error: unknown = await service.check().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const body = (error as ServiceUnavailableException).getResponse() as Record<
      string,
      unknown
    >;
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('postgres');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('db-host');
    expect(body['statusCode']).toBe(503);
    expect(body['message']).toBe('Database is unavailable');
  });

  it('returns ok when SELECT 1 succeeds', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await expect(service.check()).resolves.toEqual({ status: 'ok' });
  });
});
