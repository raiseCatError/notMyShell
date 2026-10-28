import {fragmentPath as cursorFragmentPath, hostConfigPath as cursorHostPath, shaderPath as cursorShaderPath} from '../cursor/native.js';
/** Pure discovery and removal planning; only the wizard's final confirmation calls applyReset. */
import {homedir} from 'node:os';
import {join} from 'node:path';
import {snapshot, digest, unchanged, transact, type FileChange, type FileSnapshot} from '../appearance/hostFiles.js';
import {planHostRemoval} from '../appearance/hostAppearance.js';
import {appearancePaths,type AppearanceContext} from '../appearance/hostPaths.js';
import {planKittyShaderRemoval,kittyShaderPaths} from '../appearance/kittyShaders.js';
import {planGhosttyShaderRemoval,ghosttyShaderPaths} from '../appearance/ghosttyShaders.js';
import {planClaudeBridgeRemoval} from '../agents/claudeStatusLine.js';
import {artifactPath, ledgerPath, loadLedger, ownership, planHookRemoval, type ManagedTarget, type HookTarget} from '../themeBridge/artifacts.js';
import {nmshConfigDirectory} from '../configuration/paths.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../prompt/configuration.js';
import {Journal, type JournalEntry} from './journal.js';
import {changeDiff} from './diff.js';
import type {FileEditPlan} from '../ask/fileEdit.js';

