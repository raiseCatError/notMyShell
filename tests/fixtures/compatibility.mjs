// Deterministic tools for PTY interoperability tests; no accounts or network.
const mode = process.argv[2];
const ESC = '\u001b';
const line = text => process.stdout.write(text + '\r\n');
if (mode === 'finite') {
  line('FINITE-STDOUT');
  process.stderr.write('FINITE-STDERR\n');
  process.exitCode = 7;
}
if (mode === 'noisy') {
  for (let i = 0; i < 1000; i++) line(`building unit ${i} complete`);
  line('NOISY-END');
  process.exitCode = 0;
}
if (mode === 'streaming') {
  let count = 0;
  const timer = setInterval(() => line(`STREAM-${++count}`), 650);
  process.on('SIGINT', () => { clearInterval(timer); line('STREAM-STOP'); process.exit(130); });
} else if (mode === 'canonical') {
  process.stdout.write(`${ESC}[?2004h`);
  line('CANONICAL-READY');
  process.stdin.once('data', data => { line('CANONICAL-' + data.toString().trim()); process.stdout.write(`${ESC}[?2004l`); process.exit(0); });
} else if (mode === 'nested') {
  // Existing node-pty dependency supplies a real inner PTY; keep all ownership local.
  const {default: pty} = await import('node-pty');
  const inner = pty.spawn(process.execPath, [import.meta.filename, 'agent'], {
    cwd: process.cwd(), cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24,
    env: process.env,
  });
  process.stdin.setRawMode(true);
  process.stdin.on('data', data => inner.write(data.toString()));
  process.stdout.on('resize', () => inner.resize(process.stdout.columns, process.stdout.rows));
  process.on('SIGTERM', () => inner.kill());
  inner.onData(data => process.stdout.write(data));
  inner.onExit(event => { process.stdin.setRawMode(false); process.exit(event.exitCode); });
} else if (['inline', 'fullscreen', 'agent'].includes(mode)) {
  const full = mode === 'fullscreen';
  let finished = false;
  const cleanup = code => {
    if (finished) return;
    finished = true;
    process.stdout.write(`${ESC}[<u${ESC}[?2004l${ESC}[?1000l${ESC}[?1006l${ESC}[?25h${full ? ESC + '[?1049l' : ''}`);
    process.stdin.setRawMode(false);
    line(`INTERACTIVE-EXIT-${code}`);
    process.exit(code);
  };
  process.stdin.setRawMode(true);
  process.stdout.write(`${full ? ESC + '[?1049h' : ''}${ESC}[?2004h${ESC}[?1000h${ESC}[?1006h${ESC}[>1u${ESC}[?25l`);
  const size = () => line(`INTERACTIVE-SIZE-${process.stdout.rows}x${process.stdout.columns}`);
  line(`INTERACTIVE-READY-${mode}`);
  size();
  process.stdout.on('resize', size);
  process.on('SIGINT', () => cleanup(130));
  process.on('SIGTERM', () => cleanup(143));
  let carry = '';
  process.stdin.on('data', data => {
    carry += data.toString();
    if (carry.includes('\u0003')) return cleanup(130);
    const paste = /\u001b\[200~([\s\S]*?)\u001b\[201~/u.exec(carry);
    if (paste) { line('INTERACTIVE-PASTE-' + paste[1].replace(/\r?\n/gu, '|')); carry = carry.replace(paste[0], ''); }
    const mouse = /\u001b\[<\d+;\d+;\d+[Mm]/u.exec(carry);
    if (mouse) { line('INTERACTIVE-MOUSE'); carry = carry.replace(mouse[0], ''); }
    const key = /\u001b\[97;1u/u.exec(carry);
    if (key) { line('INTERACTIVE-KEY'); carry = carry.replace(key[0], ''); }
    if (carry.includes('q')) return cleanup(0);
    if (carry.length > 4096) carry = '';
  });
} else if (mode !== 'streaming') {
  throw new Error(`Unknown compatibility fixture ${mode}`);
}
