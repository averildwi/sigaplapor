---
name: nest-auth-and-security
description: Use when a NestJS change touches who may call what or how users sign in - adding any controller or endpoint (every route needs a guard or a [PUBLIC] label), roles, the current user, login/register/password reset/change/OTP/email verification, JWT or sessions, hashing, throttling, CORS, trust proxy, :id route params, or a WebSocket/upload that needs the user.
---

## When to use

- Adding a controller or handler (guard + label), protecting a route, adding or changing a role, reading the current user.
- Login, register, verify email, forgot/reset/change password, logout, OTP, Google login, refresh tokens.
- Touching `main.ts` CORS, `trust proxy`, the throttler, any `:id` param, or a WebSocket gateway.
- Writing auth tests: `references/test-recipes.md`.

The full, compiled reference code is in `references/reference-implementation.md`. Copy it instead of writing auth from memory.
Optional recipes: `references/refresh-tokens.md`, `references/google-id-token.md` (UNTESTED), `references/websocket-auth.md`,
`references/hash-migration.md`, `references/per-resource-roles.md`.

## Rules

1. Use JWT Bearer only: `ExtractJwt.fromAuthHeaderAsBearerToken()`. The payload is `{ sub, email, tv }` (`JwtPayload`, rule 3): `sub` is the user id as a string, `tv` is `User.tokenVersion` (rule 2). Never put `role` in it (rule 5); `jti` only in `references/refresh-tokens.md`. The default expiry is `JWT_EXPIRES_IN=7d` (nest-common). Login returns `{ accessToken }` (never `token`) in the body through `MessageResponse` (never `RawResponse`). A Next.js BFF may move that token into its own httpOnly cookie; the backend still returns it in the body. Never put a token in a URL, query string or redirect: OAuth goes through `references/google-id-token.md`, sockets through `references/websocket-auth.md`.
2. `JwtStrategy.validate()` re-loads the user by primary key with a narrow `select` (`id, email, role, isActive, emailVerifiedAt, tokenVersion`) and throws `UnauthorizedException` when the user is missing, `!isActive`, `emailVerifiedAt` is null (only when the email verification module is used), or `tokenVersion !== payload.tv`. It returns an `AuthUser`. The one query per authenticated request is a conscious trade-off: disabling, role changes and revocation apply on the next request. No cache.
    - `tokenVersion` +1 on password reset, password change, deactivation and logout-all, in the same write as the change. That is the only revocation of access tokens; without the check in `validate()` it does nothing.
    - If "inactive" lives elsewhere too (a `deletedAt`, a `VendorProfile.isActive`), `validate()` checks it as well, or deactivation bumps `tokenVersion`.
    - Existing project adding `tv`: tokens without `tv` are rejected (`typeof payload.tv !== 'number'`); users log in once more.
3. There is one shared `AuthUser` interface (`src/common/types/auth-user.ts`) for `request.user`. Type `@CurrentUser() user: AuthUser` or `@CurrentUser('id') userId: string`. Never type the user inline (`{ id: number }`). `JwtPayload` is only for `sign`/`verify`; `request.user` is never a `JwtPayload`, and `validate()` maps `sub` to `id`. Int ids: `UserId = number`, sign `String(user.id)`, look up `Number(payload.sub)`.
4. Protect a route with `@UseGuards(JwtAuthGuard, RolesGuard)` + `@ApiBearerAuth('access-token')` on the controller or handler. Add `@Roles(...)` where roles matter. Guards are per controller or route; there is no global auth guard and no `@Public()`.
    - Trade-off (written down on purpose): per-route guards **fail open**. A forgotten `@UseGuards` leaves the route public with no error. The brake is the meta-test in `references/test-recipes.md`, **required in every project**: every handler has `JwtAuthGuard` or a `[PUBLIC]` summary, and the prefix matches `@Roles`.
    - Alternative, if the user chooses it: global `JwtAuthGuard` + `RolesGuard` as `APP_GUARD` with a `@Public()` decorator (fail closed). It changes this rule, rule 7 and `nest-architecture` rule 12 (`[PUBLIC]` comes from `@Public()`), needs `RolesGuard` to honour `@Public()` (nest-common change), and the meta-test reads `IS_PUBLIC_KEY`. Do not switch on your own.
    - A route protected by something other than JWT (webhook shared secret, `AuthGuard('google')`, refresh cookie) is `[PUBLIC]`, and its `description` names the mechanism. Compare webhook secrets with `timingSafeEqual`, never `!==`.
