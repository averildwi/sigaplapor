import { ExecutionContext, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ThrottlerOptions } from '@nestjs/throttler';

export type ThrottleTierName = 'default' | 'auth' | 'sendCode';

export const THROTTLE_TIER_KEY = 'throttle_tier';

export const THROTTLE_TIER_TTL_MS = 60_000;

export interface ThrottleTierLimit {
  limit: number;
  ttl: number;
}

const tierReflector = new Reflector();

// Handler-level metadata only: stricter limits never go on a class, so
// unmarked handlers (GET /auth/me) keep the global tier.
export const ThrottleTier = (tier: ThrottleTierName) =>
  SetMetadata(THROTTLE_TIER_KEY, tier);

export function getThrottleTier(context: ExecutionContext): ThrottleTierName {
  return (
    tierReflector.getAllAndOverride<ThrottleTierName>(THROTTLE_TIER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? 'default'
  );
}

export function buildThrottleTierLimits(
  config: ConfigService,
): Record<ThrottleTierName, ThrottleTierLimit> {
  return {
    default: {
      limit: config.getOrThrow<number>('THROTTLE_DEFAULT_LIMIT'),
      ttl: THROTTLE_TIER_TTL_MS,
    },
    auth: {
      limit: config.getOrThrow<number>('THROTTLE_AUTH_LIMIT'),
      ttl: THROTTLE_TIER_TTL_MS,
    },
    sendCode: {
      limit: config.getOrThrow<number>('THROTTLE_SEND_CODE_LIMIT'),
      ttl: THROTTLE_TIER_TTL_MS,
    },
  };
}

// A tiered throttler must skip every request that does not carry its tier
// metadata, otherwise its limit would apply globally. The global tier has no
// skipIf: it counts every request, and tiered endpoints are additionally
// counted in their own bucket.
export type ThrottlerTiers = { throttlers: ThrottlerOptions[] };

export function buildThrottleTiers(config: ConfigService): ThrottlerTiers {
  const limits = buildThrottleTierLimits(config);

  return {
    throttlers: [
      { name: 'default', limit: limits.default.limit, ttl: limits.default.ttl },
      {
        name: 'auth',
        limit: limits.auth.limit,
        ttl: limits.auth.ttl,
        skipIf: (context) => getThrottleTier(context) !== 'auth',
      },
      {
        name: 'sendCode',
        limit: limits.sendCode.limit,
        ttl: limits.sendCode.ttl,
        skipIf: (context) => getThrottleTier(context) !== 'sendCode',
      },
    ],
  };
}
