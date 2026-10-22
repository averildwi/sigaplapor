# Reference implementation (core auth)

Copy these files as they are. They compile against `@averildwi/nest-common` 3.0.0 + `@averildwi/nest-prisma`
(Prisma 7, client in root `generated/prisma`), Nest 11, CommonJS. Verified in a scratch app: `nest build`, ESLint
(the Nest default config), 40 unit tests and 23 e2e tests on PostgreSQL (see `test-recipes.md`).

**Preflight (rule 24):** `src/common/` and `src/prisma/` exist. If not, stop and tell the user to run
`npx @averildwi/nest-prisma` then `npx @averildwi/nest-common` first.

**Install:** `npm i @nestjs/jwt@^11 passport-jwt passport` and `npm i -D @types/passport-jwt`.
`@nestjs/jwt` 12 is ESM-only and breaks Jest in a CommonJS Nest 11 project ("Must use import to load ES Module").

**Pick the parts:** login + me + change-password + logout-all are core. register, verify-otp, resend-otp,
forgot-password, reset-password, `OtpService`, `MailModule` and `OtpCode` are the optional OTP module: drop them
together (and the `emailVerifiedAt` check in `JwtStrategy`, or set `emailVerifiedAt` when creating users).

## Files

```text
prisma/schema.prisma                       User, Role, OtpCode, OtpPurpose
src/common/types/auth-user.ts              interim patch (rule 24)
src/common/mail/{otp-sender,resend-otp-sender,console-otp-sender,mail.module}.ts
src/config/env.schema.ts                   projectEnvSchema (rule 25)
src/auth/auth.module.ts
src/auth/auth.controller.ts
src/auth/auth.service.ts
src/auth/strategies/jwt.strategy.ts
src/auth/otp/otp.service.ts
src/auth/decorators/auth-fields.decorator.ts
src/auth/dto/{login,register,change-password,request-code,verify-otp,reset-password}.dto.ts
src/users/users.{service,controller}.ts    deactivate = isActive false + tokenVersion +1
```

`app.module.ts` imports, in this order: `PrismaModule`, `AppConfigModule.forProject(projectEnvSchema)`,
`HashingModule`, `MailModule`, `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])`, `AuthModule`, features;
`providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }]`. Then `npx prisma migrate dev --name add-auth`
**and** `npx prisma generate` (Prisma 7 `migrate dev` does not regenerate the client).

## Schema

ID type is asked first (`nest-prisma`). uuid shown. cuid: `@default(cuid())` without `@db.Uuid`, `ParseCuidPipe`.
autoincrement: `Int @id @default(autoincrement())`, `UserId = number`, sign `sub: String(user.id)`, look up
`Number(payload.sub)`, `ParseIntPipe`.

```prisma
enum Role {
  ADMIN
  USER
}

enum OtpPurpose {
  EMAIL_VERIFICATION
  PASSWORD_RESET
}

model User {
  id              String    @id @default(uuid()) @db.Uuid
  email           String    @unique // stored lowercased + trimmed (the DTO normalizes it)
  passwordHash    String? // null = no password login (for example a Google-only account)
  role            Role      @default(USER)
  isActive        Boolean   @default(true) // false = disabled by an admin
  emailVerifiedAt DateTime? // null = email not verified yet
  tokenVersion    Int       @default(0) // +1 revokes every access token of this user
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  otpCodes        OtpCode[]

  @@map("users")
}

model OtpCode {
  id        String     @id @default(uuid()) @db.Uuid
  userId    String     @db.Uuid
  purpose   OtpPurpose
  codeHash  String
  attempts  Int        @default(0)
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, purpose, createdAt])
  @@map("otp_codes")
}
```

Seeded and admin-created users get `emailVerifiedAt: new Date()` (rule 15 for the seed itself).

## Shared types and config

```ts
// src/common/types/auth-user.ts
import type { Request } from 'express';
import type { Role } from '../../../generated/prisma/client.js';

/** Role names accepted by @Roles(), derived from the Prisma enum so a typo does not compile. */
export type RoleName = Role;

/**
 * Type of the User primary key. Keep `string` for uuid/cuid ids, change it to
 * `number` when the User model uses autoincrement.
 */
export type UserId = string;

/** What JwtStrategy.validate() returns and what @CurrentUser() injects. */
export interface AuthUser {
  id: UserId;
  email: string;
  role: RoleName;
}

/**
 * Claims signed into the access token. Only for sign/verify: request.user is
 * always AuthUser. `sub` is a string even for int ids (JWT convention).
 * `tv` is User.tokenVersion at sign time. No `role`: it is read from the
 * database on every request, so a role change applies immediately.
 */
export interface JwtPayload {
  sub: string;
  email: string;
  tv: number;
}

/** Express request after JwtAuthGuard ran. `user` is absent on public routes. */
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}
```

