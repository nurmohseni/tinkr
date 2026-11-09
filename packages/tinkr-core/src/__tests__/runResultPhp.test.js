/**
 * The php the run wrapper builds, run as php.
 *
 * The other test of the wrapper reads the code it builds as text, which says
 * where a marker is printed but never what the run answers: a tokenized split in
 * the wrong place, a `return` that did not stop the loop, or a value that comes
 * back as a null it never was is invisible until someone runs a snippet. This
 * one runs it.
 *
 * It is fed on stdin rather than from a file: the php this is run against is
 * lerd's, which runs inside a container that cannot see this machine's temporary
 * directory.
 */
const {execFileSync} = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {wrapRun} = require('../runResult')

/**
 * A php file that is not the snippet's — what a framework's file is to a run —
 * and the run started in the directory it sits in, so its path is the project's
 * and the snippet's frames are the only eval'd ones. It lives under the temp
 * directory the suite is given, which is where the php it runs can see.
 */
const framework = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-frames-'))

fs.writeFileSync(path.join(framework, 'vendor.php'),
  '<?php\n' +
  'function tinkrOuter($fn) { $fn(); }\n' +
  "function tinkrBoom() { throw new LogicException('boom'); }\n")

afterAll(() => fs.rmSync(framework, {recursive: true, force: true}))

/**
 * The php that puts the run in the fixture's directory, which is what makes the
 * fixture the project the run's paths are written from.
 *
 * @param {String} dir
 * @return {String}
 */
const into = dir => `chdir('${dir}');`

/**
 * Run a snippet through the real wrapper and read the envelope it printed.
 *
 * @param {String} source
 * @param {String} [after] php run after the wrapper, which is how a run's own
 * counter is read once the envelope is out
 * @param {String} [before] php run before the wrapper, which is how a snippet is
 * given a function that is not its own
 * @return {{payload: Object, printed: String, tail: String}}
 */
const runPhp = (source, after = '', before = '') => {
  const run = wrapRun(source)
  // a run that renders a page answers with more than a command line holds by
  // default, and a buffer that cuts it would read as a run that printed nothing
  const out = execFileSync('php', [], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, input: `<?php ${before} ${run.code}${after}`})
  const at = out.indexOf(`${run.marker}@`)

  if (at < 0) {
    throw new Error(`the run printed no envelope: ${JSON.stringify(out)}`)
  }

  const rest = out.slice(at + run.marker.length + 1)
  const end = rest.indexOf('@')

  return {
    payload: JSON.parse(Buffer.from(rest.slice(0, end), 'base64').toString('utf8')),
    // what the run printed, with the start marker taken out of it: everything
    // before the value's marker belongs to the run
    printed: out.slice(0, at).split(run.start).join(''),
    tail: rest.slice(end + 1),
  }
}

/**
 * The same, for a run that dies: the php process ends with a fatal, so the
 * child's own end is caught and the envelope it printed on the way out is read
 * from what it wrote.
 *
 * @param {String} source
 * @return {{payload: Object, printed: String}}
 */
const runPhpFatal = source => {
  const run = wrapRun(source)
  let out = ''

  try {
    out = execFileSync('php', [], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, input: `<?php ${run.code}`})
  } catch (failure) {
    out = failure.stdout || ''
  }

  const at = out.indexOf(`${run.marker}@`)

  if (at < 0) {
    throw new Error(`the fatal run printed no envelope: ${JSON.stringify(out)}`)
  }

  const rest = out.slice(at + run.marker.length + 1)

  return {
    payload: JSON.parse(Buffer.from(rest.slice(0, rest.indexOf('@')), 'base64').toString('utf8')),
    printed: out.slice(0, at).split(run.start).join(''),
  }
}

describe('running a snippet', () => {
  test('runs a statement that throws while it runs once', () => {
    const {payload, printed} = runPhp(
      "function tinkrRisky() { echo 'risky-output'; throw new ParseError('risky-broke'); }\n" +
      'tinkrRisky();',
    )

    // the shape of the statement is decided by the tokenizer before it runs, so
    // a ParseError thrown by the snippet is the run's error and not a cue to run
    // it again as a statement: the echo would otherwise be printed twice
    expect(printed).toBe('risky-output')
    expect(payload.error).toMatchObject({class: 'ParseError', message: 'risky-broke'})
    expect(payload.value).toBe(null)
    expect(payload.blocks.at(-1).error.class).toBe('ParseError')
  })

  test('stops the snippet at a top-level return', () => {
    const {payload, printed} = runPhp("echo 'before'; return 7; echo 'after';")

    // `echo 'after';` is never evaluated: the return ended the snippet
    expect(printed).toBe('before')
    expect(payload.error).toBe(null)
    expect(payload.value).toBe(7)
    expect(payload.blocks).toHaveLength(2)
    expect(payload.blocks.at(-1).value).toBe(7)
  })

  test('keeps a return inside a conditional at the run\'s end', () => {
    const {payload} = runPhp(
      "function tinkrInner() { return 'function-inner'; }\n" +
      "if (true) { return 'conditional-outer'; }\n" +
      "'after';",
    )

    expect(payload.error).toBe(null)
    expect(payload.value).toBe('conditional-outer')
    expect(payload.blocks).toHaveLength(2)
  })

  test('keeps an unbraced conditional return at the run\'s end', () => {
    const {payload} = runPhp("$a = 2;\nif ($a === 1) return 'one'; else return 'two';\n'after';")

    expect(payload.error).toBe(null)
    expect(payload.value).toBe('two')
  })

  test('keeps a return inside a loop at the run\'s end', () => {
    const {payload} = runPhp(
      'foreach ([1, 2, 3] as $n) { if ($n === 2) { return $n * 10; } }\n' +
      "'after';",
    )

    expect(payload.error).toBe(null)
    expect(payload.value).toBe(20)
  })

  test('does not read a closure or a function\'s own return as the run\'s', () => {
    const {payload} = runPhp(
      "$tinkrClosure = function () { return 'closure-inner'; };\n" +
      '$tinkrClosure();\n' +
      "'after-closure';",
    )

    // the closure's return is the closure's: the statement completed, and the
    // next one still ran
    expect(payload.error).toBe(null)
    expect(payload.value).toBe('after-closure')
    expect(payload.blocks).toHaveLength(3)
    expect(payload.blocks[1].value).toBe('closure-inner')
  })
})

