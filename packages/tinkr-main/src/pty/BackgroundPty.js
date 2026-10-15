const {randomBytes} = require('crypto')

const {Pty} = require('./Pty')
const {stripRendering} = require('../terminalOutput')

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
    const marker = createMarker()

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null
        reject(new Error('Timeout, try to reconnect!'))
      }, 15000)

      let result = ''

      const onData = this.onData(data => {
        result += data

        const jsonString = parseResult(result, marker)

        if (jsonString === null) {
          return
        }

        this.pending = null
        clearTimeout(timer)
        onData.dispose()
        resolve(jsonString)
      })

      this.pending = {reject, timer}

      this.input(`${this.jsonEncode(marker, code)}\r`)
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

    clearTimeout(this.pending.timer)
    this.pending.reject(new Error('The session was restarted, ask the form again.'))
    this.pending = null
  }
}

module.exports = {
  BackgroundPty,
}
