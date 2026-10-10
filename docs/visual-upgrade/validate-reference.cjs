const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require(require.resolve('sharp', { paths: [path.resolve(__dirname, '../../../SpaceChakra')] }));
const root = path.resolve(__dirname, '../..');
const ref = path.join(__dirname, 'reference');
const index = JSON.parse(fs.readFileSync(path.join(ref, 'capture-index.json'), 'utf8'));

(async () => {
  assert.equal(index.errors.length, 0, 'capture must not contain browser errors');
  assert.equal(new Set(index.captures.map(c => c.id)).size, index.captures.length, 'unique IDs');
  for (const c of index.captures) {
    const file = path.join(ref, c.file);
    assert.ok(fs.existsSync(file), c.file);
    const meta = await sharp(file).metadata();
    assert.equal(meta.width, c.viewport.width, `${c.id} width`);
    assert.equal(meta.height, c.viewport.height, `${c.id} height`);
    const stats = await sharp(file).stats();
    assert.ok(stats.channels.some(ch => ch.stdev > 5), `${c.id} must not be blank`);
    if (c.renderer === 'voxel') {
      const flat = index.captures.find(p => p.scene === c.scene && p.renderer === '2d');
      assert.ok(flat, `2D pair for ${c.id}`);
      assert.equal(flat.setup.stage, c.setup.stage, c.id);
      assert.equal(flat.setup.state, c.setup.state, c.id);
      assert.equal(flat.setup.scroll, c.setup.scroll, c.id);
      assert.deepEqual(flat.setup.player, c.setup.player, c.id);
    }
  }
  const ids = new Set(index.captures.map(c => c.id));
  for (const id of ['loading', 'main-2d', 'main-voxel', 'stages-2d', 'stages-unlocked-2d', 'options-2d', 'controls-2d', 'controls-gamepad-2d', 'controls-waiting-2d', 'profiles-2d', 'profile-erase-2d', 'records-2d', 'achievements-2d', 'pause-main-2d', 'pause-options-2d', 'pause-controls-2d', 'pause-records-2d', 'pause-achievements-2d', 'confirm-restart-2d', 'confirm-quit-2d', 'continue-2d', 'gameover-2d', 'ending-2d', 'achievement-save-2d', 'focus-lost-2d']) {
    assert.ok(ids.has('ui-' + id), 'Required UI ' + id);
  }
  for (let n = 1; n <= 6; n++) {
    for (const scene of ['opening', 'middle', 'late', 'story', 'boss-intro', 'boss']) {
      for (const renderer of ['2d', 'voxel']) {
        const c = index.captures.find(c => c.id === `stage-${n}-${scene}-${renderer}`);
        assert.ok(c, `Stage ${n} ${scene} ${renderer}`);
        assert.equal(c.setup.stage, n, `${c.id} must actually show the named stage`);
        if (scene === 'boss') assert.ok(c.setup.boss && !c.setup.boss.dead, c.id);
        if (scene === 'boss-intro') assert.ok(c.setup.intro?.active && c.setup.intro.frame > 0, c.id);
      }
    }
  }
  for (const id of ['stage-1-boss-core', 'stage-2-volcano', 'stage-2-rocks', 'stage-2-fortress', 'stage-2-passage', 'stage-5-miniboss', 'stage-5-barriers', 'stage-6-heart', 'stage-6-escape-60', 'stage-6-escape-230', 'stage-6-escape-430', 'detail-air-formation', 'detail-wall-threats', 'detail-weapon-normal', 'detail-weapon-laser', 'detail-capsule', 'detail-player-death', 'detail-projectile-contrast']) {
    assert.ok(ids.has(id + '-2d') && ids.has(id + '-voxel'), id);
  }
  for (const id of ['touch-landscape-title', 'touch-landscape-play', 'touch-portrait-title', 'touch-portrait-play']) assert.ok(ids.has(id), id);
  assert.equal(index.recordings.length, 4, 'four original transition recordings');
  for (const r of index.recordings) assert.ok(fs.statSync(path.join(ref, r.file)).size > 10000, r.id);
  for (const s of index.contactSheets) assert.ok(fs.existsSync(path.join(ref, s.file)), s.file);
  for (const [file, hash] of Object.entries(index.baseline.sourceHashes)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), hash, 'Preserve production source: ' + file);
  }
  const report = { passed: true, checkedAt: new Date().toISOString(), captures: index.captures.length, recordings: index.recordings.length, contactSheets: index.contactSheets.length, browserErrors: 0, productionSourceUnchanged: true, coverage: ['main UI states', 'six stages and bosses', 'named special encounters', 'weapons and damage', 'touch layouts', 'matched 2D/voxel simulation states'] };
  fs.writeFileSync(path.join(ref, 'validation-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(err => { console.error(err); process.exitCode = 1; });
