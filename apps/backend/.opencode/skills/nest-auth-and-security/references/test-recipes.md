# Test recipes (auth)

Pattern and mocks follow `nest-testing`. Every block here ran in the scratch app described in
`reference-implementation.md`: unit specs with mocked Prisma, e2e specs on a real PostgreSQL database.
Copy the spec that matches the code you wrote; the meta-test is required in every project (rule 4).

| What | Spec | Required when |
|---|---|---|
| Every route has guards matching its Swagger prefix | `test/route-guards.e2e-spec.ts` | always |
| `JwtStrategy.validate` rejects missing / disabled / unverified / old `tv` | `jwt.strategy.spec.ts` | always |
| Login body shape, identical errors, status after password, register never overwrites, reset bumps `tv` | `auth.service.spec.ts` | always |
| OTP: 20 parallel guesses -> 5 compares, parallel consume -> 1 success, cooldown, send failure is silent | `otp.service.spec.ts` | OTP module |
| `RolesGuard` 401/403, hashing roundtrip + malformed hash | `roles.guard.spec.ts`, `hashing.service.spec.ts` | only if you touch those nest-common files |
| Env: boot fails without `JWT_SECRET` / feature secrets, console sender refuses production | `env.schema.spec.ts` | rule 25 env added |
| e2e: token in body, identical 401s, old token after reset -> 401, role change applies, disabled -> 401, bad `:id` -> 400, extra body field -> 400, `/auth/me` keys, 6th login -> 429, forged XFF, empty CORS, P2002 -> 409 | `test/auth.e2e-spec.ts` | when a test database exists |

**Prisma 7 + Jest e2e:** the client loads its query compiler with a dynamic `import()`. Jest (CommonJS) then fails
with "A dynamic import callback was invoked without --experimental-vm-modules" as soon as a real query runs. Use
`"test:e2e": "node --experimental-vm-modules node_modules/jest/bin/jest.js --config ./test/jest-e2e.json --runInBand"`.
Unit specs with a mocked `PrismaService` are not affected.

## Meta-test: route guards (required)

Fails when a handler has no `JwtAuthGuard` and is not labeled `[PUBLIC]`, when the label differs from `@Roles`,
or when `@Roles` sits without `RolesGuard`. Checked both ways: removing `@UseGuards` from an admin controller
and relabeling `[AUTH] Get my profile` as `[PUBLIC]` both turn it red; restoring makes it green.
If the project moves to a global guard + `@Public()` (rule 4 alternative), only `expectedPrefix` changes:
read `IS_PUBLIC_KEY` instead of looking for `JwtAuthGuard`.

