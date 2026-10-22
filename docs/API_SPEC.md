# API_SPEC — SIGAP Lapor

Source: `docs/PRD.md` + `docs/DATA_MODEL.md`. The skills are the single source of truth for conventions.

## Conventions (pointing, not restating)

- Envelope / markers / status codes → `nest-response-and-errors` (rules 1–9). Controllers return `Paginated` / `MessageResponse` / plain; services return data only.
- Route naming + Swagger prefixes → `nest-architecture` rules 9–12 (kebab-case plural under `/api`; `POST :id/<verb>` with `@HttpCode(200)`; prefix = guards, ownership in `description`).
- Auth endpoints, guards, throttle table, OTP flow → `nest-auth-and-security` rules 10–12, 21 (rule 21 auth table is imported as-is below).
- DTOs / env → `nest-validation-and-config` (one file per DTO, `Update` = `PartialType`, list DTO extends `PaginationDto`, `@ToBoolean()` for query booleans, project env in `src/config/env.schema.ts`).
- Data access / select / transactions → `nest-prisma` (rules 8–12, 14; list = `$transaction([findMany, count])`; interactive `$transaction` for multi-step writes).
- Realtime → `nest-auth-and-security` `references/websocket-auth.md`; Socket.IO path `/realtime`, token only via `handshake.auth.token`, `validate()` check in the handshake; rooms `user:<id>`.

Global prefix `api`. All timestamps in payloads are UTC ISO (UI converts to WIB). Daily-limit and geofence checks happen in the service (not visible in this spec beyond their errors).

## Module table

Prefixes use the canonical `@Roles` order `PELAPOR / CITY_ADMIN / AGENCY / PIMPINAN`. Throttle = extra `@Throttle` beyond the global 100/min tier (`default/auth/sendCode` 100/5/3 per `nest-auth-and-security` rule 10; values in the table are per-minute handler overrides).

### `auth` (imports rule 21 as-is)

| Method | Path | Summary (prefix) | Guard | Roles | Throttle | Success | IDs |
|---|---|---|---|---|---|---|---|
| POST | /api/auth/register | [PUBLIC] Register an account | – | – | 5 | 201, data `null` | F-AUTH-1 |
| POST | /api/auth/verify-otp | [PUBLIC] Verify a registration code | – | – | 5 | 200, `{ accessToken }` | F-AUTH-2 |
| POST | /api/auth/resend-otp | [PUBLIC] Resend a verification code | – | – | 3 (+DB cooldown) | 200, data `null` (message always identical) | F-AUTH-3 |
| POST | /api/auth/login | [PUBLIC] Log in | – | – | 5 | 200, `{ accessToken }` | F-AUTH-4 |
| POST | /api/auth/forgot-password | [PUBLIC] Request a reset code | – | – | 5 | 200, data `null` | F-AUTH-5 |
| POST | /api/auth/reset-password | [PUBLIC] Reset the password with a code | – | – | 5 | 200, data `null` | F-AUTH-6 |
| GET | /api/auth/me | [AUTH] Get my profile | JWT | – | global | 200, profile | F-AUTH-7, BR-106 |
| POST | /api/auth/change-password | [AUTH] Change my password | JWT | – | 5 | 200, `{ accessToken }` | BR-105 |
| POST | /api/auth/logout-all | [AUTH] Kill all my sessions | JWT | – | global | 200, data `null`, tokenVersion +1 | BR-105 |

Rule 21 details: register sends `EMAIL_VERIFICATION`; `verify-otp` returns `{ accessToken }` (EMAIL_VERIFICATION may return a token for the self-registration role `PELAPOR`); a reset code never logs in. Login/status errors: `401 'Invalid credentials'` before any status check, then `403 'Account is disabled'` / `403 'Email is not verified'` (BR-103, enumeration-safe).

### `profiles`

| Method | Path | Summary (prefix) | Guard | Roles | Throttle | Success | IDs |
|---|---|---|---|---|---|---|---|
| POST | /api/profiles/identity | [PELAPOR] Verify my NIK (wizard) | JWT+Roles | PELAPOR | 5 | 201 (200 on idempotent replay) | F-PROFILES-1, BR-107 |

### `complaints`

