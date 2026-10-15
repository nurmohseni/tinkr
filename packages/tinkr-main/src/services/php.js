const {DynamicPhpForm} = require('../dynamicPhpForm')
const {ensureBackgroundPty} = require('../createBackgroundPty')

const parsePhpForm = async (connectionId, code) => {
  // a run boots a new session, so the background session may be gone by now
  ensureBackgroundPty(connectionId)

  const form = await DynamicPhpForm.instance()
  return form.parse(connectionId, code)
}

const stringifyPhpForm = async fields => {
  const form = await DynamicPhpForm.instance()
  return form.stringify(fields)
}

module.exports = {
  parsePhpForm,
  stringifyPhpForm,
}
