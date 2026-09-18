import { withGame } from './harness.js';

await withGame(async (page, api) => {
  await api.waitReady(90000);
  await api.game('disableAudio');
  await api.game('seed', 3);
  await api.game('start', { manual: true });
  await api.game('setEnemyAI', false);
  await api.game('setGodMode', true);
  // spawn a hittable enemy a few metres ahead and aim at its torso
  const id = await api.game('spawnEnemy', 'window', -54, 0, { state: 'peek' });
  await api.step(10);
  await api.game('aimAtEnemy', id, 'torso');
  await api.step(2);
  // measure the enemy's rendered screen footprint via its bone world positions
  const info = await page.evaluate((eid) => {
    const G = window.__game.G;
    const e = G.enemies.byId(eid);
    const bones = ['pelvis', 'chest', 'head', 'right_knee', 'left_knee'];
    const pts = bones.map((b) => {
      const v = new (Object.getPrototypeOf(G.player.pos).constructor)(0, 0, 0).applyMatrix4(e.boneByName[b].matrixWorld);
      return [b, +v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
    });
    // geometry bounding box (rest, authored)
    e.geometry.computeBoundingBox();
    const bb = e.geometry.boundingBox;
    return { pts, bb: { min: [+bb.min.x.toFixed(2), +bb.min.y.toFixed(2), +bb.min.z.toFixed(2)], max: [+bb.max.x.toFixed(2), +bb.max.y.toFixed(2), +bb.max.z.toFixed(2)] } };
  }, id);
  console.log('BONE WORLD POS', JSON.stringify(info.pts, null, 1));
  console.log('GEOM BBOX', JSON.stringify(info.bb));
  const path = await api.shot('enemy_visible');
  console.log('SHOT', path);
}, { query: '?headless=1&seed=3' });