```ts
// test/route-guards.e2e-spec.ts
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
  Reflector,
} from '@nestjs/core';
import { DECORATORS } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import type { RoleName } from '../src/common/types/auth-user';
import { PrismaService } from '../src/prisma/prisma.service';

type Handler = (...args: unknown[]) => unknown;

/** The Swagger prefix the guards imply (nest-architecture rule 12). */
function expectedPrefix(guards: unknown[], roles: RoleName[] | undefined) {
  if (!guards.includes(JwtAuthGuard)) return '[PUBLIC]';
  return roles?.length ? `[${roles.join('/')}]` : '[AUTH]';
}

/**
 * Per-route guards fail open: a forgotten @UseGuards leaves a route public
 * without any error. This test makes that visible. Every route in AppModule
 * must carry the summary prefix its guards imply, so an unguarded route has to
 * be labeled [PUBLIC] on purpose.
 */
describe('Route guards (meta)', () => {
  it('every route has guards that match its Swagger prefix', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    })
      // Only metadata is read, so no database connection is needed.
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    const discovery = moduleRef.get(DiscoveryService);
    const scanner = moduleRef.get(MetadataScanner);
    const reflector = moduleRef.get(Reflector);
    const problems: string[] = [];
    let routes = 0;

    for (const { metatype, instance } of discovery.getControllers()) {
      if (!metatype || !instance) continue;
      const prototype = Object.getPrototypeOf(instance) as Record<
        string,
        Handler
      >;
      for (const name of scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name];
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        routes += 1;
        const where = `${metatype.name}.${name}`;
        const targets = [handler, metatype];
        const guards = reflector.getAllAndMerge<unknown[]>(
          GUARDS_METADATA,
          targets,
        );
        const roles = reflector.getAllAndOverride<RoleName[] | undefined>(
          ROLES_KEY,
          targets,
        );
        const operation = reflector.get<
          { summary?: string; description?: string } | undefined
        >(DECORATORS.API_OPERATION, handler);
        const prefix = expectedPrefix(guards, roles);

        if (!operation?.summary?.startsWith(`${prefix} `)) {
          problems.push(
            `${where}: summary must start with "${prefix} ", got "${operation?.summary ?? ''}"`,
          );
        }
        if (roles?.length && !guards.includes(RolesGuard)) {
          problems.push(`${where}: @Roles without RolesGuard is not enforced`);
        }
        if (roles?.length && !guards.includes(JwtAuthGuard)) {
          problems.push(
            `${where}: @Roles without JwtAuthGuard always answers 401`,
          );
        }
        // A [PUBLIC] route guarded by something else (webhook secret, OAuth) says so.
        if (
          prefix === '[PUBLIC]' &&
          guards.length > 0 &&
          !operation?.description
        ) {
          problems.push(
            `${where}: non-JWT guard on a [PUBLIC] route needs a description`,
          );
        }
      }
    }

    expect(routes).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
```

## Unit specs

```ts
// src/auth/strategies/jwt.strategy.spec.ts
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  let strategy: JwtStrategy;
  let prisma: { user: { findUnique: jest.Mock } };
  const active = {
    id: 'u1',
    email: 'a@x.com',
    role: 'USER',
    isActive: true,
    emailVerifiedAt: new Date(),
    tokenVersion: 3,
  };

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'x'.repeat(32) },
        },
      ],
    }).compile();
    strategy = moduleRef.get(JwtStrategy);
  });

  it('returns the AuthUser with the role read from the database', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...active, role: 'ADMIN' });
    await expect(
      strategy.validate({ sub: 'u1', email: 'a@x.com', tv: 3 }),
    ).resolves.toEqual({ id: 'u1', email: 'a@x.com', role: 'ADMIN' });
  });

  it.each([
    ['the user is gone', null],
    ['the account is disabled', { ...active, isActive: false }],
    ['the email is not verified', { ...active, emailVerifiedAt: null }],
    [
      'tokenVersion moved on (reset, logout-all)',
      { ...active, tokenVersion: 4 },
    ],
  ])('rejects the token when %s', async (_case, row) => {
    prisma.user.findUnique.mockResolvedValue(row);
    await expect(
      strategy.validate({ sub: 'u1', email: 'a@x.com', tv: 3 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed before tv existed without querying', async () => {
    const legacy = { sub: 'u1', email: 'a@x.com' } as unknown as Parameters<
      JwtStrategy['validate']
    >[0];
    await expect(strategy.validate(legacy)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
```

