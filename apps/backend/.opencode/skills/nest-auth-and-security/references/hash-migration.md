# Recipe: migrating bcrypt / `scryptSync` hashes (existing projects)

Use it when an existing project stores bcrypt hashes (KantinKlik, web-portofolio) or calls a sync `scryptSync`
`HashingService` (old nest-common template: CateringKita, Moklet, webportfolio). New projects never need it.
Verified in the scratch app: bcrypt and scrypt hashes both verify, a bcrypt hash is replaced by scrypt once.

## `scryptSync` -> async `HashingService`

The stored format (`salt:hash`, hex, 64-byte key) is the same, so old hashes keep working: replace the service file
with the nest-common 3 version (separate `refactor(common)` commit, `AGENTS.md`), then fix **every** call site.
`hash()` and `verify()` now return a Promise, and a Promise is always truthy:

```ts
if (this.hashing.verify(dto.password, user.passwordHash)) { /* ... */ }   // BAD: always true, everyone logs in
const otp = otps.find((o) => this.hashing.verify(code, o.codeHash));      // BAD: find() takes the first row (CateringKita)
await Promise.all(rows.map((r) => this.hashing.verify(code, r.codeHash))); // fine, but rule 11 says: one code, claimed first
```

Turn on the lint rules that catch these, then fix what they report:

```js
// eslint.config.mjs, in the rules block
'@typescript-eslint/no-misused-promises': 'error',
'@typescript-eslint/no-floating-promises': 'error',
```

`tsc` alone does not catch it: `if (promise)` and `find(() => promise)` compile.

## bcrypt -> scrypt (rehash on login)

Keep bcrypt only for verifying old hashes, rehash after the first successful login, delete the code when no
`passwordHash` starts with `$2`. `npm i bcryptjs` (pure JS, ships its own types). Check progress with
`SELECT count(*) FROM users WHERE password_hash LIKE '$2%'`.

```ts
// src/recipes/legacy-password.service.ts
import { Injectable } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { HashingService } from '../common/hashing/hashing.service';
import { PrismaService } from '../prisma/prisma.service';

const BCRYPT_PREFIX = /^\$2[aby]\$/;

/**
 * Temporary: verifies hashes written before the project moved to scrypt.
 * Delete it (and bcryptjs) once no passwordHash starts with $2.
 */
@Injectable()
export class LegacyPasswordService {
  constructor(
    private readonly hashing: HashingService,
    private readonly prisma: PrismaService,
  ) {}

  /** scrypt `salt:hash` and bcrypt `$2b$...` both verify. Always await it. */
  async verify(plainText: string, storedHash: string): Promise<boolean> {
    if (BCRYPT_PREFIX.test(storedHash)) return compare(plainText, storedHash);
    return this.hashing.verify(plainText, storedHash);
  }

  /** Call after a successful login: the old hash is replaced by scrypt once. */
  async rehashIfLegacy(
    userId: string,
    plainText: string,
    storedHash: string,
  ): Promise<void> {
    if (!BCRYPT_PREFIX.test(storedHash)) return;
    // Guarded by the old hash, so a parallel password change is not overwritten.
    await this.prisma.user.updateMany({
      where: { id: userId, passwordHash: storedHash },
      data: { passwordHash: await this.hashing.hash(plainText) },
    });
  }
}
```

In `AuthService.login`, use `legacy.verify(...)` instead of `hashing.verify(...)` and, after the password and status
checks pass, `await legacy.rehashIfLegacy(user.id, password, user.passwordHash)`. New hashes always come from
`HashingService.hash` (rule 9).

```ts
// src/recipes/legacy-password.service.spec.ts
import { hash as bcryptHash } from 'bcryptjs';
import { HashingService } from '../common/hashing/hashing.service';
import { PrismaService } from '../prisma/prisma.service';
import { LegacyPasswordService } from './legacy-password.service';

describe('LegacyPasswordService', () => {
  const hashing = new HashingService();
  const prisma = { user: { updateMany: jest.fn() } };
  const service = new LegacyPasswordService(
    hashing,
    prisma as unknown as PrismaService,
  );

  beforeEach(() => prisma.user.updateMany.mockReset());

  it('verifies bcrypt and scrypt hashes', async () => {
    const legacy = await bcryptHash('old pass 1', 10);
    const current = await hashing.hash('new pass 1');
    await expect(service.verify('old pass 1', legacy)).resolves.toBe(true);
    await expect(service.verify('nope', legacy)).resolves.toBe(false);
    await expect(service.verify('new pass 1', current)).resolves.toBe(true);
  });

  it('rehashes a bcrypt hash to scrypt, guarded by the old value', async () => {
    const legacy = await bcryptHash('old pass 1', 10);
    await service.rehashIfLegacy('u1', 'old pass 1', legacy);
    const [{ where, data }] = prisma.user.updateMany.mock.calls[0] as [
      { where: unknown; data: { passwordHash: string } },
    ];
    expect(where).toEqual({ id: 'u1', passwordHash: legacy });
    await expect(hashing.verify('old pass 1', data.passwordHash)).resolves.toBe(
      true,
    );
  });

  it('leaves a scrypt hash alone', async () => {
    await service.rehashIfLegacy('u1', 'x', await hashing.hash('x'));
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('shows why a missing await is fatal: a Promise is always truthy', async () => {
    const legacy = await bcryptHash('old pass 1', 10);
    // eslint rule @typescript-eslint/no-misused-promises reports exactly this.
    const found = [legacy].find(
      () => service.verify('WRONG', legacy) as unknown as boolean,
    );
    expect(found).toBe(legacy);
  });
});
```

## Checklist

- [ ] Every `hash()` / `verify()` call is awaited; `no-misused-promises` + `no-floating-promises` are on and clean.
- [ ] No `array.find` / `filter` / `if` with an async verify.
- [ ] bcrypt is used only inside `LegacyPasswordService.verify`; new hashes are scrypt.
- [ ] A follow-up task exists to delete the legacy path once no `$2` hash remains.
