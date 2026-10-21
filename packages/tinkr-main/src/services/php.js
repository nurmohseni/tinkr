const {isCloud} = require('tinkr-core')

const {instance} = require('../dynamicPhpForm')
const {ensureBackgroundPty} = require('../createBackgroundPty')
const {getEditorConnection} = require('../processes')

const parsePhpForm = async (connectionId, code) => {
  // a connection on Laravel Cloud has no session to ask, and nothing of the form
  // is worth a command there: the fields are read from the code itself, and a
  // closure field is the error the form shows (see DynamicPhpForm#parse). No
  // background session is booted for it, because there is none to boot.
  if (!isCloud(getEditorConnection(connectionId))) {
    // a run boots a new session, so the background session may be gone by now
    ensureBackgroundPty(connectionId)
  }

  const form = await instance()

  return form.parse(connectionId, code)
}

// the form writes its values into the code it was read from, and a form sent
// without that code is written into nothing, so the code is kept with it
const stringifyPhpForm = async (fields, code) => {
  const form = await instance()

  if (code !== undefined) {
    form.code = code
  }

  return form.stringify(fields)
}

module.exports = {
  parsePhpForm,
  stringifyPhpForm,
}
