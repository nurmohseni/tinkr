const {phpString} = require('./runResult')

/**
 * The php that asks a project about itself, as text.
 *
 * A snippet editor's popup needs what the project is made of — models with their
 * columns, builder methods, facades, config keys, route names — and none of it is
 * in a file: it is in the framework the project boots. So the project is asked,
 * in a process of its own, and answers json.
 *
 * Two programs, because they cost different things: the whole reading boots the
 * app once and is asked after a connection opens or a run ends (see
 * services/intel); a single class's members are read straight off the autoloader,
 * without booting anything, and are asked for the first time a name needs them.
 *
 * The programs are written as raw templates rather than concatenated strings:
 * php is mostly quotes and backslashes, and a template keeps the program readable
 * as the program it is. `$` is safe in one — a template only interpolates
 * `${`, which php never writes here. Both start with `<?php` because that is
 * what travels: the runner base64-encodes the program and evaluates it behind a
 * `?>`, which is how a whole file is run from a `-r` argument.
 *
 * Nothing here reads a value out of the project: config is keys, env is key
 * names, translations are keys. A popup has no use for a secret, and a cache on
 * disk is the last place one should be written.
 */

/**
 * What a docblock says in prose, one line of it.
 *
 * A member's documentation is a sentence in a popup, not the file's whole
 * docblock: everything before the first blank line or the first tag, capped so a
 * paranoid docblock cannot grow an answer without bound.
 */
