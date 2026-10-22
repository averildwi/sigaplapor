---
name: nest-response-and-errors
description: Use when writing controller return values, throwing exceptions, or touching the TransformInterceptor, exception filters or the response envelope in a NestJS project.
---

## When to use

- Writing what a controller returns.
- Throwing an error from a service, guard or pipe.
- Editing `src/common/interceptors/transform.interceptor.ts`, `src/common/filters/*` or `src/common/helpers/error-response.helper.ts`.

## Rules

1. Every success response has the envelope `{ statusCode, message, data, timestamp }`, plus `meta` for paginated lists. `TransformInterceptor` builds it. Never build it by hand.
2. Controllers choose the shape with marker classes:
   - plain value: `message: 'Success'`
   - `new MessageResponse(data, 'Team created')`: custom message
   - `new Paginated(result.data, result.meta)`: list with `meta: { total, page, limit, totalPages }`
   - `new RawResponse(x)`: no envelope. Use it **only** when a third party dictates the body, such as a payment webhook ack. Never use it for login or lists.
   - `StreamableFile` is passed through untouched.
3. Services return plain data (or `paginate()` results). Services never return `{ message, data }` and never import marker classes.
4. Every error response has the envelope `{ statusCode, message, data: null, error, timestamp }`, built with `buildErrorResponse()`.
   - For HTTP errors, `error` is the HTTP reason phrase of the status: `'Bad Request'`, `'Unauthorized'`, `'Forbidden'`, `'Not Found'`, `'Conflict'`, `'Too Many Requests'`. Never the class name (`'UnauthorizedException'`). The filter takes it from `STATUS_CODES` (`node:http`), so a bare `new UnauthorizedException()` from Passport and `new UnauthorizedException('Invalid credentials')` give the same `error`.
   - For unknown errors: 500, `'Internal server error'`, `error: 'Internal Server Error'`.
   - For database errors, `error` is the Prisma code (for example `'P2002'`).
5. Register two global filters in `main.ts`, in this exact order:
   `app.useGlobalFilters(new GlobalExceptionFilter(), new PrismaExceptionFilter());`
   Nest tries the **last registered** filter first. With the reverse order, the catch-all swallows P2002 and returns 500. This was verified at runtime.
6. `PrismaExceptionFilter` maps codes: `P2002`→409, `P2025`→404, `P2003`→400, `P2014`→400. Any other code returns 500 `Database error` and is logged.
7. Throw built-in Nest exceptions only (`NotFoundException`, `BadRequestException`, `ConflictException`, `ForbiddenException`, `UnauthorizedException`). Do not create custom exception classes.
8. Use the correct status:
   - duplicate business key: 409 `ConflictException`
   - missing/invalid auth: 401
   - authenticated but not allowed: 403
   - create: 201 (Nest default for POST)
   - action endpoints that do not create (`POST :id/approve`, login): `@HttpCode(HttpStatus.OK)`
9. Every message (errors, success, logs, comments) is in **English**. Keep messages short, user-safe and sentence case with no trailing period: `'Team not found'`.
10. Never leak internals in messages (stack traces, SQL, Prisma meta, whether an email exists).
11. Never swallow errors silently (`.catch(() => null)`). Log with `Logger` and rethrow, or handle explicitly.

## Good example

Marker classes and interceptor core (`src/common/interceptors/transform.interceptor.ts`):

```ts
export interface PaginationMeta { total: number; page: number; limit: number; totalPages: number }

export class Paginated<T> {
  constructor(public readonly data: T[], public readonly meta: PaginationMeta) {}
}
export class MessageResponse<T> {
  constructor(public readonly payload: T, public readonly message: string) {}
}
export class RawResponse<T> {
  constructor(public readonly payload: T) {}
}

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((result: unknown) => {
        if (result instanceof StreamableFile) return result;
        if (result instanceof RawResponse) return result.payload as unknown;
        const statusCode = context.switchToHttp().getResponse<Response>().statusCode;
        const timestamp = new Date().toISOString();
        if (result instanceof Paginated) {
          return { statusCode, message: 'Success', data: result.data as unknown[], meta: result.meta, timestamp };
        }
        if (result instanceof MessageResponse) {
          return { statusCode, message: result.message, data: result.payload as unknown, timestamp };
        }
        return { statusCode, message: 'Success', data: result, timestamp };
      }),
    );
  }
}
```

Controller:

```ts
@Get()
async findAll(@Query() query: QueryTeamDto) {
  const result = await this.teamsService.findAll(query);
  return new Paginated(result.data, result.meta);
}

@Post()
async create(@Body() dto: CreateTeamDto, @CurrentUser() user: AuthUser) {
  const team = await this.teamsService.create(dto, user.id);
  return new MessageResponse(team, 'Team created');
}
```

