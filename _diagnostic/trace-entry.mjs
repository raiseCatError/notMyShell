import './trace-runtime.mjs';
process.execArgv.push('--import='+new URL('./trace-runtime.mjs',import.meta.url).pathname);
await import('../src/index.ts');
