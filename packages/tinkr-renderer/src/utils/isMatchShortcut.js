/**
 * 检查快捷键和键盘事件是否匹配
 *
 * @param {KeyboardEvent} event
 * @param {[]} shortcuts
 * @return {boolean}
 */
export function isMatchShortcut(event, shortcuts) {
  return shortcuts.reduce((res, value) => {
    if (value === 'Control') {
      return event.ctrlKey && res
    }

    if (value === 'Meta') {
      return event.metaKey && res
    }

    if (value === 'Alt') {
      return event.altKey && res
    }

    if (value === 'Shift') {
      return event.shiftKey && res
    }

    return value === event.key && res
  }, true)
}

// the accelerators the app stores, written the way a tooltip names them
const KEY_LABELS = {
  Control: 'Ctrl',
  Meta: '⌘',
  Shift: '⇧',
  Alt: 'Alt',
}

/**
 * A shortcut the app holds, as one string: `Ctrl R`, `⌘ ⇧ N`.
 *
 * @param {Array<String>} keys
 * @return {String}
 */
export const shortcutLabel = keys => keys.map(key => KEY_LABELS[key] || key.toUpperCase()).join(' ')