```ts
// src/config/env.schema.ts
import * as Joi from 'joi';

/** Project env vars, concatenated onto baseEnvSchema by AppConfigModule.forProject(). */
export const projectEnvSchema = Joi.object({
  // 'console' prints codes to stdout for local work; it refuses to start in production.
  OTP_SENDER: Joi.string().valid('resend', 'console').default('resend'),
  RESEND_API_KEY: Joi.when('OTP_SENDER', {
    is: 'resend',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  MAIL_FROM: Joi.when('OTP_SENDER', {
    is: 'resend',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  OTP_TTL_MINUTES: Joi.number().integer().min(1).max(60).default(10),
  OTP_RESEND_COOLDOWN_SECONDS: Joi.number().integer().min(0).default(60),
});
```

`.env.example` gets `OTP_SENDER="resend"`, `RESEND_API_KEY=""`, `MAIL_FROM=""`, `OTP_TTL_MINUTES="10"`,
`OTP_RESEND_COOLDOWN_SECONDS="60"`. Locally, `OTP_SENDER="console"` in `.env`.

## Mail port (rule 23)

```ts
// src/common/mail/otp-sender.ts
import type { OtpPurpose } from '../../../generated/prisma/client';

/** DI token for the port, so specs can swap in a fake. */
export const OTP_SENDER = Symbol('OTP_SENDER');

export interface OtpMessage {
  to: string;
  code: string;
  purpose: OtpPurpose;
  expiresInMinutes: number;
}

/** Port: how a one-time code reaches the user. Implementations never log the code. */
export interface OtpSender {
  send(message: OtpMessage): Promise<void>;
}
```

```ts
// src/common/mail/resend-otp-sender.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpMessage, OtpSender } from './otp-sender';

const SUBJECTS: Record<OtpMessage['purpose'], string> = {
  EMAIL_VERIFICATION: 'Verify your email',
  PASSWORD_RESET: 'Reset your password',
};

/** Sends codes through the Resend HTTP API (no SDK dependency needed). */
@Injectable()
export class ResendOtpSender implements OtpSender {
  constructor(private readonly config: ConfigService) {}

  async send({ to, code, purpose, expiresInMinutes }: OtpMessage) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.getOrThrow<string>('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.getOrThrow<string>('MAIL_FROM'),
        to,
        subject: SUBJECTS[purpose],
        text: `Your code is ${code}. It expires in ${expiresInMinutes} minutes.`,
      }),
    });
    // The error carries the status only: the body could echo the recipient or the code.
    if (!response.ok) {
      throw new Error(`Resend responded with ${response.status}`);
    }
  }
}
```

```ts
// src/common/mail/console-otp-sender.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpMessage, OtpSender } from './otp-sender';

/**
 * Local development only, chosen explicitly with OTP_SENDER=console. It is
 * the one place a code is printed, and it refuses to exist in production so a
 * wrong NODE_ENV default cannot leak codes into production logs.
 */
@Injectable()
export class ConsoleOtpSender implements OtpSender {
  constructor(config: ConfigService) {
    if (config.getOrThrow<string>('NODE_ENV') === 'production') {
      throw new Error('OTP_SENDER=console is not allowed in production');
    }
  }

  send({ to, code, purpose }: OtpMessage): Promise<void> {
    process.stdout.write(`[dev otp] ${purpose} ${to}: ${code}\n`);
    return Promise.resolve();
  }
}
```

```ts
// src/common/mail/mail.module.ts
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleOtpSender } from './console-otp-sender';
import { OTP_SENDER } from './otp-sender';
import { ResendOtpSender } from './resend-otp-sender';

@Global()
@Module({
  providers: [
    {
      provide: OTP_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<string>('OTP_SENDER') === 'console'
          ? new ConsoleOtpSender(config)
          : new ResendOtpSender(config),
    },
  ],
  exports: [OTP_SENDER],
})
export class MailModule {}
```

## Auth module

```ts
// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp/otp.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          // Joi validates it as a string; jsonwebtoken types want ms' StringValue.
          expiresIn: config.getOrThrow<string>(
            'JWT_EXPIRES_IN',
          ) as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpService, JwtStrategy],
  // A WebSocket gateway or refresh endpoint reuses the same signer and checks.
  exports: [JwtModule, JwtStrategy],
})
export class AuthModule {}
```

