import {atom} from 'jotai'

import {aiAsk} from '../utils/api'
import {parseAnswer} from '../utils/aiAnswer'
import {documentAtomWithId} from './sessions'

/**
 * What the window has asked the provider for, and what came back.
 *
 * It lives in the window, like a session's code does, and is not written to the
 * connection: a thread is about the code in front of you, and it goes when the
 * window does.
 */
const aiThreadAtom = atom([])

/** Whether an ask is in flight, which is what holds the prompt still. */
const aiAskingAtom = atom(false)

/**
 * What an ask carries besides the prompt.
 *
 * The code in front of you is what the panel is for, and the answer the last run
 * gave is what a question like "help me debug this" is about, so both go with
 * every ask until the panel is told otherwise. The switches that say so sit under
 * the prompt, and they are about this window's conversation rather than about the
 * app: neither is a preference.
 *
 * What the run answered is handed in by the panel rather than read here: the panel
 * is the one that has it in front of it, and a thread does not otherwise know what
 * the editor last ran.
 */
const aiContextAtom = atom({code: true, output: true})

const toggleAiContextAtom = atom(null, (get, set, what) => {
  set(aiContextAtom, context => Object.assign({}, context, {[what]: !context[what]}))
})

/**
 * How many times the panel has been asked for its prompt.
 *
 * It is a count rather than a flag, so that the shortcut opens the prompt every
 * time it is pressed and not only the first.
 */
const aiFocusAtom = atom(0)

/** What makes one turn the turn a late answer belongs to. */
let asked = 0

/**
 * Ask the provider about the code of a document.
 *
 * The code is read at the moment of asking rather than at the moment the panel
 * rendered, and the turns before this one go with it, so `now make it a select`
 * is read against what was answered before it. A turn that failed is left out of
 * that history: an error message is nothing to answer a question against.
 */
const askAiAtom = atom(null, async (get, set, {documentId, prompt, output}) => {
  const id = ++asked
  const context = get(aiContextAtom)
  const code = context.code ? get(documentAtomWithId(documentId))?.code || '' : ''
  // both are read at the moment of asking: the run in front of you when the
  // question was written is the run the question is about
  const history = get(aiThreadAtom)
    .filter(turn => !turn.failed)
    .flatMap(({prompt: question, answer}) => [
      {role: 'user', content: question},
      {role: 'assistant', content: answer},
    ])

  const replace = turn => thread => thread.map(
    (at, index) => (at.id === id ? Object.assign({}, at, turn) : at),
  )

  // the ask goes in the thread before the provider is asked: it is what was
  // said, and waiting for the answer to show it would take it away from the
  // moment it was made
  set(aiThreadAtom, thread => [...thread, {
    id,
    prompt,
    answer: '',
    text: '',
    code: null,
    asking: true,
    resolution: null,
  }])

  set(aiAskingAtom, true)

  try {
    const {answer} = await aiAsk({prompt, code, history, output: context.output ? output : null})

    set(aiThreadAtom, replace(Object.assign({answer, asking: false}, parseAnswer(answer))))
  } catch (e) {
    set(aiThreadAtom, replace({answer: e.message, text: e.message, failed: true, asking: false}))
  }

  set(aiAskingAtom, false)
})

/**
 * Say what became of a proposal: applied to the editor, or put aside.
 */
const resolveTurnAtom = atom(null, (get, set, {id, resolution}) => {
  set(aiThreadAtom, thread => thread.map(
    turn => (turn.id === id ? Object.assign({}, turn, {resolution}) : turn),
  ))
})

export {
  aiThreadAtom,
  aiAskingAtom,
  aiContextAtom,
  toggleAiContextAtom,
  aiFocusAtom,
  askAiAtom,
  resolveTurnAtom,
}
