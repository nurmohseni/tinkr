const fs = require('fs')
const path = require('path')
const {spawn} = require('child_process')
const {test, expect} = require('@playwright/test')

const {copyFixture, fixtureConnection, launchTinkr, repo, seedProfile} = require('../support/tinkr')
const {runEditor} = require('../support/actions')

/**
 * A copy of the fixture whose database outlives one session.
 *
 * The app starts a session per run, and the fixture's database is in memory, so
 * a row a run wrote is gone with the run whether or not it was kept. A copy
 * with `storage/fixture-db` in it shares one seeded sqlite file between its
 * sessions (see the fixture's connection), which is what makes "the database is
 * unchanged after the dry run" something a later run can read.
 *
 * @return {String} the project's directory
 */
const persistentFixture = () => {
  const project = copyFixture()

  fs.writeFileSync(path.join(project, 'storage', 'fixture-db'), '')

  return project
}

/**
 * Put code in the well and run it.
 *
 * The editor is Monaco's, and its text lines are a layer the content scrolls
 * under: a click aimed at them lands on the gutter or the ruler once the editor
 * has scrolled. The editor's own box does not move, so the caret is put in it
 * through that, and the rest is keyboard. Every call is on the run's own line,
 * which is what the app waits on.
 *
 * @param {import('playwright').Page} page
 * @param {String} code
 */
const type = async (page, code) => {
  await page.locator('.editor .monaco-editor').first().click()

  // the input element is Monaco's and it may not be in the dom yet; the click
  // already put the keyboard in the editor, so this only pins it there
  const surface = page.locator('.editor textarea.inputarea').first()

  if (await surface.count()) {
    await surface.focus()
  }

  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(code)
  await expect(page.locator('.tabbar .btn--run').first()).toBeEnabled({timeout: 5_000})

  return runEditor(page)
}

// a write a person makes in tinker: one row updated, one created, through the
// model the fixture resolves
const write = '$one = Note::find(2);\n' +
  '$one->published = 0;\n' +
  '$one->save();\n' +
  "Note::create(['title' => 'Mira',\n" +
  "  'published' => 1]);"

// the row the write created, read as the model the run would have found:
// nothing after a rollback, the row itself after a run that was kept
const created = '$one = Note::find(4);\n$one;'

// one column of the row the write updated, read without a query of its own
const updated = '$one = Note::find(2);\n$one->published;'

/**
 * How many notes carry a title, as the run's own value: one number, and one
 * statement, so the answer is the number and not the list it came in.
 *
 * The brackets are whole on the line: the editor closes a bracket as it takes
 * the text, so a call left open across a line break comes back with a closer of
 * its own and the run is a parse error.
 *
 * @param {String} title
 * @return {String}
 */
const notesNamed = title => `DB::select("select count(*) as n from notes where title = '${title}'")[0]['n'];`

// a write nothing can describe: raw SQL, no model, no event
const raw = "DB::update(\"update notes set title = 'Gone' where id = 3\");"

/**
 * Start the MCP server the way a client does: a node process, JSON-RPC on stdin
 * and stdout.
 */
const startServer = args => {
  const child = spawn(process.execPath, [
    path.join(repo, 'packages', 'tinkr-mcp', 'src', 'cli.js'),
    ...args,
  ], {cwd: repo, stdio: ['pipe', 'pipe', 'pipe']})

  const pending = new Map()
  let buffer = ''

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk

    let newline = buffer.indexOf('\n')

    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()

      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')

      if (line === '') {
        continue
      }

      const message = JSON.parse(line)

      if (message.id !== undefined && pending.has(message.id)) {
        const {resolve, reject} = pending.get(message.id)

        pending.delete(message.id)
        message.error ? reject(new Error(message.error.message)) : resolve(message.result)
      }
    }
  })

  let next = 0

  return {
    request: (method, params) => {
      const id = ++next

      return new Promise((resolve, reject) => {
        pending.set(id, {resolve, reject})
        child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', id, method, params})}\n`)
      })
    },
    stop: () => new Promise(resolve => {
      if (child.exitCode !== null) {
        resolve()

        return
      }

      child.once('exit', resolve)
      child.kill('SIGTERM')

      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL')
        }
      }, 3000).unref()
    }),
  }
}

