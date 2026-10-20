<?php

namespace Illuminate\Database\Events;

/**
 * The event Laravel dispatches after a query.
 *
 * The app's run wrapper listens for this class by name — it registers only when
 * the class exists — and reads these properties off what it is handed. The
 * fixture speaks the same event so its queries are captured exactly as a
 * Laravel session's are.
 */
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
