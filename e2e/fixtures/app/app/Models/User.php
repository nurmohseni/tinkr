<?php

namespace App\Models;

/**
 * A user, shaped the way an Eloquent model's attributes come back from it.
 *
 * It exists for the one thing the app does with a run's value away from the
 * screen: the field names a project hands back by default. `password` and
 * `remember_token` are here so a test can see what the app keeps on disk and
 * what an MCP client is told, and see that the result pane still shows them.
 */
class User
{
    public static function first()
    {
        return [
            'id' => 1,
            'name' => 'Ada',
            'email' => 'ada@example.test',
            'password' => 'hunter2-fixture',
            'remember_token' => 'Zx9-fixture-token',
            'api_key' => 'sk-fixture-key',
        ];
    }
}
