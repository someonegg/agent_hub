# Development

## Run locally

Use Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` and npm for development and checks.
The published package supports Node.js >=22.13.

```sh
npm ci
npm run build
npm start
```

Open <http://127.0.0.1:4173>. Rebuild and restart after changing application code.
See [runtime requirements](../README.md#quick-start),
[server options](usage.md#configure-the-server), and
[CLI compatibility](technical-reference.md#runtime-cli-compatibility).

For frontend hot reload, run `npm run dev`. It starts Vite without the session
API; use the built server for real sessions and end-to-end checks.

To browse isolated demo conversations after building, create a new demo directory:

```sh
node scripts/create-docs-demo.mjs /tmp/ahub-docs-demo
npm start -- --codex-agent 'default=/tmp/ahub-docs-demo' --port 4187
```

### Find the code

- `src/client/`: UI and browser state.
- `src/server/`: HTTP services, session repository, and source adapters.
- `src/shared/`: public API contracts and shared types.
- `tests/` and `scripts/`: checks, fixtures, and maintenance tools.

For behavior and contracts, see the [technical reference](technical-reference.md)
and [JSONL processing](session-jsonl-filtering.md).

## Validate changes

Before submitting a change:

```sh
npm run typecheck
npm run lint
npm test
npm run format:check
```

Use `npm run format` to format files and `npm run lint -- --fix` to fix supported
lint issues. Lint also checks server import boundaries; see the
[lint toolchain](../tools/client-lint/README.md) for rules.

Run additional checks for the affected area:

| Command                           | When to use                                                       |
| --------------------------------- | ----------------------------------------------------------------- |
| `npm run test:package`            | Packaging or release validation                                   |
| `npm run test:integration:tmux`   | Native tmux interaction changes                                   |
| `npm run test:integration:codex`  | Native Codex lifecycle changes                                    |
| `npm run test:integration:claude` | Native Claude lifecycle changes (requires `claude`, tmux and Git) |
| `npm run test:hosting`            | Hosting/diff changes and desktop/mobile diff screenshots          |
| `npm run benchmark:scale`         | Scale or performance changes                                      |

With tmux, Git, and both runtime CLIs installed, `npm run test:all` runs unit tests
and all three native integration suites. Lifecycle suites use isolated projects,
agents, credentials, and tmux sockets; Claude uses a local API stub. They do not
call a model or use existing user sessions. Hosting checks require `playwright-cli`
and its browser.

`test:package` builds, packs, installs, and smoke-tests outside the repository.
Use `npm run test:package -- --skip-build` to reuse a current build, or
`node scripts/test-package.mjs /path/to/package.tgz` to test an existing tarball.

CI runs the standard checks and package tests, including a Node.js 22.13.0 runtime
smoke test; see [test.yml](../.github/workflows/test.yml) for the matrix.
CI does not run the native integration suites. Run the relevant commands above
locally when changing native interaction or lifecycle behavior.

## Update documentation images

UI changes must regenerate affected README screenshots and animations in all
three languages (`en`, `zh-CN`, `zh-TW`). Install `playwright-cli` and its
browser; GIF generation also requires Python 3 with Pillow.

Start the frontend:

```sh
npm run dev -- --port 4187 --strictPort
```

In another terminal, generate the English assets (outputs to `docs/images/`):

```sh
node scripts/record-docs-intro.mjs
node scripts/capture-docs-interaction.mjs
npm run test:hosting
```

For `zh-CN` and `zh-TW` (outputs under `docs/images/zh-CN/` and
`docs/images/zh-TW/`), repeat with `--language <lang>` (ensure `npm run build`
has run before running `scripts/test-hosting.mjs` directly):

```sh
node scripts/record-docs-intro.mjs --language zh-CN
node scripts/capture-docs-interaction.mjs --language zh-CN
node --import tsx scripts/test-hosting.mjs --language zh-CN
```

- The first two scripts use fabricated sessions and mocked requests without
  starting Codex or reading user sessions; `test:hosting` generates the diff
  screenshots.
- Both capture scripts accept `<origin> <output-path>`. To verify CSP
  compatibility against the built server, run `npm start` and
  `node scripts/capture-docs-interaction.mjs http://127.0.0.1:4173 /tmp/interaction.png`.
- Scripts check page errors and horizontal overflow; also inspect readability
  and clipping at README widths, keep each GIF below 5 MiB, and stop the dev
  server afterward.
- When changing camera or attachment behavior, also test confirmation,
  cancellation, and repeat shots on real iOS Safari and Android Chrome devices
  (including standalone modes).

## Update application icons

With Pillow installed, run `python3 scripts/generate-icons.py` to regenerate the
icons in `public/`. Keep artwork within the central maskable safe circle.

For icon or installation changes, serve over HTTPS (or localhost), then use the
browser's install or Add to Home Screen action. Check that the installed app opens
the catalog. Offline session access is not supported.

## Release

The npm package is `@someonegg/agent-hub`; it provides `agent-hub` (server) and
`ahub-cli` (management commands).

1. Update package and lockfile versions in a PR, run the standard checks and
   `npm run test:package`, then merge.
2. Tag the merged commit as `v<package-version>` and push the tag.
3. Confirm [publish.yml](../.github/workflows/publish.yml) succeeds and verify
   installation from npm.
4. Create the matching GitHub Release with English release notes.

The workflow validates the tag, runs checks, and uses
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/);
routine releases need no npm token. Retries skip versions already published.
Never reuse a published version; release fixes as a new patch version.
