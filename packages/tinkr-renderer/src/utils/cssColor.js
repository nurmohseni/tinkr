/**
 * One resolver for the design's tokens.
 *
 * The consumers that paint themselves — monaco, xterm, evergreen — cannot read
 * an oklch() token, and tinkr.css declares the whole palette that way, so every
 * value they need is resolved here through a 1px canvas: the browser does the
 * colour conversion, and what comes back is the sRGB the rest of the app
 * paints.
 *
 * Nothing here is cached: a token resolves in whichever mode `data-theme`
 * selects, so the consumers re-read their palette when that attribute changes.
 */

const canvas = document.createElement('canvas')
canvas.width = canvas.height = 1
const ctx = canvas.getContext('2d', {willReadFrequently: true})
const byte = n => n.toString(16).padStart(2, '0')

/**
 * A token's declared value — a colour, a font stack, a length.
 *
 * @param {String} name
 * @return {String}
 */
export const token = name =>
  window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/**
 * Any css colour — oklch(), hex, rgb(), a token tinted with alpha — as the hex
 * monaco and xterm parse.
 *
 * @param {String} value
 * @return {String|undefined} #rrggbb or #rrggbbaa; undefined when unset
 */
export const toHex = value => {
  if (!value) {
    return undefined
  }

  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = 'rgba(0, 0, 0, 0)'
  ctx.fillStyle = value
  ctx.fillRect(0, 0, 1, 1)

  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data

  if (a === 0) {
    return undefined
  }

  return `#${byte(r)}${byte(g)}${byte(b)}${a < 255 ? byte(a) : ''}`
}

/**
 * A token as the hex a painting consumer uses, or undefined when the palette
 * does not declare it — a missing colour is left out of a theme rather than
 * guessed at.
 *
 * @param {String} name
 * @return {String|undefined}
 */
export const colour = name => toHex(token(name))
