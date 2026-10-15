import {createRoot} from 'react-dom/client'
import {Provider} from 'jotai'

import EditorWindow from './EditorWindow'

// the bundle's own answer to "did you run at all". It is after the imports, so
// reaching it means every module the app needs resolved and executed: a window
// that hangs with this line in its log is one whose script ran and then stopped,
// and one without it never started.
console.log('[renderer] the app is booting')

createRoot(document.querySelector('#app')).render(
  <Provider>
    <EditorWindow/>
  </Provider>)

console.log('[renderer] the app was handed to react')

// A render is scheduled, not done, so a window that shows nothing after that
// line is either one whose render never got a turn or one whose loop stopped.
// These two answer which: a task runs on the next turn, a frame is drawn on the
// next paint, and neither can happen if the loop is not turning.
setTimeout(() => console.log('[renderer] the page can still run a task'), 0)

requestAnimationFrame(() => console.log('[renderer] the page can still draw a frame'))
