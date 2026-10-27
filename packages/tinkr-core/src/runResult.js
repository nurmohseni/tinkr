const {randomBytes} = require('crypto')

const {stripRendering} = require('./terminalOutput')
const sandbox = require('./sandbox')

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
  // `class_exists($name)` asks the autoloaders too, and tinker's own
  // ClassAliasAutoloader answers by aliasing the name it was asked for: the
  // class is then defined, the check looks satisfied, and the wrapper reports
  // nothing for a name it was the one to resolve. Asking without autoloading is
  // what tells an existing definition from one this block has yet to make
  const defined = ['class_exists', 'interface_exists', 'trait_exists']
    .map(check => `${check}($tinkr_name,false)`)
    .join('||')

  return '$tinkr_imported=[];' +
    `foreach([${map}] as $tinkr_name=>$tinkr_class){` +
    `try{if(${defined}||(function_exists('enum_exists')&&enum_exists($tinkr_name,false))){continue;}` +
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
  '$tinkr_stmts=[];$tinkr_stmt=\'\';$tinkr_line=0;$tinkr_l=1;$tinkr_stack=[];$tinkr_prev=null;$tinkr_do=false;',
  // the blocks written with php's alternative syntax that are open: inside one,
  // a `;` ends a line of the block and not the statement, which is the whole of
  // `foreach (…): … endforeach;`. `$tinkr_ctl` is the keyword whose header is
  // being read, and `$tinkr_ctl_closed` says its `)` has been: a `:` next is
  // what opens the block
  '$tinkr_alt=0;$tinkr_ctl=null;$tinkr_ctl_closed=false;',
  // what can follow a `}` and still belong to the same statement: the `;` that
  // ends it, an index, a chained call, an operator. Anything else ends the
  // statement at the brace, which is what `if (…) { … }` needs. A `(` is not one
  // of them: a declaration — `class A { … }` — is followed by a statement of its
  // own, and the line after one can open with a parenthesis
  "$tinkr_next=function($tinkr_all,$tinkr_i,$tinkr_count){for($tinkr_j=$tinkr_i+1;$tinkr_j<$tinkr_count;$tinkr_j++){$tinkr_t=$tinkr_all[$tinkr_j];if(is_array($tinkr_t)&&($tinkr_t[0]===T_WHITESPACE||$tinkr_t[0]===T_COMMENT||$tinkr_t[0]===T_DOC_COMMENT)){continue;}$tinkr_v=is_array($tinkr_t)?$tinkr_t[0]:$tinkr_t;return in_array($tinkr_v,[')',']',';',',','.','=','??','?',':','->','?->','::',T_OBJECT_OPERATOR,T_NULLSAFE_OBJECT_OPERATOR,T_DOUBLE_COLON,T_ELSE,T_ELSEIF,T_CATCH,T_FINALLY,T_WHILE,T_INSTANCEOF],true);}return false;};",
  // the token that follows a `;` at the top level, and nothing else: a
  // continuation only belongs to the statement when it is one of these, which is
  // why this asks for the token itself and not whether it could continue
  '$tinkr_follow=function($tinkr_all,$tinkr_i,$tinkr_count){for($tinkr_j=$tinkr_i+1;$tinkr_j<$tinkr_count;$tinkr_j++){$tinkr_t=$tinkr_all[$tinkr_j];if(is_array($tinkr_t)&&($tinkr_t[0]===T_WHITESPACE||$tinkr_t[0]===T_COMMENT||$tinkr_t[0]===T_DOC_COMMENT)){continue;}return is_array($tinkr_t)?$tinkr_t[0]:$tinkr_t;}return null;};',
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
  '$tinkr_significant=$tinkr_id!==T_WHITESPACE&&$tinkr_id!==T_COMMENT&&$tinkr_id!==T_DOC_COMMENT;',
  // the token after a control header's `)`: a `:` opens an alternative block,
  // and an `elseif (…):` continues the one it is in
  "if($tinkr_significant&&$tinkr_ctl_closed){if($tinkr_word===':'&&$tinkr_ctl!==T_ELSEIF){$tinkr_alt++;}$tinkr_ctl=null;$tinkr_ctl_closed=false;}",
  'if(!$tinkr_stack&&in_array($tinkr_id,[T_IF,T_ELSEIF,T_FOREACH,T_FOR,T_WHILE,T_SWITCH,T_DECLARE],true)){$tinkr_ctl=$tinkr_id;}',
  // a `while` after a top-level `;` is the `while` of a `do` whose body had no
  // braces, and the `;` after the body belongs to that statement: any other
  // `while` after a `;` is a statement of its own
  'if(!$tinkr_stack&&$tinkr_id===T_DO){$tinkr_do=true;}',
  'if(!$tinkr_stack&&$tinkr_alt>0&&in_array($tinkr_id,[T_ENDIF,T_ENDFOREACH,T_ENDFOR,T_ENDWHILE,T_ENDSWITCH,T_ENDDECLARE],true)){$tinkr_alt--;}',
  // an interpolated `"{$a}"` opens a brace with a token of its own, and its `}`
  // is punctuation like any other: the stack is what tells the two apart, so the
  // brace that closes an interpolation is not read as the end of a statement.
  // A counter cannot: `"v{$a}"` and `if (…) { … }` both come back to zero.
  // `$o->{'f'.'oo'}` is a third kind, a name spelled at run time: it is marked
  // like an interpolation, because a `}` there closes a name and not a block
  "if($tinkr_word==='('||$tinkr_word==='['){$tinkr_stack[]=$tinkr_word;}" +
  "elseif($tinkr_word==='{'){$tinkr_stack[]=in_array($tinkr_prev,['->','?->','::','$',T_OBJECT_OPERATOR,T_NULLSAFE_OBJECT_OPERATOR,T_DOUBLE_COLON,T_VARIABLE],true)?'@':'{';}" +
  'elseif($tinkr_id===T_CURLY_OPEN||$tinkr_id===T_DOLLAR_OPEN_CURLY_BRACES){$tinkr_stack[]=\'@\';}' +
  "elseif($tinkr_word===')'||$tinkr_word===']'||$tinkr_word==='}'){$tinkr_closed=array_pop($tinkr_stack);" +
  "if($tinkr_word===')'&&!$tinkr_stack&&$tinkr_ctl!==null){$tinkr_ctl_closed=true;}" +
  // the `}` that closes a name belongs to the statement, and one that closes a
  // block only ends it when nothing can follow it
  "if($tinkr_word==='}'&&(!$tinkr_stack)&&$tinkr_alt===0&&$tinkr_closed==='{'&&!$tinkr_next($tinkr_tokens,$tinkr_i,$tinkr_total)){" +
  "$tinkr_stmts[]=['line'=>$tinkr_line,'code'=>$tinkr_stmt];$tinkr_stmt='';$tinkr_line=0;$tinkr_do=false;}}" +
  // a `;` on its own is no statement: evaluated, it would answer null over the
  // value of the one before it. And a `;` that a continuation follows is not the
  // end of the statement either: an unbraced `if (…) echo 1; else echo 2;` is
  // one statement, not two, and so is `do echo 1; while (…);`
  "if(!$tinkr_stack&&$tinkr_alt===0&&$tinkr_word===';'){" +
  '$tinkr_following=$tinkr_follow($tinkr_tokens,$tinkr_i,$tinkr_total);' +
  'if($tinkr_following===T_ELSE||$tinkr_following===T_ELSEIF||$tinkr_following===T_CATCH||$tinkr_following===T_FINALLY||($tinkr_do&&$tinkr_following===T_WHILE)){continue;}' +
  "if(trim($tinkr_stmt)!==';'){$tinkr_stmts[]=['line'=>$tinkr_line,'code'=>$tinkr_stmt];}$tinkr_stmt='';$tinkr_line=0;$tinkr_do=false;}" +
  // the token before a `{` is what says which kind of brace it is
  'if($tinkr_significant){$tinkr_prev=$tinkr_id===null?$tinkr_text:$tinkr_id;}',
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
 * Whether a statement is an expression is decided before any of it runs: php's
 * own tokenizer is asked whether `return <statement>` is syntax, and only the
 * answer chooses between `eval('return …')` and `eval(…)`. The older wrapper
 * chose by running the expression and catching the `ParseError` that was not
 * one, which ran the statement twice whenever it was an expression that threw —
 * `risky()` printed once for the probe and once for the retry. A `ParseError`
 * thrown while the statement runs is now the run's error, not a guess at its
 * shape.
 *
 * A statement that is not an expression is given a trailing internal flag: it
 * is appended on a line of its own, so a `//` comment at the end of the
 * statement cannot swallow it, and a top-level `return` — inside an `if`, a
 * loop, wherever the snippet wrote it — stops the eval before the assignment.
 * The flag being false is what says the snippet returned, so the loop stops
 * there with the returned value as the run's answer. A `return` inside a
 * closure or a function is that function's own and leaves the flag alone.
 *
 * Each block's value is normalized once here, at the boundary it was answered
 * at, and the run's final value is that same snapshot: an object's
 * `jsonSerialize` is asked once, and a value whose serialization prints stays
 * printed once. The raw value is not kept, and nothing re-normalizes what this
 * loop already normalized.
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
  '$tinkr_block_error=null;$tinkr_completed=false;$tinkr_expression=false;',
  // syntax only: nothing of the statement runs to find out what it is, so a
  // statement that throws while it runs is never run a second time. A source
  // that cannot be parsed at all is left to the statement form, which reports
  // the parse error as the run's own
  "try{token_get_all('<?php '.$tinkr_uses.'return '.$tinkr_source,TOKEN_PARSE);$tinkr_expression=true;}" +
    'catch(\\Throwable $tinkr_preflight){$tinkr_expression=false;}',
  'try{',
  "$tinkr_value=$tinkr_expression?eval($tinkr_uses.'return '.$tinkr_source):" +
    "eval($tinkr_uses.$tinkr_source.\"\\n\".'$tinkr_completed=true;');",
  '}catch(\\Throwable $tinkr_failure){',
  '$tinkr_value=null;$tinkr_completed=false;' +
  // the exception's own words, and the one it was thrown from: a `previous`
  // is where the real cause usually is
  "$tinkr_block_error=['class'=>get_class($tinkr_failure),'message'=>$tinkr_failure->getMessage()];" +
    "if($tinkr_failure->getPrevious()!==null){$tinkr_block_error['previous']=['class'=>get_class($tinkr_failure->getPrevious()),'message'=>$tinkr_failure->getPrevious()->getMessage()];}",
  '}',
  // the block's value as the envelope will carry it, and the final value is
  // this snapshot when this is the last block
  '$tinkr_value=$tinkr_safe($tinkr_value);',
  "$tinkr_results[]=['line'=>$tinkr_one['line'],'value'=>$tinkr_value,'error'=>$tinkr_block_error];",
  'if($tinkr_block_error!==null){$tinkr_error=$tinkr_block_error;break;}',
  // a statement that returned left the flag false, and the snippet ended there
  'if(!$tinkr_completed&&!$tinkr_expression){break;}',
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
 * The php that lets an interrupt end a run wherever the run is.
 *
 * Stopping a run is the terminal's ETX — SIGINT for the php in the foreground —
 * because the php is a `docker exec`, a `podman exec` or an `ssh` away, and the
 * signal the session's own process gets ends only the client on this machine
 * (see Session#kill). psysh catches SIGINT to break back to its prompt, and php
 * runs a caught signal only between two opcodes: a run blocked inside a query
 * never gets there. It was never stopped, it went on holding whatever it had
 * locked, and every run after it that touched the same rows waited on that lock
 * until it timed out as well, and stayed behind just the same.
 *
 * So while the snippet is evaluated, SIGINT is what the system makes it: the
 * end of the process, inside a blocking call or not, with no core written. The
 * database rolls back what an ended connection had open. psysh's own handler is
 * put back once the run is over, so an interrupt at the prompt is what it was.
 */
const INTERRUPT_ARM = '$tinkr_sigint=null;' +
  "if(function_exists('pcntl_signal')&&function_exists('pcntl_signal_get_handler')&&defined('SIGINT')){" +
  '$tinkr_sigint=pcntl_signal_get_handler(SIGINT);pcntl_signal(SIGINT,SIG_DFL);}'
const INTERRUPT_RESTORE = 'if($tinkr_sigint!==null){pcntl_signal(SIGINT,$tinkr_sigint);}'

/**
 * The php that ends a run on its own once its time is up.
 *
 * An interrupt has to reach the php, and sometimes nothing can: a connection
 * that dropped, a container started without a terminal, an app that was closed
 * mid-run. The run carries its own deadline instead: an alarm with SIGALRM's
 * default action, which ends the process where it runs, inside a blocking call
 * or not, with no core written. It is set to the whole second at or after the
 * run's timeout, which the app counts from before the session booted, so the
 * app's own stop always comes first and this is what is left when it cannot
 * arrive. A run that answers clears it, and the handler psysh had is put back.
 *
 * @param {Number|null} timeout the run's timeout, in milliseconds
 * @return {{arm: String, clear: String}} empty for a run with no timeout
 */
const deadlineOf = timeout => {
  if (!(Number(timeout) > 0)) {
    return {arm: '', clear: ''}
  }

  return {
    arm: '$tinkr_sigalrm=null;' +
      "if(function_exists('pcntl_alarm')&&function_exists('pcntl_signal_get_handler')&&defined('SIGALRM')){" +
      `$tinkr_sigalrm=pcntl_signal_get_handler(SIGALRM);pcntl_signal(SIGALRM,SIG_DFL);pcntl_alarm(${Math.ceil(timeout / 1000)});}`,
    clear: 'if($tinkr_sigalrm!==null){pcntl_alarm(0);pcntl_signal(SIGALRM,$tinkr_sigalrm);}',
  }
}

/**
 * The php that keeps a run's side effects out of the world.
 *
 * A transaction holds the database. It holds nothing else: `Mail::send`,
 * `dispatch`, `Http::post`, `Storage::put`, `Cache::put` and `Log::info` all
 * happen while the transaction is open and all of them are still there when it
 * is taken back. A dry run that says "rolled back" and sends a customer an email
 * is not a dry run, so a sandboxed one swaps those drivers for recorders first.
 *
 * Each swap is the framework's own test double rather than a pretend one: mail
 * goes to the `array` transport (every message is recorded, none leaves), jobs
 * and the bus to their fakes (a job is pushed nowhere and the fake keeps it),
 * the HTTP client to a fake that answers through a stub set and refuses
 * anything it was not given, every disk to a fake root under
 * `storage/framework`, the cache to an array store, logging to a handler that
 * keeps its records, and notifications to their fake.
 *
 * What was caught is counted on the way out (see `sandboxFinish`) rather than
 * described here: this runs in the session, and the envelope has to stay small.
 * A channel that could not be swapped is named in the report instead of being
 * left to look sandboxed — a project with no booted Laravel, a framework without
 * one of the fakes.
 *
 * The swaps are made once, before the first statement, and they last as long as
 * the session does. A session belongs to one run (see runCode), so nothing of a
 * sandbox outlives the run it was made for.
 *
 * It is written in one line, like the rest of the wrapper.
 *
 * @param {String} mode `sandbox`, or nothing at all
 * @return {String} one line, or nothing when the run is not sandboxed
 */
// the sandbox's two blocks, kept in a file of their own: they are php written
// over several lines, and reading them there is the point (see sandbox.js)
const sandboxArm = mode => (mode === 'sandbox' ? sandbox.arm : '')
const sandboxFinish = sandbox.finish

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
 * An object is walked like an array, and written back as an object so the
 * fields it has are the fields that come back, and an object with none is `{}`
 * and not `[]`. An internal class php's own json has a shape for keeps that
 * shape: a date and a timezone are their `date`/`timezone_type`/`timezone`
 * properties, an `ArrayObject` is its storage written as an object, and an
 * `SplFixedArray` is its elements written as a list. Their values are walked
 * too, so an unsafe scalar inside one is described rather than turned into a 0,
 * and a private or protected field is never exposed by the cast that reads them.
 * A `JsonSerializable` is asked for its value exactly once — here, at the
 * boundary the run answered at — and its answer is walked the same way; handing
 * the object itself to the envelope's `json_encode` would ask it again, and a
 * serializer that prints would print twice. A serializer that throws, a value
 * that refers back to itself, and one nested deeper than the limit are all
 * described instead of walked: there would otherwise be no envelope at all.
 *
 * @param {any} value
 * @param {Number} [depth] how far in the walk has gone, which bounds it
 * @return {any}
 */
const SAFE_ENCODE = '$tinkr_seen=[];' +
  '$tinkr_safe=function($tinkr_v,$tinkr_d=0)use(&$tinkr_safe,&$tinkr_seen){' +
  'if($tinkr_d>12){return "[deeper than 12 levels]";}' +
  // a float that cannot be written: json_encode writes INF and NAN as 0
  'if(is_float($tinkr_v)){if(is_nan($tinkr_v)){return "NAN";}if(is_infinite($tinkr_v)){return $tinkr_v>0?"INF":"-INF";}return $tinkr_v;}' +
  // an integer past 2^53 cannot be read back by javascript, and JSON turns it
  // into a float: it is written as the digits it is
  'if(is_int($tinkr_v)){if($tinkr_v>9007199254740991||$tinkr_v<-9007199254740991){return (string)$tinkr_v;}return $tinkr_v;}' +
  // a string that is not UTF-8 is dropped by json_encode: it is shown as the
  // bytes it is, which is what a hex dump would say
  'if(is_string($tinkr_v)){if(!preg_match("//u",$tinkr_v)){return "0x".bin2hex($tinkr_v);}return $tinkr_v;}' +
  // a resource has no json form at all: json_encode writes null
  'if(is_resource($tinkr_v)){return "[resource: ".get_resource_type($tinkr_v)."]";}' +
  'if(is_array($tinkr_v)){$tinkr_out=[];' +
  'foreach($tinkr_v as $tinkr_k=>$tinkr_item){$tinkr_out[$tinkr_k]=$tinkr_safe($tinkr_item,$tinkr_d+1);}' +
  // a list reads back as a list. A map with integer-like keys does not: JSON
  // reads `{"3":…,"1":…}` back in numeric order, so the order php had travels
  // beside the values, and the pane puts them back the way they ran
  '$tinkr_int=false;foreach(array_keys($tinkr_v) as $tinkr_k){if(is_int($tinkr_k)){$tinkr_int=true;break;}}' +
  'return $tinkr_int&&array_keys($tinkr_v)!==range(0,count($tinkr_v)-1)' +
  '?["__tinkrMap"=>$tinkr_out,"__tinkrKeys"=>array_map("strval",array_keys($tinkr_v))]:$tinkr_out;}' +
  // the serializer's answer is what the run had, and it is walked like any
  // other: the object itself is never handed on, so json_encode cannot ask it
  // a second time
  'if($tinkr_v instanceof \\JsonSerializable){' +
  'foreach($tinkr_seen as $tinkr_seen_one){if($tinkr_seen_one===$tinkr_v){return "[recursion]";}}' +
  '$tinkr_seen[]=$tinkr_v;' +
  'try{$tinkr_serialized=$tinkr_v->jsonSerialize();}' +
  'catch(\\Throwable $tinkr_e){array_pop($tinkr_seen);return "[".get_class($tinkr_v)." could not be serialized: ".$tinkr_e->getMessage()."]";}' +
  '$tinkr_serialized=$tinkr_safe($tinkr_serialized,$tinkr_d+1);array_pop($tinkr_seen);return $tinkr_serialized;}' +
  // an enum is an object, but its fields are not its value: a backed one's json
  // value is its value, and a pure one has no value json could write (it came
  // out as a 0), so it is named rather than reported as a value it never had.
  // A serializer it implements was asked above, because that is the answer the
  // enum itself chose
  'if($tinkr_v instanceof \\UnitEnum){return $tinkr_v instanceof \\BackedEnum?$tinkr_safe($tinkr_v->value,$tinkr_d+1):$tinkr_v->name;}' +
  // a plain object is walked field by field, but an internal one is not plain:
  // php's own json has a shape for several of them, and that shape is kept
  'if(is_object($tinkr_v)){' +
  'foreach($tinkr_seen as $tinkr_seen_one){if($tinkr_seen_one===$tinkr_v){return "[recursion]";}}' +
  '$tinkr_seen[]=$tinkr_v;$tinkr_out=[];' +
  // a date and a timezone are the properties php itself exposes for them —
  // date, timezone_type, timezone — plus whatever public fields a subclass
  // added. The cast is that same table; a mangled name is a private or
  // protected field, which is not the value a run answered with
  'if($tinkr_v instanceof \\DateTimeInterface||$tinkr_v instanceof \\DateTimeZone){' +
  'foreach((array)$tinkr_v as $tinkr_k=>$tinkr_item){$tinkr_k=(string)$tinkr_k;' +
  'if($tinkr_k!==""&&$tinkr_k[0]==="\\0"){continue;}' +
  '$tinkr_out[$tinkr_k]=$tinkr_safe($tinkr_item,$tinkr_d+1);}' +
  '$tinkr_out=(object)$tinkr_out;}' +
  // an ArrayObject is its storage written as an object, which is what json
  // wrote for it whatever its keys were: the storage's own values are walked,
  // so an unsafe scalar inside it is described and not turned into a 0
  'elseif($tinkr_v instanceof \\ArrayObject||$tinkr_v instanceof \\ArrayIterator){' +
  'foreach($tinkr_v->getArrayCopy() as $tinkr_k=>$tinkr_item){$tinkr_out[$tinkr_k]=$tinkr_safe($tinkr_item,$tinkr_d+1);}' +
  '$tinkr_out=(object)$tinkr_out;}' +
  // a SplFixedArray is its elements written as a list
  'elseif($tinkr_v instanceof \\SplFixedArray){' +
  'foreach($tinkr_v->toArray() as $tinkr_item){$tinkr_out[]=$tinkr_safe($tinkr_item,$tinkr_d+1);}}' +
  // anything else is the public fields it has, put back together as an object:
  // `(object)[]` is `{}`, and an array of the fields would have read as a list
  'else{' +
  'foreach(get_object_vars($tinkr_v) as $tinkr_k=>$tinkr_item){$tinkr_out[$tinkr_k]=$tinkr_safe($tinkr_item,$tinkr_d+1);}' +
  '$tinkr_out=(object)$tinkr_out;}' +
  'array_pop($tinkr_seen);return $tinkr_out;}' +
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
  // the whole envelope is computed before either marker is printed: a value that
  // prints while it is being written — a serializer's own `echo`, a warning from
  // one — then lands before the marker, where it is the run's output. Printed
  // between the markers instead, it would corrupt the base64 and the run would
  // have no answer at all
  const echo = `$tinkr_payload=base64_encode(json_encode(${keys},JSON_PARTIAL_OUTPUT_ON_ERROR));` +
    'echo $tinkr,"@",$tinkr_payload,"@";'
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
 * which is what running the snippet would have done. Whether a statement is an
 * expression is answered by the tokenizer before it runs (see EVAL_BLOCKS), so a
 * statement that throws while it runs is never run again to find its shape.
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
 * @param {Number} [timeout] the run's timeout in milliseconds, which the php
 * ends itself at when nothing else could stop it (see deadlineOf)
 * @return {{marker: String, start: String, imports: Object, code: String}}
 */
const wrapRun = (source, imports = {}, guard = null, timeout = null) => {
  // a snippet can be written like a file and open with `<?php`, but it is eval'd
  // here, where the opening tag is a parse error, so it is dropped
  const code = source.replace(/^\s*<\?(?:php)?\s*/, '')

  const marker = createMarker()
  const start = createStartMarker()
  const encoded = Buffer.from(code, 'utf8').toString('base64')
  const entries = Object.entries(imports)
  const deadline = deadlineOf(timeout)
  // `sandbox` is a dry run with the side-effect drivers swapped for recorders:
  // the transaction is the same one, so it is a rollback plus the fakes
  const sandbox = guard === 'sandbox'
  const mode = guard === 'commit' ? 'commit' : (guard === 'rollback' || sandbox ? 'rollback' : null)
  const keys = [
    '[',
    // what every statement answered, with the line of the statement that did.
    // Each value was normalized once, where the statement answered it, and is
    // not walked again: a second walk would ask a serializer a second time and
    // would read the map shape the first walk wrote as an ordinary array
    "'blocks'=>$tinkr_results,",
    // a run that ended in an error returned nothing, whatever the statement
    // before the one that threw had left in the variable. The value is the last
    // block's snapshot, kept rather than made again
    "'value'=>$tinkr_error!==null?null:$tinkr_value,",
    "'error'=>$tinkr_error,",
    "'queries'=>$tinkr_safe($tinkr_queries),'queriesTotal'=>$tinkr_query_total",
    // what the run's own names resolved to. It is always an object: a project
    // that resolved nothing answers `{}` rather than dropping the key, so a
    // reader never has to tell "none were imported" from "this run has no such
    // answer"
    ",'imported'=>(object)$tinkr_imported",
    mode ? ",'transaction'=>$tinkr_transaction" : '',
    // what the sandbox caught, when there was one: the counts and the first few
    // of each, so an answer says what the run would have done
    sandbox ? ",'sandbox'=>$tinkr_report" : '',
    ']',
  ].join('')
  // a guarded run that leaves through exit() never reaches its own close, so the
  // close is part of the shutdown path too: it runs only when the transaction is
  // still the one the guard opened, which `$tinkr_transaction` says. A sandboxed
  // run reports what it caught on both paths for the same reason
  const closing = [mode ? guardFinish : '', sandbox ? sandboxFinish : ''].join('')
  const {print, shutdown} = printer(keys, closing)
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
      '$tinkr_error=null;$tinkr_sent=false;$tinkr_imported=[];',
      // from here to the envelope, an interrupt ends the run (see INTERRUPT_ARM)
      INTERRUPT_ARM,
      deadline.arm,
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
      // the side effects are swapped for recorders before anything runs: the
      // mailer, the queues, the http client, the disks, the cache and the log
      sandboxArm(guard),
      ...SPLIT_BLOCKS,
      // the transaction is open before the first statement of the run, and it is
      // closed after the last one, whether that last one returned or threw
      mode ? guardArm(mode) : '',
      ...EVAL_BLOCKS,
      // the close and the sandbox's report, in that order: the transaction is
      // closed first, then what the run caught is counted
      closing,
      print,
      INTERRUPT_RESTORE,
      deadline.clear,
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
/**
 * The tags every line a session is typed carries (see typedRun): the lines that
 * open and continue the run, and the line that closes it. They are php comments,
 * so they cost the run nothing, and they are what the session's echo of the run
 * is told apart by.
 */
const TYPED = '/*tinkr*/'
const TYPED_END = '/*tinkr:end*/'

/**
 * How much of the run one typed line carries.
 *
 * A run is several kilobytes, and typed as one line it is more than libedit —
 * the readline php is built with on Debian, Ubuntu and the official docker
 * images — will read: a 7.7 KB line stops echoing part way and is never
 * evaluated, so the run waits out its whole timeout. A thousand characters is a
 * line every readline reads, and few enough lines that the round trip each one
 * waits on (see Session#type) costs well under a second over ssh.
 */
const typedLineLength = 1000

/**
 * The run, as the lines a session is typed.
 *
 * The wrapped code travels base64-encoded and is evaluated in one statement, so
 * psysh reads the lines as one input: every line but the last leaves the call
 * open, which is psysh's cue to read another line rather than to evaluate. The
 * encoding is what keeps the lines safe to cut anywhere, and keeps the echo free
 * of anything the run itself prints, the markers included.
 *
 * `echo` is there so the statement answers nothing: the wrapper prints its own
 * envelope, and a `= null` after it would be psysh's, not the run's.
 *
 * @param {String} code `run.code` from wrapRun
 * @return {Array<String>} the lines, in order, without their line endings
 */
const typedRun = code => {
  const encoded = Buffer.from(code, 'utf8').toString('base64')
  const lines = []

  for (let at = 0; at < encoded.length; at += typedLineLength) {
    const piece = `${TYPED}'${encoded.slice(at, at + typedLineLength)}'`

    lines.push(at === 0 ? `echo eval(base64_decode(${piece}` : `.${piece}`)
  }

  lines.push(`));${TYPED_END}`)

  return lines
}

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
    // what arrived after the session stopped booting and before the run's own
    // start marker: `dd()` and `exit()` dump to the terminal on their own and
    // abort before the wrapper's marker is flushed, so a run that leaves that
    // way has its dump here and nowhere else
    this.early = ''
    // whether the echo of the typed run has been seen through to its last line,
    // which is where the session stops booting
    this.asked = false
    // whether the session is echoing the typed run back, which every line of it
    // is dropped from the terminal for — a line the readline wrapped as well
    this.typing = false
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
   * What the run wrote of itself, wherever it was written: the wrapper's own
   * echo goes through the marker, and `dd()`/`exit()` write straight to the
   * terminal before it.
   *
   * @return {String}
   */
  printedText() {
    return `${this.early}${this.printed}`
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

      // the session echoes the typed run back, a line at a time (see typedRun);
      // its last line is the point the session stops booting and the snippet
      // starts printing, and none of it is the terminal's to show
      const lines = output.split('\n')
      const kept = []
      let end = -1

      lines.forEach((line, index) => {
        if (line.includes(TYPED_END)) {
          this.typing = false
          this.asked = true
          end = index

          return
        }

        if (line.includes(TYPED)) {
          this.typing = true
        }

        // the last piece is what follows the last line ending, which is always
        // empty: it is kept so the lines rejoin with their endings
        if (!this.typing || index === lines.length - 1) {
          kept.push(line)
        }
      })

      // after the echo and before the marker: what the run wrote without going
      // through the wrapper. `dd()` and `exit()` do exactly that — they dump
      // and abort, so the wrapper's marker is never flushed and this is the
      // only place their output exists. It is taken before the marker is looked
      // for, because the two often share a chunk, and once the run has started
      // what came before its marker would be read as the session booting
      this.keepEarly(end === -1 ? output : lines.slice(end + 1).join('\n'))

      const run = this.runOf(output)

      if (this.started && !this.done) {
        this.printed += run
      }

      // the terminal keeps the session as it is, minus the readline echoing the
      // typed run back
      const terminal = kept
        .join('\n')
        .split(this.start)
        .join('')

      return {output: terminal, run: this.done ? '' : run, result: null}
    }

    const before = this.tail + buffer.slice(0, found)

    this.tail = ''

    this.keepEarly(before)

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
   * Keep what the run wrote around the wrapper, up to the run's start marker.
   *
   * Only text the session wrote after it echoed the typed run back and before
   * the run started is the run's: before that it is the session booting, after
   * it the run's own output is read through the marker.
   *
   * @param {String} text
   */
  keepEarly(text) {
    if (!this.asked || this.started || this.done) {
      return
    }

    const at = text.indexOf(this.start)

    this.early += at === -1 ? text : text.slice(0, at)
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
  typedRun,
  parseResult,
}
