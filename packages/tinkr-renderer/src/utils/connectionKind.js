/**
 * Which locale key says what a connection is.
 *
 * The app keeps two answers — `is_over_ssh` and `container_engine` — and they
 * are not exclusive: a project deployed by a compose file on a server is a
 * container on that server. One place reads both, so the switcher's row and the
 * statusbar's line can never say two different things about one connection.
 *
 * Laravel Cloud and Laravel Vapor come first, as they do in the core: neither
 * has a machine or a container of its own to be described by, so the kind is the
 * whole of what it is, and the tag's stage is still shown beside it.
 *
 * A production connection is the thing a reader has to know before typing, and
 * it is otherwise the only kind that outranks the others here.
 *
 * @param {Record<String, any>} connection
 * @return {String} the id of the message
 */
const kindOf = ({
  tag,
  is_cloud: cloud,
  is_vapor: vapor,
  is_over_ssh: ssh,
  container_engine: engine,
} = {}) => {
  if (cloud) {
    return 'connections.kind_cloud'
  }

  if (vapor) {
    return 'connections.kind_vapor'
  }

  if (tag === 'production') {
    return 'connections.kind_production'
  }

  if (ssh && engine) {
    return 'connections.kind_ssh_container'
  }

  if (engine) {
    return 'connections.kind_container'
  }

  return ssh ? 'connections.kind_ssh' : 'connections.kind_local'
}

/**
 * Which product a connection that runs through an API is.
 *
 * Laravel Cloud and Laravel Vapor answer the same questions of a connection:
 * there is no machine here, no session of ours, and no log file this app can
 * read. The two are told apart only where the answer names one of them, which is
 * the copy that says why an action is not there.
 *
 * @param {Record<String, any>} connection
 * @return {String|null} 'cloud', 'vapor', or null for a connection that runs here
 */
const apiRunOf = connection => {
  if (!connection) {
    return null
  }

  if (connection.is_cloud) {
    return 'cloud'
  }

  return connection.is_vapor ? 'vapor' : null
}

/**
 * Whether a connection's runs leave this machine.
 *
 * @param {Record<String, any>} connection
 * @return {Boolean}
 */
const isApiRun = connection => apiRunOf(connection) !== null

export {apiRunOf, isApiRun}
export default kindOf
