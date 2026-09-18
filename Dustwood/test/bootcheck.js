import { withGame } from './harness.js';

await withGame(async (page, api) => {
  await api.waitReady(90000);
  const state = await api.state();
  const props = await page.evaluate(() => ({ errors: window.__game.errors, nullSystems: window.__game.nullSystems }));
  console.log('READY state.mode =', state.mode);
  console.log('nullSystems =', JSON.stringify(props.nullSystems));
  console.log('errors =', JSON.stringify(props.errors));
  console.log('pageErrors =', JSON.stringify(api.pageErrors));
  // try start
  await api.game('disableAudio');
  await api.game('seed', 7);
  const s2 = await api.game('start', { manual: true });
  console.log('after start mode =', s2.mode, 'sector =', s2.sector, 'sectorState =', s2.sectorState);
  const s3 = await api.game('setTime', 5);
  console.log('after setTime(5) time =', s3.time, 'renders =', s3.renders, 'fps =', s3.fps);
  const after = await page.evaluate(() => window.__game.errors);
  console.log('errors after =', JSON.stringify(after));
}, { query: '?headless=1&seed=7' });
