# Recipe: refresh token rotation (optional)

Use it only when the user asks for short access tokens + refresh, or "log out this device" on the server.
The core already revokes through `tokenVersion` (rule 2). Reference project: webportfolio (`refresh-token.service.ts`).
Verified in the scratch app on PostgreSQL: rotation, replay -> family revoked, parallel refresh, cookie flags.

## How it fits

```text
login          -> { accessToken } in body (rule 1) + Set-Cookie refresh_token (httpOnly, path=/api/auth)
POST /auth/refresh (cookie) -> claim token once -> new access token in body + new refresh cookie
reuse of a used token       -> whole family revoked, 401
password reset/change, logout-all -> tokenVersion +1 AND revokeAllForUser(userId)
```

- Set `JWT_EXPIRES_IN=15m` in `.env` (the nest-common default stays `7d`).
- `npm i cookie-parser` + `npm i -D @types/cookie-parser`; `app.use(cookieParser())` in `main.ts` after `setGlobalPrefix`.
- CORS needs `credentials: true` when the frontend is on another origin, and `FRONTEND_URL` must not be empty.
- Env: `REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).default(7)` in `projectEnvSchema`.

## Schema

```prisma
model RefreshToken {
  id        String    @id @default(uuid()) @db.Uuid
  userId    String    @db.Uuid
  familyId  String    @db.Uuid // one login = one family; reuse revokes the family
  tokenHash String    @unique // SHA-256 of the token, never the token
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([familyId])
  @@index([expiresAt])
  @@map("refresh_tokens")
}
```

Add `refreshTokens RefreshToken[]` to `User`.

## Code

The refresh token is opaque random bytes, not a JWT. That removes the `jti` trap webportfolio hit: two JWTs with the
same payload signed in the same second are byte-identical and collide on `tokenHash @unique` (P2002 -> 409). If you
must use a JWT refresh token, add `jti: randomUUID()`.

```ts
// src/recipes/refresh-token.service.ts
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const sha256 = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/**
 * Opaque refresh tokens with one-time rotation and reuse detection.
 * The client never sees the hash; the database never sees the token.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** New token. Random bytes, so two tokens issued in the same second never collide. */
  async issue(userId: string, familyId: string = randomUUID()) {
    const token = randomBytes(32).toString('base64url');
    const ttlDays = this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_DAYS');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
      },
      select: { id: true },
    });
    return token;
  }

  /** Claims the token once; the caller then issues a new access + refresh token. */
  async rotate(token: string): Promise<{ userId: string; token: string }> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(token) },
      select: { id: true, userId: true, familyId: true, expiresAt: true },
    });
    if (!row || row.expiresAt <= new Date()) {
      throw new UnauthorizedException('Session expired, please log in');
    }
    const claim = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claim.count === 0) {
      // Already used: either stolen and replayed, or two tabs raced. Both end the family.
      this.logger.warn(`Refresh token reuse for user ${row.userId}`);
      await this.revokeFamily(row.familyId);
      throw new UnauthorizedException('Session expired, please log in');
    }
    return {
      userId: row.userId,
      token: await this.issue(row.userId, row.familyId),
    };
  }

  /** Logout of this device. Unknown tokens are ignored, so logout is idempotent. */
  async revokeByToken(token: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(token) },
      select: { familyId: true },
    });
    if (row) await this.revokeFamily(row.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Password reset / change / logout-all call this next to tokenVersion +1. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Run from a scheduled job; rows past expiry are useless. */
  async purgeExpired(): Promise<number> {
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return count;
  }
}
```

```ts
// src/recipes/refresh.controller.ts
import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { MessageResponse } from '../common/interceptors/transform.interceptor';
import type { JwtPayload } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';

export const REFRESH_COOKIE = 'refresh_token';

@ApiTags('Auth')
@Controller('auth')
export class RefreshController {
  constructor(
    private readonly refreshTokens: RefreshTokenService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: '[PUBLIC] Rotate the refresh cookie and get a new access token',
    description:
      'Authenticated by the httpOnly refresh_token cookie, not by JWT.',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = req.cookies as Record<string, string | undefined>;
    const presented = cookies[REFRESH_COOKIE];
    if (!presented)
      throw new UnauthorizedException('Session expired, please log in');

    const { userId, token } = await this.refreshTokens.rotate(presented);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, isActive: true, tokenVersion: true },
    });
    if (!user?.isActive) {
      await this.refreshTokens.revokeAllForUser(userId);
      throw new UnauthorizedException('Session expired, please log in');
    }
    this.setCookie(res, token);
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tv: user.tokenVersion,
    };
    return new MessageResponse(
      { accessToken: await this.jwt.signAsync(payload) },
      'Token refreshed',
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[PUBLIC] Log out this device',
    description: 'Identified by the httpOnly refresh_token cookie, not by JWT.',
  })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookies = req.cookies as Record<string, string | undefined>;
    const presented = cookies[REFRESH_COOKIE];
    if (presented) await this.refreshTokens.revokeByToken(presented);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return new MessageResponse(null, 'Logged out');
  }

  /** Login calls this too, right after it signs the access token. */
  setCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.getOrThrow<string>('NODE_ENV') === 'production',
      sameSite: 'lax',
      // Sent only to /api/auth/*, never to every API call.
      path: '/api/auth',
      maxAge:
        this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_DAYS') * 86_400_000,
    });
  }
}
```

Login: after `authService.login(dto)`, call `refreshTokens.issue(user.id)` and `setCookie(res, token)` with
`@Res({ passthrough: true })`. The access token stays in the body.

Cleanup: call `purgeExpired()` from a scheduled job (`@nestjs/schedule` `@Cron('0 */6 * * *')`, or `setInterval(...).unref()`
in `onModuleInit` as webportfolio does).

## Known trade-off: two tabs

Two tabs that refresh at the same moment send the same token; one wins, the other looks like a replay and the
family is revoked, so both tabs are logged out (verified). Accept it, or let the frontend refresh through one shared
promise (a single in-flight refresh per browser). Never "fix" it by allowing a used token again.

## Bad example

```ts
await this.prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } }); // BAD: no count check, replay passes
data: { token: refreshToken }                         // BAD: plaintext token in the database
res.cookie('refresh_token', token, { path: '/' });    // BAD: sent with every API call
this.jwt.sign({ sub, type: 'refresh' });              // BAD: identical tokens within one second (no jti)
```

## Checklist

- [ ] Token stored as SHA-256 only; claimed with `updateMany` + `count`; reuse revokes the family.
- [ ] Cookie `httpOnly`, `secure` in production, `sameSite: 'lax'`, `path: '/api/auth'`.
- [ ] `refresh` and `logout` are `[PUBLIC]` with a `description` naming the cookie (meta-test checks it).
- [ ] Reset/change password and logout-all also call `revokeAllForUser`.
- [ ] Expired rows are purged by a job.
