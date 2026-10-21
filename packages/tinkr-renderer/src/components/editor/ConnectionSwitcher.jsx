import {useEffect} from 'react'
import {FormattedMessage, useIntl} from 'react-intl'
import {useAtomValue, useSetAtom} from 'jotai'
import {nanoid} from 'nanoid'
import useHashLocation from '../../utils/useHashLocation'


import CreateButton from '../connections/CreateButton'
import QuickButton from '../connections/QuickButton'
import {connectConnection, onCloneConnection, onEditConnection, popupConnectionContextMenu} from '../../utils/api'
import {connectionAtom} from '../../stores/editor'
import {connectionListAtom, createConnectionAtom} from '../../stores/connections'
import kindOf from '../../utils/connectionKind'
import {stageOf} from '../../utils/stage'

const EditIcon = () => (
  <svg
    width='12'
    height='12'
    viewBox='0 0 16 16'
    aria-hidden='true'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.2'
    strokeLinejoin='round'
    strokeLinecap='round'
  >
    <path d='M10.6 2.6l2.8 2.8-7.9 7.9-3.4.6.6-3.4z'/>
    <path d='M9 4.2l2.8 2.8'/>
  </svg>
)

/**
 * The connections of the store, this window's one ringed, and the section's two
 * ways to add one.
 *
 * The app keeps one window, so a connection other than this window's is reached
 * the way the app reaches any connection: connecting to it, which switches this
 * window to it. Pressing a row only ever connects; the row of the connection
 * this window already runs is the session, and pressing it does nothing. Its
 * settings are behind the pencil the row shows on hover and focus, and behind
 * Edit in the app's own right-click menu, so opening a connection is never a
 * way of landing in its form by accident.
 *
 * Every row carries its stage — the tag's light, quiet for local and vermilion
 * for production — so what kind of data a connection reaches is read from the
 * list without opening it. The light is never alone: the stage's word is in
 * the row's title and read out after its name.
 */
const ConnectionSwitcher = () => {
  const intl = useIntl()
  const connection = useAtomValue(connectionAtom)
  const connections = useAtomValue(connectionListAtom)
  const createConnection = useSetAtom(createConnectionAtom)
  const [, setLocation] = useHashLocation()

  useEffect(() => {
    const onClone = onCloneConnection(cloned => {
      const copy = {
        ...cloned,
        id: nanoid(),
      }

      createConnection(copy)
      setLocation(`/connections/${copy.id}`)
    })

    const onEdit = onEditConnection(id => setLocation(`/connections/${id}`))

    return () => {
      onClone.dispose()
      onEdit.dispose()
    }
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
        const stage = stageOf(item.tag)
        const stageWord = intl.formatMessage({id: `connections.tag_${stage}`})
        const edit = intl.formatMessage({id: 'connections.edit_named'}, {name: item.name})

        return (
          <div
            key={item.id}
            className={isCurrent ? 'tree-nav__row tree-nav__row--active conn-row' : 'tree-nav__row conn-row'}
            onContextMenu={() => popupConnectionContextMenu(item.id)}
          >
            <button
              className='conn-row__main'
              type='button'
              title={`${item.name} · ${stageWord}`}
              aria-current={isCurrent ? 'true' : undefined}
              onClick={() => {
                if (!isCurrent) {
                  connectConnection(item)
                }
              }}
            >
              <span className={isCurrent ? `stage-dot stage--${stage} stage-dot--current` : `stage-dot stage--${stage}`}/>
              <span className='truncate'>{item.name}</span>
              <span className='sr-only'>{stageWord}</span>
              {/* a connection tagged production says so in words too: a run on
                  production is the one thing a reader has to know before
                  typing, and its light alone is not enough to say it */}
              <span className={stage === 'production' ? 'sidebar__meta stage-word stage--production' : 'sidebar__meta'}>
                {intl.formatMessage({id: kindOf(item)})}
              </span>
            </button>

            <button
              className='btn btn--ghost btn--icon btn--sm conn-row__edit'
              type='button'
              title={edit}
              aria-label={edit}
              onClick={() => setLocation(`/connections/${item.id}`)}
            >
              <EditIcon/>
            </button>
          </div>
        )
      })}
    </nav>
  )
}

export default ConnectionSwitcher
