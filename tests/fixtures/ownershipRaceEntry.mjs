const probe = new URL('./ownershipRaceProbe.mjs', import.meta.url);
probe.searchParams.set('gate', process.env.NMSH_TEST_OWNERSHIP_GATE);
await import(probe.href);
process.execArgv.push('--import=' + probe.href);
await import('../../src/index.ts');
