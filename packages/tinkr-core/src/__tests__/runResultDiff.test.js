/**
 * What a guarded run changed, run as php.
 *
 * The diff is read from two Laravel surfaces — Eloquent's model events and the
 * dispatcher's query events — so this boots the smallest thing that answers
 * both the way Laravel does: a dispatcher that calls a wildcard listener with
 * the name and the payload array and an exact listener with the payload, an
 * sqlite connection that dispatches QueryExecuted after every statement, and a
 * model whose `save`/`delete` fire the events at the moment Laravel fires them
 * (`updated` before the original is synced). A snippet is then run through the
 * real wrapper, and the envelope's `transaction.changes` is what it says.
 *
 * The wrapper is fed on stdin for the same reason the other php test is: the
 * php it runs against is lerd's, which cannot see this machine's temporary
 * directory.
 */
const {execFileSync} = require('child_process')

const {wrapRun} = require('../runResult')

/**
 * The session a snippet is evaluated in: a bound `db` and `events`, the event
 * classes the wrapper asks about, and a model over a seeded `books` table.
 */
const BOOT = `<?php
namespace Illuminate\\Database\\Events {
    class QueryExecuted
    {
        public $sql;
        public $bindings;
        public $time;
        public $connectionName;

        public function __construct($sql, $bindings, $time, $connectionName)
        {
            $this->sql = $sql;
            $this->bindings = $bindings;
            $this->time = $time;
            $this->connectionName = $connectionName;
        }
    }
}

namespace Illuminate\\Database\\Eloquent {
    class Model
    {
        protected static $table = null;
        protected $attributes = [];
        protected $original = [];
        protected $changes = [];
        protected $exists = false;

        public static function connection()
        {
            return \\TinkrDiffApp::connection();
        }

        public static function tableName()
        {
            if (static::$table !== null) {
                return static::$table;
            }

            return strtolower(substr(strrchr('\\\\' . static::class, '\\\\'), 1)) . 's';
        }

        public function getTable()
        {
            return static::tableName();
        }

        public function getKeyName()
        {
            return 'id';
        }

        public function getKey()
        {
            return $this->attributes['id'] ?? null;
        }

        public function getAttributes()
        {
            return $this->attributes;
        }

        public function getOriginal($key = null)
        {
            return $key === null ? $this->original : ($this->original[$key] ?? null);
        }

        public function getChanges()
        {
            return $this->changes;
        }

        public function getDirty()
        {
            $dirty = [];

            foreach ($this->attributes as $name => $value) {
                if (!array_key_exists($name, $this->original) || (string) $this->original[$name] !== (string) $value) {
                    $dirty[$name] = $value;
                }
            }

            return $dirty;
        }

        public function getConnectionName()
        {
            return 'fixture';
        }

        public function __get($name)
        {
            return $this->attributes[$name] ?? null;
        }

        public function __set($name, $value)
        {
            $this->attributes[$name] = $value;
        }

        protected static function fire($event, $model)
        {
            $dispatcher = \\TinkrDiffApp::events();

            if ($dispatcher) {
                $dispatcher->dispatch('eloquent.' . $event . ': ' . get_class($model), $model);
            }
        }

        public static function find($id)
        {
            $rows = static::connection()->select('select * from ' . static::tableName() . ' where id = ?', [$id]);

            if (!$rows) {
                return null;
            }

            $model = new static();
            $model->attributes = $rows[0];
            $model->original = $rows[0];
            $model->exists = true;

            return $model;
        }

        public static function create($attributes)
        {
            $model = new static();
            $model->attributes = $attributes;
            $model->save();

            return $model;
        }

        public function save()
        {
            $connection = static::connection();

            if (!$this->exists) {
                $columns = array_keys($this->attributes);
                $connection->insert(
                    'insert into ' . $this->getTable() . ' (' . implode(', ', $columns) . ') values ('
                        . implode(', ', array_fill(0, count($columns), '?')) . ')',
                    array_values($this->attributes)
                );

                $this->attributes['id'] = (int) $connection->id();
                $this->exists = true;
                $this->original = $this->attributes;
                $this->changes = $this->attributes;
                static::fire('created', $this);

                return true;
            }

            $dirty = $this->getDirty();

            if (!$dirty) {
                return true;
            }

            $sets = [];

            foreach (array_keys($dirty) as $column) {
                $sets[] = $column . ' = ?';
            }

            $connection->update(
                'update ' . $this->getTable() . ' set ' . implode(', ', $sets) . ' where id = ?',
                array_merge(array_values($dirty), [$this->getKey()])
            );

            $this->changes = $dirty;
            static::fire('updated', $this);
            $this->original = $this->attributes;

            return true;
        }

        public function delete()
        {
            static::connection()->delete('delete from ' . $this->getTable() . ' where id = ?', [$this->getKey()]);
            static::fire('deleted', $this);
            $this->exists = false;

            return true;
        }
    }
}

namespace {
    class TinkrDiffEvents
    {
        private static $listeners = [];

        public static function listen($event, $callback)
        {
            self::$listeners[$event][] = $callback;
        }

        public static function dispatch($event, $payload)
        {
            foreach (self::$listeners as $pattern => $callbacks) {
                if (strpos($pattern, '*') === false || !preg_match('#^' . str_replace('\\\\*', '.*', preg_quote($pattern, '#')) . '$#', $event)) {
                    continue;
                }

                foreach ($callbacks as $callback) {
                    $callback($event, [$payload], false);
                }
            }

            foreach (self::$listeners[$event] ?? [] as $callback) {
                $callback($payload);
            }
        }
    }

    class TinkrDiffConnection
    {
        private $pdo;
        private $name;
        private $level = 0;

        public function __construct($name)
        {
            $this->name = $name;
            $this->pdo = new PDO('sqlite::memory:');
            $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $this->pdo->exec('create table books (id integer primary key, title text, price real)');
            $this->pdo->exec("insert into books (title, price) values ('One', 1.5), ('Two', 2.5), ('Three', 3.5)");
        }

        public function getName()
        {
            return $this->name;
        }

        public function getPdo()
        {
            return $this->pdo;
        }

        public function id()
        {
            return $this->pdo->lastInsertId();
        }

        public function beginTransaction()
        {
            if ($this->level === 0) {
                $this->pdo->beginTransaction();
            }

            $this->level++;
        }

        public function commit()
        {
            if ($this->level === 1) {
                $this->pdo->commit();
            }

            $this->level = max(0, $this->level - 1);
        }

        public function rollBack()
        {
            if ($this->level === 1) {
                $this->pdo->rollBack();
            }

            $this->level = max(0, $this->level - 1);
        }

        public function transactionLevel()
        {
            return $this->level;
        }

        private function run($sql, $bindings, $fetch)
        {
            $statement = $this->pdo->prepare($sql);
            $statement->execute(array_values($bindings));

            TinkrDiffEvents::dispatch(
                'Illuminate\\\\Database\\\\Events\\\\QueryExecuted',
                new \\Illuminate\\Database\\Events\\QueryExecuted($sql, array_values($bindings), 0.1, $this->name)
            );

            return $fetch ? $statement->fetchAll(PDO::FETCH_ASSOC) : $statement->rowCount();
        }

        public function select($sql, $bindings = [])
        {
            return $this->run($sql, $bindings, true);
        }

        public function statement($sql, $bindings = [])
        {
            return $this->run($sql, $bindings, false);
        }

        public function insert($sql, $bindings = [])
        {
            return $this->run($sql, $bindings, false);
        }

        public function update($sql, $bindings = [])
        {
            return $this->run($sql, $bindings, false);
        }

        public function delete($sql, $bindings = [])
        {
            return $this->run($sql, $bindings, false);
        }
    }

    class TinkrDiffDbManager
    {
        public function connection($name = null)
        {
            return TinkrDiffApp::connection($name);
        }
    }

    class TinkrDiffApp
    {
        private static $connection;
        private static $events;

        public static function connection($name = null)
        {
            if (!self::$connection) {
                self::$connection = new TinkrDiffConnection($name ?: 'fixture');
            }

            return self::$connection;
        }

        public static function events()
        {
            if (!self::$events) {
                self::$events = new TinkrDiffEvents();
            }

            return self::$events;
        }

        public static function bound($key)
        {
            return in_array($key, ['db', 'events'], true);
        }

        public static function make($key)
        {
            return $key === 'db' ? new TinkrDiffDbManager() : self::events();
        }
    }

    class DB
    {
        public static function connection($name = null)
        {
            return TinkrDiffApp::connection($name);
        }

        public static function select($sql, $bindings = [])
        {
            return self::connection()->select($sql, $bindings);
        }

        public static function update($sql, $bindings = [])
        {
            return self::connection()->update($sql, $bindings);
        }

        public static function delete($sql, $bindings = [])
        {
            return self::connection()->delete($sql, $bindings);
        }
    }

    class TinkrBook extends \\Illuminate\\Database\\Eloquent\\Model
    {
        protected static $table = 'books';
    }

    function app($key = null)
    {
        if ($key === null) {
            return new class {
                public function bound($key)
                {
                    return TinkrDiffApp::bound($key);
                }
            };
        }

        return TinkrDiffApp::make($key);
    }
}

/*
 * the wrapper, and whatever this test reads after it, are top-level code: a
 * file that named a namespace can only hold more code inside one, so the block
 * is opened here and closed by the helper
 */
namespace {`

