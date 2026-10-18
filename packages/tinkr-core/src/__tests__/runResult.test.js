const {RunResultFilter, wrapRun} = require('../runResult')

const marker = 'TINKRTEST'
const start = 'STRTTEST'
const envelope = payload => `${marker}@${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}@`

describe('the run result filter', () => {
  test('drops a php open tag before the snippet is encoded', () => {
    const encoded = run => /base64_decode\('([^']+)'\)/.exec(run.code)[1]
    const decode = run => Buffer.from(encoded(run), 'base64').toString('utf8')

    expect(decode(wrapRun('<?php $cfg = config(\'app\');'))).toBe('$cfg = config(\'app\');')
    expect(decode(wrapRun('<?php\n\n$cfg = 1;'))).toBe('$cfg = 1;')
    expect(decode(wrapRun('<? $cfg = 1;'))).toBe('$cfg = 1;')
    expect(decode(wrapRun('$cfg = 1;'))).toBe('$cfg = 1;')
  })
  test('holds the marker back when it arrives split', () => {
    const filter = new RunResultFilter(marker, start)
    const first = filter.push(marker.slice(0, 5))

    expect(first.result).toBe(null)
    expect(first.output).toBe('')

    const second = filter.push(`${marker.slice(5)}@${Buffer.from('{"value":1}', 'utf8').toString('base64')}@`)

    expect(second.result).toEqual({value: 1})
  })

  test('swallows the echoed command when it arrives split across chunks', () => {
    const filter = new RunResultFilter(marker, start)

    filter.push('Psy Shell v0.12.24\n> ')
    filter.push('$tinkr_code=base64_de')

    const split = filter.push("code('YWJj');$tinkr_imported=[];\n")

    // nothing of the echo reaches the terminal, however the chunks fell
    expect(split.output.trim()).toBe('')
    expect(filter.printed).toBe('')

    filter.push(`${start}\r\narray:1 [\n  0 => "a"\n]\n`)

    const {result} = filter.push(`${envelope({value: null, error: null})}`)

    expect(result).toEqual({value: null, error: null})
    expect(filter.printed).toBe('array:1 [\n  0 => "a"\n]\n')
  })

  test('keeps the session booting out of the run, however the chunks fall', () => {
    const filter = new RunResultFilter(marker, start)

    // the shell starts, and echoes the connection's command back
    filter.push('noor@fedora:~/project$ php -d cli.pager=cat artisan tinker\r\n')

    // it echoes the wrapped command too, long before psysh is up
    filter.push("$tinkr='TINK'.'RTEST';$tinkr_code=base64_decode('YWJj');$tinkr_error=null;\r\n")

    // psysh comes up and prints its banner, all of it behind the echo
    const banner = filter.push('tart=0ff1ce;type=shell;machineid=1;user=noor;hostname=fedora\r\n' +
      'Psy Shell v0.12.24 (PHP 8.5.11 — cli) by Justin Hileman\r\n' +
      'New PHP manual is available (latest: 3.0.3). Update with `doc --update-manual`\r\n')

    // the terminal keeps all of it: the terminal tab is the session, whole
    expect(banner.output).toContain('Psy Shell v0.12.24')
    expect(banner.output).toContain('New PHP manual is available')

    // and none of it is the run's: the run starts at its own marker
    expect(banner.run).toBe('')
    expect(filter.printed).toBe('')

    // the marker itself is the run's first line, and is not printed either
    const opened = filter.push(`${start}\r\n`)

    expect(opened.run).toBe('')
    expect(filter.printed).toBe('')

    const printed = filter.push('array:1 [\n  0 => "a"\n]\n')

    expect(printed.run).toBe('array:1 [\n  0 => "a"\n]\n')

    const {result} = filter.push(`${envelope({value: null, error: null})}`)

    expect(result).toEqual({value: null, error: null})
    expect(filter.printed).toBe('array:1 [\n  0 => "a"\n]\n')
  })

  test('reads the value that follows the marker with nothing between them', () => {
    const filter = new RunResultFilter(marker, start)

    filter.push('Psy Shell v0.12.24 (PHP 8.5.11 — cli)\r\n')

    // the marker arrives on its own, without a line ending after it
    filter.push(`${start}`)

    const printed = filter.push('\r\narray:3 [\r\n  0 => 1\r\n  1 => 2\r\n]\r\n')

    // the line ending the marker arrived with is the marker's, not the run's
    expect(printed.run).toBe('array:3 [\r\n  0 => 1\r\n  1 => 2\r\n]\r\n')

    const {result} = filter.push(`${envelope({value: null, error: null})}`)

    expect(result).toEqual({value: null, error: null})
    expect(filter.printed).toBe('array:3 [\r\n  0 => 1\r\n  1 => 2\r\n]\r\n')
  })

  test('keeps what the run printed when the envelope shares its chunk', () => {
    const filter = new RunResultFilter(marker, start)

    filter.push('Psy Shell v0.12.24 (PHP 8.5.11 — cli)\r\n')
    // the marker on its own, and then the value, the envelope and the session's
    // next prompt all in one chunk
    filter.push(`> ${start}`)

    const {result, run} = filter.push('array:3 [\r\n  0 => 1\r\n]\r\n' +
      `${envelope({value: null, error: null})}\r\n> `)

    expect(run).toBe('array:3 [\r\n  0 => 1\r\n]\r\n')
    expect(result).toEqual({value: null, error: null})
    expect(filter.printed).toBe('array:3 [\r\n  0 => 1\r\n]\r\n')
  })

  test('reports what the run printed, without the echo of the wrapper', () => {
    const filter = new RunResultFilter(marker, start)

    // the session booting
    filter.push('Psy Shell v0.12.24 (PHP 8.5.11 — cli)\n> ')

    // the tty echoing the wrapped command back
    const echoed = filter.push("$tinkr='TINK'.'RTEST';$tinkr_code=base64_decode('YWJj');$tinkr_error=null;try{\n")

    expect(echoed.output).toBe('')
    expect(filter.printed).toBe('')

    filter.push(`${start}\r\narray:2 [\n  0 => "environment"\n  1 => "timeout"\n]\n`)

    const {result} = filter.push(`${envelope({value: null, error: null})}\n> `)

    expect(result).toEqual({value: null, error: null})
    expect(filter.printed).toBe('array:2 [\n  0 => "environment"\n  1 => "timeout"\n]\n')
  })
})

