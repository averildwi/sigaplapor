---
name: git-workflow
description: Use whenever you change files in a git repository. Defines when and how the agent must branch, verify, stage and commit its own work.
---

## When to use

Always, as soon as you modify files in a git repository. This skill is mandatory, not advisory.

## Rules

1. **Never work on `main` (or `development`).** Before the first edit, check the branch. If you are on `main`/`development`, create a branch:
   `feat/<topic>`, `fix/<topic>` or `chore/<topic>` (kebab-case, for example `feat/team-invitations`).
2. **Commit after each finished unit of work**, the way a developer would: one feature, one fix, one refactor. Not one giant commit at the end, and not one commit per line.
3. **Atomic**: one commit = one complete change you can describe in one sentence. Code, its DTOs, its tests and its migration belong in the same commit. Unrelated cleanups get their own commit.
4. **Message format**: Conventional Commits, English, `type(scope): description`.
   - `type`: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `style`, `ci`. Nothing else.
   - `scope`: the module or folder name (`auth`, `teams`, `common`, `prisma`). Omit it only for repo-wide changes.
   - `description`: lowercase, imperative ("add", not "added"/"adds"), no trailing period, max ~72 characters.
   - Add a body (after a blank line) only when the **why** is not obvious.
5. **Verify before every commit**. Run the scripts that exist in `package.json`:
   - always: lint and `npm run test`
   - if you touched `prisma/schema.prisma`, `tsconfig*.json`, `nest-cli.json`, `package.json` or `main.ts`: also `npx prisma generate` (when Prisma changed) and `npm run build`
   - if anything you are responsible for is red, fix it first. **Never commit red.** Never use `--no-verify`.
6. **Lint gate = the whole project.** Run `npx eslint "{src,apps,libs,test}/**/*.ts"` (no `--fix` for the gate; the default Nest `npm run lint` also runs `--fix` on the whole repo, which would reformat files outside your commit). The commit is blocked by an error in **any** file.
    - If errors sit in files you did not touch and were red before your change, do not hide them and do not fix them inside your feature commit. Tell the user once: "Pre-existing lint errors in `<files>` (not touched by this change)." Fix them in a separate `chore(<scope>)` or `refactor(<scope>)` commit when the user agrees.
    - If you edit such a file for your feature, it becomes yours: its lint errors must be fixed in that commit.
    - Never add `eslint-disable` and never weaken `eslint.config.mjs` to make the gate pass.
    - **Generator output** (files written by `nest new`, `npx @averildwi/nest-prisma`, `npx @averildwi/nest-common`, `npx @averildwi/nest-skills`, `prisma init`) is committed **as generated**, one commit per tool, right after the tool runs, before any hand edit: `chore(prisma): set up prisma with pg adapter`, `chore(common): add nest-common scaffold`, `chore: add agent skills`. It passes the same gate; if it does not, that is a scaffold bug — report it to the user and commit as generated with the lint result in the body (`Generated code; eslint: <result>`). Do not hand-fix or reformat generator output in that commit; the fix is a separate `refactor(<scope>)` commit.
    - Build (`npm run build`) and tests have no exception at all. If they fail, find out whether your change caused it before committing; if they were already red before your change, stop and tell the user.
7. **Stage specific files**: `git add <path> <path>`. Never `git add .`, `git add -A` or `git commit -a`. Run `git status` and `git diff --staged` before committing and check that only intended files are staged.
8. **Never commit**: `.env*` (except `.env.example`), keys, tokens, credentials, `generated/`, `dist/`, `node_modules/`, `coverage/`, or local editor/OS files. If one is staged, unstage it (`git restore --staged <file>`) and make sure `.gitignore` covers it.
9. **Do only local commits.** Never `push`, `merge`, `rebase`, `reset --hard`, `commit --amend` of pushed commits, or `push --force` unless the user explicitly asks in this conversation.
10. **Report after each commit**: one line with the short hash and the subject, for example
   `Committed a1b2c3d feat(teams): add leave team endpoint`.
11. If a hook or check fails, fix the cause and create a **new** commit. Do not amend or bypass.
12. Do not change git config (user, email, hooks).

## Procedure (follow exactly)

```bash
# 0. once, before the first edit
git status
git branch --show-current            # if main/development:
git switch -c feat/<topic>

# 1. ... implement one unit of work ...

# 2. verify (whole-project lint gate, see rule 6)
npx eslint "{src,apps,libs,test}/**/*.ts"
npm run test
npm run build                        # only when rule 5 requires it

# 3. stage precisely and review
git status
git add src/teams/teams.service.ts src/teams/teams.controller.ts src/teams/dto/leave-team.dto.ts src/teams/teams.service.spec.ts
git diff --staged

# 4. commit
git commit -m "feat(teams): add leave team endpoint"

# 5. report
git log -1 --format="%h %s"
```

## Good example

```text
feat(teams): add leave team endpoint
fix(auth): check token version in jwt strategy
refactor(common): extract pagination meta into paginate helper
test(orders): cover stock restore on order rejection
chore(prisma): add index on team_members.user_id
docs(readme): document required environment variables
```

A feature with a migration, in one commit:

```bash
git add prisma/schema.prisma prisma/migrations/20261012093000_add_team_invitations/ \
        src/team-invitations/
git commit -m "feat(team-invitations): add invitation create and accept flow"
```

## Bad example

```text
update                                   # BAD: no type, no meaning
Added new feature for teams.             # BAD: no type, past tense, capitalised, trailing period
feat: lots of changes                    # BAD: not atomic, no scope
security(main): enable helmet            # BAD: "security" is not an allowed type -> fix(main): ...
feat(teams): Tambah endpoint keluar tim  # BAD: not English
```

```bash
git add .                                # BAD: stages .env, dist/, stray files
git commit -am "wip"                     # BAD: blind staging + meaningless message
git commit --no-verify -m "fix: tests"   # BAD: bypasses checks
git push --force                         # BAD: never without an explicit user request
```

## Checklist before finishing

- [ ] You are on a `feat/`, `fix/` or `chore/` branch, not `main`.
- [ ] Each logical unit is its own commit, with code, tests and migration together.
- [ ] Lint (whole project), test, and build when required passed right before each commit. Pre-existing lint errors in untouched files were reported, not hidden.
- [ ] Only intended files were staged, with no `.env`, `generated/`, `dist/` or secrets.
- [ ] Messages follow `type(scope): imperative lowercase description` in English.
- [ ] Nothing was pushed, merged or rebased without an explicit request.
- [ ] You reported each commit's hash and subject to the user.