| Method | Path | Summary (prefix) | Guard | Roles | Throttle | Success | IDs |
|---|---|---|---|---|---|---|---|
| POST | /api/complaints | [PELAPOR] Submit a complaint | JWT+Roles | PELAPOR | global (BR-112 is the limit) | 201, complaint (public shape) | F-COMPLAINTS-1 |
| GET | /api/complaints | [PUBLIC] List public complaints | – | – | global | 200 Paginated | F-COMPLAINTS-3, BR-118, BR-121 |
| GET | /api/complaints/map | [PUBLIC] List complaint map points | – | – | global | 200 Paginated (limit ≤ 1000) | F-COMPLAINTS-4 |
| GET | /api/complaints/mine | [AUTH] List my complaints | JWT | – | global | 200 Paginated | F-COMPLAINTS-6 |
| GET | /api/complaints/:id | [PUBLIC] Get a complaint | – | – | global | 200, detail (shape per caller) | F-COMPLAINTS-5 |
| POST | /api/complaints/:id/up | [AUTH] Up a complaint | JWT | – | global | 200, `{ upCount }` | F-COMPLAINTS-2, BR-119 |
| GET | /api/complaints/verification-queue | [CITY_ADMIN] List pending complaints | JWT+Roles | CITY_ADMIN | global | 200 Paginated | F-COMPLAINTS-7 |
| GET | /api/complaints/suggestions | [PELAPOR] List similar open complaints (STRETCH) | JWT+Roles | PELAPOR | global | 200 Paginated | F-COMPLAINTS-16 |
| POST | /api/complaints/:id/forward | [CITY_ADMIN] Forward a complaint to an agency | JWT+Roles | CITY_ADMIN | global | 200, complaint | F-COMPLAINTS-7, BR-120, BR-123 |
| POST | /api/complaints/:id/reject | [CITY_ADMIN] Reject a complaint | JWT+Roles | CITY_ADMIN | global | 200, complaint | F-COMPLAINTS-7, BR-123, BR-122 |
| POST | /api/complaints/:id/reassign | [CITY_ADMIN] Reassign the agency | JWT+Roles | CITY_ADMIN | global | 200, complaint | F-COMPLAINTS-8, BR-120 |
| POST | /api/complaints/:id/mark-duplicate | [CITY_ADMIN] Mark a duplicate main complaint | JWT+Roles | CITY_ADMIN | global | 200, complaint | F-COMPLAINTS-9, BR-125 |
| GET | /api/complaints/assignments | [AGENCY] List my agency's complaints | JWT+Roles | AGENCY | global | 200 Paginated | F-COMPLAINTS-10 |
| POST | /api/complaints/:id/start | [AGENCY] Start working a complaint | JWT+Roles | AGENCY | global | 200, complaint | F-COMPLAINTS-11, BR-123 |
| POST | /api/complaints/:id/notes | [AGENCY] Add a progress note | JWT+Roles | AGENCY | global | 201, timeline entry | F-COMPLAINTS-11, BR-122 |
| POST | /api/complaints/:id/done | [AGENCY] Mark a complaint done | JWT+Roles | AGENCY | global | 200, complaint | F-COMPLAINTS-11, BR-129, BR-123 |
| POST | /api/complaints/:id/photos | [AUTH] Attach a photo (BEFORE/AFTER) | JWT | (service: kind-based) | global | 201, photo | F-COMPLAINTS-15, BR-116, BR-136 |

Route order is intentional: `verification-queue`, `suggestions` and `assignments` must be defined before `:id` in the controller so Nest matches the static segments first. `GET /complaints/suggestions` is **[STRETCH]** — not implemented in the MVP API surface; listed for completeness (F-COMPLAINTS-16: same category + ≤ 200 m, Haversine over stored points, read-only, never merges).

### `uploads`

| Method | Path | Summary (prefix) | Guard | Roles | Throttle | Success | IDs |
|---|---|---|---|---|---|---|---|
| POST | /api/uploads/tickets | [AUTH] Get a signed Cloudinary upload target | JWT | – | global | 201, upload target | F-COMPLAINTS-15, BR-116, BR-136 |

### `agencies`

| Method | Path | Summary (prefix) | Guard | Roles | Throttle | Success | IDs |
|---|---|---|---|---|---|---|---|
| GET | /api/agencies | [AUTH] List agencies | JWT | – | global | 200 Paginated | F-AGENCIES-1 |
| GET | /api/agencies/:id | [AUTH] Get an agency | JWT | – | global | 200, agency | F-AGENCIES-1 |

Also public-safe shape (id, name, isActive only) — no user emails of its account.

### `users` (moderation)

| Method | Path | Summary (prefix) | Guard | Roles | Throttle | Success | IDs |
|---|---|---|---|---|---|---|---|
| GET | /api/users | [CITY_ADMIN] List accounts | JWT+Roles | CITY_ADMIN | global | 200 Paginated | F-USERS-2 |
| POST | /api/users/:id/deactivate | [CITY_ADMIN] Disable an account | JWT+Roles | CITY_ADMIN | global | 200, data `null`, tv +1 | F-USERS-1, BR-130 |
| GET | /api/users/:id/blocks | [CITY_ADMIN] List moderation history | JWT+Roles | CITY_ADMIN | global | 200 Paginated | F-USERS-1, BR-130 |

### `notifications`

