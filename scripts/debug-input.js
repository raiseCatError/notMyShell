#!/usr/bin/env node
console.log('NMSh Raw Input Debugger');
console.log('Press Cmd+A, Alt+A, etc. to see bytes. Press Ctrl+C to exit.\n');

process.stdin.setRawMode(true);
process.stdin.on('data', (data) => {
  if (data.toString() === '\u0003') {
    console.log('Ctrl+C received. Exiting.');
    process.exit(0);
  }
  const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const str = data.toString().replace(/\x1b/g, 'ESC');
  console.log(`Received: ${hex}  =>  ${str}`);
});