const text = String.raw`
$tinkr_text = function ($tinkr_doc) {
  if (!is_string($tinkr_doc) || $tinkr_doc === '') { return null; }
  $tinkr_doc = preg_replace('/^\s*\/\*\*/', '', $tinkr_doc);
  $tinkr_doc = preg_replace('/\*\/\s*$/', '', $tinkr_doc);
  $tinkr_lines = [];
  foreach (preg_split('/\R/', $tinkr_doc) as $tinkr_line) {
    $tinkr_line = trim(preg_replace('/^\s*\*\s?/', '', $tinkr_line));
    if ($tinkr_line === '') { if ($tinkr_lines) { break; } continue; }
    if ($tinkr_line[0] === '@') { break; }
    $tinkr_lines[] = $tinkr_line;
  }
  $tinkr_line = trim(implode(' ', $tinkr_lines));
  return $tinkr_line === '' ? null : substr($tinkr_line, 0, 240);
};

// a declared return type, or what the docblock promises when there is none: a
// @return $this is the only return type half of a builder ever writes
$tinkr_returns = function ($tinkr_reflection) {
  if ($tinkr_reflection->hasReturnType()) { return (string) $tinkr_reflection->getReturnType(); }
  $tinkr_doc = $tinkr_reflection->getDocComment();
  // a docblock writes the whole type as an expression, and cutting it at the first
  // space would cut Collection<int, TModel> in half: the editor reads where the
  // expression ends, so what is sent is the line it is written on
  if (is_string($tinkr_doc) && preg_match('/@return\s+([^\r\n]+)/', $tinkr_doc, $tinkr_match)) { return substr(trim($tinkr_match[1]), 0, 240); }
  return null;
};

// a default value as a signature writes it. An array is [] and a long string is
// cut, because this is a line in a popup rather than the value itself
$tinkr_value = function ($tinkr_default) {
  if ($tinkr_default === null) { return 'null'; }
  if (is_bool($tinkr_default)) { return $tinkr_default ? 'true' : 'false'; }
  if (is_string($tinkr_default)) { return "'" . (strlen($tinkr_default) > 24 ? substr($tinkr_default, 0, 24) . '...' : $tinkr_default) . "'"; }
  if (is_array($tinkr_default)) { return '[]'; }
  if (is_object($tinkr_default)) { return 'object'; }
  return (string) $tinkr_default;
};

$tinkr_param = function ($tinkr_parameter) use ($tinkr_value) {
  $tinkr_part = '';
  try {
    if ($tinkr_parameter->hasType()) { $tinkr_part .= (string) $tinkr_parameter->getType() . ' '; }
  } catch (\Throwable $tinkr_error) {}
  if ($tinkr_parameter->isPassedByReference()) { $tinkr_part .= '&'; }
  if ($tinkr_parameter->isVariadic()) { $tinkr_part .= '...'; }
  $tinkr_part .= '$' . $tinkr_parameter->getName();
  if (!$tinkr_parameter->isVariadic() && $tinkr_parameter->isDefaultValueAvailable()) {
    try {
      if ($tinkr_parameter->isDefaultValueConstant()) { $tinkr_part .= ' = ' . $tinkr_parameter->getDefaultValueConstantName(); }
      else { $tinkr_part .= ' = ' . $tinkr_value($tinkr_parameter->getDefaultValue()); }
    } catch (\Throwable $tinkr_error) {}
  }
  return $tinkr_part;
};

$tinkr_methods = function ($tinkr_class) use ($tinkr_param, $tinkr_returns, $tinkr_text) {
  $tinkr_methods = [];
  try {
    foreach ((new ReflectionClass($tinkr_class))->getMethods(ReflectionMethod::IS_PUBLIC) as $tinkr_method) {
      if (strpos($tinkr_method->getName(), '__') === 0) { continue; }
      $tinkr_params = [];
      foreach ($tinkr_method->getParameters() as $tinkr_parameter) { $tinkr_params[] = $tinkr_param($tinkr_parameter); }
      $tinkr_methods[] = [
        'name' => $tinkr_method->getName(),
        'static' => $tinkr_method->isStatic(),
        'params' => $tinkr_params,
        'returns' => $tinkr_returns($tinkr_method),
        'doc' => $tinkr_text($tinkr_method->getDocComment()),
        'declaring' => $tinkr_method->getDeclaringClass()->getName(),
      ];
    }
  } catch (\Throwable $tinkr_error) {}
  return $tinkr_methods;
};

// the members a docblock declares on a class's behalf, as the methods they are:
// Carbon writes addDays as an @method tag on its interface and declares none of
// it, and a chain that ends on that name has to be able to see it
$tinkr_documented = function ($tinkr_doc, $tinkr_owner) {
  $tinkr_out = [];
  if (!is_string($tinkr_doc) || $tinkr_doc === '') { return $tinkr_out; }
  if (!preg_match_all('/^\s*\*\s*@method\s+([^\r\n]+)/m', $tinkr_doc, $tinkr_matches)) { return $tinkr_out; }
  foreach ($tinkr_matches[1] as $tinkr_tag) {
    if (!preg_match('/^(.*?)([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/', $tinkr_tag, $tinkr_parts)) { continue; }
    $tinkr_head = trim($tinkr_parts[1]);
    $tinkr_static = (bool) preg_match('/^static\b/', $tinkr_head);
    $tinkr_head = trim(preg_replace('/^static\s+/', '', $tinkr_head));
    // a default holds commas of its own - array $options = [], [$a, $b] - so the
    // parameters are split on the commas that no bracket holds
    $tinkr_params = [];
    $tinkr_part = '';
    $tinkr_depth = 0;
    foreach (str_split($tinkr_parts[3]) as $tinkr_char) {
      if ($tinkr_char === '(' || $tinkr_char === '[' || $tinkr_char === '{') { $tinkr_depth++; }
      elseif ($tinkr_char === ')' || $tinkr_char === ']' || $tinkr_char === '}') { $tinkr_depth--; }
      if ($tinkr_char === ',' && $tinkr_depth === 0) { $tinkr_params[] = trim($tinkr_part); $tinkr_part = ''; continue; }
      $tinkr_part .= $tinkr_char;
    }
    if (trim($tinkr_part) !== '') { $tinkr_params[] = trim($tinkr_part); }
    $tinkr_out[] = [
      'name' => $tinkr_parts[2],
      'static' => $tinkr_static,
      'params' => $tinkr_params,
      'returns' => $tinkr_head === '' ? null : $tinkr_head,
      'doc' => null,
      'declaring' => $tinkr_owner,
    ];
  }
  return $tinkr_out;
};

// everything a name can be a member of: what it declares and inherits, the
// properties it offers, the constants it carries, and the docblock a facade
// writes its real members in
$tinkr_class = function ($tinkr_name) use ($tinkr_methods, $tinkr_text, $tinkr_documented) {
  try { $tinkr_reflection = new ReflectionClass($tinkr_name); }
  catch (\Throwable $tinkr_error) { return null; }
  $tinkr_out = [
    'class' => $tinkr_reflection->getName(),
    'kind' => $tinkr_reflection->isInterface() ? 'interface'
      : ($tinkr_reflection->isTrait() ? 'trait'
        : (method_exists($tinkr_reflection, 'isEnum') && $tinkr_reflection->isEnum() ? 'enum' : 'class')),
    'abstract' => $tinkr_reflection->isAbstract(),
    'doc' => is_string($tinkr_reflection->getDocComment()) ? substr($tinkr_reflection->getDocComment(), 0, 20000) : null,
    'parents' => [],
    'interfaces' => array_values($tinkr_reflection->getInterfaceNames()),
    'traits' => array_values($tinkr_reflection->getTraitNames()),
    'methods' => $tinkr_methods($tinkr_name),
    'properties' => [],
    'constants' => [],
  ];
  for ($tinkr_parent = $tinkr_reflection->getParentClass(); $tinkr_parent; $tinkr_parent = $tinkr_parent->getParentClass()) {
    $tinkr_out['parents'][] = $tinkr_parent->getName();
  }
  // what the class borrows, as those docblocks declare it: appended after its own
  // methods, which the reader keeps when a name is declared and documented both
  $tinkr_owners = array_merge(
    [$tinkr_reflection->getName()],
    $tinkr_reflection->getInterfaceNames(),
    array_values($tinkr_reflection->getTraitNames()),
    $tinkr_out['parents']
  );
  foreach (array_unique($tinkr_owners) as $tinkr_owner) {
    try { $tinkr_owner_reflection = new ReflectionClass($tinkr_owner); } catch (\Throwable $tinkr_error) { continue; }
    foreach ($tinkr_documented($tinkr_owner_reflection->getDocComment(), $tinkr_owner) as $tinkr_documented_method) {
      $tinkr_out['methods'][] = $tinkr_documented_method;
    }
  }
  try {
    foreach ($tinkr_reflection->getProperties(ReflectionProperty::IS_PUBLIC) as $tinkr_property) {
      $tinkr_out['properties'][] = [
        'name' => $tinkr_property->getName(),
        'static' => $tinkr_property->isStatic(),
        'type' => $tinkr_property->hasType() ? (string) $tinkr_property->getType() : null,
        'doc' => $tinkr_text($tinkr_property->getDocComment()),
        'declaring' => $tinkr_property->getDeclaringClass()->getName(),
      ];
    }
  } catch (\Throwable $tinkr_error) {}
  try {
    foreach ($tinkr_reflection->getReflectionConstants(ReflectionClassConstant::IS_PUBLIC) as $tinkr_constant) {
      $tinkr_out['constants'][] = [
        'name' => $tinkr_constant->getName(),
        'declaring' => $tinkr_constant->getDeclaringClass()->getName(),
      ];
    }
  } catch (\Throwable $tinkr_error) {}
  return $tinkr_out;
};
`

