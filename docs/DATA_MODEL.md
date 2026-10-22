# DATA_MODEL — SIGAP Lapor

Source: `docs/PRD.md` (this app) + skills `nest-prisma`, `nest-auth-and-security`, `nest-validation-and-config`. ID type: **uuid** (`@default(uuid()) @db.Uuid`, pipes `ParseUUIDPipe`); database: **PostgreSQL** (`mode: 'insensitive'` allowed). Soft delete: none (PRD decision) — every relation gets an explicit `onDelete`.

## Prisma schema draft

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../generated/prisma"
  moduleFormat = "cjs"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  PELAPOR
  CITY_ADMIN
  AGENCY
  PIMPINAN
}

enum ComplaintCategory {
  INFRASTRUCTURE
  WASTE
  DRAINAGE
  PUBLIC_ORDER
  PUBLIC_FACILITY
  PUBLIC_SERVICE
  MISCONDUCT
  OTHER
}

enum ComplaintStatus {
  PENDING
  FORWARDED
  IN_PROGRESS
  DONE
  REJECTED
}

enum ComplaintPhotoKind {
  BEFORE
  AFTER
}

enum ComplaintTimelineType {
  STATUS_CHANGE
  ASSIGNMENT
  PROGRESS_NOTE
  ESCALATION
}

enum NotificationType {
  COMPLAINT_NEW
  COMPLAINT_FORWARDED
  COMPLAINT_IN_PROGRESS
  COMPLAINT_DONE
  COMPLAINT_REJECTED
  COMPLAINT_LATE_ADMIN
  COMPLAINT_LATE_LEADERSHIP
  AGENCY_ASSIGNED
  ACCOUNT_DEACTIVATED
}

enum OtpPurpose {
  EMAIL_VERIFICATION
  PASSWORD_RESET
}

enum UploadPurpose {
  BEFORE
  AFTER
}

model User {
  id             String    @id @default(uuid()) @db.Uuid
  email          String    @unique
  passwordHash   String
  name           String
  phone          String?
  role           Role      @default(PELAPOR)
  isActive       Boolean   @default(true)
  emailVerifiedAt DateTime?
  nikVerifiedAt  DateTime?
  tokenVersion   Int       @default(0)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  nikProfile    NikProfile?
  agency        Agency?     @relation(fields: [agencyId], references: [id], onDelete: SetNull)
  agencyId      String?     @db.Uuid
  complaints    Complaint[] @relation("ComplaintReporter")
  photos        ComplaintPhoto[]
  timeline      ComplaintTimeline[] @relation("ComplaintTimelineActor")
  notifications Notification[]
  blocksIssued  AccountBlock[] @relation("AccountBlockModerator")

  @@map("users")
}

model NikProfile {
  id        String   @id @default(uuid()) @db.Uuid
  nikHash   String   @unique
  domicile  String
  verifiedAt DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  userId    String   @unique @db.Uuid
  user      User     @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@map("nik_profiles")
}

model Agency {
  id        String   @id @default(uuid()) @db.Uuid
  name      String   @unique
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  users     User[]

  @@map("agencies")
}

model Complaint {
  id              String   @id @default(uuid()) @db.Uuid
  category        ComplaintCategory
  title           String
  description     String
  occurredAt      DateTime
  addressNote     String?
  lat             Float
  lng             Float
  maskedName      String
  status          ComplaintStatus @default(PENDING)
  verificationEscalationLevel Int @default(0)
  handlingEscalationLevel     Int @default(0)
  verifyDueAt     DateTime
  forwardedAt     DateTime?
  handleDueAt     DateTime?
  respondedNote   String?      // reject reason lives in timeline; kept for quick reads
  duplicateOfId   String?  @db.Uuid
  agencyId        String?  @db.Uuid
  reporterId      String   @db.Uuid
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  duplicateOf  Complaint?  @relation("ComplaintDuplicates", fields: [duplicateOfId], references: [id], onDelete: SetNull)
  duplicates   Complaint[] @relation("ComplaintDuplicates")
  reporter     User        @relation("ComplaintReporter", fields: [reporterId], references: [id], onDelete: Restrict)
  agency       Agency?     @relation(fields: [agencyId], references: [id], onDelete: SetNull)
  photos       ComplaintPhoto[]
  timeline     ComplaintTimeline[]
  ups          ComplaintUp[]

  @@index([status, createdAt])
  @@index([reporterId])
  @@index([agencyId, status])
  @@map("complaints")
}

