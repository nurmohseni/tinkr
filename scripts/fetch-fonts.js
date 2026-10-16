/**
 * The two ITF faces the interface sets in, fetched at build time.
 *
 * Switzer (the UI) and Sentient (the display roles) come from Fontshare under
 * the ITF Free Font License, which allows an app to embed them but does not
 * allow the files to travel through a repository. They are therefore kept out
 * of git and fetched, unaltered, into the renderer's public/fonts/itf — the
 * two woff2 out of each family's own webfont build, nothing converted.
 *
 * A machine with no network still builds: the faces are skipped with a warning
 * and every stack falls back to the system faces the tokens name.
 */
const {execFileSync} = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const out = path.join(__dirname, '..', 'packages', 'tinkr-renderer', 'public', 'fonts', 'itf')

const families = [
  {
    url: 'https://api.fontshare.com/v2/fonts/download/switzer',
    files: {
      'Switzer_Complete/Fonts/WEB/fonts/Switzer-Variable.woff2': 'Switzer-Variable.woff2',
      'Switzer_Complete/Fonts/WEB/fonts/Switzer-VariableItalic.woff2': 'Switzer-VariableItalic.woff2',
    },
  },
  {
    url: 'https://api.fontshare.com/v2/fonts/download/sentient',
    files: {
      'Sentient_Complete/Fonts/WEB/fonts/Sentient-Variable.woff2': 'Sentient-Variable.woff2',
    },
  },
]

const wanted = families.flatMap(family => Object.values(family.files))

if (wanted.every(name => fs.existsSync(path.join(out, name)))) {
  console.log(`fonts: ${wanted.length} files already in public/fonts/itf`)

  return
}

fs.mkdirSync(out, {recursive: true})

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkr-fonts-'))

// A release must not ship without the faces it was designed in: in CI a failed
// fetch fails the build. A checkout is different — an offline contributor still
// gets an app to run, on the fallbacks the tokens name.
const inCi = Boolean(process.env.CI)

try {
  for (const family of families) {
    const zip = path.join(scratch, `${path.basename(family.url)}.zip`)

    console.log(`fonts: ${family.url}`)
    execFileSync('curl', ['-fsS', '-m', '120', '-L', '-o', zip, family.url], {stdio: 'inherit'})

    for (const [member, name] of Object.entries(family.files)) {
      const target = path.join(out, name)

      // unzip -p writes the member to stdout, so only the one file is extracted
      fs.writeFileSync(target, execFileSync('unzip', ['-p', zip, member], {maxBuffer: 32 * 1024 * 1024}))
      console.log(`  ${name}  ${fs.statSync(target).size} bytes`)
    }
  }
} catch (error) {
  if (inCi) {
    throw error
  }

  console.warn(`fonts: could not fetch them (${error.message}); the interface will fall back to the system faces`)
} finally {
  fs.rmSync(scratch, {recursive: true, force: true})
}
