---
name: nest-architecture
description: Use when creating a new NestJS feature module, adding files, naming things, wiring main.ts/app.module.ts, or documenting endpoints with Swagger.
---

## When to use

- Creating a new feature (module, controller, service, DTOs).
- Deciding where a file goes or what to name it.
- Editing `main.ts` or `app.module.ts`.

## Rules

### Structure

1. Infrastructure shared by many features lives in `src/common/<kind>/`:
   `config/`, `decorators/`, `dto/`, `filters/`, `guards/`, `hashing/`, `helpers/`, `interceptors/`, `mail/`, `pipes/`, `types/`.
   `PrismaService`/`PrismaModule` live in `src/prisma/`. Project-only config lives in `src/config/`.
   (`mail/` holds the `OtpSender` port and its adapters, `@Global()` like the other infrastructure modules.)
2. A feature lives in `src/<feature>/` with `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, `dto/`, and `<feature>.service.spec.ts`. The folder name is plural kebab-case (`teams`, `team-memberships`).
3. Layering is Controller → Service → `PrismaService`. No repository classes.
   - Controllers: routing, guards, pipes, Swagger, and choosing the response marker (`MessageResponse`/`Paginated`). No Prisma calls, no business logic.
   - Services: business logic and data access.
4. Logic used by two or more features that needs no DI goes in a pure function in `src/common/helpers/<name>.helper.ts`. If it must run inside a transaction, it takes `tx: Prisma.TransactionClient` as a parameter. Logic used by one feature stays in that feature.
5. Infrastructure modules are `@Global()`: `PrismaModule`, `AppConfigModule`, `HashingModule`, and mail/upload modules. Do not re-import them in feature modules.
6. Every feature module is registered in `app.module.ts` `imports`.

### Naming

7. Files are `<name-kebab>.<kind>.ts`: `jwt-auth.guard.ts`, `paginate.helper.ts`, `auth-user.ts` (types), `create-team.dto.ts`.
8. Classes are PascalCase with the kind suffix (`TeamsService`, `RolesGuard`, `CreateTeamDto`). Interfaces have no `I` prefix. Metadata keys are UPPER_SNAKE (`ROLES_KEY`). Variables and functions are camelCase.
9. Routes are kebab-case and plural, under global prefix `api` (`app.setGlobalPrefix('api')`):
   - collection: `teams`, `menu-categories`
   - nested: `teams/:teamId/reports`
   - current user: `.../me`
   - state change: `POST :id/<verb>` (`orders/:id/accept`) with `@HttpCode(HttpStatus.OK)`

### main.ts wiring (fixed order)

10. In order: `app.set('trust proxy', TRUST_PROXY_HOPS)`, `setGlobalPrefix('api')`, CORS, `useGlobalPipes(createValidationPipe())`, `useGlobalInterceptors(new LoggerInterceptor(), new TransformInterceptor())`, `useGlobalFilters(new GlobalExceptionFilter(), new PrismaExceptionFilter())`, Swagger, then `listen`. Register them with `new` (not `APP_*`). The exception is `ThrottlerGuard`, which is `APP_GUARD` in `app.module.ts`.
    - Create the app as `NestFactory.create<NestExpressApplication>(AppModule)` so `app.set` is typed.
    - `trust proxy` is the **number of reverse proxies** in front of the app (`TRUST_PROXY_HOPS` in the Joi schema, default `0`). Never `true`. Details and why: `nest-auth-and-security` rule 16.
    - The filter order is not cosmetic: register `GlobalExceptionFilter` **before** `PrismaExceptionFilter`, because Nest tries the **last** registered first. Reversed, a P2002 becomes 500. There is a two-way test for it in `nest-auth-and-security` → `references/test-recipes.md`.

### Swagger

11. Serve Swagger at `/docs` with bearer scheme name `'access-token'` and `persistAuthorization: true`.
12. Every controller has `@ApiTags('<Feature>')`. Every handler has `@ApiOperation({ summary: '[PREFIX] Verb object' })`. The prefix is derived from the guards, never chosen freely:
    - `[PUBLIC]`: no `JwtAuthGuard`.
    - `[AUTH]`: `JwtAuthGuard` and no `@Roles` (any logged-in user).
    - Otherwise: **exactly** the `@Roles(...)` list joined with `/`, in the same order. `@Roles('ADMIN')` → `[ADMIN]`; `@Roles('ADMIN', 'STAFF')` → `[ADMIN/STAFF]`; `@Roles('STAFF', 'TEACHER', 'STUDENT')` → `[STAFF/TEACHER/STUDENT]`.
    - Ownership checks in the service (rule 8 of `nest-auth-and-security`) do not change the prefix; mention them in `description` instead.
    - A route guarded by something other than JWT (a webhook shared secret, `AuthGuard('google')`, a refresh cookie) is still `[PUBLIC]`, and its `description` names the mechanism. `nest-auth-and-security` rule 4 has a required meta-test that checks every handler's prefix against its guards.

### Code style

13. Prettier is `singleQuote: true`, `trailingComma: 'all'`, 2-space indent. Use relative imports (`../common/...`), not `src/...`.
14. Comments are in English and explain **why**, not what. No commented-out code, and no leftover notes such as `// adjust this import path`.

