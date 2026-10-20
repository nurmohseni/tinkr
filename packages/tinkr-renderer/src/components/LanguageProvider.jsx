import {useEffect, useState} from 'react'
import PropTypes from 'prop-types'
import {IntlProvider} from 'react-intl'
import {useAtomValue} from 'jotai'

import Loading from './Loading'
import {getIntlConfig, onSetIntlConfig} from '../utils/api'
import {configAtom} from '../stores/config'

/**
 * The messages the app speaks, as the main process holds them.
 *
 * A window asks for them and the answer arrives as an event — that is the one
 * way they come — so switching the language is a new ask: the config the window
 * reads tells it the locale changed, and the request is what brings the messages
 * of that locale with it.
 */
const LanguageProvider = ({children}) => {
  const [intlConfig, setIntlConfig] = useState({})
  const config = useAtomValue(configAtom)

  useEffect(() => {
    // the listener goes on first: the answer is an event, and an answer that
    // arrives before anyone is listening is a window that stays on Loading
    const onSet = onSetIntlConfig(setIntlConfig)

    getIntlConfig()

    return () => {
      onSet.dispose()
    }
  }, [])

  useEffect(() => {
    if (config.locale) {
      getIntlConfig()
    }
  }, [config.locale])

  if (!intlConfig.locale) {
    return <Loading/>
  }

  return (
    <IntlProvider
      locale={intlConfig.locale}
      messages={intlConfig.messages}
    >
      {children}
    </IntlProvider>
  )
}

LanguageProvider.propTypes = {
  children: PropTypes.element.isRequired,
}

export default LanguageProvider
