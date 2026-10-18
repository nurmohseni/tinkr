const fs = require('fs')
const path = require('path')
const flatten = require('flat')
const {createIntl, createIntlCache} = require('@formatjs/intl')

// the stored preference itself, not services/config: that module switches the
// locale through this one, and requiring each other left one of the two half
// loaded on boot
const {config} = require('./database/config')

const cache = createIntlCache()

/**
 * get the intl config
 *
 * @returns {{messages: any, locale: string}}
 */
const getIntlConfig = () => {
  const locale = config.get('locale', 'en')
  const messages = flatten(JSON.parse(
    fs.readFileSync(path.join(__dirname, `lang/${locale}.json`)).toString('utf8'),
  ))

  return {
    locale,
    messages,
  }
}

let intl = null

/**
 * get the global intl object
 *
 * @returns {IntlShape}
 */
const getIntl = () => {
  if (!intl) {
    setIntl()
  }

  return intl
}

/**
 * set intl object
 *
 * @param {Object} config
 */
const setIntl = (config = null) => {
  if (!config) {
    config = getIntlConfig()
  }

  intl = createIntl(config, cache)
}

module.exports = {
  getIntl,
  setIntl,
  getIntlConfig,
}