Prisma filter (`src/common/filters/prisma-exception.filter.ts`):

```ts
const PRISMA_ERROR_MAP: Record<string, { status: HttpStatus; message: string }> = {
  P2002: { status: HttpStatus.CONFLICT, message: 'Data already exists' },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Data not found' },
  P2003: { status: HttpStatus.BAD_REQUEST, message: 'Invalid data relation' },
  P2014: { status: HttpStatus.BAD_REQUEST, message: 'Data is still referenced by other records' },
};

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const mapped = PRISMA_ERROR_MAP[exception.code];
    if (!mapped) this.logger.error(`Unhandled Prisma error: ${exception.code}`, exception.message);
    const status = mapped?.status ?? HttpStatus.INTERNAL_SERVER_ERROR;
    response.status(status).json(buildErrorResponse(status, mapped?.message ?? 'Database error', exception.code));
  }
}
```

`GlobalExceptionFilter` (`src/common/filters/global-exception.filter.ts`, core):

```ts
import { STATUS_CODES } from 'node:http';

let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
let message: string | string[] = 'Internal server error';
let error = STATUS_CODES[statusCode] ?? 'Internal Server Error';
if (exception instanceof HttpException) {
  statusCode = exception.getStatus();
  const reason = STATUS_CODES[statusCode] ?? exception.name; // 'Unauthorized', never 'UnauthorizedException'
  const res = exception.getResponse();
  if (typeof res === 'string') { message = res; error = reason; }
  else {
    const body = res as { message?: string | string[]; error?: string };
    message = body.message ?? exception.message;
    error = body.error ?? reason;
  }
} else if (exception instanceof Error) {
  this.logger.error(exception.message, exception.stack);
}
response.status(statusCode).json(buildErrorResponse(statusCode, message, error));
```

`Prisma` is imported by relative path (`'../../../generated/prisma/client'` from `src/common/filters/`).

Resulting bodies (verified at runtime):

```json
{ "statusCode": 200, "message": "Success", "data": [ ... ], "meta": { "total": 1, "page": 1, "limit": 10, "totalPages": 1 }, "timestamp": "..." }
{ "statusCode": 401, "message": "Unauthorized", "data": null, "error": "Unauthorized", "timestamp": "..." }
{ "statusCode": 401, "message": "Invalid credentials", "data": null, "error": "Unauthorized", "timestamp": "..." }
{ "statusCode": 400, "message": "Validation failed (uuid is expected)", "data": null, "error": "Bad Request", "timestamp": "..." }
{ "statusCode": 400, "message": ["hacker: property hacker should not exist"], "data": null, "error": "Bad Request", "timestamp": "..." }
{ "statusCode": 404, "message": "Team not found", "data": null, "error": "Not Found", "timestamp": "..." }
{ "statusCode": 409, "message": "Data already exists", "data": null, "error": "P2002", "timestamp": "..." }
```

## Bad example

```ts
// BAD: service builds the message. Messages belong to the controller via MessageResponse.
async updateVendor(id: number, dto: UpdateVendorDto) {
  // ...
  return { message: 'Vendor updated' };
}

// BAD: RawResponse for a normal endpoint breaks the envelope contract for the frontend.
@Post('login')
async login(@Body() dto: LoginDto) {
  return new RawResponse(await this.authService.login(dto));
}

// BAD: reverse order, so the catch-all runs first and P2002 becomes 500.
app.useGlobalFilters(new PrismaExceptionFilter(), new GlobalExceptionFilter());

// BAD: wrong status (duplicate should be 409) and a non-English message.
if (exists) throw new BadRequestException('Email sudah terdaftar');

// BAD: error swallowed silently.
await this.cloudinary.destroy(publicId).catch(() => null);
```

## Checklist before finishing

- [ ] Controllers return a plain value, `MessageResponse`, `Paginated`, or (justified) `RawResponse`.
- [ ] No service returns `{ message, ... }`.
- [ ] `main.ts` registers `GlobalExceptionFilter` first, then `PrismaExceptionFilter`.
- [ ] Every thrown message is short and in English, with no internal details.
- [ ] Status codes follow rule 8 (409 for duplicates, `@HttpCode(200)` for non-create POST).
- [ ] Error `error` fields are reason phrases (`'Not Found'`) or Prisma codes, never class names.
- [ ] No `.catch(() => null)` or empty `catch {}` without a comment explaining why.
