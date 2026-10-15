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
- [x] **Structured results**: the value a run answers with arrives as data, so objects and arrays come as expandable structure instead of text;
- [x] **Fresh session**: every run boots a new Tinker session, so the code you just changed on disk is the code that runs;
- [x] **Snippet Form**: Switch the editor to the form, so that you can modify your variable value via form, like an admin panel;
- [x] **Dark mode**: a warm dark palette for the whole app, the terminals and the editor;

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
* [Evergreen](https://evergreen.segment.com/) (UI)
* [React Hook Form](https://react-hook-form.com/)
* [nanoid](https://zelark.github.io/nano-id-cc/)
* [React Intl](https://formatjs.io/docs/react-intl/)
* [Vite](https://vitejs.dev/) (build the renderer process code)

### Main

* [node-pty](https://github.com/microsoft/node-pty)
* [electron-store](https://github.com/sindresorhus/electron-store)
* [ncc](https://github.com/vercel/ncc) (build the main process code)

## Contributing to Tinkr

See [CONTRIBUTING.md](./CONTRIBUTING.md)

## Ask for help

If the troubleshooting guides did not resolve the issue, please file an issue on the repository that builds the app.

## License

[MIT](./LICENSE)