describe('splitting a run into statements', () => {
  test('keeps an unbraced if/elseif/else whole', () => {
    const {payload} = runPhp(
      '$out = [];\n' +
      "if (false) $out[] = 'a';\n" +
      "elseif (true) $out[] = 'b';\n" +
      "else $out[] = 'c';\n" +
      "implode(',', $out);",
    )

    // the `;` after `$out[] = 'a'` is followed by the `elseif` that belongs to
    // the same statement: split there, both halves are parse errors
    expect(payload.error).toBe(null)
    expect(payload.value).toBe('b')
  })

  test('keeps nested unbraced control flow whole', () => {
    const {payload} = runPhp(
      '$out = [];\n' +
      "if (true) if (false) $out[] = 'x'; else $out[] = 'y';\n" +
      "implode(',', $out);",
    )

    // the `else` belongs to the inner `if`, and the statement that carries both
    // is the one evaluated
    expect(payload.error).toBe(null)
    expect(payload.value).toBe('y')
  })

  test('keeps the while of an unbraced do attached to it', () => {
    const {payload} = runPhp('$n = 0;\ndo $n++;\nwhile ($n < 3);\n$n;')

    expect(payload.error).toBe(null)
    expect(payload.value).toBe(3)
  })

  test('does not join a while that follows a statement of its own', () => {
    const {payload} = runPhp('$a = 1;\nwhile (false) { }\n$a;')

    // only the `while` of a `do` continues the statement before it: an ordinary
    // `while` after a `;` is a statement in its own right
    expect(payload.error).toBe(null)
    expect(payload.value).toBe(1)
    expect(payload.blocks).toHaveLength(3)
  })

  test('keeps alternative syntax, a match, a try/finally, a heredoc and a chain whole', () => {
    const {payload} = runPhp(
      '$out = [];\n' +
      'foreach ([1, 2] as $n): $out[] = $n; endforeach;\n' +
      "$label = match (2) { 1, 2 => 'small', default => 'big' };\n" +
      "$text = '';\n" +
      "try { $text = $label; } finally { $text .= '-finally'; }\n" +
      '$note = <<<TXT\nvalue {$text}\nTXT;\n' +
      '$note;',
    )

    expect(payload.error).toBe(null)
    expect(payload.value).toBe('value small-finally')
    expect(payload.blocks).toHaveLength(7)
  })

  test('reports the line a statement starts on, not the line the token before it did', () => {
    const {payload} = runPhp(
      'null;' + '\n' +
      "['name' => 'Ada'];" + '\n' +
      '\n' +
      '/* a note\n' +
      '   over two lines */' + '\n' +
      '// and one line more' + '\n' +
      '  [1, 2];' + '\n' +
      '$a = 1; $b = [2];' + '\n' +
      '(function () { return 3; })();',
    )

    // the statements that open with `[` or `(` are punctuation, which carries
    // no line of its own: their line is where they start, after the whitespace
    // and the comments before them, and not where the whitespace before them
    // started. Statements written on one line keep that one line
    expect(payload.error).toBe(null)
    expect(payload.blocks.map(block => block.line)).toEqual([1, 2, 7, 8, 8, 9])
    expect(payload.blocks.map(block => block.value)).toEqual([null, {name: 'Ada'}, [1, 2], 1, [2], 3])
  })
})

describe('a snippet php itself would not compile', () => {
  test('runs none of it, not even the statement before the error', () => {
    const {payload, printed} = runPhp("echo 'SIDE_EFFECT'; $broken = ;")

    // php parses the whole file before it runs the first line: the echo is never
    // reached, and the run answers the parse error with no blocks
    expect(printed).toBe('')
    expect(payload.blocks).toEqual([])
    expect(payload.value).toBe(null)
    expect(payload.error.class).toBe('ParseError')
    expect(payload.error.message).toContain('unexpected token')
  })

  test('rejects a syntax error inside a declaration before anything runs', () => {
    const {payload, printed} = runPhp("echo 'SIDE_EFFECT'; function tinkrBroken() { $broken = ; }")

    // the body of a declaration is part of the compilation, so its parse error
    // stops the run before the echo as well
    expect(printed).toBe('')
    expect(payload.blocks).toEqual([])
    expect(payload.error.class).toBe('ParseError')
  })

  test('still accepts a last expression without its semicolon', () => {
    const {payload} = runPhp('$a = 1;\n$a + 1')

    // a scratchpad's last line does not need the `;` a file would
    expect(payload.error).toBe(null)
    expect(payload.value).toBe(2)
  })
})

