# Design — Tinkr

## Genre
A dense, keyboard-first desktop instrument for reading PHP values. Chrome is a quiet notebook floor; code and values sit in darker (or brighter, in light) wells; one green family runs from the floor to the accent, so the only thing on screen that is not paper is the value that came back. Density is desktop density: 26px controls, 24 to 28px rows, 11 to 13px text, tabular numbers, truncation everywhere, a visible focus ring on every interactive element.

## The signature
The return bars. PsySH prints a returned value as `= value`; Tinkr makes that `=` its identity and extends it into a three-glyph outcome language:

| Glyph | Meaning | Colour token | Word (existing i18n id) |
|---|---|---|---|
| `=` two bars | returned a value | `--outcome-returned` (accent) | `editor.history_returned` |
| `−` one bar | printed, no value | `--outcome-printed` (text-muted) | `editor.history_printed` |
| `≠` two bars + slash | threw | `--outcome-threw` (error) | `editor.history_threw` |

Geometry (12x12 viewBox, used at 12px; bars are parallelograms whose ends are cut at 29°; the slash runs at the same 29°; every glyph is centred on (6,6) by construction):
- returned: `M3.2 3.5H10.6L9.6 5.3H2.2Z` + `M2.4 6.7H9.8L8.8 8.5H1.4Z`
- printed: `M2.8 5.1H10.2L9.2 6.9H1.8Z`
- threw: the returned bars + `M8.6 1.4L3.4 10.6` stroked 1.3, round caps
- brand mark (16x16): `M4.6 4.5H14L12.6 7H3.2Z` in `--text` over `M3.4 9H12.8L11.4 11.5H2Z` in `--accent` (the lower bar is where the value lands)

Where it appears: titlebar brand, History rows (first column, the run ledger), result summary head (with the outcome word in Sentient), Output tab marker, statusbar failure, MCP "configured", empty states (`−` at 20px), and the split grip (`=` for stacked panes, `‖` for side-by-side). The same 29° skew (`--bar-skew`) cuts the active output-tab bar. Nothing else on screen is ornament.

Rule: an outcome is never a pill, never a coloured dot, never colour alone. The glyph always carries its word, visibly or in `.sr-only`.

## Macrostructure family
- Editor window: floor (`.app` on `--bg` with grain; `.titlebar`, `.sidebar`, `.statusbar` are transparent on it) around a desk (`.main`, `--panel`, top corners `--r-panel`, inset 6px from the right edge, self-coloured edge). The desk holds the editor pane (tabbar 34px + monaco well) and the output pane (output tabs 34px + body well), separated by a 9px gutter on `--panel` carrying the `=` grip. The active document tab merges into the editor well (same `--panel-inset`): the merge is the indicator. The output pane opens on Output, the value tree.
- Preferences window (880x660): the same floor; `.sidebar.rail` (184px) on the floor; `.settings` is the desk (all four corners rounded, 6px from right and bottom). Each `.sgroup` opens with a Sentient title, no kicker; settings are rows inside one `.scard` per group, controls on one shared 240px column.

## Theme
Neutrals: hue 150, chroma 0.004 to 0.014. Accent: hue 172. Error: hue 30. Warning: hue 70 to 80. Full contract in Exports › tokens.css.

Dark
- `--bg` oklch(0.215 0.007 150) #171a18 · floor
- `--panel` oklch(0.238 0.007 150) #1d201d · desk
- `--panel-raised` oklch(0.272 0.008 150) #242825 · floating and pressed
- `--panel-inset` oklch(0.190 0.006 150) #121512 · wells
- `--text` oklch(0.93 0.008 150) #e4e9e5 · `--text-muted` oklch(0.76 0.010 150) #adb3ae · `--text-faint` oklch(0.66 0.010 150) #8e948f
- `--accent` oklch(0.80 0.085 172) #82d0b7 · `--primary` oklch(0.42 0.065 172) #205949 · `--focus` oklch(0.78 0.09 172) #77cab1
- `--error` oklch(0.75 0.13 30) #f58d7c · `--warning` oklch(0.82 0.11 80) #eabc6e

Light
- `--bg` oklch(0.952 0.011 150) #eaf1eb · `--panel` oklch(0.972 0.008 150) #f2f7f3 · `--panel-raised` oklch(0.993 0.004 150) #fbfefb · `--panel-inset` oklch(0.988 0.005 150) #f9fcf9
- `--text` oklch(0.25 0.012 150) #1e231f · `--text-muted` oklch(0.43 0.012 150) #4b524c · `--text-faint` oklch(0.49 0.012 150) #5c625d
- `--accent` oklch(0.47 0.08 172) #1d6956 · `--primary` oklch(0.45 0.075 172) #1d6350 · `--focus` oklch(0.52 0.10 172) #047b62
- `--error` oklch(0.53 0.17 30) #ba3728 · `--warning` oklch(0.53 0.11 70) #945f0e

Accent budget: `--accent` is the value channel only (returned glyph, caret, links, highlight in completion lists). `--primary` fills exactly: Run, checked switch/checkbox/radio, the primary modal action. `--focus` is the ring. Nothing else is green.

## Typography
| Face | Source | Use | Fallback stack |
|---|---|---|---|
| Switzer (variable 100–900 + italic) | Fontshare, ITF Free Font License | all UI text | `"Switzer", ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans", sans-serif` |
| Sentient (variable 200–700) | Fontshare, ITF Free Font License | display roles only, never below 13px | `"Sentient", "Iowan Old Style", Charter, Georgia, serif` |
| Commit Mono v1.143 (VF 200–700; 400 Italic static for comments) | github.com/eigilnikolajsen/commit-mono, OFL 1.1 | code, values, paths, connection strings, PHP version, log lines, tree keys | `"Commit Mono", ui-monospace, "SF Mono", "Cascadia Mono", "DejaVu Sans Mono", monospace` |

Display faces that fall apart small are excluded: Sentient is a text serif and holds at 13 to 15px; it is never used for 11 to 12px roles.

Roles (each role has its own treatment; there is no shared label costume, no uppercase, no letterspacing anywhere except data that is itself uppercase, like log levels):

