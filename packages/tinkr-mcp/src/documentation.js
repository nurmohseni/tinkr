/**
 * What Tinkr is, for the model on the other side of the MCP connection.
 *
 * An agent that has the tools but not the idea uses them badly: it runs a write
 * on a production connection because nothing told it that a dry run exists, or
 * it reads a value as text because nothing told it the value is data. This is
 * the idea, written down where the tools can be read beside it.
 *
 * It is documentation, and it is the one place it lives: the text here is what
 * `tinkr_documentation` answers with, and a test asserts every tool the server
 * exposes has a section here and every section names a tool the server has — so
 * a tool added without words, or words about a tool that is gone, fails the
 * build rather than reaching a model.
 *
 * It is written for a reader who has not used the app: what it is, how a run
 * works, what the guards are, and how to pick one. It is not a list of features.
 */

/**
 * The topics the documentation can be asked for, and the one sentence each is.
 *
 * @type {Array<{name: String, title: String, summary: String}>}
 */
const topics = [
  {
    name: 'overview',
    title: 'What Tinkr is, and how a run works',
    summary: 'The shape of the app and of one run: a snippet, a session, an envelope.',
  },
  {
    name: 'guards',
    title: 'Dry runs, the sandbox, and when to use which',
    summary: 'The two guards, what each holds, and what neither can hold.',
  },
  {
    name: 'connections',
    title: 'Connections: local, container, ssh, production',
    summary: 'Where code runs, and what a production tag changes.',
  },
  {
    name: 'tools',
    title: 'The tools this server exposes',
    summary: 'Every tool, what it is for, and what it answers with.',
  },
  {
    name: 'reading',
    title: 'Reading an answer',
    summary: 'The envelope: blocks, value, error, queries, transaction, sandbox.',
  },
  {
    name: 'app',
    title: 'The app the server belongs to',
    summary: 'What the window does that the tools do not, and where the files live.',
  },
]

/**
 * The overview: what a run is.
 *
 * @type {String}
 */
const overview = `# Tinkr: a runner for the code you would type into \`php artisan tinker\`

Tinkr is a desktop app, and this server is the app's own way of running that code
from an AI client. The point of it is not that it runs php — a shell can do that —
but that it answers with **the value the code returned as data**, next to what the
code printed, the queries it sent, and what it did to the world.

## What a run is

A run is one snippet, evaluated in a session of its own.

- The session is a real \`php artisan tinker\` (or whatever command the connection
  names) in the project's directory, on this machine, inside a container, or over
  ssh. It is booted for the run and killed when the run is over, so the code on
  disk is the code that runs: a class you edited a second ago is the class the
  next run loads.
- The snippet is split by php's own tokenizer and evaluated statement by
  statement, so every line that answered something has its own value in the
  answer. A statement that throws stops the run there, and the statements before
  it keep their values.
- The answer is an envelope, not a printout: \`blocks\` (a value per statement),
  \`value\` (the last one), \`error\`, \`output\` (what the code printed), and — when
  a guard was asked for — \`queries\`, \`transaction\` and \`sandbox\`.

## What that means for you

- **Ask for a value, not a printout.** \`return $user;\` answers with the model;
  \`dump($user);\` answers with text. Both work, but only the first is data you can
  reason about.
- **One snippet, several statements.** \`$u = User::first(); $u->name;\` is two
  blocks, and the second is the name.
- **A run is not a REPL.** Variables do not survive between calls: every call is
  a new session. Put what a snippet needs in the snippet.
- **The project resolves its own classes.** A short name the project defines is
  aliased before the snippet runs, so \`Order::count()\` works where the class is
  \`App\\\\Models\\\\Order\`.

## Where to read next

- \`guards\` — before you run anything that writes.
- \`connections\` — before you name a connection.
- \`reading\` — when an answer has a key you did not expect.`

/**
 * The guards: the two dry runs.
 *
 * @type {String}
 */