describe('statement boundaries php\'s grammar asks for', () => {
  test('keeps arithmetic after a match in the same statement', () => {
    const {payload, printed} = runPhp('echo match(1) {1 => 2, default => 3} + 4;')

    // the `}` closes the match expression, and `+ 4` is still the same
    // statement: splitting there printed `2` and reported the `4` as a value
    expect(printed).toBe('6')
    expect(payload.error).toBe(null)
    expect(payload.blocks).toHaveLength(1)
  })

  test('keeps a coalesce after a match in the same statement', () => {
    const {payload} = runPhp("match (false) {true => 'yes', default => null} ?? 'fallback';")

    expect(payload.error).toBe(null)
    expect(payload.value).toBe('fallback')
  })

  test('keeps a call chained off an anonymous class in the same statement', () => {
    const {payload, printed} = runPhp('echo (new class { public $x = 5; })->x;')

    expect(printed).toBe('5')
    expect(payload.error).toBe(null)
    expect(payload.blocks).toHaveLength(1)
  })

  test('keeps a call of an anonymous function and the arithmetic after it whole', () => {
    const {payload} = runPhp('(function () { return 2; })() * 3;')

    expect(payload.error).toBe(null)
    expect(payload.value).toBe(6)
  })
})

describe('compile-time php in a snippet', () => {
  test('keeps an import a comment precedes', () => {
    const {payload, printed} = runPhp(
      '// imports\n' +
      'use DateTimeImmutable as AuditDate;\n' +
      "echo (new AuditDate('2020-01-01'))->format('Y');",
    )

    // the comment is part of the statement, but the token it opens with is the
    // `use`: the import is kept and applies to what follows it
    expect(printed).toBe('2020')
    expect(payload.error).toBe(null)
  })

  test('keeps function and constant imports, not only class imports', () => {
    const {payload, printed} = runPhp(
      'use DateTimeImmutable as AuditDate;\n' +
      'use function strlen as tinkrLength;\n' +
      'use const PHP_EOL as tinkrEol;\n' +
      "echo tinkrLength((new AuditDate('2020-01-01'))->format('Y')) . (tinkrEol === \"\\n\" ? '!' : '?');",
    )

    expect(printed).toBe('4!')
    expect(payload.error).toBe(null)
  })

  test('does not read a closure\'s own use as an import', () => {
    const {payload} = runPhp('$n = 5;\n$f = function () use ($n) { return $n; };\n$f();')

    expect(payload.error).toBe(null)
    expect(payload.value).toBe(5)
    expect(payload.blocks).toHaveLength(3)
  })

  test('declares an unconditional top-level function before the first statement', () => {
    const {payload, printed} = runPhp("echo auditLater(); function auditLater() { return 'OK'; }")

    // php hoists an unconditional top-level declaration when it compiles the
    // file, so the call above the declaration answers
    expect(printed).toBe('OK')
    expect(payload.error).toBe(null)
    expect(payload.blocks).toHaveLength(2)
  })

  test('does not declare a function the snippet declares conditionally', () => {
    const {payload, printed} = runPhp(
      'if (false) { function tinkrNeverDeclared() { return 1; } }\n' +
      "echo function_exists('tinkrNeverDeclared') ? 'declared' : 'not-declared';",
    )

    // a declaration inside a branch is declared when the branch runs
    expect(printed).toBe('not-declared')
    expect(payload.error).toBe(null)
  })

  test('keeps a conditional echo, update and return', () => {
    const {payload} = runPhp(
      "$out = '';\n" +
      "if (true) { $out .= 'echoed'; }\n" +
      'if (true) { $n = 2; }\n' +
      "if (true) { return $out . ':' . $n; }\n" +
      "'after';",
    )

    expect(payload.error).toBe(null)
    expect(payload.value).toBe('echoed:2')
    expect(payload.blocks).toHaveLength(4)
  })
})

