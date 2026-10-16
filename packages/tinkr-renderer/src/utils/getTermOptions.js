/**
 * What a terminal prints with.
 *
 * There is no second palette here: the 16 ANSI colours, the paper and the ink
 * are the design's own `--ansi-*`, `--panel-inset` and `--text` tokens, so a
 * program that prints in red prints in tinkr's vermilion. Both terminals in the
 * app are built from `termOptions()`, and both are re-themed by
 * `watchTermTheme` when `data-theme` changes, because xterm paints itself.
 */

import {colour, token} from './cssColor'

const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
const bright = name => `bright${name[0].toUpperCase()}${name.slice(1)}`

/**
 * The terminal's palette for the mode `data-theme` selects.
 *
 * @return {Object}
 */
export const termTheme = () => ({
  foreground: colour('--text'),
  background: colour('--panel-inset'),
  cursor: colour('--accent'),
  cursorAccent: colour('--panel-inset'),
  // xterm 6 renamed the selection colour, and paints the unfocused selection
  // from a key of its own
  selectionBackground: colour('--selection'),
  selectionInactiveBackground: colour('--selection'),
  ...Object.fromEntries(NAMES.flatMap(name => [
    [name, colour(`--ansi-${name}`)],
    [bright(name), colour(`--ansi-bright-${name}`)],
  ])),
})

/**
 * The options both terminals are opened with.
 *
 * @return {Object}
 */
export const termOptions = () => ({
  cursorStyle: 'bar',
  // without a family xterm falls back to courier, which has neither the mono
  // face's advance width nor its weight
  fontFamily: token('--font-mono'),
  lineHeight: 1.2,
  // the frame a program prints in is not tinkr's to choose: laravel prints its
  // labels as fg=white;bg=red and fg=black;bg=yellow, which are unreadable on
  // the design's paper without a floor under the contrast
  minimumContrastRatio: 4.5,
  theme: termTheme(),
})

/**
 * Point a terminal at the palette, and at it again whenever the theme changes.
 *
 * @param {Terminal} term
 * @param {Function} transform the theme as this terminal needs it
 * @return {Function} dispose the watcher
 */
export const watchTermTheme = (term, transform = theme => theme) => {
  const apply = () => {
    term.options.theme = transform(termTheme())
  }

  const observer = new window.MutationObserver(apply)

  observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']})

  // the mono face arrives after the options were read, and until it does the
  // terminal measures its cells in a fallback
  document.fonts.ready.then(() => {
    term.options.fontFamily = token('--font-mono')
  })

  return () => observer.disconnect()
}