const guards = `# Guards: the two dry runs

Both guards run the code inside a database transaction that is taken back at the
end. The difference is what else they hold.

## \`guard: "rollback"\` — the dry run

The snippet runs inside a transaction on the connection the run starts on, and
the transaction is rolled back when the run is done. The answer's \`transaction\`
says what happened:

| \`outcome\` | What it means |
| --- | --- |
| \`rolledBack\` | The transaction was taken back. Nothing it sent was kept. |
| \`committed\` | Only for \`guard: "commit"\`, which the app uses for "run it again and keep it". |
| \`broken\` | **The transaction was closed before the end of the run**, so what it changed may have been kept. |
| \`failed\` | The guard could not be armed, or closing it threw. Nothing ran, or what ran may be kept — \`error\` says which. |

\`broken\` is the one to read carefully. It happens when:

- the snippet sent **DDL on MySQL**: \`create table\`, \`alter table\`, \`drop\`,
  \`rename\`, or \`truncate\`, all of which commit implicitly and end the transaction;
- the snippet **committed or rolled back itself** (\`DB::commit()\`,
  \`DB::rollBack()\`, \`DB::unprepared('COMMIT')\`);
- the snippet **reconnected** (\`DB::reconnect()\`, \`DB::purge()\`) or swapped the
  default connection;
- it wrote to **another connection** — that is \`transaction.unguarded\`, and those
  statements were never inside the transaction at all.

## \`guard: "sandbox"\` — the dry run that also seals the world

A transaction holds the database and **nothing else**. \`Mail::send\`, \`dispatch\`,
\`Http::post\`, \`Storage::put\`, \`Cache::put\` and \`Log::info\` all happen while the
transaction is open and all of them survive the rollback. So a plain dry run of
code that also sends a receipt sends the receipt.

\`sandbox\` swaps those drivers for recorders before the first statement runs, each
the framework's own test double:

| What | Becomes |
| --- | --- |
| mail | the \`array\` transport: every message is recorded, none leaves |
| jobs and the bus | their fakes: a pushed job runs nowhere and the fake keeps it, whether it went through the queue or the bus |
| HTTP | a fake that answers through a stub set and **refuses what it was not given**, with a \`StrayRequestException\` |
| files | every disk is a fake root under \`storage/framework/testing/disks\` |
| cache | an array store |
| logging | a handler that keeps records instead of writing the project's log |
| notifications | their fake |

The answer's \`sandbox\` says what it caught: \`channels\` with a count per channel,
\`sent\` with the first twenty mails (subject and recipients), \`requested\` with the
first twenty requests, and \`not_sandboxed\` naming any channel it could not swap —
a session that is not a booted Laravel application, most often. A refused request
was never sent, so it is not counted in \`requests\`: the exception the run ended in
is what says it happened.

## Which one

- **Reading data:** no guard. A guard costs a transaction and changes nothing.
- **A write you want to look at:** \`rollback\`.
- **A write that might also mail, queue, call an API or write a file:**
  \`sandbox\`. This is the right default for code you did not write.
- **A write that has to happen:** no guard, and say so — a guard is the wrong
  tool for a run whose point is the change.

## What neither guard holds

- **A non-database side effect on a project the sandbox cannot reach**: a shell
  command the snippet runs (\`exec\`, \`shell_exec\`), a socket it opens, a queue
  worker's own handler, a filesystem write outside the disks Laravel knows.
- **DDL on MySQL**, whichever guard: it commits itself. \`sandbox\` does not help
  with that; it is still a \`broken\` transaction.
- **A run on another connection** from the one the guard armed on.

If you need one of those, run it against a connection that is not production.`

/**
 * The connections.
 *
 * @type {String}
 */
const connections = `# Connections: where code runs

A connection is a project plus the command that reaches it. The app saves them;
\`tinkr_list_connections\` lists them.

- **local** — the project's directory on this machine, and \`php artisan tinker\`
  run in it.
- **container** — the files are on this machine, mounted into a container, and
  the command reaches inside: \`docker exec -it <name> php artisan tinker\`,
  \`podman exec …\`, \`./vendor/bin/sail <service> …\`, or
  \`kubectl exec -it <pod> -- …\`. The index, the logs and the files are read from
  the host directory; the php is the container's.
- **ssh** — the project is on a server, reached with \`ssh\` (a key, never a
  password prompt the app cannot answer).

## The production tag

A connection can be tagged \`production\`. That tag is a promise the app makes to
its user, and this server keeps it:

- **A run on a production connection is refused** unless the server was started
  on that exact connection (\`--connection\`) or with \`--allow-production\`. The
  answer says which.
- In the app, a run that writes to a production connection is held behind a
  question, and a dry run is asked about anything its transaction cannot hold
  (DDL, the snippet's own commit, another connection).

So when a connection is tagged production, assume the honest answer is: **do not
write there**. If you are exploring, use \`guard: "sandbox"\`; if you are changing
something, say what and why before the call.

## Which connection a call uses

- \`connection: "<id or name>"\` names one. An id is exact; a name is compared
  without case, and two connections whose names differ only in case are refused
  rather than guessed between.
- \`path: "<directory>"\` runs in a directory: the connection the app saved for it,
  or the directory itself when there is none.
- Neither: the connection this server was started on.

\`tinkr_run_php\` is for a connection on this machine, \`tinkr_run_php_over_ssh\`
for one over ssh. The two are not interchangeable — a call that names the wrong
kind is refused with a message that names the right tool.`

