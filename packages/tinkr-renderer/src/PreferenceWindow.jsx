import WindowContainer from './components/WindowContainer'
import PreferenceTab from './components/preference/PreferenceTab'
import PreferenceForm from './components/preference/PreferenceForm'

/**
 * The preference window: the section rail on the left, the sections the app
 * actually has on the right, on the design's settings screen.
 */
const PreferenceWindow = () => {
  return (
    <WindowContainer>
      <div className='app'>
        <div className='app__body'>
          <PreferenceTab/>
          <PreferenceForm/>
        </div>
      </div>
    </WindowContainer>
  )
}

export default PreferenceWindow