describe('the values a run answers with', () => {
  test('normalizes the unsafe values inside an object, recursively', () => {
    const {payload} = runPhp(
      '$point = new stdClass();\n' +
      '$point->inf = INF;\n' +
      '$point->negativeInf = -INF;\n' +
      '$point->nan = NAN;\n' +
      '$point->big = 9007199254740993;\n' +
      '$point->bytes = "\\xB1\\x31";\n' +
      '$point->emptyObject = new stdClass();\n' +
      '$point->emptyList = [];\n' +
      '$point->child = new stdClass();\n' +
      "$point->child->value = 'nested';\n" +
      '$point;',
    )

    expect(payload.error).toBe(null)
    expect(payload.value).toEqual({
      inf: 'INF',
      negativeInf: '-INF',
      nan: 'NAN',
      big: '9007199254740993',
      bytes: '0xb131',
      emptyObject: {__tinkrClass: 'stdClass'},
      emptyList: [],
      child: {value: 'nested', __tinkrClass: 'stdClass'},
      __tinkrClass: 'stdClass',
    })
    // an object that had no fields is `{}` and a list that had none is `[]`:
    // they must not collapse into one another
    expect(Array.isArray(payload.value.emptyList)).toBe(true)
    expect(Array.isArray(payload.value.emptyObject)).toBe(false)
  })

  test('describes a resource instead of answering null', () => {
    const {payload} = runPhp("$handle = fopen('php://memory', 'r');\n$handle;")

    expect(payload.value).toBe('[resource: stream]')
  })

  test('keeps only the public fields of an object', () => {
    const {payload} = runPhp(
      'class TinkrVisible {\n' +
      "  public $shown = 'yes';\n" +
      "  private $secret = 'no';\n" +
      "  protected $guarded = 'no';\n" +
      '}\n' +
      'new TinkrVisible();',
    )

    expect(payload.value).toEqual({shown: 'yes', __tinkrClass: 'TinkrVisible'})
  })

  test('bounds an object that refers back to itself', () => {
    const {payload} = runPhp(
      '$node = new stdClass();\n' +
      '$node->self = $node;\n' +
      "$node->name = 'cycle';\n" +
      '$node;',
    )

    expect(payload.error).toBe(null)
    expect(payload.value).toEqual({self: '[recursion]', name: 'cycle', __tinkrClass: 'stdClass'})
  })

  test('bounds a value nested deeper than the walk goes', () => {
    const {payload} = runPhp(
      '$deep = new stdClass();\n' +
      '$cursor = $deep;\n' +
      'for ($i = 0; $i < 20; $i++) { $cursor->next = new stdClass(); $cursor = $cursor->next; }\n' +
      '$deep;',
    )

    expect(payload.error).toBe(null)
    expect(JSON.stringify(payload.value)).toContain('[deeper than 12 levels]')
  })
})

describe('values php has its own json shape for', () => {
  test('keeps the date and timezone a DateTime answers with', () => {
    const {payload} = runPhp('new DateTime("2026-10-27T10:00:00Z");')

    // json wrote these three and nothing else: the run answers the same
    expect(payload.error).toBe(null)
    expect(payload.value).toEqual({
      date: '2026-10-27 10:00:00.000000',
      timezone_type: 2,
      timezone: 'Z',
      __tinkrClass: 'DateTime',
    })
  })

  test('keeps a named timezone on a DateTime, and a DateTimeZone\'s own', () => {
    const date = runPhp('new DateTime("2026-10-27T10:00:00", new DateTimeZone("UTC"));')
    const zone = runPhp('new DateTimeZone("Europe/Paris");')

    expect(date.payload.value).toEqual({
      date: '2026-10-27 10:00:00.000000',
      timezone_type: 3,
      timezone: 'UTC',
      __tinkrClass: 'DateTime',
    })
    expect(zone.payload.value).toEqual({timezone_type: 3, timezone: 'Europe/Paris', __tinkrClass: 'DateTimeZone'})
  })

  test('walks the values an ArrayObject holds, in the object json wrote for it', () => {
    const {payload} = runPhp('new ArrayObject(["nested" => [INF], "bad" => "\\xB1"]);')

    // the storage is walked, so the unsafe scalars inside it are described
    // rather than handed to json_encode as 0 or dropped
    expect(payload.error).toBe(null)
    expect(payload.value).toEqual({nested: ['INF'], bad: '0xb1', __tinkrClass: 'ArrayObject'})
  })

  test('writes an ArrayObject with a list for storage as an object, as json did', () => {
    const {payload} = runPhp('new ArrayObject([INF, -INF]);')

    // json_encode wrote `{"0":…,"1":…}` for an ArrayObject whatever its keys
    // were, so the list does not become a list here
    expect(Array.isArray(payload.value)).toBe(false)
    expect(payload.value).toEqual({0: 'INF', 1: '-INF', __tinkrClass: 'ArrayObject'})
  })

  test('walks the elements of a SplFixedArray, as a list', () => {
    const {payload} = runPhp('SplFixedArray::fromArray([INF, 3]);')

    // the elements are a list, and the class rides beside it: a json array has
    // nowhere to write what it was
    expect(payload.error).toBe(null)
    expect(payload.value).toEqual({__tinkrClass: 'SplFixedArray', __tinkrMap: ['INF', 3]})
  })
})

