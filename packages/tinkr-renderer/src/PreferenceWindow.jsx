import WindowContainer from './components/WindowContainer'
import Titlebar from './components/Titlebar'
import PreferenceTab from './components/preference/PreferenceTab'
import PreferenceForm from './components/preference/PreferenceForm'

/**
 * The preference window: the section rail on the left, the sections the app
 * actually has on the right, on the design's settings screen.
 *
 * It wears the same titlebar as the editor window, because it is framed the same
 * way — frameless, with the app's controls — and two windows of one app framed
 * differently is two apps.
 */
const PreferenceWindow = () => {
  return (
    <WindowContainer>
      <div className='app'>
        <Titlebar settings={false}/>

        <div className='app__body'>
          <PreferenceTab/>
          <PreferenceForm/>
        </div>
      </div>
    </WindowContainer>
  )
}

export default PreferenceWindow
