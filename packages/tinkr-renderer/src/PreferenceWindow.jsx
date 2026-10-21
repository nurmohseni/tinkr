import {useEffect} from 'react'
import {useSetAtom} from 'jotai'

import WindowContainer from './components/WindowContainer'
import Titlebar from './components/Titlebar'
import PreferenceTab from './components/preference/PreferenceTab'
import PreferenceForm from './components/preference/PreferenceForm'
import sections from './components/preference/sections'
import {preferenceTabIndexAtom} from './stores/preference'
import {onPreferenceSection} from './utils/api'

/**
 * The preference window: the section rail on the left, the sections the app
 * actually has on the right, on the design's settings screen.
 *
 * It wears the same titlebar as the editor window, because it is framed the same
 * way — frameless, with the app's controls — and two windows of one app framed
 * differently is two apps.
 *
 * Another window can open this one on a section: a connection that has no
 * Laravel Cloud token yet sends the person to the field that takes one, and the
 * window that is already open is asked for that section too. The section is
 * found by its id rather than by its position, because the rail's order is a
 * design decision and the id is the thing the caller knows.
 */
const PreferenceWindow = () => {
  const setTabIndex = useSetAtom(preferenceTabIndexAtom)

  useEffect(() => {
    const onSection = onPreferenceSection(id => {
      const index = sections.findIndex(section => section.id === id)

      if (index >= 0) {
        setTabIndex(index)
      }
    })

    return () => {
      onSection.dispose()
    }
  }, [])

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
