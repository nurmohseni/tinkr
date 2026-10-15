const {stripNonCode, importedClasses, bareClassNames} = require('../phpScanner')

describe('the snippet scanner', () => {
  test('blanks strings, heredocs and comments, keeping the code around them', () => {
    expect(stripNonCode("$a = 'Order'; $b = \"x\";")).toBe('$a =        ; $b =    ;')
    expect(stripNonCode('// Order::where\n1 + 1;')).toBe('               \n1 + 1;')
    expect(stripNonCode('# Order::where\n1 + 1;')).toBe('              \n1 + 1;')
    expect(stripNonCode('/* Order::where */ 1;')).toBe('                   1;')
    expect(stripNonCode('$a = <<<SQL\nOrder::where\nSQL;\n1;')).toBe('$a =       \n            \n   ;\n1;')
    expect(stripNonCode("$a = <<<'SQL'\nOrder\nSQL;\n1;")).toBe('$a =         \n     \n   ;\n1;')
    expect(stripNonCode('$a = "a\\"Order"; $b = 1;')).toBe('$a =           ; $b = 1;')
  })

  test('an attribute is not a comment', () => {
    expect(bareClassNames('#[Factura] function () {}, 1;')).toEqual([])
  })

  test('reads the classes of the snippet that started this', () => {
    const snippet = `$cfg = config('verifactu');
dump($cfg);
dump(array_keys($cfg));
$orders = Order::where('paid', true)->get();
foreach ($orders as $order) { dump($order->id); }`

    expect(bareClassNames(snippet)).toEqual(['Order'])
  })

  test('takes the names php resolves as a class', () => {
    expect(bareClassNames('new Order();')).toEqual(['Order'])
    expect(bareClassNames('Order::class;')).toEqual(['Order'])
    expect(bareClassNames('Order::where(1);')).toEqual(['Order'])
    expect(bareClassNames('function (Order $x) { return $x; }')).toEqual(['Order'])
    expect(bareClassNames('$x instanceof Order;')).toEqual(['Order'])
    expect(bareClassNames('try {} catch (Order $e) {}')).toEqual(['Order'])
    expect(bareClassNames('try {} catch (Order|Invoice $e) {}')).toEqual(['Invoice', 'Order'])
    expect(bareClassNames('$x = new \\App\\Models\\Order();')).toEqual([])
    expect(bareClassNames('$x = App\\Models\\Order::where(1);')).toEqual([])
  })

  test('leaves variables, members, functions and keywords alone', () => {
    expect(bareClassNames('$order->where(1);')).toEqual([])
    expect(bareClassNames('$order::where(1);')).toEqual([])
    expect(bareClassNames('dump($order->id);')).toEqual([])
    expect(bareClassNames('config("app");')).toEqual([])
    expect(bareClassNames('array_keys([1, 2]);')).toEqual([])
    expect(bareClassNames('self::where(1); static::x(); parent::y();')).toEqual([])
    expect(bareClassNames('function (array $x, ?Invoice $y) {}')).toEqual(['Invoice'])
    expect(bareClassNames('foreach ($a as $b) {}')).toEqual([])
    expect(bareClassNames('Order::where(1)->order();')).toEqual(['Order'])
  })

  test('leaves strings and comments alone', () => {
    expect(bareClassNames("$a = 'Order::where';")).toEqual([])
    expect(bareClassNames('// Order::where')).toEqual([])
    expect(bareClassNames('/* new Order */')).toEqual([])
    expect(bareClassNames('$sql = <<<SQL\nnew Order\nSQL;')).toEqual([])
  })

  test('leaves a name the snippet imports itself alone', () => {
    expect(bareClassNames('use App\\Models\\Order;\nOrder::where(1);')).toEqual([])
    expect(bareClassNames('use App\\Models\\Order as O;\nO::where(1);\nOrder::where(1);')).toEqual(['Order'])
    expect(bareClassNames('use App\\Models\\{Order, Invoice};\nOrder::where(1); Invoice::first();')).toEqual([])
    expect(bareClassNames('use function App\\Helpers\\make;\nOrder::where(1);')).toEqual(['Order'])
  })

  test('reports a name once, in a stable order', () => {
    expect(bareClassNames('Order::where(1); Order::first(); Invoice::class;')).toEqual(['Invoice', 'Order'])
  })

  test('reads the class every `use` statement names', () => {
    expect(importedClasses('use App\\Models\\Order;')).toEqual(new Map([['order', 'App\\Models\\Order']]))
    expect(importedClasses('use App\\Models\\Order as O;')).toEqual(new Map([['o', 'App\\Models\\Order']]))
    expect(importedClasses('use \\App\\Models\\Order;')).toEqual(new Map([['order', 'App\\Models\\Order']]))
    expect(importedClasses('use App\\Models\\Order, App\\Support\\Helper;')).toEqual(new Map([
      ['order', 'App\\Models\\Order'],
      ['helper', 'App\\Support\\Helper'],
    ]))
  })

  test('reads a group use as the prefix outside its braces', () => {
    expect(importedClasses('use App\\Models\\{Order, Invoice as Bill};')).toEqual(new Map([
      ['order', 'App\\Models\\Order'],
      ['bill', 'App\\Models\\Invoice'],
    ]))
    expect(importedClasses('use App\\Models\\{Order}, Other\\{Helper};')).toEqual(new Map([
      ['order', 'App\\Models\\Order'],
      ['helper', 'Other\\Helper'],
    ]))
  })

  test('reads a `use` that imports no class as no class', () => {
    expect(importedClasses('use function App\\Helpers\\make;')).toEqual(new Map())
    expect(importedClasses('use const App\\Helpers\\VERSION;')).toEqual(new Map())
    expect(importedClasses('use App\\{function make};')).toEqual(new Map())
  })

  test('keys a name the way php resolves it, without regard to case', () => {
    expect(Array.from(importedClasses('use App\\Models\\Order;').keys())).toEqual(['order'])
    expect(Array.from(importedClasses('USE App\\Models\\Order;').keys())).toEqual(['order'])
  })
})
