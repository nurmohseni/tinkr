# Coverage map

Every surface of the app, and where it is proven.

- **E2E** — a spec in [`specs/`](./specs) drives the real app: real main process,
  preload bridge, renderer and pty.
- **Unit** — covered by a package's Jest suite, not driven through the app.
- **Native** — platform UI (an Electron menu, an OS dialog) that Playwright
  cannot press. Where the action behind it has a testable seam, that seam is
  named.

A test named here is the one that would fail if the surface broke. Tests
exercise the surface through its UI, not through a stub of it.

## Lifecycle and windows

| Surface | Proof |
| --- | --- |
| App boots on a connection and runs a snippet through a real pty | `00-smoke` |
| Editor window, titlebar, sidebar, status bar, output views | `01-app-shell` |
| Maximize / restore / minimize | `01-app-shell` |
| Window close / quit | Native; teardown closes the real app |
| Theme attribute and the window's own theme | `01-app-shell`, `11-preferences` |
| Locale switch and live messages | `11-preferences` |
| Messages arrive before the window renders (no blank Loading) | every launch helper, `00-smoke` |
| Preferences window and its five sections | `11-preferences`, `16-mcp` |
| Logs window | `13-logs`, `15-container-ssh` |
| Update prompt | `14-update` |

## Connections

| Surface | Proof |
| --- | --- |
| List, current row, counts, quick/new buttons | `01-app-shell`, `02-connections` |
| The four kinds and the fields each shows | `02-connections` |
| Draft closed without being stored | `02-connections` |
| Connect creates and switches the window | `02-connections` |
| Autosave, tags, production label | `02-connections` |
| Clone event, delete confirmation | `02-connections` |
| Directory picker and SSH key picker | `18-connection-pickers` |
| SSH password kept in a 0600 file, never rendered, forgotten, dropped on local | `03-password` |
| SSH port persisted | `03-password` |
| Container discovery and a real run in a container | `15-container-ssh` |
| A real sshd, key auth, a run over ssh | `15-container-ssh` |
| Native connection context menu | Native menu; its clone and delete messages are tested in `02-connections` |
| `closeConnection` (delete the last/current connection) | Not E2E; the window would quit |
| SSH + container together | Not E2E; container and ssh are proven separately |

## Editor and documents

| Surface | Proof |
| --- | --- |
| Type and run, returned value, duration, output view | `04-editor-run` |
| Multiple statements, per-statement blocks | `04-editor-run` |
| Thrown exception, printed-only, nothing returned | `04-editor-run` |
| Ctrl+R, stop, timeout, reconnect | `04-editor-run` |
| Terminal input and whole-session output | `19-terminal` |
| PHP version and missing-php warning | `01-app-shell`, `14-update` |
| Class completion, method completion, insertion | `17-completion` |
| AI inline completion at the cursor | `22-ai-autocomplete` |
| Tabs keep their own code and answers | `05-tabs` |
| Edited-since-run dot, close confirmation, standing answer | `05-tabs` |
| Snippet tabs close without asking | `05-tabs` |
| Save a session, search, rename, delete, external writer | `06-snippets` |
| Form mode: simple fields, declared select/checkbox/textarea, closure values, prefix, switch | `06-snippets`, `20-form-fields` |
| Caret position in the status bar | `06-snippets` |
| History newest first, opening a run, clearing, restart | `07-history` |
| Editor read-only while a run is going | Not E2E; the run button's stop state is tested in `04-editor-run` |
| Terminal clear shortcut (`Cmd+K`) | Not E2E |

## Results, queries and guards

| Surface | Proof |
| --- | --- |
| Tree, table, graph, html, raw readings | `08-result-readings` |
| Class alias/imports, long strings, empty objects | `08-result-readings` |
| Copy value, copy row JSON, copy CSV, save CSV | `21-result-actions` |
| Query capture, "no query", copy SQL | `09-queries-dry-run`, `21-result-actions` |
| Dry run rollback, keep/commit, a read under the guard | `09-queries-dry-run` |
| Production mutation gate, unguardable dry run | `10-production-gate` |
| Query/result storage limits and truncation | Unit (`resultReading`, `runResult`, query log) |
| Graph node toggling and path highlight | Not E2E; the graph is proven to render |

## Logs

| Surface | Proof |
| --- | --- |
| File rail and entries with details | `13-logs` |
| Level, search and time-range filters | `13-logs` |
| Follow while the file is appended | `13-logs` |
| Older/newer paging over a file larger than a window | `13-logs` |
| Logs over ssh and from inside a container | `15-container-ssh` |
| Monolog JSON-format entries | Unit parser (`logs` service); not E2E |
| Follow interval selector | `13-logs` (the control is rendered; a non-default interval is not timed) |