describe('a large envelope', () => {
  test('is read from many chunks without going quadratic', () => {
    // a run that returns a few megabytes arrives in hundreds of chunks, and
    // joining what has arrived on every one of them made it quadratic: 8MB cost
    // 9.3s. It is linear now, so the same envelope costs about a second
    const size = 8 * 1024 * 1024
    const payload = Buffer.from(JSON.stringify({value: 'x'.repeat(size)})).toString('base64')
    const stream = payload + '@'
    const filter = new RunResultFilter(marker, start)
    const started = Date.now()

    filter.push(`Psy Shell\n${start}`)
    filter.push('TINKRTEST@')

    let result = null

    for (let at = 0; at < stream.length; at += 65536) {
      const {result: read} = filter.push(stream.slice(at, at + 65536))

      if (read) {
        result = read
      }
    }

    expect(result.value.length).toBe(size)
    expect(Date.now() - started).toBeLessThan(4000)
  })
})

describe('the run payload', () => {
  test('carries no import when the project resolved none', () => {
    const run = wrapRun("Order::where('paid', true)->count();")

    expect(run.imports).toEqual({})
    // nothing resolved means nothing to alias, and the envelope has no key for it
    expect(run.code).not.toContain("'imported'=>")
    expect(run.code).not.toContain('class_alias')
  })

  test('prints a marker before it evaluates, which the echo cannot show whole', () => {
    const run = wrapRun('1;', {})

    // the run says where it starts, so the pane never reads the session booting
    expect(run.code).toContain('echo $tinkr_start;')
    expect(run.code.indexOf('echo $tinkr_start;')).toBeLessThan(run.code.indexOf('eval('))
    // built from two pieces like the value's, so the shell echoing the wrapped
    // command back does not print it
    expect(run.code).toContain(`$tinkr_start='${run.start.slice(0, 4)}'.'${run.start.slice(4)}';`)
    expect(run.code).not.toContain(run.start)
  })

  test('aliases the resolved classes before the snippet is evaluated', () => {
    const run = wrapRun('Order::where(1);', {Order: 'App\\Models\\Order', Invoice: 'App\\Models\\Invoice'})

    expect(run.imports).toEqual({Order: 'App\\Models\\Order', Invoice: 'App\\Models\\Invoice'})
    expect(run.code).toContain("$tinkr_imported=[];foreach(['Order'=>'App\\\\Models\\\\Order','Invoice'=>'App\\\\Models\\\\Invoice'] as $tinkr_name=>$tinkr_class)")
    expect(run.code).toContain("if(class_exists($tinkr_name)||interface_exists($tinkr_name)||trait_exists($tinkr_name)||(function_exists('enum_exists')&&enum_exists($tinkr_name))){continue;}")
    expect(run.code).toContain('if(@class_alias($tinkr_class,$tinkr_name)){$tinkr_imported[$tinkr_name]=$tinkr_class;}')
    // an import that cannot be made is dropped, and the run goes on
    expect(run.code).toContain('catch(\\Throwable $tinkr_import_failure){}')
    // the envelope says what was imported, in the same payload as the value and
    // the error: the keys are added to, so this reads from the encode instead of
    // pinning what sits next to what
    expect(run.code.slice(run.code.indexOf('json_encode(['))).toContain("'imported'=>(object)$tinkr_imported")
    expect(run.code.indexOf('$tinkr_imported=[];')).toBeLessThan(run.code.indexOf('eval('))
    expect(run.code.indexOf('base64_decode(')).toBeLessThan(run.code.indexOf('$tinkr_imported=[];'))
  })

  test('asks php to split the snippet, and evaluates every statement of it', () => {
    const run = wrapRun('$a = [1, 2];\n$b = count($a);')

    // the tokenizer is php's own: where a statement ends is a string, a heredoc
    // or a `for (;;)` away from counting semicolons
    expect(run.code).toContain("token_get_all('<?php '.$tinkr_code)")
    // every statement is evaluated, and each one's value travels in the envelope
    expect(run.code).toContain('foreach($tinkr_stmts as $tinkr_one)')
    expect(run.code).toContain("eval($tinkr_uses.'return '.$tinkr_source)")
    expect(run.code).toContain("'blocks'=>$tinkr_safe($tinkr_results)")
    // and a statement with no `;` of its own is given one, on a line of its own
    // so a trailing `//` comment cannot swallow it, which php wants
    expect(run.code).toContain('{$tinkr_source.="\\n;";}')
  })

  test('escapes a name for the php it is written into', () => {
    const run = wrapRun('1;', {"O'rder": 'App\\Odd\\Back\\slash'})

    expect(run.code).toContain("'O\\'rder'=>'App\\\\Odd\\\\Back\\\\slash'")
  })

  test('the filter hands the imports on with the value', () => {
    const filter = new RunResultFilter(marker, start)
    const {result} = filter.push(envelope({value: 1, error: null, imported: {Order: 'App\\Models\\Order'}}))

    expect(result).toEqual({value: 1, error: null, imported: {Order: 'App\\Models\\Order'}})
  })
})

