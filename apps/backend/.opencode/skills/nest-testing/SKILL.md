---
name: nest-testing
description: Use when writing or reviewing unit tests for NestJS services, guards or pipes, or when finishing any feature that adds or changes business logic.
---

## When to use

- After adding or changing a service method with business rules.
- When a bug is fixed: add a test that fails without the fix.
- When asked to "add tests" in a NestJS project.

## Rules

1. Every service with business logic has `<feature>.service.spec.ts` next to it.
2. Build the unit with `Test.createTestingModule({ providers: [Service, { provide: PrismaService, useValue: prismaMock }] })`. Never connect to a real database in a unit test.
3. Mock only the Prisma methods the code under test calls, typed as `jest.Mock` (no `any`).
4. Mock interactive transactions so they run the callback with a mocked `tx`:
   `$transaction: jest.fn((cb) => cb(tx))`.
   For array transactions, use `$transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops))`.
5. Test these, in priority order:
   - every thrown exception path (not found, forbidden, conflict, invalid state)
   - the happy path, asserting the **exact** Prisma call arguments that matter (`where`, `data`)
   - that a write did **not** happen on a rejected path (`expect(tx.x.delete).not.toHaveBeenCalled()`)
   - pure helpers (`paginate`, parsers, diff functions), tested directly without Nest
6. Assert exception types with `rejects.toBeInstanceOf(NotFoundException)`, not by message text.
7. Test names are English sentences that describe behaviour: `'throws NotFoundException when the user is not a member'`.
8. Use `describe('<Service>.<method>', ...)` with one `describe` per public method.
9. Never commit a boilerplate spec (`it('should be defined')` with no mocks). If `nest g` creates one, replace it with real tests or delete it.
10. Run `npm run test` before committing (see `git-workflow`). A red or failing-to-compile spec blocks the commit.
11. If the Prisma client is generated with `.js` import suffixes (Prisma 7 `prisma-client`), Jest needs `"moduleNameMapper": { "^(\\.{1,2}/.*)\\.js$": "$1" }`. `@averildwi/nest-prisma` 3.0.0+ adds it to `package.json` and `test/jest-e2e.json` automatically. In an older project where it is missing, specs fail with "Cannot find module './internal/class.js'" — add the mapping in its **own** commit before the feature: `chore(test): map .js imports for the prisma client in jest`.
12. Auth has its own recipe set (mock `HashingService`/`OtpSender`, `JwtStrategy.validate`, `RolesGuard`, the route-guard meta-test, parallel OTP, e2e on a real database) in `nest-auth-and-security` → `references/test-recipes.md`. Use it instead of re-inventing those mocks; this skill stays the general pattern. On PostgreSQL + Prisma 7, e2e needs `node --experimental-vm-modules` (the client loads its query compiler with a dynamic `import()`); that file says how.

## Good example

```ts
// src/teams/teams.service.spec.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TeamsService } from './teams.service';

describe('TeamsService.leave', () => {
  let service: TeamsService;
  let tx: { teamMember: { findUnique: jest.Mock; delete: jest.Mock } };
  let prisma: { $transaction: jest.Mock };

  beforeEach(async () => {
    tx = { teamMember: { findUnique: jest.fn(), delete: jest.fn() } };
    prisma = {
      // Interactive transaction: run the callback with the mocked tx client.
      $transaction: jest.fn((cb: (client: typeof tx) => Promise<unknown>) => cb(tx)),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [TeamsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(TeamsService);
  });

  it('removes a regular member from the team', async () => {
    tx.teamMember.findUnique.mockResolvedValue({ isLeader: false });

    await service.leave('team-1', 'user-2');

    expect(tx.teamMember.delete).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: 'team-1', userId: 'user-2' } },
    });
  });

  it('throws NotFoundException when the user is not a member', async () => {
    tx.teamMember.findUnique.mockResolvedValue(null);

    await expect(service.leave('team-1', 'user-9')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.teamMember.delete).not.toHaveBeenCalled();
  });

  it('rejects the leader leaving without transferring leadership', async () => {
    tx.teamMember.findUnique.mockResolvedValue({ isLeader: true });

    await expect(service.leave('team-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.teamMember.delete).not.toHaveBeenCalled();
  });
});
```

Jest config in `package.json` (Prisma 7 client in root `generated/`):

```json
"jest": {
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "src",
  "testRegex": ".*\\.spec\\.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "moduleNameMapper": { "^(\\.{1,2}/.*)\\.js$": "$1" },
  "testEnvironment": "node"
}
```

## Bad example

```ts
// BAD: boilerplate from `nest g`. It tests nothing, and fails DI because PrismaService is not provided.
describe('UsersService', () => {
  let service: UsersService;
  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [UsersService] }).compile();
    service = module.get<UsersService>(UsersService);
  });
  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

// BAD: `any` mocks hide wrong call shapes, and the assertion checks message text instead of the type.
const prisma: any = { team: { findUnique: jest.fn() } };
await expect(service.findOne('x')).rejects.toThrow('Team not found');
```

## Checklist before finishing

- [ ] Each changed service method has tests for its exception paths and happy path.
- [ ] Rejected paths assert that no write happened.
- [ ] Prisma is mocked through `{ provide: PrismaService, useValue }`, with no real DB and no `any`.
- [ ] No `should be defined` spec remains.
- [ ] `npm run test` passes. You ran it, not assumed it.
