const {runCode} = require('tinkr-core')

const app = require('./app')
const target = require('./target')

/**
 * The tools this server exposes, and what they answer with.
 *
 * The names are the app's own: whoever calls one is running code the way Tinkr
 * runs it — in a project, in that project's tinker session, over ssh when the
 * connection says so.
 *
 * A snippet that throws is not a tool that failed: the run happened and the code
 * failed, so the answer carries the error and the caller reasons about it. Only
 * a run that never came back — the session would not start, or the code took
 * longer than the caller was willing to wait — is a tool error.
 */

// how much of a run's own text is handed back. The value of a run is data and is
// not cut, but what it printed can be a megabyte of `dump` output and a model
// pays for every character of it
const maxText = 100000

const json = value => JSON.stringify(value, null, 2)

/**
 * @param {String} text
 * @param {Number} [length] how much of it to keep, when it is not the run
 * output's own limit
 * @return {String}
 */
const truncate = (text, length = maxText) => (text.length > length
  ? `${text.slice(0, length)}\n… ${text.length - length} characters were cut`
  : text)

/**
 * What the run answers with, as text: every statement that answered something,
 * then what the run printed.
 *
 * The words are the app's own — a statement that threw is on its line, and the
 * run's output is "printed" — because they are what the same result is called in
 * the app's output pane.
 *
 * @param {Object} result the run envelope
 * @return {String}
 */
const render = result => {
  const lines = []

  for (const block of result.blocks || []) {
    if (block.error) {
      lines.push(`Line ${block.line}: threw ${block.error.class}: ${block.error.message}`)

      continue
    }

    if (block.value === null || block.value === undefined) {
      continue
    }

    lines.push(`Line ${block.line}: ${json(block.value)}`)
  }

  if (lines.length === 0) {
    lines.push('no value returned')
  }

  if (result.output) {
    lines.push('', 'printed:', result.output.replace(/\s+$/, ''))
  }

  return truncate(lines.join('\n'))
}

/**
 * A run from the app's history, as text: when it ran and how it ended, the code
 * that ran, then what came back of what the entry kept.
 *
 * The words are the run result's own — `returned`, `printed`, `threw` — because
 * they are what the app calls the same three things in its sidebar.
 *
 * @param {Object} entry
 * @return {String}
 */
const renderRun = entry => {
  const lines = [
    `${new Date(entry.at).toISOString()} · ${entry.outcome} · ${entry.id}`,
    '',
    truncate(entry.code, 4000),
  ]

  if (entry.error) {
    lines.push('', `threw ${entry.error.class}: ${entry.error.message}`)
  }

  if (entry.value !== undefined) {
    lines.push('', 'returned:', json(entry.value))
  }

  if (entry.output) {
    lines.push('', 'printed:', entry.output.replace(/\s+$/, ''))
  }

  if (entry.cut) {
    lines.push('', `not kept whole: ${entry.cut.join(', ')}`)
  }

  return truncate(lines.join('\n'))
}

/**
 * The run, as the tool answers with it.
 *
 * @param {Object} result
 * @return {{content: Array, structuredContent: Object, isError: Boolean}}
 */
const answer = result => ({
  content: [{type: 'text', text: render(result)}],
  structuredContent: result,
  isError: false,
})

/**
 * The call that did not come back, as the tool answers with it: the code never
 * ran, so there is no result to read, only what went wrong.
 *
 * @param {Error} error
 * @return {{content: Array, structuredContent: Object, isError: Boolean}}
 */
const failure = error => ({
  content: [{type: 'text', text: error.message}],
  structuredContent: {error: error.message},
  isError: true,
})

/**
 * @param {Object} args
 * @return {String}
 */
const codeOf = args => {
  if (typeof args.code !== 'string' || args.code.trim() === '') {
    throw new Error('`code` is required: the PHP to run.')
  }

  return args.code
}

/**
 * @param {Object} args
 * @param {Number} fallback
 * @return {Number}
 */
const timeoutOf = (args, fallback) => {
  const asked = Number(args.timeout_ms)

  if (!Number.isFinite(asked) || asked <= 0) {
    return fallback
  }

  // a session that is given a minute is a session that is still holding a pty
  // when the client that asked for it has gone
  return Math.min(Math.max(asked, 1000), 600000)
}

/**
 * How many runs a list shows: enough to scan, few enough to read.
 *
 * @param {Object} args
 * @return {Number}
 */
const limitOf = args => {
  const asked = Number(args.limit)

  if (!Number.isFinite(asked) || asked <= 0) {
    return 10
  }

  return Math.min(Math.floor(asked), 50)
}

/**
 * @param {Record<String, any>} connection
 * @return {Object}
 */
