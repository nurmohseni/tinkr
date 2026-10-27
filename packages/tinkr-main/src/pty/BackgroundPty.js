const {randomBytes} = require('crypto')

const {stripRendering} = require('tinkr-core')

const {Pty} = require('./Pty')

/**
 * The session prints the value it resolved between two markers: the one below,
 * and its reverse. The marker is new for every call so an answer that arrives
 * late can never be read as the answer to a later call.
 *
 * @return {String}
 */
const createMarker = () => `PHPFORM${randomBytes(6).toString('hex').toUpperCase()}`

/**
 * @param {String} value
 * @return {String}
 */
const reverse = value => value.split('').reverse().join('')

/**
 * Read the json the session printed back.
 *
 * base64 keeps the payload within one alphabet, so whatever the rendering still
 * leaves on top of it can be filtered away.
 *
 * The marker also shows up in the echo of the line that was written, so the
 * value is taken from the last marker in the stream.
 *
 * @param {String} output
 * @param {String} marker
 * @return {String|null} the json string, or null while it is not there yet
 */
const parseResult = (output, marker) => {
  const found = new RegExp(`[\\s\\S]*${marker}([\\s\\S]*?)${reverse(marker)}`).exec(stripRendering(output))

  if (!found) {
    return null
  }

  const base64 = found[1].replace(/[^A-Za-z0-9+/=]/g, '')

  return Buffer.from(base64, 'base64').toString('utf8')
}

class BackgroundPty extends Pty {
  constructor(connection) {
    super(connection)

    this.pending = null
  }

  /**
   * @param {String} marker
   * @param {String} code
   * @return {String}
   */
  jsonEncode(marker, code) {
    return `$m='${marker}';echo $m.base64_encode(json_encode((${code})())).strrev($m);`
  }

  /**
   * Run a snippet form value in the session and read the json it returns.
   *
   * The session is booted on demand, so give it the time to come up.
   *
   * @param {String} code
   * @return {Promise<String>}
   */
  jsonResult(code) {
    // a value that is still being waited for is one the form is no longer
    // asking: the new request takes over, and the old one is told so before it
    // can be mistaken for the new one
    this.abort()

    const marker = createMarker()

    return new Promise((resolve, reject) => {
      // everything a request owns is here, so it ends with the request and not
      // with whatever the session does next: the timer, the subscription on the
      // session, and what has been read so far
      const request = {marker}

      let buffer = ''
      let settled = false
      let timer = null
      let subscription = null

      const dispose = () => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }

        if (subscription) {
          subscription.dispose()
          subscription = null
        }

        buffer = ''
      }

      const settle = (error, value) => {
        if (settled) {
          return
        }

        settled = true
        dispose()

        // only the request that is still the pending one clears it: a request
        // that was replaced cannot take the place of the one that replaced it
        if (this.pending === request) {
          this.pending = null
        }

        error ? reject(error) : resolve(value)
      }

      request.abort = () => settle(new Error('The session was restarted, ask the form again.'))

      subscription = this.onData(data => {
        if (settled) {
          return
        }

        buffer += data

        const jsonString = parseResult(buffer, marker)

        if (jsonString === null) {
          return
        }

        settle(null, jsonString)
      })

      timer = setTimeout(() => settle(new Error('Timeout, try to reconnect!')), 15000)

      this.pending = request

      try {
        this.input(`${this.jsonEncode(marker, code)}\r`)
      } catch (error) {
        // the session could not take the line: nothing was asked, so nothing
        // is left waiting for an answer
        settle(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /**
   * 清理
   */
  kill() {
    this.abort()

    super.kill()
  }

  /**
   * 停止等待中的取值
   */
  abort() {
    if (!this.pending) {
      return
    }

    this.pending.abort()
  }
}

module.exports = {
  BackgroundPty,
}
