<p align="center">
  <img alt="Tinkr" src="./assets/icon.png" width="100" style="max-width:100%;"/>
</p>
<h1 align="center">Tinkr</h1>

<p align="center">
  A new way to run code. Whether you're <a href="//github.com/laravel/tinker">Laravel</a> artisan or not.
</p>
<p align="center">
  Run a snippet against a project on this machine or over ssh, and read what came
  back as the value it is, not as the text it printed.
</p>

<p align="center">
<img width="100%" alt="a run's output, and the value it returned" src="./assets/screenshot.png">
</p>

<p align="center">
<img width="100%" alt="the same window in the light palette" src="./assets/light.png">
</p>

<p align="center">
<img width="100%" alt="the ai panel proposing a snippet" src="./assets/ai.png">
</p>

### Download links
Installers are published to the Releases page of the repository that builds the app.

### Features

- [x] **Connections**: Quick connect to your app either locally, in production or in docker container etc;
- [x] **Snippets**: Manage the code snippets you have ran;
- [x] **History**: the runs of a connection — the code that ran, when, and what came back — kept across restarts, and a click puts a run's code back in the editor;
- [x] **Editor**: Run your terminal code via editor;
- [x] **Output**: Focus on the results you really care that terminal return;
- [x] **AI completions**: complete the snippet from whatever provider you point it at: OpenAI, Claude, Ollama, OpenCode Zen or Go, OpenRouter, or your own endpoint;
- [x] **AI panel**: ask about the code in front of you, with the answer the last run gave going along and the project files you name with `@`, and take the code an answer proposes;
- [x] **Log viewer**: the project's own log files — `storage/logs`, or wherever you say — filtered by level and by term, each entry with the stack trace or the context it came with, and followed while the application keeps writing to it;
- [x] **Structured results**: the value a run answers with arrives as data, so objects and arrays come as expandable structure instead of text;
- [x] **Fresh session**: every run boots a new Tinker session, so the code you just changed on disk is the code that runs;
- [x] **Snippet Form**: Switch the editor to the form, so that you can modify your variable value via form, like an admin panel;
- [x] **Dark and light**: one palette in two readings — a celadon floor, the desk the panes sit on, and the wells the code and the values live in — for the whole app, both terminals, the editor and the settings window;
- [x] **MCP server**: your AI tools run code in the same connections the app runs it in, over the [Model Context Protocol](https://modelcontextprotocol.io);

## Tech Stack

* [Electron](https://www.electronjs.org/)
* [Yarn Workspaces](https://classic.yarnpkg.com/lang/en/docs/workspaces/) (Monorepo)

### Renderer

* [React](https://reactjs.org/)
* [jotai](https://github.com/pmndrs/jotai) (State manage)
* [Immer](https://immerjs.github.io/immer/)
* [Monaco Editor](https://microsoft.github.io/monaco-editor/)
* [Xterm.js](https://xtermjs.org/)
* [wouter](https://github.com/molefrog/wouter)
* [Evergreen](https://evergreen.segment.com/) (the spinner before the locale lands, and the theme bridge)
* [React Hook Form](https://react-hook-form.com/)
* [nanoid](https://zelark.github.io/nano-id-cc/)
* [React Intl](https://formatjs.io/docs/react-intl/)
* [Vite](https://vitejs.dev/) (build the renderer process code)

The interface is drawn from one system: [`design.md`](./design.md) holds the type, the palette,
the spacing, the motion and the component voice, and `packages/tinkr-renderer/public/tinkr.css`
carries the tokens every screen reads — the editor, both terminals and the settings window
included. The three faces are Switzer and Sentient (Fontshare, fetched at build time) and
Commit Mono (OFL).

### Main

* [node-pty](https://github.com/microsoft/node-pty)
* [electron-store](https://github.com/sindresorhus/electron-store)
* [ncc](https://github.com/vercel/ncc) (build the main process code)

## MCP server

Tinkr comes with a [Model Context Protocol](https://modelcontextprotocol.io) server, so the AI tool
you already work in can run code the way you do: in a project on this machine or over one of your
ssh connections, in that project's own Tinker session, and with the value the run returned as data
rather than as the text it printed.

Every call boots a session of its own and closes it when the run answers — the same rule the app's
Run follows — so the code on disk is the code that runs.

The app is also what configures a client, from **Settings → MCP**: it lists the clients it knows —
Claude Code, Claude Desktop, Cursor, Windsurf/Devin Desktop, VS Code — with the file each one would
be written to, writes the entry for the one you configure, marks the ones that already point at
Tinkr, and hands the same entry over as json for any other client. Which connection a client's calls
run in is a preference on that screen; with none chosen, a call runs in the project the client is
working in.

A client starts it, and the directory it is started in is the project code runs in:

```json
{
  "mcpServers": {
    "tinkr": {
      "command": "node",
      "args": ["/path/to/tinkr/packages/tinkr-mcp/src/cli.js"]
    }
  }
}
```

The same thing from a terminal, which is also how to see what a tool answers on its own:

```sh
yarn mcp --path /path/to/your/project
```

When Tinkr has a connection for that directory, the server runs in that connection, so the snippets
it reads and keeps are the app's own. When it does not, the directory is a connection of its own and
the app's connections are still reachable by name.

### Tools

| Tool | What it does |
| --- | --- |
| `tinkr_run_php` | Run PHP in a project on this machine: what every statement returned, and what the code printed |
| `tinkr_run_php_over_ssh` | The same, on a server, through one of Tinkr's ssh connections |
| `tinkr_list_history` | The runs the app kept for a connection: the code, when it ran, and how it ended |
| `tinkr_read_run` | One kept run in full: what it returned, what it printed, what it threw |
| `tinkr_list_connections` | The connections saved in the app, with the command each session is started with |
| `tinkr_list_snippets` | The snippets saved for a connection |
| `tinkr_save_snippet` | Keep code as a snippet of a connection |

The history a client reads is the app's own: the last fifty runs of a connection,
each with the code that ran and as much of the answer as the entry keeps — a run
whose value or printed output was too big to hold says which part it is missing.
A client's own runs are not written to it, because the app holds that list while
it runs and two writers of one file lose each other's work.

### Options

| Option | What it is |
| --- | --- |
| `--connection <id\|name>` | run in a connection the app knows, by id or by name |
| `--path <directory>` | the project to run in (default: where the client started it) |
| `--command <command>` | what the session is started with (default: the connection's own, or the app's preference, `php artisan tinker`) |
| `--data-dir <directory>` | where the app keeps its connections and snippets, when it is not where the server looks |
| `--timeout <ms>` | how long a run may take before it is given up on (default: 60000) |

The server needs no API token and no running window: it boots the session itself, in the project,
with `node` and the project's own `php`. A packaged app carries its own copy of it beside the main
process — outside the asar, where a plain `node` can read it — and a checkout runs the same server
from `packages/tinkr-mcp`.

## Contributing to Tinkr

See [CONTRIBUTING.md](./CONTRIBUTING.md)

## Ask for help

If the troubleshooting guides did not resolve the issue, please file an issue on the repository that builds the app.

## License

[MIT](./LICENSE)
