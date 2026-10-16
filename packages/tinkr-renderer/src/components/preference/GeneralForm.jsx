import CommandDefaultField from './CommandDefaultField'
import GeneralField from './GeneralField'
import LocaleSelectField from './LocaleSelectField'
import SegmentedField from './SegmentedField'
import SwitchField from './SwitchField'
import ThemeField from './ThemeField'
import {useIntl} from 'react-intl'

const GeneralForm = () => {
  const intl = useIntl()

  return (
  <>
    <LocaleSelectField/>

    <ThemeField/>

    <SegmentedField
      labelId='preference.editor_layout'
      descriptionId='preference.editor_layout_description'
      configKey='editor_layout'
      options={[
        {value: 'side', labelId: 'preference.editor_layout_side'},
        {value: 'stacked', labelId: 'preference.editor_layout_stacked'},
      ]}
    />

    <SegmentedField
      labelId='preference.result_blocks'
      descriptionId='preference.result_blocks_description'
      configKey='result_blocks'
      options={[
        {value: 'all', labelId: 'preference.result_blocks_all'},
        {value: 'last', labelId: 'preference.result_blocks_last'},
      ]}
    />
    <SwitchField
      labelId='preference.confirm_close_session'
      descriptionId='preference.confirm_close_session_description'
      configKey='confirm_close_session'
    />
    <CommandDefaultField/>

    <GeneralField
      label={intl.formatMessage({id: 'preference.log_dir'})}
      description={intl.formatMessage({id: 'preference.log_dir_description'})}
      configKey='log_dir'
      placeholder='storage/logs'
    />
  </>
  )
}

export default GeneralForm
