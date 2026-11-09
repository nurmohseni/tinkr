/**
 * Running a snippet somewhere that has no session to run it in.
 *
 * Some connections have no shell to attach to: their code runs inside a
 * container behind an HTTP API, and the way to run something there is a command
 * — create it, then ask how it is going until it ends. So such a run is not a
 * session, it is a request that is followed: the envelope wrapRun produces goes
 * out as one command, and what that command printed is fed through the same
 * RunResultFilter a pty's output goes through, so a run over the API answers
 * exactly as a local one does.
 *
 * The API's own half — its endpoints, the names it gives the parts of a command
 * and the words its messages use — is not here. It is a provider (see the
 * RemoteProvider typedef), and this module is the run protocol both of them
 * share: the deadline, the stop, the wait between polls, the backoff of an API
 * that is not answering, the output, and the answer or the failure that ends
 * the run. A second API is a second provider, not a second copy of this.
 */

const {wrapRun, RunResultFilter} = require('./runResult')

// what a run is given to answer when the caller names no limit: the wait here
// ends the run on this side, and the wrapper carries the same number into the
// snippet so the php ends itself where it can
const DEFAULT_TIMEOUT = 30000

// how often a command is asked how it is going, unless the caller says
const DEFAULT_INTERVAL = 1000

// how many polls in a row may fail before the run is given up on: ten is past a
// hiccup and past a rate limit's window
const FAILURE_LIMIT = 10

// the longest pause between two polls of an API that keeps failing: the wait
// doubles per consecutive failure and stops here, so a network that is down is
// asked about every few seconds rather than every interval
const BACKOFF_LIMIT = 5000

// how many times a finished command that has written no output yet is asked
// again: the status is stored before the output is, so a moment of asking is
// the difference between an empty answer and the answer that was coming
const UNPRINTED_RETRIES = 3

/**
 * What a runner needs of the API it runs against.
 *
 * `name` is how that API is called in the messages a run answers with, so the
 * runner can say "keeps running command x until it ends" about whichever one it
 * was given rather than knowing them all. `ErrorClass` is the error it creates,
 * and the runner makes every error it creates through it, so a caller can tell
 * a run that failed from anything else that went wrong: it must take
 * `(message, code, extra)` and keep `commandId`, `exitCode`, `output` and
 * `cause` off `extra`.
 *
 * `create` and `poll` are the two calls of the protocol, and both listen to the
 * signal they are given: a run that timed out or was stopped must not send
 * anything else, and a fetch left running would outlive the promise it was
 * answering. `create` sends the command and answers the id to follow — an empty
 * String when the answer carried none, which the runner reports. `poll` answers
 * a command as the app needs it rather than as the API writes it:
 *
 *   {done: Boolean, status: String, output: String|null, truncated: Boolean,
 *    outputUrl: String|null, exitCode: Number|null, failureReason: String|null}
 *
 * `done` is whether the command has ended, and `status` is what the API calls
 * the state it ended in — the runner quotes it and does not read it, because
 * the names are the API's own. `output` is null only while a finished command
 * has not been given its output yet: that is a moment of waiting, not an empty
 * answer, and the runner asks again for it. `truncated` says `output` is the
 * tail of what was printed, and `outputUrl` where the whole of it can be read.
 *
 * `download` is optional: it reads a command's whole output from `outputUrl`,
 * and answers null when it could not. Without it a truncated run answers with
 * the tail and says what it lost. `truncatedNote` is that sentence, written as
 * the API's own product would say it.
 *
 * @typedef {Object} RemoteProvider
 * @property {String} name
 * @property {Function} ErrorClass
 * @property {(wrappedCode: String) => String} commandFor the shell command the
 *   API runs, and the place a run the API will not accept is refused
 * @property {Function} create `(command, {signal}) => Promise<String>`
 * @property {Function} poll `(id, {signal}) => Promise<Object>`
 * @property {Function} [download] `(url, {signal}) => Promise<String|null>`
 * @property {String} truncatedNote
 */

/**
 * The run's own output, from session.js.
 *
 * Read here rather than at the top because session.js reaches this module
 * through cloud.js — session.js requires cloud.js for the cloud branch of
 * runCode, and cloud.js requires this module when it loads — so one of the two
 * directions has to be resolved when it is used rather than when it is loaded:
 * this one, so the function is taken from a module that has finished loading.
 * Node caches the module, so the require inside is a lookup and not a second
 * load.
 *
 * @param {RunResultFilter} filter
 * @return {String}
 */
const runOutputOf = filter => {
  const session = require('./session')

  return session.runOutput(filter)
}

/**
 * The last lines of what a command printed, for an error's message.
 *
 * The beginning of a failure is usually the framework booting; the end is the
 * exception, which is the part worth reading.
 *
 * @param {String} output
 * @param {Number} [count]
 * @return {String}
 */
const lastLines = (output, count = 20) => {
  const lines = String(output || '').replace(/\r\n/g, '\n').split('\n')

  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop()
  }

  return lines.slice(-count).join('\n').trim()
}