```ts
// src/auth/auth.service.spec.ts
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { HashingService } from '../common/hashing/hashing.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { OtpService } from './otp/otp.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  };
  let tx: { user: { update: jest.Mock } };
  let otp: { issue: jest.Mock; consume: jest.Mock };
  const hashing = new HashingService();
  const jwt = new JwtService({ secret: 'x'.repeat(32) });
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hashing.hash('correct horse');
  });

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    tx = { user: { update: jest.fn().mockResolvedValue({ id: 'u1' }) } };
    otp = {
      issue: jest.fn(),
      consume: jest.fn(
        (_u: string, _p: string, _c: string, cb: (t: typeof tx) => unknown) =>
          cb(tx),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: HashingService, useValue: hashing },
        { provide: JwtService, useValue: jwt },
        { provide: OtpService, useValue: otp },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
    await service.onModuleInit();
  });

  const user = (over: Record<string, unknown> = {}) => ({
    id: 'u1',
    email: 'a@x.com',
    role: 'USER',
    isActive: true,
    emailVerifiedAt: new Date(),
    tokenVersion: 2,
    passwordHash,
    ...over,
  });

  describe('AuthService.login', () => {
    it('returns { accessToken } whose payload is { sub, email, tv } without role', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      const { accessToken } = await service.login({
        email: 'a@x.com',
        password: 'correct horse',
      });
      const claims = jwt.decode<Record<string, unknown>>(accessToken);
      expect(claims).toMatchObject({ sub: 'u1', email: 'a@x.com', tv: 2 });
      expect(claims).not.toHaveProperty('role');
    });

    it('answers an unknown email and a wrong password with the same error', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const unknown = await service
        .login({ email: 'nobody@x.com', password: 'whatever1' })
        .catch((e: unknown) => e);
      prisma.user.findUnique.mockResolvedValueOnce(user());
      const wrong = await service
        .login({ email: 'a@x.com', password: 'whatever1' })
        .catch((e: unknown) => e);

      expect(unknown).toBeInstanceOf(UnauthorizedException);
      expect(wrong).toBeInstanceOf(UnauthorizedException);
      expect((unknown as Error).message).toBe((wrong as Error).message);
    });

    it('treats an account without a password as invalid credentials', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ passwordHash: null }));
      await expect(
        service.login({ email: 'a@x.com', password: 'correct horse' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('reveals a disabled account only after the password is correct', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ isActive: false }));
      await expect(
        service.login({ email: 'a@x.com', password: 'wrong pass' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        service.login({ email: 'a@x.com', password: 'correct horse' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('AuthService.register', () => {
    it('never touches an existing account, verified or not', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      await expect(
        service.register({ email: 'a@x.com', password: 'new password' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('AuthService.resetPassword', () => {
    it('stores the new hash and bumps tokenVersion in the consuming transaction', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        emailVerifiedAt: null,
      });
      await service.resetPassword({
        email: 'a@x.com',
        code: '123456',
        newPassword: 'brand new pass',
      });
      expect(otp.consume).toHaveBeenCalledWith(
        'u1',
        'PASSWORD_RESET',
        '123456',
        expect.any(Function),
      );
      const [{ data }] = tx.user.update.mock.calls[0] as [
        { data: { tokenVersion: unknown; passwordHash: string } },
      ];
      expect(data.tokenVersion).toEqual({ increment: 1 });
      await expect(
        hashing.verify('brand new pass', data.passwordHash),
      ).resolves.toBe(true);
    });
  });
});
```