5. Roles are a union type derived from the Prisma enum. Default naming: field `role`, enum `Role`, union `type RoleName = Role` (→ `'ADMIN' | 'STAFF'`), and `@Roles(...roles: RoleName[])`. Never `string[]`. Use `globalRole` / `GlobalRole` / `GlobalRoleName` **only** when the project has both an app-wide role and a per-team/per-resource role (the per-resource role then lives on the join model, for example `TeamMember.role`). In an existing project, keep the names it already uses.
    - The role is never in the JWT: it is read from the database on every request (rule 2), and the frontend reads it from `GET /auth/me`.
    - Per-resource access (join model with or without a role column) is checked in the service: `references/per-resource-roles.md`.
    - Multi-role users, permission-based access and several principal tables are out of scope: ask the user first.
6. `RolesGuard`: no `@Roles` → allow. No user → 401 `UnauthorizedException`. Wrong role → 403 `ForbiddenException`. The nest-common 3 `RolesGuard` already does this; do not copy or change it.
7. The Swagger summary prefix is derived from the guards (`nest-architecture` rule 12): `[PUBLIC]`, `[AUTH]`, or exactly the `@Roles` list joined with `/`. Do not label an endpoint `[ADMIN]` and then allow `STAFF`. The meta-test (rule 4) enforces it.
8. Resource ownership checks (only the leader may edit the team) live in the service and throw `ForbiddenException`.
9. Hash passwords **and** OTP codes with `HashingService` (async `scrypt` from `node:crypto`, `salt:hash` format, `timingSafeEqual`). Never use `scryptSync`, bcrypt, or plain text. Always `await` `hash()` and `verify()`: a missing `await` is a truthy Promise, so `if (verify(...))` and `rows.find((r) => verify(...))` let everyone in. Login verifies unknown emails against a dummy hash computed once in `onModuleInit` (async; it cannot be computed in the constructor). Existing project with bcrypt or `scryptSync`: `references/hash-migration.md`.
10. Register `ThrottlerGuard` globally as `APP_GUARD`. Put stricter limits **on the handler, never the class** (so `GET /auth/me` keeps the global limit):

    | Endpoint | `@Throttle({ default: { limit, ttl: 60_000 } })` |
    |---|---|
    | login, register, verify-otp, forgot-password, reset-password, change-password | 5 |
    | resend-otp / any "send me a code" | 3, plus the database cooldown of rule 11 |
    | refresh, OAuth / Google exchange | 30 |
11. OTP: max `MAX_OTP_ATTEMPTS` (5) attempts, expiry (`expiresAt`), single use (`usedAt`), codes from `randomInt` (`node:crypto`). Never use an in-memory `Map` as a rate limiter. Verification order is fixed:
    1. **Claim an attempt atomically first**: `updateMany({ where: { id, usedAt: null, expiresAt: { gt: now }, attempts: { lt: MAX_OTP_ATTEMPTS } }, data: { attempts: { increment: 1 } } })`. `count === 0` → reject, without checking the code.
    2. Only then compare the code.
    3. Consume it with `updateMany({ where: { id, usedAt: null }, data: { usedAt } })` inside the success transaction; `count === 0` → reject (a parallel request won).
    Never read `attempts`, compare in JS, then `update`: parallel requests all pass the stale read. Verified on PostgreSQL: 20 parallel wrong guesses → old pattern checked the code 20 times, atomic claim exactly 5; 5 parallel requests with the right code → exactly one succeeds.
    - Schema `OtpCode { id, userId, purpose, codeHash, attempts, expiresAt, usedAt, createdAt, updatedAt, @@index([userId, purpose, createdAt]) }`. `userId` is a FK: the user row is created first, unverified.
    - `purpose` is required (`EMAIL_VERIFICATION`, `PASSWORD_RESET`) and every lookup filters by it; a code never crosses flows.
    - Issuing a code retires the older unused codes of the same user and purpose (`usedAt = now`); only one code is live.
    - Send cooldown is in the database (the `createdAt` of the last code), and inside it the endpoint answers exactly as if it sent.
    - Only `EMAIL_VERIFICATION` may return a token, and only for the default self-registration role. A reset code never logs anyone in.
    - A code is never logged, returned, or put in an exception (rule 23).
12. Use the same message for "unknown email" and "wrong password" (`'Invalid credentials'`), and for OTP resend whether or not the email exists. Never reveal whether an account exists.
    - Order: verify the password **first**, then the account status (`isActive`, `emailVerifiedAt`). Only the owner learns the status.
    - resend-otp and forgot-password always answer `200` with the same message; cooldown, unknown email and send failure look identical.
    - Rate-limit and cooldown answers are the same for existing and unknown emails.
    - Conscious exception: register may answer `409 'Email is already registered'` (UX), throttled by rule 10.
