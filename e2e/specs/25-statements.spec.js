const {test, expect} = require('@playwright/test')

const {launchTinkr} = require('../support/tinkr')
const {runCode} = require('../support/actions')

// the session splits a run into its statements with php's own tokenizer (see
// runResult SPLIT_BLOCKS), and a statement cut in the wrong place is a parse
// error or a value of null where the snippet answered something
test.describe('splitting a run into statements', () => {
  test('keeps a block written with the alternative syntax whole', async () => {
    const {page, close} = await launchTinkr()

    try {
      await runCode(page, [
        '$out = [];',
        'foreach ([1, 2] as $n):',
        '  if ($n === 1):',
        "    $out[] = 'alt-one';",
        '  else:',
        "    $out[] = 'alt-two';",
        '  endif;',
        'endforeach;',
        "implode('+', $out);",
      ].join('\n'))

      const output = page.locator('.output')

      await expect(output).toContainText('3 statements')
      await expect(output).toContainText('alt-one+alt-two')
      await expect(output).not.toContainText('ParseError')
    } finally {
      await close()
    }
  })

  test('answers with a match, and reads the line after a declaration as its own', async () => {
    const {page, close} = await launchTinkr()

    try {
      // The semicolon after the match's closing brace belongs to the expression.
      // Keep the opening brace off a line end so Monaco does not auto-close it.
      await runCode(page, "match (true) { 2 > 1 => 'matched-gt',\n  default => 'matched-le',\n};")
      await expect(page.locator('.output')).toContainText('matched-gt')

      // a declaration ends at its `}`, even when the next line opens with `(`.
      // It is one line: the editor closes a `{` typed at the end of a line itself
      await runCode(page, 'class E2ePoint { public function get() { return 71; } }\n(new E2ePoint())->get();')
      await expect(page.locator('.output')).toContainText('2 statements')
      await expect(page.locator('.t-number').filter({hasText: '71'})).toHaveCount(1)
    } finally {
      await close()
    }
  })

  test('shows what a run printed before dd() stopped it, and the dump itself', async () => {
    const {page, close} = await launchTinkr()

    try {
      await runCode(page, "echo 'printed-before';\ndd('the-dumped-value');")

      const output = page.locator('.output')

      await expect(output).toContainText('printed-before')
      await expect(output).toContainText('the-dumped-value')
    } finally {
      await close()
    }
  })
})
