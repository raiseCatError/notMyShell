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
  execSync('rm -f assets/readme/demo/demo.cast');
  execSync(`tmux new-session -d -s ${session} -x 90 -y 18 "asciinema rec -c ./bin/nmsh assets/readme/demo/demo.cast"`);
  
  await delay(3500);

  // 1. gti status
  await typeLiteral(session, 'gti status');
  await delay(1200);
  await sendKey(session, 'C-u');

  // 2. git status
  await delay(500);
  await typeLiteral(session, 'git status');
  await delay(1200);
  await sendKey(session, 'Enter');
  
  await delay(2000);

  // 3. echo "$HOME" | grep Projects
  await typeLiteral(session, 'echo "$HOME" | grep Projects');
  await delay(2000);
  await sendKey(session, 'C-u');

  // 4. sleep 3
  await delay(500);
  await typeLiteral(session, 'sleep 3');
  await delay(600);
  await sendKey(session, 'Enter');
  
  await delay(4500);

  // 5. clean idle
  await delay(1000);

  await typeLiteral(session, 'exit');
  await sendKey(session, 'Enter');
  await delay(1000);
  execSync(`tmux kill-session -t ${session}`);
}

run().catch(console.error);
