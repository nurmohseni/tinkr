import {useEffect, useRef, useState} from 'react'
import {useIntl} from 'react-intl'

import {cloudStatus, forgetCloudToken, openExternal, setCloudToken} from '../../utils/api'

// where a token is made: the organisation's settings on Laravel Cloud. The page
// is named here so nobody has to guess which of its settings holds the tokens
const TOKENS_URL = 'https://cloud.laravel.com'

/**
 * The Laravel Cloud section: one API token for the account, and what it needs.
 *
 * The token is asked for once and then never shown again. What the main process
 * keeps is the token itself, and what it answers here is only whether there is
 * one — so the field is a password input that is cleared the moment the answer
 * says a token is kept, and nothing reads a saved token back into it. That is on
 * purpose: a token on screen is a token in a screenshot, and there is nothing
 * left for the form to say about it.
 *
 * Saving is a check: the token is asked against the API before it is kept, so a
 * typo is a message here rather than a connection that fails later with a 401.
 * The check is a row of its own, the way the AI section's round trip is: one
 * control per row, so the column of controls stays one column. Forgetting is one
 * press and no question, because the field is one paste away.
 */
const CloudForm = () => {
  const intl = useIntl()
  const [status, setStatus] = useState(null)
  const [token, setToken] = useState('')
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState(null)
  const [replacing, setReplacing] = useState(false)
  const field = useRef(null)

  const say = (id, values) => intl.formatMessage({id}, values)

  useEffect(() => {
    let live = true

    cloudStatus()
      .then(answer => { if (live) { setStatus(answer || {hasToken: false}) } })
      // a main process that could not answer is one with no token it can name,
      // and the section draws the empty state rather than waiting forever
      .catch(() => { if (live) { setStatus({hasToken: false}) } })

    return () => { live = false }
  }, [])

  const save = async () => {
    const typed = token.trim()

    if (typed === '' || checking) {
      return
    }

    setChecking(true)
    setMessage(null)

    try {
      const answer = await setCloudToken(typed)

      if (answer && answer.ok) {
        setStatus({hasToken: true})
        setToken('')
        setReplacing(false)
        setMessage({
          kind: 'ok',
          text: say('preference.cloud_saved', {count: answer.applications}),
        })
      } else {
        setMessage({
          kind: 'error',
          text: (answer && answer.error && answer.error.message) || say('preference.cloud_invalid'),
        })
      }
    } catch (e) {
      setMessage({kind: 'error', text: e.message})
    }

    setChecking(false)
  }

  const forget = async () => {
    setChecking(true)
    setMessage(null)

    try {
      await forgetCloudToken()

      setStatus({hasToken: false})
      setToken('')
      setReplacing(false)
    } catch (e) {
      setMessage({kind: 'error', text: e.message})
    }

    setChecking(false)
  }

  const startReplacing = () => {
    setReplacing(true)
    setMessage(null)

    // the field is drawn by this press, so it is focused on the next frame, when
    // there is one to focus
    setTimeout(() => field.current && field.current.focus(), 0)
  }

  const hasToken = Boolean(status && status.hasToken)

  // the answer is not known for a moment, and a field drawn in that moment is a
  // field that disappears under the person's hands: nothing is drawn until the
  // main process has said whether there is a token
  const showField = status !== null && (!hasToken || replacing)

  return (
    <>
      <div className='setting'>
        <div>
          <div className='setting__label'>{say('preference.cloud_token')}</div>

          <div className='setting__desc'>
            {hasToken && !replacing
              ? say('preference.cloud_token_saved')
              : say('preference.cloud_token_description')}
          </div>

          {/* what the last check said: a kept token says how far it reached, a
              refused one says why, in the ink the app says errors in */}
          {message && (
            <div
              className={message.kind === 'error' ? 'field__error' : 'setting__desc'}
              role='status'
            >
              {message.text}
            </div>
          )}
        </div>

        <div className='setting__control'>
          {showField && (
            <input
              className='input'
              ref={field}
              type='password'
              value={token}
              placeholder={say('preference.cloud_token_placeholder')}
              aria-label={say('preference.cloud_token')}
              spellCheck={false}
              autoComplete='off'
              onChange={event => setToken(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  save()
                }
              }}
            />
          )}

          {hasToken && !replacing && (
            <>
              <button
                className='btn btn--secondary'
                type='button'
                onClick={startReplacing}
              >
                {say('preference.cloud_replace')}
              </button>

              <button
                className='btn btn--ghost'
                type='button'
                disabled={checking}
                onClick={forget}
              >
                {say('preference.cloud_forget')}
              </button>
            </>
          )}
        </div>
      </div>

      {showField && (
        <div className='setting'>
          <div>
            <div className='setting__label'>{say('preference.cloud_check')}</div>
            <div className='setting__desc'>{say('preference.cloud_check_description')}</div>
          </div>

          <div className='setting__control'>
            {replacing && (
              <button
                className='btn btn--ghost'
                type='button'
                onClick={() => {
                  setReplacing(false)
                  setToken('')
                  setMessage(null)
                }}
              >
                {say('preference.cloud_cancel')}
              </button>
            )}

            <button
              className='btn btn--secondary'
              type='button'
              disabled={checking || token.trim() === ''}
              aria-busy={checking}
              onClick={save}
            >
              {say(checking ? 'preference.cloud_checking' : 'preference.cloud_save')}
            </button>
          </div>
        </div>
      )}

      <div className='setting'>
        <div>
          <div className='setting__label'>{say('preference.cloud_permissions')}</div>

          <div className='setting__desc mono'>
            {say('preference.cloud_permission_applications')}
          </div>

          <div className='setting__desc mono'>
            {say('preference.cloud_permission_environments')}
          </div>

          <div className='setting__desc'>
            {say('preference.cloud_permissions_description')}
          </div>
        </div>

        <div className='setting__control'>
          <button
            className='btn btn--secondary'
            type='button'
            onClick={() => openExternal(TOKENS_URL)}
          >
            {say('preference.cloud_open')}
          </button>
        </div>
      </div>
    </>
  )
}

export default CloudForm
