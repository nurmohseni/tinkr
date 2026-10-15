import {useAtomValue} from 'jotai'

import SwitchField from './SwitchField'
import FormPrefixField from './FormPrefixField'
import {configAtom} from '../../stores/config'

const LabForm = () => {
  const config = useAtomValue(configAtom)

  return (
    <>
      <SwitchField
        labelId='preference.form_switch'
        descriptionId='preference.form_switch_description'
        configKey='form_switch'
      />
      {config.form_switch && (
        <FormPrefixField/>
      )}
    </>
  )
}

export default LabForm