13. CORS: allow only the origins in `FRONTEND_URL` (comma-separated, each `.trim()`ed, empty entries dropped with `.filter(Boolean)`). If it is empty, allow none (`[]`). Never `'*'`, and never a Joi `default('*')` (old nest-common templates had one: replace it with `allow('').default('')`).
14. Every `:id` param has a pipe matching the project ID type: `ParseUUIDPipe` (uuid), `ParseIntPipe` (autoincrement), `ParseCuidPipe` (cuid, from nest-common). A missing pipe often does not show: on a TEXT id column a junk id is just a 404, so the omission survives review. With a `@db.Uuid` column it becomes a 500.
15. Never hardcode a fallback secret or default admin password in app code (`?? 'secret'`). Secrets are required in the Joi schema; a third-party secret (`RESEND_API_KEY`, `GOOGLE_CLIENT_ID`) is `required()` while its feature is on, with no fallback (`'not-configured'`). Seeds:
    - Read the admin email/password from env inside the seed script; fail when missing. No default password, ever (`|| 'admin123'`).
    - Create the admin only if it does not exist; never overwrite an existing admin's password on re-run.
    - Keep the seed in `prisma/seed.ts`, not in `src/` (it would ship in `dist`), and keep seed-only vars out of the boot schema.
16. Behind a reverse proxy (Nginx, Caddy, a PaaS load balancer, Cloudflare), set `app.set('trust proxy', hops)` in `main.ts` with `hops` = the number of proxies in front of the app, from `TRUST_PROXY_HOPS` (Joi, default `0`). The throttler keys on `req.ip`:
    - Without it, `req.ip` is the proxy, so **all clients share one throttle bucket** (one user can lock out everyone, and the limit stops protecting anything).
    - With `true`, Express takes the left-most `X-Forwarded-For` value, which the client controls, so an attacker gets a fresh bucket per request.
    - Ask the user how many proxies are in front of production if it is not documented. If there is no answer, keep `TRUST_PROXY_HOPS=0` and tell the user in your report that throttling is per proxy, not per client, until it is set. Verified at runtime with `X-Forwarded-For` (see Good example).
    - Never override the throttler's `getTracker` to read `X-Forwarded-For`, `X-Real-IP` or `CF-Connecting-IP`: the client sets those headers, which equals `trust proxy = true`. Use `req.ip`.
    - A BFF (Next.js route handler) in front of the API must **overwrite** `X-Forwarded-For` with the client IP it saw, never copy the browser's header; the backend then counts the BFF as one hop.