```ts
// src/auth/otp/otp.service.spec.ts
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { HashingService } from '../../common/hashing/hashing.service';
import { OTP_SENDER } from '../../common/mail/otp-sender';
import { PrismaService } from '../../prisma/prisma.service';
import { MAX_OTP_ATTEMPTS, OtpService } from './otp.service';

describe('OtpService', () => {
  let service: OtpService;
  let tx: { otpCode: { updateMany: jest.Mock } };
  let prisma: {
    otpCode: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let hashing: { hash: jest.Mock; verify: jest.Mock };
  let sender: { send: jest.Mock };
  const settings: Record<string, number> = {
    OTP_TTL_MINUTES: 10,
    OTP_RESEND_COOLDOWN_SECONDS: 60,
  };

  beforeEach(async () => {
    tx = { otpCode: { updateMany: jest.fn() } };
    prisma = {
      otpCode: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (client: typeof tx) => Promise<unknown>)(tx)
          : Promise.all(arg as Promise<unknown>[]),
      ),
    };
    hashing = {
      hash: jest.fn().mockResolvedValue('salt:hash'),
      verify: jest.fn(),
    };
    sender = { send: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: HashingService, useValue: hashing },
        { provide: OTP_SENDER, useValue: sender },
        {
          provide: ConfigService,
          useValue: { getOrThrow: (key: string) => settings[key] },
        },
      ],
    }).compile();
    service = moduleRef.get(OtpService);
  });

  describe('OtpService.consume', () => {
    beforeEach(() => {
      prisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        codeHash: 'h',
      });
    });

    it('lets at most MAX_OTP_ATTEMPTS parallel guesses reach the code check', async () => {
      // The mock imitates the guarded UPDATE ... WHERE attempts < 5.
      let attempts = 0;
      prisma.otpCode.updateMany.mockImplementation(() => {
        if (attempts >= MAX_OTP_ATTEMPTS) return Promise.resolve({ count: 0 });
        attempts += 1;
        return Promise.resolve({ count: 1 });
      });
      hashing.verify.mockResolvedValue(false);

      await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          service.consume('u1', 'PASSWORD_RESET', '000000', jest.fn()),
        ),
      );
      expect(hashing.verify).toHaveBeenCalledTimes(MAX_OTP_ATTEMPTS);
    });

    it('runs onSuccess once when the same correct code arrives twice in parallel', async () => {
      prisma.otpCode.updateMany.mockResolvedValue({ count: 1 });
      hashing.verify.mockResolvedValue(true);
      let used = false;
      tx.otpCode.updateMany.mockImplementation(() => {
        const count = used ? 0 : 1;
        used = true;
        return Promise.resolve({ count });
      });
      const onSuccess = jest.fn().mockResolvedValue('ok');

      const results = await Promise.allSettled([
        service.consume('u1', 'PASSWORD_RESET', '123456', onSuccess),
        service.consume('u1', 'PASSWORD_RESET', '123456', onSuccess),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    it('rejects without comparing when no attempt can be claimed', async () => {
      prisma.otpCode.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.consume('u1', 'PASSWORD_RESET', '123456', jest.fn()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(hashing.verify).not.toHaveBeenCalled();
    });

    it('scopes the lookup to the purpose', async () => {
      prisma.otpCode.findFirst.mockResolvedValue(null);
      await expect(
        service.consume('u1', 'PASSWORD_RESET', '123456', jest.fn()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.otpCode.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'u1',
            purpose: 'PASSWORD_RESET',
          }) as unknown,
        }),
      );
    });
  });

  describe('OtpService.issue', () => {
    const user = { id: 'u1', email: 'a@x.com' };

    it('retires older codes, stores only a hash, and sends the code', async () => {
      prisma.otpCode.findFirst.mockResolvedValue(null);
      await service.issue(user, 'EMAIL_VERIFICATION');

      expect(prisma.otpCode.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', purpose: 'EMAIL_VERIFICATION', usedAt: null },
        }),
      );
      const [{ code }] = sender.send.mock.calls[0] as [{ code: string }];
      expect(code).toMatch(/^\d{6}$/);
      expect(hashing.hash).toHaveBeenCalledWith(code);
      expect(JSON.stringify(prisma.otpCode.create.mock.calls)).not.toContain(
        code,
      );
    });

    it('does nothing inside the cooldown', async () => {
      prisma.otpCode.findFirst.mockResolvedValue({ createdAt: new Date() });
      await service.issue(user, 'EMAIL_VERIFICATION');
      expect(prisma.otpCode.create).not.toHaveBeenCalled();
      expect(sender.send).not.toHaveBeenCalled();
    });

    it('does not throw when delivery fails, so the response stays the same', async () => {
      prisma.otpCode.findFirst.mockResolvedValue(null);
      sender.send.mockRejectedValue(new Error('Resend responded with 500'));
      await expect(
        service.issue(user, 'PASSWORD_RESET'),
      ).resolves.toBeUndefined();
    });
  });
});
```

