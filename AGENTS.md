# Repository Guidelines

## Project Structure & Module Organization
This project is a Figma plugin that syncs Google Sheets data into layers.

- `src/code.ts`: main Figma thread entry point (document access, no network).
- `src/ui/`: UI context (`ui.ts`, `styles.css`) where network fetches occur.
- `src/core/`: sync engine, parser, fetchers, special types, traversal, and shared types.
- `tests/unit/` and `tests/integration/`: Vitest suites.
- `tests/mocks/figma.ts`: Figma API mocks for isolated tests.
- `scripts/build-ui.js`: bundles UI into `dist/ui.html`.
- `worker/`: Cloudflare Worker proxy code.
- `assets/`: plugin visuals and static assets.

## Build, Test, and Development Commands
- `npm run dev`: watch mode for plugin code and UI.
- `npm run build`: production build (`dist/code.js` and `dist/ui.html`).
- `npm run typecheck`: strict TypeScript checks without emitting files.
- `npm run lint`: ESLint on `src/**/*.ts,tsx`.
- `npm run format`: Prettier write pass on `src/**/*.{ts,tsx}`.
- `npm test`: run all Vitest tests once.
- `npm run test:watch`, `npm run test:unit`, `npm run test:int`: focused test workflows.

## Coding Style & Naming Conventions
- Language: TypeScript (strict mode), plus minimal Node scripts.
- Indentation: 2 spaces.
- Prefer single quotes and trailing semicolons (match existing source).
- File names use kebab-case (for example `sheet-fetcher.ts`, `sync-engine.ts`).
- Keep parsing/sync logic in `src/core/`; keep UI messaging boundaries explicit in `src/messages.ts`.

## Testing Guidelines
- Framework: Vitest (`vitest.config.ts`) with V8 coverage (`text`, `html`).
- Test files: `*.test.ts` under `tests/`.
- Mirror source behavior in test names (for example `parser.test.ts`, `sync-engine.test.ts`).
- Add or update tests with any parser, sync, or fetcher behavior change.
- Run at least `npm run typecheck && npm test` before opening a PR.

## Commit & Pull Request Guidelines
- Follow Conventional Commit style seen in history: `feat:`, `fix:`, `chore:`, `docs:`.
- Keep commits focused and imperative (for example `fix: preserve image scale mode when syncing images`).
PRs should include:
- clear problem/solution summary
- linked issue or ticket (`tickets/*.md`) when applicable
- screenshots or short recordings for UI changes
- notes on any manifest/worker/config updates

## Security & Architecture Notes
- Do not hardcode API keys or secrets.
- Keep network requests in UI context only; main thread must communicate via messages.

## Ship

- **Deploys by:** nothing runs on merge. The maintainer publishes the plugin to Figma Community by hand from a build of `main`; agents do not publish it. The `sheets-proxy` Worker (`worker/wrangler.jsonc`) is not connected to Git: a merged Worker change is not live until someone runs `npx wrangler deploy` in `worker/`.
- **Merge:** merge commits.
- **Check live:** the Worker answers at `https://sheets-proxy.spidleweb.workers.dev`. The Community listing shows which plugin version is published.
- **Checks:** `npm run typecheck && npm test`. CI runs the same on every pull request.
