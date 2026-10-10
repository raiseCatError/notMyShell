import {settledText, type AgentEvent} from '../sessions/model.js';
import {AgentSourceStore, type SourceLimits} from './store.js';
import {displayText, type SemanticObject} from './projection.js';

export interface ObjectMetadata extends SemanticObject {sources: number[]}
/** Cheap bounded excerpts for rendering; full eligible sources loaded only on an action. */
export class AgentTranscript {
  readonly objects: ObjectMetadata[] = [];
  private readonly tools = new Map<string, ObjectMetadata>();
  readonly source: AgentSourceStore;
  constructor(limits?: Partial<SourceLimits>) {this.source = new AgentSourceStore(limits);}
  get incomplete(): string | undefined {return this.source.incomplete;}

  append(event: AgentEvent): void {
    if (this.objects.length >= 100000) {this.source.markIncomplete('Semantic object count limit reached'); return;}
    const ref = this.source.append(event);
    if (ref === undefined) return;
    if (event.kind === 'tool') {
      const existing = this.tools.get(event.id);
      if (existing) {existing.sources.push(ref); if (event.detail) existing.detail = displayText(event.detail).slice(0, 400); if (event.status === 'failed') existing.text += ' · failed'; return;}
      const object = {id: `tool-${event.id}`, kind: 'tool', text: displayText(`${event.name}${event.target ? ` ${event.target}` : ''}`).slice(0, 400), sources: [ref],
        ...(event.input ? {detail: displayText(JSON.stringify(event.input)).slice(0, 400)} : {})};
      this.objects.push(object); this.tools.set(event.id, object); return;
    }
    let text: string;
    if (event.kind === 'user' || event.kind === 'assistant') text = event.text;
    else if (event.kind === 'approval') text = `Approval requested: ${event.tool}${event.target ? ` ${event.target}` : ''}`;
    else if (event.kind === 'approvalAnswered') text = event.allowed ? 'You allowed it.' : 'You denied it.';
    else if (event.kind === 'settled') text = settledText(event);
    else if (event.kind === 'exited') text = `Provider ended${event.code === null ? '' : ` (exit ${event.code})`}`;
    else if (event.kind === 'choice') text = event.questions.map(q => q.question).join('\n');
    else if (event.kind === 'choiceAnswered') text = `Your answers: ${Object.values(event.answers).join('; ')}`;
    else if (event.kind === 'incomplete') text = `Incomplete: ${event.reason}`;
    else return;
    this.objects.push({id: `source-${ref}`, kind: event.kind, text: displayText(text).slice(0, 400), sources: [ref]});
  }

  load(index: number): SemanticObject | undefined {
    const metadata = this.objects[index];
    if (!metadata) return undefined;
    const events = metadata.sources.flatMap(id => {const event = this.source.read(id); return event ? [event] : [];});
    const text = events.flatMap(event => event.kind === 'assistant' || event.kind === 'user' ? [event.text] : []).join('\n');
    const detail = events.flatMap(event => {
      if (event.kind === 'tool') return [...(event.input ? [JSON.stringify(event.input, null, 2)] : []), ...(event.detail ? [event.detail] : [])];
      if (event.kind === 'approval' && event.input) return [JSON.stringify(event.input, null, 2)];
      if (event.kind === 'choice') return [JSON.stringify(event.questions, null, 2)];
      if (event.kind === 'choiceAnswered') return [JSON.stringify(event.answers, null, 2)];
      if (event.kind === 'settled' && event.message) return [event.message];
      return [];
    }).join('\n');
    return {id: metadata.id, kind: metadata.kind, text: text || metadata.text, ...(detail ? {detail} : {}), ...(this.incomplete ? {incomplete: this.incomplete} : {})};
  }
  dispose(): void {this.source.dispose(); this.objects.length = 0; this.tools.clear();}
}