| Role | Face | Size / weight | Colour |
|---|---|---|---|
| Wordmark "Tinkr" | Sentient | 15 / 600, -0.01em | `--text` |
| Outcome word in result summary | Sentient | 14 / 500 | `--text` |
| Modal title | Sentient | 15 / 500 | `--text` |
| Settings group title | Sentient | 18 / 500 | `--text` |
| Empty-state line | Sentient | 15 / 400 | `--text-muted` |
| Body, rows, menus | Switzer | 13 / 400 (active 500) | `--text` |
| Sidebar group header | Switzer | 12 / 600, sentence case | `--text-muted` |
| Buttons, tabs, field labels | Switzer | 12 / 500 | per state |
| Help, meta, statusbar | Switzer | 11 to 12 / 400 | `--text-muted` / `--text-faint` |
| Keycaps | Switzer | 11 / 500 | `--text-muted` |
| Timestamps, counts | Switzer (tabular by default) | 11 to 12 | `--text-faint` |
| Code well, value tree, raw output | Commit Mono | 13 / 400 | code and value inks |
| Paths, connection string, log lines, trace frames | Commit Mono | 12 / 400 | `--text-muted` / `--text` |

Scale tokens: 11 / 12 / 13 / 15 / 18; code 13. Line heights: UI 1.45, tight 1.2, code 1.6.

## Shape and elevation
- Radii: `--r-key` 4px (keycaps, badges, tooltip, menu rows), `--r-btn` 5px (buttons, inputs, segmented, rows), `--r-panel` 7px (desk, cards, menus, toasts, error surface), `--r-modal` 10px, `--r-pill` only for switch track and dots.
- The one silhouette: the 29° bar (`--bar-skew: -29deg`), in the outcome glyphs, the brand, the split grip and the active output-tab bar.
- Hairlines: `--border` only where two same-tone surfaces meet (sticky result summary, rows in a table, setting rows inside a card, the indent guides of the tree). Containers separate by tone. Raised and desk surfaces carry `--edge` (8% of the ink, self-coloured), never a contrasting line. Inputs carry `--field-edge` (3:1 or better against every surface they sit on).
- Elevation: flat by default. Only menus, completion, tooltips, toasts and modals lift, with `--shadow-pop` / `--shadow-modal`: downward offset, negative spread, tinted to the hue-150 ink, plus a 1px top lip in dark. `--shadow-primary` is `none`. No glow anywhere.
- Texture: a 2 to 4% grain (`--grain`) on the floor only. Never on wells, never over text.

## Motion
| Exists | Duration / easing |
|---|---|
| Hover and press colour shifts (background, colour) | `--dur-1` 90ms, `--ease` |
| Switch knob translate | `--dur-2` 160ms |
| Tree caret rotate 0 to 90° | 120ms |
| Toast enters by translateY(6px) to 0, opacity stays 1 | `--dur-2` |
| Landing: the outcome glyph's lower bar draws (clip-path inset 0 62% 0 0 to 0); the threw slash draws after 60ms | `--dur-3` 180ms |
| Update progress fill width | `--dur-2` linear |

Does not exist: hover lift or scale, animated underlines, fading content in, pulsing or glowing dots, skeleton shimmer, modal scale-in, sliding page transitions. The modal overlay fades in over 120ms; the modal itself appears in place. `prefers-reduced-motion: reduce` sets every duration to 0.01ms. Content never waits on an animation: the glyph's word and the value are present from the first frame.

## Microinteractions stance
Every interaction answers with a change of tone, never with movement. Hover: `--hover` fill on rows, `--text` on muted labels. Press: no translate. Focus: `:focus-visible` only, 2px `--focus` outline with 1px offset (inset -2px for rows and tabs inside clipped lists). Copy buttons in the tree appear on row hover and on `:focus-within`, so keyboard users get them too. Selected rows: `--primary-soft` fill, `--text` at 500, and their meta text moves from faint to muted. Keycaps are shown wherever a shortcut exists (search, Run, menus, Shortcuts settings).

## Signature moments
1. The landing. A run returns, and the summary row writes "= Returned" in Sentient. The lower bar draws in over 180ms; a throw strikes through the bars.
2. The ledger. The History list reads as a column of outcomes (`= = ≠ − =`) down the sidebar's left edge: a connection's last 50 runs at a glance.
3. "Output =". The Output tab carries the last outcome glyph after its label, so the tab reads as an assignment.
4. The grip. The split handle is the `=` itself (or `‖` side by side), faint at rest and verdigris on hover and drag.
5. The mark. The titlebar shows two bare bars, ink over verdigris, with no tile behind them.
6. Nothing came back. The empty output shows the `−` glyph at 20px with one Sentient line.

## What every surface MUST share
- Neutrals on hue 150 only; one accent (verdigris 172) spent only on the value channel, fills and focus.
- Switzer for UI, Commit Mono for data only, Sentient only in the named display roles at 13px or more.
- The 29° bar as the only ornament; outcomes as glyph + word.
- Radii from the scale; `--edge` instead of contrasting borders; shadows only on floating layers.
- 2px `--focus` ring on `:focus-visible`; tone-shift hover; no gradient anywhere.
- Tabular figures for every number and time; truncation with ellipsis on every single-line string.
- 26px controls, 26px sidebar rows, 24px tree and log rows, 28px menu rows, 34px tab strips, 36px titlebar, 26px statusbar.

## What may differ
- Tone per layer: floor `--bg`, desk `--panel`, wells `--panel-inset`, floating `--panel-raised`. Grain only on the floor.
- Density per region: tree and logs 24px, sidebar 26px, menus 28px, settings rows 48px minimum.
- The terminal's 16 ANSI colours bring in green 148, blue 245 and magenta 340. They exist only inside xterm, because there the colour belongs to the program's meaning (Laravel's labels, psysh's types, `git diff`).
- Light theme warning and inks are darker and more saturated, so they clear 4.5:1 on paper.
- Destructive confirms use `--danger-fill` (vermilion), not `--primary`.

## Palette → consumers (monaco / xterm / evergreen)
All consumer-read tokens are literal `oklch()` values (no `var()`, no `color-mix()`), resolved to hex at runtime through a 1px canvas (`utils/cssColor.js`). Every consumer re-reads them when `data-theme` changes.

