import {mkdirSync} from 'node:fs';
import {join} from 'node:path';

/**
 * Marks Fish's man-page completion generation as already done in a test home (#403).
 *
 * On a home without generated completions, an interactive Fish starts `fish_update_completions` detached
 * (Fish 4 checks `$__fish_cache_dir/generated_completions`, Fish 3 `$__fish_user_data_dir/generated_completions`).
 * That orphaned process keeps writing about 1,400 files into the home after the shell exits, so removing the home
 * races it. Real installations keep Fish's normal behavior; only test homes are marked, in both places.
 *
 * @param {string} home the HOME the test's shells run with
 * @param {{dataHome?: string, cacheHome?: string}} [dirs] XDG_DATA_HOME / XDG_CACHE_HOME when the test sets them
 */
export function markFishCompletionsGenerated(home, {dataHome = join(home, '.local', 'share'), cacheHome = join(home, '.cache')} = {}) {
  for (const base of [dataHome, cacheHome]) mkdirSync(join(base, 'fish', 'generated_completions'), {recursive: true});
}
