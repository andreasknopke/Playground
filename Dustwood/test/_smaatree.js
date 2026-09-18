import { withGame } from './harness.js';

await withGame(async (page, api) => {
  await api.waitReady(90000);
  await api.game('disableAudio');
  await api.game('seed', 7);
  await api.game('start', { manual: true });
  await api.game('setEnemyAI', false);
  await api.game('setGodMode', true);
  // Force an SMAAPass into the composer (headless normally skips it) to reproduce.
  const info = await page.evaluate(async () => {
    const G = window.__game.G;
    if (!G.post || !G.post.composer) return { err: 'no composer' };
    const THREE = await import('three');
    const { SMAAPass } = await import('three/addons/postprocessing/SMAAPass.js');
    const w = window.innerWidth, h = window.innerHeight;
    const smaa = new SMAAPass(w, h);
    // insert before the grade pass (last)
    const passes = G.post.composer.passes;
    passes.splice(passes.length - 1, 0, smaa);
    G.post.smaa = smaa;
    return { passes: passes.map((p) => p.constructor.name) };
  });
  console.log('PASSES', JSON.stringify(info));
  await page.evaluate(() => {
    const G = window.__game.G;
    G.player.pos.set(0, 1.6, 0);
    G.player.yaw = -Math.PI * 0.35;
    G.player.pitch = 0.6;
    G.scene.updateMatrixWorld(true);
  });
  await api.step(3);
  console.log('SHOT_SMAA', await api.shot('sun_smaa'));
}, { query: '?headless=1&seed=7' });
