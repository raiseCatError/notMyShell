import {dirname,join} from 'node:path';
import type {Key} from '../terminal/keys.js';
import {renderStudioLayout, renderStudioReview, studioWrap, type StudioReview} from '../ui/StudioLayout.js';
import {Journal, type JournalEntry} from './journal.js';
import {manualSnapshot, planRestore, restore, type RestorePlan} from './restore.js';
export interface ChangesPanel {
  journal:Journal;ownershipPaths:string[];entries:JournalEntry[];statuses:Map<string,string>;
  selected:number;view:'list'|'review'|'confirm'|'result';review?:StudioReview;restore?:RestorePlan;message:string;shown:boolean;
}
export function createChangesPanel(journal:Journal,ownershipPaths:readonly string[]):ChangesPanel {
  const state:ChangesPanel={journal,ownershipPaths:[...new Set([join(dirname(journal.directory),'config.json'),...ownershipPaths])],entries:[],statuses:new Map(),selected:0,view:'list',message:'Automatic entries are pruned at 200 entries / 64 MiB. Reset, restore and manual checkpoints are kept.',shown:false};
  refresh(state);return state;
}
function refresh(state:ChangesPanel):void {
  state.entries=state.journal.list();state.statuses.clear();
  for(const entry of state.entries)for(const file of entry.files){try{state.statuses.set(`${entry.id}:${file.path}`,state.journal.status(file));}catch{state.statuses.set(`${entry.id}:${file.path}`,'unreadable / unsafe path');}}
  state.selected=Math.max(0,Math.min(state.selected,state.entries.length-1));
}
export function changesKey(state:ChangesPanel,key:Key):{close?:true;paths?:string[]}|undefined {
  if(key.kind==='escape'||key.kind==='interrupt')return {close:true};
  try {
    if(state.view==='list'){
      if(key.kind==='up'||key.kind==='down')state.selected=Math.max(0,Math.min(state.entries.length-1,state.selected+(key.kind==='up'?-1:1)));
      if(key.kind==='text'&&key.value.toLowerCase()==='s'){
        const entry=manualSnapshot(state.journal,state.ownershipPaths);refresh(state);state.message=`Snapshot ${entry.id} saved.`;
      }
      if(key.kind==='enter'&&state.entries[state.selected]){
        state.restore=planRestore(state.journal,state.entries[state.selected]!.id);
        state.review={plan:state.restore,offset:0};state.view='review';state.shown=false;
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
    entries:state.entries.length?state.entries.map(item=>({group:item.time.slice(0,10),label:item.label,
      render:width=>{
        const states=item.files.map(file=>state.statuses.get(`${item.id}:${file.path}`));
        const summary=states.includes('edited since')?'edited since':states.includes('missing')?'missing':states.some(value=>value!=='unchanged since')?'unsafe file':'unchanged since';
        return studioWrap(`${item.time.slice(11,16)} ${item.source} · ${summary} · ${item.files.length} files · ${item.label}`,width)[0]!;
      }})):[{group:'History',label:'No backups yet'}],
    selected:state.selected,notice:state.message,details:(width,budget)=>entry?[...studioWrap(`${entry.time} · ${entry.source} · ${entry.label}`,width),
      ...entry.files.flatMap(file=>studioWrap(`${file.path}: ${state.statuses.get(`${entry.id}:${file.path}`)}`,width))].slice(0,budget):[],
    controls:[['↑↓','select'],['Enter','review restore'],['S','snapshot now'],['Esc','close']]},columns,height);
}
