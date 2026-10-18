const {randomBytes} = require('crypto')

const {stripRendering} = require('./terminalOutput')

/**
 * The marker the run prints as the first thing it does.
 *
 * Everything the session wrote before it belongs to the session booting — the
 * prompt the shell starts with, the connection's command, the banner psysh
 * prints, the readline echoing the wrapped command back — and none of it is the
 * run's output. Waiting for the echo of the wrapped command is not enough to
 * tell the two apart: the shell echoes the line long before psysh is up, so
 * psysh's banner still follows it.
 *
 * @return {String}
 */
const createStartMarker = () => `STRT${randomBytes(6).toString('hex').toUpperCase()}`

/**
 * A run is wrapped so the session prints the value of the snippet between two
 * markers instead of only rendering it as text:
 *
 *   <marker>@<base64 of the json value>@
 *
 * The marker is new for every run, so an answer that arrives late can never be
 * read as another run's, and so the filter below can hold back a marker that is
 * split across two chunks of the stream.
 *
 * `@` is not in the base64 alphabet and the terminal never writes one while it
 * renders, so the first `@` after the marker ends the value.
 *
 * @return {String}
 */
const createMarker = () => `TINKR${randomBytes(6).toString('hex').toUpperCase()}`

/**
 * A php single quoted string, which is only backslashes and quotes to escape.
 *
 * @param {String} value
 * @return {String}
 */
const phpString = value => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/**
 * The php that puts the classes the snippet named into the session, by their
 * short name, before the snippet runs.
 *
 * A `use` statement cannot be written into an eval'd snippet, but `class_alias`
 * is a function called at run time, so `class_alias('App\Models\Order',
 * 'Order')` is what a missing `use App\Models\Order;` would have done.
 *
 * A name the session already answers to is left alone — what `Carbon`, `Str`
 * and php's own names are, and what a class the session ran earlier is — and a
 * name whose alias cannot be made is dropped rather than raised: the alias is a
 * convenience, an error in it must not become the run's error. `$tinkr_imported`
 * is what actually happened, and it is what the output reports.
 *
 * @param {Array<Array<String>>} entries short name => fully qualified name
 * @return {String} one line, or nothing when there is nothing to import
 */
const importBlock = entries => {
  if (entries.length === 0) {
    return ''
  }

  const map = entries.map(([name, qualified]) => `${phpString(name)}=>${phpString(qualified)}`).join(',')
  const defined = ['class_exists', 'interface_exists', 'trait_exists']
    .map(check => `${check}($tinkr_name)`)
    .join('||')

  return '$tinkr_imported=[];' +
    `foreach([${map}] as $tinkr_name=>$tinkr_class){` +
    `try{if(${defined}||(function_exists('enum_exists')&&enum_exists($tinkr_name))){continue;}` +
    'if(@class_alias($tinkr_class,$tinkr_name)){$tinkr_imported[$tinkr_name]=$tinkr_class;}}' +
    'catch(\\Throwable $tinkr_import_failure){}' +
    '}'
}

/**
 * php splits the snippet itself, and this is the loop that does it, kept in one
 * string per line for reading.
 *
 * The split and the loop that evaluates what it found are two arrays rather
 * than one, because a transaction guard is armed between them: a transaction has
 * to be open before the first statement is evaluated, and this is where that
 * seam is.
 */
