import {createRoot} from 'react-dom/client'
import {Provider} from 'jotai'

import LogsWindow from './LogsWindow'

createRoot(document.querySelector('#app')).render(
  <Provider>
    <LogsWindow/>
  </Provider>,
)
