import {defaultTheme} from 'evergreen-ui'

import {termOptions, termTheme} from '../getTermOptions'
import {uiTheme} from '../uiTheme'

/**
 * The palette the consumers read is the one in tinkr.css, and what turns its
 * oklch() into the hex they paint with is a canvas in the app and this
 * conversion in the test. The real token file is read, so a name a consumer
 * asks for that the palette does not declare is a failure and not an undefined
 * colour, and `data-theme` picks the block exactly as it does at runtime.
 *
 * The factory is hoisted above these imports and only the name it calls is
 * allowed to cross that boundary, so the reading lives in the `mockPalette`
 * declaration the hoist is given by name.
 */
jest.mock('../cssColor', () => mockPalette())

function mockPalette() {
  const fs = require('fs')
  const path = require('path')

  const css = fs.readFileSync(path.join(__dirname, '../../../public/tinkr.css'), 'utf8')

  const block = selector => {
    const lines = css.split('\n')
    const start = lines.findIndex(line => line.startsWith(selector))
    const declared = {}

    for (const line of lines.slice(start + 1)) {
      if (line.startsWith('}')) {
        break
      }

      const match = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?);/)

      if (match) {
        declared[match[1]] = match[2]
      }
    }

    return declared
  }

  // the light block only re-declares what differs, so it is read on top of the
  // dark one
  const dark = block(':root')
  const tokens = {dark, light: Object.assign({}, dark, block('[data-theme="light"]'))}

  const srgb = channel => {
    const value = Math.min(1, Math.max(0, channel))

    return value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055
  }

  const byte = channel => Math.round(channel * 255).toString(16).padStart(2, '0')

  const fromOklch = (lightness, chroma, hue, alpha = 1) => {
    const a = chroma * Math.cos(hue * Math.PI / 180)
    const b = chroma * Math.sin(hue * Math.PI / 180)
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
    const channels = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ]

    return `#${channels.map(channel => byte(srgb(channel))).join('')}${alpha < 1 ? byte(alpha) : ''}`
  }

  const active = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')

  const declared = name => {
    const value = tokens[active()][name]

    if (value === undefined) {
      throw new Error(`tinkr.css declares no ${name} for the ${active()} theme`)
    }

    return value
  }

  return {
    token: declared,
    colour: name => {
      const value = declared(name)
      const oklch = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/)

      if (oklch) {
        return fromOklch(...oklch.slice(1).map(Number))
      }

      if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) {
        throw new Error(`${name} is not a literal colour: ${value}`)
      }

      return value
    },
  }
}

const MODES = ['dark', 'light']

const ANSI = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta',
  'brightCyan', 'brightWhite',
]

const channel = value => {
  const c = parseInt(value, 16) / 255

  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

const luminance = hex => {
  const clean = hex.slice(1)

  return 0.2126 * channel(clean.slice(0, 2)) +
    0.7152 * channel(clean.slice(2, 4)) +
    0.0722 * channel(clean.slice(4, 6))
}

const contrast = (a, b) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)

  return (lighter + 0.05) / (darker + 0.05)
}

const rgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16))

// the theme's tints carry alpha, and an alert's background is what the pane
// under it makes of them, so an alpha colour is composited before it is read
const over = (color, surface) => {
  const alpha = color.length === 9 ? parseInt(color.slice(7, 9), 16) / 255 : 1

  return `#${rgb(color).map((value, index) => Math.round(value * alpha + rgb(surface)[index] * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`
}

const themeOf = mode => {
  document.documentElement.dataset.theme = mode

  return uiTheme(mode)
}

// jest names the pair that fell under the floor when the assertion is an object
const expectReadable = pairs => Object.entries(pairs).forEach(([what, ratio]) => {
  expect([what, ratio >= 4.5]).toEqual([what, true])
})

