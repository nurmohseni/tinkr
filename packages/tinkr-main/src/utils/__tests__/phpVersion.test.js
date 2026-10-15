const {phpVersionOf} = require('../phpVersion')

// every answer below is one the detection really met, escapes and all
describe.each([
  // what `php -v` writes, from the first line
  ['PHP 8.5.11 (cli) (built: Sep 24 2026 19:14:44) (NTS)\nCopyright (c) The PHP Group\n', '8.5.11'],

  // a distribution's build carries its own suffix
  ['PHP 8.1.2-1ubuntu2.14 (cli) (built: Aug 18 2023 11:41:21) (NTS)\n', '8.1.2-1ubuntu2.14'],

  // what the shell has already written when the answer arrives: the echoed
  // command, then its prompt with the shell-integration escape in it
  ['php -d cli.pager=cat -v\r\n\u001b]0;noor@fedora:~\u0007\u001b]3008;start=9dcd28c1;type=shell;pid=556537;cwd=/home/noor\u001b\\\u001b[?2004h\r\nPHP 8.4.26 (cli) (built: Sep 24 2026 19:14:44) (NTS)\r\n', '8.4.26'],

  // the version is read before anything that follows it
  ['PHP 8.5.10 (cli)\nCopyright (c) The PHP Group\nZend Engine v4.5.10, Copyright (c) Zend Technologies\n', '8.5.10'],

  // a shell whose php is not on the path says so in its own words
  ['bash: php: command not found\n', null],

  // and one that never answered says nothing
  ['', null],
  ['\u001b]3008;start=1;type=shell;pid=7;cwd=/home/noor\u001b\\\r\nnoor@fedora:~$ ', null],
  [null, null],

  // PHP has to be a word of its own: a name that merely ends in it is not php
  ['myPHP 8.4.26 (cli)\n', null],
  ['phpx 8.4.26 (cli)\n', null],

  // and it has to carry three parts: a version is not a guess
  ['PHP 8 (cli)\n', null],
  ['PHP 8.5 (cli)\n', null],
])

('phpVersionOf(%j)', (output, expected) => {
  it(`reads ${expected}`, () => {
    expect(phpVersionOf(output)).toBe(expected)
  })
})
