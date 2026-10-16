/**
 * The marks the sidebar and the pane use for the app's own two things: what a
 * session returned, and the lines a log is made of.
 *
 * Both are drawn the way the rest of the interface is — bars whose ends are cut
 * at 29 degrees — so an icon in a row belongs to the same family as the brand and
 * the outcomes. They live in one place because three surfaces name them: the
 * switch that moves between the pane's two readings, the list of log files, and
 * the strip that names the file being read.
 */
const viewBox = '0 0 16 16'

/**
 * The return bars: the `=` a session prints before a value it returned, which is
 * what the tinker half of the pane is for.
 */
export const ReturnIcon = () => (
  <svg width='14' height='14' viewBox={viewBox} aria-hidden='true' fill='currentColor'>
    <path d='M3.2 4.5H13.6L12.2 7H1.8Z'/>
    <path d='M2.4 8.7H12.8L11.4 11.2H1Z'/>
  </svg>
)

/**
 * The lines a log file is made of, drawn as the entry rows they become.
 */
export const LinesIcon = () => (
  <svg width='14' height='14' viewBox={viewBox} aria-hidden='true' fill='currentColor'>
    <path d='M3 3H13L12 5H2Z'/>
    <path d='M3 6.5H12L11 8.5H2Z'/>
    <path d='M3 10H10L9 12H2Z'/>
  </svg>
)