const SPLIT_BLOCKS = [
  "$tinkr_tokens=token_get_all('<?php '.$tinkr_code);$tinkr_total=count($tinkr_tokens);",
  '$tinkr_stmts=[];$tinkr_stmt=\'\';$tinkr_line=0;$tinkr_l=1;$tinkr_stack=[];$tinkr_prev=null;',
  // what can follow a `}` and still belong to the same statement: a closure
  // being called, an index, a chained call, an operator. Anything else ends the
  // statement at the brace, which is what `if (…) { … }` needs
  "$tinkr_next=function($tinkr_all,$tinkr_i,$tinkr_count){for($tinkr_j=$tinkr_i+1;$tinkr_j<$tinkr_count;$tinkr_j++){$tinkr_t=$tinkr_all[$tinkr_j];if(is_array($tinkr_t)&&($tinkr_t[0]===T_WHITESPACE||$tinkr_t[0]===T_COMMENT||$tinkr_t[0]===T_DOC_COMMENT)){continue;}$tinkr_v=is_array($tinkr_t)?$tinkr_t[0]:$tinkr_t;return in_array($tinkr_v,[')',']','(',',','.','=','??','?',':','->','?->','::',T_OBJECT_OPERATOR,T_NULLSAFE_OBJECT_OPERATOR,T_DOUBLE_COLON,T_ELSE,T_ELSEIF,T_CATCH,T_FINALLY,T_WHILE,T_INSTANCEOF],true);}return false;};",
  'for($tinkr_i=0;$tinkr_i<$tinkr_total;$tinkr_i++){',
  '$tinkr_token=$tinkr_tokens[$tinkr_i];',
  '$tinkr_text=is_array($tinkr_token)?$tinkr_token[1]:$tinkr_token;',
  '$tinkr_id=is_array($tinkr_token)?$tinkr_token[0]:null;',
  'if($tinkr_id===T_OPEN_TAG){$tinkr_l=$tinkr_token[2];continue;}',
  // a token that is not an array is punctuation — `{`, `;`, `"` — and carries no
  // line of its own, so the last line any token reported is kept, which is what
  // the statement gets
  'if($tinkr_id!==null){$tinkr_l=$tinkr_token[2];}',
  'if(!$tinkr_stack&&$tinkr_line===0&&$tinkr_id!==T_WHITESPACE&&$tinkr_id!==T_COMMENT&&$tinkr_id!==T_DOC_COMMENT){$tinkr_line=(int)$tinkr_l;}',
  '$tinkr_stmt.=$tinkr_text;',
  '$tinkr_word=($tinkr_id===null)?trim($tinkr_text):null;',
  // an interpolated `"{$a}"` opens a brace with a token of its own, and its `}`
  // is punctuation like any other: the stack is what tells the two apart, so the
  // brace that closes an interpolation is not read as the end of a statement.
  // A counter cannot: `"v{$a}"` and `if (…) { … }` both come back to zero.
  // `$o->{'f'.'oo'}` is a third kind, a name spelled at run time: it is marked
  // like an interpolation, because a `}` there closes a name and not a block
  "if($tinkr_word==='('||$tinkr_word==='['){$tinkr_stack[]=$tinkr_word;}" +
  "elseif($tinkr_word==='{'){$tinkr_stack[]=in_array($tinkr_prev,['->','?->','::',T_OBJECT_OPERATOR,T_NULLSAFE_OBJECT_OPERATOR,T_DOUBLE_COLON,T_VARIABLE],true)?'@':'{';}" +
  'elseif($tinkr_id===T_CURLY_OPEN||$tinkr_id===T_DOLLAR_OPEN_CURLY_BRACES){$tinkr_stack[]=\'@\';}' +
  "elseif($tinkr_word===')'||$tinkr_word===']'||$tinkr_word==='}'){$tinkr_closed=array_pop($tinkr_stack);" +
  // the `}` that closes a name belongs to the statement, and one that closes a
  // block only ends it when nothing can follow it
  "if($tinkr_word==='}'&&(!$tinkr_stack)&&$tinkr_closed==='{'&&!$tinkr_next($tinkr_tokens,$tinkr_i,$tinkr_total)){" +
  "$tinkr_stmts[]=['line'=>$tinkr_line,'code'=>$tinkr_stmt];$tinkr_stmt='';$tinkr_line=0;}}" +
  "if(!$tinkr_stack&&$tinkr_word===';'){" +
  "$tinkr_stmts[]=['line'=>$tinkr_line,'code'=>$tinkr_stmt];$tinkr_stmt='';$tinkr_line=0;}" +
  // the token before a `{` is what says which kind of brace it is
  'if($tinkr_id!==T_WHITESPACE&&$tinkr_id!==T_COMMENT&&$tinkr_id!==T_DOC_COMMENT){$tinkr_prev=$tinkr_id===null?$tinkr_text:$tinkr_id;}',
  '}',
  "if(trim($tinkr_stmt)!==''){$tinkr_stmts[]=['line'=>$tinkr_line,'code'=>$tinkr_stmt];}",
]

/**
 * The loop that evaluates what the splitter found, one statement at a time.
 *
 * Every statement is evaluated in turn and its value kept beside its line, and
 * the loop stops at the first one that throws — at the statement it threw on,
 * with the ones before it standing. That is what running the snippet would have
 * done, and it is what the pane reads: `$tinkr_error` is the failure of the
 * whole run, and the blocks before it are what the run got through.
 *
 * It is one string per line for reading, and it is one line to php: the wrapped
 * command is a single line, which is what every block of the wrapper has to
 * keep being.
 */