| Method | Path | Summary (prefix) | Guard | Roles | Throttle | Success | IDs |
|---|---|---|---|---|---|---|---|
| GET | /api/notifications | [AUTH] List my notifications | JWT | – | global | 200 Paginated | F-NOTIFICATIONS-1 |
| GET | /api/notifications/unread-count | [AUTH] Unread count | JWT | – | global | 200, `{ unread }` | F-NOTIFICATIONS-2 |
| POST | /api/notifications/:id/read | [AUTH] Read a notification | JWT | – | global | 200, data `null` | F-NOTIFICATIONS-3 |
| POST | /api/notifications/read-all | [AUTH] Read all notifications | JWT | – | global | 200, data `null` | F-NOTIFICATIONS-3 |

Ownership: every query filtered by `userId = me`; another user's `:id` → 404. `QueryNotificationDto extends PaginationDto`: `unreadOnly? @ToBoolean() + @IsBoolean()`.

### `dashboards`

| Method | Path | Summary (prefix) | Guard | Roles | Throttle | Success | IDs |
|---|---|---|---|---|---|---|---|
| GET | /api/dashboards/public | [PUBLIC] Public stats | – | – | global | 200, buckets | F-COMPLAINTS-14, BR-125 |
| GET | /api/dashboards/admin | [CITY_ADMIN] Admin dashboard | JWT+Roles | CITY_ADMIN | global | 200, buckets | F-COMPLAINTS-14 |
| GET | /api/dashboards/leadership | [PIMPINAN] Leadership dashboard | JWT+Roles | PIMPINAN | global | 200, buckets | F-COMPLAINTS-14 |

### `realtime` (not an endpoint — WebSocket)

Socket.IO `/realtime` (token in `handshake.auth.token`, validate → rooms `user:<id>`, emit `notification:new`, `complaint:new`, `complaint:updated`). Server emits only after the DB write commits. Recipients computed from DB at emit time (BR-131).

### `health`

| Method | Path | Summary (prefix) | Guard | Roles | Throttle | Success | IDs |
|---|---|---|---|---|---|---|---|
| GET | /api/health | [PUBLIC] Health | – | – | global | 200 / 503 `SELECT 1` | BR-135 |

## Per endpoint details

### POST /api/profiles/identity [PELAPOR]

**Request** — `body CompleteIdentityDto`:

| Field | Type | Validators | Example |
|---|---|---|---|
| nik | string | digits only `@Matches(/^\d{16}$/)` | `3576010101900001` (dummy DB) |
| domicile | string | `@Length(3,200)` | `Kec. Lowokwaru, Kota Malang` |

**Response** — `MessageResponse(data)`, 201 on first verification; an idempotent replay (already verified account) answers the current profile with 200 instead of re-creating the row. `data = { nikVerifiedAt, email, name, role }`.

**Errors**: 400 `NIK is not registered` (dummy-DB miss) · 409 `NIK is already bound` (BR-107 unique) · 403 staff attempt hits the `@Roles('PELAPOR')` guard.

**Rules**: verification order — lookup dummy NIK by its hash, then the interactive `$transaction` binds the hash to the caller with a conditional `updateMany({ where: { id: me.id, nikVerifiedAt: null } })` (lost race = already verified → idempotent 200 with current state, not an error).

### POST /api/complaints [PELAPOR]

**Request** — `body CreateComplaintDto`:

| Field | Type | Validators | Example |
|---|---|---|---|
| category | enum from Prisma `ComplaintCategory` | `@IsEnum(ComplaintCategory)` | `INFRASTRUCTURE` |
| title | string | `@Length(3,150)` | `Lubang jalan di Jl. Ijen` |
| description | string | `@Length(10,5000)` | ... |
| occurredAt | string | `@IsDateString()` + not in future (service) | `2026-10-21T09:00:00Z` |
| lat | number | type-check; range/service geofence | `-7.97` |
| lng | number | type-check; range/service geofence | `112.64` |
| addressNote? | string | `@IsOptional() @MaxLength(200)` | `Depan SMA 3 Malang` |
| beforePhotoTicketIds | string[] (uuid each) | `@ArrayMinSize(1) @ArrayMaxSize(3)`, each `ParseUUIDPipe`-able | `['0c0…']` |

**Response** — `MessageResponse(data)` 201. `data` = whitelist shape: `{ id, category, title, status: 'PENDING', lat, lng, addressNote, maskedName, createdAt, verifyDueAt, photos: [{kind:'BEFORE', url}] }`.

**Errors**: 403 `Verify your NIK first` (BR-111) · 400 `Daily complaint limit reached` (BR-112) · 400 `Location must be inside Kota Malang` (BR-113) · 400 `occurredAt cannot be in the future` (BR-114) · 400 validation · 400 `Upload ticket invalid` / `Upload ticket is already used` / `Upload ticket purpose mismatch` (BR-116) · 409 via filter (P2002) only if a photo publicId collides.

