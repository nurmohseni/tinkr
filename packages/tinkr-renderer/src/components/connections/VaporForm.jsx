import {useEffect, useState} from 'react'
import {useFormContext} from 'react-hook-form'
import {useIntl} from 'react-intl'

import Field from '../Field'
import Section from './Section'
import {listVaporProjects, openPreference, vaporStatus} from '../../utils/api'

/**
 * The teams of the account, with the projects inside them and the environments
 * inside those.
 *
 * All three are read from Laravel Vapor rather than typed, because a project is
 * renamed and an environment is deployed and torn down as often as a branch is
 * pushed. The read is one call — the whole tree in one answer — so the three
 * pickers cannot disagree about what belongs to what.
 *
 * The token is not in this form: it is one for the account, kept in the
 * preferences, and this section only reads whether there is one. Without it the
 * account is not there to be asked, so the section says so and offers the way to
 * the field.
 *
 * @param {Boolean} enabled whether the section is on screen at all
 * @return {{hasToken: Boolean, teams: Array, loading: Boolean, error: Object, refresh: Function}}
 */
const useVapor = enabled => {
  // null until the main process answered: a token that is not known yet is not
  // the same thing as no token, and the notice waits for the answer
  const [status, setStatus] = useState(null)
  const [teams, setTeams] = useState([])
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

    vaporStatus()
      .then(answer => {
        if (!live) {
          return
        }

        const known = answer || {hasToken: false, cliLogin: false}

        setStatus(known)

        if (!known.hasToken) {
          setTeams([])

          return
        }

        return listVaporProjects().then(tree => {
          if (!live) {
            return
          }

          if (tree && tree.ok) {
            setTeams(tree.teams || [])
          } else {
            setError((tree && tree.error) || {message: ''})
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
    if (!enabled || !status || status.hasToken !== false) {
      return undefined
    }

    const onFocus = () => refresh()

    window.addEventListener('focus', onFocus)

    return () => window.removeEventListener('focus', onFocus)
  }, [enabled, status])

  return {
    hasToken: status === null ? null : Boolean(status.hasToken),
    teams,
    loading,
    error,
    refresh,
  }
}

/**
 * The three stops of a Laravel Vapor connection: the team, the project, then the
 * environment a run is sent to.
 *
 * The environment's domain is in its option because that is what the run
 * answers from once it lands: a name alone does not say which address the code
 * is about to be at. The name Vapor gives an environment is the branch it was
 * deployed from, which is why the environment and not the project is the stop
 * that matters.
 *
 * A saved choice the account no longer lists is shown as what it is rather than
 * cleared: the connection is not edited behind the person's back, and a name
 * they chose is theirs to replace. What the form saves is the ids and the names,
 * and the name of the connection when it has none is the project and the
 * environment read as one route.
 */
const VaporForm = () => {
  const intl = useIntl()
  const {watch, setValue} = useFormContext()
  const vapor = watch('is_vapor')

  const {hasToken, teams, loading, error, refresh} = useVapor(Boolean(vapor))

  if (!vapor) {
    return null
  }

  const say = (id, values) => intl.formatMessage({id}, values)

  const teamId = watch('vapor_team_id') || ''
  const projectId = watch('vapor_project_id') || ''
  const projectName = watch('vapor_project_name') || ''
  const environmentId = watch('vapor_environment_id') || ''
  const environmentName = watch('vapor_environment_name') || ''
  const name = String(watch('name') || '')

  // the dialog opens a new connection on the default name, which is a label and
  // not a choice, so a name that is still that one is a name nobody gave
  const unfilled = name.trim() === '' || name.trim() === say('connections.name_default')

  const team = teams.find(one => one.id === teamId)
  const projects = (team && team.projects) || []
  const project = projects.find(one => one.id === projectId)
  const environments = (project && project.environments) || []
  const environment = environments.find(one => one.id === environmentId)

  const settled = !loading && !error

  // a saved choice the account no longer lists: the id is still the connection's
  // and the name is still what was chosen, so both are said rather than dropped.
  // The team keeps no name of its own in the connection, so its id is what there
  // is to say
  const missingTeam = Boolean(teamId) && settled && !team
  const missingProject = Boolean(projectId) && settled && !project
  const missingEnvironment = Boolean(environmentId) && settled && !environment
  const pickingProject = Boolean(hasToken && (team || teamId))
  const pickingEnvironment = Boolean(hasToken && (project || projectId))

  // the name and the address, which is what a run is sent to and answers from
  const environmentLabel = one => [one.name, one.domain].filter(Boolean).join(' · ')

  const chooseTeam = event => {
    const id = event.target.value

    if (id === teamId) {
      return
    }

    setValue('vapor_team_id', id, {shouldDirty: true})

    // a project belongs to one team: the one this form held was the other
    // team's, and neither it nor its environment is this team's to keep
    setValue('vapor_project_id', '', {shouldDirty: true})
    setValue('vapor_project_name', '', {shouldDirty: true})
    setValue('vapor_environment_id', '', {shouldDirty: true})
    setValue('vapor_environment_name', '', {shouldDirty: true})
  }

  const chooseProject = event => {
    const id = event.target.value
    const chosen = projects.find(one => one.id === id)

    if (id === projectId) {
      return
    }

    setValue('vapor_project_id', id, {shouldDirty: true})
    setValue('vapor_project_name', chosen ? chosen.name : '', {shouldDirty: true})

    // an environment is deployed from one project's branch, and it is not this
    // project's to keep
    setValue('vapor_environment_id', '', {shouldDirty: true})
    setValue('vapor_environment_name', '', {shouldDirty: true})
  }

  const chooseEnvironment = event => {
    const id = event.target.value
    const chosen = environments.find(one => one.id === id)
    const branch = chosen ? projectName : ''
    const env = chosen ? chosen.name : ''

    setValue('vapor_environment_id', id, {shouldDirty: true})
    setValue('vapor_environment_name', env, {shouldDirty: true})

    // the name is the route the code takes, and it is only filled when there is
    // none: a name someone typed is theirs
    if (unfilled && branch && env) {
      setValue('name', `${branch} · ${env}`, {shouldDirty: true})
    }
  }

  // the list is read once when the section opens, and a deployed environment is
  // not going to appear while someone waits: this is what asks again. It sits
  // under the last picker on screen, in the controls' column, so it reads as
  // part of the choice it refreshes
  const refreshRow = hasToken && settled && (
    <div className='row'>
      <button
        className='btn btn--ghost btn--sm'
        type='button'
        onClick={refresh}
      >
        {say('connections.vapor_refresh')}
      </button>
    </div>
  )

  return (
    <Section
      id='connection-vapor'
      title={say('connections.section_vapor')}
    >
      {hasToken === false && (
        <Field
          label={say('connections.vapor_token')}
          labelId='connection-vapor-token-label'
        >
          <p className='cfield__note'>
            {say('connections.vapor_token_missing')}
          </p>

          <div className='row'>
            <button
              className='btn btn--secondary btn--sm'
              type='button'
              onClick={() => openPreference('vapor')}
            >
              {say('connections.vapor_open_preferences')}
            </button>
          </div>
        </Field>
      )}

      {hasToken && (
        <Field
          label={say('connections.vapor_team')}
          htmlFor='connection-vapor-team'
        >
          <select
            className='select'
            id='connection-vapor-team'
            value={teamId}
            disabled={loading || teams.length === 0}
            onChange={chooseTeam}
          >
            <option value=''>
              {loading
                ? say('connections.vapor_loading')
                : say('connections.vapor_team_placeholder')}
            </option>

            {missingTeam && (
              <option value={teamId}>
                {say('connections.vapor_missing_option', {name: teamId})}
              </option>
            )}

            {teams.map(one => (
              <option
                key={one.id}
                value={one.id}
              >
                {one.name}
              </option>
            ))}
          </select>

          {missingTeam && (
            <p className='cfield__note'>
              {say('connections.vapor_team_missing', {name: teamId})}
            </p>
          )}

          {settled && !missingTeam && teams.length === 0 && (
            <p className='cfield__note'>
              {say('connections.vapor_no_teams')}
            </p>
          )}

          {error && (
            <>
              <p className='cfield__note'>
                {error.message || say('connections.vapor_failed')}
              </p>

              <div className='row'>
                <button
                  className='btn btn--secondary btn--sm'
                  type='button'
                  onClick={refresh}
                >
                  {say('connections.vapor_retry')}
                </button>
              </div>
            </>
          )}

          {!pickingProject && refreshRow}
        </Field>
      )}

      {pickingProject && (
        <Field
          label={say('connections.vapor_project')}
          htmlFor='connection-vapor-project'
        >
          <select
            className='select'
            id='connection-vapor-project'
            value={projectId}
            disabled={loading || projects.length === 0}
            onChange={chooseProject}
          >
            <option value=''>
              {loading
                ? say('connections.vapor_loading')
                : say('connections.vapor_project_placeholder')}
            </option>

            {missingProject && (
              <option value={projectId}>
                {say('connections.vapor_missing_option', {
                  name: projectName || projectId,
                })}
              </option>
            )}

            {projects.map(one => (
              <option
                key={one.id}
                value={one.id}
              >
                {one.name}
              </option>
            ))}
          </select>

          {missingProject && (
            <p className='cfield__note'>
              {say('connections.vapor_project_missing', {
                name: projectName || projectId,
              })}
            </p>
          )}

          {settled && !missingProject && projects.length === 0 && (
            <p className='cfield__note'>
              {say('connections.vapor_no_projects')}
            </p>
          )}

          {!pickingEnvironment && refreshRow}
        </Field>
      )}

      {pickingEnvironment && (
        <Field
          label={say('connections.vapor_environment')}
          htmlFor='connection-vapor-environment'
        >
          <select
            className='select'
            id='connection-vapor-environment'
            value={environmentId}
            disabled={loading || environments.length === 0}
            onChange={chooseEnvironment}
          >
            <option value=''>
              {loading
                ? say('connections.vapor_loading')
                : say('connections.vapor_environment_placeholder')}
            </option>

            {missingEnvironment && (
              <option value={environmentId}>
                {say('connections.vapor_missing_option', {
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
              {say('connections.vapor_environment_missing', {
                name: environmentName || environmentId,
              })}
            </p>
          )}

          {settled && project && environments.length === 0 && (
            <p className='cfield__note'>
              {say('connections.vapor_no_environments')}
            </p>
          )}

          {refreshRow}
        </Field>
      )}
    </Section>
  )
}

export default VaporForm
