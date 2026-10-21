import {useEffect, useState} from 'react'
import {useFormContext} from 'react-hook-form'
import {useIntl} from 'react-intl'

import Field from '../Field'
import Section from './Section'
import {cloudStatus, listCloudApplications, openPreference} from '../../utils/api'

// the states an environment can be in, as the words the section says them in.
// A state the app does not know is shown as the API spelled it rather than as a
// message the app does not have.
const STATUSES = {
  running: 'connections.cloud_status_running',
  hibernating: 'connections.cloud_status_hibernating',
  stopped: 'connections.cloud_status_stopped',
}

/**
 * The applications of the account, and the environments inside them.
 *
 * Both are read from Laravel Cloud rather than typed, because neither is stable:
 * an application is renamed, and an environment is created and destroyed on
 * every branch. The read is one call — the applications with their environments
 * included — so the two pickers come from one answer and cannot disagree.
 *
 * The token is not in this form: it is one for the account, kept in the
 * preferences, and this section only reads whether there is one. Without it the
 * account is not there to be asked, so the section says so and offers the way to
 * the field.
 *
 * @param {Boolean} enabled whether the section is on screen at all
 * @return {{hasToken: Boolean, applications: Array, loading: Boolean, error: Object, refresh: Function}}
 */
const useCloud = enabled => {
  // null until the main process answered: a token that is not known yet is not
  // the same thing as no token, and the notice waits for the answer
  const [hasToken, setHasToken] = useState(null)
  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [asked, setAsked] = useState(0)

  const refresh = () => setAsked(count => count + 1)

  useEffect(() => {
    let live = true

    if (!enabled) {
      return () => { live = false }
    }

    setLoading(true)
    setError(null)

    cloudStatus()
      .then(status => {
        if (!live) {
          return
        }

        const has = Boolean(status && status.hasToken)

        setHasToken(has)

        if (!has) {
          setApplications([])

          return
        }

        return listCloudApplications().then(answer => {
          if (!live) {
            return
          }

          if (answer && answer.ok) {
            setApplications(answer.applications || [])
          } else {
            setError((answer && answer.error) || {message: ''})
          }
        })
      })
      // a main process that could not answer is an account the app cannot
      // reach, which is what the error row says with its retry
      .catch(e => { if (live) { setError({message: e.message}) } })
      .finally(() => { if (live) { setLoading(false) } })

    return () => { live = false }
  }, [enabled, asked])

  // a token is saved in another window, so this one has no way of hearing about
  // it: what it can notice is coming back to itself, which is the moment the
  // person who saved one looks at the form again
  useEffect(() => {
    if (!enabled || hasToken !== false) {
      return undefined
    }

    const onFocus = () => refresh()

    window.addEventListener('focus', onFocus)

    return () => window.removeEventListener('focus', onFocus)
  }, [enabled, hasToken])

  return {hasToken, applications, loading, error, refresh}
}

/**
 * The two stops of a Laravel Cloud connection: the application, then the
 * environment the code is sent to.
 *
 * The environment's state and PHP version are in its option, because the
 * environment an app is about to be pointed at is the thing worth knowing: a
 * hibernating one answers its first command slowly, and the PHP version is what
 * the code in the editor has to run on. A hibernating or stopped environment is
 * still choosable — the API boots it when a command arrives.
 *
 * A saved environment that the account no longer has is shown as what it is
 * rather than cleared: the connection is not edited behind the person's back,
 * and a name they chose is theirs to replace. What the form saves is the ids and
 * the names, and the name of the connection when it has none is the two read as
 * one route.
 */