**Rules**: geofence + occurredAt checks run before the transaction; everything else happens in ONE interactive `$transaction` with the owner-approved create-first daily claim: (1) `create({ userId, day, count: 1 })` on the `DailyComplaintCounter` row — on P2002 (2) conditional `updateMany` with `count < 3`; 0 affected → 400 `Daily complaint limit reached`. Then ticket claims (`updateMany` per ticket: unclaimed, purpose match; count 0 → 400) → complaint + BEFORE photo rows → timeline STATUS_CHANGE (create) → `COMPLAINT_NEW` to CITY_ADMINs (BR-131). Caller must be PELAPOR with `nikVerifiedAt != null`, else 403 (BR-111).

### GET /api/complaints [PUBLIC]

**Query** `QueryComplaintDto extends PaginationDto`: `search?: string (@MaxLength(50))`, `category?: ComplaintCategory @IsEnum()`, `status?: ComplaintStatus @IsEnum()` → service forces `status IN (FORWARDED, IN_PROGRESS, DONE)` regardless; anything outside → 400 `Status is not public` (BR-118, no PENDING/REJECTED enumeration).

**Response** — `Paginated(data, meta)`; item: whitelist per BR-121 (`id, category, title, status, late, upCount, lat, lng, addressNote, maskedName, createdAt, forwardedAt`).

**Rules**: two selects `$transaction([findMany, count])`, exact same `where`; `mode:'insensitive'` OK on PG; duplicates included as rows (duplicates are only excluded from dashboard problem counts, BR-125). No auth header needed.

### GET /api/complaints/map [PUBLIC]

Same as list, force status filter, sort `createdAt desc`, custom `QueryMapDto extends PaginationDto` with `limit @Max(1000)`. Response items `{ id, lat, lng, category, status, late }` only (points on map).

### GET /api/complaints/mine [AUTH]

`QueryMineComplaintDto extends PaginationDto`: filters `status? @IsEnum()`. Service returns ALL statuses for own rows; item shape adds `rejectReason?` and `agency? {id,name}`. Paginated.

### GET /api/complaints/:id [PUBLIC]

**Response** — shape rules by caller identity (BR-121):
- Anonymous / non-owner PELAPOR / AGENCY (any) / PIMPINAN: list whitelist fields (flat `lat/lng`, `upCount`, `late`) + `description`, `occurredAt`, `photos [{kind, url}]` and `timeline [{type, createdAt}]`; no `rejectReason`, no reporter name. PENDING/REJECTED → 404 for every one of these callers (a PIMPINAN sees public states only — owner decision 2026-10-22).
- The reporter (logged in, `me.id === reporterId`): the same shape + `rejectReason`, full timeline notes, and own PENDING/REJECTED visibility.
- The owning AGENCY (`me.agencyId === complaint.agencyId`): the anonymous shape extended with `description`, `occurredAt`, `photos` (its inbox work context) — never `rejectReason` (BR-121: owner and CITY_ADMIN only).
- CITY_ADMIN only: the full shape + reporter real name and `nikVerified: true` presence flag; the NIK hash never leaves the service. PIMPINAN never receives the real name — masked everywhere.

**Errors**: 404 when the row does not exist OR is hidden from the caller (PENDING/REJECTED from unknown, BR-118; other-agency from AGENCY, BR-124).

**Rules**: single `select` + guarded timeline via nested `select`/`orderBy createdAt asc`; no N+1.

### POST /api/complaints/:id/up [AUTH]

`@HttpCode(200)`, body none. **Response** 200 `MessageResponse({ upCount })`. **Rules**: one-up-per-account: unique `@@id([userId, complaintId])`; the create is `create()` and P2002 caught per spec → re-read count → return idempotently (double-tap PRD EC-4); only visible states FORWARDED/IN_PROGRESS/DONE (else 400 `Complaint is not public`). Concurrency: DB unique index is the source of truth, not a JS check.

### GET /api/complaints/verification-queue [CITY_ADMIN]

Only `PENDING`, `createdAt: 'asc'` (oldest first). `QueryVerificationQueueDto extends PaginationDto`: filters `search?` by title. Item adds reporter real name + `late` (verification already overdue); NIK presence is an invariant on this queue (every reporter is verified — BR-111), the `nikVerified` flag appears only on the CITY_ADMIN detail shape. Paginated.

### POST /api/complaints/:id/forward [CITY_ADMIN]

**Body** `ForwardComplaintDto { agencyId: uuid @IsUUID() }`. **Response** 200 `MessageResponse(complaint)`; sets `agencyId`, `status='FORWARDED'`, `forwardedAt=now`, `handleDueAt=now+5d`, timeline `ASSIGNMENT`, notifies reporter + agency. Conditional `updateMany({ id, status: 'PENDING' })`; `count === 0` → re-read: 404 only when the complaint (or its ownership context) no longer exists, 400 `Invalid status change` when the source status changed (BR-123). Other errors: 404 `Agency not found`, 400 `Agency is not active`, 400 validation. Transaction: complaint update + timeline + notifications.

