import { withGame } from './harness.js';

await withGame(async (page, api) => {
  await api.waitReady(90000);
  await api.game('disableAudio');
  await api.game('seed', 7);
  await api.game('start', { manual: true });
  await api.game('setEnemyAI', false);
  await api.game('setGodMode', true);
  // stand on the street in front of the saloon, look up at the balcony
  await page.evaluate(() => {
    const G = window.__game.G;
    G.player.pos.set(-6, 0, 2);
    G.player.yaw = Math.PI * 0.0; // face -z (toward saloon front at z=-16)
    G.player.pitch = 0.5; // look up
    // spawn the balcony (roof) enemy
    const a = G.town.anchors.find((x) => x.id === 'saloon-roof-4');
    G.enemies.spawn('roof', a, { state: 'peek' });
    G.scene.updateMatrixWorld(true);
  });
  await api.step(4);
  const path = await api.shot('balcony_enemy');
  console.log('SHOT', path);
}, { query: '?headless=1&seed=7' });