describe('a value that serializes itself', () => {
  test('is asked once, and the final value is that snapshot', () => {
    const {payload, tail} = runPhp(
      'class TinkrQuietCount implements \\JsonSerializable {\n' +
      '  public static $calls = 0;\n' +
      "  public function jsonSerialize(): mixed { self::$calls += 1; return ['calls' => self::$calls]; }\n" +
      '}\n' +
      '(function () { return new TinkrQuietCount(); })();',
      "echo '|COUNTER='.TinkrQuietCount::$calls;",
    )

    // one snapshot, taken after the snippet ended: the block and the run's
    // final value are the same one, so the serializer ran once and not once for
    // the block and once again for the value
    expect(payload.blocks[1].value).toEqual({calls: 1, __tinkrClass: 'TinkrQuietCount'})
    expect(payload.value).toEqual({calls: 1, __tinkrClass: 'TinkrQuietCount'})
    expect(tail).toContain('|COUNTER=1')
  })

  test('is not asked between the snippet\'s own statements', () => {
    const {payload, printed} = runPhp(
      '$calls = 0;\n' +
      '$obj = new class($calls) implements \\JsonSerializable {\n' +
      '  public $calls;\n' +
      '  public function __construct(&$n) { $this->calls = &$n; }\n' +
      '  public function jsonSerialize(): mixed { $this->calls += 1; return 1; }\n' +
      '};\n' +
      "if ($calls === 0) { echo 'GOOD'; } else { echo 'MUTATED:' . $calls; }",
    )

    // normalizing the assignment's value between two statements asked the
    // serializer, so the counter the `if` read had already been changed
    expect(printed).toBe('GOOD')
    expect(payload.error).toBe(null)
    expect(payload.blocks[1].value).toEqual({__tinkrClass: 'class@anonymous', __tinkrMap: 1})
  })

  test('describes one object once however many blocks hold it', () => {
    const {payload, printed} = runPhp(
      'class TinkrLoudOnce implements \\JsonSerializable {\n' +
      "  public function jsonSerialize(): mixed { echo 'serialized'; return ['ok' => true]; }\n" +
      '}\n' +
      '$one = new TinkrLoudOnce();\n' +
      '$one;\n' +
      '$one;',
    )

    // the same object in three statement values is one answer: a serializer that
    // prints would otherwise print once for each block that held it
    expect(printed).toBe('serialized')
    expect(payload.blocks[1].value).toEqual({ok: true, __tinkrClass: 'TinkrLoudOnce'})
    expect(payload.blocks[2].value).toEqual({ok: true, __tinkrClass: 'TinkrLoudOnce'})
    expect(payload.value).toEqual({ok: true, __tinkrClass: 'TinkrLoudOnce'})
  })

  test('keeps what the serializer printed outside the envelope', () => {
    const {payload, printed} = runPhp(
      'class TinkrLoud implements \\JsonSerializable {\n' +
      "  public function jsonSerialize(): mixed { echo 'serializer-printed'; return ['ok' => true]; }\n" +
      '}\n' +
      'new TinkrLoud();',
    )

    // the envelope is computed before either marker is printed, so output the
    // serializer itself writes lands in the run's output and the envelope still
    // parses
    expect(printed).toBe('serializer-printed')
    expect(payload.error).toBe(null)
    expect(payload.value).toEqual({ok: true, __tinkrClass: 'TinkrLoud'})
  })

  test('describes a serializer that throws', () => {
    const {payload} = runPhp(
      'class TinkrBroken implements \\JsonSerializable {\n' +
      "  public function jsonSerialize(): mixed { throw new RuntimeException('serializer-failed'); }\n" +
      '}\n' +
      'new TinkrBroken();',
    )

    expect(payload.error).toBe(null)
    expect(payload.value).toBe('[TinkrBroken could not be serialized: serializer-failed]')
  })

  test('bounds a serializer that answers with itself', () => {
    const {payload} = runPhp(
      'class TinkrSelfSerializer implements \\JsonSerializable {\n' +
      '  public $self;\n' +
      '  public function jsonSerialize(): mixed { return $this->self; }\n' +
      '}\n' +
      '$cycle = new TinkrSelfSerializer();\n' +
      '$cycle->self = $cycle;\n' +
      '$cycle;',
    )

    // the walk met the object it was walking: the value is described as the
    // recursion it is, and the class still says what it was
    expect(payload.error).toBe(null)
    expect(payload.value).toEqual({__tinkrClass: 'TinkrSelfSerializer', __tinkrMap: '[recursion]'})
  })
})

