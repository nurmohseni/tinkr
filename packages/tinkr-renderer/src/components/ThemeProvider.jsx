import {useEffect} from 'react'
import PropTypes from 'prop-types'
import {ThemeProvider as UIThemeProvider, defaultTheme} from 'evergreen-ui'
import {useAtomValue} from 'jotai'

import {configAtom} from '../stores/config'
import darkTheme from '../utils/darkTheme'

// evergreen 7 dropped the classic theme, so a setting saved as classic lands
// on the default one
const themes = {
  default: defaultTheme,
  classic: defaultTheme,
  dark: darkTheme,
}

const ThemeProvider = ({children}) => {
  const config = useAtomValue(configAtom)
  const theme = themes[config.theme] || defaultTheme
  const isDark = config.theme === 'dark'

  // tinkr.css carries both palettes under the same token names, and the
  // attribute is what picks one; it goes on <html> so the frame around the
  // panes, and not only the panes, is themed. evergreen has no light/dark
  // switch of its own, so the dark theme is only dark where it is chosen.
  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
  }, [isDark])

  return (
    <UIThemeProvider
      value={theme}
    >
      {children}
    </UIThemeProvider>
  )
}

ThemeProvider.propTypes = {
  children: PropTypes.any.isRequired,
}

export default ThemeProvider
