---
name: nest-validation-and-config
description: Use when writing DTOs, query/body validation, PaginationDto, environment variables, or ConfigModule/Joi setup in a NestJS project.
---

## When to use

- Creating or editing any `*.dto.ts`.
- Adding a query parameter, request body or route parameter.
- Adding or reading an environment variable.

## Rules

### DTOs

1. Every `@Body()` and `@Query()` is typed with a DTO class. Never use an inline object type or `@Body('field')`.
2. Use one file per DTO in `<feature>/dto/`:
   - `create-<entity>.dto.ts` → `Create<Entity>Dto`
   - `update-<entity>.dto.ts` → `Update<Entity>Dto`
   - `query-<entity>.dto.ts` → `Query<Entity>Dto`
   - action DTOs: `<verb>-<entity>.dto.ts` → `<Verb><Entity>Dto` (for example `RejectOrderDto`)
3. Every field has class-validator decorators **and** `@ApiProperty` / `@ApiPropertyOptional` with `example` (and `description` when the name is not obvious).
4. Optional fields use `@IsOptional()` + `@ApiPropertyOptional` + `?:`.
5. `Update<Entity>Dto extends PartialType(Create<Entity>Dto)`, with `PartialType` imported from `@nestjs/swagger` (not `@nestjs/mapped-types`).
6. Every list query DTO `extends PaginationDto`. Declare every extra query param on the DTO. Never read it with a separate `@Query('x')`, because `forbidNonWhitelisted` rejects unknown params.
7. Booleans from query strings use `@ToBoolean()` + `@IsBoolean()` (decorator below). With `enableImplicitConversion`, both a bare `@IsBoolean()` and `@Transform(({ value }) => value === 'true')` turn `"false"` into `true`, because `value` is already converted. `ToBoolean` reads the raw `obj[key]`. Verified at runtime.
8. Enums: use `@IsEnum(PrismaEnum)` with the enum imported by relative path from `generated/prisma/client` (for example `'../../../generated/prisma/client'` from `src/<feature>/dto/`).
9. Do not copy the same validation rule (for example password length) into several DTOs with different values. Define a constant once.

### Global ValidationPipe

10. Register it once in `main.ts` with `app.useGlobalPipes(createValidationPipe())`. The options are fixed: `whitelist`, `forbidNonWhitelisted`, `transform`, `enableImplicitConversion`, `stopAtFirstError`, plus an `exceptionFactory` that flattens errors to `["path.child: message"]`.

### Environment

11. Validate every env var with Joi through `AppConfigModule.forProject(extraSchema)`. Define project vars in `src/config/env.schema.ts` and concat them onto `baseEnvSchema`.
12. If code reads a variable, the variable is in the schema **and** in `.env.example`. If a variable is in the schema, some code reads it.
13. Read env with `ConfigService`: `config.getOrThrow<string>('JWT_SECRET')`. Never use `process.env` outside `main.ts` and `PrismaService`.
14. Never put a fallback for secrets (`?? 'dev-secret'`). Mark secrets `.required()` in Joi so boot fails instead.
15. Values that are only for seeding (`ADMIN_SEED_*`) are not required at app boot. Read them in the seed script.

## Good example

`src/common/dto/pagination.dto.ts`:

```ts
export class PaginationDto {
  @ApiPropertyOptional({ minimum: 1, default: 1, example: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20, example: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit: number = 20;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}
```

`src/teams/dto/create-team.dto.ts`, `update-team.dto.ts`, `query-team.dto.ts`:

```ts
export class CreateTeamDto {
  @ApiProperty({ example: 'Alpha Squad', description: 'Unique team name' })
  @IsString()
  @Length(2, 50)
  name: string;
}

export class UpdateTeamDto extends PartialType(CreateTeamDto) {}

export class QueryTeamDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'alpha', description: 'Filter by name' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  search?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}
```

`src/common/decorators/to-boolean.decorator.ts`:

```ts
export function ToBoolean(): PropertyDecorator {
  return Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const raw = obj[key];
    if (raw === 'true' || raw === true) return true;
    if (raw === 'false' || raw === false) return false;
    return raw; // anything else is left for @IsBoolean() to reject
  });
}
```

Env schema and module (`src/common/config/base-env.schema.ts`, `app-config.module.ts`):

```ts
export const baseEnvSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  FRONTEND_URL: Joi.string().allow('').default(''), // comma-separated; empty = no CORS
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).default(0), // reverse proxies in front of the app
});

@Global()
@Module({})
export class AppConfigModule {
  static forProject(extraSchema?: ObjectSchema): DynamicModule {
    const schema = extraSchema ? baseEnvSchema.concat(extraSchema) : baseEnvSchema;
    return {
      module: AppConfigModule,
      imports: [ConfigModule.forRoot({ isGlobal: true, validationSchema: schema, validationOptions: { abortEarly: false, allowUnknown: true } })],
    };
  }
}
```

```ts
// src/config/env.schema.ts: project-specific vars
export const projectEnvSchema = Joi.object({
  CLOUDINARY_URL: Joi.string().uri().required(),
});

// app.module.ts
imports: [AppConfigModule.forProject(projectEnvSchema), /* ... */],

// usage inside a provider
constructor(private readonly config: ConfigService) {}
const url = this.config.getOrThrow<string>('CLOUDINARY_URL');
```

## Bad example

```ts
// BAD: inline body type. Nothing is validated (mass assignment).
@Patch('me')
updateSelf(@Body() dto: { canteenName?: string; description?: string }) {}

// BAD: extra query param read outside the DTO. Rejected by forbidNonWhitelisted, and unvalidated.
findAll(@Query() pagination: PaginationDto, @Query('isActive') isActive?: string) {}

// BAD: both become true for ?flag=false (implicit conversion runs first).
@IsOptional() @IsBoolean() excludeGrade12?: boolean;
@IsOptional() @Transform(({ value }) => value === 'true') @IsBoolean() isActive?: boolean;

// BAD: update DTO rewritten by hand. It drifts from the create DTO.
export class UpdateTeamDto { @IsOptional() @IsString() name?: string }

// BAD: process.env outside main.ts/PrismaService, a hardcoded fallback secret, and a var missing from the schema.
secretOrKey: process.env.JWT_SECRET ?? 'super-secret',
const ready = process.env.FRONTEND_READY!;
```

## Checklist before finishing

- [ ] Every `@Body()`/`@Query()` uses a DTO. Every field has a validator and `@ApiProperty`.
- [ ] Update DTOs use `PartialType` from `@nestjs/swagger`.
- [ ] List DTOs extend `PaginationDto` and declare every filter.
- [ ] Query booleans use `@ToBoolean()` + `@IsBoolean()`.
- [ ] Every new env var is in the Joi schema **and** `.env.example`, and is read with `ConfigService`.
- [ ] No `process.env` outside `main.ts`/`PrismaService`. No fallback secrets.