describe('what a value is', () => {
  // the framework's interface, so the branch that renders markup is reachable
  // without a laravel application: a statement of its own, because the wrapper
  // evals a statement at a time and a `namespace` at the top of a file only
  // holds for the file it is written in
  const HTMLABLE = "eval('namespace Illuminate\\\\Contracts\\\\Support; interface Htmlable { public function toHtml(); }');"

  test('names the class of an object, and of an anonymous one without its file', () => {
    const named = runPhp('class TinkrNamed { public $a = 1; }\nnew TinkrNamed();')
    const anonymous = runPhp('new class { public $a = 1; }')

    expect(named.payload.value).toEqual({a: 1, __tinkrClass: 'TinkrNamed'})
    expect(anonymous.payload.value).toEqual({a: 1, __tinkrClass: 'class@anonymous'})
    // the name php gives an anonymous class carries the file it was written in,
    // which is nothing the value is
    expect(JSON.stringify(anonymous.payload.value)).not.toContain('.php')
  })

  test('keeps a field named like a reserved key under the map', () => {
    const {payload} = runPhp('$o = new stdClass();\n$o->__tinkrClass = "fake";\n$o->a = 1;\n$o;')

    // a field of the value is never read as what the envelope says about it
    expect(payload.value).toEqual({
      __tinkrClass: 'stdClass',
      __tinkrMap: {__tinkrClass: 'fake', a: 1},
      __tinkrKeys: ['__tinkrClass', 'a'],
    })
  })

  test('describes an enum as its case, with the value behind a backed one', () => {
    const backed = runPhp("enum TinkrSuit: string { case H = 'h'; }\nTinkrSuit::H;")
    const pure = runPhp('enum TinkrDir { case Up; }\nTinkrDir::Up;')

    expect(backed.payload.value).toEqual({__tinkrClass: 'TinkrSuit', __tinkrEnum: 'H', __tinkrBacked: 'h'})
    expect(pure.payload.value).toEqual({__tinkrClass: 'TinkrDir', __tinkrEnum: 'Up'})
  })

  test('describes a closure by its signature and the names it closed over', () => {
    const {payload} = runPhp(
      '$outside = 1;\n' +
      '(function (int $n = 2, string $s = "x", &$byRef = null, ...$rest) use ($outside) { return $n; });',
    )

    // the bound name, never the value behind it
    expect(payload.value).toEqual({
      __tinkrClass: 'Closure',
      __tinkrClosure: {
        params: ['int $n = 2', "string $s = 'x'", '&$byRef = null', '...$rest'],
        uses: ['outside'],
      },
    })
  })

  test('writes a default as the literal it was, constants included', () => {
    const {payload} = runPhp('(function ($n = PHP_INT_MAX, $a = [1, "k" => 2], $z = null) { return $n; });')

    expect(payload.value.__tinkrClosure.params).toEqual([
      '$n = PHP_INT_MAX',
      "$a = [1, 'k' => 2]",
      '$z = null',
    ])
  })

  test('answers a stringable value as the string it casts to, with its class', () => {
    const {payload} = runPhp(
      'class TinkrId {\n' +
      '  private $value;\n' +
      '  public function __construct($value) { $this->value = $value; }\n' +
      '  public function __toString(): string { return $this->value; }\n' +
      '}\n' +
      "new TinkrId('a-1');",
    )

    expect(payload.value).toEqual({__tinkrClass: 'TinkrId', __tinkrMap: 'a-1'})
  })

  test('keeps the fields of a stringable value that has some', () => {
    const {payload} = runPhp(
      'class TinkrBoth {\n' +
      "  public $name = 'shown';\n" +
      "  public function __toString(): string { return 'cast'; }\n" +
      '}\n' +
      'new TinkrBoth();',
    )

    // public state is the value: the string it would cast to is one way of
    // reading it, not what it is
    expect(payload.value).toEqual({name: 'shown', __tinkrClass: 'TinkrBoth'})
  })

  test('describes rendered markup as the document it is', () => {
    const {payload} = runPhp(
      `${HTMLABLE}\n` +
      'class TinkrMarkup implements \\Illuminate\\Contracts\\Support\\Htmlable {\n' +
      "  public function toHtml() { return '<p>a</p><p>b</p>'; }\n" +
      '}\n' +
      'new TinkrMarkup();',
    )

    expect(payload.error).toBe(null)
    expect(payload.value).toEqual({__tinkrClass: 'TinkrMarkup', __tinkrHtml: '<p>a</p><p>b</p>'})
  })

  test('bounds rendered markup, and says it was cut', () => {
    const {payload} = runPhp(
      `${HTMLABLE}\n` +
      'class TinkrLong implements \\Illuminate\\Contracts\\Support\\Htmlable {\n' +
      "  public function toHtml() { return str_repeat('<p>x</p>', 100000); }\n" +
      '}\n' +
      'new TinkrLong();',
    )

    expect(payload.value.__tinkrClass).toBe('TinkrLong')
    expect(payload.value.__tinkrHtml).toHaveLength(524288)
    expect(payload.value.__tinkrHtmlCut).toBe(true)
  })

  test('answers a value that will not render as the object it is', () => {
    const {payload} = runPhp(
      `${HTMLABLE}\n` +
      'class TinkrUnrenderable implements \\Illuminate\\Contracts\\Support\\Htmlable {\n' +
      "  public $name = 'kept';\n" +
      "  public function toHtml() { throw new RuntimeException('no markup'); }\n" +
      '}\n' +
      'new TinkrUnrenderable();',
    )

    // a value that refuses to be read is still a value, and the run is not
    // broken by it
    expect(payload.error).toBe(null)
    expect(payload.value).toEqual({name: 'kept', __tinkrClass: 'TinkrUnrenderable'})
  })
})

