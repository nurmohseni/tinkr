import CommandDefaultField from './CommandDefaultField'
import SwitchField from './SwitchField'
import ThemeField from './ThemeField'

const GeneralForm = () => (
  <>
    <ThemeField/>
    <SwitchField
      labelId='preference.confirm_close_session'
      descriptionId='preference.confirm_close_session_description'
      configKey='confirm_close_session'
    />
    <CommandDefaultField/>
  </>
)

export default GeneralForm
