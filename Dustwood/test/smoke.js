// Gameplay integration smoke: spawn an enemy, aim, fire, verify hit + kill.
// Real-consumer proof that rig/enemies/mission/player/weapons integrate.
import { withGame } from './harness.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
}

await withGame(async (page, api) => {
  await api.waitReady(90000);
  await api.game('disableAudio');
  await api.game('seed', 11);
  await api.game('start', { manual: true });
  await api.game('setGodMode', true);
  await api.game('setInfiniteAmmo', true);
  await api.game('setEnemyAI', false); // keep the target still

  // Spawn a window enemy in front of the player, in the hittable 'peek' state
  // (idle enemies are behind cover by design and not hittable).
  const id = await api.game('spawnEnemy', 'window', -54, 0, { state: 'peek' });
  check('spawnEnemy returns id', typeof id === 'number' && id > 0, 'id=' + id);

  // Step a few frames so the rig binds and capsules refresh.
  await api.step(5);
  let e = await api.game('getEnemy', id);
  check('enemy exists', !!e, JSON.stringify(e));
  check('enemy alive', e && e.state !== 'dead', e && e.state);
  check('enemy hp full', e && e.hp > 0, e && String(e.hp));

  // Aim at the torso and fire until it dies (bounded).
  let killed = false;
  for (let i = 0; i < 40 && !killed; i++) {
    await api.game('aimAtEnemy', id, 'torso');
    await api.game('fire');
    await api.step(3);
    e = await api.game('getEnemy', id);
    if (!e || e.state === 'dead') killed = true;
  }
  check('enemy killed by gunfire', killed, e ? 'state=' + e.state + ' hp=' + e.hp : 'gone');

  const stats = await api.game('getStats');
  check('shots fired recorded', stats.shotsFired > 0, 'fired=' + stats.shotsFired);
  check('hits recorded', stats.shotsHit > 0, 'hits=' + stats.shotsHit);
  check('kill recorded', stats.kills > 0, 'kills=' + stats.kills);

  const st = await api.state();
  check('no runtime errors', st.errors === 0, 'errors=' + st.errors);

  // Headshot path: exercise the real hit pipeline (raycast -> group ->
  // applyDamage) along an exact eye-to-head ray, so spread cannot confound the
  // head-detection check. weapons.js counts a headshot per head hit.
  const id2 = await api.game('spawnEnemy', 'window', -54, 2, { state: 'peek', hp: 500 });
  await api.step(5);
  const hs = await page.evaluate((eid) => {
    const G = window.__game.G;
    const e = G.enemies.byId(eid);
    const p = G.player;
    const eye = { x: p.pos.x, y: p.pos.y + 1.6, z: p.pos.z };
    // head capsule midpoint (highest capsule)
    let hy = -1, hc = null;
    for (let i = 0; i < e.capsules.length / 7; i++) {
      const o = i * 7, my = (e.capsules[o + 1] + e.capsules[o + 4]) / 2;
      if (my > hy) { hy = my; hc = [(e.capsules[o] + e.capsules[o + 3]) / 2, my, (e.capsules[o + 2] + e.capsules[o + 5]) / 2]; }
    }
    const dx = hc[0] - eye.x, dy = hc[1] - eye.y, dz = hc[2] - eye.z;
    const len = Math.hypot(dx, dy, dz);
    const out = { enemy: null, group: null, dist: 0, point: [0, 0, 0] };
    const V = Object.getPrototypeOf(p.pos).constructor;
    const dir = new V(dx / len, dy / len, dz / len);
    const hit = G.enemies.raycast(eye, { x: dx / len, y: dy / len, z: dz / len }, 60, out);
    if (!hit) return { hit: false };
    const res = G.enemies.applyDamage(hit.enemy, hit.group, 10, hit.point, dir, 'revolver');
    return { hit: true, group: hit.group, headshot: res.headshot };
  }, id2);
  const stats2 = await api.game('getStats');
  check('head raycast group is head', hs.hit && hs.group === 'head', JSON.stringify(hs));
  check('headshot detected by damage pipeline', hs.headshot === true, JSON.stringify(hs));

  // Mission progression: skip to sector 4, verify state advances.
  const s4 = await api.game('skipToSector', 4);
  check('skipToSector reaches sector 4', s4.sector === 4, 'sector=' + s4.sector);

  // Prisoner flow: unlock + free.
  await api.game('unlockCell');
  await api.game('winGame');
  const sw = await api.state();
  check('prisoner freed', sw.prisoner === 'free', 'prisoner=' + sw.prisoner);

  console.log(failures === 0 ? '\nALL GAMEPLAY CHECKS PASSED' : `\n${failures} GAMEPLAY CHECK(S) FAILED`);
  if (failures > 0) process.exitCode = 1;
}, { query: '?headless=1&seed=11' });
