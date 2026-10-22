# IMPLEMENTATION_PLAN: SIGAP Lapor (new repo `sigaplapor`, Turborepo monorepo)

Source: `docs/PRD.md` (approved), `docs/DATA_MODEL.md`, `docs/API_SPEC.md`, `docs/SPEC_AUDIT.md` (READY, third cycle — only 1 cosmetic minor, already fixed), and the 7 skills (`apps/backend/.opencode/skills/`, installed by Step 1; until then the sigap copy is the reference). This plan writes no code.

## Repo decision (owner, 2026-10-22)

| # | Decision |
|---|---|
| 1 | **New standalone repo** `sigaplapor` — NOT inside the existing `sigap` monorepo (that one carries the reports app on branch `feat/reports`). |
| 2 | Full monorepo from day one: `apps/backend` (NestJS) + `apps/web` (Next.js 16, create-turbo's app, kept), **Turborepo latest via `create-turbo`** (owner: "wajib turborepo latest"). npm workspaces; no shared runtime `packages/` (frontend never imports backend internals). |
| 3 | Scaffold order mirrors sigap: `nest new` → `@averildwi/nest-prisma` → `@averildwi/nest-common` → `@averildwi/nest-skills --agent opencode` → `prisma generate`; one commit per tool, committed as generated (git-workflow rule 6). |
| 4 | uuid + PostgreSQL (as decided in the PRD/DATA_MODEL; `mode: 'insensitive'` is valid). |
| 5 | Branching: scaffold commits land directly on `main`; features branch as `feat/<module>`. One commit = one complete change (code + DTOs + tests + migration). Never `git add .`, never push/merge/rebase, no destructive Prisma command. |

Docs hand-off (done, 2026-10-22): the spec set (PRD, DATA_MODEL, API_SPEC, SPEC_AUDIT, this plan, STEP_PROMPTS) was written under `sigap/docs/lapor/` and **moved** into this repo's `docs/` — it is the source of truth from here. `sigap` keeps no copy (the folder was removed; the sigap repo still holds the older reports-app docs, unrelated to Lapor).

## Monorepo layout

```
sigaplapor/                     repo root (git, create-turbo)
├─ apps/
│  ├─ backend/        NestJS API (every step below)
│  │  ├─ .opencode/skills/     agent skills (`nest-skills --agent opencode`, run inside apps/backend)
│  │  └─ AGENTS.md             skills index
│  └─ web/            Next.js 16 + React 19 (create-turbo's app, kept as the frontend)
├─ packages/          create-turbo defaults (@repo/eslint-config, @repo/typescript-config, @repo/ui)
├─ docs/              PRD, DATA_MODEL, API_SPEC, SPEC_AUDIT, IMPLEMENTATION_PLAN, STEP_PROMPTS
├─ AGENTS.md          (turbo-managed block + monorepo npm rules appended in Step 1)
├─ turbo.json, package.json (npm workspaces)
```

Conventions:
- Shell commands run with `cwd = sigaplapor/apps/backend` unless marked otherwise (root / turbo commands).
- Monorepo npm rules (written into root `AGENTS.md` in Step 1): plain `npm install`/`npm ci` **only at the root**; add deps with `npm install <pkg> -w apps/backend` (or from inside the app folder — npm resolves the workspace root); app deps never land in the root `package.json`; run workspace scripts via `npx turbo run <task> --filter=backend` or `-w apps/backend`; after every scaffold that edits `package.json`, run one `npm install` at the root so the lockfile stays single.
- Verification before every commit (git-workflow rules 5–6), from `apps/backend`: `npx eslint "{src,test}/**/*.ts"`, `npm run test`, and `npm run build` whenever `prisma/schema.prisma`, `tsconfig*.json`, `nest-cli.json`, `package.json` or `main.ts` changed (plus `npx prisma generate` when the schema changed). e2e on the real DB: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config ./test/jest-e2e.json --runInBand`.
- Every step below states: branch, commits (one per row), files, F-IDs/BRs, tests (exception paths first, then happy path, then "the write did not happen"), and open risks.

---

## Step 0 — Repo bootstrap + docs (bootstrap DONE, docs committed with this file)

**Branch:** `main` (scaffold commits land here; features branch from it).

| Commit | Files | Delivers |
|---|---|---|
| `chore(repo): bootstrap the turborepo monorepo` | **done** — `f9015ab Initial commit from create-turbo` + `d229dfa chore: delete docs from apps`: root `package.json` (workspaces apps/* + packages/*), `turbo.json` (build/lint/check-types/dev), `.gitignore`, `packages/*`, `apps/web` (Next 16) | the workspace contract |
| `docs: add the SIGAP Lapor spec docs` | `docs/PRD.md`, `docs/DATA_MODEL.md`, `docs/API_SPEC.md`, `docs/SPEC_AUDIT.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/STEP_PROMPTS.md` (moved from `sigap/docs/lapor/`) | the approved spec set the rest of the plan implements |

- Live repo state (2026-10-22): root `package.json` — turbo `^2.11.10`, typescript `7.0.2`, `engines.node >=24`, `devEngines.packageManager npm@11.20.0`; local toolchain is Node **v22.17.1** + npm 11.20.0 (Node below the declared engine → npm warns, it works, but upgrade to Node 24 LTS when convenient). `apps/web` = Next.js 16.3.8 + React 19.2.8 + TS 7.0.2 and is **kept** as the frontend (no second `create-next-app`). `turbo.json` has no `test` task yet — Step 1 adds it.
- The owner runs the app scaffolds (rule 24: scaffolds are user-run); the agent verifies each output, runs the gate, and commits one commit per tool.
- Verify: `npx turbo --version` at root; `git status` clean after each commit.
- Risks: create-turbo's example `docs` app was already removed (`d229dfa`); `apps/web` still carries the create-turbo demo page — replaced by the real UI in the frontend plan, not in this one.

## Step 1 — App scaffolds + skills (user runs, agent commits)

**Branch:** `main`.

```powershell
# from sigaplapor/apps  (apps/web already exists — keep it, do NOT scaffold a second Next app)
nest new backend --strict --skip-git --skip-install --package-manager npm

# from sigaplapor
npm install

# from sigaplapor/apps/backend, root npm install after each (they edit package.json)
npx @averildwi/nest-prisma
npx @averildwi/nest-common
npx @averildwi/nest-skills@latest --agent opencode
npx prisma generate
```

| Commit | Files |
|---|---|
| `chore(repo): add the backend app` | `apps/backend` as generated by `nest new` (`apps/web` is not touched in this plan) |
| `chore(prisma): set up prisma with pg adapter` | `prisma/`, `prisma7.config.ts`, `src/prisma/`, `generated/` ignored — as generated |
| `chore(common): add nest-common scaffold` | `src/common/` (guards, filters, interceptors, `PaginationDto`, `HashingService`, `AuthUser` placeholder), `.env.example`, `app.module.ts` + `main.ts` wiring — as generated |
| `chore(backend): add agent skills` | `apps/backend/.opencode/skills/**` + `apps/backend/AGENTS.md` + `.nest-skills.json` (run from `apps/backend` — its preflight needs `@nestjs/core` in the cwd `package.json`) |
| `chore(turbo): add the test task` | root `turbo.json` — add `test` (`dependsOn: ["^test"]`) so `npx turbo run test` covers the backend; the create-turbo template has no `test` task |
| `docs(repo): document the monorepo npm workspace rules` | append the npm-workspaces rules block + a pointer to `apps/backend/AGENTS.md` to root `AGENTS.md` |

- Delivers: skill rule 24 preflight (`src/common/` + `src/prisma/` exist).
- Verify: gate from `apps/backend`; scaffold commits must pass as-is, else commit as generated with the lint result in the body.
- Risks: `nest new` pins Nest 11 — keep `@nestjs/jwt@^11` in Step 3; keep TypeScript aligned to the sigap fix (`^5.9.3` in root + apps if the hoisted tooling demands it).

## Step 2 — Project config, env schema, throttle tiers, health

**Branch:** `feat/config`.

| Commit | Files | Delivers |
|---|---|---|
| `feat(config): add the env schema and throttle tiers` | `src/config/env.schema.ts`, `.env.example`, `src/config/throttle.config.ts` + specs | every env key of API_SPEC's env table (base, `OTP_*`, `RESEND_API_KEY`, `MAIL_FROM`, `THROTTLE_*`, `CLOUDINARY_*` ×4, `MALANG_*` ×4 with placeholder `.default()` values — owner decision: verify visually on a Leaflet plot, `ESCALATION_CRON_MINUTES=15`, `ESCALATION_STEP_2_DAYS=2`); throttle tiers `default`/`auth`/`sendCode` (100/5/3) via `@ThrottleTier` + `skipIf` |
| `feat(health): wire main and add the health check` | `src/main.ts`, `src/app.module.ts`, `src/health/**` + spec | main.ts order per nest-architecture rule 10 (trust proxy, `api` prefix, CORS from `FRONTEND_URL`, pipes, interceptors, filters, Swagger), ThrottlerModule tiers, `APP_GUARD` ThrottlerGuard; F-HEALTH-1 / BR-135 (`SELECT 1` → 200 else 503) |

- Tests: env boot-fail tests (required keys, `OTP_SENDER=resend` without keys refuses production); health — DB error → 503 first, happy path, no secrets in the response.
- Verify: gate + build (`main.ts`, `package.json` touched).

## Step 3 — Prisma schema, migration, seed

**Branch:** `feat/prisma-schema`.

| Commit | Files | Delivers |
|---|---|---|
| `feat(prisma): add the initial schema, migration and seed` | `prisma/schema.prisma` (the full DATA_MODEL schema: `User`, `NikProfile`, `Agency`, `Complaint`, `ComplaintPhoto`, `ComplaintUp`, `ComplaintTimeline`, `Notification`, `AccountBlock`, `DailyComplaintCounter`, `UploadTicket`, `OtpCode` — per skill auth needs), `prisma/migrations/<ts>_init/migration.sql`, `prisma/seed.ts` | DATA_MODEL.md as-is (uuid, `@@map`, explicit `onDelete`, both timestamps everywhere except pure pivots, per-stage escalation counters, `DailyComplaintCounter @@id([userId, day])`); seed: agencies list + staff accounts from seed-only env (never PELAPOR), idempotent |

- Tests: none by rule (seed verified by running); build + `npx prisma generate` as the gate.
- Risks/decisions: **needs your env** — set `DATABASE_URL` (local/Railway Postgres) before `migrate dev`. If Prisma ever asks to reset, stop and ask (rule 15). Deploy later: `npx prisma migrate deploy` + `npx prisma db seed` on Railway.

## Step 4 — Auth module (copied from the skill reference, not rewritten)

**Branch:** `feat/auth`.

| Commit | Files | Delivers |
|---|---|---|
| `refactor(common): type auth-user against the prisma role enum` | `src/common/types/auth-user.ts` | `RoleName = Role` (PELAPOR/CITY_ADMIN/AGENCY/PIMPINAN), `UserId = string`, `JwtPayload { sub, email, tv }` |
| `feat(common): add the otp mail port and adapters` | `src/common/mail/otp-sender.ts`, `resend-otp-sender.ts`, `console-otp-sender.ts`, `mail.module.ts` | skill rule 23 port (`OTP_SENDER` token, `fetch` Resend, console refuses production); BR-104 infrastructure |
| `feat(auth): add the otp service` | `src/auth/otp/otp.service.ts` + spec | atomic attempt claim, single consume, DB cooldown, purpose-scoped (BR-104) |
| `feat(auth): add the jwt strategy` | `src/auth/strategies/jwt.strategy.ts` + spec | `{ sub, email, tv }`; `validate()` re-loads user, checks missing/`isActive`/`emailVerifiedAt`/`tokenVersion` |
| `feat(auth): add register, verification and resend` | DTOs + service + controller + spec | F-AUTH-1/2/3, BR-101/102/104; register + first code in one `$transaction`; register 409 is the documented enumeration exception; resend-otp at 3/min + DB cooldown |
| `feat(auth): add login, forgot and reset` | DTOs + service/controller additions + spec | F-AUTH-4/5/6, BR-103 (identical `401 'Invalid credentials'`, status checks after password: 401 → 403 disabled → 403 unverified), reset bumps `tokenVersion` in the consuming transaction |
| `feat(auth): add change-password and logout-all` | service/controller additions + spec | BR-105 (fresh token returned; logout-all +1 `tokenVersion`) |
| `test(auth): add the route-guard meta-test and auth e2e` | `test/route-guards.e2e-spec.ts`, `test/auth.e2e-spec.ts` | meta-test from test-recipes unchanged; e2e: token in body, identical 401s, old token after reset → 401, 429 on the auth tiers, bad `:id` → 400, extra field → 400 |

- Test priority per commit: exception paths → happy paths → "the write did not happen".
- Verify: gate + e2e (real DB) + build (`package.json` gains `@nestjs/jwt@^11 passport-jwt passport`, `@types/passport-jwt` dev).
- Risks: `JWT_SECRET` (min 32) + Resend key in local `.env` for e2e; `OTP_SENDER=console` locally. **Auth must be green before any feature.**

## Step 5 — Profiles (NIK verification, dummy dataset)

**Branch:** `feat/profiles`.

| Commit | Files | Delivers |
|---|---|---|
| `feat(profiles): add the nik helper and dummy dataset` | `src/profiles/nik.helper.ts` (hash + mask helpers), `src/profiles/dummy-nik.data.ts` + specs | pure helpers; NIK hashed at rest, plain NIK never leaves the service (BR-107/BR-121) |
| `feat(profiles): add identity verification` | `dto/complete-identity.dto.ts`, `profiles.service.ts`, `profiles.controller.ts`, `profiles.module.ts`, spec | F-PROFILES-1, `[PELAPOR]` + `@Roles('PELAPOR')` (audit fix: prefix = roles); one NIK per account (`@unique` on `nikHash` → 409 `NIK is already bound`); unknown NIK → 400; conditional `updateMany` on `{ id, nikVerifiedAt: null }` so a lost race is an idempotent replay (201 first verify, 200 replay — stated in the module row); staff accounts get 403 from the guard |

- Tests: unknown NIK 400 no-write; second bind 409; replay 200; hash present, plain NIK absent from any response.

## Step 6 — Notifications (templates, service, gateway) — before complaints

**Branch:** `feat/notifications`.

| Commit | Files | Delivers |
|---|---|---|
| `feat(notifications): add the templates and the service` | `src/notifications/notification-templates.ts` + spec, `notifications.service.ts` + spec, `notifications.module.ts` | the PRD §6.1 type→recipients table (COMPLAINT_NEW, COMPLAINT_FORWARDED, AGENCY_ASSIGNED, COMPLAINT_IN_PROGRESS, COMPLAINT_DONE, COMPLAINT_REJECTED, COMPLAINT_LATE_ADMIN, COMPLAINT_LATE_LEADERSHIP, ACCOUNT_DEACTIVATED); pure Indonesian text helpers, `{title}` cut at 100 |
| `feat(realtime): add the socket gateway and cors adapter` | `src/common/frontend-cors-io.adapter.ts`, `src/notifications/realtime.gateway.ts` + spec, `main.ts` wiring | F-NOTIFICATIONS-4: Socket.IO path `/realtime`, token only via `handshake.auth.token` → `JwtStrategy.validate`, `disconnect(true)` on failure; rooms `user:<id>`; emit only after the DB write commits (BR-131) |
| `feat(notifications): add list, count, read and read-all` | `dto/query-notifications.dto.ts` (`unreadOnly?` via `@ToBoolean()`), service/controller additions + spec | F-NOTIFICATIONS-1/2/3; every query filtered by `userId = me`; foreign `:id` → 404 |

- Tests: template purity first; gateway handshake (invalid token → disconnect); ownership 404s; read-all no-write on foreign rows.
- Verify: gate + test + build (`main.ts` touched).

## Step 7 — Uploads (Cloudinary signed tickets)

**Branch:** `feat/uploads`.

| Commit | Files | Delivers |
|---|---|---|
| `feat(common): add the cloudinary port and signed-ticket service` | `src/common/cloudinary/cloudinary.port.ts`, `cloudinary.service.ts` + spec | signature generation (`publicId`, `url`, `apiKey`, `timestamp`, `signature`, `folder`), Admin-API asset re-check method; mime/size hints for the client |
| `feat(uploads): add the ticket endpoint` | `src/uploads/dto/create-upload-ticket.dto.ts`, `uploads.service.ts`, `uploads.controller.ts`, `uploads.module.ts`, spec | F-COMPLAINTS-15 part 1, `[AUTH]` all roles; one-time ticket rows (`publicId @unique`, purpose BEFORE/AFTER); claim helpers implementing BR-136: wrong purpose → 400 `Upload ticket purpose mismatch`, already claimed → 400 `Upload ticket is already used`, unknown/older than 24 h → 400 `Upload ticket invalid`; asset re-check runs BEFORE the DB transaction (audit fix) |

- Tests: signature shape; claim races (two parallel claims → exactly one 201, loser 400); purpose mismatch; expired ticket; asset-check failure leaves the ticket unconsumed.

## Step 8 — Complaints core (create, public reads, up)

**Branch:** `feat/complaints-core`.

| Commit | Files | Delivers |
|---|---|---|
| `feat(complaints): add the masked-name and geofence helpers` | `src/complaints/mask-name.helper.ts`, `src/complaints/geofence.helper.ts` + specs | BR-117 (maskedName computed once at create, stored), BR-113 (bounding box from `MALANG_*` env — placeholders per owner decision) |
| `feat(complaints): add create with the daily claim` | `dto/create-complaint.dto.ts`, `complaints.service.ts` (create), `complaints.controller.ts`, `complaints.module.ts`, spec | F-COMPLAINTS-1, `[PELAPOR]`; ONE interactive `$transaction` in the owner-approved order: geofence+occurredAt pre-checks → **create-first daily claim** (`create({userId, day, count:1})`; on P2002 → conditional `updateMany` `count < 3`, 0 affected → 400 `Daily complaint limit reached`) → ticket claims (BR-136) → complaint + BEFORE photos → timeline STATUS_CHANGE → `COMPLAINT_NEW` to CITY_ADMINs; NIK gate 403 `Verify your NIK first` (BR-111); verifyDueAt = now+3d (BR-126) |
| `feat(complaints): add the public list, map and mine` | `dto/query-complaint.dto.ts`, `dto/query-map.dto.ts`, `dto/query-mine.dto.ts`, service/controller additions + spec | F-COMPLAINTS-3/4/6: `$transaction([findMany, count])` with the identical `where`; public status filter forced (BR-118), non-public status query → 400 `Status is not public`; flat whitelist rows (BR-121); map limit `@Max(1000)`; mine adds `rejectReason` (own rows only) |
| `feat(complaints): add detail and up` | service/controller additions + spec | F-COMPLAINTS-5/2: per-caller detail shapes (anonymous/non-owner incl. PIMPINAN = masked public; owner adds `rejectReason` + full timeline; owning AGENCY adds work fields, never `rejectReason`; CITY_ADMIN adds real name + `nikVerified`); PENDING/REJECTED → 404 for all non-owner/non-CITY_ADMIN callers; up = conditional idempotent (unique `@@id` P2002 → re-read → same count, BR-119) |

- Tests: 4th submit (including 4 parallel) → 400 with no complaint row; WIB rollover first submit succeeds; P2002→increment path; maskedName stored, never recomputed; geofence 400; future occurredAt 400; status-not-public 400; PENDING 404 for anonymous; up double-tap same count.

## Step 9 — Complaints staff flows (verification, agency work, photos)

**Branch:** `feat/complaints-staff`.

| Commit | Files | Delivers |
|---|---|---|
| `feat(complaints): add the verification queue and decisions` | `dto/query-verification-queue.dto.ts`, `dto/forward.dto.ts`, `dto/reject.dto.ts`, service/controller additions + spec | F-COMPLAINTS-7 `[CITY_ADMIN]`: queue PENDING oldest-first with reporter real name (NIK-verified invariant); forward sets `FORWARDED` + `forwardedAt` + `handleDueAt` +5d + timeline ASSIGNMENT + notifications (reporter + agency) via conditional `updateMany` on `status: 'PENDING'` (lost race → 404/400 disambiguation BR-123); reject stores `respondedNote` + timeline + reporter notification |
| `feat(complaints): add reassign and mark-duplicate` | `dto/reassign.dto.ts`, `dto/mark-duplicate.dto.ts`, service/controller additions + spec | F-COMPLAINTS-8/9: reassign only from FORWARDED (timeline + new agency + reporter notified); mark-duplicate self-ref 400, no chains 400, idempotent same-main 200, conditional `updateMany` on `duplicateOfId: null` so two admins cannot set two mains; no notifications (BR-125 read-only reference) |
| `feat(complaints): add the agency queue and work actions` | `dto/query-assignment.dto.ts` (`openOnly` via `@ToBoolean()`), `dto/add-progress-note.dto.ts`, service/controller additions + spec | F-COMPLAINTS-10/11 `[AGENCY]`-owned: assignments list masked reporter only (BR-121); start (`FORWARDED`→`IN_PROGRESS`), notes (timeline PROGRESS_NOTE only, 201 create), done (asserts ≥1 AFTER photo → 400 `After photo required`, BR-129) — all via ownership+status conditional `updateMany`; other-agency row → 404 (BR-124) |
| `feat(complaints): add photo attach` | `dto/add-photo.dto.ts`, service/controller additions + spec | F-COMPLAINTS-15 part 2: kind-based branches (BEFORE: reporter + PENDING; AFTER: owning agency + IN_PROGRESS; staff → 403 `Staff accounts cannot attach photos`); claim in one `$transaction` after the pre-transaction asset re-check; max 3 per kind → 400; double-attach `publicId` → 409 via filter |

- Tests: every conditional transition — lost race → 400 with no write (forward/reject/reassign/start/done double-tap, EC-1/EC-2); forward wrong agencyId 404 / inactive agency 400; done without AFTER photo 400 no-write; BEFORE photo on FORWARDED 400; AFTER photo by reporter 403; third BEFORE photo 400; cross-agency start 404; duplicate mark races (idempotent vs 400).

## Step 10 — Dashboards + escalation cron

**Branch:** `feat/dashboards`.

| Commit | Files | Delivers |
|---|---|---|
| `feat(dashboards): add the public, admin and leadership dashboards` | `src/dashboards/dashboards.service.ts`, `dashboards.controller.ts`, `dashboards.module.ts` + specs | F-COMPLAINTS-14: public (no PII), admin (pending/late/lateByAgency/avgs/escalatedCount), leadership (escalated list with per-stage `levels`, `lateByAgency`, `lateByCategory`, `milestoneCounts`, `monthlyVolume 12`); batched reads in one `$transaction`; duplicates excluded only from `totalUniqueProblems` (BR-125) |
| `feat(complaints): add the escalation cron` | `src/complaints/escalation.service.ts` + spec, `app.module.ts` wiring | F-COMPLAINTS-13: every 15 min (`ESCALATION_CRON_MINUTES`); per-(stage, milestone) claims via conditional `updateMany` on the stage's level (`level < milestone`) — cron restart cannot double-notify; milestone 2 anchored at stageDueAt + `ESCALATION_STEP_2_DAYS`; a closed stage stops claiming (verification milestone 2 muted once the complaint leaves PENDING); every claim writes a timeline ESCALATION entry |

- Tests: late predicate (BR-127) at boundaries; cron idempotency (second run → zero new notifications); both stages fire independently; mute-after-close.

## Step 11 — Moderation + agencies + final pass

**Branch:** `feat/moderation` then `chore/final-pass`.

| Commit | Files | Delivers |
|---|---|---|
| `feat(users): add the staff user list, deactivate and blocks` | `dto/query-user.dto.ts`, `dto/deactivate-user.dto.ts`, service/controller/module + spec | F-USERS-1/2 `[CITY_ADMIN]`: deactivate = `isActive:false` + `tokenVersion+1` + `AccountBlock` row in one `$transaction` (BR-130); staff targets → 403; next request of the target → 401 |
| `feat(agencies): add the agency list and detail` | `src/agencies/**` + spec | F-AGENCIES-1 `[AUTH]` paginated + detail (public-safe shape); data comes from the Step 3 seed |
| `test(e2e): add the demo flow and the access checks` | `test/sigap-lapor.e2e-spec.ts` | full journey: register → OTP → NIK verify → submit (daily limit) → CITY_ADMIN forward → AGENCY photos/start/notes/done → escalation milestones → dashboards → moderation; plus the PIMPINAN visibility check (public states only, masked) and the BR-121 payload leak scan |
| `docs(readme): document setup, env vars and deployment` | `apps/backend/README.md`, root `README.md`, `.env.example` review | env table documented, Railway root directory `apps/backend`, seed instructions, geofence placeholder note (verify on a Leaflet plot) |

- Whole-workspace verification at the end: `npx turbo run lint test build` green at root; endpoint count re-checked against API_SPEC module tables.

## Checklist

| Step | Status |
|---|---|
| 0 Repo bootstrap (create-turbo) + spec docs moved in | done |
| 1 App scaffolds + skills + AGENTS.md rules | todo |
| 2 Config + env + throttle tiers + health | todo |
| 3 Prisma schema + migration + seed | todo |
| 4 Auth (port, otp, strategy, flows, meta-test, e2e) | todo |
| 5 Profiles (NIK dummy verification) | todo |
| 6 Notifications (templates, service, gateway, endpoints) | todo |
| 7 Uploads (Cloudinary signed tickets) | todo |
| 8 Complaints core (create + daily claim, public reads, detail, up) | todo |
| 9 Complaints staff (queue/forward/reject/reassign/duplicate, agency work, photos) | todo |
| 10 Dashboards + escalation cron | todo |
| 11 Moderation + agencies + e2e + README + full verify | todo |

## Open risks

1. **TypeScript 7.0.2** is what create-turbo pinned in the root (and `apps/web`). The sigap repo hit a broken `npm run lint` from exactly this (the hoisted `ts-api-utils` needs TS 5) and fixed it by aligning the root + app to `typescript@^5.9.3`. If the backend scaffold or the Nest/Jest toolchain misbehaves under TS 7, align the root to `^5.9.3` in Step 1 (one commit, own scope) — do not retrofit strictness into `apps/web` without asking.
2. **Node v22.17.1** locally vs `engines.node >=24` in the root: npm only warns, but upgrade to Node 24 LTS when convenient (the earlier attempt to install Node 24 was abandoned).
3. `nest new` pins Nest 11; keep `@nestjs/jwt@^11` (skill constraint under Jest/CJS).
4. Geofence `MALANG_*` env values are placeholders until verified visually on a Leaflet plot (owner decision 2026-10-22); the CITY_ADMIN review at the verification step stays the safety net.
5. The frontend is **not** in this plan's scope: `apps/web` stays the create-turbo demo until a separate UI plan replaces it (Leaflet map, public list, dashboards).
6. Deploy targets: Railway (backend, root dir `apps/backend`) + Vercel or Railway (frontend) — decided at deploy time.