monaco (`utils/monacoTheme.js`, base `vs-dark` / `vs`, inherit true)
| Key | Token |
|---|---|
| `editor.background`, `editorGutter.background` | `--panel-inset` |
| `editor.foreground` | `--text` |
| `editorLineNumber.foreground` | `--code-line` |
| `editorLineNumber.activeForeground` | `--code-line-active` |
| `editor.lineHighlightBackground` | `--code-caret-line` |
| `editor.lineHighlightBorder` | `#00000000` (literal) |
| `editorCursor.foreground` | `--accent` |
| `editor.selectionBackground` | `--selection` |
| `editorSuggestWidget.background`, `editorWidget.background`, `editorHoverWidget.background` | `--panel-raised` |
| `editorSuggestWidget.border`, `editorHoverWidget.border` | `--border-strong` |
| `editorSuggestWidget.foreground`, `editorSuggestWidget.selectedForeground` | `--text` |
| `editorSuggestWidget.selectedBackground` | `--primary-soft` |
| `editorSuggestWidget.highlightForeground` | `--accent` |
| `editorIndentGuide.background1` | `--border` |
| rule `keyword` | `--code-keyword` |
| rule `constant` | `--code-const` |
| rule `number` | `--code-num` |
| rule `string` | `--code-str` |
| rule `comment` (italic) | `--code-comment` |
| rule `variable` | `--code-var` |
| rule `delimiter` | `--code-op` |
| rule `identifier` | `--code-fn` |

xterm (`@xterm/xterm` 6, `utils/getTermOptions.js`), options `minimumContrastRatio: 4.5`, `fontFamily: --font-mono`, `lineHeight: 1.2`
| Key | Token |
|---|---|
| `foreground` | `--text` |
| `background`, `cursorAccent` | `--panel-inset` |
| `cursor` | `--accent` |
| `selectionBackground`, `selectionInactiveBackground` | `--selection` |
| `black` … `white` | `--ansi-black` … `--ansi-white` |
| `brightBlack` … `brightWhite` | `--ansi-bright-black` … `--ansi-bright-white` |

evergreen-ui 7 (`utils/uiTheme.js`, both modes)
| Key | Token |
|---|---|
| `colors.white` | `--panel-raised` |
| `colors.tint1` | `--panel` |
| `colors.tint2` | `--bg` |
| `colors.default`, `colors.dark` | `--text` |
| `colors.muted` | `--text-muted` |
| `colors.selected` | `--accent` |
| `colors.overlay` | `--overlay` |
| `colors.border.default` | `--field-edge` |
| `colors.border.muted` | `--border` |
| `colors.icon.default` / `.muted` / `.disabled` / `.selected` | `--text-muted` / `--text-faint` / `--border-strong` / `--accent` |
| `colors.text.danger` / `.success` / `.info` | `--error` / `--success` / `--accent` |
| `colors.blueTint`, `greenTint`, `tealTint`, `purpleTint` | `--primary-soft` |
| `colors.redTint` | `--error-soft` |
| `colors.orangeTint`, `yellowTint` | `--warning-soft` |
| `intents.info`, `intents.success` (background / border / text / icon) | `--accent-soft` / `--accent` / `--text` / `--accent` |
| `intents.warning` | `--warning-soft` / `--warning` / `--text` / `--warning` |
| `intents.danger` | `--error-soft` / `--error` / `--text` / `--error` |
| `fontFamilies.ui` / `.display` / `.mono` | `--font-ui` / `--font-display` / `--font-mono` |
| Button `primary` appearance: background / hover / text | `--primary` / `--primary-2` / `--primary-ink` |

## Contrast ledger
Minimum measured ratio per role, across every surface the role is allowed on (full table in the plan, §6).

| Role | Dark min | Light min | Rule |
|---|---|---|---|
| `--text` | 8.88 | 11.77 | everywhere |
| `--text-muted` | 5.11 | 5.93 | everywhere |
| `--text-faint` | 4.56 | 4.97 | never on `--primary-soft`: selected rows switch it to muted |
| `--accent` text | 6.06 | 5.40 | |
| `--error` text | 6.39 | 4.77 | |
| `--warning` text | 8.26 | 4.55 | |
| `--primary-ink` on fill | 5.47 | 4.98 | includes the keycap on Run |
| code and value inks (well, caret line, selection) | 4.71 | 4.91 | comment under selection is the minimum |
| ANSI foregrounds on the well | 5.08 | 4.76 | `black` (dark) and `white`/`brightWhite` (light) are background roles; xterm `minimumContrastRatio: 4.5` corrects label pairs |
| Focus ring (non-text) | 7.73 | 4.55 | |
| Field edge (non-text) | 3.09 | 3.14 | |

## Exports