```ts
// src/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser, JwtPayload } from '../../common/types/auth-user';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // One primary-key lookup per request, on purpose: disabling an account, a
  // role change and tokenVersion +1 apply on the very next request.
  async validate(payload: JwtPayload): Promise<AuthUser> {
    // Tokens signed before `tv` existed are rejected: one re-login, then fine.
    if (typeof payload.tv !== 'number') throw new UnauthorizedException();

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub }, // int ids: Number(payload.sub)
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        emailVerifiedAt: true,
        tokenVersion: true,
      },
    });
    if (
      !user ||
      !user.isActive ||
      !user.emailVerifiedAt ||
      user.tokenVersion !== payload.tv
    ) {
      throw new UnauthorizedException('Session is no longer valid');
    }
    return { id: user.id, email: user.email, role: user.role };
  }
}
```

```ts
// src/auth/decorators/auth-fields.decorator.ts
import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** One password policy for register, reset and change (never copy the numbers). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Emails are compared lowercased and trimmed, so `A@x.com ` and `a@x.com` are one account. */
export function IsAccountEmail(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({ example: 'user@example.com' }),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim().toLowerCase() : value,
    ),
    IsEmail(),
    MaxLength(254),
  );
}

/** A password being set: the policy applies. */
export function IsNewPassword(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({
      example: 'correct horse battery staple',
      minLength: PASSWORD_MIN_LENGTH,
      maxLength: PASSWORD_MAX_LENGTH,
    }),
    IsString(),
    MinLength(PASSWORD_MIN_LENGTH),
    MaxLength(PASSWORD_MAX_LENGTH),
  );
}

/** A password being checked: no minimum, so the policy is not revealed and old passwords still work. */
export function IsCurrentPassword(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({ example: 'correct horse battery staple' }),
    IsString(),
    MaxLength(PASSWORD_MAX_LENGTH),
  );
}

export function IsOtpCode(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({
      example: '123456',
      description: '6-digit code from the email',
    }),
    IsString(),
    Length(6, 6),
    Matches(/^\d{6}$/),
  );
}
```

Each DTO is its own file and only combines these decorators, for example:

```ts
// src/auth/dto/reset-password.dto.ts
import {
  IsAccountEmail,
  IsNewPassword,
  IsOtpCode,
} from '../decorators/auth-fields.decorator';

export class ResetPasswordDto {
  @IsAccountEmail()
  email: string;

  @IsOtpCode()
  code: string;

  @IsNewPassword()
  newPassword: string;
}
```

`LoginDto { @IsAccountEmail() email; @IsCurrentPassword() password }`,
`RegisterDto { @IsAccountEmail() email; @IsNewPassword() password }`,
`ChangePasswordDto { @IsCurrentPassword() currentPassword; @IsNewPassword() newPassword }`,
`RequestCodeDto { @IsAccountEmail() email }` (resend-otp and forgot-password),
`VerifyOtpDto { @IsAccountEmail() email; @IsOtpCode() code }`.

