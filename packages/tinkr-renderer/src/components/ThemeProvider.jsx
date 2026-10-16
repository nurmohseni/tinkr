import {useLayoutEffect, useState} from 'react'
import PropTypes from 'prop-types'
import {ThemeProvider as UIThemeProvider} from 'evergreen-ui'
import {useAtomValue} from 'jotai'

import {configAtom} from '../stores/config'
import {uiTheme} from '../utils/uiTheme'

// the config predates the palette: `dark` is the dark interface and every other
// value — `default`, the `classic` an old setting may still hold, the design's
// own `light` — is the light one, which is how the preference's switch reads it
const ThemeProvider = ({children}) => {
  const config = useAtomValue(configAtom)
  const mode = config.theme === 'dark' ? 'dark' : 'light'
  const [theme, setTheme] = useState(() => {
    // tinkr.css carries both palettes under the same token names and the
    // attribute is what picks one; it goes on <html> so the frame around the
    // panes, and not only the panes, is themed
    document.documentElement.dataset.theme = mode

    return uiTheme(mode)
  })

  // evergreen reads the tokens while rendering, and setting the attribute in a
  // layout effect puts it on the document before the re-render that draws the
  // new mode, so no frame is painted in the mode that was left
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = mode
    setTheme(uiTheme(mode))
  }, [mode])

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
