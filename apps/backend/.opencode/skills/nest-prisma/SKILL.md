---
name: nest-prisma
description: Use when creating or changing a Prisma schema, PrismaService, or any service code that queries the database with Prisma in a NestJS project.
---

## When to use

- Starting a new project (schema + PrismaService setup).
- Adding or changing a model, relation or enum in `prisma/schema.prisma`.
- Writing or reviewing any `this.prisma.*` query in a service.

## Ask first

Before writing the first model of a **new project**, ask the user:

> "Which ID type should this project use: `uuid`, `cuid`, or `autoincrement`?"

Never pick one yourself. Record the answer and use it for every model. The answer also decides the `:id` pipe (see `nest-auth-and-security`):

| Answer | Schema | Route pipe |
|---|---|---|
| uuid | `String @id @default(uuid()) @db.Uuid` (Postgres) | `ParseUUIDPipe` |
| cuid | `String @id @default(cuid())` | `ParseCuidPipe` (custom) |
| autoincrement | `Int @id @default(autoincrement())` | `ParseIntPipe` |

For an existing project, read the schema and follow the ID type already in use.

Also ask when unsure whether an entity needs soft delete (rule 5).

## Rules

1. Model names are singular PascalCase. Fields are camelCase. Enum values are UPPER_SNAKE.
2. Every model has `@@map("snake_case_plural")`. Never use `@map` on individual columns.
3. Every model has `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt`. The only exception is a **pure** pivot table: composite `@@id` and nothing but the two foreign keys. It may have `createdAt` alone. As soon as the join row carries its own data (`isLeader`, `role`, `status`), it is a normal model and needs both timestamps.
4. Write `onDelete` explicitly on every relation (`Cascade`, `SetNull` or `Restrict`).
5. Soft delete depends on the domain. Add `deletedAt DateTime?` only for entities that history or reports still reference (for example users or students). Everything else is hard deleted with `onDelete`. When unsure, ask.
6. Use Prisma 7 with the `prisma-client` generator, a driver adapter, and output in the **project root** (`../generated/prisma`). Import the client with a **relative path** to `generated/prisma/client` (`'../../generated/prisma/client'` from `src/<feature>/`, `'../../../generated/prisma/client'` from `src/common/<folder>/`). Never import from `@prisma/client`, and never through a tsconfig alias (`'generated/prisma/client'`): the scaffold does not configure `paths`, and an alias also needs a Jest `moduleNameMapper` entry and breaks plain `tsc` + `node` output.
7. Inject `PrismaService` directly into services. Do not create repository classes.
8. Always use an explicit `select`. Never return a model with plain `include: { relation: true }`, because it returns every column of the relation, including secrets such as `passwordHash`.
9. Store a reused selection shape as a `const xxxSelect = { ... } satisfies Prisma.XSelect`, next to the service that owns it.
10. For a list plus total, use `this.prisma.$transaction([findMany, count])` with the same `where`. The batch runs on one connection as one atomic transaction, unlike `Promise.all`. It does **not** make both reads consistent with each other: on PostgreSQL the default level is `READ COMMITTED`, so `count` can see a row committed after `findMany` ran. When the two numbers must match exactly (reports, exports), pass `{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }` as the second argument. Do not add it by default.
11. Use an interactive `$transaction(async (tx) => ...)` for multi-step writes. Inside it, use only `tx`, never `this.prisma`.
12. For get/update/delete by id, call `findUnique` first and `throw new NotFoundException('<Entity> not found')` when the result is null. Do not rely on P2025 for normal flow.
13. Never `await` a Prisma call inside a loop (N+1). Use `createMany`, `updateMany`, `where: { id: { in: ids } }`, or one `$transaction([...])`.
14. Case-insensitive search: `mode: 'insensitive'` exists **only on PostgreSQL** (and MongoDB). On MySQL/MariaDB the generated type has no `mode` and `tsc` fails (TS2353, verified); write `{ contains: query.search }` and rely on the column's case-insensitive collation (the MySQL default `utf8mb4_..._ci`). Check `datasource db { provider }` before copying a search query.
15. Destructive database commands need the user's **explicit approval in this conversation**, every time: `prisma migrate reset`, `prisma db push --accept-data-loss`, `prisma db push --force-reset`, `prisma migrate dev` when it says it must reset, `DROP`/`TRUNCATE` via `db execute`, and deleting `prisma/migrations/`. Ask with the exact command and what data is lost, then wait.
    - If Prisma refuses (for example "Prisma Migrate detected that it was invoked by <agent>", a drift warning, or a reset prompt), **stop and report it**. Do not look for a workaround: no env var to silence the check, no `--force`, no hand-written SQL, no other database URL, no deleting the migration history.
