import React from 'react'
import ReactDOM from 'react-dom'
import {renderToStaticMarkup} from 'react-dom/server'
import {IntlProvider} from 'react-intl'
import flatten from 'flat'

import Result from '../Result'
import english from '../../../../../tinkr-main/src/lang/en.json'

// the vite build uses the automatic jsx runtime, so the component has no React
// in scope; the transform jest runs here is the classic one
global.React = React

// the pane's words are messages like the rest of the app's, so it is rendered
// inside the same provider the app gives it, with the english the app ships
const render = (result, view, allStatements = false, onKeep = () => {}) => renderToStaticMarkup(
  <IntlProvider locale='en' messages={flatten(english)}>
    <Result result={result} view={view} onView={() => {}} onKeep={onKeep} allStatements={allStatements}/>
  </IntlProvider>,
)

// a reading is offered as a radio in a label, so the switch shows it as the word
// that label ends with
const offers = (markup, reading) => markup.includes(`/>${reading}</label>`)

describe('how long the run took', () => {
  test('a run that returned a value says how long it took', () => {
    const markup = render({value: 42, error: null, output: '', imported: {}, duration: 1350})

    // the note the summary ends with, in the seconds a person thinks in
    expect(markup).toContain('1.4s')
    expect(markup).toContain('It took 1.4 seconds')
  })

  test('a run that threw says it too', () => {
    const markup = render({
      value: null,
      error: {class: 'RuntimeException', message: 'boom'},
      output: '',
      imported: {},
      blocks: [],
      duration: 800,
    })

    expect(markup).toContain('0.8s')
  })

  test('a run with no time to report says nothing rather than 0s', () => {
    const markup = render({value: 1, error: null, output: '', imported: {}})

    expect(markup).not.toContain('result-summary__duration')
  })
})

