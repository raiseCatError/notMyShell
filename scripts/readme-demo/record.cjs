const { execSync, execFileSync } = require('child_process');
const delay = ms => new Promise(res => setTimeout(res, ms));

async function typeLiteral(session, text, delayMs = 65) {
  for (const char of text) {
    execFileSync('tmux', ['send-keys', '-t', session, '-l', char]);
    await delay(delayMs);
  }
}

async function sendKey(session, key) {
  execFileSync('tmux', ['send-keys', '-t', session, key]);
}

async function run() {
  const session = 'demorec';
  try { execSync('rm -f scripts/readme-demo/demo.cast'); } catch (e) {}
  execSync(`tmux new-session -d -s ${session} -x 90 -y 18 "asciinema rec -c ./bin/nmsh scripts/readme-demo/demo.cast"`);
  
  await delay(3500);

  // 1. gti status (UNKNOWN)
  await typeLiteral(session, 'gti status');
  await delay(1200);
  await sendKey(session, 'C-u');
  await delay(500);

  // 2. git --version (KNOWN)
  await typeLiteral(session, 'git --version');
  await delay(1200);
  await sendKey(session, 'Enter');
  
  await delay(2000);

  // 3. echo "$HOME" | grep Users (PIPELINE)
  await typeLiteral(session, 'echo "$HOME" | grep Users');
  await delay(1500);
  await sendKey(session, 'C-u');
  await delay(500);

  // 4. sleep 3 (LIVE ACTIVITY)
  await typeLiteral(session, 'sleep 3');
  await delay(1000); // pause to show highlighting
  await sendKey(session, 'Enter');
  
  await delay(4500);

  // 5. clean idle
  await delay(1000);

  await typeLiteral(session, 'exit');
  await sendKey(session, 'Enter');
  await delay(1000);
  try { execSync(`tmux kill-session -t ${session}`); } catch (e) {}
}

run().catch(console.error);