const EVAL_BLOCKS = [
  '$tinkr_results=[];$tinkr_value=null;$tinkr_uses=false;',
  'foreach($tinkr_stmts as $tinkr_one){',
  "$tinkr_query_line=$tinkr_one['line'];",
  "$tinkr_source=rtrim($tinkr_one['code']);",
  // a `use` is compiled with the code it is written in, and every statement is
  // its own eval, so a use is kept and written in front of what comes after it:
  // without that, `use Illuminate\Support\Collection;` is gone by the time the
  // statement that names `Collection` runs
  "if(preg_match('/^\\s*use\\s/i',$tinkr_source)===1){$tinkr_uses=($tinkr_uses?:'').$tinkr_source;" +
    "if(substr(rtrim($tinkr_uses),-1)!==';'){$tinkr_uses.=';';}" +
    "$tinkr_results[]=['line'=>$tinkr_one['line'],'value'=>$tinkr_value,'error'=>null];continue;}",
  'if(substr($tinkr_source,-1)!==\';\'){$tinkr_source.="\\n;";}',
  '$tinkr_block_error=null;',
  'try{',
  "try{$tinkr_value=eval($tinkr_uses.'return '.$tinkr_source);}",
  'catch(\\ParseError $tinkr_parse){$tinkr_value=eval($tinkr_uses.$tinkr_source);}',
  '}catch(\\Throwable $tinkr_failure){',
  // the exception's own words, and the one it was thrown from: a `previous`
  // is where the real cause usually is
  "$tinkr_block_error=['class'=>get_class($tinkr_failure),'message'=>$tinkr_failure->getMessage()];" +
    "if($tinkr_failure->getPrevious()!==null){$tinkr_block_error['previous']=['class'=>get_class($tinkr_failure->getPrevious()),'message'=>$tinkr_failure->getPrevious()->getMessage()];}",
  '}',
  "$tinkr_results[]=['line'=>$tinkr_one['line'],'value'=>$tinkr_value,'error'=>$tinkr_block_error];",
  'if($tinkr_block_error!==null){$tinkr_error=$tinkr_block_error;break;}',
  '}',
]

/**
 * The php that collects the queries the snippet runs.
 *
 * Laravel dispatches `QueryExecuted` for every statement it sends to any of its
 * connections, and a listener on that event is how the run sees its own queries
 * without turning query logging on: nothing is enabled, nothing has to be turned
 * off when the run ends, and every connection is covered, not only the default
 * one.
 *
 * The listener writes into the run's own variables by reference, so the list the
 * envelope reports is the list the event filled while the statements ran.
 * `$tinkr_query_line` is the line of the statement being evaluated, which is what
 * tells a query apart from the statement that asked for it, and
 * `$tinkr_query_connections` counts what each connection was sent, which is what
 * lets a transaction guard say how many statements it held. That count is of
 * every query, not of the stored ones, so a run past the storage limits still
 * reports what it sent.
 *
 * A session that is not a booted laravel application has no event dispatcher,
 * and then no query is collected rather than the run failing: the envelope
 * reports an empty list, and the pane says the run executed none. The whole
 * block is guarded, because a project that cannot answer for its dispatcher must
 * still run its snippet.
 *
 * What is stored is bounded twice over, so a run over a thousand rows cannot
 * send a megabyte back through the terminal: the list holds a hundred queries,
 * and it stops taking new ones once it holds a couple of hundred kilobytes. A
 * query over that limit is not stored at all rather than stored cut, so what the
 * pane copies is always what the connection ran. The count is of every query
 * either way, which is what lets the pane say how many it is not showing.
 *
 * It is written in one line, like the rest of the wrapper: the wrapped command
 * is a single line of php, and it is php's own tokenizer that splits the snippet
 * afterwards, so the lines the envelope reports are the snippet's and not the
 * file's.
 */
const QUERY_BLOCK = '$tinkr_queries=[];$tinkr_query_connections=[];$tinkr_query_total=0;$tinkr_query_size=0;$tinkr_query_line=0;' +
  '$tinkr_query_binding=function($tinkr_one){' +
  "if(is_string($tinkr_one)){return strlen($tinkr_one)>120?substr($tinkr_one,0,120).'...':$tinkr_one;}" +
  'if($tinkr_one===null||is_bool($tinkr_one)||is_int($tinkr_one)||is_float($tinkr_one)){return $tinkr_one;}' +
  "return '['.(is_object($tinkr_one)?get_class($tinkr_one):gettype($tinkr_one)).']';};" +
  "try{if(function_exists('app')&&app()->bound('events')&&class_exists('Illuminate\\\\Database\\\\Events\\\\QueryExecuted')){" +
  "app('events')->listen('Illuminate\\\\Database\\\\Events\\\\QueryExecuted'," +
  'function($tinkr_query)use(&$tinkr_queries,&$tinkr_query_connections,&$tinkr_query_total,&$tinkr_query_size,&$tinkr_query_line,&$tinkr_query_binding){' +
  '$tinkr_query_total++;' +
  // how many statements each connection got, so a transaction guard can say how
  // many it held. It counts every query, stored or not: a run over the storage
  // limits still rolls back everything it sent.
  '$tinkr_query_connections[$tinkr_query->connectionName]=($tinkr_query_connections[$tinkr_query->connectionName]??0)+1;$tinkr_bindings=[];' +
  'foreach($tinkr_query->bindings as $tinkr_one){$tinkr_bindings[]=$tinkr_query_binding($tinkr_one);}' +
  "$tinkr_bytes=strlen($tinkr_query->sql)+strlen(implode('',$tinkr_bindings));" +
  'if(count($tinkr_queries)>=100||$tinkr_query_size+$tinkr_bytes>200000){return;}' +
  '$tinkr_query_size+=$tinkr_bytes;' +
  "$tinkr_queries[]=['line'=>$tinkr_query_line,'sql'=>$tinkr_query->sql,'bindings'=>$tinkr_bindings," +
  "'time'=>round($tinkr_query->time,2),'connection'=>$tinkr_query->connectionName];});}}" +
  'catch(\\Throwable $tinkr_query_failure){}'

