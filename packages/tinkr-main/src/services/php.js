const {DynamicPhpForm} = require('../dynamicPhpForm')
const {ensureBackgroundPty} = require('../createBackgroundPty')

const parsePhpForm = async (connectionId, code) => {
  // a run boots a new session, so the background session may be gone by now
  ensureBackgroundPty(connectionId)

  const form = await DynamicPhpForm.instance()
  return form.parse(connectionId, code)
}

// the form writes its values into the code it was read from, and a form sent
// without that code is written into nothing, so the code is kept with it
const stringifyPhpForm = async (fields, code) => {
  const form = await DynamicPhpForm.instance()

  if (code !== undefined) {
    form.code = code
  }

  return form.stringify(fields)
}

module.exports = {
  parsePhpForm,
  stringifyPhpForm,
}
