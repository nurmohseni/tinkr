import {mutationScan, unguardableScan} from '../mutationScan'

describe('the mutation scan', () => {
  it('finds a call that writes on a chain', () => {
    expect(mutationScan("DB::table('users')->where('id', 1)->delete();"))
      .toEqual([{line: 1, call: 'delete'}])
  })

  it('finds an eloquent write', () => {
    expect(mutationScan('$user->save();\n\n$user->forceDelete();'))
      .toEqual([
        {line: 1, call: 'save'},
        {line: 3, call: 'forceDelete'},
      ])
  })

  it('answers with the line a call is on, not the line its chain began on', () => {
    const code = "DB::table('users')\n  ->where('id', 1)\n  ->update(['name' => 'n']);"

    expect(mutationScan(code)).toEqual([{line: 3, call: 'update'}])
  })

  it('finds a schema change', () => {
    expect(mutationScan("Schema::dropIfExists('users');"))
      .toEqual([{line: 1, call: 'dropIfExists'}])
  })

  it('finds SQL the snippet wrote itself, and the call that carries it', () => {
    expect(mutationScan("DB::statement('delete from users where id = 1');"))
      .toEqual([
        {line: 1, call: 'statement'},
        {line: 1, call: 'delete from'},
      ])
  })

  it('finds an artisan command that takes the database with it', () => {
    expect(mutationScan("Artisan::call('migrate:fresh');"))
      .toEqual([{line: 1, call: 'migrate:fresh'}])
  })

  it('leaves an artisan command that changes nothing alone', () => {
    expect(mutationScan("Artisan::call('config:clear');")).toEqual([])
  })

  it('reports the same call twice on one line once', () => {
    expect(mutationScan('$a->delete(); $b->delete();'))
      .toEqual([{line: 1, call: 'delete'}])
  })

  it('answers with nothing for a run that only reads', () => {
    const code = "User::query()->where('active', true)->get();\nDB::select('select * from users');"

    expect(mutationScan(code)).toEqual([])
  })

  it('answers with nothing for a run that is not code at all', () => {
    expect(mutationScan('')).toEqual([])
    expect(mutationScan(null)).toEqual([])
  })

  it('answers in the order the lines are in', () => {
    const code = "Artisan::call('db:seed');\n\\$x = 1;\nUser::destroy(3);"

    expect(mutationScan(code).map(one => one.line)).toEqual([1, 3])
  })
})

describe('what a dry run cannot hold', () => {
  const reasons = code => unguardableScan(code).map(one => [one.line, one.reason, one.call])

  it('finds DDL, which MySQL commits on its own', () => {
    expect(reasons("DB::table('t')->insert(['a' => 1]);\nDB::statement('create table t2 (id int)');"))
      .toEqual([[2, 'ddl', 'create table']])
    expect(reasons("Schema::create('t', fn ($t) => $t->id());")).toEqual([[1, 'ddl', 'Schema::create']])
    expect(reasons("DB::table('t')->truncate();")).toEqual([[1, 'ddl', 'truncate']])
    expect(reasons("DB::unprepared('ALTER TABLE t ADD c int');")).toEqual([[1, 'ddl', 'ALTER TABLE']])
    expect(reasons("DB::statement('rename table a to b');\nDB::statement('drop index i on t');"))
      .toEqual([[1, 'ddl', 'rename table'], [2, 'ddl', 'drop index']])
    expect(reasons("Artisan::call('migrate:fresh');")).toEqual([[1, 'ddl', 'migrate:fresh']])
  })

  it('finds the snippet closing or opening the transaction itself', () => {
    expect(reasons('DB::commit();\nDB::rollBack();\nDB::beginTransaction();')).toEqual([
      [1, 'transaction', 'commit'],
      [2, 'transaction', 'rollBack'],
      [3, 'transaction', 'beginTransaction'],
    ])
    expect(reasons("DB::unprepared('COMMIT');")).toEqual([[1, 'transaction', 'COMMIT']])
    expect(reasons("DB::getPdo()->exec('start transaction');")).toEqual([[1, 'transaction', 'start transaction']])
  })

  it('finds another connection, which was never inside the dry run', () => {
    expect(reasons("DB::connection('sqlite')->table('s')->insert(['a' => 1]);"))
      .toEqual([[1, 'connection', 'connection']])
    expect(reasons("User::on('replica')->first();")).toEqual([[1, 'connection', 'on']])
    expect(reasons('$user->setConnection($name);')).toEqual([[1, 'connection', 'setConnection']])
  })

  it('leaves the default connection and a join condition alone', () => {
    expect(reasons("DB::connection()->table('t')->insert(['a' => 1]);")).toEqual([])
    expect(reasons("DB::table('a')->join('b', fn ($j) => $j->on('a.id', '=', 'b.a_id'))->get();")).toEqual([])
    expect(reasons("$user->update(['name' => 'n']);\nDB::table('t')->delete();")).toEqual([])
  })

  it('finds a reconnect, a purge and the default connection swapped', () => {
    expect(reasons("DB::reconnect();\nDB::purge('mysql');")).toEqual([
      [1, 'reconnect', 'reconnect'],
      [2, 'reconnect', 'purge'],
    ])
    expect(reasons("config(['database.default' => 'sqlite']);"))
      .toEqual([[1, 'config', 'database.default']])
    expect(reasons("Config::set('database.default', 'sqlite');"))
      .toEqual([[1, 'config', 'database.default']])
  })
})
