import {atom} from 'jotai'

/**
 * What the connection answered about php: `checking` while the question is out,
 * `found` with the version it gave, `missing` when it gave none at all, or
 * `unknown` when the connection runs through an API that does not say: there is
 * no php here to be missing, so nothing is warned about and nothing is shown.
 *
 * `dismissed` is the window's answer to the warning — a reader who has seen it
 * and would rather run tinker anyway. Every new answer clears it, because a
 * different connection is a different question.
 */
const phpVersionAtom = atom({status: 'checking', version: null, dismissed: false})

const phpVersionAnsweredAtom = atom(null, (get, set, {version, unknown = false}) => {
  const status = version ? 'found' : (unknown ? 'unknown' : 'missing')

  set(phpVersionAtom, {status, version: version || null, dismissed: false})
})

const dismissPhpWarningAtom = atom(null, (get, set) => {
  set(phpVersionAtom, state => ({...state, dismissed: true}))
})

export {
  phpVersionAtom,
  phpVersionAnsweredAtom,
  dismissPhpWarningAtom,
}
