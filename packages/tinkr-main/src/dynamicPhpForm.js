const {getBackgroundPtyProcess} = require('./processes')
const {writeFields} = require('./phpLiteral')
const {readForm} = require('./phpForm')
const {getFormPrefix} = require('./services/config')

/**
 * The form of a snippet: its variables, and the code those variables are written
 * back into.
 *
 * The reading is `phpForm.readForm`'s, which is a scan and not a parse. That is
 * the point of it: `php-form` — the WebAssembly PHP 7 parser this used to use —
 * rejected every construct php added after 7, so one nullsafe `?->` anywhere in
 * a snippet took the whole form down with `syntax error: unexpected
 * T_OBJECT_OPERATOR`. A form only needs to know where each `$field_x = …;` starts
 * and ends, and that does not need a grammar.
 */
class DynamicPhpForm {
  /**
   * The fields of a snippet.
   *
   * A value that is written as a closure is asked of the session — the snippet
   * says what a variable is, and a closure's answer is whatever it returns —
   * while every other value is the text it was written with.
   *
   * @param {String} connectionId
   * @param {String} code
   * @param {String} [prefix] what a field's variable starts with
   * @return {Promise<Array<Object>>}
   */
  async parse(connectionId, code, prefix = getFormPrefix()) {
    const source = String(code || '')

    // a form is written back into the code it came from, so that code is kept
    this.code = source

    const fields = readForm(source, prefix)
    const pty = getBackgroundPtyProcess(connectionId)

    for (const field of fields) {
      if (!pty || typeof field.value !== 'string' || !/^\s*(function|fn)\b/.test(field.value)) {
        continue
      }

      try {
        const answer = this.parseJsonResult(await pty.jsonResult(field.value))

        field.value = answer

        // the code the field was written as is gone: what the form holds now is
        // the answer, so an edit to it is a value and not the closure's code
        if (typeof answer === 'number') {
          field.literal = 'number'
        } else if (typeof answer === 'boolean') {
          field.literal = 'boolean'
        } else if (answer === null) {
          field.literal = 'null'
        } else {
          delete field.literal
        }
      } catch (e) {
        // a closure the session could not answer for is shown as the code it is:
        // the field is still editable, and the run is what says why
      }
    }

    return fields
  }

  /**
   * @param {String} jsonString
   * @return {any}
   */
  parseJsonResult(jsonString) {
    try {
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
   * The code is kept from the parse, and each field's assignment is rewritten in
   * it: a value written into a snippet is code, so the literal is `phpLiteral`'s
   * and never the form's own text.
   *
   * @param {Array<Object>} fields
   * @param {String} [code] the code the fields were parsed from
   * @return {String}
   */
  stringify(fields, code = this.code) {
    return writeFields(code || '', fields)
  }
}

DynamicPhpForm.dynamicPhpForm = null

/**
 * The form, read without a package behind it: nothing is loaded and nothing is
 * started, so it can be made wherever a snippet's form is asked for.
 *
 * @return {Promise<DynamicPhpForm>}
 */
const instance = async () => {
  if (!DynamicPhpForm.dynamicPhpForm) {
    DynamicPhpForm.dynamicPhpForm = new DynamicPhpForm()
  }

  return DynamicPhpForm.dynamicPhpForm
}

module.exports = {
  DynamicPhpForm,
  instance,
}
