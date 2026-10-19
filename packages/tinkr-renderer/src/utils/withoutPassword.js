/**
 * A connection without the password its form was holding.
 *
 * The password is write-only: it travels to the main process with the save that
 * takes it, and it is kept in a file of its own there. What the window stores is
 * the connection — the name, the fields, whether a password is kept — and a copy
 * of the password in the renderer would be a copy in memory that nothing needs,
 * that a clone would carry, and that a devtools session could read.
 *
 * `ssh_password` is left as it is: it says one is kept, not what it is.
 *
 * @param {Record<String, any>} connection
 * @return {Record<String, any>}
 */
const withoutPassword = connection => {
  if (!connection || connection.password === undefined) {
    return connection
  }

  const copy = Object.assign({}, connection)

  delete copy.password

  return copy
}

export default withoutPassword
