# Recipe: Google login with an ID token (optional, UNTESTED)

**UNTESTED:** this code compiles and passes lint, but it has not run against Google in any project yet.
The first project that uses it must test the flow with a real client ID and report back.

Flow: the frontend uses Google Identity Services, gets an ID token (`credential`), and sends it to
`POST /api/auth/google`. The backend verifies it and returns `{ accessToken }` in the body (rule 1). No redirect,
no token in a URL, no session cookie.

```text
browser --(Google popup)--> credential (ID token)
browser --POST /api/auth/google { idToken }--> backend --verifyIdToken(aud = GOOGLE_CLIENT_ID)--> Google keys
backend --> { accessToken }
```

- `npm i google-auth-library`. Env: `GOOGLE_CLIENT_ID: Joi.string().required()` in `projectEnvSchema` (rule 25, no fallback).
- `passwordHash` is already nullable (rule 22); a Google-only user has `passwordHash: null` and password login answers
  `'Invalid credentials'`.

## Schema (add only with this recipe)

```prisma
model UserIdentity {
  id              String   @id @default(uuid()) @db.Uuid
  userId          String   @db.Uuid
  provider        String // 'google'
  providerSubject String // the provider's stable `sub`, never the email
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerSubject])
  @@index([userId])
  @@map("user_identities")
}
```

Add `identities UserIdentity[]` to `User`.

## Code

```ts
// src/recipes/google-auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { DEFAULT_ROLE } from '../auth/auth.service';
import type { JwtPayload } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';

const PROVIDER = 'google';
const GOOGLE_FAILED = 'Google sign-in failed';

/** UNTESTED recipe: POST /auth/google with { idToken } from Google Identity Services. */
@Injectable()
export class GoogleAuthService {
  private readonly client = new OAuth2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(idToken: string): Promise<{ accessToken: string }> {
    // Checks the signature against Google's keys, `exp`, `iss`, and `aud`.
    const ticket = await this.client
      .verifyIdToken({
        idToken,
        audience: this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      })
      .catch(() => {
        throw new UnauthorizedException(GOOGLE_FAILED);
      });
    const claims = ticket.getPayload();
    // Without a verified email the address proves nothing about who signed in.
    if (!claims?.sub || !claims.email || claims.email_verified !== true) {
      throw new UnauthorizedException(GOOGLE_FAILED);
    }
    const email = claims.email.trim().toLowerCase();

    const user = await this.prisma.$transaction(async (tx) => {
      const identity = await tx.userIdentity.findUnique({
        where: {
          provider_providerSubject: {
            provider: PROVIDER,
            providerSubject: claims.sub,
          },
        },
        select: { userId: true },
      });
      const select = {
        id: true,
        email: true,
        isActive: true,
        tokenVersion: true,
        emailVerifiedAt: true,
      };
      if (identity) {
        return tx.user.findUniqueOrThrow({
          where: { id: identity.userId },
          select,
        });
      }

      const local = await tx.user.findUnique({ where: { email }, select });
      if (local) {
        // An unverified local account may belong to someone who typed the
        // victim's email and a password of their own. Never link it.
        if (!local.emailVerifiedAt)
          throw new UnauthorizedException(GOOGLE_FAILED);
        await tx.userIdentity.create({
          data: {
            userId: local.id,
            provider: PROVIDER,
            providerSubject: claims.sub,
          },
          select: { id: true },
        });
        return local;
      }

      return tx.user.create({
        data: {
          email,
          passwordHash: null,
          role: DEFAULT_ROLE,
          emailVerifiedAt: new Date(),
          identities: {
            create: { provider: PROVIDER, providerSubject: claims.sub },
          },
        },
        select,
      });
    });

    if (!user.isActive) throw new UnauthorizedException(GOOGLE_FAILED);
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tv: user.tokenVersion,
    };
    return { accessToken: await this.jwt.signAsync(payload) };
  }
}
```

```ts
// src/recipes/google-auth.controller.ts
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsJWT } from 'class-validator';
import { MessageResponse } from '../common/interceptors/transform.interceptor';
import { GoogleAuthService } from './google-auth.service';

export class GoogleLoginDto {
  @ApiProperty({
    description: 'ID token (credential) from Google Identity Services',
  })
  @IsJWT()
  idToken: string;
}

@ApiTags('Auth')
@Controller('auth')
export class GoogleAuthController {
  constructor(private readonly google: GoogleAuthService) {}

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: '[PUBLIC] Log in with a Google ID token' })
  async login(@Body() dto: GoogleLoginDto) {
    return new MessageResponse(
      await this.google.login(dto.idToken),
      'Login successful',
    );
  }
}
```

## Linking rules (why the code looks like this)

1. Identity is `provider + sub`, never the email: emails change hands, `sub` does not.
2. `email_verified` must be `true`; otherwise Google only says "someone typed this address".
3. Link to an existing local account only when that account is **also** verified. CateringKita linked an unverified
   account: an attacker registers `victim@x.com` with their own password, the victim later signs in with Google, the
   account becomes verified and the attacker's password still works (pre-account takeover).
4. New Google users get `DEFAULT_ROLE` and `emailVerifiedAt: now`, like self-registration.

If the project must use the redirect flow (`passport-google-oauth20`) instead: generate and check `state`, never put the
token in the redirect URL, and finish with a `POST` that returns `{ accessToken }` in the body (webportfolio pattern:
short-lived httpOnly cookie + `POST /auth/oauth/token`). Label the callback `[PUBLIC]` with a `description` naming
`AuthGuard('google')`.

## Bad example

```ts
const user = await this.prisma.user.findUnique({ where: { email: profile.email } }); // BAD: link by email, no email_verified
res.redirect(`${frontendUrl}/callback?token=${token}`);                                // BAD: token in URL (logs, history, Referer)
audience: this.config.get('GOOGLE_CLIENT_ID') ?? 'not-configured',                     // BAD: fallback secret/config
```

## Checklist

- [ ] `verifyIdToken` with `audience` = `GOOGLE_CLIENT_ID` (checks signature, `exp`, `iss`, `aud`).
- [ ] `email_verified === true` required.
- [ ] Lookup by `provider + sub`; link only to a verified local account.
- [ ] `{ accessToken }` in the body, never in a URL; `@Throttle` 30/60s.
- [ ] Marked UNTESTED until a project ran it against Google.