/**
 * The php that opens the transaction a guarded run is evaluated inside.
 *
 * It runs after the snippet has been split and before its first statement is
 * evaluated, so everything the run sends to the default connection is inside the
 * transaction — including the statements a run that throws got through before it
 * threw, which is the half-written state a dry run exists to avoid.
 *
 * The mode is baked in: `rollback` closes the transaction by taking it back, and
 * `commit` closes it by keeping it, which is what a run the pane offered to
 * apply is sent with.
 *
 * A guard that cannot be armed refuses the run rather than letting it through:
 * the statements are dropped, so nothing is evaluated and nothing can be
 * changed. A run that could not be undone must not be run under a promise that
 * it was, and a session with no database to guard (a project that is not a
 * booted laravel application, a connection that will not begin a transaction)
 * is exactly that case. The failure is reported twice over, the way the pane
 * reads a run: `$tinkr_error` is the run's failure, and it stops where the
 * snippet would have started, so the run reads as a run that did not happen.
 *
 * @param {String} mode `rollback` or `commit`
 * @return {String} one line
 */
const guardArm = mode => `$tinkr_tx=null;$tinkr_tx_armed=false;$tinkr_tx_error=null;$tinkr_tx_mode='${mode}';$tinkr_tx_level=0;` +
  "try{if(!function_exists('app')||!app()->bound('db')){" +
  "$tinkr_tx_error='this session has no database connection to guard';}" +
  "else{$tinkr_db=app('db')->connection();$tinkr_tx=$tinkr_db->getName();" +
  '$tinkr_db->beginTransaction();$tinkr_tx_armed=true;$tinkr_tx_level=$tinkr_db->transactionLevel();}}' +
  'catch(\\Throwable $tinkr_tx_failure){' +
  "$tinkr_tx_error='the connection refused to begin a transaction: '.$tinkr_tx_failure->getMessage();}" +
  'if(!$tinkr_tx_armed){$tinkr_stmts=[];' +
  "$tinkr_error=['class'=>'RuntimeException','message'=>'the transaction guard could not be armed: '.$tinkr_tx_error];}"

/**
 * What one value is worth in the envelope.
 *
 * `json_encode` fails on some values rather than describing them: invalid
 * UTF-8 and a resource come out as `null`, a float that is not finite comes out
 * as `0`, and an integer past 2^53 is read back as a rounded float by
 * javascript. Each is answered with a string that says what it was, so a run
 * never reports a value it did not have.
 *
 * A map keeps php's own order where javascript would not: keys are written as
 * they are, and the order they were in travels beside them, because javascript
 * reads integer-like keys back in numeric order.
 *
 * @param {any} value
 * @param {Number} [depth] how far in the walk has gone, which bounds it
 * @return {any}
 */
const SAFE_ENCODE = '$tinkr_safe=function($tinkr_v,$tinkr_d=0)use(&$tinkr_safe){' +
  'if($tinkr_d>12){return "[deeper than 12 levels]";}' +
  // a float that cannot be written: json_encode writes INF and NAN as 0
  'if(is_float($tinkr_v)){if(is_nan($tinkr_v)){return "NAN";}if(is_infinite($tinkr_v)){return $tinkr_v>0?"INF":"-INF";}return $tinkr_v;}' +
  // an integer past 2^53 cannot be read back by javascript, and JSON turns it
  // into a float: it is written as the digits it is
  'if(is_int($tinkr_v)){if($tinkr_v>9007199254740991||$tinkr_v<-9007199254740991){return (string)$tinkr_v;}return $tinkr_v;}' +
  // a string that is not UTF-8 is dropped by json_encode: it is shown as the
  // bytes it is, which is what a hex dump would say
  'if(is_string($tinkr_v)){if(!preg_match("//u",$tinkr_v)){return "0x".bin2hex($tinkr_v);}return $tinkr_v;}' +
  'if(is_array($tinkr_v)){$tinkr_out=[];' +
  'foreach($tinkr_v as $tinkr_k=>$tinkr_item){$tinkr_out[$tinkr_k]=$tinkr_safe($tinkr_item,$tinkr_d+1);}' +
  // a list reads back as a list. A map with integer-like keys does not: JSON
  // reads `{"3":…,"1":…}` back in numeric order, so the order php had travels
  // beside the values, and the pane puts them back the way they ran
  '$tinkr_int=false;foreach(array_keys($tinkr_v) as $tinkr_k){if(is_int($tinkr_k)){$tinkr_int=true;break;}}' +
  'return $tinkr_int&&array_keys($tinkr_v)!==range(0,count($tinkr_v)-1)' +
  '?["__tinkrMap"=>$tinkr_out,"__tinkrKeys"=>array_map("strval",array_keys($tinkr_v))]:$tinkr_out;}' +
  // a value that throws from its own serialization is described by its class:
  // asking it again would throw again, and there would be no envelope at all
  'if($tinkr_v instanceof \\JsonSerializable){try{json_encode($tinkr_v);return $tinkr_v;}' +
  'catch(\\Throwable $tinkr_e){return "[".get_class($tinkr_v)." could not be serialized: ".$tinkr_e->getMessage()."]";}}' +
  'return $tinkr_v;};'

