import test from 'node:test';

test('NMSh secondary TAP activity fixture', async context => {
  await context.test('slow child output remains observable', async () => {
    console.log('NMSh slow TAP fixture is active');
    await new Promise(resolve => setTimeout(resolve, 2800));
    console.log('NMSh slow TAP fixture completed');
  });
});