model ComplaintPhoto {
  id          String   @id @default(uuid()) @db.Uuid
  kind        ComplaintPhotoKind
  publicId    String   @unique
  url         String
  uploadedById String  @db.Uuid
  complaintId String   @db.Uuid
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  complaint   Complaint @relation(fields: [complaintId], references: [id], onDelete: Cascade)
  uploader    User      @relation(fields: [uploadedById], references: [id], onDelete: Restrict)

  @@index([complaintId])
  @@map("complaint_photos")
}

model ComplaintTimeline {
  id          String   @id @default(uuid()) @db.Uuid
  type        ComplaintTimelineType
  oldStatus   ComplaintStatus?
  newStatus   ComplaintStatus?
  note        String?
  actorId     String?  @db.Uuid
  complaintId String   @db.Uuid
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  complaint   Complaint @relation(fields: [complaintId], references: [id], onDelete: Cascade)
  actor       User?     @relation("ComplaintTimelineActor", fields: [actorId], references: [id], onDelete: SetNull)

  @@index([complaintId])
  @@map("complaint_timeline")
}

model ComplaintUp {
  userId      String @db.Uuid
  complaintId String @db.Uuid
  createdAt   DateTime @default(now())
  complaint   Complaint @relation(fields: [complaintId], references: [id], onDelete: Cascade)
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, complaintId])
  @@map("complaint_ups")
}

model AccountBlock {
  id        String   @id @default(uuid()) @db.Uuid
  reason    String
  moderatorId String @db.Uuid
  userId    String   @db.Uuid
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Restrict)
  moderator User     @relation("AccountBlockModerator", fields: [moderatorId], references: [id], onDelete: SetNull)

  @@index([userId])
  @@map("account_blocks")
}

model Notification {
  id         String    @id @default(uuid()) @db.Uuid
  type       NotificationType
  title      String
  body       String
  entityType String?// snapshot only, no FK ("complaint")
  entityId   String?   @db.Uuid
  readAt     DateTime?
  userId     String    @db.Uuid
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, readAt])
  @@map("notifications")
}

model OtpCode {
  id        String    @id @default(uuid()) @db.Uuid
  purpose   OtpPurpose
  codeHash  String
  attempts  Int       @default(0)
  expiresAt DateTime
  usedAt    DateTime?
  userId    String    @db.Uuid
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, purpose, createdAt])
  @@map("otp_codes")
}

model UploadTicket {
  id          String   @id @default(uuid()) @db.Uuid
  publicId    String   @unique
  folder      String
  purpose     UploadPurpose
  requestedById String @db.Uuid
  claimedById String?  @db.Uuid
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  requester   User     @relation("UploadTicketRequester", fields: [requestedById], references: [id], onDelete: Restrict)
  claimer     User?    @relation("UploadTicketClaimer", fields: [claimedById], references: [id], onDelete: Restrict)

  @@index([requestedById])
  @@map("upload_tickets")
}

model DailyComplaintCounter {
  userId    String   @db.Uuid
  day       String  // WIB calendar day, 'YYYY-MM-DD'
  count     Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, day])
  @@map("daily_complaint_counters")
}
```

Add to the `User` model relations:

```prisma
  ticketsRequested  UploadTicket[] @relation("UploadTicketRequester")
  ticketsClaimed    UploadTicket[] @relation("UploadTicketClaimer")
  dailyCounters     DailyComplaintCounter[]
```

## ER diagram

```text
User 1──1 NikProfile                    (Restrict from NikProfile side)
User 1──n Complaint (reporter, Restrict)
User 1──n ComplaintPhoto (uploader, Restrict)
User 1──n ComplaintTimeline (actor, SetNull)
User 1──n AccountBlock (subject Restrict / moderator SetNull)
User 1──n Notification (Cascade)
User 1──n OtpCode (Cascade)
User 1──n ComplaintUp (Cascade)          (pure pivot; userId+complaintId @@id)
User 1──n DailyComplaintCounter (Cascade; userId+day @@id, strict BR-112 claim)
User 1──n UploadTicket (requester/claimer, Restrict)
User n──1 Agency (attr agencyId, SetNull)