/**
 * The php that closes the transaction, and the envelope key that reports it.
 *
 * It runs after the last statement, on the way out of a run that threw as much
 * as out of one that returned: the transaction is closed either way, because a
 * dry run that threw is still a dry run and keeps nothing.
 *
 * `statements` is what the guarded connection was sent, taken from the query
 * listener's own tally rather than from the stored list, so a run over the
 * collection limits reports the whole count and not the stored part of it.
 *
 * The outcome is one word rather than a pair of flags, because exactly one of
 * them can be true: `rolledBack`, `committed`, `broken` or `failed`. `broken`
 * is the one that matters most to read: the transaction the guard opened was
 * gone before the close, so what the run changed may have been kept.
 *
 * @return {String} one line
 */
const guardFinish = "$tinkr_tx_outcome='failed';$tinkr_tx_open=false;" +
  'if($tinkr_tx_armed){' +
  // whether the transaction the guard opened is still the one the connection is
  // in. MySQL commits implicitly on DDL and on TRUNCATE, the snippet can commit
  // or roll back itself, and a reconnect or purge drops the transaction with the
  // connection: in every one of those Laravel's rollBack() finds no transaction
  // and quietly does nothing, so the run would be reported as taken back while
  // its changes were kept. That check is what this is for
  'try{$tinkr_tx_open=$tinkr_db->transactionLevel()===$tinkr_tx_level&&' +
  '(method_exists($tinkr_db,"getPdo")?$tinkr_db->getPdo()->inTransaction():true);}catch(\\Throwable $tinkr_tx_probe){$tinkr_tx_open=false;}' +
  'try{' +
  "if($tinkr_tx_mode==='commit'){" +
  // a run that threw is not kept, whatever it was sent with: half of it is done
  // and the rest is not, and keeping that is what the pane never offered
  'if($tinkr_error!==null){$tinkr_db->rollBack();$tinkr_tx_outcome="rolledBack";' +
  '$tinkr_tx_error="the run threw, so nothing was kept";' +
  '}else{$tinkr_db->commit();$tinkr_tx_outcome="committed";}' +
  '}elseif(!$tinkr_tx_open){' +
  '$tinkr_tx_outcome="broken";' +
  '$tinkr_tx_error="the transaction was closed before the run ended — a statement that MySQL commits on its own (DDL, TRUNCATE), the snippet\'s own commit or rollback, or a connection made again — so what the run changed may have been kept";' +
  '}else{$tinkr_db->rollBack();$tinkr_tx_outcome="rolledBack";}' +
  '}catch(\\Throwable $tinkr_tx_failure){' +
  '$tinkr_tx_error=$tinkr_tx_failure->getMessage();}}' +
  // what went to a connection other than the guarded one was never in the
  // transaction, and is reported rather than claimed
  '$tinkr_tx_other=[];' +
  'foreach($tinkr_query_connections as $tinkr_tx_name=>$tinkr_tx_count){' +
  'if($tinkr_tx_name!==$tinkr_tx){$tinkr_tx_other[$tinkr_tx_name]=$tinkr_tx_count;}}' +
  '$tinkr_transaction=[' +
  "'mode'=>$tinkr_tx_mode,'armed'=>$tinkr_tx_armed,'connection'=>$tinkr_tx," +
  "'statements'=>($tinkr_tx===null?0:($tinkr_query_connections[$tinkr_tx]??0))," +
  "'outcome'=>$tinkr_tx_outcome,'error'=>$tinkr_tx_error,'unguarded'=>(object)$tinkr_tx_other];"

