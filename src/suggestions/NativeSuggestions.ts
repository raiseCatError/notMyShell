import {isPrivateCommand, type CommandEntry, type Suggestion, type SuggestionContext, type SuggestionProvider} from './types.js';

/** NMSh Native suggestions: local history only, nothing leaves the machine. */
export class NativeSuggestions implements SuggestionProvider {
  readonly id = 'nmsh' as const;
  private readonly session: string[] = [];

  constructor(private readonly history: () => readonly string[], private readonly ignore?: RegExp) {}

  query(context: SuggestionContext): Suggestion[] {
    if (!context.buffer.trim()) return [];
    const results: Suggestion[] = [];
    const seen = new Set<string>();
    const all = [...this.history(), ...this.session];
    for (let index = all.length - 1; index >= 0 && results.length < 5; index -= 1) {
      const command = all[index]!;
      if (seen.has(command) || !command.startsWith(context.buffer) || isPrivateCommand(command, this.ignore)) continue;
      seen.add(command);
      results.push({text: command, source: 'nmsh', score: all.length - index});
    }
    return results;
  }

  record(entry: CommandEntry): void {
    if (!isPrivateCommand(entry.command, this.ignore)) this.session.push(entry.command);
  }
}
