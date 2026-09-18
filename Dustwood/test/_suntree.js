import { withGame } from './harness.js';

// Look up toward the sun azimuth; capture with full post, then disable bloom.
await withGame(async (page, api) => {
  await api.waitReady(90000);
  await api.game('disableAudio');
  await api.game('seed', 7);
  await api.game('start', { manual: true });
  await api.game('setEnemyAI', false);
  await api.game('setGodMode', true);
  await page.evaluate(() => {
    const G = window.__game.G;
    G.player.pos.set(0, 1.6, 0);
    G.player.yaw = -Math.PI * 0.35;
    G.player.pitch = 0.6; // look up at the sun
    G.scene.updateMatrixWorld(true);
  });
  await api.step(3);
  console.log('SHOT_FULL', await api.shot('sun_full_post'));
  // disable bloom by zeroing strength
  await page.evaluate(() => { const G = window.__game.G; if (G.post && G.post.bloom) { G.post.bloom.strength = 0; } });
  await api.step(2);
  console.log('SHOT_NOBLOOM', await api.shot('sun_no_bloom'));
}, { query: '?headless=1&seed=7' });
