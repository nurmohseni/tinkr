import React from 'react'
import ReactDOM from 'react-dom'
import {IntlProvider} from 'react-intl'
import {createStore, Provider} from 'jotai'
import flatten from 'flat'

import AiPanel from '../AiPanel'
import {aiThreadAtom} from '../../../stores/ai'
import {aiAsk, aiFiles} from '../../../utils/api'
import english from '../../../../../tinkr-main/src/lang/en.json'

// the panel asks about the document the window is on; a test has one
jest.mock('../../../hooks/useDocumentId', () => () => 'session:1')

// the provider and the project's files are the app's, not the panel's: the
// panel is the thing under test
jest.mock('../../../utils/api', () => ({
  ...jest.requireActual('../../../utils/api'),
  aiFiles: jest.fn(),
  aiAsk: jest.fn(),
}))

// the highlighter is the editor's tokenizer, which has no app behind it here;
// the panel draws what it is handed, and a turn with no code draws nothing
jest.mock('../../../utils/aiCodeHighlight', () => ({
  highlightCode: code => String(code).split('\n').map(line => [{text: line, className: ''}]),
}))

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

const files = [
  {qualified: 'App\\Models\\Order', name: 'Order', path: 'app/Models/Order.php'},
  {qualified: 'App\\Models\\Payment', name: 'Payment', path: 'app/Models/Payment.php'},
]

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

/**
 * The store writes and the provider answers on their own turn, so a test waits
 * for the tick rather than for a clock.
 */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

let host = null

const mount = store => {
  host = document.createElement('div')
  document.body.appendChild(host)

  ReactDOM.render(
    <Provider store={store}>
      <IntlProvider locale='en' messages={flatten(english)}>
        <AiPanel/>
      </IntlProvider>
    </Provider>,
    host,
  )

  return host
}

const field = () => host.querySelector('textarea')
const askButton = () => host.querySelector('button[type="submit"]')

// a value typed into the field: React reads the field's own setter, so the
// change is made where the browser makes it
const type = value => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set

  setter.call(field(), value)
  field().dispatchEvent(new Event('input', {bubbles: true}))
}

const press = (key, over = {}) => field().dispatchEvent(
  new KeyboardEvent('keydown', Object.assign({key, bubbles: true}, over)),
)

/**
 * The thread is given a height and a top by hand: a test document lays nothing
 * out, and what is under test is where the panel puts the scroll, not the
 * browser's arithmetic.
 */
const scrollable = (element, height) => {
  const scroll = {top: 0}

  Object.defineProperty(element, 'scrollHeight', {configurable: true, value: height})
  Object.defineProperty(element, 'clientHeight', {configurable: true, value: 300})
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => scroll.top,
    set: value => {
      scroll.top = value
    },
  })

  return scroll
}

beforeEach(() => {
  aiAsk.mockReset()
  aiAsk.mockResolvedValue({answer: 'Here it is.'})
  aiFiles.mockReset()
  aiFiles.mockResolvedValue(files)
})

afterEach(() => {
  if (host) {
    ReactDOM.unmountComponentAtNode(host)
    host.remove()
    host = null
  }
})

describe('asking a question', () => {
  test('enter sends it, and the turn is in the thread before the answer is', async () => {
    mount(createStore())

    type('what does this do?')
    press('Enter')

    // the question is in the thread from the moment it was asked, and the
    // prompt is empty again
    expect(host.querySelectorAll('.ai__turn')).toHaveLength(1)
    expect(field().value).toBe('')
    expect(aiAsk.mock.calls[0][0].prompt).toBe('what does this do?')

    await settle()

    expect(host.querySelector('.ai__turn').textContent).toContain('Here it is.')
  })

  test('shift-enter starts a line rather than sending one', () => {
    mount(createStore())

    type('one line')
    press('Enter', {shiftKey: true})

    expect(aiAsk).not.toHaveBeenCalled()
    expect(host.querySelectorAll('.ai__turn')).toHaveLength(0)
  })

  test('the ask is off until there is something to ask', () => {
    mount(createStore())

    expect(askButton().disabled).toBe(true)

    type('   ')
    expect(askButton().disabled).toBe(true)

    type('why?')
    expect(askButton().disabled).toBe(false)
  })
})

describe('naming a file with @', () => {
  test('the list is the prompt\'s own, and the arrows and enter work it', async () => {
    mount(createStore())

    type('Explain @')
    await settle()

    const list = host.querySelector('[role="listbox"]')
    const options = () => list.querySelectorAll('[role="option"]')

    expect(list).not.toBeNull()
    expect(list.getAttribute('aria-label')).toBe('Reference a project file')
    expect(field().getAttribute('aria-controls')).toBe(list.id)
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[0].id)

    press('ArrowDown')
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[1].id)

    // enter takes the file the list is on rather than sending the question
    press('Enter')
    expect(aiAsk).not.toHaveBeenCalled()
    expect(field().value).toBe('Explain @App\\Models\\Payment ')
    expect(host.querySelector('[role="listbox"]')).toBeNull()
  })

  test('escape puts the list away and leaves the words that were typed', async () => {
    mount(createStore())

    type('Explain @')
    await settle()

    press('Escape')

    expect(host.querySelector('[role="listbox"]')).toBeNull()
    expect(field().value).toBe('Explain @')
  })

  test('a search that matches nothing says so, and is no list', async () => {
    aiFiles.mockResolvedValue([])
    mount(createStore())

    type('@nothing')
    await settle()

    expect(host.querySelector('[role="listbox"]')).toBeNull()
    expect(field().getAttribute('aria-controls')).toBeNull()
    expect(host.textContent).toContain('No file of this project matches that')
  })
})

describe('where the thread is read', () => {
  test('an answer brings the thread to its foot while it is being read there', async () => {
    const store = createStore()

    store.set(aiThreadAtom, [turn()])
    mount(store)

    const scroll = scrollable(host.querySelector('.ai__thread'), 1000)

    store.set(aiThreadAtom, [turn(), turn({id: 2, text: 'second'})])
    await settle()

    expect(scroll.top).toBe(1000)
  })

  test('an answer that lands while the thread is being read above it does not move it', async () => {
    const store = createStore()

    store.set(aiThreadAtom, [turn()])
    mount(store)

    const thread = host.querySelector('.ai__thread')
    const scroll = scrollable(thread, 1000)

    // the reader has gone up into what came before
    scroll.top = 120
    thread.dispatchEvent(new Event('scroll'))

    store.set(aiThreadAtom, [turn(), turn({id: 2, text: 'second'})])
    await settle()

    expect(scroll.top).toBe(120)
  })
})
