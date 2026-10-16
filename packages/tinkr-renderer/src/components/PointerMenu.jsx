import PropTypes from 'prop-types'
import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'

// the gap a menu keeps from the window's edge when it is pulled back inside it
const menuMargin = 4

/**
 * A menu at the pointer, drawn by the app rather than raised by Electron: the
 * main process's menu can sit behind the window, and this one is part of the
 * window it belongs to.
 *
 * It follows the pointer, so everything that moves what is under it takes it
 * away: a press elsewhere, Escape, a scroll anywhere in the window, or the
 * window losing focus. An entry that answers closes it itself, through
 * `onClose`, so a menu never stays up over what it just did.
 *
 * @param {Object} at where the pointer was: `{left, top}`
 * @param {String} label what the menu is about, read out on arrival
 * @param {Function} onClose
 * @param {Node} children the entries, as `.autocomplete__item` buttons
 */
const PointerMenu = ({at, label, onClose, children}) => {
  const ref = useRef()
  const [placed, setPlaced] = useState(at)

  // a menu opened at the window's edge is pulled back inside it, so the whole
  // of it is on screen whichever way the pointer sits
  useLayoutEffect(() => {
    const {width, height} = ref.current.getBoundingClientRect()

    setPlaced({
      left: Math.max(menuMargin, Math.min(at.left, window.innerWidth - width - menuMargin)),
      top: Math.max(menuMargin, Math.min(at.top, window.innerHeight - height - menuMargin)),
    })
  }, [at.left, at.top])

  useEffect(() => {
    const onPointerDown = event => {
      // pressing an entry is not leaving the menu: the entry itself answers
      if (!ref.current.contains(event.target)) {
        onClose()
      }
    }

    const onKeyDown = event => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('blur', onClose)

    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      className='autocomplete pointer-menu'
      ref={ref}
      role='menu'
      aria-label={label}
      style={{left: placed.left, top: placed.top}}
    >
      {children}
    </div>,
    document.body,
  )
}

PointerMenu.propTypes = {
  at: PropTypes.shape({
    left: PropTypes.number.isRequired,
    top: PropTypes.number.isRequired,
  }).isRequired,
  label: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
}

PointerMenu.defaultProps = {
  label: undefined,
}

export default PointerMenu
