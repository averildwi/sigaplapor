import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ValidationResult } from 'joi';
import { baseEnvSchema } from '../common/config/base-env.schema.js';
import { projectEnvSchema } from './env.schema.js';
import {
  buildThrottleTierLimits,
  buildThrottleTiers,
  getThrottleTier,
  THROTTLE_TIER_KEY,
  ThrottleTier,
} from './throttle.config.js';

const baseEnv: Record<string, unknown> = {
  DATABASE_URL:
    'postgresql://postgres:postgres@localhost:5432/sigap?schema=public',
  JWT_SECRET: 'unit-test-secret-that-is-at-least-32-chars',
  CLOUDINARY_CLOUD_NAME: 'demo-cloud',
  CLOUDINARY_API_KEY: 'demo-key',
  CLOUDINARY_API_SECRET: 'demo-secret',
};

const configFor = (overrides: Record<string, unknown> = {}): ConfigService => {
  const result = baseEnvSchema.concat(projectEnvSchema).validate(
    { ...baseEnv, ...overrides },
    {
      abortEarly: false,
      allowUnknown: true,
    },
  ) as ValidationResult<Record<string, unknown>>;
  if (result.error) throw result.error;
  return new ConfigService(result.value);
};

class UndecoratedHandler {
  handle(this: void): void {}
}

class AuthHandler {
  @ThrottleTier('auth')
  handle(this: void): void {}
}

class SendCodeHandler {
  @ThrottleTier('sendCode')
  handle(this: void): void {}
}

const contextFor = (target: object, handler: unknown): ExecutionContext =>
  ({
    getClass: () => target,
    getHandler: () => handler,
  }) as unknown as ExecutionContext;

const undecoratedContext = contextFor(
  UndecoratedHandler,
  UndecoratedHandler.prototype.handle,
);
const authContext = contextFor(AuthHandler, AuthHandler.prototype.handle);
const sendCodeContext = contextFor(
  SendCodeHandler,
  SendCodeHandler.prototype.handle,
);

describe('buildThrottleTierLimits', () => {
  it('returns the default tiers 100, 5 and 3 per minute', () => {
    const limits = buildThrottleTierLimits(configFor());

    expect(limits.default).toEqual({ limit: 100, ttl: 60_000 });
    expect(limits.auth).toEqual({ limit: 5, ttl: 60_000 });
    expect(limits.sendCode).toEqual({ limit: 3, ttl: 60_000 });
  });

  it('reads the tier limits from env overrides (BR-133)', () => {
    const limits = buildThrottleTierLimits(
      configFor({ THROTTLE_AUTH_LIMIT: '7', THROTTLE_SEND_CODE_LIMIT: '2' }),
    );

    expect(limits.auth.limit).toBe(7);
    expect(limits.sendCode.limit).toBe(2);
  });
});

describe('ThrottleTier', () => {
  it('marks a handler with the auth tier metadata', () => {
    expect(
      Reflect.getMetadata(THROTTLE_TIER_KEY, AuthHandler.prototype.handle),
    ).toBe('auth');
    expect(getThrottleTier(authContext)).toBe('auth');
  });

  it('marks a handler with the sendCode tier metadata', () => {
    expect(
      Reflect.getMetadata(THROTTLE_TIER_KEY, SendCodeHandler.prototype.handle),
    ).toBe('sendCode');
    expect(getThrottleTier(sendCodeContext)).toBe('sendCode');
  });

  it('falls back to the default tier for undecorated handlers', () => {
    expect(getThrottleTier(undecoratedContext)).toBe('default');
  });
});

describe('buildThrottleTiers', () => {
  it('configures the three named tiers with their env limits', () => {
    const tiers = buildThrottleTiers(configFor());

    expect(tiers.throttlers).toHaveLength(3);
    const [defaultTier, authTier, sendCodeTier] = tiers.throttlers;
    expect(defaultTier).toEqual({ name: 'default', limit: 100, ttl: 60_000 });
    expect(authTier.name).toBe('auth');
    expect(authTier.limit).toBe(5);
    expect(authTier.ttl).toBe(60_000);
    expect(typeof authTier.skipIf).toBe('function');
    expect(sendCodeTier.name).toBe('sendCode');
    expect(sendCodeTier.limit).toBe(3);
    expect(sendCodeTier.ttl).toBe(60_000);
    expect(typeof sendCodeTier.skipIf).toBe('function');
  });

  it('skips the auth tier for handlers without the auth tier', () => {
    const tiers = buildThrottleTiers(configFor());
    const authTier = tiers.throttlers.find((tier) => tier.name === 'auth');
    if (!authTier?.skipIf) throw new Error('auth tier must carry skipIf');

    expect(authTier.skipIf(undecoratedContext)).toBe(true);
    expect(authTier.skipIf(sendCodeContext)).toBe(true);
    expect(authTier.skipIf(authContext)).toBe(false);
  });

  it('skips the sendCode tier unless the handler carries the sendCode tier', () => {
    const tiers = buildThrottleTiers(configFor());
    const sendCodeTier = tiers.throttlers.find(
      (tier) => tier.name === 'sendCode',
    );
    if (!sendCodeTier?.skipIf)
      throw new Error('sendCode tier must carry skipIf');

    expect(sendCodeTier.skipIf(undecoratedContext)).toBe(true);
    expect(sendCodeTier.skipIf(authContext)).toBe(true);
    expect(sendCodeTier.skipIf(sendCodeContext)).toBe(false);
  });
});
