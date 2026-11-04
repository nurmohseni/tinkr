import {useMemo} from 'react'
import PropTypes from 'prop-types'

import AiCode from './AiCode'
import {parseInline, parseProse} from '../../utils/aiProse'

/**
 * One line's words: the code it names is code, the weight it gives a word is
 * weight, and everything else is what was written.
 *
 * It is drawn as elements rather than as markup, so an answer that talks about
 * `<script>` shows it.
 */
const Inline = ({text}) => parseInline(text).map((piece, at) => {
  if (piece.type === 'code') {
    return <code key={at}>{piece.text}</code>
  }

  if (piece.type === 'strong') {
    // weight inside weight is not a thing, so what a bold run holds is code and
    // words only
    return <strong key={at}><Inline text={piece.text}/></strong>
  }

  return piece.text
})

Inline.propTypes = {
  text: PropTypes.string.isRequired,
}

/**
 * What an answer says, as the paragraphs, lists, headings and blocks it was
 * written in.
 *
 * A paragraph keeps the lines the model broke it into, because a prompt and an
 * answer are often laid out one idea to a line; a blank line is what makes a new
 * paragraph. Code in an answer that is not the proposal — a second block, or an
 * example — is shown as code too: the panel reads an answer, and reading a fence
 * as three backticks is not reading it.
 */
const AiProse = ({text, className = ''}) => {
  // the thread re-renders when any turn's state changes; an answer that has not
  // changed is not read again
  const blocks = useMemo(() => parseProse(text), [text])

  return (
    <div className={className === '' ? 'ai__prose' : `ai__prose ${className}`}>
      {blocks.map((block, at) => {
        if (block.type === 'code') {
          return <AiCode key={at} code={block.code}/>
        }

        if (block.type === 'heading') {
          // the panel is a conversation, not a document: a heading in an answer
          // is a heading of that answer, and takes the level under the window's
          const Heading = block.level <= 2 ? 'h4' : 'h5'

          return <Heading key={at}><Inline text={block.text}/></Heading>
        }

        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul'

          return (
            <List key={at}>
              {block.items.map((item, itemAt) => (
                <li key={itemAt}><Inline text={item}/></li>
              ))}
            </List>
          )
        }

        return <p key={at}><Inline text={block.text}/></p>
      })}
    </div>
  )
}

AiProse.propTypes = {
  text: PropTypes.string.isRequired,
  className: PropTypes.string,
}

export default AiProse