/**
 * The tools.
 *
 * @type {String}
 */
const tools = `# The tools this server exposes

Every tool answers with \`content\` (text, for you) and \`structuredContent\` (the
same answer as data). A run whose code threw is **not** a tool error: it is an
answer with \`error\` in it, and \`isError: false\`. Only a call that could not run
at all — a missing argument, a refused connection, a session that did not start —
is \`isError: true\`.

## Running code

### \`tinkr_run_php\`
Run php in a project on this machine. Arguments: \`code\` (required), \`connection\`,
\`path\`, \`guard\`, \`timeout_ms\`.

### \`tinkr_run_php_over_ssh\`
The same, in a project on a server, through one of the app's ssh connections.
Arguments: \`code\` (required), \`connection\`, \`guard\`, \`timeout_ms\`.

## Reading what the app kept

### \`tinkr_list_history\`
The runs the app kept for a connection, newest first: the code, when it ran, and
how it ended. Arguments: \`connection\`, \`limit\` (1–50).

### \`tinkr_read_run\`
One kept run in full: what it returned, printed and threw. Arguments: \`id\`
(required), \`connection\`.

## Snippets

### \`tinkr_list_snippets\`
The snippets saved for a connection: the code that was kept, with its name.
Arguments: \`connection\`.

### \`tinkr_save_snippet\`
Keep code as a snippet of a connection, so the app has it next time. Arguments:
\`name\` (required), \`code\` (required), \`connection\`.

### \`tinkr_delete_snippet\`
Delete a snippet of a connection, by the id \`tinkr_list_snippets\` answers with.
Arguments: \`id\` (required), \`connection\`. A snippet that is already gone is not
an error — the answer says it was gone — because a delete asked for twice is
still a delete that happened. The app writes the same file, so the change is made
under the lock both writers take.

## Finding out what is there

### \`tinkr_list_connections\`
The connections saved in the app, with the command each session starts with, and
whether it is over ssh.

### \`tinkr_documentation\`
What you are reading. Arguments: \`topic\` — one of \`overview\`, \`guards\`,
\`connections\`, \`tools\`, \`reading\`, \`app\` — and \`all\` to get every topic at once.

## History is the app's own

The app keeps the last fifty runs of a connection, and **a client's own runs are
not written to it**: the app owns that file while it runs, and a run made through
this server is not one of the app's window's runs. So \`tinkr_list_history\` shows
the runs a person made in the app, not the runs you made — a difference worth
knowing before you conclude "nothing has been run here".`

/**
 * Reading an answer.
 *
 * @type {String}
 */