/**
 * The php that prints the run's answer, and the one that prints it when the
 * normal path never gets there.
 *
 * The envelope is printed inside the markers as base64 json: what every
 * statement answered, what the run printed, every query it sent, and how the
 * guard ended. Everything the terminal does to a long line — wrapping it,
 * colouring it — happens outside that base64, which is why it survives.
 *
 * `exit()`, `die()`, `dd()`, a memory limit and a redeclared class all stop the
 * wrapper where it stands, and a stopped wrapper prints nothing: the client then
 * waits out the whole timeout for an answer that is not coming. So a shutdown
 * function prints the same envelope from whatever the wrapper had reached —
 * `$tinkr_sent` is what keeps it to one envelope, and the normal path sets it
 * before it prints.
 *
 * A fatal error is `error_get_last()`. Leaving any other way is the run ending
 * on purpose, and that is said as itself: a `dd()` that showed its value and
 * stopped is a run that answered and then stopped, which is not a failure of the
 * wrapper.
 *
 * @param {String} keys the envelope's own keys, comma separated
 * @return {{print: String, shutdown: String}} both lines
 */
const printer = (keys, close = '') => {
  const echo = `echo $tinkr,"@",base64_encode(json_encode(${keys},JSON_PARTIAL_OUTPUT_ON_ERROR)),"@";`
  const ended = '$tinkr_last=error_get_last();' +
    'if($tinkr_error===null&&$tinkr_last!==null&&in_array($tinkr_last["type"],' +
    '[E_ERROR,E_PARSE,E_CORE_ERROR,E_COMPILE_ERROR,E_USER_ERROR,E_RECOVERABLE_ERROR],true)){' +
    '$tinkr_error=["class"=>"FatalError","message"=>$tinkr_last["message"]];}' +
    'elseif($tinkr_error===null){' +
    '$tinkr_error=["class"=>"Exit","message"=>"exit(), die() or dd() stopped the run before it answered"];}'

  return {
    /**
     * the normal path, once every statement has run: the run's own error is the
     * only one there is, and a run that ended in one returned nothing
     */
    print: `$tinkr_sent=true;if($tinkr_error!==null){$tinkr_value=null;}${echo}`,
    /**
     * the path a run takes out through exit(), a fatal, or a kill: whatever the
     * wrapper had reached is the answer, with the reason it stopped.
     *
     * A guarded run that left this way never reached its own close, so the
     * transaction is closed here as well — and `$tinkr_transaction` is what says
     * whether it still has to be: a run that got to the normal close has already
     * spent it.
     */
    shutdown: 'register_shutdown_function(function()use(&$tinkr_sent,&$tinkr_results,&$tinkr_value,&$tinkr_error,' +
      '&$tinkr_queries,&$tinkr_query_total,&$tinkr_imported,&$tinkr_transaction,&$tinkr_safe,$tinkr' +
      (close
        ? ',&$tinkr_db,&$tinkr_tx,&$tinkr_tx_armed,&$tinkr_tx_error,&$tinkr_tx_mode,&$tinkr_tx_level,' +
        '&$tinkr_query_connections'
        : '') + '){' +
      `if($tinkr_sent){return;}${ended}$tinkr_value=null;` +
      (close ? 'if($tinkr_tx_armed&&!isset($tinkr_transaction)){' + close + '}' : '') +
      `${echo}});`,
  }
}

/**
 * Wrap a snippet so the session prints what every statement in it answered.
 *
 * The snippet is passed as base64 so nothing in it has to be escaped, and php
 * splits it with its own tokenizer: where a statement ends is a string, a heredoc
 * or a `for (;;)` away from what counting semicolons would say. Every statement
 * is evaluated in turn — an expression as its value, a `dump` call as what it
 * returned, a loop as nothing — and the run stops at the first one that throws,
 * which is what running the snippet would have done.
 *
 * eval keeps the scope of the session, so what one statement assigns is what the
 * next one reads, and the variables of earlier runs are visible too. php wants
 * what it evaluates to end in a `;`, which is what the one appended to a
 * statement that has none is for: a scratchpad writes `$user->name` for its last
 * line and without it that is a parse error.
 *
 * The marker is built from two pieces so it never shows up in the echo of the
 * line itself: the filter would otherwise find the marker in that echo, which
 * has no closing marker, and swallow the value that comes later.
 *
 * The envelope carries what every statement answered, what the run printed, and
 * every query the run sent to a connection, with the line of the statement that
 * sent it: `QUERY_BLOCK` listens before the first statement runs and the list it
 * fills travels out with the values. Those queries are kept out of the run's own
 * answer, so a snippet that never asks about the database is unaffected by the
 * collection.
 *
 * A guarded run — `rollback` is a dry run, `commit` is one the pane offers to
 * apply — carries a `transaction` key as well: what was asked of the guard, the
 * connection it opened on, how many statements that connection was sent, and how
 * the transaction ended. An unguarded run is sent without the key, so a snippet
 * run the way it always was is unaffected by the guard as well.
 *
 * What a project without a composer directory cannot tell is the `imported` key
 * and the aliasing that fills it: those are the parts of the wrapper that
 * depend on what the project resolved, and a run that resolved nothing is sent
 * without them.
 *
 * @param {String} source
 * @param {Object<String, String>} [imports] short class name => fully qualified
 * name, as classIndex.importsFor resolves them
 * @param {String} [guard] `rollback` or `commit`, and nothing else: an
 * unrecognized mode is not guessed at, it is no guard at all
 * @return {{marker: String, start: String, imports: Object, code: String}}
 */
