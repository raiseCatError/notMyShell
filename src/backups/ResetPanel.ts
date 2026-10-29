import type {Key} from '../terminal/keys.js';
import {renderStudioLayout,renderStudioReview,studioWrap,type StudioReview} from '../ui/StudioLayout.js';
import type {AppearanceContext} from '../appearance/hostPaths.js';
import {Journal} from './journal.js';
import {applyReset,discoverResetAreas,planReset,type ResetArea,type ResetPlan} from './reset.js';
import {checkMark} from '../ui/glyphs.js';
import {renderTextValue} from '../ui/formControls.js';
export interface ResetPanel {
  context:AppearanceContext;journal:Journal;areas:ResetArea[];selected:Set<string>;index:number;
  step:'choose'|'impact'|'backup'|'confirm'|'result';review?:StudioReview;plan?:ResetPlan;typed:string;shown:boolean;message:string;results:string[];
}
export function createResetPanel(context:AppearanceContext,journal:Journal):ResetPanel {
  return {context,journal,areas:discoverResetAreas(context,journal),selected:new Set(),index:0,step:'choose',typed:'',shown:false,message:'Nothing selected. NMSh settings are separate. Your own configuration is kept.',results:[]};
}
export function resetKey(state:ResetPanel,key:Key):{close?:true;paths?:string[]}|undefined {
  if(key.kind==='escape'||key.kind==='interrupt')return {close:true};
  try {
    if(state.step==='choose'){
      if(key.kind==='up'||key.kind==='down')state.index=Math.max(0,Math.min(state.areas.length-1,state.index+(key.kind==='up'?-1:1)));
      if(key.kind==='text'&&key.value===' '){const id=state.areas[state.index]!.id;if(state.selected.has(id))state.selected.delete(id);else state.selected.add(id);}
      if(key.kind==='enter'&&state.selected.size){
        state.plan=planReset(state.areas,state.selected,state.context);state.review={offset:0,plan:{preview:state.plan.preview,guidance:'Only recorded NMSh changes are reset. User lines are kept. Enter advances to Backup; nothing is written.'},controls:[['↑↓','scroll'],['Enter','next: backup'],['Esc','cancel']]};
        state.step='impact';state.shown=false;
      }
    }else if(state.step==='impact'){
      if(key.kind==='up'||key.kind==='down')state.review!.offset=Math.max(0,state.review!.offset+(key.kind==='up'?-1:1));
      if(key.kind==='enter'&&state.review?.shown){state.step='backup';state.shown=false;state.review={offset:0,plan:{preview:[`Backup directory: ${state.journal.directory}`, 'Includes files changed by the reset and their ownership records.',
        ...state.plan!.changes.map(change=>change.before.path)],guidance:'Backup must be written, read back and hash verified before any reset. Enter advances to final typed confirmation; nothing is written yet.'},controls:[['↑↓','scroll'],['Enter','next: type reset'],['Esc','cancel']]};}
    }else if(state.step==='backup'){
      if(key.kind==='up'||key.kind==='down')state.review!.offset=Math.max(0,state.review!.offset+(key.kind==='up'?-1:1));
      if(key.kind==='enter'&&state.review?.shown){state.step='confirm';state.shown=false;state.message='Review complete. Type reset exactly, then Enter; Esc cancels.';}
    }else if(state.step==='confirm'){
      if(key.kind==='backspace')state.typed=state.typed.slice(0,-1);
      else if(key.kind==='text'&&/^[a-zA-Z]+$/u.test(key.value)&&state.typed.length+key.value.length<=32)state.typed+=key.value;
      else if(key.kind==='enter'){
        if(state.typed==='reset'&&state.shown){
          const result=applyReset(state.plan!,state.journal);state.results=result.results;
          state.message=result.entry?`Backup ${result.entry.id}. Undo: /changes → ${result.entry.id}. Terminal configuration may need a reload.`:'Nothing to reset';state.step='result';state.review=resultReview(state);
          return {paths:result.paths};
        }
        state.message='Cancelled: the word did not match reset exactly. Nothing was written.';
        state.step='result';state.results=[state.message];state.review=resultReview(state);return {close:true};
      }else return {close:true};
    }else {
      if(key.kind==='up'||key.kind==='down')state.review!.offset=Math.max(0,state.review!.offset+(key.kind==='up'?-1:1));
      if(key.kind==='enter')return {close:true};
    }
  }catch(error){state.step='result';state.results=[`Failed: ${error instanceof Error?error.message:String(error)}`];state.message=`Nothing further was reset. ${state.results[0]}`;state.review=resultReview(state);}
  return undefined;
}
function resultReview(state:ResetPanel):StudioReview {
  return {offset:0,plan:{preview:[...state.results,state.message],guidance:'Undo: /changes → select the reset backup. Terminal configuration may need a reload.'},
    subtitle:'Per-area results · current state was backed up first',controls:[['↑↓','scroll'],['Enter','close'],['Esc','close']]};
}
export function renderResetPanel(state:ResetPanel,columns:number,height:number):string[] {
  if(state.step==='impact'||state.step==='backup')return renderStudioReview(state.review!,state.step==='impact'?'Step 2 · Impact':'Step 3 · Verified backup',columns,height);
  state.shown=columns>=24&&height>=8;
  if(state.step==='confirm')return renderStudioLayout({title:'Step 4 · Confirm reset',selected:0,
    entries:[{group:'Final confirmation',label:'Type reset',render:()=>`Type reset  ${renderTextValue(state.typed,'reset',{focused:true,color:!process.env.NO_COLOR})}`}],
    notice:state.message,details:width=>studioWrap(`Reset only the selected NMSh-owned areas. ${state.plan!.steps.length} areas; ${state.plan!.changes.length} backup files. Type reset exactly, then Enter. Esc cancels.`,width),
    controls:[['Enter','reset if word matches'],['Esc','cancel']]},columns,height);
  if(state.step==='result')return renderStudioReview(state.review!,'Reset · results',columns,height);
  return renderStudioLayout({title:'Step 1 · Choose reset areas',subtitle:'Space toggles · nothing is selected by default',selected:state.index,
    entries:state.areas.map(item=>({group:item.settingsScope?'NMSh settings':'Owned integrations',label:item.label,
      render:()=>`${checkMark(state.selected.has(item.id))} ${item.label} · ${item.status}`})),
    notice:state.message,details:(width,budget)=>{const item=state.areas[state.index];
      return (item?.reason?[item.reason]:item?.summary??['Only NMSh-owned changes are offered; unrelated user lines are kept.']).flatMap(line=>studioWrap(line,width)).slice(0,budget);},
    controls:[['↑↓','select'],['Space','toggle'],['Enter','impact'],['Esc','cancel']]},columns,height);
}
