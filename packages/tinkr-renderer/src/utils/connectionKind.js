/**
 * Which locale key says what a connection is.
 *
 * The app keeps two answers — `is_over_ssh` and `container_engine` — and they
 * are not exclusive: a project deployed by a compose file on a server is a
 * container on that server. One place reads both, so the switcher's row and the
 * statusbar's line can never say two different things about one connection.
 *
 * A production connection is the thing a reader has to know before typing, and
 * it is the only kind that outranks the others here.
 *
 * @param {Record<String, any>} connection
 * @return {String} the id of the message
 */
const kindOf = ({tag, is_over_ssh: ssh, container_engine: engine} = {}) => {
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

export default kindOf
