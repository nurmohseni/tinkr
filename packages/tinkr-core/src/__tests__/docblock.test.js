// the docblock reader is what makes a facade answerable: the class declares a
// handful of methods and documents the whole manager behind it
const {parse} = require('../docblock')

describe('reading a docblock', () => {
  test('reads a facade\'s documented methods, with their signatures', () => {
    const doc = `/**
 * @see \\Illuminate\\Contracts\\Cache\\Factory
 * @see \\Illuminate\\Contracts\\Cache\\Repository
 *
 * @method static mixed get(string $key, mixed $default = null)
 * @method static bool put(string $key, mixed $value, \\DateTimeInterface|\\DateInterval|null $ttl = null)
 * @method static void forget(string $key)
 */`
    const parsed = parse(doc)

    expect(parsed.methods.map(method => method.name)).toEqual(['get', 'put', 'forget'])
    expect(parsed.methods[0].static).toBe(true)
    expect(parsed.methods[0].returns).toBe('mixed')
    expect(parsed.methods[0].params).toEqual(['string $key', 'mixed $default = null'])
    // a union with generic arguments is one parameter, not three
    expect(parsed.methods[1].params).toEqual([
      'string $key',
      'mixed $value',
      '\\DateTimeInterface|\\DateInterval|null $ttl = null',
    ])
    expect(parsed.see).toEqual(['\\Illuminate\\Contracts\\Cache\\Factory', '\\Illuminate\\Contracts\\Cache\\Repository'])
  })

  test('joins a tag written over several lines instead of reading the tail as prose', () => {
    const parsed = parse(`/**
 * @method static \\Illuminate\\Pagination\\LengthAwarePaginator paginate(int $perPage = 15,
 *   array $columns = ['*'], string $pageName = 'page', int|null $page = null)
 */`)

    expect(parsed.methods).toHaveLength(1)
    expect(parsed.methods[0].name).toBe('paginate')
    expect(parsed.methods[0].params).toHaveLength(4)
    expect(parsed.methods[0].params[3]).toBe('int|null $page = null')
  })

  test('reads magic properties, mixins and a return type that carries generics', () => {
    const parsed = parse(`/**
 * The query builder.
 *
 * @property-read \\Illuminate\\Database\\Query\\Grammar $grammar
 * @property-write mixed $columns
 * @mixin \\Illuminate\\Support\\Traits\\Macroable
 * @return \\Illuminate\\Database\\Eloquent\\Builder<\\App\\Models\\User>
 */`)

    expect(parsed.summary).toBe('The query builder.')
    expect(parsed.properties).toEqual([
      {name: 'grammar', type: '\\Illuminate\\Database\\Query\\Grammar', read: true, write: false},
      {name: 'columns', type: 'mixed', read: false, write: true},
    ])
    expect(parsed.mixins).toEqual(['Illuminate\\Support\\Traits\\Macroable'])
    expect(parsed.returns).toBe('\\Illuminate\\Database\\Eloquent\\Builder<\\App\\Models\\User>')
  })

  test('answers nothing at all for no docblock, and does not throw on a broken one', () => {
    expect(parse(null)).toEqual({
      summary: '', returns: null, params: [], methods: [], properties: [], mixins: [], see: [],
    })
    expect(parse('/** @method */').methods).toEqual([])
  })
})
