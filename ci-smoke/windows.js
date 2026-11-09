// Throwaway: drives the real command layer on a real cmd.exe.
const {exec} = require('../packages/tinkr-core/src/remote')
const {shellQuote} = require('../packages/tinkr-core/src/shell')
const {runCode} = require('../packages/tinkr-core/src/session')

const app = process.env.APP
let failed = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' :: ' + JSON.stringify(detail).slice(0, 3000)}`)
  if (!ok) failed++
}
const timed = async (fn) => { const t = Date.now(); try { return {r: await fn(), ms: Date.now() - t} } catch (e) { return {e, ms: Date.now() - t} } }

;(async () => {
  const words = ['plain', 'with space', 'quote"inside', "single'q", '%PATH%', '!bang!', 'a&b|c<d>e(f)', 'caret^x', 'ünïcødé', 'trail\\', 'comma,semi;eq=', '']
  const printer = `node -e ${shellQuote('console.log(JSON.stringify(process.argv.slice(1)))', 'win32')} ${words.map(w => shellQuote(w, 'win32')).join(' ')}`
  const read = await exec({path: app}, printer, {timeout: 30000})
  let got = null
  try { got = JSON.parse(String(read.stdout || read.output || '').trim().split('\n').pop()) } catch (e) {}
  check('cmd quoting round trip through remote.exec', JSON.stringify(got) === JSON.stringify(words), {words, read})

  const phpRead = await exec({path: app}, `php -r ${shellQuote('echo json_encode(["a" => "%PATH%", "b" => "x&y", "c" => "it\'s"]);', 'win32')}`, {timeout: 30000})
  check('php -r through cmd keeps %, & and quotes', String(phpRead.stdout || '').includes('"a":"%PATH%","b":"x&y","c":"it\'s"'), phpRead)

  const conn = {id: 'w', path: app, command: 'php artisan tinker'}
  let x = await timed(() => runCode(conn, '1 + 1', {timeout: 90000}))
  check(`runCode value (${x.ms} ms)`, x.r && x.r.value === 2, x.e ? {message: x.e.message, output: x.e.output} : x.r)

  x = await timed(() => runCode(conn, `$s = "it's \\"q\\" $"; echo "printed\\n"; $s`, {timeout: 90000}))
  check('runCode quotes + echo', x.r && x.r.value === `it's "q" $` && /printed/.test(x.r.output || ''), x.e ? {message: x.e.message, output: x.e.output} : x.r)

  x = await timed(() => runCode(conn, "throw new RuntimeException('boom');", {timeout: 90000}))
  check('runCode exception with line', x.r && x.r.error && x.r.error.message === 'boom' && x.r.error.line === 1, x.e ? {message: x.e.message} : x.r && x.r.error)

  x = await timed(() => runCode(conn, 'echo str_repeat("x", 2000000); 7', {timeout: 90000}))
  check(`runCode 2 MB echo (${x.ms} ms)`, x.r && x.r.value === 7 && (x.r.output || '').length >= 2000000, x.e ? {message: x.e.message} : {value: x.r.value, len: (x.r.output || '').length})

  x = await timed(() => runCode(conn, 'range(1, 300)', {timeout: 90000}))
  check('runCode tall value (no pager)', x.r && Array.isArray(x.r.value) && x.r.value.length === 300, x.e ? {message: x.e.message, output: x.e.output} : 'ok')

  x = await timed(() => runCode(conn, 'sleep(60); 1', {timeout: 10000}))
  check(`runCode timeout ends the run (${x.ms} ms)`, x.e && x.ms < 30000, x.e ? x.e.message : x.r)

  console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
  process.exit(failed ? 1 : 0)
})()
