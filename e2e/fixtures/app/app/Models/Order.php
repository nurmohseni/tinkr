<?php

namespace App\Models;

/**
 * A small model over the fixture's orders table.
 *
 * It exists so a snippet can write the thing a person writes in tinker — a
 * model, a short name, a query — and the app's class index, alias block and
 * table reading all get something real to work on.
 */
class Order
{
    public static function all()
    {
        return \DB::select('select id, customer, total, paid from orders order by id');
    }

    public static function count()
    {
        return (int) \DB::select('select count(*) as total from orders')[0]['total'];
    }

    public static function where($column, $value)
    {
        return new OrderQuery($column, $value);
    }
}

class OrderQuery
{
    private $column;
    private $value;

    public function __construct($column, $value)
    {
        $this->column = $column;
        $this->value = $value;
    }

    public function get()
    {
        return \DB::select(
            "select id, customer, total, paid from orders where {$this->column} = ? order by id",
            [$this->value]
        );
    }

    public function count()
    {
        return (int) \DB::select(
            "select count(*) as total from orders where {$this->column} = ?",
            [$this->value]
        )[0]['total'];
    }

    public function first()
    {
        $rows = $this->get();

        return $rows[0] ?? null;
    }

    public function delete()
    {
        return \DB::delete(
            "delete from orders where {$this->column} = ?",
            [$this->value]
        );
    }
}
