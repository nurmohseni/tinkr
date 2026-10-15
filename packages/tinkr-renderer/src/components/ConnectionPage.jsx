import {useMemo} from 'react'
import PropTypes from 'prop-types'
import {useAtomValue, useSetAtom} from 'jotai'
import {useIntl} from 'react-intl'
import {useLocation} from 'wouter'

import ConnectionFormProvider from './connections/ConnectionFormProvider'
import ConnectionForm from './connections/ConnectionForm'
import {connectionAtomWithId, updateConnectionAtom} from '../stores/connections'
import {newConnection, newConnectionId} from '../utils/newConnection'

/**
 * The connection dialog, over the window: the app presents one connection at a
 * time, so the page is the design's modal with the connection form inside it.
 * It is mounted in the editor window itself, and the overlay covers that window
 * while its route, `/connections/:id`, is the one the window is on — closing it
 * is leaving that route.
 *
 * Not every id the route carries is a connection of the store: on
 * `/connections/new` the dialog is opening a connection that does not exist
 * yet, and it fills in the defaults held here, in memory. Nothing of it is
 * written until the user confirms it — Connect is that confirmation — so a
 * dialog closed without connecting leaves the store untouched.
 */
const ConnectionPage = ({params}) => {
  const stored = useAtomValue(connectionAtomWithId(params.id))
  const updateConnection = useSetAtom(updateConnectionAtom)
  const intl = useIntl()
  const [, setLocation] = useLocation()

  const isDraft = params.id === newConnectionId

  // the draft is rebuilt when the dialog opens on another id, not between two
  // renders of the same one, so typing in it never resets the form
  const connection = useMemo(
    () => (isDraft ? newConnection(intl.formatMessage({id: 'connections.name_default'})) : stored),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.id],
  )

  const handleSubmit = data => {
    // the autosave of a draft would be its first write, and a draft is written
    // when it is confirmed, not while it is typed
    if (!isDraft) {
      updateConnection(data)
    }
  }

  const handleClose = () => {
    setLocation('/')
  }

  return useMemo(() => (
    <div className='modal-overlay'>
      <ConnectionFormProvider defaultValues={connection}>
        <ConnectionForm
          onSubmit={handleSubmit}
          onClose={handleClose}
        />
      </ConnectionFormProvider>
    </div>
  ), [connection?.id])
}

ConnectionPage.propTypes = {
  params: PropTypes.object.isRequired,
}

export default ConnectionPage
