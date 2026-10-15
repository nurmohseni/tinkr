import {createRoot} from 'react-dom/client'
import {Provider} from 'jotai'

import EditorWindow from './EditorWindow'

createRoot(document.querySelector('#app')).render(
  <Provider>
    <EditorWindow/>
  </Provider>)
