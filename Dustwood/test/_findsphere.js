import { withGame } from './harness.js';

await withGame(async (page, api) => {
  await api.waitReady(90000);
  await api.game('disableAudio');
  await api.game('seed', 7);
  await api.game('start', { manual: true });
  const spheres = await page.evaluate(() => {
    const G = window.__game.G;
    const out = [];
    G.scene.traverse((o) => {
      if (!o.isMesh && !o.isSprite) return;
      const g = o.geometry;
      const type = g ? g.type : 'none';
      if (!/Sphere|Icosahedron|Circle|Dodecahedron|Torus|Ball/i.test(type)) return;
      const p = new (Object.getPrototypeOf(G.player.pos).constructor)();
      o.getWorldPosition(p);
      out.push({
        type, name: o.name || '',
        pos: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)],
        mat: o.material ? o.material.type : '',
        color: o.material && o.material.color ? o.material.color.getHexString() : '',
        side: o.material ? o.material.side : '',
        envMap: !!(o.material && o.material.envMap),
        metalness: o.material && o.material.metalness != null ? o.material.metalness : null,
        visible: o.visible,
      });
    });
    return out;
  });
  console.log('SPHERES', JSON.stringify(spheres, null, 1));
}, { query: '?headless=1&seed=7' });
