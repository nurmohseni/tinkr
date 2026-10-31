<?php

namespace App\Models;

/**
 * A model the fixture writes rows through.
 *
 * `Order` reads the fixture's orders with the query builder and no framework,
 * which is what most of the suite needs. A run that writes a row the way a
 * Laravel snippet writes one — `Note::find(1)`, `$note->save()`,
 * `Note::create([…])` — needs the model events Eloquent fires, because that is
 * where a guarded run reads what it changed (see runResult.DIFF_BLOCK). So this
 * one extends the fixture's Eloquent subset over its own table.
 */
class Note extends \Illuminate\Database\Eloquent\Model
{
    protected static $table = 'notes';
}
