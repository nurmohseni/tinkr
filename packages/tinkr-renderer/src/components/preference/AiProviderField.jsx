import {useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'

import {configAtom, setConfigAtom} from '../../stores/config'
import {aiProviders} from '../../utils/api'

const AiProviderField = () => {
  const intl = useIntl()
  const config = useAtomValue(configAtom)
  const setConfig = useSetAtom(setConfigAtom)

  const label = intl.formatMessage({id: 'preference.ai_provider'})

  const handleChange = e => {
    setConfig({
      ai_provider: e.target.value,
      // the endpoint of the chosen provider is what the default points at, so
      // an override meant for another one does not carry over
      ai_endpoint: '',
    })
  }

  return (
    <div className='setting'>
      <div>
        <div className='setting__label'>{label}</div>
        <div className='setting__desc'>
          {intl.formatMessage({id: 'preference.ai_provider_description'})}
        </div>
      </div>

      <div className='setting__control'>
        <select
          className='select'
          value={config.ai_provider}
          aria-label={label}
          onChange={handleChange}
        >
          {Object.entries(aiProviders()).map(([key, provider]) => (
            <option
              key={`ai_providers_${key}`}
              value={key}
            >
              {provider.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export default AiProviderField
