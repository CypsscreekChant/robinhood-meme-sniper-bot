import type {Config} from './config.js';
import type {State} from './state.js';
import {clean, eventText, redact, renderDashboard, type View} from './ui/terminal.js';
let view: View | undefined;
let stateReader: (()=>State) | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let fullScreen=false;
let lastHeartbeat=0;
const pretty=()=>process.env.LOG_FORMAT==='pretty'||(process.env.LOG_FORMAT!=='json'&&!!process.stdout.isTTY&&process.env.TERM!=='dumb');
const json=(event:string,details:Record<string,unknown>)=>console.log(JSON.stringify({time:new Date().toISOString(),event,...redact(details) as object}));
export function startConsole(config:Config) {
  view={config,phase:'connecting',started:Date.now(),now:Date.now(),events:[],counters:{pairs:0,rejected:0,buys:0,sells:0,errors:0}};
  fullScreen=pretty()&&!!process.stdout.isTTY&&process.env.TERM!=='dumb';
  if(fullScreen)process.stdout.write('\x1b[?1049h\x1b[?25l');
  lastHeartbeat=Date.now();
  timer=setInterval(()=>{
    if(!view)return;
    view.now=Date.now();view.state=stateReader?.();
    if(fullScreen)draw();
    else if(Date.now()-lastHeartbeat>=30000&&stateReader){
      lastHeartbeat=Date.now();
      log('heartbeat',{phase:view.phase,scannedBlock:view.cursor,confirmedTarget:view.head,lastScanAt:view.scannedAt?new Date(view.scannedAt).toISOString():null,candidates:view.state?.candidates.length,positions:view.state?.positions.length});
    }
  },1000);timer.unref();draw();
}
function draw(){if(fullScreen&&view)process.stdout.write('\x1b[H\x1b[J'+renderDashboard(view,process.stdout.columns||100,process.stdout.rows||40,process.env.NO_COLOR===undefined));}
export function attachConsoleState(read:()=>State){stateReader=read;if(view)view.state=read();}
export function consolePhase(phase:string){if(view){view.phase=phase;draw();}}
export function scanProgress(cursor:number,head:number){if(view){view.cursor=cursor;view.head=head;view.scannedAt=Date.now();draw();}}
export function stopConsole(){
  if(timer)clearInterval(timer);
  if(fullScreen){process.stdout.write('\x1b[?25h\x1b[?1049l');fullScreen=false;
    // Preserve the final events in scrollback after leaving the live screen.
    for(const record of view?.events.slice(-6)||[])console.log(clean(eventText(record)));
    console.log('ROBINHOOD MEME SNIPER · STOPPED');
  }
  view=undefined;stateReader=undefined;timer=undefined;
}
export function log(event:string,details:Record<string,unknown>={}){
  const record={time:new Date().toISOString(),event,details:redact(details) as Record<string,unknown>};
  if(view){
    view.events.push(record);if(view.events.length>50)view.events.shift();
    if(event==='new_pair')view.counters.pairs++;
    if(event==='candidate_rejected')view.counters.rejected++;
    if(event==='buy')view.counters.buys++;
    if(event==='sell')view.counters.sells++;
    if(/fail|fatal|halt/.test(event))view.counters.errors++;
  }
  if(fullScreen){draw();return;}
  if(pretty())console.log(clean(eventText(record)));
  else json(event,details);
}
// Never emit raw RPC errors: they may contain credentials or signed transactions.
export function errorCode(error:unknown):string {
  const code=(error as {code?:unknown})?.code;
  return typeof code==='string'&&/^[A-Z_0-9]+$/.test(code)?code:'OPERATION_FAILED';
}