### POST /api/complaints/:id/reject [CITY_ADMIN]

**Body** `RejectComplaintDto { reason: string @Length(5,500) }`. Sets `REJECTED`, stores reason in `respondedNote` + timeline `STATUS_CHANGE note`, notifies reporter. Transaction: complaint update (reason) + timeline + notifications. Same conditional-write discipline and 404/400 disambiguation as forward (BR-123).

### POST /api/complaints/:id/reassign [CITY_ADMIN]

**Body** `ReassignComplaintDto { agencyId: uuid }`. Only `FORWARDED` (PRD decision: not IN_PROGRESS). Sets `agencyId` (same status), timeline `ASSIGNMENT`, notifies new agency + reporter. Transaction: complaint update + timeline + notifications. Errors: 404/400 `Invalid status change` (same disambiguation as forward, BR-123), 400 `Agency is not active`, 404 `Agency not found`.

### POST /api/complaints/:id/mark-duplicate [CITY_ADMIN]

**Body** `MarkDuplicateDto { mainId: uuid @IsUUID() }`. Marks `:id` as a duplicate of main: sets `duplicateOfId`, no content merge, reporter keeps ownership; rejects if `mainId === id` → 400 `A complaint cannot reference itself`; main must not itself have a `duplicateOfId` (no chains) → 400 `Main complaint is a duplicate`. Write is a conditional `updateMany({ id, duplicateOfId: null })` (BR-123 discipline): `count === 0` → re-read — same `duplicateOfId` as requested → idempotent 200 unchanged, a different value or unexpected state → 400 `Duplicate already marked`; a parallel admin's mark can never produce two different values. Notifies nothing (BR-125 read-only reference).

### GET /api/complaints/assignments [AGENCY]

Filter rows by `agencyId = me.agencyId`, plus `QueryAssignmentDto`: `status? @IsEnum()`, `openOnly? @ToBoolean()+@IsBoolean()` (= FORWARDED/IN_PROGRESS). Item shape: whitelist + `occurredAt, description, lat, lng, addressNote, photos` — but **masked reporter only** (BR-121: AGENCY never gets real name). Paginated.

### POST /api/complaints/:id/start [AGENCY]

Ownership + `status='FORWARDED'` guard via `updateMany({ id, agencyId: me.agencyId, status: 'FORWARDED' })`. Sets `IN_PROGRESS`, timeline `STATUS_CHANGE`, notify reporter `COMPLAINT_IN_PROGRESS`. Transaction: complaint update + timeline + notification. Errors: 404 (not found OR not mine, BR-124) / 400 `Invalid status change`.

### POST /api/complaints/:id/notes [AGENCY]

**Body** `AddProgressNoteDto { note: string @Length(5,2000) }`. While `IN_PROGRESS` (ownership check like start). Creates a timeline row `PROGRESS_NOTE` only; status unchanged. 201 `MessageResponse({ timelineEntry })` — 201 because the endpoint creates a timeline resource (create case of `nest-response-and-errors` rule 8).

### POST /api/complaints/:id/done [AGENCY]

Ownership + `IN_PROGRESS` guard + asserts ≥1 AFTER photo (BR-129, else 400 `After photo required`). Sets `DONE`, timeline, notify reporter. Transaction: complaint update + timeline + notification. Errors: 404 / 400 `Invalid status change` / 400 `After photo required`.

### POST /api/complaints/:id/photos [AUTH]

**Body** `AddComplaintPhotoDto { ticketId: uuid, kind: 'BEFORE'|'AFTER' @IsEnum(ComplaintPhotoKind) }`.

**Rules** (and 403 reasons): staff accounts (CITY_ADMIN/PIMPINAN) → 403 `Staff accounts cannot attach photos`. Branches: `kind=BEFORE` requires `me.id === complaint.reporterId` AND status PENDING (else 403 `Not your complaint` / 400 `Invalid status change`); `kind=AFTER` requires `me.role === 'AGENCY'`, `me.agencyId === complaint.agencyId` AND status IN_PROGRESS (else 403 / 400).

| kind | Allowed caller | Allowed status |
|---|---|---|
| BEFORE | the reporter himself | PENDING (his own complaint) |
| AFTER | AGENCY owning the complaint (`me.agencyId === complaint.agencyId`) | IN_PROGRESS |

Claimed ticket required, ordered for short transactions (`nest-prisma` rule 11 spirit): the Cloudinary Admin API asset re-check runs **before** the DB transaction; inside the transaction the ticket claim (`updateMany` on `claimedById`: unclaimed and younger than 24 h; count 0 → 400 `Upload ticket is already used`) → photo row create. A failed asset check leaves the ticket unconsumed. `publicId` unique → 409 via filter if double-attached. Max BEFORE = 3, max AFTER = 3 (count checks inside the same transaction) → 400 `Too many before photos` / `Too many after photos`.