// the classes a relation returns many of: the rest of the relations return one
// model, and every accessor they offer is their own — a `BelongsToMany` has no
// `getForeignKeyName`, so nothing here calls one
const manyRelations = String.raw`
$tinkr_many = ['HasMany', 'BelongsToMany', 'MorphMany', 'MorphToMany', 'MorphedByMany'];
`

/**
 * The project's classes, loaded, for both programs below.
 *
 * A project composer installed has an autoloader, and requiring that is the whole
 * of it. A checkout without one — composer's maps written but nothing installed,
 * a directory whose vendor holds only what was dumped — is still a project with
 * classes in it, and those maps name every file: the two files the class index
 * reads are the two the loader is built from, so a popup answers a class whose
 * file is on disk before `composer install` has ever run here. Nothing is written
 * and nothing is run but the loading of a class somebody asked about.
 *
 * Left behind for the program: `$tinkr_loader` (the composer loader, or null when
 * there is none), and `$tinkr_prefixes` / `$tinkr_named` — the namespace roots and
 * the class map, from whichever of the two answered.
 */
const loading = String.raw`
$tinkr_loader = null;
$tinkr_prefixes = [];
$tinkr_named = [];
$tinkr_autoload = $tinkr_root . '/vendor/autoload.php';
if (is_file($tinkr_autoload)) {
  try {
    $tinkr_required = require $tinkr_autoload;
    if (is_object($tinkr_required) && method_exists($tinkr_required, 'getClassMap')) {
      $tinkr_loader = $tinkr_required;
      $tinkr_prefixes = $tinkr_loader->getPrefixesPsr4();
      $tinkr_named = $tinkr_loader->getClassMap();
    }
  } catch (\Throwable $tinkr_error) {}
}
if ($tinkr_loader === null) {
  // composer's own maps read the vendor and base directories from the scope they
  // are included in, and a map hand-written without them is still relative to the
  // project: both are defined here, and a generated map redefines them
  $vendorDir = $tinkr_root . '/vendor';
  $baseDir = $tinkr_root;
  $tinkr_composer = $vendorDir . '/composer/';
  try { $tinkr_written = @include $tinkr_composer . 'autoload_psr4.php'; if (is_array($tinkr_written)) { $tinkr_prefixes = $tinkr_written; } } catch (\Throwable $tinkr_error) {}
  try { $tinkr_written = @include $tinkr_composer . 'autoload_classmap.php'; if (is_array($tinkr_written)) { $tinkr_named = $tinkr_written; } } catch (\Throwable $tinkr_error) {}
  spl_autoload_register(function ($tinkr_class) use ($tinkr_named, $tinkr_prefixes) {
    if (isset($tinkr_named[$tinkr_class]) && is_file((string) $tinkr_named[$tinkr_class])) {
      require_once $tinkr_named[$tinkr_class];
      return;
    }
    foreach ($tinkr_prefixes as $tinkr_prefix => $tinkr_paths) {
      if (strncmp($tinkr_class, (string) $tinkr_prefix, strlen((string) $tinkr_prefix)) !== 0) { continue; }
      $tinkr_rest = str_replace('\\', '/', substr($tinkr_class, strlen((string) $tinkr_prefix))) . '.php';
      foreach ((array) $tinkr_paths as $tinkr_path) {
        $tinkr_file = rtrim(str_replace('\\', '/', (string) $tinkr_path), '/') . '/' . $tinkr_rest;
        if (is_file($tinkr_file)) { require_once $tinkr_file; return; }
      }
    }
  });
}
`