export interface ResetArea {id: string; label: string; status: 'set up' | 'not set up' | 'nothing to reset'; changes: FileChange[]; dependencies: FileSnapshot[]; reason?: string}
export interface ResetPlan {areas: ResetArea[]; changes: FileChange[]; dependencies: FileSnapshot[]; preview: string[]; steps: Array<{area: ResetArea; changes: FileChange[]}>}
const homeOf = (context: AppearanceContext) => context.env.HOME || homedir();
function editChange(plan: FileEditPlan, home: string): FileChange {
  const before = snapshot(plan.path,home,true);
  if ((before.content === undefined ? 'absent' : digest(before.content)) !== plan.expectedSha256) throw new Error('Configuration changed while planning.');
  let after = before.content ?? '';
  for (const edit of [...plan.edits].sort((a,b)=>b.start-a.start)) after = after.slice(0,edit.start)+edit.text+after.slice(edit.end);
  if (digest(after) !== plan.resultSha256) throw new Error('Removal did not match the reviewed result.');
  return {before,after};
}
function area(id: string,label: string,build:()=>{changes: readonly FileChange[]; dependencies?: readonly FileSnapshot[]}): ResetArea {
  try {const plan=build();const changes=plan.changes.filter(change=>change.after!==change.before.content);
    return {id,label,status:changes.length?'set up':'nothing to reset',changes,dependencies:[...(plan.dependencies??[])]};
  } catch(error) {return {id,label,status:'not set up',changes:[],dependencies:[],reason:error instanceof Error?error.message:String(error)};}
}
/** A legacy adapter without a ledger can be reset only with an applied journal record and an exact after hash. */
function fromJournal(journal: Journal, source: string, accept: (path: string)=>boolean): FileChange[] {
  const entries=journal.list().filter(entry=>entry.source===source && entry.outcome==='applied');
  const current=new Map<string,FileSnapshot>();const reverted=new Map<string,string|undefined>();
  for(const entry of entries)entry.files.forEach((file,index)=>{
    if(!accept(file.path))return;
    if(!journal.provenanceComplete(source,file.path))throw new Error(`${file.path}: older automatic backups were pruned; ownership-only reset is skipped. Use /changes to review an available snapshot.`);
    const before=current.get(file.path)??snapshot(file.path,journal.options.home,true);current.set(file.path,before);
    const text=reverted.has(file.path)?reverted.get(file.path):before.content;
    const original=journal.content(entry,index),written=journal.writtenContent(entry,index);
    reverted.set(file.path,reverseOwnedEdit(original,written,text,file.path));
  });
  if(!current.size)throw new Error('No NMSh ownership record or applied backup exists; nothing is reset.');
  return [...current].map(([path,before])=>({before,after:reverted.get(path)}));
}
/** Reverse one contiguous changed line block, retaining user edits elsewhere, including edits between NMSh saves. */
function reverseOwnedEdit(original:string|undefined,written:string|undefined,current:string|undefined,path:string):string|undefined {
  if(original===written)return current;
  if(current===written)return original;
  const lines=(value:string|undefined)=>value?.match(/[^\n]*\n|[^\n]+$/gu)??[];
  const old=lines(original),after=lines(written);
  let start=0;while(start<old.length&&start<after.length&&old[start]===after[start])start++;
  let tail=0;while(tail<old.length-start&&tail<after.length-start&&old[old.length-1-tail]===after[after.length-1-tail])tail++;
  const added=after.slice(start,after.length-tail).join(''),removed=old.slice(start,old.length-tail).join('');
  const text=current??'';
  if(added){
    const at=text.indexOf(added);
    if(at<0||text.indexOf(added,at+1)!==-1)throw new Error(`${path} was edited outside NMSh or its owned lines are ambiguous; kept. Use /changes for an explicit restore.`);
    return text.slice(0,at)+removed+text.slice(at+added.length);
  }
  // A removal has no new block to match: require its adjacent context before reinserting previous content.
  const left=after[start-1]??'',right=after[start]??'';const anchor=left+right;
  if(!anchor)throw new Error(`${path} was edited outside NMSh; kept.`);
  const at=text.indexOf(anchor);
  if(at<0||text.indexOf(anchor,at+1)!==-1)throw new Error(`${path} no longer has unambiguous owned context; kept.`);
  return text.slice(0,at+left.length)+removed+text.slice(at+left.length);
}
function bridgeChanges(context: AppearanceContext, targets: ManagedTarget[]): FileChange[] {
  const home=homeOf(context),env=context.env,ledger=loadLedger(env);const changes:FileChange[]=[];
  const before=snapshot(ledgerPath(env),home,true);
  for(const target of targets){
    const entry=ledger.entries[target];if(!entry)continue;
    const state=ownership(target,ledger,env);
    if(state==='unknown'||state==='modified')throw new Error(`${artifactPath(target,env)} is unowned or edited; kept.`);
    if(entry.hook && ['tmuxConfig','neovim','vim','helix'].includes(target)){
      const hook=planHookRemoval((target==='tmuxConfig'?'tmux':target) as HookTarget,home,env);
      if('error' in hook)throw new Error(hook.error);
      if('plan' in hook)changes.push(editChange(hook.plan,home));
    }
    if(state==='owned')changes.push({before:snapshot(artifactPath(target,env),home,true)});
    delete ledger.entries[target];
  }
  if(changes.length)changes.push({before,after:`${JSON.stringify(ledger,null,2)}\n`});
  return changes;
}
export function discoverResetAreas(context: AppearanceContext,journal: Journal): ResetArea[] {
  const home=homeOf(context),env=context.env;
  const hostArea=(host:'kitty'|'ghostty')=>area(`${host}-appearance`,`${host==='kitty'?'Kitty':'Ghostty'} appearance`,()=>{
    const result=planHostRemoval(host,context);if(!result.ok)throw new Error(result.error);return result.plan;
  });
  const shaders=(host:'kitty'|'ghostty')=>area(`${host}-shaders`,`${host==='kitty'?'Kitty':'Ghostty'} shaders`,()=>{
    const result=host==='kitty'?planKittyShaderRemoval(context):planGhosttyShaderRemoval(context);
    if(!result.ok)throw new Error(result.error);return result.plan;
  });
  const cursor=(host:'kitty'|'ghostty')=>area(`${host}-cursor`,`${host==='kitty'?'Kitty':'Ghostty'} cursor include`,()=>{
    const paths=new Set([cursorFragmentPath(host,env),cursorHostPath(host,env,context.platform,home),...(host==='ghostty'?[cursorShaderPath(env)]:[])]);
    return {changes:fromJournal(journal,'cursor',path=>paths.has(path))};
  });
  return [hostArea('kitty'),shaders('kitty'),cursor('kitty'),hostArea('ghostty'),shaders('ghostty'),cursor('ghostty'),
    area('keyboard','Ghostty keyboard',()=>({changes:fromJournal(journal,'keyboard',()=>true)})),
    area('tmux','tmux managed block',()=>({changes:bridgeChanges(context,['tmuxConfig','tmux'])})),
    area('starship','Starship modules NMSh set',()=>({changes:fromJournal(journal,'starship',()=>true)})),
    area('theme-bridge','Theme Bridge artifacts',()=>({changes:bridgeChanges(context,['neovim','vim','helix','bat','vivid'])})),
    area('statusline','Claude status line hook',()=>{
      const result=planClaudeBridgeRemoval(env);if('refuse' in result)throw new Error(result.refuse);if('noop' in result)return {changes:[]};
      return {changes:[editChange(result.plan,home),{before:snapshot(join(nmshConfigDirectory(env),'agent-context/claude-status-line.json'),home,true)}]};
    }),
    area('settings','NMSh settings (config.json) → defaults',()=>({changes:[{before:snapshot(join(nmshConfigDirectory(env),'config.json'),home,true),after:`${JSON.stringify(DEFAULT_PROMPT_CONFIGURATION,null,2)}\n`}]})),
  ];
}
interface Splice {start:number;end:number;text:string}
function splice(before:string,after:string):Splice {
  // Whole-line boundaries keep adjacent includes disjoint even when their text shares a long prefix.
  const lines=(text:string)=>text.match(/[^\n]*\n|[^\n]+$/gu)??[];
  const old=lines(before),next=lines(after);let head=0,tail=0;
  while(head<old.length&&head<next.length&&old[head]===next[head])head++;
  while(tail<old.length-head&&tail<next.length-head&&old[old.length-1-tail]===next[next.length-1-tail])tail++;
  return {start:old.slice(0,head).join('').length,end:before.length-old.slice(old.length-tail).join('').length,text:next.slice(head,next.length-tail).join('')};
}
/** Merge disjoint edits against the same captured file, so two areas can remove two includes safely. */
export function planReset(areas: ResetArea[], selected: ReadonlySet<string>, context: AppearanceContext): ResetPlan {
  const chosen=areas.filter(item=>selected.has(item.id));const byPath=new Map<string,{before:FileSnapshot;patches:Splice[];mode?:number}>();
  const steps:ResetPlan['steps']=[];const preview:string[]=[];const virtual=new Map<string,string|undefined>();
  for(const item of chosen){
    if(item.reason||!item.changes.length){preview.push(`${item.label}: skipped: ${item.reason??'nothing to reset'}`);continue;}
    // Reject an entire area if any of its changes overlaps an earlier area. Never silently broaden the reset.
    const additions=item.changes.map(change=>({change,patch:splice(change.before.content??'',change.after??'')}));
    const conflict=additions.find(({change,patch})=>byPath.get(change.before.path)?.patches.some(old=>(patch.start===old.start&&(patch.end===patch.start||old.end===old.start))||!(patch.end<=old.start||patch.start>=old.end)));
    if(conflict){item.reason=`Overlapping removal in ${conflict.change.before.path}; reset this area separately.`;preview.push(`${item.label}: skipped: ${item.reason}`);continue;}
    const stepChanges:FileChange[]=[];
    for(const {change,patch} of additions){
      const prior=byPath.get(change.before.path);const patches=[...(prior?.patches??[]),patch].sort((a,b)=>b.start-a.start);
      let text=change.before.content??'';for(const part of patches)text=text.slice(0,part.start)+part.text+text.slice(part.end);
      const after=change.after===undefined&&text===''?undefined:text;
      const before={...change.before,content:virtual.has(change.before.path)?virtual.get(change.before.path):change.before.content};
      stepChanges.push({before,after,afterMode:change.afterMode});virtual.set(change.before.path,after);
      byPath.set(change.before.path,{before:prior?.before??change.before,patches,mode:change.afterMode});
    }
    steps.push({area:item,changes:stepChanges});preview.push(item.label,...stepChanges.flatMap(change=>changeDiff(change).lines));
  }
  const changes=[...byPath].map(([path,value])=>({before:value.before,after:virtual.get(path),afterMode:value.mode}));
  const config=join(nmshConfigDirectory(context.env),'config.json');
  // config.json is always part of the safety checkpoint, even when settings were not selected.
  if(!byPath.has(config)){const before=snapshot(config,homeOf(context));changes.push({before,after:before.content,afterMode:before.mode});}
  return {areas:chosen,changes,dependencies:chosen.flatMap(item=>item.dependencies),preview,steps};
}
export function applyReset(plan:ResetPlan,journal:Journal):{entry:JournalEntry;results:string[];paths:string[]} {
  for(const file of [...plan.dependencies,...plan.changes.map(change=>change.before)])unchanged(file,journal.options.home,true);
  const entry=journal.record(plan.changes,'reset',`Reset ${plan.steps.map(step=>step.area.label).join(', ')}`);
  for(const file of [...plan.dependencies,...plan.changes.map(change=>change.before)])unchanged(file,journal.options.home,true);
  const results=plan.areas.filter(area=>area.reason||!area.changes.length).map(area=>`${area.label}: skipped: ${area.reason??'nothing to reset'}`);
  const paths:string[]=[];
  for(const [stepIndex,step] of plan.steps.entries()){
    try {
      const changes=step.changes.map(change=>{
        const current=snapshot(change.before.path,journal.options.home,true);
        if(current.content!==change.before.content)throw new Error('Configuration changed during reset; remaining areas were kept.');
        return {...change,before:current};
      });
      transact(changes,[],journal.options.home,{source:'reset',label:step.area.label,directory:journal.directory});
      results.push(`${step.area.label}: done`);paths.push(...changes.map(change=>change.before.path));
    }catch(error){results.push(`${step.area.label}: failed: ${error instanceof Error?error.message:String(error)}`);results.push(...plan.steps.slice(stepIndex+1).map(next=>`${next.area.label}: skipped: an earlier area failed`));break;}
  }
  // A partially applied reset remains a prepared checkpoint, and is still restorable.
  try {journal.complete(entry);}catch{/* per-area results remain authoritative */}
  return {entry,results,paths:[...new Set(paths)]};
}
export function ownedSnapshotPaths(context:AppearanceContext,journal:Journal):string[] {
  const areas=discoverResetAreas(context,journal),home=homeOf(context),env=context.env;
  const paths=new Set([join(nmshConfigDirectory(env),'config.json'),ledgerPath(env),
    ...areas.flatMap(area=>[...area.changes.map(change=>change.before.path),...area.dependencies.map(file=>file.path)])]);
  // Read-only capture includes damaged legacy managed files too; a refused removal must not hide them from a manual backup.
  for(const host of ['kitty','ghostty'] as const){
    const appearance=appearancePaths(host,context);const shaders=host==='kitty'?kittyShaderPaths(context):ghosttyShaderPaths(context);
    for(const path of [appearance.fragment,appearance.ledger,shaders.fragment,shaders.ledger,cursorFragmentPath(host,env)]){
      const file=snapshot(path,home);if(file.content!==undefined)paths.add(path);
    }
    for(const recordPath of [appearance.ledger,shaders.ledger]){
      const file=snapshot(recordPath,home);if(file.content===undefined)continue;
      let record:{hostPath?:unknown;passes?:Array<{path?:unknown}>};try{record=JSON.parse(file.content);}catch{continue;}
      if(typeof record.hostPath==='string'&&appearance.candidates.includes(record.hostPath))paths.add(record.hostPath);
      for(const pass of Array.isArray(record.passes)?record.passes:[])if(typeof pass.path==='string'){
        // The checked snapshot refuses paths outside HOME and symbolic links; ledger data is never executed.
        snapshot(pass.path,home);paths.add(pass.path);
      }
    }
  }
  for(const path of [cursorShaderPath(env),kittyShaderPaths(context).pipeline,join(nmshConfigDirectory(env),'agent-context/claude-status-line.json')]){
    if(snapshot(path,home).content!==undefined)paths.add(path);
  }
  for(const entry of Object.values(loadLedger(env).entries))if(entry){paths.add(entry.artifactPath);if(entry.hook){snapshot(entry.hook.configPath,home);paths.add(entry.hook.configPath);}}
  return [...paths];
}