```ts
// src/auth/otp/otp.service.ts
import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose, Prisma } from '../../../generated/prisma/client';
import { HashingService } from '../../common/hashing/hashing.service';
import { OTP_SENDER } from '../../common/mail/otp-sender';
import type { OtpSender } from '../../common/mail/otp-sender';
import { PrismaService } from '../../prisma/prisma.service';

export const MAX_OTP_ATTEMPTS = 5;
/** One message for unknown user, no code, wrong code, expired and exhausted. */
export const INVALID_CODE = 'Code is invalid or expired';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly config: ConfigService,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
  ) {}

  /** Issues and sends a new code. Inside the cooldown it does nothing, silently. */
  async issue(
    user: { id: string; email: string },
    purpose: OtpPurpose,
  ): Promise<void> {
    const cooldownMs =
      this.config.getOrThrow<number>('OTP_RESEND_COOLDOWN_SECONDS') * 1000;
    const last = await this.prisma.otpCode.findFirst({
      where: { userId: user.id, purpose },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    // The caller answers the same either way, so the cooldown reveals nothing.
    if (last && Date.now() - last.createdAt.getTime() < cooldownMs) return;

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const ttlMinutes = this.config.getOrThrow<number>('OTP_TTL_MINUTES');
    const now = new Date();
    const codeHash = await this.hashing.hash(code);
    await this.prisma.$transaction([
      // A new code retires every older unused code of the same purpose.
      this.prisma.otpCode.updateMany({
        where: { userId: user.id, purpose, usedAt: null },
        data: { usedAt: now },
      }),
      this.prisma.otpCode.create({
        data: {
          userId: user.id,
          purpose,
          codeHash,
          expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
        },
        select: { id: true },
      }),
    ]);

    try {
      await this.sender.send({
        to: user.email,
        code,
        purpose,
        expiresInMinutes: ttlMinutes,
      });
    } catch (err) {
      // Not rethrown: an error response here would differ from the one for an
      // unknown email. Logged without the code or the address; the user can resend.
      this.logger.error(
        `OTP delivery failed for user ${user.id} (${purpose}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Verifies a code and runs `onSuccess` in the transaction that consumes it.
   * Order is fixed: claim an attempt atomically, compare, consume once.
   */
  async consume<T>(
    userId: string,
    purpose: OtpPurpose,
    code: string,
    onSuccess: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const now = new Date();
    const otp = await this.prisma.otpCode.findFirst({
      where: { userId, purpose, usedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, codeHash: true },
    });
    if (!otp) throw new BadRequestException(INVALID_CODE);

    const claim = await this.prisma.otpCode.updateMany({
      where: {
        id: otp.id,
        usedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: MAX_OTP_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    });
    if (claim.count === 0) throw new BadRequestException(INVALID_CODE);

    if (!(await this.hashing.verify(code, otp.codeHash))) {
      throw new BadRequestException(INVALID_CODE);
    }

    return this.prisma.$transaction(async (tx) => {
      const consumed = await tx.otpCode.updateMany({
        where: { id: otp.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      // A parallel request with the same code won.
      if (consumed.count === 0) throw new BadRequestException(INVALID_CODE);
      return onSuccess(tx);
    });
  }
}
```

```ts
// src/auth/auth.service.ts
import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '../../generated/prisma/client';
import { HashingService } from '../common/hashing/hashing.service';
import type { JwtPayload } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestCodeDto } from './dto/request-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { INVALID_CODE, OtpService } from './otp/otp.service';

/** Role of self-registered accounts. Privileged accounts come from the seed or an admin. */
export const DEFAULT_ROLE: Role = 'USER';
const INVALID_CREDENTIALS = 'Invalid credentials';

const tokenUserSelect = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  tokenVersion: true,
} satisfies Prisma.UserSelect;

/** What the API may show about a user. Never passwordHash or tokenVersion. */
export const profileSelect = {
  id: true,
  email: true,
  role: true,
  emailVerifiedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AuthService implements OnModuleInit {
  // Unknown emails are checked against this, so they cost the same scrypt run.
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hashing.hash(randomBytes(16).toString('hex'));
  }

  async login({ email, password }: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { ...tokenUserSelect, passwordHash: true, emailVerifiedAt: true },
    });
    const passwordOk = await this.hashing.verify(
      password,
      user?.passwordHash ?? this.dummyHash,
    );
    if (!user?.passwordHash || !passwordOk) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    // Status only after the password: it is revealed to the owner, never to a guesser.
    if (!user.isActive) throw new ForbiddenException('Account is disabled');
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException('Email is not verified');
    }
    return { accessToken: await this.signToken(user) };
  }

  async register({ email, password }: RegisterDto): Promise<void> {
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    // Conscious exception to rule 12 (UX), throttled. Never update the existing
    // row: that would let anyone replace the password of an unverified account.
    if (existing) throw new ConflictException('Email is already registered');

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await this.hashing.hash(password),
        role: DEFAULT_ROLE,
      },
      select: { id: true, email: true },
    });
    await this.otp.issue(user, 'EMAIL_VERIFICATION');
  }

  async verifyEmail({
    email,
    code,
  }: VerifyOtpDto): Promise<{ accessToken: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) throw new BadRequestException(INVALID_CODE);

    const verified = await this.otp.consume(
      user.id,
      'EMAIL_VERIFICATION',
      code,
      (tx) =>
        tx.user.update({
          where: { id: user.id },
          data: { emailVerifiedAt: new Date() },
          select: tokenUserSelect,
        }),
    );
    // Auto-login only for self-registered accounts.
    if (verified.role !== DEFAULT_ROLE || !verified.isActive) return null;
    return { accessToken: await this.signToken(verified) };
  }

  async resendVerification({ email }: RequestCodeDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, emailVerifiedAt: true },
    });
    if (user && !user.emailVerifiedAt) {
      await this.otp.issue(user, 'EMAIL_VERIFICATION');
    }
  }

  async forgotPassword({ email }: RequestCodeDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, isActive: true },
    });
    if (user?.isActive) await this.otp.issue(user, 'PASSWORD_RESET');
  }

  async resetPassword({
    email,
    code,
    newPassword,
  }: ResetPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true },
    });
    if (!user) throw new BadRequestException(INVALID_CODE);

    const passwordHash = await this.hashing.hash(newPassword);
    await this.otp.consume(user.id, 'PASSWORD_RESET', code, (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          // Ends every session, including one an attacker may hold.
          tokenVersion: { increment: 1 },
          // The code proves the inbox, so the email counts as verified.
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
        select: { id: true },
      }),
    );
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    const currentOk = await this.hashing.verify(
      dto.currentPassword,
      user?.passwordHash ?? this.dummyHash,
    );
    // 400, not 401: the session is valid, only the field is wrong.
    if (!user?.passwordHash || !currentOk) {
      throw new BadRequestException('Current password is incorrect');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await this.hashing.hash(dto.newPassword),
        tokenVersion: { increment: 1 },
      },
      select: tokenUserSelect,
    });
    // Other devices are logged out; this one gets a fresh token.
    return { accessToken: await this.signToken(updated) };
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
      select: { id: true },
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: profileSelect,
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  private signToken(user: {
    id: string;
    email: string;
    tokenVersion: number;
  }): Promise<string> {
    // For an int id: sub: String(user.id).
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tv: user.tokenVersion,
    };
    return this.jwt.signAsync(payload);
  }
}
```

```ts
// src/auth/auth.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MessageResponse } from '../common/interceptors/transform.interceptor';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestCodeDto } from './dto/request-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