/**
 * The whole reading: one booted app, and everything a popup asks a project for.
 *
 * It runs in the project's own directory, so `getcwd()` is the project and every
 * path answered is relative to it.
 *
 * @return {String} php, opened with `<?php`
 */
const intelProgram = () => String.raw`<?php
error_reporting(0);
ini_set('display_errors', '0');
` + text + manyRelations + String.raw`
$tinkr_root = getcwd();
$tinkr_result = [
  'version' => 1,
  'project' => $tinkr_root,
  'booted' => false,
  'models' => [],
  'classes' => [],
  'builders' => ['eloquent' => [], 'query' => []],
  'facades' => [],
  'config' => [],
  'routes' => [],
  'views' => [],
  'translations' => [],
  'env' => [],
  'bindings' => [],
  'functions' => [],
  'constants' => [],
  'own' => [],
];

// key names, never values: an editor has no use for a secret, and this answer is
// written to disk. A checkout that has not been set up has no .env, and the example
// it ships with is the list of names its code reads — which is what a popup of an
// env() call wants anyway
foreach ([$tinkr_root . '/.env', $tinkr_root . '/.env.example'] as $tinkr_env) {
  if (!is_file($tinkr_env)) { continue; }
  foreach (file($tinkr_env, FILE_IGNORE_NEW_LINES) as $tinkr_line) {
    if (preg_match('/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/', $tinkr_line, $tinkr_match)) { $tinkr_result['env'][] = $tinkr_match[1]; }
  }
  break;
}

` + loading + String.raw`
// a project that declares nothing at all — no autoloader, no composer maps — has
// no classes to read, and is not booted for the answer it already has
if ($tinkr_loader === null && $tinkr_prefixes === [] && $tinkr_named === []) {
  echo json_encode($tinkr_result, JSON_INVALID_UTF8_SUBSTITUTE);
  exit(0);
}

// every path is compared against the project as the disk spells it: a checkout
// reached through a symlink answers with the file, not the name it was asked by
$tinkr_real = str_replace('\\', '/', realpath($tinkr_root) ?: $tinkr_root);
$tinkr_vendor = $tinkr_real . '/vendor/';

// the namespace roots the project writes itself, which is what a popup offers
// before the thousands of names a vendor directory holds. Composer records a
// root as it was configured — often with .. in it, under vendor/composer — so
// every path is resolved before it is judged
$tinkr_dirs = [];
$tinkr_own = [];
try {
  foreach ($tinkr_prefixes as $tinkr_prefix => $tinkr_paths) {
    foreach ($tinkr_paths as $tinkr_path) {
      $tinkr_path = realpath(str_replace('\\', '/', (string) $tinkr_path));
      if ($tinkr_path === false || !is_dir($tinkr_path)) { continue; }
      $tinkr_path = str_replace('\\', '/', $tinkr_path);
      if (strpos($tinkr_path . '/', $tinkr_vendor) === 0) { continue; }
      $tinkr_own[strtolower(rtrim($tinkr_prefix, '\\') . '\\')] = true;
      $tinkr_dirs[$tinkr_prefix][] = $tinkr_path;
    }
  }
} catch (\Throwable $tinkr_error) {}
$tinkr_result['own'] = array_keys($tinkr_own);

// the app is booted in this process, once. Everything it prints on the way — a
// package's own banner, a deprecation notice — is not this answer, so it is held
// and dropped: what goes to stdout here is json and nothing else
$tinkr_app = null;
ob_start();
try {
  $tinkr_bootstrap = $tinkr_root . '/bootstrap/app.php';
  if (!is_file($tinkr_bootstrap)) { throw new Exception('the project has no bootstrap'); }
  $tinkr_loaded = require $tinkr_bootstrap;
  if ($tinkr_loaded instanceof \Illuminate\Foundation\Application) { $tinkr_app = $tinkr_loaded; }
  if ($tinkr_app !== null) {
    $tinkr_app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
  } elseif (is_object($tinkr_loaded) && method_exists($tinkr_loaded, 'bootstrap')) {
    $tinkr_loaded->bootstrap();
    $tinkr_app = \Illuminate\Container\Container::getInstance();
  }
  $tinkr_result['booted'] = $tinkr_app !== null;
} catch (\Throwable $tinkr_error) {
  $tinkr_result['error'] = substr($tinkr_error->getMessage(), 0, 200);
  if ($tinkr_app === null && class_exists('Illuminate\Container\Container')) { $tinkr_app = \Illuminate\Container\Container::getInstance(); }
}
while (ob_get_level() > 0) { ob_end_clean(); }

$tinkr_model_base = 'Illuminate\Database\Eloquent\Model';

if (class_exists($tinkr_model_base)) {
  // the classes the project declares, and nothing else: composer's classmap is
  // mostly the vendor's thousands, and loading a class is the only way to ask what
  // it extends — which is also why a model is never found by looking at a name
  $tinkr_names = [];
  try {
    foreach ($tinkr_named as $tinkr_name => $tinkr_file) {
      if (strpos(str_replace('\\', '/', (string) $tinkr_file), $tinkr_vendor) === 0) { continue; }
      $tinkr_names[$tinkr_name] = true;
    }
  } catch (\Throwable $tinkr_error) {}
  // and the files under the project's own psr-4 roots, for a checkout dumped
  // without composer dump-autoload -o
  foreach ($tinkr_dirs as $tinkr_prefix => $tinkr_paths) {
    foreach ($tinkr_paths as $tinkr_path) {
      $tinkr_path = realpath((string) $tinkr_path);
      if ($tinkr_path === false || !is_dir($tinkr_path)) { continue; }
      $tinkr_path = str_replace('\\', '/', $tinkr_path);
      try {
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($tinkr_path, FilesystemIterator::SKIP_DOTS)) as $tinkr_entry) {
          if (count($tinkr_names) > 20000) { break 2; }
          if (!$tinkr_entry->isFile() || $tinkr_entry->getExtension() !== 'php') { continue; }
          $tinkr_names[$tinkr_prefix . str_replace('/', '\\', substr($tinkr_entry->getPathname(), strlen($tinkr_path) + 1, -4))] = true;
        }
      } catch (\Throwable $tinkr_error) {}
    }
  }

  // attributes come from the live schema, which is the one thing reflection
  // cannot know; a project whose database is not reachable still answers with
  // its casts and relations, because those are written in its code
  $tinkr_schema = 'Illuminate\Database\Schema\Builder';
  $tinkr_columns = class_exists($tinkr_schema) && method_exists($tinkr_schema, 'getColumns');

  foreach (array_keys($tinkr_names) as $tinkr_name) {
    try {
      if (!is_subclass_of($tinkr_name, $tinkr_model_base)) { continue; }
      $tinkr_reflection = new ReflectionClass($tinkr_name);
      if ($tinkr_reflection->isAbstract()) { continue; }
      $tinkr_model = $tinkr_reflection->newInstanceWithoutConstructor();
    } catch (\Throwable $tinkr_error) { continue; }

    $tinkr_entry = [
      'class' => $tinkr_reflection->getName(),
      'table' => null,
      'key' => null,
      'keyType' => null,
      'attributes' => [],
      'casts' => [],
      'appends' => [],
      'hidden' => [],
      'relations' => [],
      'scopes' => [],
    ];

    try { $tinkr_entry['table'] = $tinkr_model->getTable(); } catch (\Throwable $tinkr_error) {}
    try { $tinkr_entry['key'] = $tinkr_model->getKeyName(); $tinkr_entry['keyType'] = $tinkr_model->getKeyType(); } catch (\Throwable $tinkr_error) {}
    try { $tinkr_entry['casts'] = $tinkr_model->getCasts(); } catch (\Throwable $tinkr_error) {}
    try { $tinkr_entry['appends'] = array_values($tinkr_model->getAppends()); } catch (\Throwable $tinkr_error) {}
    try { $tinkr_entry['hidden'] = array_values($tinkr_model->getHidden()); } catch (\Throwable $tinkr_error) {}

    if ($tinkr_entry['table']) {
      if ($tinkr_columns) {
        try {
          foreach (\Illuminate\Support\Facades\Schema::getColumns($tinkr_entry['table']) as $tinkr_column) {
            $tinkr_entry['attributes'][] = [
              'name' => $tinkr_column['name'],
              'type' => isset($tinkr_column['type_name']) ? $tinkr_column['type_name'] : (isset($tinkr_column['type']) ? $tinkr_column['type'] : null),
              'nullable' => !empty($tinkr_column['nullable']),
              'default' => isset($tinkr_column['default']) && $tinkr_column['default'] !== null ? substr((string) $tinkr_column['default'], 0, 40) : null,
            ];
          }
        } catch (\Throwable $tinkr_error) {}
      }
      // a framework without getColumns lists the names and asks the type of each,
      // which is the same answer through two calls
      if (!$tinkr_entry['attributes']) {
        try {
          foreach (\Illuminate\Support\Facades\Schema::getColumnListing($tinkr_entry['table']) as $tinkr_column) {
            $tinkr_entry['attributes'][] = [
              'name' => $tinkr_column,
              'type' => \Illuminate\Support\Facades\Schema::getColumnType($tinkr_entry['table'], $tinkr_column),
              'nullable' => null,
              'default' => null,
            ];
          }
        } catch (\Throwable $tinkr_error) {}
      }
    }

    foreach ($tinkr_reflection->getMethods(ReflectionMethod::IS_PUBLIC) as $tinkr_method) {
      if ($tinkr_method->isStatic()) { continue; }
      $tinkr_owner = $tinkr_method->getDeclaringClass()->getName();
      if ($tinkr_owner === $tinkr_model_base || !is_subclass_of($tinkr_owner, $tinkr_model_base)) { continue; }

      $tinkr_named = $tinkr_method->getName();
      if (strpos($tinkr_named, 'scope') === 0 && strlen($tinkr_named) > 5) {
        $tinkr_entry['scopes'][] = lcfirst(substr($tinkr_named, 5));
      } elseif (method_exists($tinkr_method, 'getAttributes')) {
        // a scope written as an attribute is a method named as it is called
        foreach ($tinkr_method->getAttributes() as $tinkr_attribute) {
          if (substr($tinkr_attribute->getName(), -6) === '\Scope') { $tinkr_entry['scopes'][] = $tinkr_named; }
        }
      }

      // a relation is a method that takes nothing and returns a relation: the
      // related model is read off an instance, because a docblock's @return
      // cannot be trusted to say which model it is
      if ($tinkr_method->getNumberOfParameters() > 0) { continue; }
      $tinkr_type = $tinkr_method->getReturnType();
      if (!$tinkr_type instanceof ReflectionNamedType || $tinkr_type->isBuiltin()) { continue; }
      $tinkr_declared = $tinkr_type->getName();
      if (!class_exists($tinkr_declared) || !is_subclass_of($tinkr_declared, 'Illuminate\Database\Eloquent\Relations\Relation')) { continue; }
      try {
        $tinkr_relation = $tinkr_method->invoke($tinkr_reflection->newInstanceWithoutConstructor());
        $tinkr_related = $tinkr_relation->getRelated();
      } catch (\Throwable $tinkr_error) { continue; }
      $tinkr_relation_class = get_class($tinkr_relation);
      $tinkr_entry['relations'][] = [
        'name' => $tinkr_named,
        'related' => is_object($tinkr_related) ? get_class($tinkr_related) : null,
        'relation' => $tinkr_relation_class,
        'many' => in_array(substr($tinkr_relation_class, strrpos($tinkr_relation_class, '\\') + 1), $tinkr_many, true),
      ];
    }

    $tinkr_result['models'][] = $tinkr_entry;
  }
}

// the builder every model answers through, and the base query builder it mixes
// in: a model's statics are this, and so is the chain a where starts
$tinkr_result['builders']['eloquent'] = $tinkr_methods('Illuminate\Database\Eloquent\Builder');
$tinkr_result['builders']['query'] = $tinkr_methods('Illuminate\Database\Query\Builder');

// the base classes a model and a collection are members of. They are read here,
// with the app booted, because every model answer needs them
foreach (['Illuminate\Database\Eloquent\Model', 'Illuminate\Support\Collection', 'Illuminate\Database\Eloquent\Collection'] as $tinkr_name) {
  $tinkr_dump = $tinkr_class($tinkr_name);
  if ($tinkr_dump !== null) { $tinkr_result['classes'][$tinkr_name] = $tinkr_dump; }
}

// a facade's real members are in its docblock: @method static lines the
// framework writes for a static accessor that goes through __callStatic
if (class_exists('Illuminate\Support\Facades\Facade')) {
  try {
    $tinkr_facades = dirname((new ReflectionClass('Illuminate\Support\Facades\Facade'))->getFileName());
    if (is_dir($tinkr_facades)) {
      foreach (glob($tinkr_facades . '/*.php') as $tinkr_file) {
        $tinkr_short = basename($tinkr_file, '.php');
        $tinkr_named = 'Illuminate\Support\Facades\\' . $tinkr_short;
        if ($tinkr_short === 'Facade' || !class_exists($tinkr_named)) { continue; }
        $tinkr_doc = (new ReflectionClass($tinkr_named))->getDocComment();
        if (!is_string($tinkr_doc)) { continue; }
        $tinkr_root_class = null;
        try { $tinkr_resolved = $tinkr_named::getFacadeRoot(); $tinkr_root_class = is_object($tinkr_resolved) ? get_class($tinkr_resolved) : null; } catch (\Throwable $tinkr_error) {}
        $tinkr_result['facades'][$tinkr_named] = ['root' => $tinkr_root_class, 'doc' => substr($tinkr_doc, 0, 20000)];
      }
    }
  } catch (\Throwable $tinkr_error) {}
}

// keys, sorted: a popup groups them by the prefix being typed, and the same
// prefix has to offer the same rows every time
try {
  $tinkr_keys = array_keys(\Illuminate\Support\Arr::dot(\Illuminate\Support\Facades\Config::all()));
  sort($tinkr_keys);
  $tinkr_result['config'] = array_slice($tinkr_keys, 0, 5000);
} catch (\Throwable $tinkr_error) {}

try {
  foreach (\Illuminate\Support\Facades\Route::getRoutes() as $tinkr_route) {
    if (count($tinkr_result['routes']) >= 2000) { break; }
    $tinkr_named = $tinkr_route->getName();
    if (!is_string($tinkr_named) || $tinkr_named === '') { continue; }
    $tinkr_verbs = array_values(array_diff($tinkr_route->methods(), ['HEAD']));
    $tinkr_result['routes'][] = [
      'name' => $tinkr_named,
      'uri' => '/' . ltrim($tinkr_route->uri(), '/'),
      'methods' => $tinkr_verbs,
    ];
  }
} catch (\Throwable $tinkr_error) {}

// a view is a file: what the finder can find is what view( can name, namespaced
// ones included
$tinkr_views = function ($tinkr_dir, $tinkr_prefix) use (&$tinkr_result, $tinkr_real) {
  if (!is_string($tinkr_dir) || !is_dir($tinkr_dir)) { return; }
  $tinkr_base = str_replace('\\', '/', rtrim($tinkr_dir, '/\\')) . '/';
  try {
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($tinkr_dir, FilesystemIterator::SKIP_DOTS)) as $tinkr_entry) {
      if (count($tinkr_result['views']) >= 2000) { return; }
      if (!$tinkr_entry->isFile()) { continue; }
      $tinkr_path = str_replace('\\', '/', $tinkr_entry->getPathname());
      if (strpos($tinkr_path, $tinkr_base) !== 0) { continue; }
      $tinkr_relative = substr($tinkr_path, strlen($tinkr_base));
      if (strlen($tinkr_relative) > 10 && substr($tinkr_relative, -10) === '.blade.php') { $tinkr_relative = substr($tinkr_relative, 0, -10); }
      elseif (substr($tinkr_relative, -4) === '.php') { $tinkr_relative = substr($tinkr_relative, 0, -4); }
      else { continue; }
      $tinkr_result['views'][] = [
        'name' => $tinkr_prefix . str_replace('/', '.', $tinkr_relative),
        'path' => substr($tinkr_path, strlen($tinkr_real) + 1),
      ];
    }
  } catch (\Throwable $tinkr_error) {}
};

try {
  $tinkr_finder = \Illuminate\Support\Facades\View::getFinder();
  foreach ((array) $tinkr_finder->getPaths() as $tinkr_dir) { $tinkr_views($tinkr_dir, ''); }
  foreach ((array) $tinkr_finder->getHints() as $tinkr_namespace => $tinkr_paths) {
    foreach ((array) $tinkr_paths as $tinkr_dir) { $tinkr_views($tinkr_dir, $tinkr_namespace . '::'); }
  }
} catch (\Throwable $tinkr_error) {}

// a translation key is a nested array in a file, so the file is read and walked
$tinkr_lang = null;
try { $tinkr_lang = $tinkr_app ? $tinkr_app->langPath() : $tinkr_root . '/lang'; } catch (\Throwable $tinkr_error) {}
if (!is_string($tinkr_lang) || !is_dir($tinkr_lang)) { $tinkr_lang = $tinkr_root . '/resources/lang'; }

$tinkr_dotted = function ($tinkr_array, $tinkr_prefix) use (&$tinkr_dotted, &$tinkr_result) {
  if (!is_array($tinkr_array)) { return; }
  foreach ($tinkr_array as $tinkr_key => $tinkr_value) {
    if (!is_string($tinkr_key)) { continue; }
    if (count($tinkr_result['translations']) >= 4000) { return; }
    $tinkr_name = $tinkr_prefix === '' ? $tinkr_key : $tinkr_prefix . '.' . $tinkr_key;
    if (is_array($tinkr_value)) { $tinkr_dotted($tinkr_value, $tinkr_name); }
    else { $tinkr_result['translations'][$tinkr_name] = true; }
  }
};

if (is_dir($tinkr_lang)) {
  $tinkr_lang_base = str_replace('\\', '/', realpath($tinkr_lang) ?: $tinkr_lang);
  try {
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($tinkr_lang, FilesystemIterator::SKIP_DOTS)) as $tinkr_entry) {
      if (!$tinkr_entry->isFile() || $tinkr_entry->getExtension() !== 'php') { continue; }
      $tinkr_path = str_replace('\\', '/', $tinkr_entry->getPathname());
      if (strpos($tinkr_path, $tinkr_lang_base . '/') !== 0) { continue; }
      $tinkr_parts = explode('/', substr($tinkr_path, strlen($tinkr_lang_base) + 1));
      $tinkr_parts[count($tinkr_parts) - 1] = substr($tinkr_parts[count($tinkr_parts) - 1], 0, -4);
      // a key is read by the locale the app resolves, so the locale directory is
      // not part of it: lang/en/auth.php answers to auth.failed. A package's
      // translations live under vendor/name/locale and answer to name::group
      $tinkr_short = '';
      if (count($tinkr_parts) > 2 && $tinkr_parts[0] === 'vendor') {
        $tinkr_short = $tinkr_parts[1] . '::';
        $tinkr_parts = array_slice($tinkr_parts, 3);
      } elseif (count($tinkr_parts) > 1 && preg_match('/^[a-z]{2,3}([_-][A-Za-z]{2,4})?$/', $tinkr_parts[0])) {
        $tinkr_parts = array_slice($tinkr_parts, 1);
      }
      if (!$tinkr_parts) { continue; }
      $tinkr_file = $tinkr_short . implode('.', $tinkr_parts);
      try { $tinkr_array = (function () use ($tinkr_path) { return @include $tinkr_path; })(); } catch (\Throwable $tinkr_error) { continue; }
      if (is_array($tinkr_array)) { $tinkr_dotted($tinkr_array, $tinkr_file); }
    }
  } catch (\Throwable $tinkr_error) {}
}
$tinkr_result['translations'] = array_keys($tinkr_result['translations']);

// what app( and resolve( can name: every binding and alias the container
// holds, which is what a project's own service providers add to
if ($tinkr_app) {
  $tinkr_names = [];
  try { foreach (array_keys($tinkr_app->getBindings()) as $tinkr_abstract) { if (is_string($tinkr_abstract)) { $tinkr_names[$tinkr_abstract] = 'binding'; } } } catch (\Throwable $tinkr_error) {}
  try { foreach (array_keys($tinkr_app->getAliases()) as $tinkr_alias) { if (is_string($tinkr_alias)) { $tinkr_names[$tinkr_alias] = 'alias'; } } } catch (\Throwable $tinkr_error) {}
  foreach ($tinkr_names as $tinkr_name => $tinkr_kind) { $tinkr_result['bindings'][] = ['name' => $tinkr_name, 'kind' => $tinkr_kind]; }
}

// every function php and the project define, with the signature it is called
// with: a snippet calls now() and str_replace() as much as it calls a model
$tinkr_defined = get_defined_functions();
$tinkr_user = array_flip($tinkr_defined['user']);
foreach (array_merge($tinkr_defined['internal'], $tinkr_defined['user']) as $tinkr_name) {
  if (count($tinkr_result['functions']) >= 6000) { break; }
  try { $tinkr_reflection = new ReflectionFunction($tinkr_name); } catch (\Throwable $tinkr_error) { continue; }
  $tinkr_params = [];
  foreach ($tinkr_reflection->getParameters() as $tinkr_parameter) { $tinkr_params[] = $tinkr_param($tinkr_parameter); }
  $tinkr_result['functions'][] = [
    'name' => $tinkr_name,
    'params' => $tinkr_params,
    'returns' => $tinkr_returns($tinkr_reflection),
    'user' => isset($tinkr_user[$tinkr_name]),
  ];
}

$tinkr_constants = array_keys(get_defined_constants());
sort($tinkr_constants);
$tinkr_result['constants'] = array_slice($tinkr_constants, 0, 8000);

echo json_encode($tinkr_result, JSON_INVALID_UTF8_SUBSTITUTE);
`

