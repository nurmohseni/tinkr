import {useIntl} from 'react-intl'

import ShortcutField from './ShortcutField'

const ShortcutAiField = () => {
  const intl = useIntl()

  return (
    <ShortcutField
      label={intl.formatMessage({id: 'preference.shortcut_ai'})}
      description={intl.formatMessage({id: 'preference.shortcut_ai_description'})}
      configKey='shortcut_ai'
    />
  )
}

export default ShortcutAiField
