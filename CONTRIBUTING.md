# CONTRIBUTING

Thanks for your interest in contributing to Tinkr!

It's hard to do it alone, so bug reports, feature requests and other contributions are more than welcome!

## Running it locally

### Requirements

* [Node.js](https://nodejs.org/)(latest)
* [Yarn](https://yarnpkg.com/)(you can use npm instead)

> **Note:** On Windows, you might need to install Bash commands (e.g. via [git-scm](https://git-scm.com/downloads) or via [linux bash shell](https://www.howtogeek.com/249966/how-to-install-and-use-the-linux-bash-shell-on-windows-10/))

### How to run

```bash
# clone your fork of the repository

cd tinkr

yarn

yarn start
```

Alternatives to `yarn start`

```bash
# start the main process
yarn start:main

# start the renderer process
yarn start:renderer
```

### Fonts

`yarn start` and `yarn build` fetch the interface's two ITF faces first —
**Switzer** for the UI and **Sentient** for the display roles, both from
Fontshare — into `packages/tinkr-renderer/public/fonts/itf`. They are not in
this repository: the ITF Free Font License lets an app embed them but not
redistribute the files, so `scripts/fetch-fonts.js` downloads them unaltered at
build time and git ignores the folder. Run it on its own with

```bash
yarn fonts
```

With no network it warns and exits successfully, and the interface falls back to
the system sans and serif. The code's face, **Commit Mono**, is OFL 1.1 and lives
in the repository beside its license. `design.md` at the root is the design
system all of it belongs to.

### Other command

#### yarn e2e

it runs the end-to-end suite: Playwright launches the real app (main process,
preload bridge and renderer) and drives it the way a person does. Every test
gets a throwaway profile, and a small tinker-compatible project in
`e2e/fixtures/app` stands in for a Laravel install, so no `composer install` and
no network is needed. See [`e2e/README.md`](./e2e/README.md) for what is covered
and which flows need Docker or a local sshd:

```bash
yarn e2e
yarn e2e e2e/specs/04-editor-run.spec.js
yarn e2e:report
```

`.github/workflows/tests.yml` runs it, after the packages' own `yarn test`,
on every push and pull request.

#### yarn rebuild

it will run `electron-rebuild -f -w node-pty` in `packages/tinkr-main`

it's very useful when you got an error like
```shell
Error: The module `/packages/tinkr-main/node_modules/node-pty/build/Release/pty.node`
was compiled against a different Node.js version using
NODE_MODULE_VERSION 83. This version of Node.js requires
NODE_MODULE_VERSION 85. Please try re-compiling or re-installing
```

#### yarn package

it will package the app depend on your OS


#### yarn mcp

it runs the MCP server (`packages/tinkr-mcp`) with plain node — the same process
an AI tool starts when it is pointed at it, and the way to try a tool by hand:

```bash
yarn mcp --path /path/to/your/project
```

The tools, and the options that say which connection to run in, are in the
README.


#### yarn release

upload the built app to github release

`.github/workflows/release.yml` runs that for you on Linux, macOS and Windows:
every push builds the app and uploads the installers to a release, tagged
`v<version>` for a version tag push and `v<version>-<short sha>` for a plain
commit, so every commit keeps its own downloads. The release goes to the
repository the workflow runs in (`scripts/config.js` reads
`GITHUB_REPOSITORY`), so a fork releases into the fork.

A version lives in the root `package.json` and in each `packages/*/package.json`,
and in the workspace dependency one package has on another — yarn links a
workspace only when the version a package asks for is the version the other one
has, so a bump that misses one is an install that cannot resolve.
