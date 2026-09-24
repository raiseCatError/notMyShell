export type TabCompletionAction = 'shell-suggestion' | 'slash-suggestion' | 'ignore';

/** Tab belongs to the NMSh-owned buffer; it never cycles unrelated history or enters hidden ZLE. */
export function tabCompletionAction(shellSuggestionCount: number, slashSuggestionCount: number): TabCompletionAction {
  if (shellSuggestionCount > 0) return 'shell-suggestion';
  if (slashSuggestionCount > 0) return 'slash-suggestion';
  return 'ignore';
}
