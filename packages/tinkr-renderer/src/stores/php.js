import {atom} from 'jotai'

/**
 * What the connection answered about php: `checking` while the question is out,
 * `found` with the version it gave, or `missing` when it gave none at all.
 *
 * `dismissed` is the window's answer to the warning — a reader who has seen it
 * and would rather run tinker anyway. Every new answer clears it, because a
 * different connection is a different question.
 */
const phpVersionAtom = atom({status: 'checking', version: null, dismissed: false})

const phpVersionAnsweredAtom = atom(null, (get, set, {version}) => {
  set(phpVersionAtom, {status: version ? 'found' : 'missing', version, dismissed: false})
})

const dismissPhpWarningAtom = atom(null, (get, set) => {
  set(phpVersionAtom, state => ({...state, dismissed: true}))
})

export {
  phpVersionAtom,
  phpVersionAnsweredAtom,
  dismissPhpWarningAtom,
}