### POST /api/uploads/tickets [AUTH]

**Body** `CreateUploadTicketDto { purpose: 'BEFORE'|'AFTER' @IsEnum(UploadPurpose) }`. Response 201 `MessageResponse({ ticketId, publicId, url, apiKey, timestamp, signature, folder })` — a one-time signed Cloudinary target (JPG/PNG/WebP ≤ 5 MB, enforced client-side; the backend re-checks via the Cloudinary Admin API at claim time and rejects a mismatched asset without consuming the ticket). Ticket lifecycle per BR-136: claimable once, purpose-matched, valid 24 h after issuance; unknown/expired → 400 `Upload ticket invalid`, already claimed → 400 `Upload ticket is already used`, wrong purpose → 400 `Upload ticket purpose mismatch`.

### POST /api/users/:id/deactivate [CITY_ADMIN]

**Body** `DeactivateUserDto { reason: string @Length(5,500) }`. Sets `isActive:false` + `tokenVersion +1` + `AccountBlock` row in one `$transaction` (BR-130). Cannot deactivate a CITY_ADMIN/PIMPINAN account → 403 `You cannot disable this account` (self-protection). Notify target `ACCOUNT_DEACTIVATED`. Errors: 404 `User not found`, 400 validation, 403.

### GET /api/users [CITY_ADMIN]

Query `QueryUserDto extends PaginationDto`: `search?` in name+email, `isActive? @ToBoolean(), role? @IsEnum(Role)`. Whitelist shape (no `passwordHash`, `tokenVersion`; `nikVerifiedAt` OK). Paginated. Staff-only.

### GET /api/dashboards/public [PUBLIC]

Buckets: `byStatus { FORWARDED, IN_PROGRESS, DONE }`, `byCategory (8)`, `totalUniqueProblems` (excludes duplicates, BR-125), `totalResolved`. All computed with one `groupBy` each (or `count` batched in a `$transaction([...])`); no PII anywhere (BR-121).

### GET /api/dashboards/admin [CITY_ADMIN]

Buckets: `pendingQueueCount`, `lateCount` (BR-127 predicate), `lateByAgency [{agencyId, name, late, avgHandlingDays}]` (computed from rows, no PII), `avgVerificationHours`, `avgHandlingHours`, `escalatedCount`. One set of `findMany`-with-select + aggregation reads in one transaction.

### GET /api/dashboards/leadership [PIMPINAN]

Buckets: `escalated [{id, title, category, agency? {id,name}, status, late, levels {verification, handling}, dueAt}]`, `lateByAgency [{id, name, lateCount, avgHandlingDays}]`, `lateByCategory`, `milestoneCounts { one, two }` (counted across both stage counters), `monthlyVolume (12)`. Read-only; no reporter identity anywhere (masked everywhere for PIMPINAN per owner decision 2026-10-22).

## Access matrix

Roles = PELAPOR / CITY_ADMIN / AGENCY / PIMPINAN (+ ANON anonymous). `–` = not in the table. `own` = role + ownership check in service (rule 8).

| Endpoint | ANON | PELAPOR | CITY_ADMIN | AGENCY | PIMPINAN |
|---|---|---|---|---|---|
| POST /auth/register, verify-otp, login, etc. | allow | allow | allow | allow | allow |
| GET /auth/me, change-password, logout-all | deny | allow | allow | allow | allow |
| POST /profiles/identity | deny | allow | deny (RolesGuard) | deny | deny |
| POST /complaints | deny | allow (NIK-verified only) | deny | deny | deny |
| GET /complaints, /map | allow (public states) | allow | allow | allow | allow |
| GET /complaints/:id | allow (public states) | allow (public + own) | allow (all) | allow (public + own agency) | allow (public states, masked) |
| GET /complaints/mine | deny | allow | allow | allow | allow |
| POST /complaints/:id/up | deny | allow | allow | allow | allow |
| GET /complaints/verification-queue, forward, reject, reassign, mark-duplicate | deny | deny | allow | deny | deny |
| GET /complaints/assignments, /:id/start, /:id/notes, /:id/done | deny | deny | deny | own | deny |
| GET /complaints/suggestions (STRETCH) | deny | allow | deny | deny | deny |
| POST /complaints/:id/photos | deny | own BEFORE | deny (staff never attach photos) | own AFTER | deny |
| POST /uploads/tickets | deny | allow | allow | allow | allow |
| GET /agencies, /agencies/:id | deny | allow | allow | allow | allow |
| GET /users, /users/:id/deactivate, /users/:id/blocks | deny | deny | allow | deny | deny |
| GET /notifications (all 4) | deny | own | own | own | own |
| GET /dashboards/public | allow | allow | allow | allow | allow |
| GET /dashboards/admin | deny | deny | allow | deny | deny |
| GET /dashboards/leadership | deny | deny | deny | deny | allow |
| GET /health | allow | allow | allow | allow | allow |
| Socket /realtime | deny | own | own | own | own |

