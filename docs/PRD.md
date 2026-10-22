# PRD: SIGAP Lapor — public complaint platform for Kota Malang

Status: DRAFT, rev 0 (remake). Base: `PRD_SIGAP_v0.1.md` (complaint system) as the product source; conventions and proven patterns are **filtered from** `docs/PRD.md` rev 5.2 (the separate Community app — that app is not changed by this PRD). Skills referenced: `apps/backend/.opencode/skills/*` (nest-architecture, nest-prisma, nest-auth-and-security, nest-validation-and-config, nest-response-and-errors, nest-testing, git-workflow); this PRD describes WHAT only and must not contradict them.

Recorded decisions:

| Decision | Value | Source |
|---|---|---|
| ID type / DB | `uuid` / PostgreSQL | user (brief) |
| Login | Email + password; OTP email verification **required before login** | prompt-kit brief (reuse of rev 5.2 pattern) |
| Refresh tokens / Google login | No / no | brief |
| Roles | `Role` enum: `PELAPOR` (default), `CITY_ADMIN`, `AGENCY`, `PIMPINAN`; `role` in JWT is never carried; `RolesGuard` + `@Roles` per route | v0.1 §2, brief |
| NIK verification | Profile-level gate for submitting: register normally → after login complete profile with NIK (+ domicile) → verified; prototype uses a dummy NIK database; NIK stored as a hash, unique per account, never returned by any endpoint | brief |
| Uploads | Cloudinary, images only (JPG/PNG/WebP), ≤ 5 MB per file, signed upload performed indirectly via the backend; photo before = required at submit; photo after = required to mark DONE | user |
| Map | Leaflet + OpenStreetMap tiles (no key); complaint location must be inside Kota Malang (geofence box, verified visually + by admin review) | user |
| Statuses | `PENDING / FORWARDED / IN_PROGRESS / DONE / REJECTED` in code; Indonesian labels in the UI ("Menunggu Verifikasi / Diteruskan / On Going / Selesai / Ditolak") | brief |
| Late mark | `Terlambat` is a computed badge, never a status; deadlines stored per stage | brief |
| Research summary continuity | This app is separate from the Community app (multi-tenant RT/RW). No memberships, no QR, no community content, no SOS here | user |
| Language | UI and notification texts Indonesian; API messages English | rev 5.2 convention |

---

## 1. Overview

### Problem
Kota Malang has no transparent, trackable channel for public complaints: WhatsApp groups and tweets get lost, there is no status, no accountability, and no follow-up evidence. Complaint routing to the wrong agency dies silently.

### Target users
- **Residents (lapor / warga)** of Kota Malang who report problems (broken roads, garbage, floods, public-service failures) and want to follow the progress.
- **City staff (admin kota)** who verify incoming complaints, route them to the right agency, reject spam with a reason, and moderate abuse.
- **Agencies (instansi)**, e.g. PUPR, DLH, Satpol PP, that receive only their own complaints and prove their work with progress notes and after-photos.
- **Leadership (pimpinan)** who oversee late handling and escalations without editing report content.

### Product shape
One standalone app. A resident registers (email + password + OTP), completes identity verification with a NIK (prototype dummy data), then submits complaints with category, description, map location, time and required before-photo. Verified complaints become public (masked reporter name), get one Up per supporting account, and are forwarded to one agency by city staff. The agency moves the complaint IN_PROGRESS → DONE with progress notes and after-photos. Every transition is recorded in an append-only timeline with timestamps and actor. Deadlines (verification 3 days, agency handling 5 days) create a computed `Late` badge; overdue complaints escalate notifications stepwise to city staff and then leadership.

### Success criteria (measurable)