## Good example

```text
src/
  app.module.ts
  main.ts
  common/
    config/{app-config.module.ts,base-env.schema.ts}
    decorators/{current-user.decorator.ts,roles.decorator.ts,to-boolean.decorator.ts}
    dto/pagination.dto.ts
    filters/{global-exception.filter.ts,prisma-exception.filter.ts}
    guards/{jwt-auth.guard.ts,roles.guard.ts}
    hashing/{hashing.module.ts,hashing.service.ts}
    helpers/{error-response.helper.ts,paginate.helper.ts}
    interceptors/{logger.interceptor.ts,transform.interceptor.ts}
    pipes/validation.pipe.config.ts
    types/auth-user.ts
  config/env.schema.ts
  prisma/{prisma.module.ts,prisma.service.ts}
  teams/
    dto/{create-team.dto.ts,update-team.dto.ts,query-team.dto.ts}
    teams.controller.ts
    teams.module.ts
    teams.service.ts
    teams.service.spec.ts
```

```ts
// src/main.ts
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Behind a proxy, req.ip is the proxy unless we trust it. Trust the exact hop count, never `true`.
  app.set('trust proxy', config.getOrThrow<number>('TRUST_PROXY_HOPS'));
  app.setGlobalPrefix('api');

  // Empty FRONTEND_URL means no cross-origin access, never '*'.
  const allowedOrigins = (process.env.FRONTEND_URL ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: allowedOrigins, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] });

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(new LoggerInterceptor(), new TransformInterceptor());
  // Nest tries the LAST registered filter first, so the catch-all goes first.
  app.useGlobalFilters(new GlobalExceptionFilter(), new PrismaExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Example API')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig), {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
```

```ts
// src/app.module.ts
@Module({
  imports: [
    PrismaModule,
    AppConfigModule.forProject(projectEnvSchema),
    HashingModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    AuthModule,
    TeamsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

// src/teams/teams.module.ts: global modules are NOT re-imported
@Module({ controllers: [TeamsController], providers: [TeamsService] })
export class TeamsModule {}
```

## Bad example

```ts
// BAD: controller talks to Prisma directly and holds business logic.
@Post('webhook')
async handle(@Body() dto: XenditWebhookDto) {
  const order = await this.prisma.order.findUnique({ where: { id: dto.externalId } });
  if (order.status === 'PENDING') await this.prisma.order.update({ /* ... */ });
}

// BAD: repository layer that only forwards to Prisma.
@Injectable()
export class TeamsRepository {
  findAll() { return this.prisma.team.findMany(); }
}

// BAD: AppConfigModule imported twice (once without forProject), and global modules re-imported.
imports: [AppConfigModule, ProjectConfigModule, PrismaModule],

// BAD: inconsistent route naming.
@Controller('Team')            // must be 'teams'
@Post('acceptOrder/:id')       // must be ':id/accept'
@Get('getAll')                 // must be @Get()

// BAD: Swagger prefix does not match the guards.
@Roles('STAFF', 'TEACHER')
@ApiOperation({ summary: '[ADMIN/STAFF] Approve a report' })  // must be '[STAFF/TEACHER]'
@UseGuards(JwtAuthGuard)
@ApiOperation({ summary: '[PUBLIC] Get my profile' })         // must be '[AUTH]'

// BAD: trusts every hop, so a client can send a fake X-Forwarded-For and dodge the throttler.
app.set('trust proxy', true);
```

## Checklist before finishing

- [ ] New feature files follow the folder layout and `<name>.<kind>.ts` naming.
- [ ] Controllers contain no Prisma calls. Services contain no Swagger or response markers.
- [ ] The new module is registered in `app.module.ts`, and global modules are not re-imported.
- [ ] Routes are kebab-case plural, and actions use `POST :id/<verb>` + `@HttpCode(200)`.
- [ ] `@ApiTags` on the controller, and `@ApiOperation` on each handler with the prefix derived from the guards (`[PUBLIC]`, `[AUTH]`, or the exact `@Roles` list joined by `/`).
- [ ] `main.ts` order matches rule 10, including `trust proxy` from `TRUST_PROXY_HOPS`.