const CloudForm = () => {
  const intl = useIntl()
  const {watch, setValue} = useFormContext()
  const cloud = watch('is_cloud')

  const {hasToken, applications, loading, error, refresh} = useCloud(Boolean(cloud))

  if (!cloud) {
    return null
  }

  const say = (id, values) => intl.formatMessage({id}, values)

  const applicationId = watch('cloud_application_id') || ''
  const applicationName = watch('cloud_application_name') || ''
  const environmentId = watch('cloud_environment_id') || ''
  const environmentName = watch('cloud_environment_name') || ''
  const name = String(watch('name') || '')

  // the dialog opens a new connection on the default name, which is a label and
  // not a choice, so a name that is still that one is a name nobody gave
  const unfilled = name.trim() === '' || name.trim() === say('connections.name_default')

  const application = applications.find(one => one.id === applicationId)
  const environments = (application && application.environments) || []
  const environment = environments.find(one => one.id === environmentId)

  const statusWord = one => (STATUSES[one]
    ? say(STATUSES[one])
    : String(one || '').trim())

  const environmentLabel = one => [
    one.name,
    statusWord(one.status),
    one.phpVersion ? `PHP ${one.phpVersion}` : '',
  ].filter(Boolean).join(' · ')

  const chooseApplication = event => {
    const id = event.target.value
    const chosen = applications.find(one => one.id === id)

    if (id === applicationId) {
      return
    }

    setValue('cloud_application_id', id, {shouldDirty: true})
    setValue('cloud_application_name', chosen ? chosen.name : '', {shouldDirty: true})

    // an environment belongs to one application: the one this form held was the
    // other application's, and it is not this one's to keep
    setValue('cloud_environment_id', '', {shouldDirty: true})
    setValue('cloud_environment_name', '', {shouldDirty: true})
  }

  const chooseEnvironment = event => {
    const id = event.target.value
    const chosen = environments.find(one => one.id === id)
    const app = chosen ? applicationName : ''
    const env = chosen ? chosen.name : ''

    setValue('cloud_environment_id', id, {shouldDirty: true})
    setValue('cloud_environment_name', env, {shouldDirty: true})

    // the name is the route the code takes, and it is only filled when there is
    // none: a name someone typed is theirs
    if (unfilled && app && env) {
      setValue('name', `${app} · ${env}`, {shouldDirty: true})
    }
  }

  // a saved choice the account no longer lists: the id is still the connection's
  // and the name is still what was chosen, so both are said rather than dropped
  const missingApplication = Boolean(applicationId) && !loading && !error && !application
  const missingEnvironment = Boolean(environmentId) && !environment && !loading && !error
  const pickingEnvironment = Boolean(hasToken && (application || environmentId))

  // the list is read once when the section opens, and a deployed environment or
  // a new application is not going to appear while someone waits: this is what
  // asks again. It sits under the last picker on screen, in the controls'
  // column, so it reads as part of the choice it refreshes
  const refreshRow = hasToken && !loading && !error && (
    <div className='row'>
      <button
        className='btn btn--ghost btn--sm'
        type='button'
        onClick={refresh}
      >
        {say('connections.cloud_refresh')}
      </button>
    </div>
  )

  return (
    <Section
      id='connection-cloud'
      title={say('connections.section_cloud')}
    >
      {hasToken === false && (
        <Field
          label={say('connections.cloud_token')}
          labelId='connection-cloud-token-label'
        >
          <p className='cfield__note'>
            {say('connections.cloud_token_missing')}
          </p>

          <div className='row'>
            <button
              className='btn btn--secondary btn--sm'
              type='button'
              onClick={() => openPreference('cloud')}
            >
              {say('connections.cloud_open_preferences')}
            </button>
          </div>
        </Field>
      )}

      {hasToken && (
        <Field
          label={say('connections.cloud_application')}
          htmlFor='connection-cloud-application'
        >
          <select
            className='select'
            id='connection-cloud-application'
            value={applicationId}
            disabled={loading || applications.length === 0}
            onChange={chooseApplication}
          >
            <option value=''>
              {loading
                ? say('connections.cloud_loading')
                : say('connections.cloud_application_placeholder')}
            </option>

            {missingApplication && (
              <option value={applicationId}>
                {say('connections.cloud_missing_option', {
                  name: applicationName || applicationId,
                })}
              </option>
            )}

            {applications.map(one => (
              <option
                key={one.id}
                value={one.id}
              >
                {one.name}
              </option>
            ))}
          </select>

          {missingApplication && (
            <p className='cfield__note'>
              {say('connections.cloud_application_missing', {
                name: applicationName || applicationId,
              })}
            </p>
          )}

          {!loading && !error && !missingApplication && applications.length === 0 && (
            <p className='cfield__note'>
              {say('connections.cloud_no_applications')}
            </p>
          )}

          {error && (
            <>
              <p className='cfield__note'>
                {error.message || say('connections.cloud_failed')}
              </p>

              <div className='row'>
                <button
                  className='btn btn--secondary btn--sm'
                  type='button'
                  onClick={refresh}
                >
                  {say('connections.cloud_retry')}
                </button>
              </div>
            </>
          )}

          {!pickingEnvironment && refreshRow}
        </Field>
      )}

      {pickingEnvironment && (
        <Field
          label={say('connections.cloud_environment')}
          htmlFor='connection-cloud-environment'
        >
          <select
            className='select'
            id='connection-cloud-environment'
            value={environmentId}
            disabled={loading || environments.length === 0}
            onChange={chooseEnvironment}
          >
            <option value=''>
              {loading
                ? say('connections.cloud_loading')
                : say('connections.cloud_environment_placeholder')}
            </option>

            {missingEnvironment && (
              <option value={environmentId}>
                {say('connections.cloud_missing_option', {
                  name: environmentName || environmentId,
                })}
              </option>
            )}

            {environments.map(one => (
              <option
                key={one.id}
                value={one.id}
              >
                {environmentLabel(one)}
              </option>
            ))}
          </select>

          {missingEnvironment && (
            <p className='cfield__note'>
              {say('connections.cloud_environment_missing', {
                name: environmentName || environmentId,
              })}
            </p>
          )}

          {!loading && application && environments.length === 0 && (
            <p className='cfield__note'>
              {say('connections.cloud_no_environments')}
            </p>
          )}

          {refreshRow}
        </Field>
      )}
    </Section>
  )
}

export default CloudForm
