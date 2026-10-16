import {mutationScan} from '../mutationScan'

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
