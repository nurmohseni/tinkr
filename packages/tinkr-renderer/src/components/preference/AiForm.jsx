import {useState} from 'react'
import {useIntl} from 'react-intl'
import {useAtomValue} from 'jotai'

import AiProviderField from './AiProviderField'
import AiDelayField from './AiDelayField'
import GeneralField from './GeneralField'
import SwitchField from './SwitchField'
import {configAtom} from '../../stores/config'
import {aiCheck, aiProviders} from '../../utils/api'

/**
 * The AI section: the provider, and the three values that override its
 * defaults, then the round trip that proves the credentials work.
 */
const AiForm = () => {
  const intl = useIntl()
  const config = useAtomValue(configAtom)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')

  const preset = aiProviders()[config.ai_provider] || {}

  const handleCheck = async () => {
    setChecking(true)
    setMessage('')

    try {
      const {provider, model, answer} = await aiCheck()

      setMessage(intl.formatMessage({id: 'preference.ai_check_ok'}, {provider, model, answer}))
    } catch (e) {
      setMessage(e.message)
    }

    setChecking(false)
  }

  return (
    <>
      <SwitchField
        labelId='preference.ai_autocomplete'
        descriptionId='preference.ai_autocomplete_description'
        configKey='ai_autocomplete'
      />

      <AiProviderField/>

      <GeneralField
        label={intl.formatMessage({id: 'preference.ai_endpoint'})}
        description={intl.formatMessage({id: 'preference.ai_endpoint_description'})}
        configKey='ai_endpoint'
        placeholder={preset.endpoint}
      />

      <GeneralField
        label={intl.formatMessage({id: 'preference.ai_token'})}
        description={intl.formatMessage({id: 'preference.ai_token_description'})}
        configKey='ai_token'
        type='password'
      />

      <GeneralField
        label={intl.formatMessage({id: 'preference.ai_model'})}
        description={intl.formatMessage({id: 'preference.ai_model_description'})}
        configKey='ai_model'
      />

      <AiDelayField/>

      <div className='setting'>
        <div>
          <div className='setting__label'>
            {intl.formatMessage({id: 'preference.ai_check'})}
          </div>
          {message !== '' && (
            <div className='setting__desc'>{message}</div>
          )}
        </div>

        <div className='setting__control'>
          <button
            className='btn btn--secondary'
            type='button'
            disabled={checking}
            aria-busy={checking}
            onClick={handleCheck}
          >
            {intl.formatMessage({id: 'preference.ai_check'})}
          </button>
        </div>
      </div>
    </>
  )
}

export default AiForm
