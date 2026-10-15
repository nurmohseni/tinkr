import {createRoot} from 'react-dom/client'
import {Provider} from 'jotai'

import PreferenceWindow from './PreferenceWindow'

createRoot(document.querySelector('#app')).render(
  <Provider>
    <PreferenceWindow/>
  </Provider>
  )
