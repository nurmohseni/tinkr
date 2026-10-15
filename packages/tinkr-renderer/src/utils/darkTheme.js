import {defaultTheme} from 'evergreen-ui'

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

/**
 * A dark theme for evergreen, which does not ship one.
 *
 * `white` is the surface key in evergreen (a pane is `background='white'`), so
 * pointing it and the two tints at dark values is what turns the app, rather
 * than editing every pane. The colours are a warm neutral rather than the
 * blue-black every dark app defaults to, and the semantic colours keep their
 * meaning (green stays success, red stays danger), just light enough to read.
 *
 * @param {Object} light
 * @return {Object}
 */
// the scales reverse into light values at the high numbers, but a very light
// red or yellow is not text, so the semantic colours are picked by hand and
// used for both the text keys and the intents
const accent = {
  info: '#8fb0ff',
  success: '#7fd6a8',
  warning: '#e8c07d',
  danger: '#ff9b9b',
}

// the component styles in the light theme paint their surface with the literal
// colour `white` (button, table-row, input, select, ...), which the colour keys
// cannot reach, so every background among them is pointed at the dark surface
const isBackground = key => key === 'background' || key === 'backgroundColor' || key === 'base'

const darkComponents = (value, key, surface) => {
  if (Array.isArray(value)) {
    return value.map(item => darkComponents(item, key, surface))
  }

  if (value && typeof value === 'object') {
    return Object.keys(value).reduce((all, inner) => {
      all[inner] = darkComponents(value[inner], inner, surface)
      return all
    }, {})
  }

  return value === 'white' && isBackground(key) ? surface : value
}

// what a badge (and anything else reading theme.fills) puts behind its text:
// the light theme's fills are pastel boxes, so each one becomes the dark tint
// of its colour with that colour's text
const fillAccent = {
  green: '#7fd6a8',
  blue: '#8fb0ff',
  red: '#ff9b9b',
  orange: '#e8c07d',
  yellow: '#e8c07d',
  teal: '#7fd6d6',
  purple: '#d9a3ff',
}

const darkFills = (fills, colors) => Object.keys(fills || {}).reduce((all, key) => {
  all[key] = {
    backgroundColor: colors[`${key}Tint`] || colors.tint2,
    color: fillAccent[key] || colors.muted,
  }
  return all
}, {})

const darkTheme = (light = defaultTheme) => {
  const colors = Object.assign({}, light.colors, reversed(light.colors), {
    white: '#1b1c20',
    tint1: '#202127',
    tint2: '#25262c',
    default: '#e9e7e4',
    dark: '#ffffff',
    muted: '#a09e9a',
    selected: '#8fb0ff',
    overlay: 'rgba(10, 10, 12, 0.75)',
    border: {default: '#3a3b42', muted: '#303139'},
    icon: {default: '#a09e9a', muted: '#7c7a77', disabled: '#4b4c52', selected: '#8fb0ff'},
    text: {danger: accent.danger, success: accent.success, info: accent.info},
    blueTint: '#1f2940',
    greenTint: '#1d2a24',
    redTint: '#2b2022',
    orangeTint: '#2c2519',
    yellowTint: '#2b2718',
    tealTint: '#172a2b',
    purpleTint: '#251f2e',
  })

  // the table row paints its surface from a literal 'white' inside a closure,
  // which the components walk cannot rewrite, so its states are replaced
  const tableRow = Object.assign({}, light.components.TableRow, {
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

  // the tooltip bubble is evergreen's `colors.gray800`, which the reversal
  // turns light, so it is painted with the raised dark surface instead; the
  // override starts from the walked components, so the rest stays as they are
  const components = darkComponents(light.components, null, colors.white)
  const tooltip = Object.assign({}, components.Tooltip, {
    appearances: Object.assign({}, components.Tooltip.appearances, {
      default: Object.assign({}, components.Tooltip.appearances.default, {
        backgroundColor: colors.tint2,
      }),
    }),
  })

  // the selected tab paints a filled pill from `colors.blue50`, and the walk
  // only rewrites the literal `white`, so the states are replaced instead
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
            backgroundColor: colors.tint2,
            color: colors.selected,
          }),
        }),
      }),
    }),
  })

  return Object.assign({}, light, {
    colors,
    fills: darkFills(light.fills, colors),
    components: Object.assign({}, components, {TableRow: tableRow, Tooltip: tooltip, Tab: tab}),
    intents: {
      info: {background: colors.blueTint, border: accent.info, text: accent.info, icon: accent.info},
      success: {background: colors.greenTint, border: accent.success, text: accent.success, icon: accent.success},
      warning: {background: colors.yellowTint, border: accent.warning, text: accent.warning, icon: accent.warning},
      danger: {background: colors.redTint, border: accent.danger, text: accent.danger, icon: accent.danger},
    },
  })
}

export default darkTheme()
