# Recipe: WebSocket auth (optional)

Use it when a gateway needs the current user. Verified in the scratch app with `socket.io-client`: a token in
`handshake.auth.token` connects; the same token in the query string, and a token with an old `tv`, are disconnected.

- `npm i @nestjs/websockets@^11 @nestjs/platform-socket.io@^11`.
- `AuthModule` exports `JwtModule` and `JwtStrategy` (see `reference-implementation.md`), so the gateway runs the
  same checks as HTTP (`isActive`, `emailVerifiedAt`, `tokenVersion`). Do not write a second, weaker check.
- Client: `io(url, { auth: { token } })`. Never `?token=` (URLs end up in proxy and access logs; KantinKlik did this).
- CORS: from `FRONTEND_URL` through an adapter, never `@WebSocketGateway({ cors: { origin: '*' } })`.

```ts
// src/recipes/frontend-cors-io.adapter.ts
import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/**
 * Socket.IO with the same CORS allowlist as HTTP (FRONTEND_URL), instead of a
 * hardcoded `cors: { origin: '*' }` on the gateway. main.ts:
 *   app.useWebSocketAdapter(new FrontendCorsIoAdapter(app));
 */
export class FrontendCorsIoAdapter extends IoAdapter {
  private readonly origins: string[];

  constructor(app: INestApplicationContext) {
    super(app);
    this.origins = app
      .get(ConfigService)
      .getOrThrow<string>('FRONTEND_URL')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins },
    });
  }
}
```

```ts
// src/recipes/events.gateway.ts
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import type { AuthUser, JwtPayload } from '../common/types/auth-user';

export interface AuthedSocket extends Socket {
  data: { user?: AuthUser };
}

/**
 * The token comes from `handshake.auth.token`, never the query string: URLs
 * end up in proxy and access logs. CORS comes from FrontendCorsIoAdapter.
 */
@WebSocketGateway({ namespace: 'events' })
export class EventsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly strategy: JwtStrategy,
  ) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const token: unknown = client.handshake.auth?.token;
      if (typeof token !== 'string') throw new UnauthorizedException();
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      // Same checks as HTTP: isActive, emailVerifiedAt, tokenVersion.
      client.data.user = await this.strategy.validate(payload);
    } catch {
      this.logger.debug(`Rejected socket ${client.id}`);
      client.disconnect(true);
    }
  }
}
```

`main.ts`, right after `app.enableCors(...)`: `app.useWebSocketAdapter(new FrontendCorsIoAdapter(app));`

Long-lived sockets: a socket stays open after `tokenVersion` changes. If that matters, re-run `strategy.validate`
in the handlers that change data, or disconnect the user's sockets when you bump `tokenVersion`.

## Bad example

```ts
const token = client.handshake.query.token as string;         // BAD: token in the URL
@WebSocketGateway({ cors: { origin: '*' } })                   // BAD: any origin
const payload = this.jwt.verify(token); client.data.user = payload; // BAD: skips isActive and tokenVersion
```

## Checklist

- [ ] Token from `handshake.auth.token`; invalid -> `client.disconnect(true)`.
- [ ] `JwtStrategy.validate` reused; `client.data.user` is an `AuthUser`.
- [ ] CORS from `FRONTEND_URL` via the adapter.