describe('the transaction guard', () => {
  // the markers are a fresh one per run, and each is printed in two pieces so
  // the shell echoing the command back cannot show it whole: two wrappers are
  // compared with both pieces of both markers taken out of the way
  const unwrap = run => run.code
    .split(run.marker.slice(4)).join('MARKER_TAIL')
    .split(run.marker.slice(0, 4)).join('MARKER_HEAD')
    .split(run.start.slice(4)).join('START_TAIL')
    .split(run.start.slice(0, 4)).join('START_HEAD')

  test('is not sent when no guard is asked for', () => {
    const run = wrapRun('$order = Order::first();')

    expect(run.code).not.toContain('$tinkr_tx_')
    expect(run.code.slice(run.code.indexOf('json_encode(['))).not.toContain("'transaction'=>")
  })

  test('a mode it does not know is no guard at all', () => {
    const source = '$order = Order::first();'

    expect(unwrap(wrapRun(source, {}, 'nonsense'))).toBe(unwrap(wrapRun(source)))
    expect(unwrap(wrapRun(source, {}, true))).toBe(unwrap(wrapRun(source)))
    expect(unwrap(wrapRun(source, {}, ''))).toBe(unwrap(wrapRun(source)))
  })

  test('opens the transaction after the snippet is split and before it is evaluated', () => {
    const run = wrapRun('$a = 1;\n$b = 2;', {}, 'rollback')

    expect(run.code).toContain("$tinkr_tx_mode='rollback';")
    expect(run.code).toContain('$tinkr_db->beginTransaction();$tinkr_tx_armed=true;')
    // everything the run sends is inside it: the transaction is open before the
    // first statement is evaluated and closed after the last one. The close is
    // written twice — once for a run that leaves through exit() and once for one
    // that gets to the end — so it is the last copy that follows the statements
    expect(run.code.indexOf('beginTransaction()'))
      .toBeLessThan(run.code.indexOf('foreach($tinkr_stmts as $tinkr_one)'))
    expect(run.code.indexOf('foreach($tinkr_stmts as $tinkr_one)'))
      .toBeLessThan(run.code.lastIndexOf('$tinkr_db->rollBack()'))
    // the report counts the statements the guard held out of the listener that
    // sees them, so the tally is there before the transaction is opened
    expect(run.code.indexOf('$tinkr_query_connections=[];'))
      .toBeLessThan(run.code.indexOf('beginTransaction()'))
  })

  test('takes a dry run back and keeps the run the pane offered to apply', () => {
    const dry = wrapRun('1;', {}, 'rollback')
    const kept = wrapRun('1;', {}, 'commit')

    expect(dry.code).toContain("$tinkr_tx_mode='rollback';")
    expect(kept.code).toContain("$tinkr_tx_mode='commit';")
    // one word is the whole difference between the two wrappers
    expect(unwrap(dry).split("'rollback'").join("'commit'")).toBe(unwrap(kept))
  })

  test('refuses the run when the guard cannot be armed', () => {
    const run = wrapRun('$order = Order::first();', {}, 'rollback')

    // the statements are dropped, so nothing is evaluated and nothing can have
    // been changed by a run that promised to be undone
    expect(run.code).toContain('if(!$tinkr_tx_armed){$tinkr_stmts=[];')
    expect(run.code).toContain("'the transaction guard could not be armed: '.$tinkr_tx_error")
    // a session with no database to guard is the case it is written for, and a
    // connection that will not begin a transaction is the other one
    expect(run.code).toContain("if(!function_exists('app')||!app()->bound('db'))")
    expect(run.code).toContain('$tinkr_db->beginTransaction();$tinkr_tx_armed=true;$tinkr_tx_level=$tinkr_db->transactionLevel();}}')
    expect(run.code).toContain('catch(\\Throwable $tinkr_tx_failure){')
  })

  test('closes the transaction either way, and reports how', () => {
    const run = wrapRun('1;', {}, 'rollback')

    // a run that threw is still a dry run, so the close is outside the catch the
    // statements are evaluated in
    expect(run.code).toContain("$tinkr_tx_outcome='failed';$tinkr_tx_open=false;")
    // the close after the statements is the one this run takes; the copy inside
    // the shutdown function is written earlier and only runs if this one does not
    expect(run.code.indexOf('foreach($tinkr_stmts as $tinkr_one)'))
      .toBeLessThan(run.code.lastIndexOf('$tinkr_tx_outcome='))
    expect(run.code).toContain("if($tinkr_tx_mode==='commit'){")
    expect(run.code).toContain('$tinkr_db->commit();$tinkr_tx_outcome="committed";')
    expect(run.code).toContain('$tinkr_db->rollBack();$tinkr_tx_outcome="rolledBack";')
    // the close the normal path takes is the one written after the statements:
    // the copy in the shutdown function is written earlier but runs only if the
    // normal one never did
    const normal = run.code.indexOf('$tinkr_sent=true;')

    expect(run.code.lastIndexOf('$tinkr_db->rollBack()', normal)).toBeGreaterThan(run.code.indexOf('foreach($tinkr_stmts as $tinkr_one)'))
  })

  test('does not claim a rollback the connection never made', () => {
    const run = wrapRun('1;', {}, 'rollback')

    // MySQL commits implicitly on DDL and on TRUNCATE, a snippet can commit or
    // roll back itself, and a reconnect drops the transaction with the
    // connection. Laravel's rollBack() finds nothing to roll back in all of
    // those and does nothing quietly, so the connection is asked first
    expect(run.code).toContain('$tinkr_tx_open=$tinkr_db->transactionLevel()===$tinkr_tx_level&&')
    expect(run.code).toContain('$tinkr_db->getPdo()->inTransaction()')
    // and a guard whose transaction is gone says so instead of saying rolledBack
    expect(run.code).toContain('}elseif(!$tinkr_tx_open){$tinkr_tx_outcome="broken";')
    expect(run.code).toContain('may have been kept')
  })

  test('keeps nothing of a commit run that threw', () => {
    const run = wrapRun('1;', {}, 'commit')

    // half of it is done and the rest is not: keeping that is not what the pane
    // offered, so a commit run that threw is taken back and says so
    expect(run.code).toContain('if($tinkr_error!==null){$tinkr_db->rollBack();$tinkr_tx_outcome="rolledBack";')
    expect(run.code).toContain('the run threw, so nothing was kept')
  })

  test('reports what ran outside the guarded connection', () => {
    const run = wrapRun('1;', {}, 'rollback')
    const encode = run.code.slice(run.code.indexOf("'unguarded'=>"))

    // a statement sent to another connection was never in the transaction, and
    // the pane can only say so if the envelope carries the count
    expect(encode).toContain("'unguarded'=>(object)$tinkr_tx_other")
    expect(run.code).toContain('foreach($tinkr_query_connections as $tinkr_tx_name=>$tinkr_tx_count){')
    expect(run.code).toContain('if($tinkr_tx_name!==$tinkr_tx){$tinkr_tx_other[$tinkr_tx_name]=$tinkr_tx_count;}}')
  })

  test('reports the guard in the envelope, only when it was asked for', () => {
    const run = wrapRun('1;', {}, 'rollback')
    const encode = run.code.slice(run.code.indexOf('json_encode(['))

    expect(encode).toContain("'transaction'=>$tinkr_transaction")
    // what was asked of it, what it opened on, what it held, how it ended
    expect(run.code).toContain("'mode'=>$tinkr_tx_mode,'armed'=>$tinkr_tx_armed,'connection'=>$tinkr_tx,")
    expect(run.code).toContain("'statements'=>($tinkr_tx===null?0:($tinkr_query_connections[$tinkr_tx]??0)),")
    expect(run.code).toContain("'outcome'=>$tinkr_tx_outcome,'error'=>$tinkr_tx_error,'unguarded'=>(object)$tinkr_tx_other];")
  })

  test('counts the statements of every connection, stored or dropped', () => {
    const run = wrapRun('1;', {}, 'rollback')

    // the query listener is what counts them, and it counts before the storage
    // limits can drop one, so a run over them still rolls back what it sent
    expect(run.code).toContain('function($tinkr_query)use(&$tinkr_queries,&$tinkr_query_connections,')
    expect(run.code).toContain('$tinkr_query_connections[$tinkr_query->connectionName]=($tinkr_query_connections[$tinkr_query->connectionName]??0)+1;')

    const counted = run.code.indexOf('$tinkr_query_connections[$tinkr_query->connectionName]')
    const total = run.code.indexOf('$tinkr_query_total++;')

    expect(total).toBeLessThan(counted)
    expect(counted).toBeLessThan(run.code.indexOf('if(count($tinkr_queries)>=100'))
  })
})