16. Because `generated/` sits next to `src/`, `nest build` emits `dist/src/main.js` and `dist/generated/...`. So `package.json` has `"start:prod": "node dist/src/main"` and `nest-cli.json` has `"entryFile": "src/main"`. Do not "fix" them back to `dist/main`, and do not move `generated/` into `src/` to make that path work. Keep the Prisma config file (`prisma.config.ts`, or `prisma7.config.ts` as written by recent `prisma init`) in the `exclude` of `tsconfig.build.json`.

## Good example

`prisma/schema.prisma` (ID type = uuid, as answered by the user):

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../generated/prisma"
  moduleFormat = "cjs"
}

model Team {
  id        String       @id @default(uuid()) @db.Uuid
  name      String       @unique
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt
  members   TeamMember[]

  @@map("teams")
}

model TeamMember {
  teamId    String   @db.Uuid
  userId    String   @db.Uuid
  isLeader  Boolean  @default(false) // own data, so this is not a pure pivot
  createdAt DateTime @default(now()) // doubles as the join time
  updatedAt DateTime @updatedAt
  team      Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([teamId, userId])
  @@map("team_members")
}
```

`src/prisma/prisma.service.ts` (PostgreSQL; MySQL uses `PrismaMariaDb` from `@prisma/adapter-mariadb`):

```ts
import 'dotenv/config';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Allowed exception to the "no process.env" rule (runs before ConfigService).
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set. Add it to your .env file.');
    super({ adapter: new PrismaPg(connectionString) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

`PrismaModule` is `@Global()` and exports `PrismaService`.

`src/teams/teams.service.ts`:

```ts
import { Prisma } from '../../generated/prisma/client';

export const teamSelect = {
  id: true, name: true, createdAt: true, updatedAt: true,
} satisfies Prisma.TeamSelect;

export const teamDetailSelect = {
  ...teamSelect,
  members: {
    select: { isLeader: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.TeamSelect;

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryTeamDto) {
    const where: Prisma.TeamWhereInput = query.search
      ? { name: { contains: query.search, mode: 'insensitive' } } // PostgreSQL only, see rule 14
      : {};
    const [data, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({ where, select: teamSelect, skip: query.skip, take: query.limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.team.count({ where }),
    ]);
    return paginate(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    const team = await this.prisma.team.findUnique({ where: { id }, select: teamDetailSelect });
    if (!team) throw new NotFoundException('Team not found');
    return team;
  }

  async create(dto: CreateTeamDto, leaderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({ data: { name: dto.name }, select: teamSelect });
      await tx.teamMember.create({ data: { teamId: team.id, userId: leaderId, isLeader: true } });
      return team;
    });
  }
}
```

## Bad example

```ts
// BAD: plain include leaks every User column, including passwordHash.
return this.prisma.team.findUnique({ where: { id }, include: { members: { include: { user: true } } } });

// BAD: N+1 query, one round trip per item, and not atomic.
for (const item of dto.items) {
  await tx.menu.update({ where: { id: item.menuId }, data: { stock: { decrement: item.quantity } } });
}

// BAD: Promise.all for list + count takes two pool connections and is not one transaction (use $transaction([...])).
const [data, total] = await Promise.all([this.prisma.team.findMany(), this.prisma.team.count()]);

// BAD: two related writes without a transaction. If the second fails, the first stays.
await this.prisma.otpCode.update({ where: { id }, data: { usedAt: new Date() } });
await this.prisma.user.update({ where: { id: userId }, data: { isActive: true } });
```

```prisma
// BAD: no @@map, no timestamps, @map on columns, ID type chosen without asking.
model Team {
  id   Int    @id @default(autoincrement())
  name String @map("team_name")
}
```

## Checklist before finishing

- [ ] ID type was asked for (new project) or matches the existing schema.
- [ ] Every new model has `@@map`, `createdAt` and `updatedAt`, and explicit `onDelete`.
- [ ] No `include: { x: true }`. Every query has `select`, and no secret column is selected.
- [ ] List endpoints use `$transaction([findMany, count])` with a shared `where`.
- [ ] Multi-step writes are inside `$transaction(async (tx) => ...)` and use only `tx`.
- [ ] No `await` on Prisma inside a loop.
- [ ] Client is imported by relative path (`../../generated/prisma/client`), not `@prisma/client` and not an alias.
- [ ] After a schema change, you ran `npx prisma generate` and created a migration (`npx prisma migrate dev --name <change>`). If no database is reachable, do not hand-write a migration: commit the schema change, then tell the user "migration not created, run `npx prisma migrate dev --name <change>`".
- [ ] `mode: 'insensitive'` only if the provider is PostgreSQL.
- [ ] No reset / `--accept-data-loss` / `--force-reset` without explicit approval, and no workaround when Prisma refused.