const wrapRun = (source, imports = {}, guard = null) => {
  // a snippet can be written like a file and open with `<?php`, but it is eval'd
  // here, where the opening tag is a parse error, so it is dropped
  const code = source.replace(/^\s*<\?(?:php)?\s*/, '')

  const marker = createMarker()
  const start = createStartMarker()
  const encoded = Buffer.from(code, 'utf8').toString('base64')
  const entries = Object.entries(imports)
  const mode = guard === 'commit' ? 'commit' : (guard === 'rollback' ? 'rollback' : null)
  const keys = [
    '[',
    // what every statement answered, with the line of the statement that did
    "'blocks'=>$tinkr_safe($tinkr_results),",
    // a run that ended in an error returned nothing, whatever the statement
    // before the one that threw had left in the variable
    "'value'=>$tinkr_error!==null?null:$tinkr_safe($tinkr_value),",
    "'error'=>$tinkr_error,",
    "'queries'=>$tinkr_safe($tinkr_queries),'queriesTotal'=>$tinkr_query_total",
    // what the run's own names resolved to, when the project resolved any
    entries.length ? ",'imported'=>(object)$tinkr_imported" : '',
    mode ? ",'transaction'=>$tinkr_transaction" : '',
    ']',
  ].join('')
  // a guarded run that leaves through exit() never reaches its own close, so the
  // close is part of the shutdown path too: it runs only when the transaction is
  // still the one the guard opened, which `$tinkr_transaction` says
  const {print, shutdown} = printer(keys, mode ? guardFinish : '')
  const split = 4

  return {
    marker,
    start,
    imports,
    code: [
      `$tinkr='${marker.slice(0, split)}'.'${marker.slice(split)}';`,
      `$tinkr_start='${start.slice(0, split)}'.'${start.slice(split)}';`,
      `$tinkr_code=base64_decode('${encoded}');`,
      // the values that cannot be written as themselves are written as what
      // they are, so nothing comes back as a null it never was
      SAFE_ENCODE,
      '$tinkr_error=null;$tinkr_sent=false;',
      importBlock(entries),
      // the pane reads the run from here: everything the session printed before
      // this line is the session booting
      'echo $tinkr_start;',
      // a run that leaves early — exit(), dd(), a fatal — still answers, which
      // is what the shutdown function is for
      shutdown,
      // the queries are collected from before the first statement runs, and the
      // listener stays for as long as the session does
      QUERY_BLOCK,
      ...SPLIT_BLOCKS,
      // the transaction is open before the first statement of the run, and it is
      // closed after the last one, whether that last one returned or threw
      mode ? guardArm(mode) : '',
      ...EVAL_BLOCKS,
      mode ? guardFinish : '',
      print,
    ].join(''),
  }
}

/**
 * Lifts the envelope out of what the session prints.
 *
 * Everything the session writes is forwarded to the terminal except the
 * envelope, which turns into the parsed value instead. A marker can arrive
 * split across two chunks, so a tail that could still become one is held back
 * until the next chunk says whether it was.
 */
// what the session echoes back before it runs the wrapped command, so the
// filter can swallow it however the chunks happen to split
const ECHO = '=base64_decode('

class RunResultFilter {
  /**
   * @param {String} marker the marker the value is printed inside
   * @param {String} start the marker the run prints before it evaluates
   */
  constructor(marker, start) {
    this.marker = marker
    this.start = start
    this.buffer = ''
    this.capturing = false
    this.captured = []
    this.capturedLength = 0
    // what the run printed, once the session stopped booting, up to the envelope
    this.printed = ''
    this.started = false
    // whether the marker's own line ending has been dropped from the run yet
    this.trimmed = false
    this.done = false
    // a marker can arrive split across chunks, so a tail long enough to still
    // hold one is held back until the next chunk settles whether it was there
    this.tail = ''
  }

