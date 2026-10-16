import {atom} from 'jotai'

/**
 * The documents this window has open, in the order their tabs were opened: the
 * snippets the window has been navigated to, and the unsaved sessions it has
 * started.
 *
 * It is a list of ids and nothing more. What a document holds is the store's —
 * a snippet — or the window's own — a session — and a tab is only the claim that
 * one of them is open here. The list lives here, in a store, rather than in the
 * tab bar's own state, because a tab outlives every navigation: the route names
 * the document on screen, this names the ones behind it, and the two have to be
 * able to disagree.
 */
const openTabsAtom = atom([])

/**
 * A log file's tab is named for the file, in a namespace of its own.
 *
 * A snippet's id and a session's id are nanoids, which are 21 characters of
 * `A-Za-z0-9_-`: neither can ever begin with `log:`, so one list of open tabs
 * holds all three kinds without the kinds being told apart by their order.
 */
const logPrefix = 'log:'

const logTabId = name => `${logPrefix}${name}`

const logTabName = id => (String(id).startsWith(logPrefix) ? String(id).slice(logPrefix.length) : null)

/**
 * The name a log route hands back, decoded.
 *
 * The route is written with the name encoded, and a name that is somehow not
 * decodable is taken as it came rather than throwing a route away.
 */
const decodeLogName = value => {
  try {
    return decodeURIComponent(value)
  } catch (e) {
    return value
  }
}

/**
 * Open a document's tab. A document has one tab, and the tab bar asks for
 * whatever the window is on whenever the route moves, so opening one that is
 * already there does nothing.
 */
const openTabAtom = atom(null, (get, set, id) => {
  if (id && !get(openTabsAtom).includes(id)) {
    set(openTabsAtom, tabs => [...tabs, id])
  }
})

const closeTabAtom = atom(null, (get, set, id) => {
  set(openTabsAtom, tabs => tabs.filter(tab => tab !== id))
})

/**
 * The tab a session has just become: naming a session as a snippet keeps its
 * tab where it was, so the one at that place now names the snippet.
 */
const replaceTabAtom = atom(null, (get, set, {from, to}) => {
  set(openTabsAtom, tabs => {
    if (!tabs.includes(from)) {
      return tabs.includes(to) ? tabs : [...tabs, to]
    }

    return tabs.map(tab => (tab === from ? to : tab))
  })
})

export {
  logTabId,
  logTabName,
  decodeLogName,
  openTabsAtom,
  openTabAtom,
  closeTabAtom,
  replaceTabAtom,
}
