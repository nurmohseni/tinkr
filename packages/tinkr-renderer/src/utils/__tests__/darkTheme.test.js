import {defaultTheme} from 'evergreen-ui'

import dark from '../darkTheme'
import {getTermOptions} from '../getTermOptions'

const channel = value => {
  const c = parseInt(value, 16) / 255

  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

const luminance = hex => {
  const clean = hex.replace('#', '')

  return 0.2126 * channel(clean.slice(0, 2)) +
    0.7152 * channel(clean.slice(2, 4)) +
    0.0722 * channel(clean.slice(4, 6))
}

const contrast = (a, b) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)

  return (lighter + 0.05) / (darker + 0.05)
}

const rgb = hex => {
  const clean = hex.replace('#', '')

  return [0, 2, 4].map(index => parseInt(clean.slice(index, index + 2), 16))
}

describe('test the dark theme', () => {
  test('should turn the light scales around', () => {
    expect(dark.colors.gray50).toBe(defaultTheme.colors.gray900)
    expect(dark.colors.gray900).toBe(defaultTheme.colors.gray50)
    expect(dark.colors.blue25).toBe(defaultTheme.colors.blue900)
    expect(dark.colors.red25).toBe(defaultTheme.colors.red700)
  })

  test('should put light text on dark surfaces', () => {
    [dark.colors.white, dark.colors.tint1, dark.colors.tint2].forEach(surface => {
      expect(luminance(surface)).toBeLessThan(0.1)
    })

    expect(luminance(dark.colors.default)).toBeGreaterThan(0.6)
  })

  test('should keep the text readable on the surfaces', () => {
    const pairs = [
      [dark.colors.default, dark.colors.white],
      [dark.colors.muted, dark.colors.white],
      [dark.colors.muted, dark.colors.tint1],
      [dark.colors.muted, dark.colors.tint2],
      [dark.colors.selected, dark.colors.white],
      [dark.intents.info.text, dark.intents.info.background],
      [dark.intents.success.text, dark.intents.success.background],
      [dark.intents.warning.text, dark.intents.warning.background],
      [dark.intents.danger.text, dark.intents.danger.background],
      [getTermOptions('dark').theme.foreground, getTermOptions('dark').theme.background],
    ]

    pairs.forEach(([text, background]) => {
      expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5)
    })
  })

  test('should keep the meaning of the intent colours', () => {
    const [successR, successG] = rgb(dark.intents.success.text)
    const [dangerR, dangerG] = rgb(dark.intents.danger.text)
    const [infoR, infoB] = [rgb(dark.intents.info.text)[0], rgb(dark.intents.info.text)[2]]

    expect(successG).toBeGreaterThan(successR)
    expect(dangerR).toBeGreaterThan(dangerG)
    expect(infoB).toBeGreaterThan(infoR)
  })

  test('should point the component surfaces at the dark ones', () => {
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

    walk(dark.components, null)

    // evergreen's own component styles paint the surface with a literal white
    expect(leftovers).toEqual([])
    expect(dark.components.TableRow.appearances.default.backgroundColor).toBe(dark.colors.white)
    expect(dark.components.TableRow.appearances.default.selectors._hover.backgroundColor).toBe(dark.colors.tint1)
    // the tooltip bubble is the grey it reverses into a light one, so it has to
    // be repainted rather than left to the walk
    expect(luminance(dark.components.Tooltip.appearances.default.backgroundColor)).toBeLessThan(0.2)
  })

  test('should keep the badges readable', () => {
    Object.entries(dark.fills).forEach(([key, fill]) => {
      expect(fill.backgroundColor).toBe(dark.colors[`${key}Tint`] || dark.colors.tint2)
      expect(luminance(fill.backgroundColor)).toBeLessThan(0.2)
      expect(contrast(fill.color, fill.backgroundColor)).toBeGreaterThanOrEqual(4.5)
    })
  })

  test('should not leave a light theme behind', () => {
    expect(dark.colors.white).not.toBe(defaultTheme.colors.white)
    expect(dark.colors.default).not.toBe(defaultTheme.colors.default)
  })
})