describe('where an error was thrown', () => {
  test('says the snippet line of a throw, on the statement it was written in', () => {
    const {payload} = runPhp("$a = 1;\n\nthrow new RuntimeException('boom');")

    // the second statement starts on line 2 — the whitespace the first one ended
    // with — and the throw is on line 3 of the snippet, which is what the error
    // says: the eval's own line 2 is not a line anybody wrote
    expect(payload.error).toEqual({
      line: 3,
      file: null,
      fileLine: null,
      class: 'RuntimeException',
      message: 'boom',
      trace: [],
    })
    expect(payload.blocks.at(-1).error.line).toBe(3)
  })

  test('keeps the frames a throw came through, the snippet one marked as itself', () => {
    const {payload} = runPhp(
      'tinkrOuter(function () {\n' +
      "  throw new RuntimeException('boom');\n" +
      '});',
      '',
      // a function of a file that is not the snippet's, the way a framework's is,
      // and the run started where that file is: its path is the project's
      `${into(framework)}require '${framework}/vendor.php';`,
    )

    // the throw is on the snippet's second line, and the frame above it is the
    // call the snippet's closure was made from: a file of its own, not the snippet
    expect(payload.error.line).toBe(2)
    expect(payload.error.file).toBe(null)
    expect(payload.error.trace).toEqual([
      {file: 'vendor.php', line: 2, class: null, function: '{closure}', snippet: false},
      {file: null, line: 1, class: null, function: 'tinkrOuter', snippet: true},
    ])
  })

  test('names a file outside the snippet from the project root, with the line in it', () => {
    const {payload} = runPhp(
      'tinkrBoom();',
      '',
      `${into(framework)}require '${framework}/vendor.php';`,
    )

    // the file the throw came from is written from the root the run was started
    // in, and the frame under it is the snippet's own line
    expect(payload.error).toMatchObject({line: null, file: 'vendor.php', fileLine: 3, class: 'LogicException'})
    expect(payload.error.trace[0]).toEqual({file: null, line: 1, class: null, function: 'tinkrBoom', snippet: true})
  })

  test('stops a trace at thirty frames', () => {
    const {payload} = runPhp(
      "function tinkrDown($n) { if ($n === 0) { throw new RuntimeException('bottom'); } tinkrDown($n - 1); }\n" +
      'tinkrDown(40);',
    )

    expect(payload.error.trace).toHaveLength(30)
    expect(payload.error.trace.every(frame => frame.snippet === true)).toBe(true)
  })

  test('carries no arguments of a frame, whatever the run was working with', () => {
    const {payload} = runPhp(
      "function tinkrKeep($secret) { throw new RuntimeException('boom'); }\n" +
      "tinkrKeep('hunter2');",
    )

    // an argument is a value the run had, and a value can be a password: the
    // frame says which function and which line, and nothing of what it was given
    expect(JSON.stringify(payload)).not.toContain('hunter2')
    expect(payload.error.trace).toEqual([{file: null, line: 2, class: null, function: 'tinkrKeep', snippet: true}])
  })

  test('reports a fatal error on the line of the snippet, with no eval chain in its words', () => {
    const {payload} = runPhpFatal("$a = 1;\ntrigger_error('boom', E_USER_ERROR);")

    expect(payload.error).toMatchObject({class: 'FatalError', message: 'boom', line: 2})
    expect(payload.error.file).toBe(null)
    expect(payload.error.message).not.toContain("eval()'d code")
    expect(payload.error.trace).toEqual([])
  })

  test('drops the eval chain psysh writes into the message of a warning it wraps', () => {
    const {payload} = runPhp(
      "trigger_error('boom', E_USER_WARNING);",
      '',
      // psysh's error handler answers a warning with an exception whose words
      // are the warning and the eval chain php named the file with
      'set_error_handler(function($level, $message, $file, $line) {' +
      " throw new \\ErrorException('PHP Error:  '.$message.' in '.$file.' on line '.$line, 0, $level, $file, $line); });",
    )

    expect(payload.error.class).toBe('ErrorException')
    expect(payload.error.message).toBe('PHP Error:  boom')
    expect(payload.error.line).toBe(1)
  })

  test('keeps the exception an error was thrown from, with the same shape', () => {
    const {payload} = runPhp(
      "try { throw new RuntimeException('inner'); } catch (RuntimeException $e) {" +
      " throw new LogicException('outer', 0, $e); }",
    )

    expect(payload.error.previous).toMatchObject({
      line: 1,
      file: null,
      fileLine: null,
      class: 'RuntimeException',
      message: 'inner',
    })
    expect(payload.error.previous.trace).toEqual([])
  })
})

/**
 * The dumper the run would have in a project with symfony's var-dumper.
 *
 * The php this suite runs is bare — no framework, no composer — so `dump()` and
 * `dd()` are not there and symfony's class is not either. This is the smallest
 * thing that answers like it: a `setHandler` that remembers what it replaced, a
 * `dump` that prints through whatever handler is set, and the two functions every
 * project with the dumper has. The class is written in the php that runs before
 * the wrapper rather than eval'd, because a class declared in an eval'd file
 * would be a file the wrapper has to tell the snippet's own code from — and that
 * distinction is the one thing this fixture must not blur.
 *
 * It opens a namespace block the run is written inside; `dumperEnd` closes it.
 *
 * @type {String}
 */
const dumper = `namespace Symfony\\Component\\VarDumper {
class VarDumper {
  public static $handler = null;
  public static function setHandler($handler) { $previous = self::$handler; self::$handler = $handler; return $previous; }
  public static function dump($value, $label = null) {
    if (self::$handler !== null) { return (self::$handler)($value, $label); }
    echo "dumped:", json_encode($value), "\\n";
    return $value;
  }
} }
namespace {
function dump(...$values) {
  foreach ($values as $value) { \\Symfony\\Component\\VarDumper\\VarDumper::dump($value); }
  return count($values) === 1 ? $values[0] : $values;
}
function dd(...$values) {
  foreach ($values as $value) { \\Symfony\\Component\\VarDumper\\VarDumper::dump($value); }
  exit(1);
}
`

const dumperEnd = '\n}'

/**
 * A run in the project whose dumper is above.
 *
 * @param {String} source
 * @return {{payload: Object, printed: String, tail: String}}
 */