17. Never return a database model as is from an auth or user endpoint. Use an explicit `select` (`profileSelect` in the reference). `passwordHash`, `codeHash` / `otpHash`, `tokenVersion` and refresh token hashes never leave the service.
18. Every auth body is a DTO class (`@Body() dto: LoginDto`), never an inline type (`@Body() dto: { ... }`), which skips validation and lets `role`/`isActive` through (mass assignment). The global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`) then rejects unknown fields with 400. Never spread a DTO into `data` of a user update.
19. Register never updates an existing user, verified or not: it does not replace `passwordHash`, `role` or the email of a row that already exists. Existing email → 409 (rule 12 exception); the owner uses forgot-password.
20. One password policy, defined once (`IsNewPassword`: `@IsString() @MinLength(8) @MaxLength(128)`) and used by register, reset and change. Login and "current password" fields use `IsCurrentPassword` (`@IsString() @MaxLength(128)`, no minimum), so they reveal no policy and old passwords still work.
21. Endpoints are under `/auth`, `POST` actions use `@HttpCode(HttpStatus.OK)`, and every success goes through `MessageResponse` (`data: null` when there is nothing to return):

    | Endpoint | Guard | Body → `data` |
    |---|---|---|
    | `POST /auth/login` (core) | `[PUBLIC]` | `LoginDto` → `{ accessToken }` |
    | `GET /auth/me` (core) | `[AUTH]` | → profile (`id, email, role, emailVerifiedAt, createdAt`) |
    | `POST /auth/change-password` (core) | `[AUTH]` | `ChangePasswordDto` → `{ accessToken }`; `tokenVersion` +1, wrong current password → 400 |
    | `POST /auth/logout-all` (core) | `[AUTH]` | → `null`; `tokenVersion` +1, every token of the user is dead |
    | `POST /auth/register` | `[PUBLIC]` | `RegisterDto` → `null` (201), sends `EMAIL_VERIFICATION` |
    | `POST /auth/verify-otp` | `[PUBLIC]` | `VerifyOtpDto` → `{ accessToken }` or `null` (rule 11) |
    | `POST /auth/resend-otp`, `POST /auth/forgot-password` | `[PUBLIC]` | `RequestCodeDto` → `null`, same message always |
    | `POST /auth/reset-password` | `[PUBLIC]` | `ResetPasswordDto` → `null`; `tokenVersion` +1 |

    The current user's profile is `/auth/me`, not `/users/me`. Without refresh tokens there is no server "logout this device": the client drops the token; `logout-all` is the server-side kill switch.
22. Reference `User` model: `id`, `email String @unique` (lowercased and trimmed in the DTO), `passwordHash String?` (null → `'Invalid credentials'`, for Google-only users), `role Role`, `isActive Boolean @default(true)` (disabled by an admin), `emailVerifiedAt DateTime?` (verified), `tokenVersion Int @default(0)`, `createdAt`, `updatedAt`, `@@map("users")`. `isActive` never means "verified": OTP verification sets `emailVerifiedAt`. Seeded and admin-created users are created verified. `UserIdentity` is added only with Google login. ID type: ask (`nest-prisma`), variants in the reference.
23. One-time codes go out through the `OtpSender` port (`OTP_SENDER` token) in a `@Global()` `MailModule` in `src/common/mail/`, not a mailer inside `src/auth/`. Adapters: Resend (production) and console (`OTP_SENDER=console`, throws at startup when `NODE_ENV=production`). Never log a code, also not "in development" (`NODE_ENV` defaults to `development`, so a missing env leaks codes in production). When sending fails, the code is already stored: log the failure without code or address, do not rethrow, and answer as usual (the user resends).
24. Auth needs both scaffolds: before writing auth, check that `src/common/` (nest-common) and `src/prisma/` (nest-prisma) exist; if not, stop and ask the user to run `npx @averildwi/nest-prisma`, then `npx @averildwi/nest-common`. Do not hand-write them. The **only** nest-common edits allowed for auth, in `src/common/types/auth-user.ts`: `RoleName = Role` (import type from `generated/prisma/client`), `UserId` to match the ID type, and `JwtPayload` to `{ sub: string; email: string; tv: number }`. Everything else in `src/common/` is used as is.
25. Env vars of auth features (`OTP_*`, `OTP_SENDER`, `RESEND_API_KEY`, `MAIL_FROM`, `GOOGLE_CLIENT_ID`, `REFRESH_TOKEN_TTL_DAYS`) go in `src/config/env.schema.ts` (`projectEnvSchema`), passed as `AppConfigModule.forProject(projectEnvSchema)`, and in `.env.example`. `JWT_*` stays in nest-common's base schema.

## Good example

Core files (copy from `references/reference-implementation.md`): `JwtStrategy`, `AuthService`, `AuthController`, `OtpService`, DTOs.

```ts
// src/auth/strategies/jwt.strategy.ts (core of validate)
if (typeof payload.tv !== 'number') throw new UnauthorizedException();
const user = await this.prisma.user.findUnique({ where: { id: payload.sub },
  select: { id: true, email: true, role: true, isActive: true, emailVerifiedAt: true, tokenVersion: true } });
if (!user || !user.isActive || !user.emailVerifiedAt || user.tokenVersion !== payload.tv) {
  throw new UnauthorizedException('Session is no longer valid');
}
return { id: user.id, email: user.email, role: user.role };

// src/auth/auth.service.ts (core of login)
const user = await this.prisma.user.findUnique({ where: { email },
  select: { ...tokenUserSelect, passwordHash: true, emailVerifiedAt: true } });
const passwordOk = await this.hashing.verify(password, user?.passwordHash ?? this.dummyHash);
if (!user?.passwordHash || !passwordOk) throw new UnauthorizedException('Invalid credentials');
if (!user.isActive) throw new ForbiddenException('Account is disabled'); // only after the password
return { accessToken: await this.signToken(user) }; // payload { sub, email, tv }

