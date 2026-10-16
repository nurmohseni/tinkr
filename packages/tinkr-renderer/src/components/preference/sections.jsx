import GeneralForm from './GeneralForm'
import ShortcutsForm from './ShortcutsForm'
import LabForm from './LabForm'
import AiForm from './AiForm'
import McpForm from './McpForm'

/* The rail's icons, drawn the way the rest of the interface is: a bar whose
   ends are cut at the same 29 degrees as the return bars, and nothing else. A
   glyph is how many bars it carries and where they sit — the general settings
   are a list of bars, a shortcut row is keys, the experiments are a bench with
   one thing on it, the ask is two lines and its mark, and the clients are a
   connector. Five icons in one construction, rather than five shapes from a
   pack. */
const bar = (x, y, width) => `M${x} ${y}H${x + width}L${x + width - 1} ${y + 2}H${x - 1}Z`

const Icon = ({children}) => (
  <svg width='13' height='13' viewBox='0 0 16 16' aria-hidden='true' fill='currentColor'>
    {children}
  </svg>
)

const CogIcon = () => (
  <Icon>
    <path d={bar(3, 3, 10)}/>
    <path d={bar(3, 6.5, 7)}/>
    <path d={bar(3, 10, 4)}/>
  </Icon>
)

const KeyboardIcon = () => (
  <Icon>
    <path d={bar(2, 3.5, 4.5)}/>
    <path d={bar(8.5, 3.5, 4.5)}/>
    <path d={bar(2, 8, 10)}/>
  </Icon>
)

const FlaskIcon = () => (
  <Icon>
    <path d={bar(3, 4, 10)}/>
    <path d={bar(4.5, 9.5, 7)}/>
  </Icon>
)

const SparkleIcon = () => (
  <Icon>
    <path d={bar(2.5, 4, 9)}/>
    <path d={bar(2.5, 7.5, 5.5)}/>
    <circle cx='11.6' cy='10.6' r='1.6'/>
  </Icon>
)

const PlugIcon = () => (
  <Icon>
    <path d={bar(3, 3.5, 10)}/>
    <path d={bar(5.5, 8.5, 2)}/>
    <path d={bar(9.5, 8.5, 2)}/>
  </Icon>
)

/**
 * The settings the app has, in the order the rail lists them. The index is what
 * `preferenceTabIndexAtom` holds, so the rail and the column read one list.
 */
const sections = [
  {
    id: 'general',
    labelId: 'preference.general',
    Icon: CogIcon,
    Form: GeneralForm,
  },
  {
    id: 'shortcuts',
    labelId: 'preference.shortcuts',
    Icon: KeyboardIcon,
    Form: ShortcutsForm,
  },
  {
    id: 'lab',
    labelId: 'preference.lab',
    Icon: FlaskIcon,
    Form: LabForm,
  },
  {
    id: 'ai',
    labelId: 'preference.ai',
    Icon: SparkleIcon,
    Form: AiForm,
  },
  {
    id: 'mcp',
    labelId: 'preference.mcp',
    Icon: PlugIcon,
    Form: McpForm,
  },
]

export default sections
