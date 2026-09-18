import { withGame } from './harness.js';

// Stand mid-street and look at the buildings on both sides to verify windows,
// doors, orientation and daytime lighting.
await withGame(async (page, api) => {
  await api.waitReady(90000);
  await api.game('disableAudio');
  await api.game('seed', 7);
  await api.game('start', { manual: true });
  await api.game('setEnemyAI', false);
  await api.game('setGodMode', true);
  await page.evaluate(() => {
    const G = window.__game.G;
    G.player.pos.set(-6, 1.6, 0);
    G.player.yaw = Math.PI; // look toward -z (saloon side)
    G.player.pitch = 0.05;
    G.scene.updateMatrixWorld(true);
  });
  await api.step(4);
  console.log('SHOT', await api.shot('street_saloon'));

  await page.evaluate(() => {
    const G = window.__game.G;
    G.player.pos.set(22, 1.6, 0);
    G.player.yaw = 0; // look toward +z (church/livery side)
    G.player.pitch = 0.05;
    G.scene.updateMatrixWorld(true);
  });
  await api.step(4);
  console.log('SHOT', await api.shot('street_church'));

  await page.evaluate(() => {
    const G = window.__game.G;
    G.player.pos.set(-30, 1.6, 0);
    G.player.yaw = Math.PI; // house at -30,-11
    G.player.pitch = 0.05;
    G.scene.updateMatrixWorld(true);
  });
  await api.step(4);
  console.log('SHOT', await api.shot('street_house'));
}, { query: '?headless=1&seed=7' });
