<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": true` in the root `turbo.json` or `turbo.jsonc` to opt in; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# Monorepo npm workspaces rules

- Toolchain: Node 24 LTS and npm 11 (`devEngines` pins npm `^11.19.0` — Turborepo requires the range to stay within one major). `prisma@7`, `next@16`, `turbo@2` and `@nestjs/core@11` all declare `engines.node >=24`. Anyone still on npm 10 runs `npm i -g npm@11` once. `engines.node` is warning-level only (`engine-strict` is off).
- Plain `npm install` / `npm ci` **only at the repo root** — never inside `apps/*` or `packages/*`.
- Add dependencies with `npm install <pkg> -w apps/backend` (or from inside the app folder — npm resolves the workspace root). App dependencies never land in the root `package.json`.
- Run workspace scripts via `npx turbo run <task> --filter=backend`, or `npm run <script> -w apps/backend` for scripts turbo does not know.
- After every scaffold or step that edits a workspace `package.json`, run one `npm install` at the root so `package-lock.json` stays a single root lockfile with no nested lockfiles.
- Backend agent skills live in `apps/backend/.opencode/skills/` — see `apps/backend/AGENTS.md` for the index; read them before writing backend code.