/**
 * Run a snippet through the wrapper in the booted stub, and read the envelope.
 *
 * @param {String} source
 * @param {String|null} guard
 * @param {String} [after] php run after the wrapper, which is how what the
 *   transaction left in the database is read
 * @return {{payload: Object, printed: String, tail: String}}
 */
const runGuarded = (source, guard, after = '') => {
  const run = wrapRun(source, {}, guard)
  const out = execFileSync('php', [], {encoding: 'utf8', input: `${BOOT}${run.code}${after}\n}`})
  const at = out.indexOf(`${run.marker}@`)

  if (at < 0) {
    throw new Error(`the run printed no envelope: ${JSON.stringify(out)}`)
  }

  const rest = out.slice(at + run.marker.length + 1)
  const end = rest.indexOf('@')

  return {
    payload: JSON.parse(Buffer.from(rest.slice(0, end), 'base64').toString('utf8')),
    printed: out.slice(0, at).split(run.start).join(''),
    tail: rest.slice(end + 1),
  }
}

describe('what a guarded run changed', () => {
  test('reads a create, an update and a delete from the model events', () => {
    const {payload} = runGuarded(
      '$one = TinkrBook::find(1);\n' +
      "$one->title = 'Changed';\n" +
      '$one->save();\n' +
      "TinkrBook::create(['title' => 'New', 'price' => 4.5]);\n" +
      'TinkrBook::find(2)->delete();',
      'rollback',
    )

    const {transaction, error} = payload

    expect(error).toBe(null)
    expect(transaction.outcome).toBe('rolledBack')
    expect(transaction.changesTotal).toBe(3)
    expect(transaction.undiffed).toEqual({count: 0, sample: []})

    const [updated, created, deleted] = transaction.changes

    // updated carries the columns that changed and the key from before it
    expect(updated).toEqual({
      connection: 'fixture',
      table: 'books',
      key: {id: 1},
      op: 'updated',
      before: {title: 'One'},
      after: {title: 'Changed'},
    })

    // created carries the row it inserted, key and all
    expect(created).toEqual({
      connection: 'fixture',
      table: 'books',
      key: {id: 4},
      op: 'created',
      before: null,
      after: {title: 'New', price: 4.5, id: 4},
    })

    // deleted carries the row it removed, and nothing after it
    expect(deleted).toEqual({
      connection: 'fixture',
      table: 'books',
      key: {id: 2},
      op: 'deleted',
      before: {id: 2, title: 'Two', price: 2.5},
      after: null,
    })
  })

  test('leaves the database as it was', () => {
    const {payload, tail} = runGuarded(
      '$one = TinkrBook::find(1);\n' +
      "$one->title = 'Changed';\n" +
      '$one->save();\n' +
      "TinkrBook::create(['title' => 'New', 'price' => 4.5]);\n" +
      'TinkrBook::find(2)->delete();',
      'rollback',
      "echo '|BOOKS='.json_encode(DB::select('select id, title from books order by id'));",
    )

    expect(payload.transaction.outcome).toBe('rolledBack')
    // the key of a row is not reused after the rollback, and the row the run
    // created is gone with the rest of it
    expect(JSON.parse(tail.slice(tail.indexOf('|BOOKS=') + 7))).toEqual([
      {id: 1, title: 'One'},
      {id: 2, title: 'Two'},
      {id: 3, title: 'Three'},
    ])
  })

  test('counts a write nothing could describe, and keeps its sql', () => {
    const {payload} = runGuarded(
      "DB::update('update books set price = 0 where id = 3');\n" +
      "DB::delete('delete from books where id = 2');",
      'rollback',
    )

    // no model spoke for either statement, so neither is a row of changes
    expect(payload.transaction.changes).toEqual([])
    expect(payload.transaction.changesTotal).toBe(0)
    expect(payload.transaction.undiffed).toEqual({
      count: 2,
      sample: ['update books set price = 0 where id = 3', 'delete from books where id = 2'],
    })
    expect(payload.transaction.outcome).toBe('rolledBack')
  })

  test('does not count the write a model event accounted for', () => {
    const {payload} = runGuarded(
      '$one = TinkrBook::find(1);\n' +
      "$one->title = 'Twice';\n" +
      '$one->save();\n' +
      "TinkrBook::create(['title' => 'Another', 'price' => 1]);",
      'rollback',
    )

    expect(payload.transaction.changesTotal).toBe(2)
    expect(payload.transaction.undiffed.count).toBe(0)
  })

  test('caps the list of changes and still counts them all', () => {
    const {payload} = runGuarded(
      "for ($i = 0; $i < 60; $i++) { TinkrBook::create(['title' => 'Row ' . $i, 'price' => $i]); }",
      'rollback',
    )

    // the list stops at its budget and the count does not, which is what lets
    // the pane say how much of the run it is showing
    expect(payload.transaction.changes).toHaveLength(50)
    expect(payload.transaction.changesTotal).toBe(60)
    expect(payload.transaction.changes.at(-1).after.title).toBe('Row 49')
  })

  test('cuts a value a row cannot carry, and says it was cut', () => {
    const {payload} = runGuarded(
      "TinkrBook::create(['title' => str_repeat('x', 1000), 'price' => 1]);",
      'rollback',
    )

    const value = payload.transaction.changes[0].after.title

    expect(value).toHaveLength(403)
    expect(value.endsWith('...')).toBe(true)
  })

  test('reports a run whose guard could not be armed with nothing changed', () => {
    // no db to guard at all: the guard refuses the run, and the report says it
    // did, with an empty diff rather than a key that is not there
    const run = wrapRun('1 + 1;', {}, 'rollback')
    const out = execFileSync('php', [], {encoding: 'utf8', input: `<?php ${run.code}`})
    const at = out.indexOf(`${run.marker}@`)
    const rest = out.slice(at + run.marker.length + 1)
    const payload = JSON.parse(Buffer.from(rest.slice(0, rest.indexOf('@')), 'base64').toString('utf8'))

    expect(payload.error.class).toBe('RuntimeException')
    expect(payload.transaction.armed).toBe(false)
    expect(payload.transaction.changes).toEqual([])
    expect(payload.transaction.undiffed).toEqual({count: 0, sample: []})
  })

  test('is not carried by a run that was not guarded', () => {
    const {payload} = runGuarded('TinkrBook::create(["title" => "Kept", "price" => 1]);', null)

    expect(payload.transaction).toBe(undefined)
    expect(payload.value).toBeTruthy()
  })

  test('reports what a commit run kept', () => {
    const {payload, tail} = runGuarded(
      "TinkrBook::create(['title' => 'Kept', 'price' => 2]);",
      'commit',
      "echo '|COUNT='.count(DB::select('select id from books'));",
    )

    expect(payload.transaction.outcome).toBe('committed')
    expect(payload.transaction.changes[0]).toMatchObject({op: 'created', after: {title: 'Kept'}})
    expect(tail).toContain('|COUNT=4')
  })
})