test.describe('what a dry run changed', () => {
  test('reads the rows it would have written, and leaves the database as it was', async () => {
    const project = persistentFixture()
    const {page, close} = await launchTinkr({connections: [fixtureConnection({path: project})]})

    try {
      const dry = page.locator('.tabbar button[aria-pressed]')

      await dry.click()
      await expect(dry).toHaveAttribute('aria-pressed', 'true')

      await type(page, write)

      const changes = page.locator('.output .changes')

      await expect(changes).toBeVisible()
      // the report above it says the transaction was taken back; this is what it
      // took back, grouped by the table it was in
      await expect(page.locator('.output .guard')).toContainText('Rolled back 3 statements on fixture')
      await expect(changes.locator('.changes__head')).toContainText('Changes')
      await expect(changes.locator('.changes__head')).toContainText('2 changes')
      await expect(changes.locator('.changes__table-name')).toHaveText(['notes'])

      const rows = changes.locator('.changes__row')

      await expect(rows).toHaveCount(2)

      // an update is read old → new, one column at a time
      const row = rows.nth(0)

      await expect(row.locator('.changes__op')).toHaveText('updated')
      await expect(row.locator('.changes__key')).toHaveText('id 2')
      await expect(row.locator('.changes__column')).toHaveText('published')
      await expect(row.locator('.t-number')).toHaveText(['1', '0'])
      await expect(row.locator('.changes__arrow')).toHaveText('→')

      // a created row is read as its values, with no before and no arrow
      const made = rows.nth(1)

      await expect(made.locator('.changes__op')).toHaveText('created')
      await expect(made.locator('.changes__key')).toHaveText('id 4')
      await expect(made.locator('.changes__column').first()).toHaveText('title')
      await expect(made).toContainText('"Mira"')
      // the flag it was given, and its key
      await expect(made.locator('.t-number')).toHaveText(['1', '4'])
      await expect(made.locator('.changes__arrow')).toHaveCount(0)

      // and nothing was written: no note carries the title the run created, and
      // the one it updated still has its old value
      await type(page, notesNamed('Mira'))

      await expect(page.locator('.output .tree .t-number').first()).toHaveText('0')

      await type(page, updated)

      // the run's own answer is the tree of its last statement: this snippet
      // opens with an assignment that answers a model, and a model's fields are
      // drawn too — its key is a number, and reading the pane's first number
      // would read that key rather than the value the run was asked for
      await expect(page.locator('.output .tree').last().locator('.t-number').first()).toHaveText('1')

      // a write nothing could describe is counted rather than left out
      await type(page, raw)

      const undiffed = page.locator('.output .changes')

      await expect(undiffed).toBeVisible()
      await expect(undiffed.locator('.changes__head')).toContainText('0 changes')
      await expect(undiffed.locator('.changes__undiffed')).toContainText('1 write could not be diffed')
      await expect(undiffed.locator('.changes__sql')).toHaveText("update notes set title = 'Gone' where id = 3")

      // and that write was taken back too
      await type(page, notesNamed('Archived'))

      await expect(page.locator('.output .tree .t-number').first()).toHaveText('1')
    } finally {
      await close()
      fs.rmSync(project, {recursive: true, force: true})
    }
  })

  test('is not there for a run that was not guarded', async () => {
    const project = persistentFixture()
    const {page, close} = await launchTinkr({connections: [fixtureConnection({path: project})]})

    try {
      const dry = page.locator('.tabbar button[aria-pressed]')

      await expect(dry).toHaveAttribute('aria-pressed', 'false')

      await type(page, write)

      // no transaction, so no report of one and no changes under it
      await expect(page.locator('.output .guard')).toHaveCount(0)
      await expect(page.locator('.output .changes')).toHaveCount(0)

      // and the run was kept: the row it created is there with the title it was
      // given, and the update it made stayed
      await type(page, notesNamed('Mira'))

      await expect(page.locator('.output .tree .t-number').first()).toHaveText('1')

      await type(page, updated)

      // the last statement's tree is the run's answer; the assignment above it
      // answers a model whose key is a number of its own
      await expect(page.locator('.output .tree').last().locator('.t-number').first()).toHaveText('0')
    } finally {
      await close()
      fs.rmSync(project, {recursive: true, force: true})
    }
  })

  test('answers the MCP server with the same rows', async () => {
    const project = persistentFixture()
    const profile = seedProfile({connections: []})
    const server = startServer([
      '--path', project,
      '--data-dir', path.join(profile, 'Electron'),
      '--timeout', '20000',
    ])

    try {
      await server.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: {name: 'tinkr-e2e', version: '1'},
      })

      const answer = await server.request('tools/call', {
        name: 'tinkr_run_php',
        arguments: {code: write, guard: 'rollback'},
      })

      expect(answer.isError).toBe(false)

      const {transaction} = answer.structuredContent

      expect(transaction).toMatchObject({mode: 'rollback', armed: true, outcome: 'rolledBack', changesTotal: 2})
      expect(transaction.changes).toEqual([
        {
          connection: 'fixture',
          table: 'notes',
          key: {id: 2},
          op: 'updated',
          before: {published: 1},
          after: {published: 0},
        },
        {
          connection: 'fixture',
          table: 'notes',
          key: {id: 4},
          op: 'created',
          before: null,
          after: {title: 'Mira', published: 1, id: 4},
        },
      ])
      expect(transaction.undiffed).toEqual({count: 0, sample: []})

      // the text beside it says the same, one line per row
      expect(answer.content[0].text).toContain('Changes: 2 rows.')
      expect(answer.content[0].text).toContain('updated notes id=2: published 1 → 0')
      expect(answer.content[0].text).toContain('created notes id=4: title "Mira"')

      // a later call reads the same file database and finds none of it
      const after = await server.request('tools/call', {
        name: 'tinkr_run_php',
        arguments: {code: created},
      })

      expect(after.isError).toBe(false)
      expect(after.structuredContent.value).toBe(null)
    } finally {
      await server.stop()
      fs.rmSync(profile, {recursive: true, force: true})
      fs.rmSync(project, {recursive: true, force: true})
    }
  })
})
