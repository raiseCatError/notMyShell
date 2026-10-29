import type {TransactionState} from './journal.js';

/** Plain words for a reconciled transaction state; the same wording in history, details and restore review. */
export function describeState(state: TransactionState): string {
  switch (state) {
    case 'applied': return 'applied';
    case 'in-progress': return 'still being written by another NMSh process';
    case 'not-applied': return 'interrupted before any file was written (nothing changed)';
    case 'partially-applied': return 'interrupted part-way: some files were written, others were not';
    case 'applied-unfinalized': return 'interrupted after every file was written, before it was marked done';
    case 'conflicted': return 'interrupted, and a file was changed by something else since';
    case 'reverted': return 'rolled back (files returned to their backed-up state)';
    case 'rollback-incomplete': return 'failed, and its rollback was incomplete';
    case 'partial': return 'partly applied (some areas failed or were skipped)';
    case 'indeterminate': return 'unfinished, and a file cannot be read safely to check it';
  }
}

/** Whether an entry needs the user's review before it can be trusted as finished. */
export const needsReview = (state: TransactionState) => !['applied', 'reverted', 'in-progress'].includes(state);