// Per handler, not per class, so GET me keeps the global limit.
const STRICT = { default: { limit: 5, ttl: 60_000 } };
const SEND_CODE = { default: { limit: 3, ttl: 60_000 } };
const CODE_SENT = 'If the account can receive a code, it has been sent';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  @ApiOperation({ summary: '[PUBLIC] Log in with email and password' })
  async login(@Body() dto: LoginDto) {
    return new MessageResponse(
      await this.authService.login(dto),
      'Login successful',
    );
  }

  @Post('register')
  @Throttle(STRICT)
  @ApiOperation({ summary: '[PUBLIC] Register and send a verification code' })
  async register(@Body() dto: RegisterDto) {
    await this.authService.register(dto);
    return new MessageResponse(
      null,
      'Registered, check your email for the code',
    );
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  @ApiOperation({ summary: '[PUBLIC] Verify the email with a code' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return new MessageResponse(
      await this.authService.verifyEmail(dto),
      'Email verified',
    );
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle(SEND_CODE)
  @ApiOperation({ summary: '[PUBLIC] Send a new verification code' })
  async resendOtp(@Body() dto: RequestCodeDto) {
    await this.authService.resendVerification(dto);
    return new MessageResponse(null, CODE_SENT);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  @ApiOperation({ summary: '[PUBLIC] Send a password reset code' })
  async forgotPassword(@Body() dto: RequestCodeDto) {
    await this.authService.forgotPassword(dto);
    return new MessageResponse(null, CODE_SENT);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  @ApiOperation({ summary: '[PUBLIC] Reset the password with a code' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return new MessageResponse(null, 'Password reset, please log in');
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '[AUTH] Get my profile' })
  me(@CurrentUser('id') userId: string) {
    return this.authService.me(userId);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '[AUTH] Change my password, end other sessions' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return new MessageResponse(
      await this.authService.changePassword(userId, dto),
      'Password changed',
    );
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '[AUTH] Log out on every device' })
  async logoutAll(@CurrentUser('id') userId: string) {
    await this.authService.logoutAll(userId);
    return new MessageResponse(null, 'Logged out on every device');
  }
}
```

## Disabling a user (admin side)

```ts
// src/users/users.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { profileSelect } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { ...profileSelect, isActive: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async deactivate(id: string) {
    await this.findOne(id);
    return this.prisma.user.update({
      where: { id },
      // tokenVersion +1 as well, so the decision does not depend on one flag check.
      data: { isActive: false, tokenVersion: { increment: 1 } },
      select: { ...profileSelect, isActive: true },
    });
  }
}
```

```ts
// src/users/users.controller.ts
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MessageResponse } from '../common/interceptors/transform.interceptor';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: '[ADMIN] Get a user' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiOperation({ summary: '[ADMIN] Deactivate a user and end their sessions' })
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return new MessageResponse(
      await this.usersService.deactivate(id),
      'User deactivated',
    );
  }
}
```