describe('the change report in the wrapper', () => {
  test('is armed with the guard, and reads its two surfaces', () => {
    const run = wrapRun('1;', {}, 'rollback')

    // the row a model event names, and the listeners that are asked
    expect(run.code).toContain("$tinkr_tx_events->listen('eloquent.*',$tinkr_tx_listen);")
    expect(run.code).toContain("$tinkr_tx_events->listen('Illuminate\\\\Database\\\\Events\\\\QueryExecuted',$tinkr_tx_write);")
    // the closures are defined before the transaction is opened, because
    // registering them is what arming it does
    expect(run.code.indexOf('$tinkr_tx_listen=function'))
      .toBeLessThan(run.code.indexOf('$tinkr_db->beginTransaction();'))
    // the key of a row is what the event says it is
    expect(run.code).toContain('$tinkr_column=$tinkr_model->getKeyName();')
    expect(run.code).toContain('$tinkr_changed=(array)$tinkr_model->getChanges();')
    // a soft delete is left to the undiffed count rather than reported as a
    // row that was removed
    expect(run.code).toContain("if($tinkr_op==='deleted'&&method_exists($tinkr_model,'isForceDeleting')&&!$tinkr_model->isForceDeleting()){return;}")
  })

  test('is bounded and says so', () => {
    const run = wrapRun('1;', {}, 'rollback')

    // fifty rows, a hundred kilobytes, four hundred characters a value
    expect(run.code).toContain("count($tinkr_tx_diff['changes'])>=50||$tinkr_tx_diff['size']+$tinkr_bytes>100000")
    expect(run.code).toContain("substr($tinkr_v,0,400).'...'")
    // the count is of every change, whatever the list holds
    expect(run.code).toContain("'changesTotal'=>$tinkr_tx_diff['total']")
    expect(run.code).toContain("'undiffed'=>['count'=>$tinkr_tx_diff['undiffed'],'sample'=>$tinkr_tx_diff['sample']]")
  })

  test('is initialized on the close path, where nothing of the snippet ran', () => {
    const run = wrapRun('1;', {}, 'rollback')

    expect(run.code).toContain("$tinkr_tx_diff=['changes'=>[],'total'=>0,'size'=>0,'writes'=>[],'undiffed'=>0,'sample'=>[]];")
    expect(run.code).toContain('&$tinkr_query_connections,&$tinkr_tx_diff){')
  })

  test('is not in a run that was not guarded', () => {
    const run = wrapRun('1;')

    expect(run.code).not.toContain('$tinkr_tx_diff')
    expect(run.code).not.toContain('eloquent.*')
    expect(run.code).not.toContain("'changes'=>")
  })
})
