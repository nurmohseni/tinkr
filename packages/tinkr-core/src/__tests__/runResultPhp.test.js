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

const {wrapRun} = require('../runResult')

/**
 * Run a snippet through the real wrapper and read the envelope it printed.
 *
 * @param {String} source
 * @param {String} [after] php run after the wrapper, which is how a run's own
 * counter is read once the envelope is out
 * @return {{payload: Object, printed: String, tail: String}}
 */
const runPhp = (source, after = '') => {
  const run = wrapRun(source)
  const out = execFileSync('php', [], {encoding: 'utf8', input: `<?php ${run.code}${after}`})
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
    expect(payload.error).toEqual({class: 'ParseError', message: 'risky-broke'})
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
      emptyObject: {},
      emptyList: [],
      child: {value: 'nested'},
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

    expect(payload.value).toEqual({shown: 'yes'})
  })

  test('bounds an object that refers back to itself', () => {
    const {payload} = runPhp(
      '$node = new stdClass();\n' +
      '$node->self = $node;\n' +
      "$node->name = 'cycle';\n" +
      '$node;',
    )

    expect(payload.error).toBe(null)
    expect(payload.value).toEqual({self: '[recursion]', name: 'cycle'})
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
    })
  })

  test('keeps a named timezone on a DateTime, and a DateTimeZone\'s own', () => {
    const date = runPhp('new DateTime("2026-10-27T10:00:00", new DateTimeZone("UTC"));')
    const zone = runPhp('new DateTimeZone("Europe/Paris");')

    expect(date.payload.value).toEqual({
      date: '2026-10-27 10:00:00.000000',
      timezone_type: 3,
      timezone: 'UTC',
    })
    expect(zone.payload.value).toEqual({timezone_type: 3, timezone: 'Europe/Paris'})
  })

  test('walks the values an ArrayObject holds, in the object json wrote for it', () => {
    const {payload} = runPhp('new ArrayObject(["nested" => [INF], "bad" => "\\xB1"]);')

    // the storage is walked, so the unsafe scalars inside it are described
    // rather than handed to json_encode as 0 or dropped
    expect(payload.error).toBe(null)
    expect(payload.value).toEqual({nested: ['INF'], bad: '0xb1'})
  })

  test('writes an ArrayObject with a list for storage as an object, as json did', () => {
    const {payload} = runPhp('new ArrayObject([INF, -INF]);')

    // json_encode wrote `{"0":…,"1":…}` for an ArrayObject whatever its keys
    // were, so the list does not become a list here
    expect(Array.isArray(payload.value)).toBe(false)
    expect(payload.value).toEqual({0: 'INF', 1: '-INF'})
  })

  test('walks the elements of a SplFixedArray, as a list', () => {
    const {payload} = runPhp('SplFixedArray::fromArray([INF, 3]);')

    expect(payload.error).toBe(null)
    expect(payload.value).toEqual(['INF', 3])
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
    expect(payload.blocks[1].value).toEqual({calls: 1})
    expect(payload.value).toEqual({calls: 1})
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
    expect(payload.blocks[1].value).toBe(1)
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
    expect(payload.blocks[1].value).toEqual({ok: true})
    expect(payload.blocks[2].value).toEqual({ok: true})
    expect(payload.value).toEqual({ok: true})
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
    expect(payload.value).toEqual({ok: true})
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

    expect(payload.error).toBe(null)
    expect(payload.value).toBe('[recursion]')
  })
})
