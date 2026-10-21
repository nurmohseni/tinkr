# End-to-end tests

These tests launch Tinkr itself: the real main process, the real preload bridge
and the real renderer, with a real pty behind every run. Nothing in the app is
mocked. Playwright's Electron support starts the app and attaches to every
window it opens.

```bash
yarn e2e                 # the whole suite
yarn e2e e2e/specs/04-editor-run.spec.js
yarn e2e:report          # the HTML report from the last run
```

`yarn e2e` starts the renderer's Vite server on port `8123` (override with
`TINKR_E2E_WEB_PORT`) and stops it again. With `CI` set, it always starts its
own server; without, a server already on that port is reused.

## How an app is isolated

Every test gets a fresh throwaway profile. `XDG_CONFIG_HOME` points at it, so
the app's own `electron-store` files — connections, preferences, snippets,
history and the SSH secret file — are the test's. The helper in
[`support/tinkr.js`](./support/tinkr.js) writes whatever a test needs there
before the app starts:

```js
const {page, close, errors} = await launchTinkr({
  config: {run_timeout: 1500},
  connections: [fixtureConnection({tag: 'production'})],
  snippets: {fixture: {one: {id: 'one', name: 'One', code: '1;'}}},
  history: {},
})
```

The first connection in the store is the one the window opens on. `connections:
null` leaves the store at its default, which is the Quick Connection. `errors`
collects uncaught page errors and console errors, so a spec can assert the page
stayed quiet.

## The fixture project

[`fixtures/app`](./fixtures/app) is a tiny project that answers `php artisan
tinker`. It has the part of psysh the app depends on — one line in, one eval,
variables and classes persisting for the line — plus:

- a `vendor/composer` psr-4 map and classmap, so the app's class index resolves
  `Order` to `App\Models\Order` and the completion popup has names to offer;
- a small `Order` model and an in-memory SQLite `DB` facade that dispatches
  Laravel's `QueryExecuted` event, so the query log and the transaction guard
  have real queries to watch;
- `storage/logs/laravel.log` and `worker.log`, with fixed timestamps for the
  log viewer's level, search, range and scrolling tests.

It exists so the suite needs no `composer install` and no network. A test that
writes to the project uses `copyFixture()` instead, so the committed fixture
stays untouched.

## What is covered

[`COVERAGE.md`](./COVERAGE.md) is the full surface-by-surface map, including what is left to unit tests and what is native UI.

| Spec | Surface |
| --- | --- |
| `00-smoke` | the harness itself: the real app opens on the fixture connection and a run comes back through a real pty |
| `01-app-shell` | real window, titlebar, sidebar, status bar, output views, theme, maximize/minimize/restore, Ctrl+K, the AI and new-connection shortcuts, the quick connection and its directory picker |
| `02-connections` | four connection kinds, field visibility, drafts vs. Connect, Save vs. discard on close, tags, clone event, delete confirmation |
| `03-password` | SSH password kept in a 0600 file, never rendered back, forget, cleared when the connection becomes local, port persisted |
| `04-editor-run` | a run in a real session, duration, multi-statement blocks, a thrown exception, printed output, no value, Ctrl+R, stop, timeout |
| `05-tabs` | per-tab code and answers, the edited-since-run dot, close confirmation, the standing answer, snippet tabs |
| `06-snippets` | save a session, filter, rename from the tab and the menu, delete, form mode fields, form prefix, form feature switch, a snippet another process wrote, the status-bar caret |
| `07-history` | newest first with outcomes, opening a run in a tab, clearing with confirmation, persistence across a restart |
| `08-result-readings` | class alias/import, table, graph, raw, html in a sandboxed frame, long strings, empty objects |
| `09-queries-dry-run` | query capture without queries, dry run rollback, keep/commit, a read under the guard |
| `10-production-gate` | a write held behind the production question, cancel, run anyway, unguardable dry run, guarded ordinary write |
| `11-preferences` | theme, layout, statements, timeout, close prompt, command and log defaults, shortcut recorder, locale switch, lab form switch/prefix |
| `12-ai` | the panel against a local OpenAI-shaped server, apply and discard, `@` project files, the two context switches, settings check |
| `13-logs` | file rail, entries and details, level/search/time filters, follow, bounded infinite scrolling over a file larger than one window |
| `14-update` | available and downloaded update prompts, the missing-php warning |
| `15-container-ssh` | container discovery and a run inside a real container; a real sshd with key auth and a run over ssh; the log viewer over both |
| `16-mcp` | the bundled server, the connection a client runs in, the entry, a client configuration written, the tools, copy |
| `17-completion` | class and method completion from the project index, and the name it inserts running in the session |
| `18-connection-pickers` | the directory picker and the SSH private-key picker through the main process |
| `19-terminal` | keys typed into the real terminal reach the session, and its output comes back |
| `20-form-fields` | declared select, checkbox and textarea fields, and a field written as a closure |
| `21-result-actions` | copy a value, a row and a CSV, and write the CSV to disk |
| `22-ai-autocomplete` | an inline completion request, its ghost text, and taking it |
| `23-mcp-server` | the MCP server over JSON-RPC: handshake, tools, run, guard, snippets |
| `24-laravel-cloud` | a token checked, saved and forgotten; a connection built from an application and its environment; a run through the API and what it printed; a missing permission; a stop |

## The Laravel Cloud fake

`24-laravel-cloud` points the app at a fake API on loopback
([`support/fakeCloud.js`](./support/fakeCloud.js)) with
`TINKR_LARAVEL_CLOUD_URL`, which is the one thing about a cloud connection a
test can replace: the transport is real fetch, the envelope is real JSON:API,
and the command the app posts is really run, by `sh -c` in the fixture project.
So a run in that spec is a real `php artisan tinker --execute=…` process, and
the only thing standing in for the platform is the network.

```js
const cloud = await startFakeCloud({applications, fail: {status: 403, path: /\/commands/}})
const {page, close} = await launchTinkr(
  {secrets: {'@laravel-cloud': 'fixture-cloud-token'}},
  {env: {TINKR_LARAVEL_CLOUD_URL: cloud.url}},
)
```

The fixture serves two applications, one per page, so the picker's `links.next`
is followed. `fail` forces a status for the calls whose path it matches, which
is how a token that is valid and not permitted is driven. `requests` holds every
call the app made, and `commands` what the fake started.

## Environment-dependent flows

`15-container-ssh` runs the container half when Docker and a PHP image are
available. It tries `php:8.4-cli`, then `sail-8.5/app:latest`, and can be pointed
elsewhere:

```bash
TINKR_E2E_CONTAINER_IMAGE=my/php:latest yarn e2e e2e/specs/15-container-ssh.spec.js
```

The SSH half starts an unprivileged `sshd` on a loopback port when asked:

```bash
TINKR_E2E_LOCAL_SSH=1 yarn e2e e2e/specs/15-container-ssh.spec.js
```

It writes the test host key to the account's `known_hosts` because ssh reads
that file from the account's home rather than from `HOME`, and restores the
file afterwards. It is opt-in for that reason. On CI the job starts it, on a
disposable home.

## Writing a spec

- Select by role, label or title, not by CSS where the app gives a name.
- A run is asynchronous: use `runCode()` from [`support/actions.js`](./support/actions.js),
  which types into Monaco and waits for the answer and for Run to come back.
- Do not wait on fixed sleeps to prove something happened; wait on the thing
  that changes.
- A flow that writes to the project should copy the fixture first.
- One Electron app per test; the app is a single window on a single connection.