const reading = `# Reading an answer

A run answers with an envelope. The text beside it is the same thing, written for
a person.

\`\`\`json
{
  "blocks": [{"line": 1, "value": 42, "error": null}],
  "value": 42,
  "error": null,
  "output": "",
  "queries": [{"line": 1, "sql": "select count(*) …", "bindings": [], "time": 0.4, "connection": "mysql"}],
  "queriesTotal": 1,
  "imported": {"Order": "App\\\\Models\\\\Order"},
  "transaction": {"mode": "rollback", "armed": true, "connection": "mysql", "statements": 1, "outcome": "rolledBack", "error": null, "unguarded": {}},
  "sandbox": {"channels": {"mail": 1}, "sent": ["Receipt to a@b.c"], "requested": [], "not_sandboxed": []}
}
\`\`\`

## \`blocks\`
One entry per statement that answered, in order. \`line\` is the line of the snippet
the statement started on; several statements can share a line. \`error\` is set
when that statement threw, and the run stopped there.

## \`value\`
The last statement's value, or \`null\` for a run that threw or ended without one.
This is the one to read when the snippet is one expression.

## \`output\`
What the code printed — \`echo\`, \`print\`, \`dump\`, \`var_dump\`. It is **text**, cut
at 100 000 characters with a note saying so. Anything you need as data belongs in
the return value, not in the output.

## \`queries\` and \`queriesTotal\`
Every SQL statement the run sent through Laravel's connection, with its
bindings and its time in milliseconds. \`queriesTotal\` counts every query even
when the list was cut (a hundred entries, or two hundred kilobytes). A query that
failed is not in the list.

## \`imported\`
The short class names the project resolved for the snippet, and what each one was
aliased to. It is always there: a project that resolved nothing, and a session
whose classes were already loaded, answer \`{}\` rather than dropping the key.

## \`transaction\` and \`sandbox\`
Only present when a guard was asked for. See \`guards\`.

## Values that are not plain json

Some php values cannot be written as themselves, and are written as a string that
says what they are rather than as a \`null\` they never were:

- \`INF\`, \`-INF\`, \`NAN\` for a float that is not finite;
- the digits, as a string, for an integer past 2^53 (javascript would round it);
- \`0x…\` with the bytes in hex, for a string that is not UTF-8;
- a sentence, for an object that throws from its own \`jsonSerialize\`.

A php array keeps its order: an array with integer-like keys out of order comes
back as \`{"__tinkrMap": {…}, "__tinkrKeys": ["3","1","2"]}\`, because JSON reads
integer-like keys back in numeric order whatever they were.

## Errors

\`error\` is \`{class, message}\`, with \`previous\` when the exception had one. Two
classes you may see that are not exceptions in the code:

- \`Exit\` — the run ended in \`exit()\`, \`die()\` or \`dd()\`. What the run printed
  before it stopped is in \`output\`, and \`value\` is \`null\`.
- \`FatalError\` — a memory limit, a redeclared class, a stack overflow. The run's
  statements before it keep their values.

A run whose connection's command never booted — no \`artisan\` in the directory, a
platform check that refuses the php, a php that is not on the path — fails as the
call did, not as an answer: \`isError\` is set, and the message is the command's own
words with the status it left (\`Could not open input file: artisan\`). It comes
back as soon as the command exits, not when the timeout is spent, and what it
printed is in \`output\`.`

/**
 * The app itself.
 *
 * @type {String}
 */
const app = `# The app this server belongs to

Tinkr is a window, and this server is the same runner for an AI client. Knowing
what the window does is knowing what the files mean.

- **The editor** is where a snippet is written and run, with suggestions read
  from the project's own classes.
- **The output pane** shows the answer: the value as a tree, a table, a graph or
  rendered markup, next to what the run printed. A value that is a collection or
  a list of models is a table; HTML is a frame; everything else is a tree.
- **The queries tab** is the run's SQL with its bindings and times.
- **The logs tab** is the project's own log files, filtered by level and term.
- **The AI panel** asks about the code in front of you, with the last answer as
  context.
- **Snippets** are the code worth keeping, per connection.
- **History** is the last fifty runs of a connection, one click from the editor.
- **Settings → MCP** writes this server's entry into a client's configuration.

## Where its files live

The app keeps its own json: \`connections.json\`, \`config.json\`, and a file per
connection for snippets and for history. A client reads them through this
server — \`tinkr_list_connections\`, \`tinkr_list_snippets\`, \`tinkr_list_history\` —
and writes only the one thing it should: a snippet, under a lock every writer
takes.

## What the window has that the tools do not

- **A stop.** A run that is going can be stopped in the window; a tool call is
  stopped by cancelling it (\`notifications/cancelled\`), which kills the session
  the run is in.
- **The guards as a switch**: dry run on, and whether it is sandboxed.
- **The production question** before a write on a tagged connection. This server
  keeps the same promise by refusing the run.`

/**
 * Every topic's text, by name.
 *
 * @type {Object<String, String>}
 */
const articles = {
  overview,
  guards,
  connections,
  tools,
  reading,
  app,
}

/**
 * The documentation, as one answer.
 *
 * A topic that is not one of them is not guessed at: the answer lists the ones
 * there are, because a model that asked for \`dry-runs\` should learn the name it
 * wanted rather than be given the wrong text.
 *
 * @param {String} [topic] one topic, or `all`, or nothing for the overview
 * @return {{topic: String, title: String, text: String}} what the tool answers
 */
const documentation = topic => {
  const wanted = String(topic || 'overview').trim()

  if (wanted === 'all') {
    return {
      topic: 'all',
      title: 'Tinkr, in full',
      text: topics.map(one => articles[one.name]).join('\\n\\n---\\n\\n'),
    }
  }

  const found = topics.find(one => one.name === wanted)

  if (!found) {
    const names = topics.map(one => one.name).join(', ')

    return {
      topic: wanted,
      title: 'No such topic',
      text: `There is no topic "${wanted}". The topics are: ${names} — or all, for every one of them.`,
    }
  }

  return {
    topic: found.name,
    title: found.title,
    text: articles[found.name],
  }
}

module.exports = {
  topics,
  articles,
  documentation,
}
