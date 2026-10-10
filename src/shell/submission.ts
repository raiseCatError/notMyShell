/**
 * The text NMSh submits to the shell for a command typed (or queued) in the composer. A multi-line command is
 * submitted as one brace group, so the shell reads it whole and runs it as one command: lines never start one by one,
 * and a heredoc or an `if` block keeps its meaning. One rule for the composer and the queue.
 */
export function shellSubmission(command: string): string {
  return command.includes('\n') ? `{ ${command}\n}` : command;
}
