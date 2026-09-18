import { withGame } from './harness.js';

await withGame(async (page, api) => {
  await api.waitReady(90000);
  await api.game('disableAudio');
  await api.game('seed', 7);
  await api.game('start', { manual: true });
  await api.game('setEnemyAI', false);
  await api.game('setGodMode', true);
  // list anchors with their y
  const anchors = await page.evaluate(() => {
    return window.__game.G.town.anchors.map((a) => ({ id: a.id, kind: a.kind, y: +a.pos.y.toFixed(2), x: +a.pos.x.toFixed(1), z: +a.pos.z.toFixed(1) }));
  });
  console.log('ANCHORS', JSON.stringify(anchors));
  // spawn a balcony (roof) enemy and a window enemy, report foot + head world y
  const results = await page.evaluate(() => {
    const G = window.__game.G;
    const out = [];
    const V = Object.getPrototypeOf(G.player.pos).constructor;
    for (const a of G.town.anchors) {
      if (a.kind !== 'roof' && a.kind !== 'window') continue;
      const e = G.enemies.spawn(a.kind, a, { state: 'peek' });
      if (!e) continue;
      G.enemies._applyPose(e, 0); G.enemies._syncTransform(e); e.root.updateMatrixWorld(true);
      const foot = new V(0, 0, 0).applyMatrix4(e.boneByName.right_knee.matrixWorld);
      const head = new V(0, 0, 0).applyMatrix4(e.boneByName.head.matrixWorld);
      out.push({ kind: a.kind, anchorY: +a.pos.y.toFixed(2), footY: +e.pos.y.toFixed(2), kneeY: +foot.y.toFixed(2), headY: +head.y.toFixed(2) });
    }
    return out;
  });
  console.log('ENEMY HEIGHTS', JSON.stringify(results, null, 1));
}, { query: '?headless=1&seed=7' });
