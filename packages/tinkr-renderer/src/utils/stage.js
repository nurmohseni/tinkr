/**
 * The stages a connection's tag can name, quietest first. A tag that is not one
 * of them — a connection saved before tags, or one written by hand — is read as
 * local, which is what a new connection starts as.
 */
export const STAGES = ['local', 'testing', 'development', 'staging', 'production']

/**
 * @param {String} tag
 * @return {String} one of STAGES
 */
export const stageOf = tag => (STAGES.includes(tag) ? tag : 'local')
