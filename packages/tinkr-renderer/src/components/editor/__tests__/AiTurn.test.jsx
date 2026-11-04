import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {IntlProvider} from 'react-intl'
import flatten from 'flat'

import AiTurn from '../AiTurn'
import english from '../../../../../tinkr-main/src/lang/en.json'

// the highlighter is the editor's tokenizer, which a server render has no app
// behind it to register; what it hands back is the same shape, and that shape is
// what the turn draws
jest.mock('../../../utils/aiCodeHighlight', () => ({
  highlightCode: code => String(code).split('\n').map(line => [{text: line, className: 'c-keyword'}]),
}))

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

const turn = (over = {}) => Object.assign({
  id: 1,
  prompt: 'why is it slow?',
  answer: '',
  text: '',
  code: null,
  asking: false,
  resolution: null,
  failed: false,
}, over)

const render = (over, handlers = {}) => renderToStaticMarkup(
  <IntlProvider locale='en' messages={flatten(english)}>
    <AiTurn
      turn={turn(over)}
      onApply={handlers.onApply || (() => {})}
      onDiscard={handlers.onDiscard || (() => {})}
    />
  </IntlProvider>,
)

describe('a turn in the thread', () => {
  test('the question is what was said, and the answer has not come yet', () => {
    const markup = render({asking: true})

    expect(markup).toContain('why is it slow?')
    expect(markup).toContain('asking…')
    expect(markup).not.toContain('<pre')
  })

  test('an answer reads as a paragraph, and the code it proposes is code', () => {
    const markup = render({text: 'Here it is.', code: '1 + 1;'})

    expect(markup).toContain('<p>Here it is.</p>')
    expect(markup).toContain('class="printed ai__code-pre"')
    expect(markup).toContain('<span class="c-keyword">1 + 1;</span>')
    expect(markup).toContain('Apply to the editor')
    expect(markup).toContain('Discard')
  })

  test('the lines of a snippet are kept as they were written', () => {
    const markup = render({text: 'two lines', code: '$a = 1;\n$b = 2;'})

    // one break between the two lines, and none carried after the last
    expect(markup).toContain('$a = 1;</span>\n<span class="c-keyword">$b = 2;</span></pre>')
  })

  test('a list and the marks in a sentence are read, and the words are not', () => {
    const markup = render({text: 'First **bold** and `$a`.\n\n- one\n- two'})

    expect(markup).toContain('<strong>bold</strong>')
    expect(markup).toContain('<code>$a</code>')
    expect(markup).toContain('<ul><li>one</li><li>two</li></ul>')
  })

  test('a code word inside weight is code, in weight', () => {
    const markup = render({text: '**`$a`** is the total'})

    expect(markup).toContain('<strong><code>$a</code></strong> is the total')
  })

  test('an answer that talks about markup shows markup', () => {
    const markup = render({text: '<script>alert(1)</script>'})

    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(markup).not.toContain('<script>')
  })

  test('code that contains markup is words in the well', () => {
    const markup = render({text: 'html', code: '<div>'})

    expect(markup).toContain('&lt;div&gt;')
    expect(markup).not.toContain('<div>')
  })

  test('an answer that never came is the panel saying so, not a proposal', () => {
    const markup = render({text: 'the provider did not answer', failed: true})

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('class="ai__prose ai__text error"')
    expect(markup).not.toContain('<pre')
  })

  test('a proposal that was taken says so, and offers nothing more to take', () => {
    const markup = render({text: 'Here it is.', code: '1 + 1;', resolution: 'applied'})

    expect(markup).toContain('applied to the editor')
    expect(markup).not.toContain('Apply to the editor')
    expect(markup).not.toContain('Discard')
  })

  test('a proposal that was put aside says that instead', () => {
    const markup = render({text: 'Here it is.', code: '1 + 1;', resolution: 'discarded'})

    expect(markup).toContain('discarded')
    expect(markup).not.toContain('Apply to the editor')
  })
})
