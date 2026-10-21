/**
 * Driftkeys' phrase lists, written for NMSh and released under the repository's GPL-3.0-only license. Each mode has
 * three tiers from short to long; the game draws from harder tiers as the level rises. Phrases are plain data that the
 * game only compares keys against: they are never run, and nothing typed is ever sent anywhere. Printable ASCII only,
 * at most 24 characters, no trailing or doubled spaces.
 */
export type Mode = 'programmer' | 'words';
export const MODES: readonly Mode[] = ['programmer', 'words'];
export const MODE_LABEL: Readonly<Record<Mode, string>> = {programmer: 'Programmer', words: 'Words'};
export const MODE_HINT: Readonly<Record<Mode, string>> = {programmer: 'commands and code', words: 'ordinary words'};

export const PROGRAMMER: readonly (readonly string[])[] = [
  [
    'ls', 'pwd', 'cd ..', 'git add', 'git log', 'npm test', 'make', 'cat -n', 'echo hi', 'node -v', 'git pull', 'ls -a',
    'whoami', 'clear', 'history', 'git push', 'npm ci', 'cd ~', 'which ls', 'man ls',
  ],
  [
    'git status', 'docker ps', 'ls -la', 'git diff', 'npm run dev', 'git commit', 'grep -rn todo', 'make build', 'chmod +x run.sh',
    'cd src/app', 'git branch', 'npm install', 'docker images', 'tail app.log', 'cat README.md', 'mkdir -p out', 'touch notes.md',
    'git stash pop', 'npx tsc --noEmit', 'node index.js',
  ],
  [
    'command -v node', 'git log --oneline', 'docker compose up', 'tail -f server.log', 'curl -I localhost', 'git checkout -b fix',
    'npm run build --silent', 'export PORT=8080', 'find . -name "*.ts"', 'git commit -m "wip"', 'docker run --rm alpine', 'ps aux | grep node',
    'sort names.txt | uniq', 'cp -r src backup', 'git rebase main', 'echo $HOME', 'cat a.txt | wc -l', 'diff -u old new', 'git remote -v',
    'ssh -T git@github.com',
  ],
];

export const WORDS: readonly (readonly string[])[] = [
  [
    'cat', 'moon', 'yarn', 'purr', 'nap', 'sun', 'fish', 'leaf', 'mist', 'star', 'wind', 'tail', 'paw', 'rain', 'warm', 'soft',
    'bell', 'path', 'dusk', 'glow',
  ],
  [
    'lantern', 'whisker', 'harbor', 'blanket', 'meadow', 'shadow', 'cushion', 'window', 'drifting', 'silver', 'pebble', 'orchard',
    'ribbon', 'thunder', 'cinnamon', 'sparrow', 'twilight', 'velvet', 'compass', 'jasmine',
  ],
  [
    'quiet harbor', 'paper lanterns', 'warm blanket', 'midnight garden', 'sleepy kitten', 'silver moonlight', 'soft footsteps',
    'a ball of yarn', 'morning sunbeam', 'rain on the roof', 'curious whiskers', 'drifting clouds', 'the old library', 'gentle thunder',
    'cozy window seat', 'secret staircase', 'tiny lighthouse', 'winter lantern', 'dusty bookshelf', 'summer orchard',
  ],
];

export const PHRASES: Readonly<Record<Mode, readonly (readonly string[])[]>> = {programmer: PROGRAMMER, words: WORDS};