### tokens.css
```css
/* Tinkr tokens. Paste over the token section at the top of public/tinkr.css.
   Every colour a non-CSS consumer reads is a literal oklch(); aliases are CSS-only. */

:root {
  color-scheme: dark;

  /* surfaces */
  --bg: oklch(0.215 0.007 150);            /* #171a18 floor: titlebar, sidebar, statusbar, rail */
  --panel: oklch(0.238 0.007 150);         /* #1d201d desk: tabbar, output tabs, settings sheet */
  --panel-raised: oklch(0.272 0.008 150);  /* #242825 floating or pressed: menus, modals, toasts, checked segments, cards */
  --panel-inset: oklch(0.190 0.006 150);   /* #121512 wells: monaco, value tree, terminal, logs, inputs */
  --overlay: oklch(0.12 0.006 150 / 0.62); /* modal scrim */

  /* lines */
  --border: oklch(0.315 0.008 150);        /* #2f332f only where two same-tone surfaces meet */
  --border-strong: oklch(0.40 0.010 150);  /* #444945 floating-layer edge, scrollbar thumb */
  --field-edge: oklch(0.55 0.010 150);     /* #6e736e input, checkbox, radio, switch-off boundary (3:1+) */
  --edge: color-mix(in oklch, var(--text) 8%, transparent);  /* self-coloured lip on desk and raised */
  --hover: color-mix(in oklch, var(--text) 6%, transparent); /* row and ghost-button hover */

  /* brand */
  --primary: oklch(0.42 0.065 172);        /* #205949 Run, checked controls, primary modal action */
  --primary-2: oklch(0.46 0.07 172);       /* #276553 hover of the fill */
  --primary-gradient: linear-gradient(var(--primary), var(--primary)); /* contract name kept, flat; no rule uses it */
  --primary-soft: oklch(0.80 0.085 172 / 0.14); /* selected rows; #26332e over --bg */
  --primary-ink: oklch(0.97 0.015 172);    /* #ecf9f4 text on the fill */
  --accent: oklch(0.80 0.085 172);         /* #82d0b7 the value channel: returned glyph, caret, links */
  --focus: oklch(0.78 0.09 172);           /* #77cab1 focus ring */
  --danger-fill: oklch(0.55 0.18 28);      /* #c5372f destructive confirm, window close hover (both themes) */
  --danger-fill-2: oklch(0.50 0.17 28);    /* hover of the destructive fill */
  --danger-ink: oklch(0.99 0 0);           /* text on the destructive fill, 5.17:1 */

  /* text */
  --text: oklch(0.93 0.008 150);           /* #e4e9e5 primary copy */
  --text-muted: oklch(0.76 0.010 150);     /* #adb3ae secondary copy, tree keys, delimiters */
  --text-faint: oklch(0.66 0.010 150);     /* #8e948f meta, timestamps, line numbers; never on --primary-soft */

  /* state */
  --error: oklch(0.75 0.13 30);            /* #f58d7c vermilion */
  --warning: oklch(0.82 0.11 80);          /* #eabc6e ochre */
  --success: oklch(0.80 0.085 172);        /* #82d0b7 success in Tinkr means the value landed */
  --error-soft: oklch(0.75 0.13 30 / 0.12);
  --warning-soft: oklch(0.82 0.11 80 / 0.12);
  --success-soft: oklch(0.80 0.085 172 / 0.12);
  --accent-soft: oklch(0.80 0.085 172 / 0.12);

  /* outcome */
  --outcome-returned: var(--accent);
  --outcome-printed: var(--text-muted);
  --outcome-threw: var(--error);

  /* code */
  --code-keyword: oklch(0.77 0.07 172);    /* #85c3af return, new, fn, use */
  --code-type: oklch(0.93 0.008 150);      /* #e4e9e5 class names, set at 600 */
  --code-fn: oklch(0.93 0.008 150);        /* #e4e9e5 identifiers */
  --code-str: oklch(0.84 0.08 105);        /* #d2ce91 straw */
  --code-num: oklch(0.80 0.09 58);         /* #eab084 copper */
  --code-const: oklch(0.80 0.06 235);      /* #99c5df sky: true, false, null, constants */
  --code-var: oklch(0.87 0.035 150);       /* #c5dbc8 celadon: $variables */
  --code-prop: oklch(0.76 0.010 150);      /* #adb3ae ->property, array keys */
  --code-op: oklch(0.76 0.010 150);        /* #adb3ae operators, punctuation */
  --code-comment: oklch(0.70 0.010 150);   /* #9aa09b italic */
  --code-line: oklch(0.66 0.010 150);      /* #8e948f gutter numbers */
  --code-line-active: oklch(0.93 0.008 150); /* #e4e9e5 current line number */
  --code-caret-line: oklch(0.225 0.008 150); /* #191d1a current-line band */
  --selection: oklch(0.80 0.085 172 / 0.18); /* #263730 over the well */

  /* value tree */
  --val-string: var(--code-str);
  --val-number: var(--code-num);
  --val-bool: var(--code-const);
  --val-null: var(--text-faint);
  --val-key: var(--text-muted);
  --val-class: var(--text);

  /* terminal (xterm reads these) */
  --ansi-black: oklch(0.33 0.008 150);          /* #333733 background role */
  --ansi-red: oklch(0.72 0.14 28);              /* #ef7f72 */
  --ansi-green: oklch(0.78 0.11 148);           /* #85cb8f */
  --ansi-yellow: oklch(0.83 0.11 85);           /* #e8c270 */
  --ansi-blue: oklch(0.74 0.08 245);            /* #80b1da */
  --ansi-magenta: oklch(0.74 0.09 340);         /* #d295bd */
  --ansi-cyan: oklch(0.78 0.08 192);            /* #77c8c4 */
  --ansi-white: oklch(0.82 0.010 150);          /* #c0c6c1 */
  --ansi-bright-black: oklch(0.62 0.010 150);   /* #828883 psysh dim text */
  --ansi-bright-red: oklch(0.80 0.11 30);       /* #fda293 */
  --ansi-bright-green: oklch(0.86 0.10 148);    /* #a4e4ac */
  --ansi-bright-yellow: oklch(0.90 0.10 90);    /* #f8dc90 */
  --ansi-bright-blue: oklch(0.83 0.07 245);     /* #a2cdf2 */
  --ansi-bright-magenta: oklch(0.83 0.08 340);  /* #ecb3d8 */
  --ansi-bright-cyan: oklch(0.87 0.07 192);     /* #9de3e0 */
  --ansi-bright-white: oklch(0.97 0.006 150);   /* #f2f6f3 */

  /* shape */
  --r-key: 4px;
  --r-btn: 5px;
  --r-panel: 7px;
  --r-modal: 10px;
  --r-pill: 999px;
  --bar-skew: -29deg;                      /* the return-bar cut */

  /* spacing: 4 / 8 scale */
  --s1: 4px;
  --s2: 8px;
  --s3: 12px;
  --s4: 16px;
  --s5: 24px;
  --s6: 32px;
  --s7: 48px;

  /* type */
  --font-ui: "Switzer", ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans", sans-serif;
  --font-display: "Sentient", "Iowan Old Style", Charter, Georgia, serif;
  --font-mono: "Commit Mono", ui-monospace, "SF Mono", "Cascadia Mono", "DejaVu Sans Mono", monospace;
  --fs-xs: 11px;    /* keycaps, statusbar, timestamps */
  --fs-sm: 12px;    /* buttons, tabs, labels, help, paths */
  --fs-md: 13px;    /* body, rows */
  --fs-lg: 15px;    /* wordmark, modal titles, empty states (Sentient) */
  --fs-xl: 18px;    /* settings group titles (Sentient) */
  --fs-code: 13px;
  --fw-regular: 400;
  --fw-medium: 500;
  --fw-strong: 600;
  --lh-ui: 1.45;
  --lh-tight: 1.2;
  --lh-code: 1.6;

  /* elevation: floating layers only, cast downward */
  --shadow-pop: inset 0 1px 0 oklch(1 0 0 / 0.04), 0 2px 4px -2px oklch(0.08 0.01 150 / 0.55), 0 8px 18px -8px oklch(0.08 0.01 150 / 0.6);
  --shadow-modal: inset 0 1px 0 oklch(1 0 0 / 0.05), 0 20px 44px -18px oklch(0.06 0.01 150 / 0.75);
  --shadow-primary: none;
  --ring: 0 0 0 2px var(--focus);

  /* motion */
  --dur-1: 90ms;
  --dur-2: 160ms;
  --dur-3: 180ms;
  --ease: cubic-bezier(0.2, 0.7, 0.2, 1);

  /* metrics */
  --titlebar-h: 36px;
  --statusbar-h: 26px;
  --tabbar-h: 34px;
  --row-h: 26px;
  --tree-row-h: 24px;
  --control-h: 26px;
  --keycap-band: 88px;
  --sidebar-w: 240px;
  --rail-w: 184px;
  --desk-gap: 6px;

  /* texture: floor only */
  --grain: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .045 0'/></filter><rect width='180' height='180' filter='url(%23g)'/></svg>");
}

[data-theme="light"] {
  color-scheme: light;

  --bg: oklch(0.952 0.011 150);            /* #eaf1eb floor */
  --panel: oklch(0.972 0.008 150);         /* #f2f7f3 desk */
  --panel-raised: oklch(0.993 0.004 150);  /* #fbfefb floating, cards */
  --panel-inset: oklch(0.988 0.005 150);   /* #f9fcf9 wells: the brightest paper */
  --overlay: oklch(0.25 0.012 150 / 0.32);

  --border: oklch(0.885 0.012 150);        /* #d4dbd5 */
  --border-strong: oklch(0.80 0.014 150);  /* #b8c0b9 */
  --field-edge: oklch(0.62 0.014 150);     /* #808982 */
  --hover: color-mix(in oklch, var(--text) 5%, transparent);

  --primary: oklch(0.45 0.075 172);        /* #1d6350 */
  --primary-2: oklch(0.40 0.075 172);      /* #075443 hover goes darker on paper */
  --primary-soft: oklch(0.47 0.08 172 / 0.12); /* #d1e1d9 over --bg */
  --primary-ink: oklch(0.985 0.01 172);    /* #f4fcf9 */
  --accent: oklch(0.47 0.08 172);          /* #1d6956 */
  --focus: oklch(0.52 0.10 172);           /* #047b62 */

  --text: oklch(0.25 0.012 150);           /* #1e231f */
  --text-muted: oklch(0.43 0.012 150);     /* #4b524c */
  --text-faint: oklch(0.49 0.012 150);     /* #5c625d */

  --error: oklch(0.53 0.17 30);            /* #ba3728 */
  --warning: oklch(0.53 0.11 70);          /* #945f0e */
  --success: oklch(0.47 0.08 172);         /* #1d6956 */
  --error-soft: oklch(0.53 0.17 30 / 0.10);
  --warning-soft: oklch(0.53 0.11 70 / 0.10);
  --success-soft: oklch(0.47 0.08 172 / 0.10);
  --accent-soft: oklch(0.47 0.08 172 / 0.10);

  --code-keyword: oklch(0.46 0.08 172);    /* #196653 */
  --code-type: oklch(0.25 0.012 150);      /* #1e231f */
  --code-fn: oklch(0.25 0.012 150);        /* #1e231f */
  --code-str: oklch(0.48 0.09 110);        /* #61621c olive */
  --code-num: oklch(0.50 0.12 52);         /* #974c12 copper */
  --code-const: oklch(0.48 0.09 245);      /* #2c628d slate */
  --code-var: oklch(0.36 0.04 150);        /* #2e4332 */
  --code-prop: oklch(0.43 0.012 150);      /* #4b524c */
  --code-op: oklch(0.43 0.012 150);        /* #4b524c */
  --code-comment: oklch(0.49 0.012 150);   /* #5c625d italic */
  --code-line: oklch(0.49 0.012 150);      /* #5c625d */
  --code-line-active: oklch(0.25 0.012 150); /* #1e231f */
  --code-caret-line: oklch(0.962 0.010 150); /* #eef4ef */
  --selection: oklch(0.47 0.08 172 / 0.14); /* #dae7e2 over the well */

  --ansi-black: oklch(0.25 0.012 150);          /* #1e231f */
  --ansi-red: oklch(0.52 0.16 28);              /* #b33830 */
  --ansi-green: oklch(0.50 0.12 148);           /* #277539 */
  --ansi-yellow: oklch(0.55 0.11 75);           /* #976712 */
  --ansi-blue: oklch(0.48 0.11 250);            /* #246099 */
  --ansi-magenta: oklch(0.50 0.13 345);         /* #954074 */
  --ansi-cyan: oklch(0.50 0.08 195);            /* #157171 */
  --ansi-white: oklch(0.93 0.008 150);          /* #e4e9e5 background role */
  --ansi-bright-black: oklch(0.50 0.012 150);   /* #5f6560 */
  --ansi-bright-red: oklch(0.48 0.17 25);       /* #a92227 intense = darker on paper */
  --ansi-bright-green: oklch(0.45 0.12 148);    /* #13662b */
  --ansi-bright-yellow: oklch(0.50 0.10 75);    /* #845a0f */
  --ansi-bright-blue: oklch(0.43 0.12 252);     /* #0e518f */
  --ansi-bright-magenta: oklch(0.45 0.14 345);  /* #882d67 */
  --ansi-bright-cyan: oklch(0.45 0.075 195);    /* #076262 */
  --ansi-bright-white: oklch(0.99 0.003 150);   /* #fafcfb background role */

  --shadow-pop: 0 2px 4px -2px oklch(0.30 0.03 150 / 0.16), 0 8px 18px -8px oklch(0.30 0.03 150 / 0.20);
  --shadow-modal: 0 20px 44px -18px oklch(0.30 0.03 150 / 0.30);

  --grain: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .05 0'/></filter><rect width='180' height='180' filter='url(%23g)'/></svg>");
}

@media (prefers-reduced-motion: reduce) {
  :root { --dur-1: 0.01ms; --dur-2: 0.01ms; --dur-3: 0.01ms; }
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

### Tailwind v4 @theme
For a future Tailwind surface only; the app itself has no Tailwind. `inline` so utilities read the live token. The font keys are named `heading` and `code` because `--font-mono: var(--font-mono)` would reference itself. Keep tinkr.css unlayered, so it wins over Tailwind's `@layer theme` defaults.
```css
@theme inline {
  --color-bg: var(--bg);
  --color-panel: var(--panel);
  --color-panel-raised: var(--panel-raised);
  --color-panel-inset: var(--panel-inset);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-field-edge: var(--field-edge);
  --color-primary: var(--primary);
  --color-primary-hover: var(--primary-2);
  --color-primary-soft: var(--primary-soft);
  --color-primary-ink: var(--primary-ink);
  --color-accent: var(--accent);
  --color-focus: var(--focus);
  --color-ink: var(--text);
  --color-ink-muted: var(--text-muted);
  --color-ink-faint: var(--text-faint);
  --color-error: var(--error);
  --color-warning: var(--warning);
  --color-success: var(--success);
  --color-danger: var(--danger-fill);
  --font-sans: var(--font-ui);
  --font-heading: var(--font-display);
  --font-code: var(--font-mono);
  --radius-key: var(--r-key);
  --radius-btn: var(--r-btn);
  --radius-panel: var(--r-panel);
  --radius-modal: var(--r-modal);
  --spacing: 4px;
  --shadow-pop: var(--shadow-pop);
  --shadow-modal: var(--shadow-modal);
  --ease-tinkr: var(--ease);
}
```

### DTCG tokens.json
```json
{
  "color": {
    "$type": "color",
    "dark": {
      "bg": {"$value": {"colorSpace": "oklch", "components": [0.215, 0.007, 150], "hex": "#171a18"}},
      "panel": {"$value": {"colorSpace": "oklch", "components": [0.238, 0.007, 150], "hex": "#1d201d"}},
      "panel-raised": {"$value": {"colorSpace": "oklch", "components": [0.272, 0.008, 150], "hex": "#242825"}},
      "panel-inset": {"$value": {"colorSpace": "oklch", "components": [0.190, 0.006, 150], "hex": "#121512"}},
      "overlay": {"$value": {"colorSpace": "oklch", "components": [0.12, 0.006, 150], "alpha": 0.62}},
      "border": {"$value": {"colorSpace": "oklch", "components": [0.315, 0.008, 150], "hex": "#2f332f"}},
      "border-strong": {"$value": {"colorSpace": "oklch", "components": [0.40, 0.010, 150], "hex": "#444945"}},
      "field-edge": {"$value": {"colorSpace": "oklch", "components": [0.55, 0.010, 150], "hex": "#6e736e"}},
      "primary": {"$value": {"colorSpace": "oklch", "components": [0.42, 0.065, 172], "hex": "#205949"}},
      "primary-2": {"$value": {"colorSpace": "oklch", "components": [0.46, 0.07, 172], "hex": "#276553"}},
      "primary-soft": {"$value": {"colorSpace": "oklch", "components": [0.80, 0.085, 172], "alpha": 0.14}},
      "primary-ink": {"$value": {"colorSpace": "oklch", "components": [0.97, 0.015, 172], "hex": "#ecf9f4"}},
      "accent": {"$value": {"colorSpace": "oklch", "components": [0.80, 0.085, 172], "hex": "#82d0b7"}},
      "focus": {"$value": {"colorSpace": "oklch", "components": [0.78, 0.09, 172], "hex": "#77cab1"}},
      "danger-fill": {"$value": {"colorSpace": "oklch", "components": [0.55, 0.18, 28], "hex": "#c5372f"}},
      "text": {"$value": {"colorSpace": "oklch", "components": [0.93, 0.008, 150], "hex": "#e4e9e5"}},
      "text-muted": {"$value": {"colorSpace": "oklch", "components": [0.76, 0.010, 150], "hex": "#adb3ae"}},
      "text-faint": {"$value": {"colorSpace": "oklch", "components": [0.66, 0.010, 150], "hex": "#8e948f"}},
      "error": {"$value": {"colorSpace": "oklch", "components": [0.75, 0.13, 30], "hex": "#f58d7c"}},
      "warning": {"$value": {"colorSpace": "oklch", "components": [0.82, 0.11, 80], "hex": "#eabc6e"}},
      "success": {"$value": "{color.dark.accent}"},
      "code-keyword": {"$value": {"colorSpace": "oklch", "components": [0.77, 0.07, 172], "hex": "#85c3af"}},
      "code-type": {"$value": "{color.dark.text}"},
      "code-fn": {"$value": "{color.dark.text}"},
      "code-str": {"$value": {"colorSpace": "oklch", "components": [0.84, 0.08, 105], "hex": "#d2ce91"}},
      "code-num": {"$value": {"colorSpace": "oklch", "components": [0.80, 0.09, 58], "hex": "#eab084"}},
      "code-const": {"$value": {"colorSpace": "oklch", "components": [0.80, 0.06, 235], "hex": "#99c5df"}},
      "code-var": {"$value": {"colorSpace": "oklch", "components": [0.87, 0.035, 150], "hex": "#c5dbc8"}},
      "code-prop": {"$value": "{color.dark.text-muted}"},
      "code-op": {"$value": "{color.dark.text-muted}"},
      "code-comment": {"$value": {"colorSpace": "oklch", "components": [0.70, 0.010, 150], "hex": "#9aa09b"}},
      "code-line": {"$value": "{color.dark.text-faint}"},
      "code-line-active": {"$value": "{color.dark.text}"},
      "code-caret-line": {"$value": {"colorSpace": "oklch", "components": [0.225, 0.008, 150], "hex": "#191d1a"}},
      "selection": {"$value": {"colorSpace": "oklch", "components": [0.80, 0.085, 172], "alpha": 0.18}},
      "ansi-black": {"$value": {"colorSpace": "oklch", "components": [0.33, 0.008, 150], "hex": "#333733"}},
      "ansi-red": {"$value": {"colorSpace": "oklch", "components": [0.72, 0.14, 28], "hex": "#ef7f72"}},
      "ansi-green": {"$value": {"colorSpace": "oklch", "components": [0.78, 0.11, 148], "hex": "#85cb8f"}},
      "ansi-yellow": {"$value": {"colorSpace": "oklch", "components": [0.83, 0.11, 85], "hex": "#e8c270"}},
      "ansi-blue": {"$value": {"colorSpace": "oklch", "components": [0.74, 0.08, 245], "hex": "#80b1da"}},
      "ansi-magenta": {"$value": {"colorSpace": "oklch", "components": [0.74, 0.09, 340], "hex": "#d295bd"}},
      "ansi-cyan": {"$value": {"colorSpace": "oklch", "components": [0.78, 0.08, 192], "hex": "#77c8c4"}},
      "ansi-white": {"$value": {"colorSpace": "oklch", "components": [0.82, 0.010, 150], "hex": "#c0c6c1"}},
      "ansi-bright-black": {"$value": {"colorSpace": "oklch", "components": [0.62, 0.010, 150], "hex": "#828883"}},
      "ansi-bright-red": {"$value": {"colorSpace": "oklch", "components": [0.80, 0.11, 30], "hex": "#fda293"}},
      "ansi-bright-green": {"$value": {"colorSpace": "oklch", "components": [0.86, 0.10, 148], "hex": "#a4e4ac"}},
      "ansi-bright-yellow": {"$value": {"colorSpace": "oklch", "components": [0.90, 0.10, 90], "hex": "#f8dc90"}},
      "ansi-bright-blue": {"$value": {"colorSpace": "oklch", "components": [0.83, 0.07, 245], "hex": "#a2cdf2"}},
      "ansi-bright-magenta": {"$value": {"colorSpace": "oklch", "components": [0.83, 0.08, 340], "hex": "#ecb3d8"}},
      "ansi-bright-cyan": {"$value": {"colorSpace": "oklch", "components": [0.87, 0.07, 192], "hex": "#9de3e0"}},
      "ansi-bright-white": {"$value": {"colorSpace": "oklch", "components": [0.97, 0.006, 150], "hex": "#f2f6f3"}}
    },
    "light": {
      "bg": {"$value": {"colorSpace": "oklch", "components": [0.952, 0.011, 150], "hex": "#eaf1eb"}},
      "panel": {"$value": {"colorSpace": "oklch", "components": [0.972, 0.008, 150], "hex": "#f2f7f3"}},
      "panel-raised": {"$value": {"colorSpace": "oklch", "components": [0.993, 0.004, 150], "hex": "#fbfefb"}},
      "panel-inset": {"$value": {"colorSpace": "oklch", "components": [0.988, 0.005, 150], "hex": "#f9fcf9"}},
      "overlay": {"$value": {"colorSpace": "oklch", "components": [0.25, 0.012, 150], "alpha": 0.32}},
      "border": {"$value": {"colorSpace": "oklch", "components": [0.885, 0.012, 150], "hex": "#d4dbd5"}},
      "border-strong": {"$value": {"colorSpace": "oklch", "components": [0.80, 0.014, 150], "hex": "#b8c0b9"}},
      "field-edge": {"$value": {"colorSpace": "oklch", "components": [0.62, 0.014, 150], "hex": "#808982"}},
      "primary": {"$value": {"colorSpace": "oklch", "components": [0.45, 0.075, 172], "hex": "#1d6350"}},
      "primary-2": {"$value": {"colorSpace": "oklch", "components": [0.40, 0.075, 172], "hex": "#075443"}},
      "primary-soft": {"$value": {"colorSpace": "oklch", "components": [0.47, 0.08, 172], "alpha": 0.12}},
      "primary-ink": {"$value": {"colorSpace": "oklch", "components": [0.985, 0.01, 172], "hex": "#f4fcf9"}},
      "accent": {"$value": {"colorSpace": "oklch", "components": [0.47, 0.08, 172], "hex": "#1d6956"}},
      "focus": {"$value": {"colorSpace": "oklch", "components": [0.52, 0.10, 172], "hex": "#047b62"}},
      "danger-fill": {"$value": "{color.dark.danger-fill}"},
      "text": {"$value": {"colorSpace": "oklch", "components": [0.25, 0.012, 150], "hex": "#1e231f"}},
      "text-muted": {"$value": {"colorSpace": "oklch", "components": [0.43, 0.012, 150], "hex": "#4b524c"}},
      "text-faint": {"$value": {"colorSpace": "oklch", "components": [0.49, 0.012, 150], "hex": "#5c625d"}},
      "error": {"$value": {"colorSpace": "oklch", "components": [0.53, 0.17, 30], "hex": "#ba3728"}},
      "warning": {"$value": {"colorSpace": "oklch", "components": [0.53, 0.11, 70], "hex": "#945f0e"}},
      "success": {"$value": "{color.light.accent}"},
      "code-keyword": {"$value": {"colorSpace": "oklch", "components": [0.46, 0.08, 172], "hex": "#196653"}},
      "code-type": {"$value": "{color.light.text}"},
      "code-fn": {"$value": "{color.light.text}"},
      "code-str": {"$value": {"colorSpace": "oklch", "components": [0.48, 0.09, 110], "hex": "#61621c"}},
      "code-num": {"$value": {"colorSpace": "oklch", "components": [0.50, 0.12, 52], "hex": "#974c12"}},
      "code-const": {"$value": {"colorSpace": "oklch", "components": [0.48, 0.09, 245], "hex": "#2c628d"}},
      "code-var": {"$value": {"colorSpace": "oklch", "components": [0.36, 0.04, 150], "hex": "#2e4332"}},
      "code-prop": {"$value": "{color.light.text-muted}"},
      "code-op": {"$value": "{color.light.text-muted}"},
      "code-comment": {"$value": "{color.light.text-faint}"},
      "code-line": {"$value": "{color.light.text-faint}"},
      "code-line-active": {"$value": "{color.light.text}"},
      "code-caret-line": {"$value": {"colorSpace": "oklch", "components": [0.962, 0.010, 150], "hex": "#eef4ef"}},
      "selection": {"$value": {"colorSpace": "oklch", "components": [0.47, 0.08, 172], "alpha": 0.14}},
      "ansi-black": {"$value": "{color.light.text}"},
      "ansi-red": {"$value": {"colorSpace": "oklch", "components": [0.52, 0.16, 28], "hex": "#b33830"}},
      "ansi-green": {"$value": {"colorSpace": "oklch", "components": [0.50, 0.12, 148], "hex": "#277539"}},
      "ansi-yellow": {"$value": {"colorSpace": "oklch", "components": [0.55, 0.11, 75], "hex": "#976712"}},
      "ansi-blue": {"$value": {"colorSpace": "oklch", "components": [0.48, 0.11, 250], "hex": "#246099"}},
      "ansi-magenta": {"$value": {"colorSpace": "oklch", "components": [0.50, 0.13, 345], "hex": "#954074"}},
      "ansi-cyan": {"$value": {"colorSpace": "oklch", "components": [0.50, 0.08, 195], "hex": "#157171"}},
      "ansi-white": {"$value": {"colorSpace": "oklch", "components": [0.93, 0.008, 150], "hex": "#e4e9e5"}},
      "ansi-bright-black": {"$value": {"colorSpace": "oklch", "components": [0.50, 0.012, 150], "hex": "#5f6560"}},
      "ansi-bright-red": {"$value": {"colorSpace": "oklch", "components": [0.48, 0.17, 25], "hex": "#a92227"}},
      "ansi-bright-green": {"$value": {"colorSpace": "oklch", "components": [0.45, 0.12, 148], "hex": "#13662b"}},
      "ansi-bright-yellow": {"$value": {"colorSpace": "oklch", "components": [0.50, 0.10, 75], "hex": "#845a0f"}},
      "ansi-bright-blue": {"$value": {"colorSpace": "oklch", "components": [0.43, 0.12, 252], "hex": "#0e518f"}},
      "ansi-bright-magenta": {"$value": {"colorSpace": "oklch", "components": [0.45, 0.14, 345], "hex": "#882d67"}},
      "ansi-bright-cyan": {"$value": {"colorSpace": "oklch", "components": [0.45, 0.075, 195], "hex": "#076262"}},
      "ansi-bright-white": {"$value": {"colorSpace": "oklch", "components": [0.99, 0.003, 150], "hex": "#fafcfb"}}
    }
  },
  "dimension": {
    "$type": "dimension",
    "r-key": {"$value": {"value": 4, "unit": "px"}},
    "r-btn": {"$value": {"value": 5, "unit": "px"}},
    "r-panel": {"$value": {"value": 7, "unit": "px"}},
    "r-modal": {"$value": {"value": 10, "unit": "px"}},
    "s1": {"$value": {"value": 4, "unit": "px"}},
    "s2": {"$value": {"value": 8, "unit": "px"}},
    "s3": {"$value": {"value": 12, "unit": "px"}},
    "s4": {"$value": {"value": 16, "unit": "px"}},
    "s5": {"$value": {"value": 24, "unit": "px"}},
    "s6": {"$value": {"value": 32, "unit": "px"}},
    "s7": {"$value": {"value": 48, "unit": "px"}},
    "fs-xs": {"$value": {"value": 11, "unit": "px"}},
    "fs-sm": {"$value": {"value": 12, "unit": "px"}},
    "fs-md": {"$value": {"value": 13, "unit": "px"}},
    "fs-lg": {"$value": {"value": 15, "unit": "px"}},
    "fs-xl": {"$value": {"value": 18, "unit": "px"}},
    "fs-code": {"$value": {"value": 13, "unit": "px"}},
    "titlebar-h": {"$value": {"value": 36, "unit": "px"}},
    "statusbar-h": {"$value": {"value": 26, "unit": "px"}},
    "tabbar-h": {"$value": {"value": 34, "unit": "px"}},
    "row-h": {"$value": {"value": 26, "unit": "px"}},
    "tree-row-h": {"$value": {"value": 24, "unit": "px"}},
    "control-h": {"$value": {"value": 26, "unit": "px"}},
    "sidebar-w": {"$value": {"value": 240, "unit": "px"}},
    "rail-w": {"$value": {"value": 184, "unit": "px"}},
    "desk-gap": {"$value": {"value": 6, "unit": "px"}}
  },
  "fontFamily": {
    "$type": "fontFamily",
    "ui": {"$value": ["Switzer", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Noto Sans", "sans-serif"]},
    "display": {"$value": ["Sentient", "Iowan Old Style", "Charter", "Georgia", "serif"]},
    "mono": {"$value": ["Commit Mono", "ui-monospace", "SF Mono", "Cascadia Mono", "DejaVu Sans Mono", "monospace"]}
  },
  "fontWeight": {
    "$type": "fontWeight",
    "regular": {"$value": 400},
    "medium": {"$value": 500},
    "strong": {"$value": 600}
  },
  "duration": {
    "$type": "duration",
    "dur-1": {"$value": {"value": 90, "unit": "ms"}},
    "dur-2": {"$value": {"value": 160, "unit": "ms"}},
    "dur-3": {"$value": {"value": 180, "unit": "ms"}}
  },
  "cubicBezier": {
    "$type": "cubicBezier",
    "ease": {"$value": [0.2, 0.7, 0.2, 1]}
  }
}
```

### shadcn/ui CSS variables
shadcn's names `--primary`, `--accent`, `--border` and `--ring` collide with Tinkr's own, and `--x: var(--x)` is a cycle. So the bridge aliases through `--tk-*` on `:root`, and the shadcn names live only inside a `[data-ui="shadcn"]` island. Inside that island, Tinkr rules that read `--accent` would get shadcn's hover fill, so no Tinkr component may live inside it.
```css
:root {
  --tk-bg: var(--panel);
  --tk-fg: var(--text);
  --tk-card: var(--panel-raised);
  --tk-primary: var(--primary);
  --tk-primary-fg: var(--primary-ink);
  --tk-muted: var(--panel);
  --tk-muted-fg: var(--text-muted);
  --tk-accent-fill: var(--primary-soft);
  --tk-border: var(--border);
  --tk-input: var(--field-edge);
  --tk-ring: var(--focus);
  --tk-destructive: var(--danger-fill);
}

[data-ui="shadcn"] {
  --background: var(--tk-bg);
  --foreground: var(--tk-fg);
  --card: var(--tk-card);
  --card-foreground: var(--tk-fg);
  --popover: var(--tk-card);
  --popover-foreground: var(--tk-fg);
  --primary: var(--tk-primary);
  --primary-foreground: var(--tk-primary-fg);
  --secondary: var(--tk-card);
  --secondary-foreground: var(--tk-fg);
  --muted: var(--tk-muted);
  --muted-foreground: var(--tk-muted-fg);
  --accent: var(--tk-accent-fill);
  --accent-foreground: var(--tk-fg);
  --destructive: var(--tk-destructive);
  --border: var(--tk-border);
  --input: var(--tk-input);
  --ring: var(--tk-ring);
  --radius: 7px;
}
```
