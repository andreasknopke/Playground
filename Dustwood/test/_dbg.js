import { withGame } from './harness.js';

await withGame(async (page, api) => {
  await api.waitReady(90000);
  await api.game('disableAudio');
  await api.game('seed', 7);
  await api.game('start', { manual: true });
  await api.game('setGodMode', true);
  const info = await page.evaluate(() => {
    const G = window.__game.G;
    const out = { buildings: [], player: {}, fog: {}, meshes: 0, tris: 0 };
    for (const b of G.town.buildings) out.buildings.push([b.name, +b.x.toFixed(1), +b.z.toFixed(1)]);
    // count meshes in town group
    let m = 0, tris = 0;
    G.town.group.traverse((o) => { if (o.isMesh) { m++; const g = o.geometry; if (g && g.index) tris += g.index.count / 3; else if (g && g.attributes.position) tris += g.attributes.position.count / 3; } });
    out.meshes = m; out.tris = Math.round(tris);
    out.fog = { color: G.scene.fog.color.getHexString(), density: G.scene.fog.density };
    // player forward vector for a given yaw
    const yaw = -Math.PI / 2;
    out.fwdYawNegHalfPi = [+Math.sin(yaw).toFixed(2), +Math.cos(yaw).toFixed(2)];
    return out;
  });
  console.log(JSON.stringify(info, null, 1));
}, { query: '?headless=1&seed=7' });