// Controller: per-handler throttle, id pipe, label = guards
@Post(':id/deactivate') @HttpCode(HttpStatus.OK) @Roles('ADMIN')
@ApiOperation({ summary: '[ADMIN] Deactivate a user and end their sessions' })
deactivate(@Param('id', ParseUUIDPipe) id: string) { /* isActive: false, tokenVersion: { increment: 1 } */ }
```

```ts
// main.ts: trust proxy (rule 16) + CORS
app.set('trust proxy', config.getOrThrow<number>('TRUST_PROXY_HOPS')); // 1 behind one Nginx
const allowedOrigins = config.getOrThrow<string>('FRONTEND_URL').split(',').map((o) => o.trim()).filter(Boolean);
app.enableCors({ origin: allowedOrigins, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] });
```

Verified behind one proxy (limit 2, every request from the proxy socket, `X-Forwarded-For` set):

| `trust proxy` | client A (3 req) | client B (2 req) | attacker, fake XFF (4 req) |
|---|---|---|---|
| not set | 200, 200, 429 (`req.ip` = proxy) | 429, 429 | 429 ×4: everyone shares one bucket |
| `1` | 200, 200, 429 | 200, 200 | 200, 200, 429, 429: real IP used |
| `true` | 200, 200, 429 | 200, 200 | 200 ×4: spoofed IP, limit bypassed |

## Bad example

```ts
@Roles('PANITIA', 'SISWA')                 // BAD: label says [PANITIA] but SISWA is allowed too
@ApiOperation({ summary: '[PANITIA] Approve team' })
approve(@Param('id') id: string,           // BAD: no ParseUUIDPipe
        @CurrentUser() user: JwtPayload) {} // BAD: request.user is AuthUser, never JwtPayload
@Patch('profile') update(@Body() dto: { name?: string; isActive?: boolean }) {} // BAD: inline body, mass assignment
this.jwt.sign({ sub: user.id, email: user.email, role: user.role }); // BAD: role in the token, no tv
return this.prisma.user.findUnique({ where: { id } });  // BAD: returns passwordHash and tokenVersion
if (this.hashing.verify(dto.password, user.passwordHash)) {} // BAD: no await, always true
const otp = otps.find((o) => this.hashing.verify(code, o.codeHash)); // BAD: async verify in find()
if (!user.isActive) throw new ForbiddenException('Inactive'); // BAD: before the password check (enumeration)
if (existing && !existing.emailVerifiedAt) await tx.user.update({ data: { passwordHash } }); // BAD: register overwrites
if (env.NODE_ENV !== 'production') this.logger.log(`OTP ${code}`); // BAD: codes in logs
await tx.user.update({ data: { isActive: true } });     // BAD: verification is emailVerifiedAt
getTracker(req) { return req.headers['x-forwarded-for'] ?? req.ip; } // BAD: client picks its bucket
app.set('trust proxy', true);                         // BAD: client-controlled X-Forwarded-For becomes req.ip
const hash = scryptSync(password, salt, 64);          // BAD: blocks the event loop
secretOrKey: process.env.JWT_SECRET ?? 'dev-secret',  // BAD: fallback secret + process.env
FRONTEND_URL: Joi.string().default('*'),              // BAD: CORS open by default
password: process.env.ADMIN_PASSWORD || 'admin123',   // BAD: default admin password in the seed
@Throttle({ default: { limit: 10, ttl: 60_000 } }) @Controller('auth') // BAD: class-level, limits me too
const attempts = new Map<string, number>();           // BAD: in-memory limiter
if (otp.attempts >= MAX_OTP_ATTEMPTS) throw ...;      // BAD: stale read, 20 parallel guesses all pass it
res.redirect(`${frontendUrl}/callback?token=${token}`); // BAD: token in URL
io(url, { query: { token } });                        // BAD: token in the socket URL
```

## Checklist before finishing

- [ ] `test/route-guards.e2e-spec.ts` exists and passes: every handler has `JwtAuthGuard` (+ `RolesGuard`/`@Roles`, `@ApiBearerAuth('access-token')`) or `[PUBLIC]`, and the prefix matches `@Roles`.
- [ ] `JwtPayload` is `{ sub, email, tv }`, no role. `validate()` checks missing user, `isActive`, `emailVerifiedAt` (if used), `tokenVersion`.
- [ ] Reset/change password, deactivation and logout-all bump `tokenVersion`; a test shows the old token gets 401.
- [ ] Login returns `{ accessToken }` via `MessageResponse`; unknown email and wrong password give identical bodies; status is checked after the password.
- [ ] Bodies are DTO classes; responses use an explicit `select` without hashes or `tokenVersion`.
- [ ] Passwords/OTPs use async `HashingService`, every call awaited; one password policy.
- [ ] `@Throttle` per handler per rule 10. OTP: purpose, atomic claim, consume once, DB cooldown, never logged.
- [ ] Every `:id` has the correct parse pipe. The user is typed as `AuthUser`.
- [ ] `trust proxy` from `TRUST_PROXY_HOPS` (never `true`, no header-reading `getTracker`); hop count asked or reported.
- [ ] No `'*'` CORS, no fallback secrets or seed passwords, no token in a URL. Feature env vars in `projectEnvSchema` and `.env.example`.