describe('the result panel', () => {
  test('a run that returned a value says what it aliased', () => {
    const markup = render({
      value: 3,
      error: null,
      output: '',
      imported: {Order: 'App\\Models\\Order', Invoice: 'App\\Models\\Invoice'},
    })

    expect(markup).toContain('imported')
    expect(markup).toContain('Order')
    expect(markup).toContain('App\\Models\\Order')
    expect(markup).toContain('App\\Models\\Invoice')
    expect(markup).toContain('returned')
  })

  test('a run that threw still says what it aliased', () => {
    const markup = render({
      value: null,
      error: {class: 'Error', message: 'Class "Something" not found'},
      output: '',
      imported: {Order: 'App\\Models\\Order'},
    })

    expect(markup).toContain('imported')
    expect(markup).toContain('App\\Models\\Order')
    expect(markup).toContain('threw')
  })

  test('a run that printed still says what it aliased', () => {
    const markup = render({
      value: null,
      error: null,
      output: 'array:1 [\n  0 => "a"\n]',
      imported: {Order: 'App\\Models\\Order'},
    })

    expect(markup).toContain('imported')
    expect(markup).toContain('App\\Models\\Order')
    expect(markup).toContain('array:1')
  })

  test('reads a value as a tree, and as the json it is drawn from', () => {
    const result = {value: {name: 'noor', items: [1, 2]}, error: null, output: '', imported: {}}
    const organized = render(result, 'organized')
    const raw = render(result, 'raw')

    // the tree, node by node
    expect(organized).toContain('tree__row')
    expect(organized).toContain('name')
    // and the text it is drawn from
    expect(organized).not.toContain('&quot;name&quot;')
    expect(raw).not.toContain('tree__row')
    expect(raw).toContain('&quot;name&quot;')
    expect(raw).toContain('noor')
    // both readings are offered, and one of them is on
    expect(organized).toContain('organized')
    expect(organized).toContain('raw')
    expect(raw).toContain('checked=""')
  })

  test('reads a run that only printed as it printed, with nothing to switch to', () => {
    const result = {value: null, error: null, output: 'array:1 [\n  0 => "a"\n]', imported: {}}

    expect(render(result, 'raw')).toContain('array:1')
    expect(render(result, 'raw')).not.toContain('view-switch')
    expect(render(result, 'organized')).toContain('array:1')
  })

  test('reads a run that finished with nothing to show as a finished run, not a failure', () => {
    const markup = render({value: null, error: null, output: '', imported: {}}, 'organized')

    expect(markup).toContain('empty--benign')
    expect(markup).not.toContain('role="alert"')
    expect(markup).not.toContain('error-surface')
  })

  test('reads what a one-statement run printed beside the value it returned', () => {
    // dump() both prints its value and returns it: the print and the value are
    // two facts, and one does not stand for the other
    const result = {
      value: {a: 1},
      error: null,
      output: 'array:1 [\n  "a" => 1\n]',
      imported: {},
    }

    const organized = render(result, 'organized')
    const raw = render(result, 'raw')

    // the print is drawn above the value, whatever reading the value is in
    expect(organized).toContain('array:1 [')
    expect(organized).toContain('tree__row')
    expect(organized.indexOf('array:1 [')).toBeLessThan(organized.indexOf('tree__row'))

    // and it is said once: raw reads the value's own json, not the print again
    expect(raw.match(/array:1 \[/g)).toHaveLength(1)
    expect(raw).toContain('&quot;a&quot;')
    expect(raw).not.toContain('tree__row')
  })

  test('says nothing about a print the run did not make', () => {
    const markup = render({value: {a: 1}, error: null, output: '', imported: {}}, 'organized')

    expect(markup).not.toContain('class="printed"')
  })

  test('reads a value that was not printed raw as the json it is drawn from', () => {
    const result = {value: {a: 1}, error: null, output: '', imported: {}}
    const raw = render(result, 'raw')

    expect(raw).toContain('&quot;a&quot;')
    expect(raw).not.toContain('tree__row')
  })

  test('says nothing when the run aliased nothing', () => {
    expect(render({value: 1, error: null, output: '', imported: {}})).not.toContain('imported')
    expect(render({value: 1, error: null, output: ''})).not.toContain('imported')
  })

  test('reads a list of records as a table: a column per key, a row per record', () => {
    const result = {value: [{id: 1, name: 'Ada'}, {id: 2, name: 'Bob'}], error: null, output: '', imported: {}}

    // the reading is offered by a switch that says which one is showing
    expect(offers(render(result, 'organized'), 'table')).toBe(true)

    const table = render(result, 'table')

    expect(table).toContain('qtable--values')
    expect(table).toContain('scope="col"')
    expect(table).toContain('name')
    expect(table).toContain('Ada')
    expect(table).toContain('Bob')
    expect(table).toContain('2 items')
    expect(table).not.toContain('tree__row')
    // the rows can be copied out, which the tree's rows cannot
    expect(table).toContain('qtable__menu')
  })

  test('reads a value as a graph: a mark per path, joined to what holds it', () => {
    const result = {value: {app: {name: 'Tinkr'}, users: [{id: 1}]}, error: null, output: '', imported: {}}

    expect(offers(render(result, 'organized'), 'graph')).toBe(true)

    const graph = render(result, 'graph')

    expect(graph).toContain('graph__canvas')
    expect(graph).toContain('<circle')
    expect(graph).toContain('graph__edge')
    expect(graph).toContain('users')
    expect(graph).not.toContain('tree__row')
    expect(graph).not.toContain('NaN')
  })

  test('reads a value that is markup as the document it is', () => {
    const result = {value: '<p>hello</p>', error: null, output: '', imported: {}}

    expect(offers(render(result, 'organized'), 'html')).toBe(true)

    const html = render(result, 'html')

    expect(html).toContain('html-view__frame')
    // the document is handed to the frame itself, whole, not read to it
    expect(html).toContain('srcDoc="&lt;!doctype html&gt;')
    // and the frame runs nothing at all: markup from a value can be a payload
    expect(html).toContain('sandbox=""')
    expect(html).not.toContain('allow-scripts')
    expect(html).toContain('title="The rendered document"')
    expect(html).not.toContain('tree__row')
  })

  test('draws the tree where a value has no such reading, never an empty pane', () => {
    const result = {value: 5, error: null, output: 'printed', imported: {}}

    // 5 has no table to show, so asking for one shows 5
    expect(offers(render(result, 'organized'), 'table')).toBe(false)
    expect(render(result, 'table')).toContain('tree__row')
  })

  test('offers the readings of every statement a run made, and reads each of them', () => {
    const result = {
      value: [{id: 1}],
      error: null,
      output: '',
      imported: {},
      blocks: [
        {line: 1, value: [{id: 1}], error: null},
        {line: 2, value: 'printed', error: null},
      ],
    }

    // a run is read as one value unless the app asks for it statement by statement
    expect(render(result, 'table')).not.toContain('2 statements')

    const table = render(result, 'table', true)

    expect(table).toContain('2 statements')
    expect(offers(table, 'table')).toBe(true)
    // the statement that returned records is a table, the one that returned a
    // string keeps its tree
    expect(table).toContain('qtable--values')
    expect(table).toContain('tree__row')
  })
})

// a run of statements, one of which threw: the runs the map and the filter are
// for are the ones whose statements are not read at a glance. A statement's line
// is not its place in the run — one that spans two lines moves the next one down
const many = (count, threwAt = -1) => Array.from({length: count}, (_, index) => (
  index === threwAt
    ? {line: index * 2 + 1, value: null, error: {class: 'RuntimeException', message: 'boom'}}
    : {line: index * 2 + 1, value: index, error: null}
))

// the panel is a tree with a filter in it, which a server render cannot press,
// so what the filter does is read from a document the panel is mounted into
const mount = (result, allStatements = true) => {
  const host = document.createElement('div')

  document.body.appendChild(host)

  const tree = next => (
    <IntlProvider locale='en' messages={flatten(english)}>
      <Result result={next} view='organized' onView={() => {}} allStatements={allStatements}/>
    </IntlProvider>
  )

  ReactDOM.render(tree(result), host)

  return {host, show: next => ReactDOM.render(tree(next), host)}
}

// the panel reads its statements inside the view that scrolls them: the pane
// overflows, and the viewport the app wraps it in hides what overflows there.
// A jump belongs to the pane, so it is measured in one: 400 high over 2000 of
// run, standing 100 below the top of the window
const mountInPane = result => {
  const viewport = document.createElement('div')

  viewport.style.overflow = 'hidden'

  const pane = document.createElement('div')

  pane.style.overflowY = 'auto'
  viewport.appendChild(pane)

  const host = document.createElement('div')

  pane.appendChild(host)
  document.body.appendChild(viewport)

  Object.defineProperty(pane, 'clientHeight', {configurable: true, value: 400})
  Object.defineProperty(pane, 'scrollHeight', {configurable: true, value: 2000})
  pane.getBoundingClientRect = () => ({top: 100, bottom: 500, left: 0, right: 400, width: 400, height: 400})

  ReactDOM.render(
    <IntlProvider locale='en' messages={flatten(english)}>
      <Result result={result} view='organized' onView={() => {}} allStatements/>
    </IntlProvider>,
    host,
  )

  return {host, pane, viewport}
}

describe('a run of many statements', () => {
  const run = blocks => ({value: 5, error: null, output: '', imported: {}, blocks})

  test('numbers every statement, so one can be named and found again', () => {
    const markup = render(run(many(3)), 'organized', true)

    expect(markup.match(/class="block__index"/g)).toHaveLength(3)
    expect(markup).toContain('>#1<')
    expect(markup).toContain('>#3<')
  })

  test('maps the statements of a long run, and only of a long run', () => {
    const long = render(run(many(6)), 'organized', true)
    const short = render(run(many(5)), 'organized', true)

    expect(long).toContain('class="statements-map"')
    expect(long).toContain('aria-label="Statements in this run"')
    expect(long.match(/class="statements-map__chip"/g)).toHaveLength(6)

    // five statements are still read at a glance: no map over them
    expect(short).not.toContain('statements-map')
  })

  test('keeps the run\'s controls and map above what it printed', () => {
    const markup = render(Object.assign(run(many(6)), {output: 'hello'}), 'organized', true)

    // the chrome is the pane's first row, so the run is read from its controls
    // and what it printed is below them rather than above
    expect(markup).toContain('class="run-chrome"')
    expect(markup.indexOf('run-chrome')).toBeLessThan(markup.indexOf('class="printed"'))
    expect(markup.indexOf('statements-map')).toBeLessThan(markup.indexOf('class="printed"'))
    // the run's head and its map share that one pinned row
    expect(markup).toContain('<div class="run-chrome"><div class="result-summary result-summary--head">')
    expect(markup).toContain('</div><div class="statements-map"')
    // and the print's bar goes with its text instead of pinning at the same edge
    expect(markup).toContain('result-summary--scrolls')
  })

  test('offers no copy for a statement that returned nothing', () => {
    const markup = render(run([
      {line: 1, value: null, error: null},
      {line: 2, value: 5, error: null},
    ]), 'organized', true)

    // the statement that answered nothing has nothing to copy; the one that
    // answered 5 copies its value the way a value is copied
    expect(markup.match(/Copy the value as JSON/g)).toHaveLength(1)
  })

  test('copies the exception of a statement that threw', () => {
    const markup = render(run(many(3, 1)), 'organized', true)

    // the statement that threw offers what it ended on, not a value it never
    // answered, and the statements around it still copy theirs
    expect(markup).toContain('title="Copy the exception class and message"')
    expect(markup.match(/Copy the value as JSON/g)).toHaveLength(2)
  })

  test('marks the statement that threw on the map and in its own head', () => {
    const markup = render(run(many(6, 2)), 'organized', true)

    expect(markup).toContain('statements-map__chip--threw')
    expect(markup).toContain('aria-label="3, Line 5, RuntimeException"')
    expect(markup).toContain('block--threw')
    // a run with a failure counts it, and offers to read only those
    expect(markup).toContain('1 statement threw')
    expect(markup).toContain('Failed only')
  })

  test('says nothing of a count where nothing threw', () => {
    const markup = render(run(many(6)), 'organized', true)

    expect(markup).not.toContain('statement threw')
    expect(markup).not.toContain('Failed only')
  })

  test('a key of the map brings its statement in and puts the focus inside it', () => {
    const {host} = mount(run(many(6, 2)))

    // the fifth key leads to the fifth statement, and the statement is where a
    // keyboard reader lands rather than the key that was pressed
    host.querySelectorAll('.statements-map__chip')[4].click()

    expect(document.activeElement).toBe(host.querySelectorAll('.block')[4])

    ReactDOM.unmountComponentAtNode(host)
    host.remove()
  })

  test('a key of the map moves the run\'s own pane, and nothing around it', () => {
    const {host, pane, viewport} = mountInPane(run(many(6)))
    const chrome = host.querySelector('.run-chrome')
    const statement = host.querySelectorAll('.block')[4]
    // `scrollIntoView` walks every scrollable ancestor, which is what took the
    // panel's viewport and the window with the jump: the statement and every
    // box it stands in say whether one was asked for
    const walked = jest.fn()

    for (let node = statement; node && node !== pane; node = node.parentElement) {
      node.scrollIntoView = walked
    }

    // a narrow pane wraps the run's head: the chrome covers 96 of its top, not
    // the 36 the one row of the stylesheet reserves
    chrome.getBoundingClientRect = () => ({
      top: 100, bottom: 196, left: 0, right: 400, width: 400, height: 96,
    })
    pane.scrollTop = 300
    // the fifth statement stands 900 into the run
    statement.getBoundingClientRect = () => ({
      top: 700, bottom: 820, left: 0, right: 400, width: 400, height: 120,
    })

    host.querySelectorAll('.statements-map__chip')[4].click()

    // brought in below all of the chrome, with the room a jump leaves it
    expect(pane.scrollTop).toBe(796)
    // and the panel and the window are exactly where they were
    expect(walked).not.toHaveBeenCalled()
    expect(viewport.scrollTop).toBe(0)
    expect(pane.scrollLeft).toBe(0)

    ReactDOM.unmountComponentAtNode(host)
    host.remove()
  })

  test('a jump near the end of the run stops where the pane stops', () => {
    const {host, pane} = mountInPane(run(many(6)))
    const chrome = host.querySelector('.run-chrome')

    chrome.getBoundingClientRect = () => ({
      top: 100, bottom: 168, left: 0, right: 400, width: 400, height: 68,
    })
    pane.scrollTop = 300
    // the last statement stands 1900 into the run: bringing it in under the
    // chrome would need 1824, and the pane ends at 1600
    host.querySelectorAll('.block')[5].getBoundingClientRect = () => ({
      top: 1700, bottom: 1820, left: 0, right: 400, width: 400, height: 120,
    })

    host.querySelectorAll('.statements-map__chip')[5].click()

    expect(pane.scrollTop).toBe(1600)

    ReactDOM.unmountComponentAtNode(host)
    host.remove()
  })

  test('a jump keeps the pane sideways unless the statement is out of it', () => {
    const {host, pane} = mountInPane(run(many(6)))
    const chips = host.querySelectorAll('.statements-map__chip')
    const blocks = host.querySelectorAll('.block')

    pane.scrollTop = 0
    pane.scrollLeft = 120
    // the statement's head is inside the pane: a wide table is read where it
    // was scrolled to
    blocks[4].getBoundingClientRect = () => ({
      top: 500, bottom: 620, left: 20, right: 420, width: 400, height: 120,
    })

    chips[4].click()

    expect(pane.scrollLeft).toBe(120)

    // scrolled further sideways, the head is out of the pane to the left: the
    // statement comes in from its own edge, never from the middle of a row
    blocks[5].getBoundingClientRect = () => ({
      top: 700, bottom: 820, left: -120, right: 280, width: 400, height: 120,
    })

    chips[5].click()

    expect(pane.scrollLeft).toBe(0)

    ReactDOM.unmountComponentAtNode(host)
    host.remove()
  })

  test('filters the run to the statements that threw, and back', () => {
    const {host} = mount(run(many(6, 4)))
    const filter = () => host.querySelector('.result-summary__actions [aria-pressed]')

    expect(host.querySelectorAll('.block')).toHaveLength(6)
    expect(filter().getAttribute('aria-pressed')).toBe('false')

    filter().click()

    expect(filter().getAttribute('aria-pressed')).toBe('true')
    // one statement shown, and the line it is on is the one that threw
    expect(host.querySelectorAll('.block')).toHaveLength(1)
    expect(host.querySelector('.block__line').textContent).toContain('Line 9')
    // the map lists what is shown: no key leads to a statement that is hidden
    expect(host.querySelectorAll('.statements-map__chip')).toHaveLength(1)

    filter().click()

    expect(host.querySelectorAll('.block')).toHaveLength(6)

    ReactDOM.unmountComponentAtNode(host)
    host.remove()
  })

  test('reads a new run from the top, with the filter the last run set off', () => {
    const {host, show} = mount(run(many(6, 4)))

    host.querySelector('.result-summary__actions [aria-pressed]').click()
    expect(host.querySelectorAll('.block')).toHaveLength(1)

    // the answer is another one, so the filter that belonged to the last is not
    // on it: a run is never read with statements nobody asked it to hide
    show(run(many(6, 2)))

    expect(host.querySelectorAll('.block')).toHaveLength(6)
    expect(host.querySelector('.result-summary__actions [aria-pressed]').getAttribute('aria-pressed')).toBe('false')

    ReactDOM.unmountComponentAtNode(host)
    host.remove()
  })

  test('counts and filters a short run too, without mapping it', () => {
    const markup = render(run(many(3, 1)), 'organized', true)

    expect(markup).toContain('1 statement threw')
    expect(markup).toContain('Failed only')
    expect(markup).not.toContain('statements-map')
  })
})

describe('the transaction guard', () => {
  const transaction = over => Object.assign({
    mode: 'rollback',
    armed: true,
    connection: 'mysql',
    statements: 3,
    outcome: 'rolledBack',
    error: null,
  }, over)

  const reading = over => render(
    {value: null, error: null, output: '', imported: {}, transaction: transaction(over)},
    'organized',
  )

  test('says nothing where no guard was asked for', () => {
    const run = render({value: 3, error: null, output: '', imported: {}}, 'organized')

    expect(run).not.toContain('Rolled back')
    expect(run).not.toContain('Run again and keep')
  })

  test('reads a dry run as a run that was taken back, and offers to keep it', () => {
    const markup = reading()

    expect(markup).toContain('Rolled back 3 statements on mysql')
    // the offer to keep it is on the line that says it was not kept
    expect(markup).toContain('Run again and keep')
    expect(markup).toContain('Run the same code again, this time keeping the transaction')
  })

  test('reads a run that was kept as kept', () => {
    const markup = reading({mode: 'commit', outcome: 'committed'})

    expect(markup).toContain('Committed 3 statements on mysql')
    // there is nothing to run again: what it did was kept
    expect(markup).not.toContain('Run again and keep')
    expect(markup).not.toContain('Rolled back')
  })

  test('counts one statement in the singular, and none as nothing to keep', () => {
    expect(reading({statements: 1})).toContain('Rolled back 1 statement on mysql')
    // a run that sent nothing has nothing the keeping of which could be offered
    expect(reading({statements: 0})).not.toContain('Run again and keep')
  })

  test('reads a transaction that could not be closed as the failure it is', () => {
    const markup = reading({outcome: 'failed', error: 'gone away'})

    expect(markup).toContain('The transaction on mysql could not be closed: gone away')
    expect(markup).not.toContain('Run again and keep')
  })

  test('reads a guard that never armed as a run that did not happen', () => {
    const markup = reading({armed: false, connection: null, statements: 0, outcome: 'failed'})

    expect(markup).toContain('Nothing was run')
    expect(markup).not.toContain('Run again and keep')
  })

  test('every answer offers the whole run as Markdown', () => {
    const returned = render({value: 1, error: null, output: '', imported: {}})
    const threw = render({value: null, error: {class: 'Error', message: 'boom'}, output: '', imported: {}})
    const printed = render({value: null, error: null, output: 'hello', imported: {}})

    expect(returned).toContain('title="Copy as Markdown"')
    expect(threw).toContain('title="Copy as Markdown"')
    expect(printed).toContain('title="Copy as Markdown"')
  })
})
