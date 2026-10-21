import PropTypes from 'prop-types'
import {Controller, useFormContext} from 'react-hook-form'
import {useIntl} from 'react-intl'

/**
 * The marks of the four kinds, drawn in the app's one silhouette: a bar cut at
 * the 29° of the return glyphs is a machine that runs PHP, a run of dots is a
 * hop over the network, and brackets around a bar are a container. Each mark is
 * the route itself, read left to right, and each is centred on (14,6).
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
 * SSH tunnel, or inside a container that lives on a server reached over SSH.
 *
 * The app keeps two answers, in `is_over_ssh` for ssh and in `container_engine`
 * for a container, and they are not exclusive: a project deployed by a compose
 * file on a server is a container on that server. The rail is one radio group
 * and it sets both answers, so a choice is one state and not a pair of switches
 * — but the state it sets is two fields, which is what keeps a connection saved
 * before containers readable as it was.
 *
 * A kind that is not chosen clears what it owns: local and ssh clear the
 * container, and the two container kinds keep an engine that is already chosen
 * rather than resetting it to docker under someone who picked podman.
 */
const ConnectionType = () => {
  const intl = useIntl()
  const {control, setValue} = useFormContext()

  return (
    <Controller
      name='is_over_ssh'
      control={control}
      defaultValue={false}
      render={({field: {value, onChange}}) => {
        const engine = control._formValues.container_engine
        const kind = value
          ? (engine ? 'ssh-container' : 'ssh')
          : (engine ? 'container' : 'local')

        const choose = next => {
          const overSsh = next === 'ssh' || next === 'ssh-container'
          const inContainer = next === 'container' || next === 'ssh-container'

          onChange(overSsh)

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
      }}
    />
  )
}

export default ConnectionType
