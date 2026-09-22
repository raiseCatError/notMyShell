import nodePty from 'node-pty';

const pty = nodePty.spawn('./bin/nmsh', [], {
  cwd: process.cwd(),
  cols: 80,
  rows: 24,
  env: {...process.env, TERM: 'xterm-256color'},
});

let chunk = '';
let all = '';
pty.onData(data => {
  chunk += data;
  all += data;
});
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const take = () => {
  const value = chunk;
  chunk = '';
  return value;
};
const plain = value => value.replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/gu, '');
const send = async (value, delay = 300) => {
  take();
  pty.write(value);
  await wait(delay);
  return take();
};

await wait(700);
await send('seq 1 100\r', 700);
const pageUp = await send('\u001B[5~');
const pageDown = await send('\u001B[6~');
const fnUp = await send('\u001B[5~');
const fnDown = await send('\u001B[6~');
const ctrlEnd = await send('\u001B[1;5F');
await send('\u001B[5~');
const ctrlG = await send('\u0007');

await send("for i in {1..12}; do print live-$i; sleep 0.12; done\r", 350);
const detachedStart = await send('\u001B[5~', 250);
await wait(700);
const detachedGrowth = take();
await wait(500);
const detachedAnimation = take();
const returnLatest = await send('\u001B[1;5F', 300);
await wait(900);
take();

const liveStart = await send('sleep 2\r', 500);
await wait(500);
const liveLater = take();
await wait(1300);
await wait(500);
const completion = take();
const autocomplete = await send('/co', 300);
await send('\u0003', 200);
const failure = await send('false\r', 400);
await send('sleep 30\r', 500);
const stopped = await send('\u0003', 400);
await send('printf copied-output\r', 500);
const copy = await send('/copy\r', 500);
await send('less /etc/hosts\r', 400);
const passthrough = await send('q', 500);

for (const [cols, rows] of [[100, 30], [80, 24], [60, 18], [42, 12], [18, 8], [100, 30]]) {
  pty.resize(cols, rows);
  await wait(100);
}
await send('\u001B[5~', 200);
pty.resize(60, 18);
await wait(150);
const detachedResize = take();
await send('\u0007', 150);
await send('\u0004', 250);

const results = {
  pageUpMovesHistory: plain(pageUp).includes('63') && plain(pageUp).includes('82'),
  pageDownMovesHistory: plain(pageDown).includes('81') && plain(pageDown).includes('100'),
  fnUpUsesPageUpSequence: plain(fnUp).includes('63') && plain(fnUp).includes('82'),
  fnDownUsesPageDownSequence: plain(fnDown).includes('81') && plain(fnDown).includes('100'),
  ctrlEndReturnsLatest: plain(ctrlEnd).includes('100'),
  ctrlGReturnsLatest: plain(ctrlG).includes('100'),
  jumpAppearsDetached: plain(detachedStart + detachedGrowth).includes('Jump to bottom'),
  detachedGrowthKeepsJump: plain(detachedGrowth).includes('Jump to bottom') || !plain(detachedGrowth).includes('live-12'),
  animationDoesNotRepaintHistory: !/\u001B\[(?:[1-9]|1[0-9]);1H/u.test(detachedAnimation),
  jumpClearsAtLatest: !plain(returnLatest).includes('Jump to bottom'),
  liveActivityAnimated: /(?:Meowing|Cooking|Herding|Brewing|Thinking|Pondering|Tinkering|Conjuring)…/u.test(plain(liveStart + liveLater)),
  completionCommitted: /✻ (?:Meowed|Cooked|Herded|Brewed|Thought|Pondered|Tinkered|Conjured) for 2\.\d+s · done \d{2}:\d{2}/u.test(plain(completion)),
  autocompleteVisible: plain(autocomplete).includes('/copy') && plain(autocomplete).includes('/copy N'),
  failureNeutral: /✦ Failed after .* · exit 1 · done \d{2}:\d{2}/u.test(plain(failure)),
  interruptionNeutral: /✦ Stopped after .* · done \d{2}:\d{2}/u.test(plain(stopped)),
  copyHistoryPermanent: plain(copy).includes('❯ /copy') && plain(copy).includes('⎿ Clipboard copy failed'),
  passthroughRestored: passthrough.includes('\u001B[?2004h\u001B[?25l'),
  detachedResizeKeepsJump: plain(detachedResize).includes('Jump to bottom'),
  alternateScreenRestored: all.includes('\u001B[?1049h') && all.includes('\u001B[?1049l'),
};
console.log(JSON.stringify(results, null, 2));
for (const [name, value] of Object.entries({pageUp, pageDown, fnUp, fnDown, ctrlEnd, ctrlG})) {
  if (!results[name === 'pageUp' ? 'pageUpMovesHistory' : name === 'pageDown' ? 'pageDownMovesHistory' : name === 'fnUp' ? 'fnUpUsesPageUpSequence' : name === 'fnDown' ? 'fnDownUsesPageDownSequence' : name === 'ctrlEnd' ? 'ctrlEndReturnsLatest' : 'ctrlGReturnsLatest']) {
    console.log(name, JSON.stringify(plain(value).slice(0, 400)));
  }
}
if (!results.completionCommitted) console.log('completion', JSON.stringify(plain(completion).slice(-600)));
if (!results.autocompleteVisible) console.log('autocomplete', JSON.stringify(plain(autocomplete).slice(-600)));
if (Object.values(results).some(result => !result)) process.exitCode = 1;