## Coverage matrix

| Feature | Endpoints |
|---|---|
| F-AUTH-1..7 | /auth (rule 21 set) |
| F-PROFILES-1..2 | POST /profiles/identity; GET /auth/me — F-PROFILES-2 is registration-locked data, read-only (no update endpoint) |
| F-COMPLAINTS-1 | POST /complaints; POST /uploads/tickets; POST /complaints/:id/photos (BEFORE) |
| F-COMPLAINTS-2 | POST /complaints/:id/up |
| F-COMPLAINTS-3 | GET /complaints |
| F-COMPLAINTS-4 | GET /complaints/map |
| F-COMPLAINTS-5 | GET /complaints/:id |
| F-COMPLAINTS-6 | GET /complaints/mine |
| F-COMPLAINTS-7 | GET /complaints/verification-queue, POST :id/forward, POST :id/reject |
| F-COMPLAINTS-8 | POST /complaints/:id/reassign |
| F-COMPLAINTS-9 | POST /complaints/:id/mark-duplicate |
| F-COMPLAINTS-10 | GET /complaints/assignments |
| F-COMPLAINTS-11 | POST :id/start, :id/notes, :id/done |
| F-COMPLAINTS-12 | GET /complaints (late flag), /:id, /mine, dashboards |
| F-COMPLAINTS-13 | cron (no endpoint; timeline + notifications via /notifications) |
| F-COMPLAINTS-14 | GET /dashboards/public, /admin, /leadership |
| F-COMPLAINTS-15 | POST /uploads/tickets, POST /complaints/:id/photos |
| F-COMPLAINTS-16 | GET /complaints/suggestions ([STRETCH], out of MVP surface) |
| F-USERS-1 | POST /users/:id/deactivate, GET /users/:id/blocks |
| F-USERS-2 | GET /users |
| F-AGENCIES-1..2 | GET /agencies, GET /agencies/:id (seed) |
| F-NOTIFICATIONS-1..3 | GET /notifications, /unread-count, POST :id/read, /read-all |
| F-NOTIFICATIONS-4 | /realtime gateway |
| BR-135 | GET /health |

Orphan check: every endpoint above maps to exactly one feature; no endpoint without a feature; no feature without an endpoint (F-COMPLAINTS-13 is a scheduled job — covered by dashboards + notifications; F-COMPLAINTS-16 is an explicitly declared stretch row). No orphans.

## Test targets (BR → service method + exception)

| BR | Service method | Expected |
|---|---|---|
| BR-101 | AuthService.register | 409 `Email is already registered` |
| BR-102 | RegisterDto / ChangePasswordDto upload | 400 (MaxLength) |
| BR-103 | AuthService.login | 401 identical `Invalid credentials`; 403 status after password |
| BR-104 | OtpService.claim/verify | 400 after 5 attempts; 401/400 on wrong code; 503-like never |
| BR-105 | AuthService.change-password / logout-all | tokenVersion claim in JWT; 401 with stale token |
| BR-106 | profile select shapes | no secrets in payload (spec test) |
| BR-107 | ProfilesService.verifyIdentity | 400 unknown NIK; 409 bound; staff blocked by `@Roles('PELAPOR')` (403 from RolesGuard) |
| BR-108..110 | reserved — not used | – |
| BR-111 | ComplaintsService.create | 403 `Verify your NIK first` / 403 staff submit |
| BR-112 | ComplaintsService.create (counter claim) | 400 `Daily complaint limit reached` for the 4th submit, including 4 parallel submits |
| BR-113 | ComplaintsService geofence helper | 400 `Location must be inside Kota Malang` |
| BR-114 | CreateComplaintDto | 400 occurredAt future / lengths |
| BR-115 | ComplaintsService.forward | `OTHER` accepted → still needs agencyId at forward (assignment step) |
| BR-116 | CloudinaryPort attachments | 400 wrong purpose / corrupt ticket; MIME magic-byte assert |
| BR-117 | complaint row is masked at create | visible in any payload, never recompute |
| BR-118 | ComplaintsService.findAll / findOne | 400 `Status is not public`; PENDING/REJECTED hidden → 404 |
| BR-119 | ComplaintsService.up | unique; idempotent 200 with same count |
| BR-120 | ComplaintsService.forward / reassign | agencyId always set with a timeline entry (ASSIGNMENT) |
| BR-121 | whitelist select shapes | no NIK/email/real-name in public payloads (spec test) |
| BR-122 | timeline rows on every transition | row created; no update/delete endpoints |
| BR-123 | all transition endpoints | conditional updateMany; count 0 → 400/404 |
| BR-124 | AGENCY routes | 404 other-agency |
| BR-125 | ComplaintsService.markDuplicate | duplicateOfId set; dashboards exclude duplicates; no chain |
| BR-126 | create/forward writes | verifyDueAt/handleDueAt values exact (+3d/+5d) |
| BR-127 | late helper | flag true on overdue open state |
| BR-128 | EscalationService.run | per-(stage, milestone) claims on `verificationEscalationLevel` / `handlingEscalationLevel`; no duplicate notifications; both stages fully fire when consecutive |
| BR-129 | ComplaintsService.done | 400 `After photo required` before approval |
| BR-130 | UsersService.deactivate | transaction row + tv bump; target 401 on next request |
| BR-131 | NotificationsService.notify callers | recipients from DB only |
| BR-132 | ThrottlerGuard setup | auth endpoints 429 beyond tier |
| BR-133 | env.schema.ts | throttle values from env overrides |
| BR-134 | no logs of codes/emails; mask on errors | spec/lint check |
| BR-135 | HealthService | 200 vs 503 |
| BR-136 | UploadsService.claim | 400 `Upload ticket invalid` (unknown/24h+), `Upload ticket is already used` (double claim), `Upload ticket purpose mismatch` |

