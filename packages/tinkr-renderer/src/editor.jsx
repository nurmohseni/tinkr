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