const connectionInfo = connection => ({
  id: connection.id,
  name: connection.name || null,
  tag: connection.tag || null,
  directory: connection.is_over_ssh ? null : connection.path || null,
  command: connection.command || null,
  over_ssh: Boolean(connection.is_over_ssh),
  ssh: connection.is_over_ssh
    ? {
        server: connection.ssh_server || null,
        user: connection.ssh_user || null,
        port: connection.ssh_port || null,
      }
    : null,
})

const TOOLS = [
  {
    name: 'tinkr_run_php',
    title: 'Run PHP in a project',
    description: 'Run PHP in a project on this machine, in that project\'s own Tinker session, ' +
      'and answer with what every statement returned and what the code printed. The session ' +
      'is booted for the call, so the code on disk is the code that runs, and the code runs ' +
      'with the project booted: its classes, its configuration, its database. Every statement ' +
      'is evaluated in order and the run stops at the first one that throws.',
    annotations: {readOnlyHint: false, destructiveHint: true, openWorldHint: false},
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The PHP to run, written as it would be typed into tinker. A leading ' +
            '`<?php` is allowed.',
        },
        path: {
          type: 'string',
          description: 'The project directory to run in, when it is not the one this server was ' +
            'started in.',
        },
        connection: {
          type: 'string',
          description: 'The id or name of a connection saved in Tinkr, when the code should run ' +
            'in that one. A connection over ssh is refused here: use tinkr_run_php_over_ssh.',
        },
        timeout_ms: {
          type: 'number',
          description: 'How long to wait for the session before giving up, in milliseconds. ' +
            'A minute by default.',
        },
      },
      required: ['code'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        value: {description: 'What the last statement answered, as data.'},
        blocks: {
          type: 'array',
          description: 'What every statement answered, in the order they ran.',
          items: {
            type: 'object',
            properties: {
              line: {type: 'number'},
              value: {},
              error: {
                type: ['object', 'null'],
                properties: {class: {type: 'string'}, message: {type: 'string'}},
              },
            },
          },
        },
        error: {
          type: ['object', 'null'],
          description: 'The exception that stopped the run, when one did.',
          properties: {class: {type: 'string'}, message: {type: 'string'}},
        },
        output: {type: 'string', description: 'What the code printed.'},
        imported: {
          type: 'object',
          description: 'The classes the run aliased by their short name, when it aliased any.',
        },
      },
    },
  },
  {
    name: 'tinkr_run_php_over_ssh',
    title: 'Run PHP on a server',
    description: 'Run PHP on a server, through one of Tinkr\'s saved ssh connections, in the ' +
      'session that connection runs (`php artisan tinker` by default). The connection is opened ' +
      'for the call and closed when it answers. What runs is code on someone else\'s machine: ' +
      'read it before it runs.',
    annotations: {readOnlyHint: false, destructiveHint: true, openWorldHint: true},
    inputSchema: {
      type: 'object',
      properties: {
        connection: {
          type: 'string',
          description: 'The id or name of a connection saved in Tinkr that runs over ssh.',
        },
        code: {type: 'string', description: 'The PHP to run, written as it would be typed into tinker.'},
        timeout_ms: {
          type: 'number',
          description: 'How long to wait for the session before giving up, in milliseconds. ' +
            'A minute by default.',
        },
      },
      required: ['connection', 'code'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        value: {description: 'What the last statement answered, as data.'},
        blocks: {type: 'array', items: {type: 'object'}},
        error: {type: ['object', 'null']},
        output: {type: 'string'},
      },
    },
  },
  {
    name: 'tinkr_list_history',
    title: 'List the runs the app kept',
    description: 'List the runs Tinkr has kept for a connection, newest first: the code that ran, ' +
      'when, and how it ended. It is the app\'s own history, so it is the runs that were made ' +
      'there — through this server, or by hand. Read one of them to see what came back.',
    annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
    inputSchema: {
      type: 'object',
      properties: {
        connection: {
          type: 'string',
          description: 'The id or name of a connection saved in Tinkr. The connection this ' +
            'server was started on when it is not given.',
        },
        limit: {
          type: 'number',
          description: 'How many runs to list, newest first. Ten by default, fifty at most.',
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        connection: {type: 'string'},
        runs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: {type: 'string'},
              at: {type: 'string', description: 'when the run started, in ISO 8601'},
              outcome: {type: 'string', description: 'returned, printed or threw'},
              code: {type: 'string'},
            },
          },
        },
      },
    },
  },
  {
    name: 'tinkr_read_run',
    title: 'Read one kept run',
    description: 'Read one run from a connection\'s history in full: the code that ran, when, what ' +
      'it returned, what it printed, and the exception it threw. A run answers with as much of ' +
      'itself as the app keeps — where that is not the whole answer, the parts that were too big ' +
      'are named, and the code can be run again for the whole thing.',
    annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
    inputSchema: {
      type: 'object',
      properties: {
        id: {type: 'string', description: 'The id of the run, as the history lists it.'},
        connection: {
          type: 'string',
          description: 'The id or name of a connection saved in Tinkr. The connection this ' +
            'server was started on when it is not given.',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: {type: 'string'},
        at: {type: 'string'},
        outcome: {type: 'string'},
        code: {type: 'string'},
        value: {description: 'What the run returned, when the entry kept it.'},
        error: {type: ['object', 'null'], properties: {class: {type: 'string'}, message: {type: 'string'}}},
        output: {type: 'string', description: 'What the run printed, when the entry kept it.'},
        cut: {
          type: 'array',
          description: 'The parts of the answer that were too big to keep.',
          items: {type: 'string'},
        },
      },
    },
  },
  {
    name: 'tinkr_list_connections',
    title: 'List the saved connections',
    description: 'List the connections saved in Tinkr: the directories and the servers the app ' +
      'runs code in, with the command each session is started with.',
    annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
  },
  {
    name: 'tinkr_list_snippets',
    title: 'List the saved snippets',
    description: 'List the snippets saved in Tinkr for a connection: the code that was kept, ' +
      'with the name it was given. A snippet is what the app shows in its sidebar.',
    annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
    inputSchema: {
      type: 'object',
      properties: {
        connection: {
          type: 'string',
          description: 'The id or name of a connection saved in Tinkr. The connection this ' +
            'server was started on when it is not given.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'tinkr_save_snippet',
    title: 'Save a snippet',
    description: 'Save code in Tinkr as a snippet of a connection, so that the app has it the ' +
      'next time it starts.',
    annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: false},
    inputSchema: {
      type: 'object',
      properties: {
        code: {type: 'string', description: 'The code to keep.'},
        name: {type: 'string', description: 'The name the snippet is listed under.'},
        connection: {
          type: 'string',
          description: 'The id or name of a connection saved in Tinkr. The connection this ' +
            'server was started on when it is not given.',
        },
      },
      required: ['code', 'name'],
      additionalProperties: false,
    },
  },
]

/**
 * The server's tools, over a target and a way to run code in it.
 *
 * @param {{target: Object, version: String, timeout?: Number,
 *   run?: Function, log?: Object}} options `target` is target.resolve's answer,
 *   `run` is what actually runs the code, and is replaced in a test
 * @return {{tools: Array, call: Function, instructions: String}}
 */
const createServer = ({target: resolved, version, timeout = 60000, run = runCode, log = console}) => {
  /**
   * @param {Object} connection
   * @param {String} code
   * @param {Number} ms
   * @return {Promise<Object>}
   */
  const execute = (connection, code, ms) => run(connection, code, {
    timeout: ms,
    command: connection.command,
    appName: 'Tinkr',
    appVersion: version,
    log,
  })

  /**
   * The connection a tool call names, or the one this server was started on.
   *
   * @param {Object} args
   * @param {Boolean} overSsh whether the tool is the ssh one
   * @return {Object} the resolved target
   */
  const connectionOf = (args, overSsh = false) => {
    if (!args.connection && !args.path) {
      if (Boolean(resolved.connection.is_over_ssh) !== overSsh) {
        throw new Error(overSsh
          ? `This server was started on ${resolved.connection.name}, which runs on this machine. ` +
            'Name a connection that runs over ssh.'
          : `This server was started on ${resolved.connection.name}, which runs over ssh. ` +
            'Use tinkr_run_php_over_ssh.')
      }

      return resolved
    }

    const found = target.resolve({
      connection: args.connection,
      at: args.path,
      command: resolved.connection.command,
      dataDir: resolved.dataDir,
    })

    if (found.connection.is_over_ssh !== overSsh) {
      throw new Error(found.connection.is_over_ssh
        ? `${found.connection.name} runs over ssh. Use tinkr_run_php_over_ssh.`
        : `${found.connection.name} runs on this machine. Use tinkr_run_php.`)
    }

    return found
  }

  /**
   * The connection a snippet belongs to, which has to be one the app knows:
   * a snippet of a directory the app has no connection for is a snippet nobody
   * will ever be shown.
   *
   * @param {Object} args
   * @return {Object}
   */
  const knownConnectionOf = args => {
    const found = connectionOf(args)

    if (!found.saved) {
      throw new Error(
        `Tinkr has no connection for ${found.connection.path}, so it has no snippets to keep. ` +
        'Add the directory as a connection in the app first, or name one with `connection`.',
      )
    }

    return found
  }

  /**
   * @param {Object} args
   * @return {Promise<Object>}
   */
  const runTool = async (args, overSsh) => {
    const found = connectionOf(args, overSsh)

    return answer(await execute(found.connection, codeOf(args), timeoutOf(args, timeout)))
  }

  /**
   * @param {String} name
   * @param {Object} args
   * @return {Promise<Object>}
   */
  const handle = async (name, args) => {
    switch (name) {
      case 'tinkr_run_php':
        return runTool(args, false)

      case 'tinkr_run_php_over_ssh':
        return runTool(args, true)

      case 'tinkr_list_history': {
        const found = knownConnectionOf(args)
        // the app keeps its runs newest first, and a slice of a list that was
        // written some other way would be the wrong runs
        const runs = app.history(found.dataDir, found.connection.id)
          .slice()
          .sort((one, other) => other.at - one.at)
          .slice(0, limitOf(args))

        return {
          content: [{
            type: 'text',
            text: runs.length
              ? runs.map(entry => [
                `${new Date(entry.at).toISOString()} · ${entry.outcome} · ${entry.id}`,
                truncate(entry.code, 500),
              ].join('\n')).join('\n\n')
              : 'This connection has run nothing yet.',
          }],
          structuredContent: {
            connection: found.connection.id,
            runs: runs.map(entry => ({
              id: entry.id,
              at: new Date(entry.at).toISOString(),
              outcome: entry.outcome,
              code: entry.code,
            })),
          },
          isError: false,
        }
      }

      case 'tinkr_read_run': {
        const found = knownConnectionOf(args)

        if (typeof args.id !== 'string' || args.id.trim() === '') {
          throw new Error('`id` is required: the id of the run, as the history lists it.')
        }

        const entry = app.history(found.dataDir, found.connection.id)
          .find(one => one.id === args.id)

        if (!entry) {
          throw new Error(
            `No run with the id ${args.id} is kept for ${found.connection.name}. ` +
            'List the history for the ids of the runs that are.',
          )
        }

        return {
          content: [{type: 'text', text: renderRun(entry)}],
          structuredContent: Object.assign({}, entry, {at: new Date(entry.at).toISOString()}),
          isError: false,
        }
      }

      case 'tinkr_list_connections':
        return {
          content: [{
            type: 'text',
            text: resolved.dataDir
              ? json(app.connections(resolved.dataDir).map(connectionInfo))
              : 'Tinkr\'s own data was not found, so there are no saved connections to list.',
          }],
          structuredContent: {
            connections: resolved.dataDir ? app.connections(resolved.dataDir).map(connectionInfo) : [],
          },
          isError: false,
        }

      case 'tinkr_list_snippets': {
        const found = knownConnectionOf(args)
        const snippets = app.snippets(found.dataDir, found.connection.id)
          .map(snippet => ({id: snippet.id, name: snippet.name || null, code: snippet.code}))

        return {
          content: [{type: 'text', text: snippets.length ? json(snippets) : 'No snippets saved for this connection.'}],
          structuredContent: {connection: found.connection.id, snippets},
          isError: false,
        }
      }

      case 'tinkr_save_snippet': {
        const found = knownConnectionOf(args)

        if (typeof args.name !== 'string' || args.name.trim() === '') {
          throw new Error('`name` is required: what the snippet is listed under.')
        }

        const snippet = app.saveSnippet(found.dataDir, found.connection.id, args.name, codeOf(args))

        return {
          content: [{
            type: 'text',
            text: `Saved "${args.name}" as a snippet of ${found.connection.name} (${snippet.id}).`,
          }],
          structuredContent: {snippet},
          isError: false,
        }
      }

      default:
        // the protocol layer looks the tool up before it gets here, so a name
        // with no case is a server that was asked for a tool it does not have
        throw Object.assign(new Error(`Unknown tool: ${name}`), {code: -32602})
    }
  }

  /**
   * @param {String} name
   * @param {Object} args
   * @return {Promise<Object>} what the tool answers with. A tool that throws is
   * an answer with `isError`, because the caller has to read what went wrong
   */
  const call = async (name, args = {}) => {
    try {
      return await handle(name, args)
    } catch (e) {
      if (e.code === -32602) {
        throw e
      }

      return failure(e)
    }
  }

  return {
    tools: TOOLS,
    call,
    instructions: 'Tinkr runs PHP in a project, the way a developer would at a terminal: the ' +
      'project is booted, so its framework, its classes and its database are there. Code runs ' +
      'in a session of its own that is booted and closed for the call. It is code: it can ' +
      'change or delete what the project holds.',
  }
}

module.exports = {
  TOOLS,
  render,
  renderRun,
  connectionInfo,
  createServer,
  maxText,
}
