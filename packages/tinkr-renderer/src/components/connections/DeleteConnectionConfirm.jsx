import {useEffect, useState} from 'react'
import {createPortal} from 'react-dom'
import {FormattedMessage, useIntl} from 'react-intl'
import {useRoute} from 'wouter'
import {useAtomValue, useSetAtom} from 'jotai'
import useHashLocation from '../../utils/useHashLocation'

import {connectConnection, closeConnection, onDeleteConnectionConfirm} from '../../utils/api'
import {connectionAtom} from '../../stores/editor'
import {connectionListAtom, deleteConnectionAtom} from '../../stores/connections'

/**
 * The confirmation the main process raises before a connection is dropped, as
 * the design's narrow modal.
 *
 * It is portalled to the body, like the dialog it replaces: a modal belongs over
 * the whole window, not inside the sidebar that raised it. Nothing closes it but
 * its own two buttons — the dialog the app used before had no onClose either.
 */
const DeleteConnectionConfirm = () => {
  const [isShow, setIsShow] = useState(false)
  const [connection, setConnection] = useState({})
  const current = useAtomValue(connectionAtom)
  const connections = useAtomValue(connectionListAtom)
  const intl = useIntl()
  const [match, params] = useRoute('/connections/:id')
  const [, setLocation] = useHashLocation()
  const deleteConnection = useSetAtom(deleteConnectionAtom)

  const confirm = () => {
    if (connection.id) {
      deleteConnection(connection.id)

      if (current.id === connection.id) {
        // 如果删除的 connection 是当前窗口运行的，则切换到剩下的第一个连接，没有剩下的则关闭窗口
        const next = connections.find(item => item.id !== connection.id)

        if (next) {
          connectConnection(next)
        } else {
          closeConnection()
        }
      } else if (match && params.id === connection.id) {
        // 如果删除的 connection 和当前页面的 connection 相同则返回首页
        setLocation('/')
      }
    }

    hide()
  }

  const hide = () => setIsShow(false)

  useEffect(() => {
    const onConfirm = onDeleteConnectionConfirm(connection => {
      setIsShow(true)
      setConnection(connection)
    })

    return () => onConfirm.dispose()
  }, [])

  if (!isShow) {
    return null
  }

  return createPortal(
    <div className='modal-overlay'>
      <div
        className='modal modal--narrow'
        role='dialog'
        aria-modal='true'
        aria-labelledby='delete-connection-title'
      >
        <header
          className='modal__header'
          id='delete-connection-title'
        >
          {intl.formatMessage({id: 'connections.delete_confirm_title'})}
        </header>

        <div className='modal__body'>
          <FormattedMessage
            id='connections.delete_confirm_content'
            values={{
              name: connection.name,
              // eslint-disable-next-line react/display-name
              strong: chucks => <strong>{chucks}</strong>,
            }}
          />
        </div>

        <footer className='modal__footer'>
          <button
            className='btn btn--ghost'
            type='button'
            onClick={hide}
          >
            {intl.formatMessage({id: 'cancel'})}
          </button>

          <button
            className='btn btn--primary'
            type='button'
            onClick={confirm}
          >
            {intl.formatMessage({id: 'connections.delete_connection'})}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

export default DeleteConnectionConfirm
