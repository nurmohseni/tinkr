/**
 * The php that keeps a run's side effects out of the world.
 *
 * A transaction holds the database. It holds nothing else: `Mail::send`,
 * `dispatch`, `Http::post`, `Storage::put`, `Cache::put` and `Log::info` all
 * happen while the transaction is open and all of them are still there when it
 * is taken back. A dry run that says "rolled back" and sends a customer an email
 * is not a dry run, so a sandboxed one swaps those drivers for recorders first.
 *
 * Each swap is the framework's own test double rather than a pretend one:
 *
 * - mail goes to the `array` transport, so every message is recorded by the
 *   `MessageSent` event and none leaves. The mailer's cached instances are
 *   forgotten, because one already resolved would keep its old transport.
 * - jobs and the bus go to their fakes: a pushed job runs nowhere and the fake
 *   keeps it.
 * - the HTTP client answers through a stub set and refuses anything it was not
 *   given, so a run cannot reach a real API by accident.
 * - every disk is faked onto `storage/framework/testing/disks`, so a write lands
 *   in a directory the run owns and a read of the project still works.
 * - the cache becomes an array store, and logging goes to a handler that keeps
 *   its records instead of writing the project's log file.
 * - notifications are faked.
 *
 * What was caught is counted on the way out (see `finish`) rather than described
 * here: this runs in the session, and the envelope has to stay small. A channel
 * that could not be swapped is named in the report instead of being left to look
 * sandboxed — a project that is not a booted Laravel application, a framework
 * without one of the fakes.
 *
 * The swaps are made once, before the first statement, and they last as long as
 * the session does. A session belongs to one run (see session.runCode), so
 * nothing of a sandbox outlives the run it was made for.
 *
 * It is written over several lines for reading, and it is one line by the time
 * it is sent: every block of the wrapper has to be, because the wrapped command
 * is a single line of php.
 */

/**
 * The php that arms the sandbox: every driver swapped for a recorder.
 *
 * Each facade's `fake()` returns the instance it bound, and that instance is
 * what `finish` counts: the notification fake is bound under the manager's own
 * key, so looking it up by its class answers with a fresh, empty one, and the
 * bus fake keeps what it intercepted in properties it has no getter for.
 *
 * The HTTP guard arms `preventStrayRequests()` and then a `fake()` whose
 * callback answers nothing. `fake()` with no callback installs a catch-all that
 * answers every request with an empty `200`, which is the lie the guard exists
 * to prevent: that stub always matches, so the stray branch is never reached. A
 * callback returning null matches nothing, the stray branch is reached, and
 * every attempt is still recorded.
 *
 * @type {String}
 */
const arm = String.raw`
$tinkr_effects=[];$tinkr_sandbox=[];
if(!function_exists('app')||!app()->bound('config')){
  $tinkr_sandbox[]='this session is not a booted Laravel application, so nothing could be sandboxed';
}
try{
  $tinkr_seen=[];
  app('events')->listen('Illuminate\Mail\Events\MessageSent',function($tinkr_mail)use(&$tinkr_seen){
    $tinkr_seen[]=['subject'=>(string)$tinkr_mail->message->getSubject(),'to'=>array_map(function($tinkr_address){return $tinkr_address->getAddress();},$tinkr_mail->message->getTo())];
  });
  app('config')->set('mail.default','array');
  if(method_exists(app('mail.manager'),'forgetMailers')){app('mail.manager')->forgetMailers();}
  $tinkr_effects['mail']=&$tinkr_seen;
}catch(\Throwable $tinkr_sandbox_failure){$tinkr_sandbox[]='mail could not be sandboxed: '.$tinkr_sandbox_failure->getMessage();}
try{
  $tinkr_effects['queue']=Illuminate\Support\Facades\Queue::fake();
}catch(\Throwable $tinkr_sandbox_failure){$tinkr_sandbox[]='the queue could not be sandboxed: '.$tinkr_sandbox_failure->getMessage();}
try{
  $tinkr_effects['bus']=Illuminate\Support\Facades\Bus::fake();
}catch(\Throwable $tinkr_sandbox_failure){$tinkr_sandbox[]='the bus could not be sandboxed: '.$tinkr_sandbox_failure->getMessage();}
try{
  Illuminate\Support\Facades\Http::preventStrayRequests();
  Illuminate\Support\Facades\Http::fake(function(){return null;});
  $tinkr_effects['requests']=true;
}catch(\Throwable $tinkr_sandbox_failure){$tinkr_sandbox[]='http could not be sandboxed: '.$tinkr_sandbox_failure->getMessage();}
try{
  foreach(array_keys((array)app('config')->get('filesystems.disks',[])) as $tinkr_disk){Illuminate\Support\Facades\Storage::fake($tinkr_disk);}
  $tinkr_effects['files']=true;
}catch(\Throwable $tinkr_sandbox_failure){$tinkr_sandbox[]='the filesystem could not be sandboxed: '.$tinkr_sandbox_failure->getMessage();}
try{
  app('config')->set('cache.default','array');
  app('config')->set('logging.channels.tinkr_sandbox',['driver'=>'monolog','handler'=>'Monolog\Handler\TestHandler','level'=>'debug']);
  app('config')->set('logging.default','tinkr_sandbox');
  app()->forgetInstance('log');
  $tinkr_effects['log']=true;
}catch(\Throwable $tinkr_sandbox_failure){$tinkr_sandbox[]='the log could not be sandboxed: '.$tinkr_sandbox_failure->getMessage();}
try{
  $tinkr_effects['notifications']=Illuminate\Support\Facades\Notification::fake();
}catch(\Throwable $tinkr_sandbox_failure){$tinkr_sandbox[]='notifications could not be sandboxed: '.$tinkr_sandbox_failure->getMessage();}
`