| # | Criterion | Target |
|---|---|---|
| SC-1 | Cross-role access (AGENCY reads another agency's complaint; PELAPOR reaches a staff endpoint) in the automated test suite | 0 passing attempts |
| SC-2 | Identity leak: any `[PUBLIC]` complaint payload contains no NIK, no email, no phone, no plain name | 0 failures in tests (whitelist shape) |
| SC-3 | Daily limit (3 per WIB day) enforced | 4th submit same day → 400, in tests |
| SC-4 | Escalation delivered: an overdue complaint produces notifications to the correct role tier within one cron interval (≤ 15 min, tested with a mocked clock) | pass |
| SC-5 | Every complaint transition is recorded with actor + timestamp | timeline row count = transitions + escalations, in tests |

---

## 2. Roles and permissions

| Role | Who | Checked by |
|---|---|---|
| `PELAPOR` | Any self-registered account (default role) | `JwtAuthGuard`; complaint create additionally requires NIK-verified profile (service check) |
| `CITY_ADMIN` | City staff (seeded), can see reporter's real name and NIK presence | `RolesGuard` + `@Roles('CITY_ADMIN')` |
| `AGENCY` | Agency account (seeded), linked to exactly one `Agency` | `@Roles('AGENCY')` + ownership: the complaint's `agencyId` must equal the caller's `agencyId` |
| `PIMPINAN` | Oversight staff (seeded), read-only; see the capability breakdown below the table | `@Roles('PIMPINAN')` |

Any account may hold at most one role. Staff accounts never verify NIK (only submitters do). Disabled accounts (`isActive = false`) get 401 everywhere; they cannot submit, Up, or log in.

**PIMPINAN capability breakdown (owner decision 2026-10-22):** allowed — public list/map/detail (public states, masked name), Up a complaint, own notifications (+ realtime), own dashboard bucket `/dashboards/leadership` (escalated list, late-by-agency with duration, late-by-category, milestone counts, monthly volume), agency list/detail, health. Denied — submitting complaints (no NIK wizard), the verification queue / forward / reject / reassign / duplicate marking, agency work actions, account moderation, reading PENDING/REJECTED complaints (404), and any payload with the reporter's real name (masked everywhere).

| Capability | PELAPOR (no NIK) | PELAPOR (NIK verified) | AGENCY | CITY_ADMIN | PIMPINAN | PUBLIC |
|---|---|---|---|---|---|---|
| Auth (register/verify/login/reset/me/change/logout-all) | writes own | yes | yes (except verification wizard) | yes | yes | register/login only |
| Complete NIK verification | yes (wizard) | already done | no | no | no | - |
| Submit complaint (photo, location, ≤ 3/day) | gate: 403 until verified | yes | no | no | no | no |
| Up a complaint | yes | yes | yes | yes | yes | - |
| Public list / map / detail (whitelist shape) | yes | yes | yes | yes | yes | yes |
| Dashboard public stats | yes | yes | yes | yes | yes | yes |
| My complaints (own detail full) | yes | yes (own) | - | - | - | - |
| Verification queue, forward, reject with reason | - | - | - | yes | - | - |
| Assign / reassign agency (FORWARDED only, new agencyId) | - | - | - | yes | - | - |
| Duplicate marking (choose main) | - | - | - | yes | - | - |
| See reporter real name | - | - | no (masked) | yes | no (always masked) | no |
| Agency work inbox (notes, status moves, after-photos) | - | - | own agency only | – | – | – |
| Admin dashboards & late statistics | - | - | - | yes | own slice | no |
| Escalated list, late history | - | - | - | - | yes | no |
| Disable account (moderation) with reason | - | - | - | yes | - | - |
| Notifications (own) + realtime | yes | yes | yes | yes | yes | no |
| Health check | yes | yes | yes | yes | yes | yes |

(Note: all `?` items were asked and resolved in the brief; the `Late` badge is computed, never a status.)

---

## 3. Glossary

| Term | Meaning |
|---|---|
| Complaint (pengaduan) | One submitted public-works/service report; the core entity. |
| Category (kategori) | INFRASTRUCTURE, WASTE, DRAINAGE, PUBLIC_ORDER, PUBLIC_FACILITY, PUBLIC_SERVICE, MISCONDUCT, OTHER (8, from v0.1 §4). |
| Agency (instansi) | A city work unit with its own account; only sees complaints assigned to it. |
| Verification step | The CITY_ADMIN step that turns PENDING into FORWARDED or REJECTED. |
| Forward / assignment | Choosing one agency; the complaint becomes visible in that agency's inbox. |
| Timeline | Append-only ordered entries for status changes, reassignments, escalation, and progress notes. |
| Late badge | Computed flag when a stage's deadline has passed and the stage is still open; separate from status. |
| Deadline (tenggat) | `verifyDueAt = createdAt + 3d` (calendar days, incl. weekends); `handleDueAt = forwardedAt + 5d`. |
| Escalation | Overdue notifications: agency late → CITY_ADMIN; admin-side overdue/ignored → PIMPINAN. Once per milestone level. |
| Masked name | Deterministic display name computed at complaint creation, stored on the complaint (`B***** S***` style), never recomputed per view. |
| Up | One-click support; one per account per complaint; announced as count publicly. |
| NIK kit | The profile wizard: NIK + domicile → verified. Prototype uses a dummy NIK database. |
| WIB | UTC+7, used for daily-limit reset and all UI timestamps; DB stores UTC. |

---

## 4. Features

### 4.1 Module `auth` (OTP email verification required)
Register, verify-otp, resend-otp, login, forgot/reset, me, change-password, logout-all, token revocation via `tokenVersion` — the full rule-21 endpoint set of `nest-auth-and-security`. Rules BR-101..BR-107 below.

### 4.2 Module `profiles` (identity kit)

**F-PROFILES-1 — Complete NIK verification.** *PELAPOR.*
- Given NIK from the prototype dummy database and a domicile in Kota Malang, when the user completes the profile, then the account becomes NIK-verified and the wizard gate for complaint endpoints lifts.
- Given an unknown NIK or a NIK already bound to another account, then 400 / 409 (unique).
- Given a staff role (CITY_ADMIN/AGENCY/PIMPINAN), then the endpoint is denied (only submitters verify).

**F-PROFILES-2 — Profile data.** *AUTH.* Name (2–100) and optional phone (`+628…` normalised) are set at registration/verification time and **cannot be edited in MVP** — the name is validated against the dummy NIK/KTP data (owner decision 2026-10-22). Read-only via `GET /auth/me`; no update endpoint.

### 4.3 Module `complaints` (core)

**F-COMPLAINTS-1 — Submit a complaint.** *PELAPOR (NIK verified).* Acceptance:
- Given category, title, description, location inside Malang, optional address note, time of occurrence, and ≥1 before-photo, when submitted, then the complaint is PENDING, the reporter receives a masked name stored at creation, reminders `Late` dueAt = +3d, and each CITY_ADMIN gets `COMPLAINT_NEW` (in-app + realtime).
- Given the daily count for the account reaches 3, then a 4th attempt → 400 `Daily complaint limit reached` (counter resets 00.00 WIB).
- Given the point is outside the Malang box, then 400 `Location must be inside Kota Malang`.
- Given an unverified profile, then 403 `Verify your NIK first`.

**F-COMPLAINTS-2 — Up.** *AUTH.* One per account per complaint (unique); the count is public; a second tap returns the same count (idempotent). Up is visible only on public states (FORWARDED/IN_PROGRESS/DONE).

**F-COMPLAINTS-3 — Public list.** `[PUBLIC]` whitelist payload (id, category, title, maskedName, status, late, upCount, flat lat/lng, addressNote, createdAt, forwardedAt) + search by title + filter by category and status + paginate. Only `FORWARDED/IN_PROGRESS/DONE` are visible. Identity fields never included (SC-2).

**F-COMPLAINTS-4 — Public map.** `[PUBLIC]` same visibility rule as list; map clients pull `GET /complaints/map` (id, flat lat/lng, category, status, late only).

**F-COMPLAINTS-5 — Public detail.** `[PUBLIC]` whitelist: the list fields + description, occurredAt, photos (kind + url), public timeline subset (type, createdAt). The real reporter name is visible to CITY_ADMIN only; PELAPOR (owner), AGENCY and PIMPINAN read maskedName only.

**F-COMPLAINTS-6 — My complaints.** *PELAPOR.* Own list with status, dates, upCount, plus own detail (below) with any allowed state (including PENDING, REJECTED with reason) and full timeline.

**F-COMPLAINTS-7 — Verification queue & decisions.** *CITY_ADMIN.* List PENDING oldest-first with reporter name (every queue reporter is already NIK-verified — BR-111 invariant; the `nikVerified` flag appears only on the CITY_ADMIN detail shape). Actions:
- `POST :id/forward { agencyId }` → FORWARDED (agencyId set, forwardedAt + handleDueAt = now+5d).
- `POST :id/reject { reason }` → REJECTED (reason ≥ 5, final), reporter notified `COMPLAINT_REJECTED`.
Lost race from a second admin → 400 (conditional update).

**F-COMPLAINTS-8 — Reassign.** *CITY_ADMIN.* While FORWARDED only: set a different agencyId, timeline `ASSIGNMENT`, notify the new agency + the reporter. Not available in PENDING/DONE/REJECTED.

**F-COMPLAINTS-9 — Duplicate marking.** *CITY_ADMIN.* Choose a main complaint; when marking another as its duplicate, the duplicate stores `duplicateOfId` (no merge, no content move; the reporter keeps ownership and still sees their own report). The dashboard counts unique problems = rows with `duplicateOfId IS NULL`.

**F-COMPLAINTS-10 — Agency inbox.** *AGENCY(own).* See complaints with own agencyId, filter by status and `openOnly`; fields include reporter maskedName, location, before-photos; **never** the real name (SC-2).

**F-COMPLAINTS-11 — Agency actions.** *AGENCY(own).*
- `POST :id/start` → IN_PROGRESS (only from FORWARDED).
- `POST :id/progress { note }` → timeline progress note (stays IN_PROGRESS).
- `POST :id/done` → DONE, requires ≥1 after-photo; final.
- Lost race guard: conditional `updateMany(status = FROM)`.

**F-COMPLAINTS-12 — Late badge & deadlines.** System. Complaint exposes due timestamps and a computed `late` boolean when a stage is overdue.

**F-COMPLAINTS-13 — Escalation.** System cron every 15 min. Milestones are counted **per stage**. Verification overdue (PENDING && now > verifyDueAt): milestone 1 → CITY_ADMIN, milestone 2 (still overdue +2 days) → PIMPINAN. Handling overdue (FORWARDED/IN_PROGRESS && now > handleDueAt): milestone 1 → CITY_ADMIN, milestone 2 (still overdue +2 days) → PIMPINAN. The two stage counters are independent (`verificationEscalationLevel`, `handlingEscalationLevel`): moving from verification to handling never skips or consumes the handling milestones. Every escalation writes timeline entry `ESCALATION`. One notification per (stage, milestone) pair per complaint (no repeats).

**F-COMPLAINTS-14 — Dashboards.** Public bucket (`/dashboards/public`), CITY_ADMIN bucket (queues, late list, category/agency statistics, average handling time), PIMPINAN bucket (escalated list, late by agency with duration, escalation counts/history). All computed from the same statuses; no PII. Aggregates exclude duplicates from problem counts (F-COMPLAINTS-9).

**F-COMPLAINTS-15 — Photo before/after.** Submit requires ≥1 before-photo; DONE requires ≥1 after-photo (class F-COMPLAINTS-11). Cloudinary image-only (JPG/PNG/WebP), ≤ 5 MB; signed-upload payload issued by the backend; visible only `FORWARDED/IN_PROGRESS/DONE` states (public) or owner/staff for all.

**F-COMPLAINTS-16 — Similar suggestions.** **[STRETCH]** Before submit, read-only list of possibly-similar complaints: same category, open states only (PENDING/FORWARDED/IN_PROGRESS), within 200 m (Haversine on stored points) — BR-137; never auto-merges. Out of the MVP API surface.

### 4.4 Module `users` (moderation)

**F-USERS-1 — Disable account.** *CITY_ADMIN.* Set `isActive=false` + `tokenVersion+1` + a history row with reason (≥ 5 chars), actor, timestamp (append-only). Testable outcomes: the target's next request is 401 (old token), login is 403 'Account is disabled' after the password, and the account can no longer submit or Up. The target is never told the reason; other staff see it in the history.

**F-USERS-2 — Admin accounts list.** *CITY_ADMIN.* Paginated, search by name/email; each row shows status and the moderation history is reachable per account. Staff-only endpoint.

### 4.5 Module `agencies`

**F-AGENCIES-1 — Agency list.** *AUTH.* Authenticated list of agencies (id, name, isActive) for the assignment dropdown and detail pages.
**F-AGENCIES-2 — Agency seed.** Prototype agencies created by seed; no agency self-registration in MVP (staff accounts are seeded).

### 4.6 Module `notifications`

**F-NOTIFICATIONS-1 — Notification list.** *AUTH.* Own list paginated with `unreadOnly` filter; read marks `readAt`; read-all clears the inbox.
**F-NOTIFICATIONS-2 — Unread count.** *AUTH.* Own unread counter for the header badge.
**F-NOTIFICATIONS-3 — Read / read-all.** *AUTH.* Only own notifications are reachable (foreign `:id` → 404).
**F-NOTIFICATIONS-4 — Realtime delivery.** *AUTH.* Socket.IO `/realtime`: handshake with the access token (`handshake.auth.token` only, never URL/query), validated by the same `validate()` rules as HTTP; rooms `user:<id>`; server emits `notification:new`, `complaint:new`, `complaint:updated` only after the DB write commits; an invalid or disabled account is dropped at handshake (or next validation).

Types and their recipients (testable mapping; self-contained, no external doc dependency):

| Event | Type | Recipients |
|---|---|---|
| complaint submitted | `COMPLAINT_NEW` | all CITY_ADMINs |
| forwarded | `COMPLAINT_FORWARDED` (reporter) + `AGENCY_ASSIGNED` (agency account) | reporter, agency |
| rejected | `COMPLAINT_REJECTED` | reporter |
| reassigned | `AGENCY_ASSIGNED` | new agency (+ reporter `COMPLAINT_FORWARDED`) |
| started | `COMPLAINT_IN_PROGRESS` | reporter |
| done | `COMPLAINT_DONE` | reporter |
| handling / verification overdue milestone 1 | `COMPLAINT_LATE_ADMIN` | all CITY_ADMINs |
| milestone 2 (+2 days) | `COMPLAINT_LATE_LEADERSHIP` | all PIMPINAN |
| account deactivated | `ACCOUNT_DEACTIVATED` | the target |

Notification and email texts are Indonesian, defined in one pure template-helper module; the type → title/body mapping lives there and no service hardcodes text.

### 4.7 Module `dashboards` — see F-COMPLAINTS-14 bucket endpoints.

### 4.8 Module `health` — `GET /health`: `SELECT 1` → 200 `{status:'ok'}` else 503.

### 4.9 FAQ — static frontend content; no backend module in MVP. (Chatbot AI and admin live chat are out of scope.)

---

## 5. Business rules

Accounts and OTP (discipline per `nest-auth-and-security`):

| ID | Rule |
|---|---|
| BR-101 | Email is trimmed lowercased and unique; duplicate registration → 409 but registering never updates an existing row. |
| BR-102 | One password policy (8–128) defined once and used by register, reset and change; login and "current password" fields use a separate policy-free validator (no minimum) so old passwords still work. |
| BR-103 | Unverified / disabled account cannot log in: password first, then active check (401 identical for unknown-email and wrong-password), then 403 'Account is disabled' / 'Email is not verified'. |
| BR-104 | OTP: 6 digits, hashed, TTL 10 min, max 5 attempts (atomic claim), single-use, purpose-scoped, resend cooldown 60 s (same-message answer), never logged. |
| BR-105 | `tokenVersion` +1 on reset/change/logout-all/deactivate, in the same write; a leaked old token → 401 (validate rejects). |
| BR-106 | Profile endpoints return whitelist select; `passwordHash`, `codeHash`, `nikHash`, `tokenVersion`, `isActive` never leave the service. |
| BR-107 | NIK stored as hash (`nikHash @unique`); verifying binds the hash to one account only; the wizard sets `nikVerifiedAt`; staff roles cannot run the wizard; the hash never appears in any payload; the prototype uses a dummy NIK data source. |

Complaints:

| ID | Rule |
|---|---|
| BR-111 | Create is allowed only for `PELAPOR` with `nikVerifiedAt != null`; otherwise 403. |
| BR-112 | Daily limit: ≤ 3 complaints created per account per WIB calendar day (00.00 WIB = 17.00 UTC previous day). Strict under parallel submits, exact claim order inside the create transaction: (1) `create` the `DailyComplaintCounter` row for (account, WIB day) with count 1 — on P2002 (row exists) run (2) the conditional `updateMany` with `count < 3` incrementing by 1; if that claims 0 rows → 400 `Daily complaint limit reached`. The first submit of a WIB day succeeds via step 1; the day-rollover race resolves through step 2; a 4th concurrent submit fails at step 2. |
| BR-113 | Location must satisfy the Malang bounding box (`400 'Location must be inside Kota Malang'`). The env values ship as placeholders and are verified visually on a Leaflet plot during implementation; admin review at the verification step remains the safety net. |
| BR-114 | Title 3–150; description 10–5000; occurredAt cannot be in the future; address note ≤ 200. |
| BR-115 | Category in the 8-value enum; `OTHER` is allowed but still requires agency assignment by staff at forward time (admin picks per case). |
| BR-116 | Photos: before ≥ 1 and ≤ 3; after ≥ 1 and ≤ 3. JPG/PNG/WebP, ≤ 5 MB each; upload only through backend-issued signed targets (a one-time ticket; nothing attaches without claiming it). |
| BR-117 | maskedName is computed exactly once at create and stored (deterministic from the real name with the v0.1 pattern `B***** S***`); public payloads read only this column. |
| BR-118 | Public visibility of a complaint = `FORWARDED`, `IN_PROGRESS`, `DONE` only. `PENDING` and `REJECTED` are owner/CITY_ADMIN-only; AGENCY, PIMPINAN and anonymous callers get 404 on those states (BR-121 shapes). Public payloads use a whitelist shape (BR-121) — never a raw model. |
| BR-119 | One Up per account per complaint (unique index); Up list/count is public only on visible states; double-submit returns the unchanged count (idempotent). |
| BR-120 | A complaint has exactly one assignment when approved; `agencyId` null until forward; assignment must be to an ACTIVE agency account; later reassignment appends a timeline entry and clears nothing else. |
| BR-121 | Whitelist shape, flat (no nested objects). List row: `id, category, title, maskedName, status, late, upCount, lat, lng, addressNote, createdAt, forwardedAt`. Detail adds: `description, occurredAt, photos [{kind, url}], timeline [{type, createdAt}], and rejectReason only for the owner or CITY_ADMIN`. No NIK, no email, no phone, no real name in any public payload (only CITY_ADMIN receives the real name). |
| BR-122 | Timeline is append-only. Each entry records actor id, type (`STATUS_CHANGE`, `ASSIGNMENT`, `PROGRESS_NOTE`, `ESCALATION`), old status, new status, note. No update or delete endpoint. |
| BR-123 | Statuses follow section 6 exactly. Every transition is a conditional write (`updateMany` matching the source status). When the write claims nothing: re-read — the row is gone / not owned → 404; the row exists but the source status changed → 400 `Invalid status change`. |
| BR-124 | AGENCY routes are ownership-checked: `complaint.agencyId` must equal the caller's `agencyId`, else 404. |
| BR-125 | Duplicate: only CITY_ADMIN marks; marking is a conditional write (`duplicateOfId` set when currently null; same mainId re-marked idempotently, different one → 400). Neither row is deleted or merged; duplicates are excluded from unique-problem statistics. |
| BR-126 | Deadlines: `verifyDueAt = createdAt + 3 days`, `handleDueAt = forwardedAt + 5 days`; calendar days incl. weekends; timestamps UTC in DB, WIB for display/daily-limit only. |
| BR-127 | `late` badge is computed (a stage open && now > dueAt), never stored as a status; dashboard late counts use the same predicate. |
| BR-128 | Escalation cron: every 15 min, per (stage, milestone) pair. `verificationEscalationLevel` covers PENDING overdue: milestone 1 → CITY_ADMIN, milestone 2 (+2 days) → PIMPINAN. `handlingEscalationLevel` covers FORWARDED/IN_PROGRESS overdue with the same tiers. Milestone 2 of a stage fires when `now > stageDueAt + ESCALATION_STEP_2_DAYS` days (anchored to the stage going overdue, not to the milestone-1 send). Each stage's level accrues only while its stage is still open: once the complaint leaves PENDING the verification milestones are muted (the stage is no longer late), same for handling after DONE/REJECTED. The claim is a conditional `updateMany` on the stage's level (`level < milestone`), so a cron restart cannot double-notify; every claim writes a timeline ESCALATION entry. |
| BR-129 | DONE requires ≥ 1 after-photo (Cloudinary reference) and appends a timeline entry; undoing DONE is impossible (final); complaint keeps account of the after-photos uploader and time. |
| BR-130 | Moderation: `CITY_ADMIN` disable = `isActive:false` + `tokenVersion+1` in a transaction that also writes an `account_blocks` history row (reason ≥ 5 chars, actor, timestamp); re-enable is manual (dev) in MVP. |

Other:

| ID | Rule |
|---|---|
| BR-131 | Notifications only for events whose recipients are computed from the DB at emit time; disabled accounts stop receiving immediately. |
| BR-132 | Rate limits: auth endpoints per `nest-auth-and-security` rule 10; the global default tier covers everything else; complaint submit gets no extra throttle (the daily limit is the business rule, not the throttler). Socket handshake: token only from `handshake.auth.token`, validated like HTTP requests; never a token in the URL. |
| BR-133 | Throttle tiers are env-overridable keys: `THROTTLE_DEFAULT_LIMIT` (global, default 100/min), `THROTTLE_AUTH_LIMIT` (auth endpoints, default 5/min), `THROTTLE_SEND_CODE_LIMIT` (send-code endpoints, default 3/min). Settings are per handler, never per class. |
| BR-134 | Logs contain no NIK, no codes, no emails; error responses never leak internals; DB timestamps UTC, display WIB. |
| BR-135 | Health: `SELECT 1` → 200 `{status:'ok'}` else 503. |
| BR-136 | Upload tickets: one-time claim, purpose-matched (BEFORE/AFTER), claimed at most 24 h after issuance. Wrong purpose → 400 `Upload ticket purpose mismatch`; already claimed → 400 `Upload ticket is already used`; older than 24 h or unknown → 400 `Upload ticket invalid`. |
| BR-137 | `[STRETCH]` Similar suggestions operate only on open complaints (`PENDING`, `FORWARDED`, `IN_PROGRESS`) of the same category within 200 m (Haversine over stored points); read-only, never merges. Not in the MVP API surface. |

---

## 6. State machines

### 6.1 Complaint

```
                forward                        start                 done (+after photo)
  (new) ─────────► PENDING ──────────────────► FORWARDED ──────────► IN_PROGRESS ─────────────► DONE
                      │                          │
                      │ reject (reason)          ▼ reassign (self-loop: new agencyId)
                      ▼
                  REJECTED (final)
```

| From | To | Who | Side effects |
|---|---|---|---|
| (new) | PENDING | PELAPOR (NIK verified) | daily-limit claim, before-photo ticket claims, maskedName, verifyDueAt, timeline STATUS_CHANGE (create), `COMPLAINT_NEW` to CITY_ADMINs |
| PENDING | FORWARDED | CITY_ADMIN | agencyId set, forwardedAt + handleDueAt, timeline ASSIGNMENT, notify reporter + agency |
| PENDING | REJECTED | CITY_ADMIN (reason ≥ 5, final) | reason stored, timeline STATUS_CHANGE, notify reporter `COMPLAINT_REJECTED` |
| FORWARDED | IN_PROGRESS | AGENCY(own) | timeline STATUS_CHANGE, notify reporter `COMPLAINT_IN_PROGRESS` |
| FORWARDED | FORWARDED | CITY_ADMIN reassign | new agencyId, timeline ASSIGNMENT, notify new agency + reporter |
| IN_PROGRESS | IN_PROGRESS | AGENCY(own) progress note | timeline PROGRESS_NOTE |
| IN_PROGRESS | DONE | AGENCY(own), ≥1 after-photo, final | timeline STATUS_CHANGE, notify reporter `COMPLAINT_DONE` |
| any open | (badge) Late | computed | dashboard & list filter; no state change |

A lost race or wrong-source-state attempt never mutates anything: conditional write first, then 404 when the row (or ownership context) is missing, or 400 `Invalid status change` when it exists with another status (BR-123). `DONE`/`REJECTED` are final.

### 6.2 Notification texts

Notification and email subjects/bodies are Indonesian, defined in one pure template-helper module; the `type → title/body` mapping is in that module (the type → recipients table above is the router); no service hardcodes text.

---

## 7. Entities (conceptual)

| Entity | Purpose | Key attributes | Relations | Delete behaviour |
|---|---|---|---|---|
| User | account + role | email unique, passwordHash, name, phone?, role enum, isActive, emailVerifiedAt?, nikVerifiedAt?, tokenVersion, agencyId? (AGENCY only) | 1-N complaints, 1 N NikProfile | never deleted in MVP (Restrict) |
| NikProfile | NIK kit | nikHash @unique, domicile, verifiedAt | 1-1 User | never deleted (Restrict) |
| Agency | city work unit | name unique, isActive | 1-N Users (1 account MVP), 1-N complaints | never deleted in MVP (seed data) |
| Complaint | one public report | title/description/category, status, occurredAt, addressNote, lat/lng, maskedName, duplicateOfId?, agencyId?, forwardedAt?, verifyDueAt, handleDueAt, verificationEscalationLevel, handlingEscalationLevel, respondedNote | N-1 User (creator), N-1 Agency? | never deleted (Restrict; even duplicates kept) |
| DailyComplaintCounter | strict daily-limit claim | one row per account per WIB day, claimed count | N-1 User | kept (history), never deleted |
| ComplaintPhoto | before/after evidence | kind (BEFORE/AFTER), cloudinary publicId + URL, uploadedById | N-1 Complaint, N-1 User | never deleted (evidence; createdAt doubles as upload time) |
| ComplaintTimeline | append-only audit | type enum, oldStatus?, newStatus?, note?, actorId, at | N-1 Complaint | never updated/deleted |
| ComplaintUp | support tracking | accountId+, complaintId+ | pure pivot (createdAt only) | cascade |
| AccountBlock | moderation history | userId, reason, moderatorId, at | N-1 User (subject), N-1 User (moderator) | never deleted |
| Notification | inbox row | type, title, body, entityType/entityId (soft reference, no FK), readAt? | N-1 User | cascade |
| OtpCode | verification codes | purpose, codeHash, attempts, expiresAt, usedAt | N-1 User | cascade |
| UploadTicket | one-time signed upload target | publicId unique, purpose, claimedById? | N-1 User (requester/claimer) | kept |

No soft delete in MVP (per brief: none). Photos stored in Cloudinary; DB stores references only. Complaint never hard-deletes; a bad duplicate keeps the row.

---

## 8. Non-functional (pointing to the skills — not restated)

- Auth: `nest-auth-and-security` (JWT `{sub,email,tv}`, validate() re-load, OTP rules 11, rule 21 endpoint table). Revocation via tokenVersion.
- Architecture / routes / Swagger prefixes: `nest-architecture` (rules 9–12; `[PUBLIC]`, `[AUTH]`, `[CITY_ADMIN/...]`-style derived prefixes).
- DTO/env: `nest-validation-and-config` (PaginationDto, ToBoolean, env Joi in `env.schema.ts` — additional vars: `CLOUDINARY_*`, `MALANG_*`, `ESCALATION_*`, `THROTTLE_*`, OTP tuning; final list in `docs/API_SPEC.md`).
- Responses: `nest-response-and-errors` (envelope, markers, filter order, status codes).
- Data: `nest-prisma` (map, timestamps, onDelete, select, N-1-condition `updateMany`, list+count `$transaction`, no N+1).
- Realtime: Socket.IO `/realtime`, token-only from `handshake.auth.token` (`nest-auth-and-security` `references/websocket-auth.md`); server→client events: `notification:new`, `complaint:new`, `complaint:updated`.
- Map (frontend): Leaflet + OSM tiles, marker cluster optional; backend exposes a narrow `/complaints/map` whitelist endpoint.
- Scheduler: one cron job (nest `@Cron`/`@Interval` every 15 min) for escalation milestones (BR-128); no other scheduled task in MVP.
- Time: DB timestamps UTC; UI + daily limit WIB (`Asia/Jakarta`), reset 00.00 WIB.
- Testing: `nest-testing` + the auth recipes (route-guard meta-test, jwt/otp specs, e2e). Every BR-1xx has a test target written in the next doc (per pipeline prompt 03).
- Environments: full list produced by the API_SPEC (kit step 03); seed-only vars stay out of the boot schema.

---

## 9. Edge cases and abuse cases

| # | Case | Expected | Rule |
|---|---|---|---|
| EC-1 | Two admins verify the same PENDING complaint at once | one succeeds, other 400 | BR-123 |
| EC-2 | Two rapid status changes by the same agency account (double-tap) | conditional update; the second gets 400 | BR-123, BR-129 |
| EC-3 | 4th complaint of the WIB day (even in parallel) | 400, guaranteed by the per-day claim row | BR-112 |
| EC-4 | Up double-tap | one row (unique), read returns same count | BR-119 |
| EC-5 | Staff account submits complaint | 403 (only PELAPOR) | BR-111 |
| EC-6 | Unverified (no NIK) account submits | 403 'Verify your NIK first' | BR-111, BR-107 |
| EC-7 | Point in Malang river/edge outside box | 400 geofence msg | BR-113 |
| EC-8 | Reporter changes their name after submission | maskedName stays (computed at create) | BR-117 |
| EC-9 | AGENCY reads a complaint of another agency | 404 (BR-124: hidden like missing) | BR-124 |
| EC-10 | AGENCY marks DONE without after-photo | 400 'After photo required' | BR-129 |
| EC-11 | Duplicate main chosen, then the main gets DONE | the duplicate row stays untouched; no cross notifications (read-only reference) | BR-125 |
| EC-12 | Cron restart mid-scan | per-(stage, milestone) conditional claim, no double notification | BR-128 |
| EC-13 | Enumeration of other users' complaints by id | public complaints return the whitelist shape; private states 404 to strangers | BR-118, BR-121 |
| EC-14 | Mass assignment (`role`, `isActive`, `agencyId`, escalation levels, maskedName in body) | 400 (whitelist) | BR-106 |
| EC-15 | Disabled staff/agency account holds an open socket | dropped on next validation; steps of tokenVersion change | BR-130, BR-131 |
| EC-16 | Uploading an animated GIF / renamed image (`.jpg` with different magic bytes) | 400 (MIME sniff + magic-byte check server side) | BR-116 |

---

## 10. Out of scope (MVP)

- Chatbot AI (v0.1 F26), admin live chat (F27) → later phase.
- Similar-complaint suggestions → `[STRETCH]` (F-COMPLAINTS-16).
- Broadcast announcements admin→users, FAQ backend, complaint merging, delete complaint, per-user agency multi-account, web push, events, payment, SOS — no.
- The Community app (multi-tenant RT/RW: memberships, QR, announcements, reports RT/RW, SOS) lives in the existing `apps/backend` and is unchanged by this PRD.
- Google login, refresh tokens.

## 10.1 Open questions

1. Exact Malang geofence corners (BR-113): target ± seconds precision; visual check on Leaflet during implementation, plus admin review in the verification step remains the safety net.
2. Legal/validation of the 3-day / 5-day targets (v0.1 stated "needs validation before official use") — MVP ships these as product constants, easy to change in env later.
3. Closed by decision 2026-10-22: deadline lengths (3d verification / 5d handling) stay product constants until legal validation; only `ESCALATION_STEP_2_DAYS` and `ESCALATION_CRON_MINUTES` are env-overridable (API_SPEC env table).
4. The "10-day recipient feedback" stage from v0.1 dropped (no mechanism existed in the flow); record it in GAPS during audit.

---

## 11. Traceability

| Feature | BRs | Module |
|---|---|---|
| F-AUTH-1..7 | BR-101, BR-102, BR-103, BR-104, BR-105, BR-106, BR-133 | `src/auth/` |
| F-PROFILES-1..2 | BR-107, BR-106 | `src/profiles/` (data is registration-locked; read-only via /auth/me) |
| F-COMPLAINTS-1 | BR-111, BR-112, BR-113, BR-114, BR-116, BR-117, BR-121, BR-136 | `src/complaints/` |
| F-COMPLAINTS-2 | BR-119 | `src/complaints/` (ups) |
| F-COMPLAINTS-3..5 | BR-118, BR-121 | `src/complaints/` (public) |
| F-COMPLAINTS-6 | BR-118 | `src/complaints/` (mine) |
| F-COMPLAINTS-7 | BR-120, BR-122, BR-123 | `src/complaints/` (verification) |
| F-COMPLAINTS-8 | BR-120, BR-123 | `src/complaints/` (reassign) |
| F-COMPLAINTS-9 | BR-125, BR-123 | `src/complaints/` (duplicates) |
| F-COMPLAINTS-10..11 | BR-124, BR-123, BR-129 | `src/complaints/` (agency) |
| F-COMPLAINTS-12 | BR-126, BR-127 | `src/complaints/` + list payloads |
| F-COMPLAINTS-13 | BR-128, BR-131 | `src/complaints/` (cron) |
| F-COMPLAINTS-14 | BR-125, BR-127 | `src/dashboards/` |
| F-COMPLAINTS-15 | BR-116, BR-136 | `src/uploads/` (Cloudinary port + adapters, `@Global()` like mail) |
| F-COMPLAINTS-16 | BR-137 | `src/complaints/` (stretch, out of MVP API surface) |
| F-USERS-1..2 | BR-130 | `src/users/` |
| F-AGENCIES-1..2 | BR-120 | `src/agencies/` |
| F-NOTIFICATIONS-1..3 | BR-131 | `src/notifications/` |
| F-NOTIFICATIONS-4 | BR-132 | `src/notifications/` (gateway) |
| F-HEALTH-1 | BR-135 | `src/health/` |

(BR-108, BR-109, BR-110 are reserved — not used.) No orphan endpoints; every feature maps to endpoints listed in `docs/API_SPEC.md`.

---

## Assumptions

| # | Assumption |
|---|---|
| A-1 | Emails/passwords/NIK never leak; every payload is a whitelist select. |
| A-2 | One agency = one account in MVP; per-officer staff accounts later. |
| A-3 | NIK verification prototype uses a seeded dummy NIK table (no real API). |
| A-4 | Malang geofence box is generous at first (verified visually) and tightened with the team's own Leaflet plot. |
| A-5 | Escalation cron runs on one replica (single-instance deployment). |
| A-6 | The daily limit counts complaint creates (not Up / progress notes). |
| A-7 | Up allowed from any authenticated account, including city staff (counting only) — same as one-person-one-vote pattern, no ineligible list in MVP. |
| A-8 | Photos kept after complaint DONE forever (evidence), never deleted in MVP. |