```ts
// src/config/env.schema.spec.ts
import { ConfigService } from '@nestjs/config';
import { baseEnvSchema } from '../common/config/base-env.schema';
import { ConsoleOtpSender } from '../common/mail/console-otp-sender';
import { projectEnvSchema } from './env.schema';

// Same schema AppConfigModule.forProject(projectEnvSchema) validates at boot.
const schema = baseEnvSchema.concat(projectEnvSchema);
const valid = {
  DATABASE_URL: 'postgresql://localhost/db',
  JWT_SECRET: 'x'.repeat(32),
  RESEND_API_KEY: 're_123',
  MAIL_FROM: 'App <no-reply@example.com>',
};

describe('env schema', () => {
  it('accepts a complete environment', () => {
    expect(schema.validate(valid).error).toBeUndefined();
  });

  it.each(['JWT_SECRET', 'RESEND_API_KEY', 'MAIL_FROM'])(
    'fails boot without %s while the feature is on',
    (key) => {
      const env: Record<string, string> = { ...valid };
      delete env[key];
      expect(schema.validate(env).error?.message).toContain(key);
    },
  );

  it('rejects a short JWT_SECRET', () => {
    expect(
      schema.validate({ ...valid, JWT_SECRET: 'secret' }).error,
    ).toBeDefined();
  });
});

describe('ConsoleOtpSender', () => {
  const config = (nodeEnv: string) =>
    ({ getOrThrow: () => nodeEnv }) as unknown as ConfigService;

  it('refuses to start in production', () => {
    expect(() => new ConsoleOtpSender(config('production'))).toThrow(
      'OTP_SENDER=console is not allowed in production',
    );
  });

  it('starts in development', () => {
    expect(() => new ConsoleOtpSender(config('development'))).not.toThrow();
  });
});
```

Guard and hashing specs (only when you change those nest-common files):

```ts
// src/common/guards/roles.guard.spec.ts
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser, RoleName } from '../types/auth-user';
import { RolesGuard } from './roles.guard';

function contextFor(user: AuthUser | undefined): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard.canActivate', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);
  const staff: AuthUser = { id: 'u1', email: 'a@x.com', role: 'USER' };
  const requireRoles = (roles: RoleName[] | undefined) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);

  it('allows any request when the route has no @Roles', () => {
    requireRoles(undefined);
    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });

  it('throws 401 when roles are required but no user is attached', () => {
    requireRoles(['ADMIN']);
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws 403 when the user has another role', () => {
    requireRoles(['ADMIN']);
    expect(() => guard.canActivate(contextFor(staff))).toThrow(
      ForbiddenException,
    );
  });

  it('allows a user whose role is listed', () => {
    requireRoles(['ADMIN', 'USER']);
    expect(guard.canActivate(contextFor(staff))).toBe(true);
  });
});
```

```ts
// src/common/hashing/hashing.service.spec.ts
import { HashingService } from './hashing.service';

describe('HashingService', () => {
  const hashing = new HashingService();

  it('verifies the original text and rejects another one', async () => {
    const stored = await hashing.hash('correct horse');
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    await expect(hashing.verify('correct horse', stored)).resolves.toBe(true);
    await expect(hashing.verify('wrong horse', stored)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashing.hash('same')).not.toBe(await hashing.hash('same'));
  });

  it.each([
    ['no separator', 'abc'],
    ['empty salt', ':abcd'],
    ['short key', 'aa:bb'],
    [
      'bcrypt hash',
      '$2b$10$abcdefghijklmnopqrstuuJ1oY5i3H3uC1T3q0nqQf0n1g8b1Ue',
    ],
  ])(
    'returns false (does not throw) for a malformed hash: %s',
    async (_c, bad) => {
      await expect(hashing.verify('x', bad)).resolves.toBe(false);
    },
  );
});
```

## e2e on a real database

`createApp` repeats the `main.ts` wiring; keep the two in sync. The captured sender replaces the mail adapter.

