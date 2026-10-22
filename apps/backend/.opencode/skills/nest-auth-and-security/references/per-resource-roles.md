# Recipe: per-resource roles and authorization in the service

Use it when access depends on the resource ("only the team owner may rename it"), not only on the app-wide role.
Compiled and lint-clean in the scratch app; the meta-test checked its label.

```text
@Roles(...)              app-wide gate: who may call the endpoint at all       -> RolesGuard
service: membership row  per-resource gate: may this user touch THIS team?     -> ForbiddenException (rule 8)
```

## Naming (rule 5)

- App-wide role only: `role` / `Role` / `RoleName`.
- App-wide role **and** a role column on a join model: `globalRole` / `GlobalRole` / `GlobalRoleName` on `User`, and
  `role` / `TeamRole` on the join model. Rename only in a new project; an existing project keeps its names.
- A per-resource relation **without** a role column (Moklet: `EventCommitteeMember`, `TeamMember.isLeader`,
  `Event.createdById`) needs no enum: the row or the flag is the permission. Check it in the service the same way.

## Schema (example)

```prisma
enum TeamRole {
  OWNER
  EDITOR
  VIEWER
}

model TeamMember {
  teamId    String   @db.Uuid
  userId    String   @db.Uuid
  role      TeamRole @default(VIEWER)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  team      Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([teamId, userId])
  @@index([userId])
  @@map("team_members")
}
```

## Code

`@Roles` may be wide (every role that can pass the service check). The Swagger prefix is still exactly the `@Roles`
list; the ownership rule goes into `description`, so the label never lies (Moklet labeled `[PANITIA]` while
`@Roles('PANITIA', 'SISWA')`).

```ts
// src/recipes/teams.recipe.ts
import {
  Body,
  Controller,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { TeamRole } from '../../generated/prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import type { AuthUser } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';

export class RenameTeamDto {
  @ApiProperty({ example: 'Alpha Squad' })
  @IsString()
  @Length(2, 50)
  name: string;
}

const CAN_EDIT: TeamRole[] = ['OWNER', 'EDITOR'];

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  /** App-wide ADMIN may always edit; everyone else needs an editing team role. */
  async rename(teamId: string, dto: RenameTeamDto, user: AuthUser) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        members: { where: { userId: user.id }, select: { role: true } },
      },
    });
    if (!team) throw new NotFoundException('Team not found');
    const teamRole = team.members[0]?.role;
    if (user.role !== 'ADMIN' && (!teamRole || !CAN_EDIT.includes(teamRole))) {
      throw new ForbiddenException('You are not allowed to edit this team');
    }
    return this.prisma.team.update({
      where: { id: teamId },
      data: { name: dto.name },
      select: { id: true, name: true },
    });
  }
}

@ApiTags('Teams')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Patch(':id')
  @Roles('ADMIN', 'USER')
  @ApiOperation({
    summary: '[ADMIN/USER] Rename a team',
    description:
      'USER must be OWNER or EDITOR of the team (checked in the service).',
  })
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameTeamDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.teams.rename(id, dto, user);
  }
}
```

(One file only to keep the recipe short; in a project, the DTO, service and controller go to their own files.)

## Out of scope: ask the user

Multi-role users (`roles Role[]` or a `UserRole` table), permission-based access, and several principal tables
(webportfolio: `Admin` + `Visitor`) are not covered by this standard. They change `AuthUser.role` and `RolesGuard`
in nest-common. Do not improvise one: ask the user which model they want and say it needs a nest-common change.

## Bad example

```ts
@Roles('PANITIA', 'SISWA')
@ApiOperation({ summary: '[PANITIA] Approve team' })   // BAD: SISWA can call it too; say it in description
if (team.leaderId !== user.id) return;                  // BAD: silent no-op instead of ForbiddenException
const isLeader = dto.isLeader;                          // BAD: permission taken from the request body
```

## Checklist

- [ ] `@Roles` lists every role that can reach the service check; the prefix is exactly that list.
- [ ] The per-resource check is in the service, reads the membership from the database, throws `ForbiddenException`.
- [ ] `description` explains the per-resource rule.
