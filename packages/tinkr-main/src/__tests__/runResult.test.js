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

describe('the run payload', () => {
  test('carries no import when the project resolved none', () => {
    const run = wrapRun("Order::where('paid', true)->count();")

    expect(run.imports).toEqual({})
    // the run is the one the app has always sent, line for line
    expect(run.code).not.toContain('imported')
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
    // the envelope says what was imported, next to the value and the error
    expect(run.code).toContain("'error'=>$tinkr_error,'imported'=>(object)$tinkr_imported")
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
    expect(run.code).toContain("eval('return '.$tinkr_source)")
    expect(run.code).toContain("'blocks'=>$tinkr_results")
    // and a statement with no `;` of its own is given one, which php wants
    expect(run.code).toContain("if(substr($tinkr_source,-1)!==';'){$tinkr_source.=';';}")
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