```ts
// test/utils/create-app.ts
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { PrismaExceptionFilter } from '../../src/common/filters/prisma-exception.filter';
import { LoggerInterceptor } from '../../src/common/interceptors/logger.interceptor';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { OTP_SENDER, OtpMessage } from '../../src/common/mail/otp-sender';
import { createValidationPipe } from '../../src/common/pipes/validation.pipe.config';

/** Codes the app tried to send, newest last. Replaces the real mail adapter. */
export class CapturingOtpSender {
  readonly sent: OtpMessage[] = [];
  send(message: OtpMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
  lastCodeFor(to: string): string {
    const hit = [...this.sent].reverse().find((m) => m.to === to);
    if (!hit) throw new Error(`no code sent to ${to}`);
    return hit.code;
  }
}

/**
 * Boots AppModule with the same wiring as main.ts. Keep the two in sync:
 * a test app without the filters or the prefix proves nothing about production.
 */
export async function createApp(
  customize: (b: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
  // Extra main.ts wiring of optional features (cookie parser, WebSocket adapter).
  beforeInit: (app: NestExpressApplication) => void = () => undefined,
) {
  const otp = new CapturingOtpSender();
  const moduleRef = await customize(
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue(otp),
  ).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  const config = app.get(ConfigService);
  app.set('trust proxy', config.getOrThrow<number>('TRUST_PROXY_HOPS'));
  app.setGlobalPrefix('api');
  const allowedOrigins = config
    .getOrThrow<string>('FRONTEND_URL')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: allowedOrigins });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(
    new LoggerInterceptor(),
    new TransformInterceptor(),
  );
  app.useGlobalFilters(
    new GlobalExceptionFilter(),
    new PrismaExceptionFilter(),
  );
  beforeInit(app);
  await app.init();
  return { app, moduleRef, otp };
}
```

```ts
// test/auth.e2e-spec.ts
import { Controller, INestApplication, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { OtpService } from '../src/auth/otp/otp.service';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter';
import { HashingService } from '../src/common/hashing/hashing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingOtpSender, createApp } from './utils/create-app';

let ipCounter = 0;
/** A fresh client IP per test, so the strict auth limits of one test do not hit the next. */
const nextIp = () => `203.0.113.${++ipCounter}`;
const uniqueEmail = () =>
  `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

