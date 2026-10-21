import PropTypes from 'prop-types'
import {useFormContext} from 'react-hook-form'
import {useIntl} from 'react-intl'

/**
 * The marks of the five kinds, drawn in the app's one silhouette: a bar cut at
 * the 29° of the return glyphs is a machine that runs PHP, a run of dots is a
 * hop over the network, and brackets around a bar are a container. Each mark is
 * the route itself, read left to right, and each is centred on (14,6).
 *
 * Laravel Cloud is two bars in a step rather than one: a fleet of instances
 * somewhere else, which is what the code runs in there, and no marks for a hop
 * because the app reaches it through the API rather than through a shell.
 */
const MARKS = {
  local: {
    bars: ['M10.2 4.75H19.2L17.8 7.25H8.8Z'],
  },
  container: {
    bars: ['M11.7 4.75H17.7L16.3 7.25H10.3Z'],
    brackets: 'M9 2.5H7.5V9.5H9M19 2.5H20.5V9.5H19',
  },
  ssh: {
    bars: ['M3.2 4.75H9.2L7.8 7.25H1.8Z', 'M20.2 4.75H26.2L24.8 7.25H18.8Z'],
    dots: [12, 14, 16],
  },
  'ssh-container': {
    bars: ['M2.7 4.75H7.7L6.3 7.25H1.3Z', 'M18.7 4.75H23.7L22.3 7.25H17.3Z'],
    dots: [9.3, 11.1, 12.9],
    brackets: 'M16 2.5H14.5V9.5H16M25 2.5H26.5V9.5H25',
  },
  // two machines side by side, the second one shorter: an application and the
  // environment the code is sent to, which is the whole route of this kind
  cloud: {
    bars: ['M6.2 3.5H14.2L12.8 6H4.8Z', 'M6.2 6.9H19.2L17.8 9.4H4.8Z'],
  },
}

const KindMark = ({kind}) => {
  const {bars, dots = [], brackets} = MARKS[kind]

  return (
    <svg
      className='kind__mark'
      width='42'
      height='18'
      viewBox='0 0 28 12'
      aria-hidden='true'
    >
      {bars.map(d => <path key={d} d={d}/>)}
      {dots.map(cx => <circle key={cx} cx={cx} cy='6' r='0.75'/>)}
      {brackets && <path className='kind__bracket' d={brackets}/>}
    </svg>
  )
}

KindMark.propTypes = {
  kind: PropTypes.oneOf(Object.keys(MARKS)).isRequired,
}

/**
 * Where the tinker process runs: on this machine, inside a container, over an
 * SSH tunnel, inside a container that lives on a server reached over SSH, or in
 * an environment of Laravel Cloud.
 *
 * The app keeps two answers, in `is_over_ssh` for ssh and in `container_engine`
 * for a container, and they are not exclusive: a project deployed by a compose
 * file on a server is a container on that server. The rail is one radio group
 * and it sets both answers, so a choice is one state and not a pair of switches
 * — but the state it sets is two fields, which is what keeps a connection saved
 * before containers readable as it was.
 *
 * Laravel Cloud is a third answer, `is_cloud`, and it is a kind of its own
 * because there is no machine and no container the app reaches: the code is
 * sent to an environment over the API. So it clears both of the other answers,
 * and any other kind clears it.
 *
 * A kind that is not chosen clears what it owns: local and ssh clear the
 * container, and the two container kinds keep an engine that is already chosen
 * rather than resetting it to docker under someone who picked podman. What a
 * cloud connection chose — the application and the environment — is kept when
 * another kind is picked: it is inert there, and it is what the rail shows again
 * when the connection is set back to Laravel Cloud.
 */
const ConnectionType = () => {
  const intl = useIntl()
  const {watch, setValue} = useFormContext()

  const [ssh, engine, cloud] = watch(['is_over_ssh', 'container_engine', 'is_cloud'])

  const kind = cloud
    ? 'cloud'
    : ssh
      ? (engine ? 'ssh-container' : 'ssh')
      : (engine ? 'container' : 'local')

  const choose = next => {
    const isCloud = next === 'cloud'
    const overSsh = next === 'ssh' || next === 'ssh-container'
    const inContainer = next === 'container' || next === 'ssh-container'

    setValue('is_cloud', isCloud, {shouldDirty: true})
    setValue('is_over_ssh', overSsh, {shouldDirty: true})

    // the engine a container connection starts on: docker is what most
    // projects ship in, and it is what the fields below are for
    setValue('container_engine', inContainer ? (engine || 'docker') : '', {shouldDirty: true})

    // an in-container path is the container's, and a connection that is no
    // longer in one has no use for it: the project path is the answer then
    if (!inContainer) {
      setValue('container_path', '', {shouldDirty: true})
    }
  }

  const options = [
    ['local', 'where_local'],
    ['container', 'where_container'],
    ['ssh', 'where_ssh'],
    ['ssh-container', 'where_ssh_container'],
    ['cloud', 'where_cloud'],
  ]

  return (
    <div
      className='kinds'
      role='radiogroup'
      aria-labelledby='connection-kinds-title'
    >
      <h3
        id='connection-kinds-title'
        className='kinds__title'
      >
        {intl.formatMessage({id: 'connections.runs_on'})}
      </h3>

      {options.map(([name, message]) => (
        <label
          key={name}
          className='kind'
        >
          <input
            type='radio'
            name='connection-type'
            value={name}
            checked={kind === name}
            aria-labelledby={`connection-kind-${name}`}
            aria-describedby={`connection-kind-${name}-hint`}
            onChange={() => choose(name)}
          />

          <KindMark kind={name}/>

          <span className='kind__text'>
            <span
              id={`connection-kind-${name}`}
              className='kind__name'
            >
              {intl.formatMessage({id: `connections.${message}`})}
            </span>
            <span
              id={`connection-kind-${name}-hint`}
              className='kind__hint'
            >
              {intl.formatMessage({id: `connections.${message}_hint`})}
            </span>
          </span>
        </label>
      ))}
    </div>
  )
}

export default ConnectionType