const runDumped = source => {
  const run = wrapRun(source)
  let out = ''

  // a run that ends through exit() or dd() ends the process with a status, which
  // is the run's answer and not a failure of the harness
  try {
    out = execFileSync('php', [], {encoding: 'utf8', input: `<?php ${dumper} ${run.code}${dumperEnd}`})
  } catch (stop) {
    out = stop.stdout || ''
  }

  const at = out.indexOf(`${run.marker}@`)

  if (at < 0) {
    throw new Error(`the run printed no envelope: ${JSON.stringify(out)}`)
  }

  const rest = out.slice(at + run.marker.length + 1)

  return {
    payload: JSON.parse(Buffer.from(rest.slice(0, rest.indexOf('@')), 'base64').toString('utf8')),
    printed: out.slice(0, at).split(run.start).join(''),
  }
}

describe('what a run dumped, and how it ended', () => {
  test('keeps what dump() showed, in the statement that showed it', () => {
    const {payload, printed} = runDumped('dump(1); 2')

    expect(payload.blocks[0]).toMatchObject({line: 1, value: 1, dumps: [{line: 1, value: 1}]})
    expect(payload.blocks[1]).toMatchObject({line: 1, value: 2, dumps: []})
    expect(payload.value).toBe(2)
    expect(payload.error).toBe(null)
    expect(payload.ended).toBe(null)
    // the dump still printed: the handler the run replaced is the one that shows
    // it, which is what leaves a run's output exactly as it was
    expect(printed).toBe('dumped:1\n')
  })

  test('answers a dd() as a value and an ending, not as an error', () => {
    const {payload, printed} = runDumped("dd(['a' => 1])")

    expect(payload.error).toBe(null)
    expect(payload.ended).toEqual({by: 'dd', line: 1})
    // the array the person asked to look at is the tree, not the text of one
    expect(payload.blocks).toEqual([{line: 1, value: null, error: null, dumps: [{line: 1, value: {a: 1}}]}])
    expect(payload.value).toBe(null)
    expect(printed).toBe('dumped:{"a":1}\n')
  })

  test('answers an exit() as an ending, with nothing to report as thrown', () => {
    const {payload, printed} = runDumped('exit(3)')

    expect(payload.error).toBe(null)
    expect(payload.ended).toEqual({by: 'exit', line: 1})
    expect(payload.blocks).toEqual([{line: 1, value: null, error: null, dumps: []}])
    expect(printed).toBe('')
  })

  test('does not call an exit() after a completed dump() a dd()', () => {
    const {payload} = runDumped('dump(1);\nexit(2);')

    expect(payload.ended).toEqual({by: 'exit', line: 2})
    expect(payload.blocks[0].dumps).toEqual([{line: 1, value: 1}])
  })

  test('keeps the statement a dump() was in when a later statement threw', () => {
    const {payload} = runDumped("dump('kept');\nthrow new RuntimeException('boom');")

    expect(payload.blocks[0].dumps).toEqual([{line: 1, value: 'kept'}])
    expect(payload.blocks[1].error).toMatchObject({class: 'RuntimeException', line: 2})
    expect(payload.error).toMatchObject({class: 'RuntimeException', line: 2})
  })

  test('reads the snippet line of a dump() inside a closure', () => {
    const {payload} = runDumped("$tinkrTest = function () {\n  dump('inner');\n\n  return 1;\n};\n$tinkrTest();")

    expect(payload.blocks[1].dumps).toEqual([{line: 2, value: 'inner'}])
  })

  test('keeps a dump() of a closure the same statement called', () => {
    const {payload} = runDumped('$map = array_map(function ($n) {\n  dump($n);\n\n  return $n;\n}, [7]);\n$map;')

    expect(payload.blocks[0].dumps).toEqual([{line: 2, value: 7}])
  })

  test('keeps what a dump() was shown when the same statement died', () => {
    const {payload} = runDumped("dump('kept') + trigger_error('boom', E_USER_ERROR);")

    // the statement is kept with the value it showed, and the fatal is the
    // run's error rather than an ending
    expect(payload.blocks[0]).toMatchObject({line: 1, value: null, error: null, dumps: [{line: 1, value: 'kept'}]})
    expect(payload.error).toMatchObject({class: 'FatalError', message: 'boom', line: 1})
    expect(payload.ended).toBe(null)
    expect(payload.stats.memory).toBeGreaterThan(0)
  })

  test('does nothing when the project has no dumper', () => {
    // a project with its own dump(): no symfony class to hook, so nothing is
    // recorded — and the print is still the project's own
    const {payload, printed} = runPhp('dump(1); 2', '', 'function dump($value) { echo "own:", $value, "\\n"; }\n')

    // the project's dump() returns nothing, so the statement answered nothing —
    // and nothing about it was recorded, because there is no handler to replace
    expect(payload.blocks[0]).toMatchObject({line: 1, value: null, dumps: []})
    expect(printed).toBe('own:1\n')
  })

  test('measures the snippet itself: its own time and the memory it peaked at', () => {
    const {payload} = runPhp('usleep(3000); 1')

    expect(payload.stats.time).toBeGreaterThan(0)
    expect(Number.isInteger(payload.stats.time)).toBe(true)
    expect(payload.stats.memory).toBeGreaterThan(0)
    expect(Number.isInteger(payload.stats.memory)).toBe(true)
  })
})
