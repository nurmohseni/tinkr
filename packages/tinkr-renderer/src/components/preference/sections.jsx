import GeneralForm from './GeneralForm'
import ShortcutsForm from './ShortcutsForm'
import LabForm from './LabForm'
import AiForm from './AiForm'
import McpForm from './McpForm'

// the design's rail icons, drawn inline: a gear for the general settings, a
// keyboard for the shortcuts, a flask for the experiments, a sparkle for AI and
// a plug for the clients that run code through the app
const CogIcon = () => (
  <svg
    width='13'
    height='13'
    viewBox='0 0 16 16'
    aria-hidden='true'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.2'
  >
    <circle cx='8' cy='8' r='2.4'/>
    <path
      d='M8 1.4v1.8M8 12.8v1.8M1.4 8h1.8M12.8 8h1.8M3.3 3.3l1.3 1.3M11.4 11.4l1.3 1.3M12.7 3.3l-1.3 1.3M4.6 11.4l-1.3 1.3'
      strokeLinecap='round'
    />
  </svg>
)

const KeyboardIcon = () => (
  <svg
    width='13'
    height='13'
    viewBox='0 0 16 16'
    aria-hidden='true'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.2'
    strokeLinecap='round'
  >
    <rect x='1.6' y='4.2' width='12.8' height='7.6' rx='1.6'/>
    <path d='M4.2 6.6h.01M6.6 6.6h.01M9 6.6h.01M11.4 6.6h.01M5.4 9.6h5.2'/>
  </svg>
)

const FlaskIcon = () => (
  <svg
    width='13'
    height='13'
    viewBox='0 0 16 16'
    aria-hidden='true'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.2'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <path d='M6.2 1.8h3.6M6.9 2v3.6L3.7 11.2A1.3 1.3 0 004.9 13h6.2a1.3 1.3 0 001.2-1.8L9.1 5.6V2'/>
    <path d='M5.4 9.4h5.2'/>
  </svg>
)

const SparkleIcon = () => (
  <svg
    width='13'
    height='13'
    viewBox='0 0 16 16'
    aria-hidden='true'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.2'
    strokeLinejoin='round'
  >
    <path d='M7 2.8l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z'/>
    <path d='M11.8 9.6l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z'/>
  </svg>
)

const PlugIcon = () => (
  <svg
    width='13'
    height='13'
    viewBox='0 0 16 16'
    aria-hidden='true'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.2'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <path d='M6 1.8v2.4M10 1.8v2.4'/>
    <rect x='3.6' y='4.2' width='8.8' height='5' rx='1.4'/>
    <path d='M8 9.2v3.4M6.4 14.4h3.2'/>
  </svg>
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