describe('Auth (e2e, real database)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let otp: CapturingOtpSender;
  let http: App;

  beforeAll(async () => {
    ({ app, otp } = await createApp());
    // The tests play the role of one proxy that sets X-Forwarded-For.
    app.set('trust proxy', 1);
    prisma = app.get(PrismaService);
    http = app.getHttpServer();
  });
  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { endsWith: '@example.com' } },
    });
    await app.close();
  });

  /** register -> code from the captured sender -> verify; returns the token. */
  async function registerVerified(
    email = uniqueEmail(),
    password = 'correct horse',
  ) {
    const ip = nextIp();
    await request(http)
      .post('/api/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ email, password })
      .expect(201);
    const res = await request(http)
      .post('/api/auth/verify-otp')
      .set('X-Forwarded-For', ip)
      .send({ email, code: otp.lastCodeFor(email) })
      .expect(200);
    return {
      email,
      password,
      token: (res.body as { data: { accessToken: string } }).data.accessToken,
    };
  }

  const me = (token: string) =>
    request(http).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  const login = (email: string, password: string, ip = nextIp()) =>
    request(http)
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email, password });

  it('login returns data.accessToken in the body and no token in a header or URL', async () => {
    const { email, password } = await registerVerified();
    const res = await login(email, password).expect(200);
    const body = res.body as { message: string; data: { accessToken: string } };
    expect(body.message).toBe('Login successful');
    expect(typeof body.data.accessToken).toBe('string');
    expect(res.headers.location).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
    await me(body.data.accessToken).expect(200);
  });

  it('answers an unknown email and a wrong password identically', async () => {
    const { email } = await registerVerified();
    const strip = (b: Record<string, unknown>) => ({
      ...b,
      timestamp: undefined,
    });
    const unknown = await login('nobody@example.com', 'whatever1');
    const wrong = await login(email, 'whatever1');
    expect(unknown.status).toBe(401);
    expect(strip(unknown.body as Record<string, unknown>)).toEqual(
      strip(wrong.body as Record<string, unknown>),
    );
  });

  it('answers forgot-password the same for a known and an unknown email', async () => {
    const { email } = await registerVerified();
    const ip = nextIp();
    const a = await request(http)
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', ip)
      .send({ email });
    const b = await request(http)
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', ip)
      .send({ email: 'nobody@example.com' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((a.body as { message: string }).message).toBe(
      (b.body as { message: string }).message,
    );
  });

  it('rejects the old token after a password reset (tokenVersion)', async () => {
    const { email, token } = await registerVerified();
    await me(token).expect(200);
    const ip = nextIp();
    await request(http)
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', ip)
      .send({ email })
      .expect(200);
    await request(http)
      .post('/api/auth/reset-password')
      .set('X-Forwarded-For', ip)
      .send({
        email,
        code: otp.lastCodeFor(email),
        newPassword: 'brand new pass',
      })
      .expect(200);
    await me(token).expect(401);
    await login(email, 'brand new pass').expect(200);
  });

  it('change-password keeps this device (new token) and logs out the others', async () => {
    const { email, password, token: other } = await registerVerified();
    const res = await request(http)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${other}`)
      .send({ currentPassword: password, newPassword: 'another pass 1' })
      .expect(200);
    await me(other).expect(401);
    await me(
      (res.body as { data: { accessToken: string } }).data.accessToken,
    ).expect(200);
    await login(email, 'another pass 1').expect(200);
  });

  it('logout-all ends every token of the user', async () => {
    const { token } = await registerVerified();
    await request(http)
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await me(token).expect(401);
  });

  it('a disabled user is rejected at once, and a role change applies on the next request', async () => {
    const { email, token } = await registerVerified();
    await request(http)
      .get('/api/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    await request(http)
      .get('/api/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await prisma.user.update({ where: { email }, data: { isActive: false } });
    await me(token).expect(401);
  });

  it('rejects a malformed :id with 400 before any query', async () => {
    const { email, token } = await registerVerified();
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    const res = await request(http)
      .get('/api/users/not-a-uuid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect((res.body as { message: string }).message).toBe(
      'Validation failed (uuid is expected)',
    );
  });

  it('register never replaces the password of an existing unverified account', async () => {
    const email = uniqueEmail();
    const ip = nextIp();
    await request(http)
      .post('/api/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ email, password: 'victim pass 1' })
      .expect(201);
    const before = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { passwordHash: true },
    });
    await request(http)
      .post('/api/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ email, password: 'attacker pass' })
      .expect(409);
    const after = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { passwordHash: true },
    });
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it('rejects an inline-typed or extra body field (whitelist + DTO)', async () => {
    const email = uniqueEmail();
    const res = await request(http)
      .post('/api/auth/register')
      .set('X-Forwarded-For', nextIp())
      .send({ email, password: 'correct horse', role: 'ADMIN' })
      .expect(400);
    expect((res.body as { message: string[] }).message).toEqual([
      'role: property role should not exist',
    ]);
  });

  it('/auth/me never returns passwordHash or tokenVersion', async () => {
    const { token } = await registerVerified();
    const res = await me(token).expect(200);
    const data = (res.body as { data: Record<string, unknown> }).data;
    expect(Object.keys(data).sort()).toEqual([
      'createdAt',
      'email',
      'emailVerifiedAt',
      'id',
      'role',
    ]);
  });

  it('OTP on PostgreSQL: 20 parallel wrong guesses spend exactly MAX attempts; a correct code is consumed once', async () => {
    const { email } = await registerVerified();
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    const service = app.get(OtpService);
    const hashing = app.get(HashingService);
    const make = async (code: string) =>
      prisma.otpCode.create({
        data: {
          userId: user.id,
          purpose: 'PASSWORD_RESET',
          codeHash: await hashing.hash(code),
          expiresAt: new Date(Date.now() + 60_000),
        },
        select: { id: true },
      });

    const wrong = await make('111111');
    const guesses = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        service.consume(user.id, 'PASSWORD_RESET', '000000', () =>
          Promise.resolve(true),
        ),
      ),
    );
    expect(guesses.every((g) => g.status === 'rejected')).toBe(true);
    const row = await prisma.otpCode.findUniqueOrThrow({
      where: { id: wrong.id },
      select: { attempts: true },
    });
    expect(row.attempts).toBe(5);

    await prisma.otpCode.updateMany({
      where: { userId: user.id },
      data: { usedAt: new Date() },
    });
    await make('222222');
    let successes = 0;
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        service.consume(user.id, 'PASSWORD_RESET', '222222', () => {
          successes += 1;
          return Promise.resolve(true);
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(successes).toBe(1);
  });
});

describe('Throttling and trust proxy (e2e)', () => {
  let app: NestExpressApplication;
  afterEach(async () => app.close());

  const attempt = (a: INestApplication, xff?: string) => {
    const r = request(a.getHttpServer() as App).post('/api/auth/login');
    if (xff) r.set('X-Forwarded-For', xff);
    return r.send({ email: 'nobody@example.com', password: 'whatever1' });
  };

  it('answers the 6th login within a minute with 429', async () => {
    ({ app } = await createApp());
    for (let i = 0; i < 5; i++) expect((await attempt(app)).status).toBe(401);
    expect((await attempt(app)).status).toBe(429);
  });

  it('TRUST_PROXY_HOPS=0: a forged X-Forwarded-For does not buy a fresh bucket', async () => {
    ({ app } = await createApp());
    app.set('trust proxy', 0);
    for (let i = 0; i < 5; i++) await attempt(app, `198.51.100.${i}`);
    expect((await attempt(app, '198.51.100.99')).status).toBe(429);
  });

  it('TRUST_PROXY_HOPS=1: one client is limited without locking out another', async () => {
    ({ app } = await createApp());
    app.set('trust proxy', 1);
    for (let i = 0; i < 5; i++) await attempt(app, '198.51.100.7');
    expect((await attempt(app, '198.51.100.7')).status).toBe(429);
    expect((await attempt(app, '198.51.100.8')).status).toBe(401);
  });
});

describe('CORS with an empty FRONTEND_URL (e2e)', () => {
  it('sends no Access-Control-Allow-Origin header', async () => {
    const { app } = await createApp();
    const res = await request(app.getHttpServer())
      .options('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
});

@Controller('test-duplicate')
class DuplicateController {
  constructor(private readonly prisma: PrismaService) {}
  @Post()
  create() {
    return this.prisma.user.create({
      data: { email: DUPLICATE },
      select: { id: true },
    });
  }
}
const DUPLICATE = 'duplicate@example.com';

describe('Exception filter order (e2e)', () => {
  it.each([
    ['Global first, then Prisma (main.ts order)', true, 409],
    ['reversed', false, 500],
  ])('P2002 with filters %s -> %i', async (_name, mainTsOrder, expected) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DuplicateController],
      providers: [PrismaService],
    }).compile();
    const app = moduleRef.createNestApplication();
    const filters = [new GlobalExceptionFilter(), new PrismaExceptionFilter()];
    app.useGlobalFilters(...(mainTsOrder ? filters : filters.reverse()));
    await app.init();
    const prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { email: DUPLICATE } });

    await request(app.getHttpServer() as App)
      .post('/test-duplicate')
      .expect(201);
    const res = await request(app.getHttpServer() as App).post(
      '/test-duplicate',
    );
    expect(res.status).toBe(expected);

    await prisma.user.deleteMany({ where: { email: DUPLICATE } });
    await app.close();
  });
});
```
