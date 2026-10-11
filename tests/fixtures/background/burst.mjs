// High-volume hostile output: escapes, OSC titles/links, bidi controls, invalid UTF-8 and a progress line, then exit 0.
const total = Number(process.argv[2] ?? 20) * 1024 * 1024;
let written = 0, n = 0;
const chunk = () => Buffer.concat([
  Buffer.from(`\u001b[31mred ${n}\u001b[0m \u001b]0;PWNED\u0007\u001b]8;;https://evil.example\u0007link\u001b]8;;\u0007 ‮evil\t`),
  Buffer.from([0xff, 0xfe, 0xc3]), Buffer.from(`\r\n`),
]);
function write() {
  while (written < total) {
    const data = chunk(); n += 1; written += data.length;
    if (!process.stdout.write(data)) return process.stdout.once('drain', write);
  }
  process.stdout.write('progress 10%\rprogress 50%\rprogress 100%\r\ndone\r\n', () => process.exit(0));
}
write();