/**
 * The php that reports what the sandbox caught.
 *
 * The fakes keep their own records, so the counts are read at the end: mail from
 * the listener that recorded each message, requests from the client's own log,
 * jobs from the queue fake plus the bus fake, notifications from the instance
 * the facade returned. The first twenty of the messages and requests are named,
 * which is what an answer needs to say what the run would have done; the rest
 * are a count.
 *
 * A job goes through one of two fakes. `Queue::push` is kept by the queue fake,
 * and `dispatch()` — through the bus facade, or the `dispatch` helper with a
 * `ShouldQueue` job — is kept by the bus fake in `commands`,
 * `commandsSync` and `commandsAfterResponse`, which have no getter for their
 * total. Both are read, so a channel that intercepted something says so.
 *
 * Each channel is guarded on its own, because a report that throws must not take
 * the run's answer with it.
 *
 * @type {String}
 */
const finish = String.raw`
$tinkr_report=['channels'=>[],'not_sandboxed'=>array_values($tinkr_sandbox)];
try{
  if(isset($tinkr_effects['mail'])){
    $tinkr_report['channels']['mail']=count($tinkr_effects['mail']);
    $tinkr_report['sent']=[];
    foreach(array_slice($tinkr_effects['mail'],0,20) as $tinkr_mail){
      $tinkr_report['sent'][]=$tinkr_mail['subject'].' to '.implode(',',$tinkr_mail['to']);
    }
  }
}catch(\Throwable $tinkr_report_failure){}
try{
  if(isset($tinkr_effects['requests'])){
    $tinkr_pairs=Illuminate\Support\Facades\Http::recorded();
    $tinkr_report['channels']['requests']=$tinkr_pairs->count();
    $tinkr_report['requested']=[];
    foreach($tinkr_pairs->take(20) as $tinkr_pair){
      $tinkr_report['requested'][]=$tinkr_pair[0]->method().' '.$tinkr_pair[0]->url();
    }
  }
}catch(\Throwable $tinkr_report_failure){}
try{
  if(isset($tinkr_effects['queue'])||isset($tinkr_effects['bus'])){
    $tinkr_jobs=0;
    if(isset($tinkr_effects['queue'])){$tinkr_jobs+=count($tinkr_effects['queue']->pushedJobs());}
    if(isset($tinkr_effects['bus'])){
      foreach(['commands','commandsSync','commandsAfterResponse'] as $tinkr_property){
        try{
          $tinkr_read=(function($tinkr_name){
            if(!property_exists($this,$tinkr_name)){return [];}
            return (array)$this->$tinkr_name;
          })->call($tinkr_effects['bus'],$tinkr_property);
          $tinkr_jobs+=array_sum(array_map('count',$tinkr_read));
        }catch(\Throwable $tinkr_property_failure){}
      }
    }
    $tinkr_report['channels']['jobs']=$tinkr_jobs;
  }
}catch(\Throwable $tinkr_report_failure){}
try{
  if(isset($tinkr_effects['notifications'])){
    $tinkr_report['channels']['notifications']=count($tinkr_effects['notifications']->sentNotifications());
  }
}catch(\Throwable $tinkr_report_failure){}
`

/**
 * One block of the wrapper, as the wrapper needs it: a single line.
 *
 * @param {String} source
 * @return {String}
 */
const oneLine = source => source.split('\n').map(line => line.trim()).filter(Boolean).join('')

module.exports = {
  arm: oneLine(arm),
  finish: oneLine(finish),
}
