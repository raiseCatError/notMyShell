import {takeSettingsCheckpointFailure} from './settings.js';
import {dirname,join} from 'node:path';
import type {Key} from '../terminal/keys.js';
import {renderStudioLayout, renderStudioReview, studioWrap, type StudioReview} from '../ui/StudioLayout.js';
import {Journal, type JournalEntry, type TransactionReport} from './journal.js';
import {applicationOf, describeEntry, describeState, displayPath, fileAction, localDay, needsReview} from './describe.js';
import {digest, snapshot} from '../appearance/hostFiles.js';
import {manualSnapshot, planRestore, restore, type RestorePlan} from './restore.js';
export interface ChangesPanel {
  journal:Journal;ownershipPaths:string[];entries:JournalEntry[];statuses:Map<string,string>;states:Map<string,TransactionReport>;
  selected:number;view:'list'|'review'|'confirm'|'result';review?:StudioReview;restore?:RestorePlan;message:string;shown:boolean;
}
export function createChangesPanel(journal:Journal,ownershipPaths:readonly string[]):ChangesPanel {
  const state:ChangesPanel={journal,ownershipPaths:[...new Set([join(dirname(journal.directory),'config.json'),...ownershipPaths])],entries:[],statuses:new Map(),states:new Map(),selected:0,view:'list',message:RETENTION,shown:false};
  refresh(state);return state;
}
function refresh(state:ChangesPanel):void {
  state.entries=state.journal.list();state.statuses.clear();state.states.clear();
  const notices:string[]=[];
  // A damaged entry is kept on disk for review and named with its reason; it no longer blocks other backups or writes.
  const damaged=[...state.journal.unreadableReasons];
  if(damaged.length)notices.push(`${damaged.length} unreadable backup ${damaged.length===1?'entry needs':'entries need'} review and ${damaged.length===1?'is':'are'} not listed: ${damaged.slice(0,3).map(([id,reason])=>`${id}: ${reason}`).join('; ')}${damaged.length>3?'; …':''} (kept in ${state.journal.directory}).`);
  try {
    const count=state.journal.prunedCount();if(count)notices.push(`${count} old backup entries pruned.`);
    const lost=[...new Map(state.journal.lostOriginals().map(item=>[item.path,item])).values()];
    if(lost.length)notices.unshift(`Retention warning: to stay within the backup limits, the earliest backup of ${lost.length} file${lost.length===1?' was':'s were'} removed: ${lost.slice(-3).reverse().map(item=>`${displayPath(item.path,state.journal.options.home)} (from ${new Date(item.time).toLocaleString()})`).join('; ')}${lost.length>3?'; …':''}. Press S to keep a snapshot of the current files.`);
  }catch{notices.push('Backup pruning record unreadable.');}
  const failure=takeSettingsCheckpointFailure(state.journal.directory);if(failure)notices.push(failure);
  for(const entry of state.entries){
    for(const file of entry.files){
      const seen=state.journal.inspect(file);
      // "Edited since" only when something other than NMSh changed it: a later NMSh write is named as such.
      const later=seen.status==='edited since'&&laterWrite(state,entry,file.path);
      state.statuses.set(`${entry.id}:${file.path}`,seen.reason?`unsafe: ${seen.reason}`:later?`changed later by NMSh (${later})`:seen.status);
    }
    state.states.set(entry.id,state.journal.transactionState(entry));
  }
  const unfinished=state.entries.filter(entry=>needsReview(state.states.get(entry.id)!.state)).length;
  if(unfinished)notices.unshift(`${unfinished} unfinished ${unfinished===1?'change needs':'changes need'} review (marked !).`);
  if(notices.length)state.message=notices.join(' ');
  state.selected=Math.max(0,Math.min(state.selected,state.entries.length-1));
}
export function changesKey(state:ChangesPanel,key:Key):{close?:true;paths?:string[]}|undefined {
  if(key.kind==='escape'||key.kind==='interrupt')return {close:true};
  try {
    if(state.view==='list'){
      if(key.kind==='up'||key.kind==='down')state.selected=Math.max(0,Math.min(state.entries.length-1,state.selected+(key.kind==='up'?-1:1)));
      if(key.kind==='text'&&key.value.toLowerCase()==='s'){
        const skipped:string[]=[];
        const entry=manualSnapshot(state.journal,state.ownershipPaths,skipped);refresh(state);
        state.message=`Snapshot ${entry.id} saved.${skipped.length?` Skipped (unsafe to read): ${skipped.join('; ')}`:''}`;
      }
      const selected=state.entries[state.selected];
      if(key.kind==='text'&&key.value.toLowerCase()==='d'&&selected&&needsReview(state.states.get(selected.id)!.state)){
        state.journal.dismiss(selected);refresh(state);state.message=`Set ${selected.id} aside as reviewed; your files were not changed.`;
      }
      if(key.kind==='text'&&key.value.toLowerCase()==='f'&&selected){
        // Finalize only records what the files already prove; it writes no configuration.
        state.journal.finalize(selected);refresh(state);state.message=`Marked ${selected.id} as applied: every file holds the bytes it wrote.`;
      }
      if(key.kind==='enter'&&state.entries[state.selected]){
        state.restore=planRestore(state.journal,state.entries[state.selected]!.id);
        state.review={plan:state.restore,offset:0,controls:[['↑↓','scroll diff'],state.restore.edited.length?['Enter','next: confirm overwrite']:['Enter','restore now'],['Esc','cancel']]};state.view='review';state.shown=false;
      }
    }else if(state.view==='review'){
      if(key.kind==='up'||key.kind==='down')state.review!.offset=Math.max(0,state.review!.offset+(key.kind==='up'?-1:1));
      if(key.kind==='enter'&&state.review?.shown){
        if(state.restore!.edited.length){state.view='confirm';state.shown=false;state.review={offset:0,plan:{preview:state.restore!.edited.map(path=>`WARNING: your later edits to ${path} will be lost.`),guidance:'Enter explicitly confirms losing these later edits. Esc cancels.'},controls:[['↑↓','scroll files'],['Enter','overwrite later edits'],['Esc','cancel']]};}
        else return apply(state);
      }
    }else if(state.view==='confirm'){
      if(key.kind==='up'||key.kind==='down')state.review!.offset=Math.max(0,state.review!.offset+(key.kind==='up'?-1:1));
      if(key.kind==='enter'&&state.review?.shown)return apply(state);
    }else {
      if(key.kind==='up'||key.kind==='down')state.review!.offset=Math.max(0,state.review!.offset+(key.kind==='up'?-1:1));
      if(key.kind==='enter'){state.view='list';refresh(state);}
    }
  }catch(error){state.message=`Refused: ${error instanceof Error?error.message:String(error)}`;state.view='result';state.review=resultReview(state.message);}
  return undefined;
}
function apply(state:ChangesPanel):{paths:string[]} {
  const entry=restore(state.journal,state.restore!,{reviewed:true,overwrite:state.view==='confirm'});
  state.message=`Restored. Safety backup ${entry.id}. Undo: /changes → ${entry.id}. Terminal configuration may need a reload.`;
  state.view='result';state.review=resultReview(state.message);return {paths:state.restore!.changes.map(change=>change.before.path)};
}
function resultReview(message:string):StudioReview {
  return {offset:0,plan:{preview:[message],guidance:'Enter returns to history. Esc closes.'},subtitle:'Completed action or refusal',controls:[['↑↓','scroll'],['Enter','history'],['Esc','close']]};
}
export function renderChangesPanel(state:ChangesPanel,columns:number,height:number):string[] {
  if(state.view==='review')return renderStudioReview(state.review!,'Restore · exact current → backup diff',columns,height);
  state.shown=columns>=24&&height>=8;
  const entry=state.entries[state.selected];
  if(state.view==='confirm')return renderStudioReview(state.review!,'Confirm loss of later edits',columns,height);
  if(state.view==='result')return renderStudioReview(state.review!,'Changes · result',columns,height);
  return renderStudioLayout({title:'Changes & backups',subtitle:'Newest first · Enter reviews a restore · S snapshots known managed files',
    entries:state.entries.length?state.entries.map(item=>({group:localDay(item.time),label:item.label,
      render:width=>{
        const states=item.files.map(file=>state.statuses.get(`${item.id}:${file.path}`)?.replace(/ \(.*$/u,''));
        const described=describeEntry(item,configDirectory(state));
        const report=state.states.get(item.id);
        const summary=report&&report.state!=='applied'?`${needsReview(report.state)?'! ':''}${describeState(report.state)}`
          :states.includes('edited since')?'edited since':states.includes('missing')?'missing':states.some(value=>value?.startsWith('unsafe'))?'unsafe file'
          :states.includes('changed later by NMSh')?'changed later by NMSh':'unchanged since';
        return studioWrap(`${described.when} ${described.what} · ${described.action} · ${summary}`,width)[0]!;
      }})):[{group:'History',label:'No backups yet'}],
    selected:state.selected,notice:state.message,details:(width,budget)=>entry?[
      ...studioWrap(`${describeEntry(entry,configDirectory(state)).what} · ${new Date(entry.time).toLocaleString()} · ${entry.id.slice(0,15)}`,width),
      ...studioWrap(`Recorded as: ${entry.source} · ${entry.label}`,width),
      ...stateDetails(state,entry).flatMap(line=>studioWrap(line,width)),
      ...entry.files.flatMap(file=>studioWrap(`${displayPath(file.path,state.journal.options.home)} · ${applicationOf(file.path,configDirectory(state))} · ${fileAction(file)} · ${state.statuses.get(`${entry.id}:${file.path}`)}`,width))].slice(0,budget):[],
    controls:[['↑↓','select'],['Enter','review restore'],['S','snapshot now'],...(entry&&state.states.get(entry.id)?.state==='applied-unfinalized'?[['F','mark applied'] as const]:[]),...(entry&&needsReview(state.states.get(entry.id)?.state??'applied')?[['D','set aside'] as const]:[]),['Esc','close']]},columns,height);
}

function stateDetails(state:ChangesPanel,entry:JournalEntry):string[] {
  const report=state.states.get(entry.id);
  if(!report||report.state==='applied')return [];
  const lines=[`State: ${describeState(report.state)}.`];
  if(entry.resolution?.detail)lines.push(entry.resolution.detail);
  if(report.writer)lines.push(`Writer process ${report.writer} is still running; wait for it before restoring.`);
  if(report.state==='applied-unfinalized')lines.push('F marks it applied (nothing is written to your files). Enter reviews a rollback instead.');
  else if(needsReview(report.state))lines.push('Enter reviews a rollback to the backed-up files; a newer edit needs an explicit second confirmation.');
  if(needsReview(report.state))lines.push('D sets it aside as reviewed: files stay as they are and the entry can later be pruned.');
  lines.push(...report.reasons);
  return lines;
}

const configDirectory=(state:ChangesPanel)=>dirname(state.journal.directory);
/** What history keeps, stated as the pruner implements it (see docs/development/native-appearance-welcome/BACKUPS_AND_RESET.md). */
export const RETENTION='Keeps up to 200 entries / 64 MiB: each file\'s earliest backup, unfinished changes, the newest backup per file and the 20 newest resets, restores and snapshots. Anything else oldest-first; a removed earliest backup is reported here.';
/** When the file now holds exactly what a newer NMSh entry wrote, the local time of that entry. */
function laterWrite(state:ChangesPanel,entry:JournalEntry,path:string):string|undefined {
  let now:string;
  try {const current=snapshot(path,state.journal.options.home);now=current.content===undefined?'absent':digest(current.content);}catch{return undefined;}
  const newer=state.entries.find(other=>other.time>entry.time&&other.files.some(file=>file.path===path&&file.afterHash===now));
  return newer?new Date(newer.time).toLocaleString():undefined;
}
