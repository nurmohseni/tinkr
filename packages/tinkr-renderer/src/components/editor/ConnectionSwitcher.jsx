import {useEffect} from 'react'
import {FormattedMessage, useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'
import {nanoid} from 'nanoid'
import {useLocation} from 'wouter'

import CreateButton from '../connections/CreateButton'
import QuickButton from '../connections/QuickButton'
import {connectConnection, onCloneConnection, popupConnectionContextMenu} from '../../utils/api'
import {connectionAtom} from '../../stores/editor'
import {connectionListAtom, createConnectionAtom} from '../../stores/connections'

/**
 * The connections of the store, this window's one ringed, and the section's two
 * ways to add one.
 *
 * The app keeps one window, so a connection other than this window's is reached
 * the way the app reaches any connection: connecting to it, which switches this
 * window to it. The row of the connection this window runs is already the
 * session, so clicking it opens its settings instead. A right click is the
 * app's own connect/clone/delete menu, the one the connections window used to
 * offer, and the clone it raises opens the copy's dialog here.
 */
const ConnectionSwitcher = () => {
  const intl = useIntl()
  const connection = useAtomValue(connectionAtom)
  const connections = useAtomValue(connectionListAtom)
  const createConnection = useSetAtom(createConnectionAtom)
  const [, setLocation] = useLocation()

  useEffect(() => {
    const onClone = onCloneConnection(cloned => {
      const copy = {
        ...cloned,
        id: nanoid(),
      }

      createConnection(copy)
      setLocation(`/connections/${copy.id}`)
    })

    return () => onClone.dispose()
  }, [])

  return (
    <nav className='sidebar__section' aria-label={intl.formatMessage({id: 'connections.plural'})}>
      <div className='sidebar__title'>
        <span><FormattedMessage id='connections.plural'/></span>
        <span className='row' style={{gap: 'var(--s1)'}}>
          <span className='sidebar__meta'>{connections.length}</span>
          <QuickButton/>
          <CreateButton/>
        </span>
      </div>

      {connections.map(item => {
        const isCurrent = item.id === connection.id

        return (
          <button
            key={item.id}
            className={isCurrent ? 'tree-nav__row tree-nav__row--active' : 'tree-nav__row'}
            type='button'
            title={item.name}
            aria-current={isCurrent ? 'true' : undefined}
            onClick={() => {
              if (isCurrent) {
                setLocation(`/connections/${item.id}`)
                return
              }

              connectConnection(item)
            }}
            onContextMenu={() => popupConnectionContextMenu(item.id)}
          >
            <span className={isCurrent ? 'dot dot--live dot--ring' : 'dot'}/>
            <span className='truncate'>{item.name}</span>
            <span className='sidebar__meta'>{item.is_over_ssh ? 'ssh' : 'local'}</span>
          </button>
        )
      })}
    </nav>
  )
}

export default ConnectionSwitcher