## Preferences

| Surface | Proof |
| --- | --- |
| Theme, layout, statements, timeout, close prompt, default command, log dir | `11-preferences` |
| Locale switch (English ↔ Spanish) | `11-preferences` |
| Run-shortcut recorder and the recorded binding running | `11-preferences` |
| AI-panel and new-connection shortcuts | `01-app-shell` |
| Snippet form switch and prefix | `11-preferences` |
| AI provider, endpoint, token, model, delay, check | `12-ai` |
| MCP connection, entry, tools, client configure, copy | `16-mcp` |
| Recording the AI/new-connection shortcuts | Not E2E; their default bindings are tested |
| Every locale | Not E2E; one non-English locale is tested |
| Light-theme palette beyond the `data-theme` attribute | Not E2E |

## AI

| Surface | Proof |
| --- | --- |
| Ask, thread, apply, discard | `12-ai` |
| Project-file `@` mentions | `12-ai` |
| Context switches (code, last answer) | `12-ai` |
| Settings check against a live provider | `12-ai` |
| Inline completion request, ghost text, acceptance | `22-ai-autocomplete` |
| Provider error wording | Not E2E; unit-tested service paths |
| Anthropic/custom wire styles | Not E2E; only the OpenAI shape is driven |

## Updates and MCP

| Surface | Proof |
| --- | --- |
| Update available, downloaded, Later | `14-update` |
| Download progress, failure, restart/install, packaged check | Not E2E: network, install and packaged-only paths |
| MCP settings, client entry, configure, copy, tools list | `16-mcp` |
| MCP server handshake, tool list, run, guard | `23-mcp-server` |
| MCP save/list/delete snippet | `23-mcp-server` |
| MCP list connections/history/read run, ssh tool, production refusal | Unit (`tinkr-mcp` server tests) |
| Snippets written by the MCP server reaching the window | `06-snippets` |

## IPC channels

All of these are exercised through the bridge, not called from a test:

| Group | Channels | Proof |
| --- | --- | --- |
| Config and language | `allConfig`, `setConfig`, `getLocale`, `setLocale`, `allLocales`, `getIntlConfig` | `11-preferences`, every launch |
| Connections | `allConnections`, `getConnection`, `createConnection`, `updateConnection`, `deleteConnection`, `forgetPassword`, `connectConnection`, `reconnectConnection`, `quickConnect`, `listContainers`, `listProjectDirs` | `01`, `02`, `03`, `18`, `15` |
| Session | `runConnection`, `inputConnection`, `stopConnection` | `04`, `19` |
| Snippets and history | `allSnippets`, `createSnippet`, `updateSnippet`, `deleteSnippet`, `allHistory`, `clearHistory` | `06`, `07` |
| Logs | `logFiles`, `logRead` | `13`, `15` |
| AI and form | `aiProviders`, `aiAsk`, `aiComplete`, `aiCheck`, `aiFiles`, `parsePhpForm`, `stringifyPhpForm`, `phpCompletions` | `12`, `17`, `20`, `22` |
| MCP | `mcpInfo`, `configureMcp` | `16`, `23` |
| Files | `selectDirectory`, `selectFile`, `saveFile` | `01`, `18`, `21` |
| Windows | `windowControl`, `windowState` | `01` (close is native) |
| Updates | `checkForUpdates`, `downloadUpdate`, `installUpdate` | `14` (only the prompt; the updater itself is not driven) |
| Native menu | `popupConnectionContextMenu` | Native; not pressable |

## Native and packaged surfaces

These have no Playwright path at all, and are named so they are not mistaken for
covered:

- the application menu and the macOS dock menu (`menu.js`), including its
  preferences and debug entries;
- the connection context menu raised by `popupConnectionContextMenu`;
- OS dialogs: the tests answer the directory, file and save dialogs through the
  main process, but do not press the real dialog;
- the packaged app: custom renderer scheme, asar layout, code signing and the
  auto-updater's network/install steps — the suite runs the development entry
  over the Vite server;
- macOS traffic lights, and the Windows/Linux frame geometry;
- window dragging and resizing.

## Known residuals

- SSH and container flows are opt-in (`TINKR_E2E_LOCAL_SSH=1`, Docker plus a PHP
  image). Without them the suite still runs, with those tests skipped.
- The suite is serial by construction and takes a few minutes.
- A handful of edge branches are left to unit tests: update progress/failure,
  AI provider errors and non-OpenAI wire styles, query/result limits, Monolog's
  JSON entries, and the MCP tools that read the app's history.
