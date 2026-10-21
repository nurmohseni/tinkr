import {useFormContext} from 'react-hook-form'
import {useIntl} from 'react-intl'
import {useAtomValue} from 'jotai'

import Field from '../Field'
import Section from './Section'
import TagSelector from './TagSelector'
import PathField from './PathField'
import {configAtom} from '../../stores/config'

/**
 * The project, the route's last stop: where it is, the command that starts
 * tinker in it, and the tag that says what kind of data it holds. The name is
 * not here: it is the dialog's title.
 *
 * A Laravel Cloud connection's project is its environment, and the command that
 * runs there is the one the app sends: there is nothing for the command field to
 * say, so it is not shown.
 */
const BasicForm = () => {
  const intl = useIntl()
  const {register, watch} = useFormContext()
  const config = useAtomValue(configAtom)
  const cloud = watch('is_cloud')

  return (
    <Section
      id='connection-project'
      title={intl.formatMessage({id: 'connections.section_project'})}
    >
      <PathField/>

      {/* a container's command is built from what it runs in, so the field only
          shows for a connection that is not one: a command typed here for a
          container would be replaced the moment a container field changed.
          Left empty, it is the default command from the settings, which is
          what the placeholder shows. Laravel Cloud's runs are its own commands
          too, so the field is not there for one */}
      <Field
        label={intl.formatMessage({id: 'connections.command'})}
        htmlFor='connection-command'
        hidden={Boolean(watch('container_engine')) || Boolean(cloud)}
      >
        <input
          className='input input--mono'
          id='connection-command'
          name='command'
          type='text'
          placeholder={config.command_default}
          spellCheck={false}
          autoComplete='off'
          {...register('command')}
        />
      </Field>

      <Field
        label={intl.formatMessage({id: 'connections.tag'})}
        labelId='connection-tag-label'
      >
        <TagSelector/>
      </Field>
    </Section>
  )
}

export default BasicForm