Complaint (self) duplicateOfId → Complaint (SetNull)
Complaint 1──n ComplaintPhoto (Cascade)
Complaint 1──n ComplaintTimeline (Cascade)
Complaint 1──n ComplaintUp (Cascade)
Complaint n──1 Agency (SetNull)
OtpCode: purpose-scoped (EMAIL_VERIFICATION | PASSWORD_RESET), @@index([userId, purpose, createdAt])
UploadTicket: one-time claim (claimedById), links to publicId of Cloudinary asset
```

## onDelete choices

| Entity → parent | onDelete | Reason |
|---|---|---|
| NikProfile → User | `Restrict` | Verification identity must never vanish silently; users are never deleted in MVP (PRD §7). |
| Complaint → User (reporter) | `Restrict` | Complaints are evidence; reporter identity is never deleted. |
| Complaint → Agency | `SetNull` | An agency removed later must not hide its complaints. |
| Complaint → Complaint (duplicateOf) | `SetNull` | Deleting the main complaint must not cascade-duplicate rows. |
| ComplaintPhoto → Complaint | `Cascade` | Photo exists only attached to the complaint. |
| ComplaintPhoto → User (uploader) | `Restrict` | Evidence: uploader identity always resolvable. |
| ComplaintTimeline → Complaint | `Cascade` | Timeline belongs to the complaint only. |
| ComplaintTimeline → User (actor) | `SetNull` | Cron escalations have no actor; staff removal must not block history reads. |
| ComplaintUp → Complaint / → User | `Cascade` | Pure pivot; nothing standalone to keep. |
| DailyComplaintCounter → User | `Cascade` | Claim aid only; meaningless without the account. |
| UploadTicket → User (requester/claimer) | `Restrict` | Upload provenance; accounts are never deleted in MVP. |
| AccountBlock → User (subject) | `Restrict` | Moderation history is evidence. |
| AccountBlock → User (moderator) | `SetNull` | Staff removal must not delete moderation history. |
| Notification → User | `Cascade` | Inbox rows are meaningless without the account. |
| OtpCode → User | `Cascade` | Codes are meaningless without the account (skill default). |

## Notes and spec-level decisions (not new features)

1. `respondedNote` on `Complaint` stores the reject reason for quick reads (also written to the timeline); `handleDueAt` null until forwarded — matches BR-126.
2. Two independent stage counters follow BR-128 / F-COMPLAINTS-13: `verificationEscalationLevel` (PENDING overdue) and `handlingEscalationLevel` (FORWARDED/IN_PROGRESS overdue). Milestone 2 of a stage fires when `now > stageDueAt + ESCALATION_STEP_2_DAYS` days (anchored to the stage going overdue). Each stage's level accrues only while its stage is open; a closed stage stops claiming (verification milestone 2 is muted once the complaint leaves PENDING). Claims are conditional `updateMany`, so a cron restart cannot double-notify.
3. `maskedName` is stored (BR-117) — every payload reads this column only; never a computed-over-user read.
4. `DailyComplaintCounter` implements the strict BR-112 claim with the owner-approved create-first order, inside the create `$transaction`: (1) `create({ data: { userId, day, count: 1 } })` — on P2002 (row already exists) (2) `updateMany({ where: { userId, day, count: { lt: 3 } }, data: { count: { increment: 1 } } })`; 0 affected → 400 `Daily complaint limit reached`. First submit of a WIB day → step 1; day-rollover parallel race → the loser goes to step 2; the 4th concurrent submit fails at step 2 with 400.
5. `Notification.entityType/entityId` is a soft reference (no FK): complaint and user rows are never deleted, so no orphan risk.
6. `UploadTicket` implements one-time claimable signed uploads (BR-136): 24 h validity, `purpose` BEFORE/AFTER makes BEFORE tickets unusable for AFTER photos; a failed claim leaves the ticket untouched.
7. No `deletedAt` anywhere (PRD: no soft delete). Every list uses `$transaction([findMany, count])`.
8. `ComplaintPhoto.publicId @unique` makes each Cloudinary asset attachable once (double-attach protection at DB level). Photo BEFORE max 3 and AFTER max 3 are both from BR-116; `createdAt` doubles as upload time.
