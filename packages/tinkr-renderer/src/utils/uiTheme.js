/**
 * The interface theme for evergreen, in either mode of the palette.
 *
 * evergreen has one theme and no light or dark: a pane asks for `white`, a
 * form's chrome for `tint1`, a heading for `default`, and the theme is what
 * those names mean. So the palette is handed over by pointing those names at
 * the design's tokens, which is also why the connection dialog stops being the
 * one screen in tinkr's own blue.
 *
 * Every value is read when `uiTheme` is called, after `data-theme` is on
 * <html>, so a token resolves in the mode being switched to.
 */

import {defaultTheme} from 'evergreen-ui'

import {colour, token} from './cssColor'

const hues = ['gray', 'blue', 'red', 'green', 'orange', 'purple', 'teal', 'yellow']

const step = key => parseInt(key.replace(/^\D+/, ''), 10)

/**
 * Turn every colour scale around, so the key the app already uses for a light
 * surface (blue100, red100) becomes the dark one and the key it uses for an
 * accent (blue600) stays an accent of the same weight.
 *
 * @param {Object} colors
 * @return {Object}
 */
const reversed = colors => hues.reduce((all, hue) => {
  const keys = Object.keys(colors)
    .filter(key => key.startsWith(hue) && !key.endsWith('Tint'))
    .sort((a, b) => step(a) - step(b))

  const values = keys.map(key => colors[key]).reverse()

  return keys.reduce((acc, key, index) => Object.assign(acc, {[key]: values[index]}), all)
}, {})

// what a badge (and anything else reading theme.fills) writes its text in: the
// colour the fill means, taken from the palette's own ink for it
const fillAccents = () => ({
  neutral: colour('--text-muted'),
  blue: colour('--accent'),
  green: colour('--accent'),
  teal: colour('--accent'),
  purple: colour('--accent'),
  red: colour('--error'),
  orange: colour('--warning'),
  yellow: colour('--warning'),
})

// evergreen's component styles paint their surface with the literal colour
// `white` (button, table-row, input, select, ...), which the colour keys cannot
// reach, so every background among them is pointed at the raised surface
const isBackground = key => key === 'background' || key === 'backgroundColor' || key === 'base'

const themedComponents = (value, key, surface) => {
  if (Array.isArray(value)) {
    return value.map(item => themedComponents(item, key, surface))
  }

  if (value && typeof value === 'object') {
    return Object.keys(value).reduce((all, inner) => {
      all[inner] = themedComponents(value[inner], inner, surface)
      return all
    }, {})
  }

  return value === 'white' && isBackground(key) ? surface : value
}

/**
 * The badges and tags: the default fills are pastel boxes, so each one becomes
 * the palette's tint of the colour it means, with that colour's own text.
 *
 * @param {Object} colors
 * @return {Object}
 */
const fills = colors => {
  const accents = fillAccents()

  return Object.keys(defaultTheme.fills).reduce((all, key) => {
    all[key] = {
      // `neutral` has no tint of its own; a chip on the paper is a step off it
      backgroundColor: colors[`${key}Tint`] || colors.tint2,
      color: accents[key] || colors.muted,
    }

    return all
  }, {})
}

/**
 * @param {String} mode 'dark' or 'light'
 * @return {Object}
 */
