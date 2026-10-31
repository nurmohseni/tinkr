<?php

namespace Illuminate\Database\Eloquent;

/**
 * The part of Eloquent a snippet in the fixture writes through.
 *
 * The app's guarded run reads what it changed from Eloquent's model events, and
 * registers that listener only where the class exists (see runResult's
 * DIFF_BLOCK). The fixture is a session with no framework to install, so this is
 * the model that makes a dry run of `$order->save()` answer the way one in a
 * Laravel project does: a row with its attributes, its key and the columns that
 * changed, and the `created`, `updated` and `deleted` events fired at the moment
 * Laravel fires them — `updated` before the original is synced, which is what
 * makes the value before the change readable.
 *
 * It is the model's surface a snippet uses, not all of Eloquent: attributes
 * through `->`, `find`, `create`, `save`, `delete`, and the readers the wrapper
 * asks for. There are no relations, casts, scopes or soft deletes; a table is
 * the class name pluralised, or the class's own `$table`.
 */
class Model
{
    protected static $table = null;
    protected $attributes = [];
    protected $original = [];
    protected $changes = [];
    protected $exists = false;

    public static function connection()
    {
        return \TinkrFixture::connection();
    }

    public static function tableName()
    {
        if (static::$table !== null) {
            return static::$table;
        }

        return strtolower(substr(strrchr('\\' . static::class, '\\'), 1)) . 's';
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
        return static::connection()->getName();
    }

    public function toArray()
    {
        return $this->attributes;
    }

    public function __get($name)
    {
        return $this->attributes[$name] ?? null;
    }

    public function __set($name, $value)
    {
        $this->attributes[$name] = $value;
    }

    public function __isset($name)
    {
        return isset($this->attributes[$name]);
    }

    protected static function fire($event, $model)
    {
        $dispatcher = function_exists('app') ? app('events') : null;

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
