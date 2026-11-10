import {
  callFrameAt,
  createSignatureProvider,
  registerPHPSignatureProvider,
  toSignatureHelp,
} from '../phpSignature'

const monaco = {
  languages: {
    registerSignatureHelpProvider: (id, provider) => ({id, provider, dispose: () => {}}),
  },
}

describe('callFrameAt', () => {
  test('counts the arguments of the call whose bracket is open', () => {
    const code = '<?php User::where('

    expect(callFrameAt(code, code.length)).toEqual({open: code.indexOf('('), activeParameter: 0})
  })

  test('counts a comma as the next argument', () => {
    const code = '<?php User::where(\'a\', 1, '

    expect(callFrameAt(code, code.length).activeParameter).toBe(2)
  })

  test('a comma inside a string is not an argument boundary', () => {
    const code = "<?php config('app.debug', 'a,b"

    expect(callFrameAt(code, code.length)).toEqual({open: code.indexOf('('), activeParameter: 1})
  })

  test('a comma inside an array or a nested call is not one either', () => {
    const code = '<?php cache()->remember([1, 2], now(), fn () => [3, 4], '

    expect(callFrameAt(code, code.length).activeParameter).toBe(3)
  })

  test('a closed call is not the one the caret is in', () => {
    const code = "<?php str_replace('a', 'b', $text)"

    expect(callFrameAt(code, code.length)).toBeNull()
  })

  test('a comment is not an argument', () => {
    const code = '<?php foo(1 /* a, b */, '

    expect(callFrameAt(code, code.length).activeParameter).toBe(1)
  })

  test('a bracket that is not a call is not a signature', () => {
    const code = '<?php $items = [1, 2'

    expect(callFrameAt(code, code.length)).toBeNull()
  })
})

describe('toSignatureHelp', () => {
  const answer = {
    label: 'where($column, $operator = null)',
    parameters: [{label: '$column'}, {label: '$operator = null'}],
    activeParameter: 0,
  }

  test('maps the answer to monaco signatures', () => {
    expect(toSignatureHelp(answer, 1)).toEqual({
      signatures: [{
        label: 'where($column, $operator = null)',
        parameters: [{label: '$column'}, {label: '$operator = null'}],
      }],
      activeSignature: 0,
      activeParameter: 1,
    })
  })

  test('clamps an argument past the last parameter', () => {
    expect(toSignatureHelp(answer, 7).activeParameter).toBe(1)
  })

  test('a signature with no parameters highlights none', () => {
    expect(toSignatureHelp({label: 'flush()', parameters: []}, 3).activeParameter).toBe(-1)
  })

  test('an unknown call draws nothing', () => {
    expect(toSignatureHelp(null, 0)).toBeNull()
    expect(toSignatureHelp({parameters: []}, 0)).toBeNull()
  })
})

describe('createSignatureProvider', () => {
  const model = code => ({
    getValue: () => code,
    getOffsetAt: () => code.length,
  })

  const token = {isCancellationRequested: false}

  test('asks the main process only inside a call', async () => {
    const ask = jest.fn(() => ({label: 'where($column)', parameters: [{label: '$column'}]}))
    const provider = createSignatureProvider(monaco, ask)

    expect(await provider.provideSignatureHelp(model('<?php $user->'), {lineNumber: 1, column: 15}, token)).toBeNull()
    expect(ask).not.toHaveBeenCalled()
  })

  test('shows what the main process answered, at the argument the caret is in', async () => {
    const ask = jest.fn(() => ({label: 'where($column, $operator = null)', parameters: [{label: '$column'}, {label: '$operator = null'}]}))
    const provider = createSignatureProvider(monaco, ask)
    const code = "<?php User::where('a', "

    expect(await provider.provideSignatureHelp(model(code), {lineNumber: 1, column: code.length}, token))
      .toEqual({
        signatures: [{
          label: 'where($column, $operator = null)',
          parameters: [{label: '$column'}, {label: '$operator = null'}],
        }],
        activeSignature: 0,
        activeParameter: 1,
      })
  })

  test('a failed question draws nothing', async () => {
    const provider = createSignatureProvider(monaco, () => Promise.reject(new Error('no')))

    expect(await provider.provideSignatureHelp(model('<?php foo('), {lineNumber: 1, column: 10}, token)).toBeNull()
  })

  test('registers for the snippet language and is disposable', () => {
    const disposable = registerPHPSignatureProvider(monaco, () => null)

    expect(disposable.id).toBe('php-snippet')
    expect(typeof disposable.dispose).toBe('function')
  })
})
