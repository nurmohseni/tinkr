import {Controller, useFormContext} from 'react-hook-form'

/**
 * Where the tinker process runs: on this machine, or over an SSH tunnel. The
 * app stores one boolean, so the control is the design's segmented pair rather
 * than the three tabs the design sheet draws (the app has no container mode).
 */
const ConnectionType = () => {
  const {control} = useFormContext()

  return (
    <Controller
      name='is_over_ssh'
      control={control}
      defaultValue={false}
      render={({
        field: {value, onChange},
      }) => (
        <div className='segmented segmented--fill'>
          <label className='segmented__item'>
            <input
              type='radio'
              name='connection-type'
              checked={!value}
              onChange={() => onChange(false)}
            />
            local
          </label>

          <label className='segmented__item'>
            <input
              type='radio'
              name='connection-type'
              checked={value}
              onChange={() => onChange(true)}
            />
            ssh
          </label>
        </div>
      )}
    />
  )
}

export default ConnectionType
