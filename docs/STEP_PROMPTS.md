# STEP_PROMPTS — SIGAP Lapor (repo `sigaplapor`)

Prompt templates: paste ONE prompt per step to the coding agent. Each prompt is self-contained — it tells the agent what to read, what to build, and when to stop. The IMPLEMENTATION_PLAN row is the contract; the skills are the source of truth; if a skill and the plan disagree, the skill wins and the agent reports the conflict.

Shared preamble (already baked into every prompt below, no need to re-add):

- Repo: `C:\Workspace\Competition\sigaplapor` (Turborepo monorepo, npm workspaces). Plain `npm install` only at the root; add deps with `npm install <pkg> -w apps/backend`; app deps never land in the root `package.json`.
- Never `git add .`, never push/merge/rebase, never a destructive Prisma command (`migrate reset` / `db push` on a non-empty DB needs explicit approval in the conversation). One commit = one complete change (code + DTOs + tests + migration), exactly the files listed in the plan row.
- Gate before every commit, from `apps/backend`: `npx eslint "{src,test}/**/*.ts"` (no `--fix`), `npm run test`, and `npm run build` whenever `prisma/schema.prisma`, `tsconfig*.json`, `nest-cli.json`, `package.json` or `main.ts` changed (plus `npx prisma generate` when the schema changed). e2e on the real DB: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config ./test/jest-e2e.json --runInBand`.
- Test priority inside every commit: exception paths first, then happy paths, then "the write did not happen".
- If anything in the plan row is ambiguous or a scaffold/tool fails, STOP and ask — never guess.

---

## Prompt — Step 0 (repo bootstrap + docs) — ALREADY DONE

> Status (2026-10-22): the repo exists — `f9015ab Initial commit from create-turbo` + `d229dfa chore: delete docs from apps`; the spec docs were moved into `docs/` and committed. **Nothing to do in this step.** Start at Step 1.
>
> (Kept for history: the bootstrap is `npx create-turbo@latest sigaplapor`; the frontend app `apps/web` is create-turbo's Next.js app and is kept — do not scaffold a second one.)

## Prompt — Step 1 (scaffolds + skills + AGENTS.md rules)

> Work in `C:\Workspace\Competition\sigaplapor` (branch `main`). The repo already exists (create-turbo) with `apps/web` — keep it, do NOT scaffold a second Next app.
>
> 1. Read `docs/IMPLEMENTATION_PLAN.md` (Step 1) and the git-workflow skill (until Step 1 installs the skills here, read it from `C:\Workspace\Competition\sigap\apps\backend\.opencode\skills\git-workflow\SKILL.md`). The user runs all commands; you verify and commit.
> 2. Instruct the user to run, from `sigaplapor/apps`: `nest new backend --strict --skip-git --skip-install --package-manager npm`; then one root `npm install`; then from `sigaplapor/apps/backend`: `npx @averildwi/nest-prisma` → root `npm install`; `npx @averildwi/nest-common` → root `npm install`; `npx @averildwi/nest-skills@latest --agent opencode`; `npx prisma generate`. (nest-skills preflight requires `@nestjs/core` in the cwd `package.json` — it must run inside `apps/backend`.)
> 3. Verify each tool's output: `prisma/` + `prisma7.config.ts` + `src/prisma/`; `src/common/` (guards, filters, interceptors, `PaginationDto`, `HashingService`, `AuthUser` placeholder), `.env.example`, `app.module.ts` + `main.ts` wiring; `.opencode/skills/**` + `apps/backend/AGENTS.md` + `.nest-skills.json`; a single root lockfile with no nested `node_modules`.
> 4. Toolchain check: the root pins **typescript 7.0.2** while the local Node is v22.17.1 (`engines.node >=24` → warning only). If the backend's lint/test/build misbehaves under TS 7, align the root + `apps/backend` to `typescript@^5.9.3` as its own commit (this exact fix was needed in the sigap repo) and report it.
> 5. Run the gate from `apps/backend` (lint, test, build). Scaffold commits must pass as-is; if a scaffold is red, report it and commit as generated with the lint result in the body.
> 6. Commit one commit per tool exactly as the plan's Step 1 table (including `chore(turbo): add the test task` — the create-turbo `turbo.json` has no `test` task), then append the monorepo npm-workspaces rules block (from the plan's layout section) plus a pointer to `apps/backend/AGENTS.md` to the root `AGENTS.md` and commit it.
> Stop and ask if: any installer preflight fails, the generated layout differs from the sigap reference (`C:\Workspace\Competition\sigap\apps\backend`), or the TS-version fix would touch `apps/web` (ask before editing the frontend's toolchain).

## Prompt — Step 2 (config, env schema, throttle tiers, health)

> Work in `C:\Workspace\Competition\sigaplapor\apps\backend` (branch `feat/config`, cut from `main`).
>
> 1. Read `docs/API_SPEC.md` (env table + module table + health row), `docs/IMPLEMENTATION_PLAN.md` (Step 2), and the skills `nest-validation-and-config`, `nest-response-and-errors`, `nest-architecture` (full SKILL.md each).
> 2. Commit 1 `feat(config): add the env schema and throttle tiers`: `src/config/env.schema.ts` with every key of the API_SPEC env table — base (DATABASE_URL, PORT, NODE_ENV, FRONTEND_URL, JWT_SECRET, JWT_EXPIRES_IN, TRUST_PROXY_HOPS), `OTP_SENDER`, `OTP_TTL_MINUTES`, `OTP_RESEND_COOLDOWN_SECONDS`, `MAX_OTP_ATTEMPTS`, `RESEND_API_KEY`, `MAIL_FROM`, `THROTTLE_*`, `CLOUDINARY_*` ×4 (`CLOUDINARY_FOLDER` uses `.default('sigap-lapor')`, not required), `MALANG_*` ×4 as number placeholders with `.default()` (owner decision: verified visually later), `ESCALATION_CRON_MINUTES` (15), `ESCALATION_STEP_2_DAYS` (2). Update `.env.example` to list every key. `src/config/throttle.config.ts` + specs implementing the tiers `default`/`auth`/`sendCode` (100/5/3) via `@ThrottleTier` metadata + `skipIf`. Tests: env boot-fail cases (required keys missing; `OTP_SENDER=resend` without keys refuses production).
> 3. Commit 2 `feat(health): wire main and add the health check`: `src/main.ts` in the exact order of `nest-architecture` rule 10, `ThrottlerModule.forRootAsync` with the tiers, `APP_GUARD` ThrottlerGuard, `src/health/**` (`SELECT 1` → 200 `{status:'ok'}` else 503). Tests: DB error → 503 first, happy path, no secrets in the response.
> 4. Gate + build (main.ts and package.json touched). Commit; report hashes and test output.

## Prompt — Step 3 (prisma schema, migration, seed)

> Work in `C:\Workspace\Competition\sigaplapor\apps\backend` (branch `feat/prisma-schema`, cut from `main`).
>
> 1. Read `docs/DATA_MODEL.md` in full, plus `docs/IMPLEMENTATION_PLAN.md` (Step 3) and the skills `nest-prisma` and `nest-auth-and-security` (for the `OtpCode`/User shape the auth module needs).
> 2. Ask the user for `DATABASE_URL` (local/Railway Postgres) and write it into `.env` (never committed) before running the migration.
> 3. One commit `feat(prisma): add the initial schema, migration and seed`: `prisma/schema.prisma` exactly as DATA_MODEL.md (all 12 models: User, NikProfile, Agency, Complaint, ComplaintPhoto, ComplaintUp, ComplaintTimeline, Notification, AccountBlock, DailyComplaintCounter, UploadTicket, OtpCode — uuid ids, `@@map`, explicit `onDelete`, both timestamps except pure pivots, per-stage escalation counters, `@@id([userId, day])` on DailyComplaintCounter); run `npx prisma migrate dev --name init` (if Prisma ever asks to reset, STOP and ask); `prisma/seed.ts` idempotent, agencies list + staff accounts from seed-only env (never PELAPOR), passwords via `HashingService`.
> 4. Verify `npx prisma generate` + gate + build. Commit; report hash.
> Stop and ask if: the DB is non-empty and Prisma suggests a reset, or any model in DATA_MODEL cannot be expressed as written.

## Prompt — Step 4 (auth module)

> Work in `C:\Workspace\Competition\sigaplapor\apps\backend` (branch `feat/auth`, cut from `main`).
>
> 1. Read `docs/PRD.md` (BR-101..107), `docs/API_SPEC.md` (auth module + rule-21 endpoint set), `docs/IMPLEMENTATION_PLAN.md` (Step 4), and the skills `nest-auth-and-security` (FULL — rules 1–24 + `references/`), `nest-testing` (or the testing rules in the skills' index), `nest-response-and-errors`.
> 2. Install deps from the root: `npm install @nestjs/jwt@^11 passport-jwt passport -w apps/backend` and `npm install -D @types/passport-jwt -w apps/backend` (never `@nestjs/jwt` 12 under Jest/CJS).
> 3. Implement the commits exactly in the plan's Step 4 table order (auth-user typing → mail port + adapters → otp service → jwt strategy → register/verify/resend → login/forgot/reset → change-password/logout-all → meta-test + e2e). Copy the skill's reference implementations, do not rewrite them. Key behaviors: `{ sub, email, tv }` payload, no role in the token; `validate()` checks missing user/`isActive`/`emailVerifiedAt`/`tokenVersion`; register + first code in one `$transaction`; register 409 is the documented enumeration exception; login: identical `401 'Invalid credentials'`, then 403 disabled → 403 unverified (password first); resend-otp 3/min + DB cooldown; reset consumes the code and bumps `tokenVersion` in the same transaction; logout-all +1 `tokenVersion`.
> 4. The meta-test (`test/route-guards.e2e-spec.ts`) is taken unchanged from the skill's test recipes. e2e: token in body (never `token`), identical 401 bodies, old token after reset → 401, 429 beyond the auth tiers, bad `:id` → 400, extra body field → 400.
> 5. Gate + e2e (real DB) + build for every commit. Auth must be fully green before any feature module — do not start Step 5 in the same session.

## Prompt — Step 5 (profiles / NIK verification)

> Work in `C:\Workspace\Competition\sigaplapor\apps\backend` (branch `feat/profiles`, cut from a green `main` with Steps 2–4 merged).
>
> 1. Read `docs/PRD.md` (F-PROFILES-1/2, BR-107, BR-111, BR-121), `docs/API_SPEC.md` (`POST /api/profiles/identity` detail), `docs/IMPLEMENTATION_PLAN.md` (Step 5), and skills `nest-prisma`, `nest-architecture` (rules 9–12), `nest-validation-and-config`.
> 2. Commit 1: pure helpers `src/profiles/nik.helper.ts` (hash + mask) and `src/profiles/dummy-nik.data.ts` with specs. The plain NIK never leaves the service; store only `nikHash`.
> 3. Commit 2: `POST /api/profiles/identity` — `@Roles('PELAPOR')` + `@ApiBearerAuth('access-token')`, prefix `[PELAPOR]` (prefix must equal the roles — the route-guard meta-test enforces it). One NIK per account: `nikHash @unique` → second bind 409 `NIK is already bound`; unknown NIK → 400; staff accounts → 403 from the guard. Idempotent replay: conditional `updateMany` on `{ id: me.id, nikVerifiedAt: null }`; lost race = already verified → return the current profile with 200 (first verify 201 — both statuses stated in the module row and the endpoint detail).
> 4. Tests: unknown NIK 400 with no write; second bind 409; replay 200; hash stored, plain NIK absent from every response. Gate + test + build; commit each row; report hashes.

## Prompt — Step 6 (notifications: templates, service, gateway)

> Work in `C:\Workspace\Competition\sigaplapor\apps\backend` (branch `feat/notifications`).
>
> 1. Read `docs/PRD.md` (§4.6 type→recipients table, F-NOTIFICATIONS-1..4, BR-131), `docs/API_SPEC.md` (notifications module + realtime section), `docs/IMPLEMENTATION_PLAN.md` (Step 6), and skills `nest-auth-and-security` `references/websocket-auth.md` + `nest-architecture` + `nest-response-and-errors`.
> 2. Commit 1: `notification-templates.ts` — the PRD's type→recipients table (COMPLAINT_NEW, COMPLAINT_FORWARDED, AGENCY_ASSIGNED, COMPLAINT_IN_PROGRESS, COMPLAINT_DONE, COMPLAINT_REJECTED, COMPLAINT_LATE_ADMIN, COMPLAINT_LATE_LEADERSHIP, ACCOUNT_DEACTIVATED) as a pure mapping module; Indonesian title/body helpers, `{title}` cut at 100; no service hardcodes text. Spec the purity.
> 3. Commit 2: `frontend-cors-io.adapter.ts` (path from the websocket-auth recipe) + `realtime.gateway.ts`: Socket.IO path `/realtime`, token ONLY via `handshake.auth.token` → `JwtStrategy.validate`, `disconnect(true)` on failure; rooms `user:<id>`; emit `notification:new` only after the DB write commits (BR-131). Wire into `main.ts`.
> 4. Commit 3: list (`unreadOnly?` via `@ToBoolean()` + `@IsBoolean()`), unread-count, read, read-all — every query filtered by `userId = me`; a foreign `:id` → 404; `Paginated` marker; `$transaction([findMany, count])` for the list.
> 5. Tests first: template purity, gateway handshake (invalid token → disconnect, strategy.validate called), ownership 404s, read-all no-write on foreign rows. Gate + build (main.ts touched); report hashes.

## Prompt — Step 7 (uploads: Cloudinary signed tickets)

> Work in `C:\Workspace\Competition\sigaplapor\apps\backend` (branch `feat/uploads`).
>
> 1. Read `docs/PRD.md` (F-COMPLAINTS-15, BR-116, BR-136), `docs/API_SPEC.md` (`POST /api/uploads/tickets` + photo claim rules), `docs/IMPLEMENTATION_PLAN.md` (Step 7), and skills `nest-prisma` (short transactions), `nest-auth-and-security` (rule 12 service-gating), `nest-validation-and-config`.
> 2. Commit 1: `src/common/cloudinary/` port + signed-ticket service (`publicId`, `url`, `apiKey`, `timestamp`, `signature`, `folder`) and an Admin-API asset re-check method. Spec the signature shape with a mocked `fetch`.
> 3. Commit 2: `POST /api/uploads/tickets` `[AUTH]` (all roles) — creates a one-time ticket row (`publicId @unique`, purpose BEFORE/AFTER). Claim helpers implement BR-136 exactly: wrong purpose → 400 `Upload ticket purpose mismatch`; already claimed → 400 `Upload ticket is already used`; unknown or older than 24 h → 400 `Upload ticket invalid`. The asset re-check runs BEFORE the DB transaction; inside the transaction: claim (`updateMany` on `claimedById`) → photo row.
> 4. Tests: two parallel claims → one 201 + loser 400; purpose mismatch; expired; asset-check failure leaves the ticket unconsumed. Gate; report hashes.

## Prompt — Step 8 (complaints core: create + daily claim, public reads, detail, up)

> Work in `C:\Workspace\Competition\sigaplapor\apps\backend` (branch `feat/complaints-core`).
>
> 1. Read `docs/PRD.md` (F-COMPLAINTS-1..6, BR-111..119, BR-121, BR-126, EC-3), `docs/API_SPEC.md` (complaints module rows + POST /complaints + GET endpoints detail), `docs/IMPLEMENTATION_PLAN.md` (Step 8), and skills `nest-prisma` (rules 8–12, 14), `nest-architecture`, `nest-response-and-errors`, `nest-validation-and-config`.
> 2. Commit 1: pure helpers — `mask-name.helper.ts` (BR-117: computed once at create, stored, never recomputed) and `geofence.helper.ts` (bounding box from `MALANG_*` env, BR-113) with specs.
> 3. Commit 2: `POST /api/complaints` `[PELAPOR]`. ONE interactive `$transaction` in the owner-approved order: geofence + occurredAt pre-checks → create-first daily claim (`create({userId, day, count:1})`; on P2002 → conditional `updateMany` where `count < 3`, 0 affected → 400 `Daily complaint limit reached`) → ticket claims → complaint + BEFORE photo rows → timeline STATUS_CHANGE → `COMPLAINT_NEW` to CITY_ADMINs. NIK gate → 403 `Verify your NIK first`; verifyDueAt = now + 3 days. Whitelist response shape (BR-121), 201.
> 4. Commit 3: public list + map + mine. Forced public status filter (BR-118); a non-public `status` query → 400 `Status is not public`; `$transaction([findMany, count])` with the identical `where`; flat whitelist rows; map `limit @Max(1000)`; mine adds `rejectReason` for own rows.
> 5. Commit 4: detail + up. Per-caller detail shapes exactly as the API_SPEC bullets (PIMPINAN = public masked, never the real name; owner adds `rejectReason` + full timeline; owning AGENCY adds work fields, never `rejectReason`; CITY_ADMIN adds real name + `nikVerified`); PENDING/REJECTED → 404 for all non-owner/non-CITY_ADMIN callers (BR-118/BR-124); up = idempotent via unique `@@id` + P2002 → re-read → same count.
> 6. Tests (exception first): 4th submit incl. 4 parallel → 400 with no complaint row; WIB-rollover first submit succeeds (00.00 WIB = 17.00 UTC previous day); maskedName stored; geofence 400; future occurredAt 400; status-not-public 400; PENDING 404 anonymous; up double-tap same count. Gate + test + build; report hashes.

## Prompt — Step 9 (complaints staff flows)

> Work in `C:\Workspace\Competition\sigaplapor\apps\backend` (branch `feat/complaints-staff`).
>
> 1. Read `docs/PRD.md` (F-COMPLAINTS-7..11, 15; BR-120, BR-122..124, BR-125, BR-128, BR-129, BR-136), `docs/API_SPEC.md` (all staff endpoint details + photos rules), `docs/IMPLEMENTATION_PLAN.md` (Step 9), and skills `nest-prisma` (conditional updateMany, transaction flags), `nest-architecture`.
> 2. Implement the four commits in the plan's Step 9 table order. Every transition uses a conditional `updateMany` on the source status (and ownership columns) — count 0 → the BR-123 disambiguation: row missing → 404, wrong state → 400 `Invalid status change`. Forward also sets `forwardedAt` + `handleDueAt` (+5d) + timeline ASSIGNMENT + notifications (reporter + agency). Reassign only from FORWARDED. Mark-duplicate: self-ref 400, chain 400, idempotent same-main 200, different-main 400, conditional on `duplicateOfId: null`, no notifications. Agency start/notes/done: ownership + status guard; other-agency row → 404; notes → timeline PROGRESS_NOTE only, 201; done asserts ≥1 AFTER photo → 400 `After photo required`.
> 3. Photos endpoint: kind-based branches (BEFORE: reporter + PENDING; AFTER: owning agency + IN_PROGRESS; staff → 403 `Staff accounts cannot attach photos`); asset re-check BEFORE the transaction; claim + photo row inside it; max 3 per kind → 400; double-attach `publicId` → 409 via the Prisma filter.
> 4. Tests (exception first): lost race → 400 with no write for every transition (double-tap start/done, two-admin forward/reject); forward to unknown agency 404 / inactive 400; done without AFTER photo 400 no-write; BEFORE on FORWARDED 400; AFTER by reporter 403; third BEFORE photo 400; cross-agency start 404; duplicate races (idempotent vs 400). Gate + test; report hashes.

## Prompt — Step 10 (dashboards + escalation cron)

> Work in `C:\Workspace\Competition\sigaplapor\apps\backend` (branch `feat/dashboards`).
>
> 1. Read `docs/PRD.md` (F-COMPLAINTS-13/14, BR-125, BR-127, BR-128), `docs/API_SPEC.md` (the three dashboard endpoints + leadership buckets), `docs/IMPLEMENTATION_PLAN.md` (Step 10), and skills `nest-prisma` (aggregation reads), `nest-response-and-errors`.
> 2. Commit 1: the three dashboards. Public: no PII at all. Admin: pending queue count, late count, lateByAgency (id, name, lateCount, avgHandlingDays), avg verification/handling hours, escalatedCount. Leadership: escalated list with per-stage `levels {verification, handling}`, `lateByAgency`, `lateByCategory`, `milestoneCounts {one, two}`, `monthlyVolume` (12) — read-only, no reporter identity anywhere. Batched reads in one transaction; duplicates excluded only from `totalUniqueProblems` (BR-125).
> 3. Commit 2: `escalation.service.ts` — cron every `ESCALATION_CRON_MINUTES`. Per-(stage, milestone) claims via conditional `updateMany` on the stage's level (`level < milestone`): cron restart cannot double-notify. Milestone 2 anchored at stageDueAt + `ESCALATION_STEP_2_DAYS` days. A closed stage stops claiming (verification milestone 2 muted once the complaint leaves PENDING). Every claim writes a timeline ESCALATION entry and the §6.1 notification.
> 4. Tests: late predicate at boundaries (BR-127); second cron run → zero new notifications; both stages fire independently; mute-after-close. Gate + test; report hashes.

## Prompt — Step 11 (moderation + agencies + final pass)

> Work in `C:\Workspace\Competition\sigaplapor\apps\backend` (branch `feat/moderation`, then `chore/final-pass`).
>
> 1. Read `docs/PRD.md` (F-USERS-1/2, F-AGENCIES-1, BR-130), `docs/API_SPEC.md` (users/agencies modules), `docs/IMPLEMENTATION_PLAN.md` (Step 11), and skills `nest-prisma`, `nest-testing`.
> 2. Commit 1: staff users module `[CITY_ADMIN]` — list (search name/email, `isActive?` via `@ToBoolean()`, role filter, Paginated, no secrets in the shape), deactivate (`isActive:false` + `tokenVersion+1` + `AccountBlock` row in one `$transaction`; staff target → 403; reason ≥ 5 chars), blocks history list.
> 3. Commit 2: agencies module `[AUTH]` — paginated list + detail, public-safe shape (id, name, isActive); data comes from the Step 3 seed.
> 4. Commit 3 (`chore/final-pass`): the full e2e journey `test/sigap-lapor.e2e-spec.ts` — register → OTP → NIK verify → submit (incl. daily limit) → CITY_ADMIN forward → AGENCY photos/start/notes/done → escalation milestones → dashboards → moderation; plus the PIMPINAN visibility check (public states only, masked) and a BR-121 payload leak scan (no email/hash/real name in public payloads). README updates (env table, Railway root dir `apps/backend`, seed instructions, geofence placeholder note).
> 5. Whole-workspace verification at the root: `npx turbo run lint test build` green; re-count endpoints against the API_SPEC module tables and report the count. Commit; report hashes.

---

## How to run the prompts

1. Copy one prompt block per step. Step 0 is already done — start at **Step 1**, with the user present (scaffolds are user-run).
2. After each step, ask the agent for: the commit hashes, the gate output (lint/test/build), and any conflicts it hit between the plan and a skill.
3. Update the checklist in `docs/IMPLEMENTATION_PLAN.md` (todo → done) after each verified step.
4. If a step ends with uncommitted leftovers, the agent must say so — never commit unrelated files.
