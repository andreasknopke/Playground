import { withGame } from './harness.js';

await withGame(async (page, api) => {
  await api.waitReady(90000);
  await api.game('disableAudio');
  await api.game('seed', 7);
  await api.game('start', { manual: true });
  await api.game('setEnemyAI', false);
  await api.game('setGodMode', true);
  // clear view: stand mid-street, look toward horizon (sun azimuth ~ +x/-z)
  await page.evaluate(() => {
    const G = window.__game.G;
    G.player.pos.set(0, 1.6, 0);
    G.player.yaw = -Math.PI * 0.35;
    G.player.pitch = 0.12;
    G.scene.updateMatrixWorld(true);
  });
  await api.step(4);
  const path = await api.shot('sky_view');
  console.log('SHOT', path);
}, { query: '?headless=1&seed=7&nopost=1' });
