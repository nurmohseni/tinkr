/**
 * What a snippet does to the database, read from the snippet itself before it
 * is sent.
 *
 * A run is handed to whichever connection the window has open, and a connection
 * tagged production is the one whose data cannot be brought back. The app's
 * answer is to ask before a run that writes rather than tell afterwards, and
 * this is what the question is built from.
 *
 * It is a scan of the text, not a parse of it, and that is deliberate: the run
 * is PHP that exists as a string until the session evals it, so the only reading
 * there is before a run is the one the text itself allows. What is looked for is
 * the call rather than what it is called on — `->delete(` and `DB::delete(` are
 * the same write, and the chain in front of them is not something a scan can
 * follow — so a run that writes without naming any of these (a method held in a
 * variable, a string handed to a helper) is missed. That is the honest limit of
 * reading a run before running it; the names below are the ones Laravel, its
 * query builder and Eloquent write with, which is what a snippet in this app is
 * made of. The raw statements are looked for as well, since `DB::statement` and
 * `DB::unprepared` take SQL the snippet writes itself.
 *
 * Each one is reported at the line it starts on, so a chain broken over several
 * lines answers with the line the call is on rather than the line the chain
 * began on, and the same call twice on one line is one entry.
 */

// the calls that leave the database different from how they found it, grouped by
// what each one does rather than sorted, since the list is read by whoever adds
// to it
const WRITE_CALLS = [
  // a row that was not there
  'insert', 'insertGetId', 'insertOrIgnore', 'insertUsing', 'upsert',
  'firstOrCreate', 'updateOrCreate',
  // a row that was
  'update', 'updateOrInsert', 'increment', 'decrement', 'save',
  // rows that will not be there afterwards
  'delete', 'forceDelete', 'destroy', 'truncate',
  // the table itself
  'create', 'drop', 'dropIfExists', 'rename',
  // the connection, with SQL the snippet brought with it
  'statement', 'unprepared',
  // a relation, which writes the pivot table between the two models
  'attach', 'detach', 'sync', 'syncWithoutDetaching',
]

// SQL that writes, wherever it is found — inside a `DB::statement` call, or in a
// string a helper was handed. It is read case-insensitively and the words are
// reported as they were matched, so `delete from` reads as the statement it is.
const WRITE_SQL = /\b(delete\s+from|insert\s+into|update\s+\S+\s+set|drop\s+table|alter\s+table|truncate\b)/gi

// an artisan command that takes the database with it. Every other command is
// left alone: `Artisan::call('config:clear')` is a run nobody needs to be asked
// about
const WRITE_COMMAND = /Artisan::call\s*\(\s*['"]([\w:.-]+)/g
const WRITE_COMMAND_PREFIXES = ['migrate', 'db:', 'queue:flush', 'queue:clear']

export const mutationScan = code => {
  const text = String(code ?? '')
  const found = new Map()

  const collect = (index, call) => {
    // the line the match starts on, counted the way an editor counts them
    const line = text.slice(0, index).split('\n').length
    const key = `${line}:${call}`

    if (!found.has(key)) {
      found.set(key, {line, call})
    }
  }

  WRITE_CALLS.forEach(name => {
    // called on a value or on a facade: `$row->delete(` and `DB::delete(`
    const pattern = new RegExp(`(?:->|::)${name}\\s*\\(`, 'g')

    let match = pattern.exec(text)

    while (match) {
      collect(match.index, name)
      match = pattern.exec(text)
    }
  })

  let sql = WRITE_SQL.exec(text)

  while (sql) {
    collect(sql.index, sql[1].toLowerCase().replace(/\s+/g, ' '))
    sql = WRITE_SQL.exec(text)
  }

  let command = WRITE_COMMAND.exec(text)

  while (command) {
    if (WRITE_COMMAND_PREFIXES.some(prefix => command[1].startsWith(prefix))) {
      collect(command.index, command[1])
    }

    command = WRITE_COMMAND.exec(text)
  }

  return [...found.values()].sort((a, b) => a.line - b.line)
}
