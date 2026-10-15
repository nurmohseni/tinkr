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
  openTabsAtom,
  openTabAtom,
  closeTabAtom,
  replaceTabAtom,
}