export const uiTheme = (mode = 'dark') => {
  const colors = Object.assign(
    {},
    defaultTheme.colors,
    // the light mode is evergreen's own scales; only the dark one has to turn
    // them around
    mode === 'light' ? {} : reversed(defaultTheme.colors),
    {
      white: colour('--panel-raised'),
      tint1: colour('--panel'),
      tint2: colour('--bg'),
      default: colour('--text'),
      dark: colour('--text'),
      muted: colour('--text-muted'),
      selected: colour('--accent'),
      overlay: colour('--overlay'),
      border: {default: colour('--field-edge'), muted: colour('--border')},
      icon: {
        default: colour('--text-muted'),
        muted: colour('--text-faint'),
        disabled: colour('--border-strong'),
        selected: colour('--accent'),
      },
      text: {danger: colour('--error'), success: colour('--success'), info: colour('--accent')},
      blueTint: colour('--primary-soft'),
      greenTint: colour('--primary-soft'),
      tealTint: colour('--primary-soft'),
      purpleTint: colour('--primary-soft'),
      redTint: colour('--error-soft'),
      orangeTint: colour('--warning-soft'),
      yellowTint: colour('--warning-soft'),
    },
  )

  const components = themedComponents(defaultTheme.components, null, colors.white)

  // the table row paints its surface from a literal 'white' inside a closure,
  // which the components walk cannot rewrite, so its states are replaced
  const tableRow = Object.assign({}, components.TableRow, {
    appearances: {
      default: {
        backgroundColor: colors.white,
        selectors: {
          _hover: {backgroundColor: colors.tint1},
          _focus: {backgroundColor: colors.tint1},
          _active: {backgroundColor: colors.blueTint},
          _current: {backgroundColor: colors.blueTint},
        },
      },
    },
  })

  // a tooltip is a floating layer in both modes: it takes the raised surface
  // and the ink that reads on it, where evergreen's own bubble is a grey the
  // dark scales would turn pale
  const tooltip = Object.assign({}, components.Tooltip, {
    appearances: Object.assign({}, components.Tooltip.appearances, {
      default: Object.assign({}, components.Tooltip.appearances.default, {
        backgroundColor: colors.white,
        color: colors.default,
      }),
    }),
  })

  // the selected tab paints a filled pill from evergreen's own blue, and the
  // walk only rewrites the literal `white`, so the states are replaced instead
  const tab = Object.assign({}, components.Tab, {
    appearances: Object.assign({}, components.Tab.appearances, {
      secondary: Object.assign({}, components.Tab.appearances.secondary, {
        selectors: Object.assign({}, components.Tab.appearances.secondary.selectors, {
          _hover: Object.assign({}, components.Tab.appearances.secondary.selectors._hover, {
            backgroundColor: colors.tint1,
            color: colors.default,
          }),
          _active: Object.assign({}, components.Tab.appearances.secondary.selectors._active, {
            backgroundColor: colors.tint1,
          }),
          _current: Object.assign({}, components.Tab.appearances.secondary.selectors._current, {
            backgroundColor: colors.white,
            color: colors.selected,
          }),
        }),
      }),
    }),
  })

  // evergreen's primary button is computed from its blue scales, and the design
  // has one green: the fill is the value channel's own, with the ink designed
  // to sit on it
  const button = Object.assign({}, components.Button, {
    appearances: Object.assign({}, components.Button.appearances, {
      primary: {
        backgroundColor: colour('--primary'),
        borderColor: colour('--primary'),
        color: colour('--primary-ink'),
        selectors: {
          _hover: {backgroundColor: colour('--primary-2'), borderColor: colour('--primary-2')},
          _active: {backgroundColor: colour('--primary-2'), borderColor: colour('--primary-2')},
          _focus: {backgroundColor: colour('--primary'), borderColor: colour('--primary')},
        },
      },
    }),
  })

  return Object.assign({}, defaultTheme, {
    colors,
    fontFamilies: {
      ui: token('--font-ui'),
      display: token('--font-display'),
      mono: token('--font-mono'),
    },
    fills: fills(colors),
    components: Object.assign({}, components, {TableRow: tableRow, Tooltip: tooltip, Tab: tab, Button: button}),
    intents: {
      info: {
        background: colour('--accent-soft'),
        border: colour('--accent'),
        text: colour('--text'),
        icon: colour('--accent'),
      },
      success: {
        background: colour('--accent-soft'),
        border: colour('--accent'),
        text: colour('--text'),
        icon: colour('--accent'),
      },
      warning: {
        background: colour('--warning-soft'),
        border: colour('--warning'),
        text: colour('--text'),
        icon: colour('--warning'),
      },
      danger: {
        background: colour('--error-soft'),
        border: colour('--error'),
        text: colour('--text'),
        icon: colour('--error'),
      },
    },
  })
}