  /**
   * The run's own output, out of what the session wrote.
   *
   * The run prints its start marker as the first thing it does, and everything
   * the session wrote before it is the session booting: the prompt the shell
   * starts with, the connection's command, the banner psysh prints, the
   * readline echoing the wrapped command back. None of it is the run's, and it
   * shares a chunk with the marker more often than not.
   *
   * The cut is made on the text rather than on whole lines, because nothing
   * says a line ends where the marker does: with nothing between them, psysh
   * writes the value right after the marker.
   *
   * @param {String} text
   * @return {String}
   */
  runOf(text) {
    let rest = text

    if (!this.started) {
      const at = rest.indexOf(this.start)

      if (at === -1) {
        return ''
      }

      this.started = true
      this.printed = ''
      rest = rest.slice(at + this.start.length)
    }

    const out = rest.split(this.start).join('')

    // the marker is the app's own, wherever else it turns up, and the line
    // ending it is printed with is not the run's output: psysh usually merges
    // that away, but not always
    if (this.trimmed || out === '') {
      return out
    }

    this.trimmed = true

    return out.replace(/^\r?\n/, '')
  }

  /**
   * @param {String} data
   * @return {{output: String, run: String, result: Object|null}} `output` is
   * what is left of the chunk for the terminal, `run` is the run's own stream
   * once the snippet was handed the session, and `result` is set once the value
   * came in
   */
  push(data) {
    const buffer = this.buffer + data

    this.buffer = ''

    if (this.capturing) {
      return this.capture(buffer)
    }

    const found = buffer.indexOf(this.marker)

    if (found === -1) {
      // keep a tail that could still be the beginning of a marker
      const held = this.heldTail(buffer)

      this.buffer = held

      let output = this.tail + buffer.slice(0, buffer.length - held.length)

      this.tail = ''

      // the partial line is held until it ends, so a line is always seen whole
      const lastNewline = output.lastIndexOf('\n')

      this.tail = output.slice(lastNewline + 1)
      output = output.slice(0, lastNewline + 1)

      // the session echoes the wrapped command back (the shell once, and its
      // readline again); that echo is the point the session stops booting and
      // the snippet starts printing
      const run = this.runOf(output)

      if (this.started && !this.done) {
        this.printed += run
      }

      // the terminal keeps the session as it is, minus the readline echoing the
      // wrapped command back
      const terminal = output
        .split('\n')
        .filter(line => !line.includes(ECHO))
        .join('\n')
        .split(this.start)
        .join('')

      return {output: terminal, run: this.done ? '' : run, result: null}
    }

    const before = this.tail + buffer.slice(0, found)

    this.tail = ''

    // the marker the run prints first is in this chunk as often as not: the
    // value it printed is written right after it
    const run = this.runOf(before)

    if (this.started && !this.done) {
      this.printed += run
    }

    this.capturing = true

    const captured = this.capture(buffer.slice(found + this.marker.length))

    return {
      output: before.split(this.start).join('') + captured.output,
      run,
      result: captured.result,
    }
  }

  /**
   * @param {String} data everything after the opening marker
   * @return {{output: '', result: Object|null}}
   */
  capture(data) {
    // the envelope can be megabytes — a value the snippet returned, a `dump` of
    // a big array — and it arrives in as many chunks as the terminal cares to
    // send. Joining what has arrived on every chunk to search it again is
    // quadratic in the size of the envelope, so each chunk is searched as it
    // comes and only kept when it holds no closing marker
    const end = data.indexOf('@', this.capturedLength === 0 ? 1 : 0)

    if (end === -1) {
      this.captured.push(data)
      this.capturedLength += data.length

      return {output: '', run: '', result: null}
    }

    this.captured.push(data.slice(0, end))

    const payload = this.captured.join('')
    const rest = data.slice(end + 1)

    this.capturing = false
    this.captured = []
    this.capturedLength = 0
    // the run is over: what follows is the session's own prompt
    this.done = true

    // whatever the chunk holds after the envelope belongs to the terminal
    const next = rest ? this.push(rest) : {output: '', run: '', result: null}

    return {output: next.output, run: next.run, result: parseResult(payload) || next.result}
  }

  /**
   * @param {String} data
   * @return {String} the longest tail of `data` that is a prefix of the marker
   */
  heldTail(data) {
    const longest = Math.max(this.marker.length, this.start.length) - 1

    for (let length = Math.min(longest, data.length); length > 0; length--) {
      const tail = data.slice(data.length - length)

      if (this.marker.startsWith(tail) || this.start.startsWith(tail)) {
        return tail
      }
    }

    return ''
  }
}

/**
 * @param {String} payload base64 json, with whatever the terminal rendered into it
 * @return {Object|null}
 */
const parseResult = payload => {
  const base64 = stripRendering(payload).replace(/[^A-Za-z0-9+/=]/g, '')

  try {
    // the session prints {value, error}
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
  } catch (e) {
    return null
  }
}

module.exports = {
  createMarker,
  createStartMarker,
  wrapRun,
  RunResultFilter,
  phpString,
  parseResult,
}