## Project env vars (`src/config/env.schema.ts`)

| Key | Requirement |
|---|---|
| DATABASE_URL, PORT, NODE_ENV, FRONTEND_URL, JWT_SECRET, JWT_EXPIRES_IN, TRUST_PROXY_HOPS | base (`nest-validation-and-config`) |
| OTP_SENDER | enum `resend` / `console` (auth rule 23) |
| OTP_TTL_MINUTES | `.default(10)` (BR-104) |
| OTP_RESEND_COOLDOWN_SECONDS | `.default(60)` (BR-104) |
| MAX_OTP_ATTEMPTS | `.default(5)` (BR-104) |
| RESEND_API_KEY | `.required()` when OTP_SENDER=resend |
| MAIL_FROM | required when OTP_SENDER=resend |
| THROTTLE_DEFAULT_LIMIT | `.default(100)` (per minute, global tier — BR-133) |
| THROTTLE_AUTH_LIMIT | `.default(5)` (per minute, auth endpoints — BR-133) |
| THROTTLE_SEND_CODE_LIMIT | `.default(3)` (per minute, resend-otp — BR-133) |
| CLOUDINARY_CLOUD_NAME | required |
| CLOUDINARY_API_KEY | required |
| CLOUDINARY_API_SECRET | required |
| CLOUDINARY_FOLDER | `.default('sigap-lapor')` (idle override; not `required()` XOR `default()` — Joi one-behaviour rule) |
| MALANG_MIN_LAT, MALANG_MAX_LAT, MALANG_MIN_LNG, MALANG_MAX_LNG | numbers with Joi `.default()` — placeholder values, verified visually on Leaflet during implementation (owner decision 2026-10-22) |
| ESCALATION_CRON_MINUTES | `.default(15)` (BR-128) |
| ESCALATION_STEP_2_DAYS | `.default(2)` (BR-128 milestone-2 offset) |

Seed (`prisma/seed.ts`): city admin/agency/pimpinan accounts from `ADMIN_SEED_*`-style env (no default password, `created verified`), agencies list; never PELAPOR.

Self-check against the prompt's 7 constraints:

1. Every route has a guard decision; prefixes derived from guards. **pass** (ownership notes in descriptions; `/uploads/tickets` [AUTH] all roles; profiles [PELAPOR]; photos [AUTH] with service-gated kind branches per rule 12).
2. kebab-case plural, `/api`, state changes `POST :id/<verb>` 200, profile under `/auth/me`. **pass** (`:id/notes` returns 201 because it creates a resource; noted deviation).
3. Every list pagination + filters; every `:id` uuid pipe. **pass** (`/uploads/tickets` has no `:id`; `/complaints/map` overrides limit max).
4. Throttle on auth/code endpoints per rule 10; none at class level. **pass** (rule 10 table followed exactly: send-code endpoints `resend-otp` = 3 + DB cooldown; login/register/verify/forgot/reset/change = 5).
5. Auth endpoints from the skill's table; only PRD-enabled additions (none: no Google, no refresh). **pass**.
6. No privileged fields accepted from bodies anywhere. **pass**.
7. No account-existence leak. **pass** (identical messages; register 409 is the documented exception).

Gaps in PRD: none unresolved while writing the fixes; spec-level decisions live in the endpoints above (POST :id/notes 201 justification, suggestions stretch row) and in `DATA_MODEL.md` §Notes (`DailyComplaintCounter`, stage escalation counters, `UploadTicket`, BR-136). No PRD section is contradicted.