/**
 * One class's members, read without booting the project: the autoloader is
 * enough for reflection, and this is asked the first time a name is needed
 * rather than for the whole project up front.
 *
 * @param {String} name the class, as a snippet would write it, qualified or not
 * @return {String} php, opened with `<?php`
 */
const classProgram = name => String.raw`<?php
error_reporting(0);
ini_set('display_errors', '0');
` + text + String.raw`
$tinkr_root = getcwd();
$tinkr_name = ` + phpString(String(name).replace(/^\\+/, '')) + String.raw`;
$tinkr_result = ['class' => $tinkr_name, 'exists' => false];

` + loading + String.raw`
if ($tinkr_name !== '') {
  $tinkr_exists = class_exists($tinkr_name) || interface_exists($tinkr_name) || trait_exists($tinkr_name);
  if (!$tinkr_exists && function_exists('enum_exists')) { $tinkr_exists = enum_exists($tinkr_name); }
  if ($tinkr_exists) {
    $tinkr_dump = $tinkr_class($tinkr_name);
    if ($tinkr_dump !== null) { $tinkr_result = $tinkr_dump; $tinkr_result['exists'] = true; }
  }
}

echo json_encode($tinkr_result, JSON_INVALID_UTF8_SUBSTITUTE);
`

/**
 * A program as the machine runs it.
 *
 * The prose in the templates above is there for whoever reads this file; the
 * command line that carries the program is a scarce thing — a Windows terminal
 * caps it at 8191 characters — so comments and blank lines are dropped on the
 * way out, and what is left is what runs.
 */
const compact = program => program
  .split('\n')
  .map(line => line.replace(/\s+$/, ''))
  .filter(line => line !== '' && !line.trim().startsWith('//'))
  .join('\n')

module.exports = {
  intelCode: () => compact(intelProgram()),
  classCode: name => compact(classProgram(name)),
}
