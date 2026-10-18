const isString = require('lodash/isString')
const set = require('lodash/set')
const {instance} = require('php-form')

const {getBackgroundPtyProcess} = require('./processes')
const {writeFields} = require('./phpLiteral')
const {getFormPrefix} = require('./services/config')

/**
 * What a field's value is, as the text of an input.
 *
 * A field is edited as text, so a number, a boolean, null and an array all have
 * to have a text form — and the text form has to be the one that reads back as
 * what it was, which is what `phpLiteral` writes.
 *
 * @param {any} value
 * @return {String}
 */
const textOf = value => {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  if (typeof value === 'number') {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch (e) {
    return ''
  }
}

class DynamicPhpForm {
  /**
   * @param {PHPForm} phpForm
   */
  constructor(phpForm) {
    this.phpForm = phpForm
  }

  /**
   * @param {string} connectionId
   * @param {string} code
   * @return {Promise<PHPFormField[]>}
   */
  async parse(connectionId, code) {
    const fields = await this.phpForm.parse(code)

    // a form is written back into the code it came from, so that code is kept
    this.code = code

    for (let i = 0; i < fields.length; i++) {
      const keys = Object.keys(fields[i])

      for (let j = 0; j < keys.length; j++) {
        const value = fields[i][keys[j]]
        if (isString(value) && value.match(/^(function|fn)/)) {
          const pty = getBackgroundPtyProcess(connectionId)
          const res = await pty.jsonResult(value)

          set(fields, [i, keys[j]], this.parseJsonResult(res))
        }
      }
    }

    // a field is an input, so what it holds is text: a number, a boolean, null
    // and an array are shown as the text php would read back as them, and the
    // field's type is what turns them back into literals when the form runs
    return fields.map(field => Object.assign({}, field, {value: textOf(field.value)}))
  }

  /**
   * @param {string} jsonString
   * @return {any}
   */
  parseJsonResult(jsonString) {
    try {
      // the value as php answered it, with strings as the characters they are:
      // a form shows `it's "quoted"` and not the json of it
      return JSON.parse(jsonString)
    } catch (e) {
      // what a field cannot read is what the field is, and the form says so
      // rather than an empty one: a value is never silently turned into `''`
      return ''
    }
  }

  /**
   * The code a form was read from, with what the form now holds written into it.
   *
   * php-form's `stringify` cannot do this safely: it writes a value as it is,
   * which is how a field ran code, and it panics on any value that is not text,
   * which takes the whole form down with it. What a form is, though, is the code
   * with its fields' values — so the code it was parsed from is kept, and each
   * field's assignment is rewritten here.
   *
   * @param {PHPFormField[]} fields
   * @param {String} [code] the code the fields were parsed from
   * @return {String}
   */
  stringify(fields, code = this.code) {
    return writeFields(code || '', fields)
  }

  /**
   * @return {Promise<DynamicPhpForm>}
   */
  static async instance() {
    if (!DynamicPhpForm.dynamicPhpForm) {
      const phpForm = await instance(getFormPrefix())
      DynamicPhpForm.dynamicPhpForm = new DynamicPhpForm(phpForm)
    }

    return DynamicPhpForm.dynamicPhpForm
  }
}

DynamicPhpForm.dynamicPhpForm = null

module.exports = {
  DynamicPhpForm,
}