describe('the interface theme', () => {
  test('should build both modes from the palette', () => {
    const dark = themeOf('dark')
    const light = themeOf('light')

    ;[dark.colors.white, dark.colors.tint1, dark.colors.tint2].forEach(surface => {
      expect(luminance(surface)).toBeLessThan(0.1)
    })

    expect(luminance(dark.colors.default)).toBeGreaterThan(0.6)

    ;[light.colors.white, light.colors.tint1, light.colors.tint2].forEach(surface => {
      expect(luminance(surface)).toBeGreaterThan(0.8)
    })

    expect(luminance(light.colors.default)).toBeLessThan(0.1)
    expect(dark.colors.white).not.toBe(light.colors.white)
    expect(dark.colors.default).not.toBe(light.colors.default)
    expect(dark.colors.selected).not.toBe(light.colors.selected)
  })

  test('should keep every ink readable on the surface it is allowed on', () => {
    MODES.forEach(mode => {
      const theme = themeOf(mode)
      const primary = theme.components.Button.appearances.primary

      expectReadable({
        [`${mode}: the body copy on the raised pane`]: contrast(theme.colors.default, theme.colors.white),
        [`${mode}: the body copy on the desk`]: contrast(theme.colors.default, theme.colors.tint1),
        [`${mode}: the body copy on the floor`]: contrast(theme.colors.default, theme.colors.tint2),
        [`${mode}: the secondary copy on the raised pane`]: contrast(theme.colors.muted, theme.colors.white),
        [`${mode}: the secondary copy on the desk`]: contrast(theme.colors.muted, theme.colors.tint1),
        [`${mode}: the secondary copy on the floor`]: contrast(theme.colors.muted, theme.colors.tint2),
        [`${mode}: the meta ink on the floor`]: contrast(theme.colors.icon.muted, theme.colors.tint2),
        [`${mode}: the value ink on the raised pane`]: contrast(theme.colors.selected, theme.colors.white),
        [`${mode}: the run button's ink on its fill`]: contrast(primary.color, primary.backgroundColor),
        [`${mode}: the danger notice`]: contrast(theme.intents.danger.text, over(theme.intents.danger.background, theme.colors.white)),
        [`${mode}: the warning notice`]: contrast(theme.intents.warning.text, over(theme.intents.warning.background, theme.colors.white)),
        [`${mode}: the success notice`]: contrast(theme.intents.success.text, over(theme.intents.success.background, theme.colors.white)),
        [`${mode}: the terminal's ink on its paper`]: contrast(termTheme().foreground, termTheme().background),
      })
    })
  })

  test('should keep the meaning of the intent colours', () => {
    MODES.forEach(mode => {
      const theme = themeOf(mode)
      const [successRed, successGreen] = rgb(theme.intents.success.border)
      const [dangerRed, dangerGreen] = rgb(theme.intents.danger.border)
      const [warningRed, , warningBlue] = rgb(theme.intents.warning.border)

      expect(successGreen).toBeGreaterThan(successRed)
      expect(dangerRed).toBeGreaterThan(dangerGreen)
      expect(warningRed).toBeGreaterThan(warningBlue)
      // info and success are both the value channel: tinkr has nothing to say
      // with a second colour
      expect(theme.intents.info.border).toBe(theme.colors.selected)
      expect(theme.intents.success.border).toBe(theme.colors.selected)
      expect(theme.intents.danger.icon).toBe(theme.colors.text.danger)
    })
  })

  test('should turn evergreen scales around for the dark mode only', () => {
    const dark = themeOf('dark')
    const light = themeOf('light')

    expect(dark.colors.gray50).toBe(defaultTheme.colors.gray900)
    expect(dark.colors.gray900).toBe(defaultTheme.colors.gray50)
    expect(dark.colors.blue25).toBe(defaultTheme.colors.blue900)

    // the light mode is evergreen's own scales, with only the names the
    // palette has a token for replaced
    expect(light.colors.gray50).toBe(defaultTheme.colors.gray50)
    expect(light.colors.gray900).toBe(defaultTheme.colors.gray900)
    expect(light.colors.white).not.toBe(defaultTheme.colors.white)
  })

  test('should point the component surfaces at the palette', () => {
    MODES.forEach(mode => {
      const theme = themeOf(mode)
      const leftovers = []
      const walk = (value, key) => {
        if (Array.isArray(value)) {
          value.forEach(item => walk(item, key))
          return
        }

        if (value && typeof value === 'object') {
          Object.keys(value).forEach(inner => walk(value[inner], inner))
          return
        }

        if (value === 'white' && ['base', 'background', 'backgroundColor'].includes(key)) {
          leftovers.push(key)
        }
      }

      walk(theme.components, null)

      // evergreen's component styles paint the surface with a literal white
      expect(leftovers).toEqual([])
      expect(theme.components.TableRow.appearances.default.backgroundColor).toBe(theme.colors.white)
      expect(theme.components.TableRow.appearances.default.selectors._hover.backgroundColor).toBe(theme.colors.tint1)
      expect(theme.components.TableRow.appearances.default.selectors._current.backgroundColor).toBe(theme.colors.blueTint)
      // a tooltip lifts in both modes, so its bubble is the raised surface and
      // its ink is the palette's, not the literal white evergreen paints on it
      expect(theme.components.Tooltip.appearances.default.backgroundColor).toBe(theme.colors.white)
      expect(theme.components.Tooltip.appearances.default.color).toBe(theme.colors.default)
      // the selected tab is the palette's, not evergreen's blue pill
      expect(theme.components.Tab.appearances.secondary.selectors._current.backgroundColor).toBe(theme.colors.white)
      expect(theme.components.Tab.appearances.secondary.selectors._current.color).toBe(theme.colors.selected)
    })
  })

  test('should keep the badges readable', () => {
    MODES.forEach(mode => {
      const theme = themeOf(mode)
      const ratios = {}

      Object.entries(theme.fills).forEach(([key, fill]) => {
        expect(fill.backgroundColor).toBe(theme.colors[`${key}Tint`] || theme.colors.tint2)
        ratios[`${mode}: the ${key} badge`] = contrast(fill.color, over(fill.backgroundColor, theme.colors.white))
      })

      expectReadable(ratios)
    })
  })

  test('should give the terminal the palette and the mono face', () => {
    MODES.forEach(mode => {
      const theme = themeOf(mode)
      const term = termTheme()

      expect(Object.keys(term)).toEqual(expect.arrayContaining(ANSI))
      expect(term.foreground).toBe(theme.colors.default)
      // the terminal's paper is the mode's well, the darkest and the lightest
      // surface either way
      expect(luminance(term.background) < 0.1).toBe(mode === 'dark')
      expect(term.background).not.toBe(term.foreground)
      // xterm 6's own keys: the old `selection` is ignored, and the unfocused
      // selection is a key of its own
      expect(term.selectionBackground).toBeTruthy()
      expect(term.selectionInactiveBackground).toBe(term.selectionBackground)

      // the 16 are designed rather than defaulted: each still reads as its name
      const [redRed, redGreen] = rgb(term.red)
      const [greenRed, greenGreen] = rgb(term.green)
      const [blueRed, blueGreen, blueBlue] = rgb(term.blue)

      expect(redRed).toBeGreaterThan(redGreen)
      expect(greenGreen).toBeGreaterThan(greenRed)
      expect(blueBlue).toBeGreaterThan(blueRed)
      expect(blueBlue).toBeGreaterThan(blueGreen)
    })

    const options = termOptions()

    // neither terminal had a family before, so both fell back to courier
    expect(options.fontFamily).toContain('Commit Mono')
    // laravel prints fg=white;bg=red and fg=black;bg=yellow labels
    expect(options.minimumContrastRatio).toBe(4.5)
    expect(options.lineHeight).toBe(1.2)
    expect(options.theme).toEqual(termTheme())
  })
})
