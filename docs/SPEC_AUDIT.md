# SPEC_AUDIT — SIGAP Lapor (PRD / DATA_MODEL / API_SPEC) — rev 2 (third audit cycle)

Reviewer: independent spec audit, third cycle. This cycle re-verified the full second-cycle fix package item by item (BR-112 create-first claim recipe, PIMPINAN locked to public states, F-PROFILES-2 registration-locked, verification milestone-2 mute semantics, `lateByAgency` on `/dashboards/leadership`, BR-137 with open-states definition, PRD §4.6 notification type→recipients table, NIK-presence queue invariant, `CLOUDINARY_FOLDER` `.default`, transaction statements on start/done/reassign, uploads claim re-check moved before the transaction, identity 200-replay documentation, photos 403 staff message + exact branches, updated coverage/access matrices). The complete checklist was re-run, not only the fixes. Source of truth: the 7 skills under `apps/backend/.opencode/skills/` (+ `references/test-recipes.md`, `websocket-auth.md`); skill wins on contradiction.

## Verdict: READY

## Findings

| # | Severity | Doc + section | Problem | Suggested fix |
|---|---|---|---|---|
| 1 | minor | API_SPEC POST /complaints/:id/reject | Reject is a multi-step write (status update + `respondedNote` + timeline `STATUS_CHANGE` + notification) but its section does not restate a `Transaction:` line — it defers to forward ("Same conditional-write discipline and 404/400 disambiguation as forward"), and forward carries the transaction statement. An implementer reading reject alone must infer the transaction scope from another endpoint. | Add one line to the reject section: `Transaction: complaint update (reason) + timeline + notifications`, mirroring forward/reassign/start/done. Non-blocking; everything else about reject (reason ≥ 5, final state, reporter notification) is single-sourced. |

No other findings. All previously reported blockers and majors are resolved and verified coherent across all three docs.

## PASS checklists

### BR-112 daily-limit claim (create-first recipe) — PASS
- PRD BR-112, DATA_MODEL §Notes 4, and API_SPEC POST /complaints Rules state the identical create-first sequence: (1) `create({ userId, day, count: 1 })` — on P2002 (2) conditional `updateMany({ count < 3 }, increment 1)`; 0 affected → 400 `Daily complaint limit reached`.
- First submit of a WIB day succeeds via step 1; the day-rollover parallel race (both submitters miss the row, one P2002) resolves through step 2; the 4th concurrent submit fails at step 2 with 400. SC-3/EC-3 are now testable against the text in all three docs.

### PIMPINAN visibility class — PASS (coherent in every place it appears)
- BR-118: `PENDING`/`REJECTED` are owner/CITY_ADMIN-only; AGENCY, PIMPINAN and anonymous callers get 404 on those states.
- PRD role table + capability breakdown: PIMPINAN denied "reading PENDING/REJECTED complaints (404)", real name masked everywhere; allowed — public list/map/detail, Up, own notifications + realtime, `/dashboards/leadership` (with late-by-agency with duration), agency list/detail, health.
- F-COMPLAINTS-5 (masked name only), F-COMPLAINTS-10 (AGENCY never real name — SC-2), F-COMPLAINTS-14 (PIMPINAN bucket matches the leadership endpoint), API module rows (`[PIMPINAN]` on `/dashboards/leadership` only), GET /:id bullets ("PENDING/REJECTED → 404 for every one of these callers... PIMPINAN sees public states only — owner decision 2026-10-22"; "PIMPINAN never receives the real name"), access matrix (leadership: allow for PIMPINAN only; verification-queue/forward/reject/reassign/mark-duplicate: deny), dashboards (leadership read-only, no reporter identity).

### Notifications: type→recipients table vs per-endpoint sentences — PASS
- PRD §4.6 table: submit → `COMPLAINT_NEW` (all CITY_ADMINs); forward → `COMPLAINT_FORWARDED` (reporter) + `AGENCY_ASSIGNED` (agency); reject → `COMPLAINT_REJECTED` (reporter); reassign → `AGENCY_ASSIGNED` (new agency) + `COMPLAINT_FORWARDED` (reporter); start → `COMPLAINT_IN_PROGRESS` (reporter); done → `COMPLAINT_DONE` (reporter); milestone 1 → `COMPLAINT_LATE_ADMIN` (CITY_ADMINs); milestone 2 → `COMPLAINT_LATE_LEADERSHIP` (PIMPINANs); deactivate → `ACCOUNT_DEACTIVATED` (target).
- Every API endpoint sentence matches: forward "notifies reporter + agency", reject "notifies reporter", reassign "notifies new agency + reporter", start "notify reporter COMPLAINT_IN_PROGRESS", done "notify reporter", deactivate "Notify target ACCOUNT_DEACTIVATED". No contradiction.

### BR numbering & traceability — PASS
- 101–107 (auth/identity), 111–136 (complaints/dashboards/uploads/moderation), 137 (stretch, similar suggestions) present; 108–110 explicitly reserved. No duplicate or conflicting ids.
- F-COMPLAINTS-16 → BR-137 in the PRD traceability table and in both API matrices (module table + coverage, marked `[STRETCH]` out of the MVP surface).

