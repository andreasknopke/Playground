import { withGame } from './harness.js';

await withGame(async (page, api) => {
  await api.waitReady(90000);
  const errs = await page.evaluate(() => (window.__game && window.__game.G && window.__game.G.nullSystems) || []);
  console.log('NULL SYSTEMS', JSON.stringify(errs));
  console.log('PAGE ERRORS', JSON.stringify(api.pageErrors, null, 1));
  const logs = api.logs.filter((l) => /error|Error|fail|undefined|cannot|Cannot|NaN|throw/i.test(l));
  console.log('RELEVANT LOGS', JSON.stringify(logs, null, 1));
}, { query: '?headless=1&seed=7' });