/**
 * Run a snippet as one command of a provider, and follow it to its answer.
 *
 * The answer arrives when the command ends: the API has no streaming and no
 * cancel, so a run is created, followed until it reports its status, and given
 * up on locally when it takes too long or the caller stops. Giving up locally
 * does not stop the command by itself: the wrapper the run is written in
 * carries the run's deadline with it (see runResult.deadlineOf), so the php
 * ends itself at the timeout where the environment can arm an alarm, and where
 * it cannot the command keeps running there — which is what the timeout's
 * message says, because a snippet still writing to a production database is not
 * a detail to leave out.
 *
 * @param {String} code the snippet
 * @param {RemoteProvider} provider what the API this runs against is
 * @param {{guard?: String|null, timeout?: Number, interval?: Number,
 *   signal?: AbortSignal, imports?: Object}} [options] `timeout` is how long the
 *   run may take, and zero is no limit; `interval` is how often a created
 *   command is asked how it is going; `signal` stops the run from outside, the
 *   way Stop does
 * @return {Promise<Object>} the same shape a pty run answers with, plus
 *   `commandId`
 */
const runRemoteCommand = (code, provider, options = {}) => {
  const {
    guard = null,
    timeout = DEFAULT_TIMEOUT,
    interval = DEFAULT_INTERVAL,
    imports = {},
  } = options
  const callerSignal = options.signal
  const ErrorClass = provider.ErrorClass
  const name = provider.name

  // the timeout goes into the wrapper as well as into the wait here: the app's
  // own stop ends the wait, and pcntl_alarm ends the php where the environment
  // has it, so a runaway snippet does not go on for the command's own limit
  const run = wrapRun(code, imports, guard, timeout)
  const filter = new RunResultFilter(run.marker, run.start)
  let command

  try {
    // the command is built before anything is sent: a run the API will not
    // accept fails here, instead of spending a command to be told it is too big
    command = provider.commandFor(run.code)
  } catch (error) {
    return Promise.reject(error)
  }

  return new Promise((resolve, reject) => {
    // every call and every wait listens to this, and settling aborts it: a run
    // that timed out or was stopped must not go on polling in the background
    const stop = new AbortController()
    let settled = false
    let commandId = null
    let timer = null

    const settle = (error, result) => {
      if (settled) {
        return
      }

      settled = true

      if (timer) {
        clearTimeout(timer)
        timer = null
      }

      if (callerSignal) {
        callerSignal.removeEventListener('abort', aborted)
      }

      stop.abort()

      if (error) {
        reject(error)
      } else {
        resolve(result)
      }
    }

    const aborted = () => settle(new ErrorClass(
      'The run was stopped.' +
      (commandId ? ` ${name} keeps running command ${commandId} until it ends.` : ''),
      'aborted',
      {commandId},
    ))

    if (callerSignal) {
      if (callerSignal.aborted) {
        aborted()

        return
      }

      callerSignal.addEventListener('abort', aborted, {once: true})
    }

    if (timeout > 0) {
      timer = setTimeout(() => settle(new ErrorClass(
        `The run did not answer within ${timeout}ms.` +
        (commandId
          ? ` ${name} keeps running command ${commandId} until it ends.`
          : ` ${name} keeps running whatever it started until it ends.`),
        'timeout',
        {commandId},
      )), timeout)
    }

    /**
     * @param {Number} ms
     * @return {Promise<void>} resolves when the interval is over, rejects when
     * the run settles first
     */
    const wait = ms => new Promise((resolve, reject) => {
      if (stop.signal.aborted) {
        reject(new ErrorClass('The run was stopped.', 'aborted'))

        return
      }

      const cancel = () => {
        clearTimeout(intervalTimer)
        reject(new ErrorClass('The run was stopped.', 'aborted'))
      }

      const intervalTimer = setTimeout(() => {
        stop.signal.removeEventListener('abort', cancel)
        resolve()
      }, ms)

      stop.signal.addEventListener('abort', cancel, {once: true})
    })

    /**
     * The output a finished command left, and whether it is only part of it.
     *
     * The API keeps the tail of a large output in the command's own answer and
     * the whole of it behind `outputUrl`, so a run's answer is the whole of what
     * it printed when that can be downloaded, and the tail with a note that the
     * beginning is gone when it cannot. A download that does not work is not the
     * run failing: the tail is still an answer, and the run says what it lost
     * rather than throwing away a value it has.
     *
     * @param {Object} answer
     * @return {Promise<{text: String, lost: Boolean}>} `lost` says `text` is the
     * tail alone
     */
    const answerOutput = async answer => {
      const text = typeof answer.output === 'string' ? answer.output : ''

      if (!answer.truncated) {
        return {text, lost: false}
      }

      const url = typeof answer.outputUrl === 'string' ? answer.outputUrl.trim() : ''

      if (url && provider.download) {
        const full = await provider.download(url, {signal: stop.signal})

        if (full !== null) {
          return {text: full, lost: false}
        }
      }

      return {text, lost: true}
    }

    const work = async () => {
      let created

      try {
        // the command is sent once; what the API needs it to look like is the
        // provider's to say
        created = await provider.create(command, {signal: stop.signal})
      } catch (error) {
        // a create that failed without the API answering it may still have made
        // the command: a gateway that gave up after the request arrived, a
        // connection that dropped on the way back. Running the snippet again
        // would then run it twice on the same data, so the message says to look
        // before it is run again. An answer the API itself gave — a 401, 403,
        // 422 or 429 — created nothing
        if (error instanceof ErrorClass && error.code === 'network') {
          error.message += ` ${name} may have started it: check the environment's commands before running it again.`
        }

        throw error
      }

      const id = created === undefined || created === null ? '' : String(created)

      if (!id) {
        throw new ErrorClass(`${name} did not answer with a command to follow.`, 'failed')
      }

      commandId = id

      // the run is followed until the provider says the command has ended:
      // `done` is the one way a command becomes the answer, and a status the
      // runner does not read is why the names stay with the provider
      let failures = 0
      let backoff = interval
      let unprinted = 0

      for (;;) {
        if (settled) {
          // a timeout or a stop already answered this run: the poll ends here
          // rather than outliving the promise it was answering
          throw new ErrorClass('The run was stopped.', 'aborted')
        }

        let answer

        try {
          answer = await provider.poll(id, {signal: stop.signal})
        } catch (error) {
          // a poll the network dropped, or that the API rate limited, says
          // nothing about the command: it was created, it is running, and it
          // answers when it ends. So the poll is repeated rather than the run
          // failed — a rate limit that says "try again in a moment" is exactly
          // that, and failing here would invite the same snippet to be run a
          // second time on top of the one already going
          if (!(error instanceof ErrorClass) || (error.code !== 'network' && error.code !== 'rate_limited')) {
            throw error
          }

          failures += 1

          // nothing that keeps failing is worth waiting for forever. The last
          // failure is kept as the cause rather than quoted: "try again in a
          // moment" is what a rate limit says, and it is not what this says —
          // the command is gone from this app's hands, not from the API's
          if (failures >= FAILURE_LIMIT) {
            throw new ErrorClass(
              `${name} could not be reached ${failures} times in a row while following the command.`,
              'failed',
              {cause: error},
            )
          }

          // the wait doubles per consecutive failure and is capped, so a rate
          // limit is backed off from rather than hammered and a network that is
          // down is asked about every few seconds rather than every interval
          await wait(backoff)
          backoff = Math.min(backoff * 2, BACKOFF_LIMIT)

          continue
        }

        // the API answered: whatever went wrong before is over, and a later
        // failure backs off from the interval again
        failures = 0
        backoff = interval

        if (answer.done) {
          // a finished command's output is not always written by the time its
          // status is: the status is stored first and the output follows. It
          // arrives a moment later, so the command is asked again. Three asks is
          // the whole of the wait: past that the command ended without output,
          // which is an answer of its own
          if (answer.output === null && !answer.truncated && unprinted < UNPRINTED_RETRIES) {
            unprinted += 1

            await wait(interval)

            continue
          }

          return answer
        }

        await wait(interval)
      }
    }

    work().then(async answer => {
      const {text, lost} = await answerOutput(answer)
      // the whole output goes in at once: the API has no chunks, and the filter
      // reads a complete string exactly as it reads a session's stream
      const {result} = filter.push(text ? `${text}\n` : '')
      const printed = runOutputOf(filter)

      if (!result) {
        const status = answer.status || 'no status'
        const reason = answer.failureReason ||
          lastLines(text) ||
          (lost && !text
            ? `${name} reported ${status} and the run's output was too large for ${name} to return.`
            : `${name} reported ${status} and printed nothing.`)
        const exitCode = answer.exitCode === undefined ? null : answer.exitCode
        const said = exitCode === null || exitCode === undefined
          ? reason
          : `${reason}\n\nThe command exited with code ${exitCode}.`

        throw new ErrorClass(said, 'failed', {commandId, exitCode, output: printed})
      }

      // the start marker is the first thing the run printed, so a tail of the
      // output holds the value and none of the text printed before it. The
      // value is the answer, and the text is said to be missing rather than left
      // to look like a run that printed nothing
      const output = lost
        ? (printed ? `${provider.truncatedNote}\n${printed}` : provider.truncatedNote)
        : printed

      settle(null, Object.assign({}, result, {output, commandId}))
    }).catch(error => {
      // once the command exists, every error that ends the run names it: the run
      // was given up on here and the command is still going in the API, and an
      // error that says only what failed invites the same snippet to be run
      // again on top of the one already there.
      //
      // An error that already carries the id was made from the command's own
      // final answer (see the output handling above): that answer says the
      // command has ended, so it says nothing about it still running
      if (commandId && error instanceof ErrorClass && error.commandId === undefined) {
        error.commandId = commandId
        error.message = `${error.message} ${name} keeps running command ${commandId} until it ends.`
      }

      settle(error)
    })
  })
}

module.exports = {
  runRemoteCommand,
}