### Escalation anchor + mute semantics — PASS
- BR-128: milestone 2 fires when `now > stageDueAt + ESCALATION_STEP_2_DAYS` (anchored to the stage going overdue, not the milestone-1 send); each stage's level accrues only while its stage is open — verification milestones muted once the complaint leaves PENDING, handling likewise after DONE/REJECTED; conditional `updateMany` (`level < milestone`) claim prevents cron-restart double-notify; timeline ESCALATION per claim.
- DATA_MODEL §Notes 2 restates the same anchor and mute wording; F-COMPLAINTS-13 ("still overdue +2 days", per-stage counters, no repeats) is consistent; dashboards `milestoneCounts` counted across both stage counters and leadership `levels {verification, handling}` match the two independent columns.

### rejectReason grant — PASS
- BR-121: `rejectReason` only for the owner or CITY_ADMIN. GET /:id: the owning AGENCY's extended shape explicitly "never `rejectReason` (BR-121: owner and CITY_ADMIN only)"; the anonymous/non-owner/PIMPINAN shape has no `rejectReason`. `/complaints/mine` returns own rows only, so its `rejectReason?` add-on serves exactly the owner. No contradiction.

### Concurrency & transactions — PASS
- Every multi-step write carries a transaction statement: create (one interactive `$transaction`: daily claim → ticket claims → complaint + BEFORE photo rows → timeline → notification; geofence + occurredAt checks before it), forward, reassign, start, done (complaint + timeline + notification), photos (asset re-check **before** the transaction; ticket claim + photo row inside it), deactivate (`isActive:false` + `tokenVersion+1` + `AccountBlock` row in one transaction), identity (hash lookup, then conditional `updateMany` transaction with idempotent 200 on lost race). Only residual: reject by reference (finding #1).
- Remaining concurrency rules defined: one-up double-tap (unique `@@id` + P2002 → idempotent re-read), upload-ticket claim race (`updateMany` count 0 → already used; ticket unconsumed on mismatch), escalation cron restart (per-(stage, milestone) level claim), forward/reject/reassign two-admin races (conditional `updateMany` on source status with 404/400 disambiguation), mark-duplicate double mark (conditional `updateMany({ duplicateOfId: null })`, idempotent same-value / 400 different-value), agency double-tap on start/done, daily-limit create-first claim (see above).

### Env table & Joi — PASS
- Base keys (DATABASE_URL…TRUST_PROXY_HOPS), `OTP_SENDER`, `OTP_TTL_MINUTES`, `OTP_RESEND_COOLDOWN_SECONDS`, `MAX_OTP_ATTEMPTS`, `RESEND_API_KEY` (required when sender=resend), `MAIL_FROM`, `THROTTLE_DEFAULT/AUTH/SEND_CODE_LIMIT`, `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` (required), `CLOUDINARY_FOLDER` (`.default('sigap-lapor')` — one behaviour, not required-XOR-default), `MALANG_*` ×4 (Joi `.default()`, placeholders verified visually per owner decision), `ESCALATION_CRON_MINUTES` (15), `ESCALATION_STEP_2_DAYS` (2). Seed-only `ADMIN_SEED_*` kept out of the boot schema. Every env mention resolves to exactly one schema entry; no key with two behaviours.

### Status codes — PASS
- 201 creates: register, complaints, tickets, photos, notes (justified inline as the create case of `nest-response-and-errors` rule 8), identity first verification.
- 200 non-create POSTs with `@HttpCode(200)`: verify-otp/login/forgot/reset/change, up, forward/reject/reassign/mark-duplicate/start/done, read/read-all. Identity idempotent replay returns 200 — documented both in the module row ("201 (200 on idempotent replay)") and in the endpoint detail, so the single-source rule holds.
- 409 duplicates: register, NIK already bound, photo `publicId` double-attach. 400/404 disambiguation on conditional writes is consistent across forward/reject/reassign/start/done/mark-duplicate.

### Shapes & masking — PASS
- Whitelist select shapes everywhere; no NIK hash, no email, no phone, no real name in any public payload; CITY_ADMIN is the only real-name recipient (`nikVerified` presence flag only on the CITY_ADMIN detail). Verification queue shows NIK presence as a documented invariant (every reporter verified per BR-111) with `late` kept. AGENCY always masked (SC-2). PIMPINAN masked everywhere.

### Coverage / access matrices — PASS
- Every F-ID maps to endpoints and BRs in both PRD §11 and the API coverage matrix; no orphans (F-COMPLAINTS-13 = scheduled job covered via dashboards + notifications; F-COMPLAINTS-16 = declared stretch row). Access matrix rows align with the capability breakdown for all five caller classes including PIMPINAN and the `[AUTH]`-guard-with-service-gating photos row.

## Owner questions

None — all previously open questions are settled by documented owner decisions (2026-10-22) in the PRD: PIMPINAN public-states-only visibility, profile data registration-locked, escalation deadline constants vs env-overridable keys, create-first daily claim ordering, `lateByAgency` added to the leadership bucket, and BR-137 open-states definition. The single remaining finding (#1) is a one-line editorial fix that needs no decision.
