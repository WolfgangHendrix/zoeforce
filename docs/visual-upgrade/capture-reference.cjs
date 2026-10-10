/* Offline, isolated reference capture. Does not alter production source or saves. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'reference');
const { chromium } = require(require.resolve('playwright', { paths: [ROOT, path.resolve(ROOT, '../neighborwars')] }));
const sharp = require(require.resolve('sharp', { paths: [path.resolve(ROOT, '../SpaceChakra')] }));
const captures = [], recordings = [], errors = [];
const only = process.argv.find(x => x.startsWith('--only='))?.slice(7);
if (process.argv.includes('--append')) {
  const prior = JSON.parse(fs.readFileSync(path.join(OUT, 'capture-index.json'), 'utf8'));
  captures.push(...prior.captures); recordings.push(...prior.recordings);
}
fs.mkdirSync(path.join(OUT, 'screens'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'videos'), { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const name = path.resolve(ROOT, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (name !== ROOT && !name.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  const file = name === ROOT ? path.join(ROOT, 'index.html') : name;
  fs.readFile(file, (err, bytes) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(bytes);
  });
});

function baseline() {
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${ROOT.replaceAll('\\', '/')}`, '-c', 'core.excludesFile=', '-C', ROOT, ...args], { encoding: 'utf8' });
  const files = ['index.html', ...fs.readdirSync(path.join(ROOT, 'src')).filter(x => x.endsWith('.js')).map(x => 'src/' + x)];
  return {
    capturedAt: new Date().toISOString(), root: ROOT, commit: git('rev-parse', 'HEAD').trim(),
    existingChanges: git('status', '--short', '--untracked-files=no').trim().split('\n').filter(Boolean),
    sourceHashes: Object.fromEntries(files.map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex')])),
    sourceDiff: git('diff', '--', 'index.html', 'src', 'README.md', 'GOALS.md', 'docs/life-force-reference.md'),
    notes: ['Current local working tree, including pre-existing enhancements.', 'New isolated browser context; normal player saves untouched.', 'Existing debug warps and frame stepping used for coverage; not proof of full campaign passability.', 'Capture-only CSS hides the outside control hint and removes its layout gap.', 'Frame-stepped footage is labeled; it documents original transitions, not real-time performance.']
  };
}

function installHelpers() {
  const N = window.NS, G = N.Game;
  window.ref = {
    tick(n = 1) { N.Debug.stepping = true; G.step(n); N.Debug.stepping = false; },
    render() { N.Debug.paused = true; N.Debug.stepping = false; G.step(1); },
    clean(keepIntro = false) {
      if (!keepIntro) N.Intro.stop(); N.Save.reset(); N.FX.reset();
      G.stageMsg = G.bossWarn = G.modeMsg = G.voxelMsgT = G.achievementMsgT = 0;
      G.player.invuln = 0; G.player.anim = 0;
    },
    base(stage = 1) {
      N.Autoplay.stop(); N.Debug.paused = true; N.Debug.stepping = false;
      N.Debug.invincible = true; N.Debug.noclip = false; N.Debug.freezeScroll = false;
      G.settings.attractMode = false; G.settings.master = 0; G.settings.shake = 0;
      G.settings.reducedFlash = false; G.settings.reducedMotion = false;
      if (stage > G.furthestStage) { N.Profile.debugUnlockAll(); G.furthestStage = 6; }
      G.startRun(stage); G.clearT = 0; G.prevState = 'play';
      G.pause.confirm = null; G.pause.submenu = null; G.pause.auto = false;
      G.titleMenu.screen = 'main'; G.titleMenu.index = 0; G.titleMenu.profileConfirm = 0;
      this.clean();
    },
    title(screen = 'main') {
      this.base(); G.state = 'title'; G.titleMenu.screen = screen; G.frame = 120;
      G.titleMenu.stageIndex = G.titleMenu.optionIndex = G.titleMenu.profileIndex = G.titleMenu.recordsPage = 0;
      this.render();
    },
    scene(stage, progress = .5, frames = 100) {
      this.base(stage);
      if (stage === 1) { G.scrollX = N.Terrain.BOSS_X * progress; N.Level1.seek(G.scrollX); }
      else if (stage === 2) N.Level2.scrollY = N.Level2.FORTRESS_Y * progress;
      else { N.Campaign.scroll = N.Campaign.spec.length * progress; if (stage === 5 && progress > .45) N.Campaign.spec.miniDone = true; }
      this.tick(frames); this.clean(); G.player.placeClear(G.player.x, G.player.y); this.render();
    },
    encounter(stage, where, frames = 240, keepIntro = false) {
      this.base(stage);
      if (stage === 1) { G.scrollX = N.Terrain.BOSS_X - 2; N.Level1.seek(G.scrollX); }
      else if (stage === 2) N.Level2.debugJump(where, G);
      else N.Campaign.debugJump(stage, where, G);
      this.tick(frames); this.clean(keepIntro); G.player.placeClear(G.player.x, G.player.y); this.render();
    },
    loadout() {
      const p = G.player; p.speedLv = 3; p.missileLv = 3; p.missile = true; p.weapon = 'laser';
      p.shield = 4; p.sel = 3; while (p.options.length < N.Player.MAX_OPTIONS) p.recoverOption();
      p.options.forEach((o, i) => { o.x = p.x - (i + 1) * 20; o.y = p.y + (i + 1) * 8; });
    },
    escape(frame) {
      this.base(6); N.Campaign.phase = 'ending'; N.Campaign.ending = true;
      N.Campaign.escapeT = N.Campaign.escapeScroll = 0; N.Campaign.escapeBars = [];
      G.player.x = N.W / 2; G.player.y = 42; this.tick(frame); this.clean(); this.render();
    },
    meta() {
      return { state: G.state, stage: G.stage, titleScreen: G.titleMenu.screen, pauseSubmenu: G.pause.submenu,
        scroll: G.stage === 1 ? G.scrollX : G.stage === 2 ? N.Level2.scrollY : N.Campaign.scroll,
        boss: G.boss ? { name: G.bossName, form: G.boss.form || null, hp: G.boss.hp, dead: !!G.boss.dead } : null,
        player: { x: G.player.x, y: G.player.y, weapon: G.player.weapon, alive: G.player.alive },
        frame: G.frame, voxel: N.Voxel.status(), intro: { active: N.Intro.active, frame: N.Intro.t, name: N.Intro.name } };
    }
  };
}

async function boot(context, origin) {
  const page = await context.newPage();
  page.on('pageerror', e => errors.push({ url: page.url(), message: e.message }));
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 0;
    let seed = 874122;
    Math.random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  });
  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => NS.Game && NS.Game.buffer, null, { polling: 25 });
  await page.addStyleTag({ content: '#hint{display:none!important}#wrap{gap:0!important}' });
  // The first loading frame is preserved before advancing the boot queue.
  await page.evaluate(() => NS.Game.step(1));
  if (page.viewportSize().width === 1920 && !fs.existsSync(path.join(OUT, 'screens', 'ui-loading.png'))) {
    await page.screenshot({ path: path.join(OUT, 'screens', 'ui-loading.png') });
  }
  await page.waitForFunction(() => { if (NS.Game.state === 'loading') NS.Game.step(1); return NS.Game.state === 'title'; }, null, { polling: 30, timeout: 60000 });
  await page.evaluate(installHelpers);
  await page.evaluate(() => { NS.Game.settings.attractMode = false; NS.Debug.paused = true; });
  if (await page.evaluate(() => NS.Voxel.status()) !== 'on') throw new Error('Voxel renderer did not boot');
  return page;
}

async function renderer(page, mode) {
  await page.evaluate(mode => {
    const active = NS.Voxel.active();
    if ((mode === 'voxel') !== active) NS.Voxel.toggle();
    NS.Game.resize(); ref.render();
  }, mode);
}

async function shot(page, id, label, group, notes = '', pair = false) {
  for (const mode of pair ? ['2d', 'voxel'] : ['2d']) {
    await renderer(page, mode);
    const file = `screens/${id}-${mode}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    const prior = captures.findIndex(c => c.id === id + '-' + mode);
    if (prior >= 0) captures.splice(prior, 1);
    captures.push({ id: id + '-' + mode, scene: id, label, group, renderer: mode, file, notes, viewport: { width: 1920, height: 1080 }, setup: await page.evaluate(() => ref.meta()) });
    console.log(`CAPTURE ${captures.length}: ${id} / ${mode}`);
  }
}

async function ui(page) {
  captures.push({ id: 'ui-loading', scene: 'ui-loading', label: 'Loading / boot', group: 'UI', renderer: '2d', file: 'screens/ui-loading.png', viewport: { width: 1920, height: 1080 } });
  for (const [screen, label] of [['main', 'Title / main menu'], ['stages', 'Stage selection — fresh profile'], ['options', 'Options — keyboard selection'], ['controls', 'Controls / remapping'], ['profiles', 'Pilot profiles'], ['records', 'Career records']]) {
    await page.evaluate(s => ref.title(s), screen);
    await shot(page, 'ui-' + screen, label, 'UI', '', screen === 'main');
  }
  await page.evaluate(() => { ref.title('stages'); NS.Profile.debugUnlockAll(); NS.Game.furthestStage = 6; });
  await shot(page, 'ui-stages-unlocked', 'Stage selection — all six stages unlocked', 'UI', 'QA unlock in isolated saves.');
  await page.evaluate(() => { ref.title('records'); NS.Game.titleMenu.recordsPage = 1; });
  await shot(page, 'ui-achievements', 'Achievements / locked rewards', 'UI');
  await page.evaluate(() => { ref.title('profiles'); NS.Game.titleMenu.profileConfirm = 1; });
  await shot(page, 'ui-profile-erase', 'Erase profile confirmation — Cancel selected', 'UI');
  await page.evaluate(() => { ref.title('controls'); NS.Game.titleMenu.controlDevice = 'gamepad'; });
  await shot(page, 'ui-controls-gamepad', 'Controls / gamepad bindings', 'UI');
  await page.evaluate(() => { ref.title('controls'); NS.Game.titleMenu.controlDevice = 'keyboard'; NS.Input.beginCapture('fire', 'keyboard'); });
  await shot(page, 'ui-controls-waiting', 'Controls / waiting for replacement fire input', 'UI');
  await page.evaluate(() => NS.Input.cancelCapture());
  for (const [sub, label] of [[null, 'Pause menu'], ['options', 'Pause / options'], ['controls', 'Pause / controls'], ['records', 'Pause / career records']]) {
    await page.evaluate(sub => { ref.scene(1, .25, 30); NS.Game.state = 'paused'; NS.Game.pause.submenu = sub; NS.Game.pause.optionIndex = NS.Game.pause.recordsPage = 0; }, sub);
    await shot(page, 'ui-pause-' + (sub || 'main'), label, 'UI');
  }
  await page.evaluate(() => { NS.Game.pause.recordsPage = 1; });
  await shot(page, 'ui-pause-achievements', 'Pause / achievements', 'UI');
  for (const [kind, lines] of [['restart', ['RESTART STAGE 1?', 'POWER-UPS AND STAGE PROGRESS ARE LOST.', 'SCORE AND REMAINING SHIPS ARE KEPT.']], ['quit', ['END THIS RUN?', 'THE RUN IS OVER — SHIPS, SCORE AND POWER-UPS GO.', 'YOUR HIGH SCORE IS ALREADY SAVED.']]]) {
    await page.evaluate(lines => { NS.Game.pause.submenu = null; NS.Game.pause.confirm = { lines }; NS.Game.pause.index = 0; }, lines);
    await shot(page, 'ui-confirm-' + kind, kind === 'restart' ? 'Restart confirmation' : 'Quit confirmation', 'UI', 'Existing confirmation text rendered directly; Cancel is the default.');
  }
  await page.evaluate(() => { ref.scene(1, .25, 25); NS.Game.state = 'continue'; NS.Game.continueT = 8 * 60; NS.Game.continues = 2; NS.Game.continueIndex = 0; });
  await shot(page, 'ui-continue', 'Continue countdown / restart stage', 'UI');
  await page.evaluate(() => { NS.Game.state = 'gameover'; NS.Game.clearT = 130; });
  await shot(page, 'ui-gameover', 'Game over', 'UI');
  await page.evaluate(() => { ref.base(6); NS.Game.state = 'clear'; NS.Game.clearT = 180; });
  await shot(page, 'ui-ending', 'Campaign ending / victory card', 'UI');
  await page.evaluate(() => { ref.scene(1, .12, 90); ref.loadout(); NS.Game.achievementMsg = 'FIRST SORTIE'; NS.Game.achievementMsgT = 90; NS.Save.write('reference_capture', '1', 'PROFILE SAVED'); });
  await shot(page, 'ui-achievement-save', 'Achievement notification, save indicator and loaded HUD', 'UI', 'Notification forced in isolated capture state.', true);
  await page.evaluate(() => { NS.Game.state = 'paused'; NS.Game.pause.auto = true; NS.Game.pause.submenu = null; NS.Game.pause.confirm = null; NS.Game.achievementMsgT = 0; NS.Save.reset(); });
  await shot(page, 'ui-focus-lost', 'Automatic pause / focus lost', 'UI');
}

const names = ['BIO-CATHEDRAL', 'VOLCANIC ASCENT', 'PROMINENCE INFERNO', 'CELLULAR CURRENT', 'LATIS TEMPLE', 'MECHANICAL CITY'];
const bosses = ['GOLEM OSSUARY', 'CRUISER TETRAN', 'INTRUDER', 'GIGA', 'TUTANHAMANATTACK', 'ZELOS FORCE'];
async function stage(page, n) {
  const group = `Stage ${n} — ${names[n - 1]}`;
  for (const [name, progress, frames] of [['opening', .015, 200], ['middle', .48, 130], ['late', .88, 100]]) {
    await page.evaluate(({ n, progress, frames }) => ref.scene(n, progress, frames), { n, progress, frames });
    await shot(page, `stage-${n}-${name}`, `${names[n - 1]} / ${name}`, group, `QA position at ${Math.round(progress * 100)}% followed by ${frames} simulation frames.`, true);
  }
  await page.evaluate(n => { ref.base(n); NS.Game.stageMsg = 150; }, n);
  await shot(page, `stage-${n}-story`, `${names[n - 1]} / stage story card`, group, '', true);
  await page.evaluate(n => ref.encounter(n, n === 2 ? 'tetran' : 'boss', 125, true), n);
  await shot(page, `stage-${n}-boss-intro`, `${bosses[n - 1]} / entrance`, group, '', true);
  await page.evaluate(n => ref.encounter(n, n === 2 ? 'tetran' : 'boss', 280), n);
  await shot(page, `stage-${n}-boss`, `${bosses[n - 1]} / encounter`, group, '', true);
  if (n === 1) {
    await page.evaluate(() => { NS.Game.boss.state = 'open'; NS.Game.boss.eyeOpen = 1; NS.Game.boss.stateT = 30; ref.render(); });
    await shot(page, 'stage-1-boss-core', 'Golem Ossuary / open weak point', group, 'Existing boss open-state renderer selected for reference.', true);
  }
  if (n === 6) {
    await page.evaluate(() => { NS.Campaign.boss.form = 'heart'; NS.Campaign.boss.dragonHp = 0; ref.tick(100); ref.clean(); });
    await shot(page, 'stage-6-heart', 'Zelos Force / exposed heart phase', group, 'Debug phase switch retains existing heart renderer.', true);
    for (const frame of [60, 230, 430]) {
      await page.evaluate(frame => ref.escape(frame), frame);
      await shot(page, 'stage-6-escape-' + frame, `Final escape / frame ${frame}`, group, '', true);
    }
  }
  if (n === 2) {
    for (const [where, label] of [['volcano', 'Volcano route'], ['rocks', 'Rock storm'], ['fortress', 'Valis Fortress cores'], ['passage', 'Core passage']]) {
      await page.evaluate(where => ref.encounter(2, where, 100), where);
      await shot(page, 'stage-2-' + where, label, group, '', true);
    }
  }
  if (n === 5) {
    await page.evaluate(() => { ref.base(5); NS.Campaign.scroll = NS.Campaign.spec.miniAt; ref.tick(220); ref.clean(); });
    await shot(page, 'stage-5-miniboss', 'Triple Core temple miniboss', group, '', true);
    await page.evaluate(() => { ref.base(5); NS.Campaign.spec.miniDone = true; NS.Campaign.scroll = 5390; ref.tick(70); ref.clean(); });
    await shot(page, 'stage-5-barriers', 'Temple / shoot-through masonry and hidden cells', group, '', true);
  }
}

async function details(page) {
  await page.evaluate(() => { ref.scene(1, .015, 320); NS.Game.player.fire(); ref.tick(5); ref.clean(); });
  await shot(page, 'detail-air-formation', 'Bio-Cathedral / natural opening enemy formation', 'Gameplay details', 'Existing wave table advanced to show the formation inside the playfield.', true);
  await page.evaluate(() => { ref.base(1); NS.Game.scrollX = 3200; NS.Level1.seek(3200); ref.tick(620); ref.clean(); });
  await shot(page, 'detail-wall-threats', 'Bio-Cathedral / wall threats and eruption', 'Gameplay details', 'Natural simulation following a QA seek through the wall-threat section.', true);
  for (const weapon of ['normal', 'laser']) {
    await page.evaluate(weapon => { ref.scene(1, .05, 180); ref.loadout(); NS.Game.player.weapon = weapon; NS.Game.player.fire(); ref.tick(4); ref.clean(); }, weapon);
    await shot(page, 'detail-weapon-' + weapon, `${weapon} weapon, missiles, Options and shield`, 'Gameplay details', 'Shots triggered through the existing player fire method.', true);
  }
  await page.evaluate(() => { ref.scene(1, .15, 50); NS.Game.spawnCapsule(NS.Game.player.x + 65, NS.Game.player.y - 10); ref.clean(); });
  await shot(page, 'detail-capsule', 'Power capsule and selection meter', 'Gameplay details', '', true);
  await page.evaluate(() => { ref.scene(1, .05, 150); NS.Debug.invincible = false; NS.Game.player.invuln = 0; NS.Game.player.kill(); ref.tick(9); });
  await shot(page, 'detail-player-death', 'Player destruction / death feedback', 'Gameplay details', 'Death triggered by existing kill method.', true);
  await page.evaluate(() => { ref.scene(1, .15, 50); NS.Game.settings.projectileContrast = true; NS.Game.player.fire(); ref.tick(3); ref.clean(); });
  await shot(page, 'detail-projectile-contrast', 'High-contrast projectile option', 'Gameplay details', '', true);
}

async function mobile(page) {
  for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => { NS.Touch.show(); ref.title(); });
    await renderer(page, '2d');
    for (const scene of ['title', 'play']) {
      if (scene === 'play') await page.evaluate(() => ref.scene(1, .12, 180));
      await renderer(page, '2d');
      const id = `touch-${viewport.width > viewport.height ? 'landscape' : 'portrait'}-${scene}`;
      const file = 'screens/' + id + '.png';
      await page.screenshot({ path: path.join(OUT, file) });
      captures.push({ id, scene: id, label: `Touch ${viewport.width > viewport.height ? 'landscape' : 'portrait'} / ${scene}`, group: 'Touch layouts', renderer: '2d', file, viewport, setup: await page.evaluate(() => ref.meta()), notes: 'Existing touch controls enabled; viewport layout reference, not a physical-device input test.' });
    }
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => NS.Touch.hide());
}

async function spriteInventory(page) {
  const sprites = await page.evaluate(() => {
    const out = [];
    function walk(value, name) {
      if (value instanceof HTMLCanvasElement) out.push({ id: name, width: value.width, height: value.height, anchor: { x: value.cx ?? value.width / 2, y: value.cy ?? value.height / 2 }, data: value.toDataURL('image/png').split(',')[1] });
      else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) walk(child, name ? name + '.' + key : key);
    }
    walk(NS.S, ''); return out;
  });
  fs.mkdirSync(path.join(OUT, 'sprites'), { recursive: true });
  const manifest = [];
  for (const sprite of sprites) {
    const file = 'sprites/' + sprite.id.replaceAll('.', '-') + '.png';
    fs.writeFileSync(path.join(OUT, file), Buffer.from(sprite.data, 'base64'));
    manifest.push({ id: sprite.id, file, width: sprite.width, height: sprite.height, anchor: sprite.anchor });
  }
  fs.writeFileSync(path.join(OUT, 'sprite-index.json'), JSON.stringify(manifest, null, 2));
  for (let start = 0, board = 1; start < sprites.length; start += 32, board++) {
    const input = [];
    const batch = sprites.slice(start, start + 32);
    for (let i = 0; i < batch.length; i++) {
      const sprite = batch[i], left = (i % 8) * 240, top = 60 + Math.floor(i / 8) * 245;
      const art = await sharp(Buffer.from(sprite.data, 'base64')).resize(192, 175, { fit: 'contain', kernel: 'nearest', background: { r: 15, g: 21, b: 32, alpha: 1 } }).png().toBuffer();
      input.push({ input: art, left: left + 24, top: top + 20 });
      input.push({ input: Buffer.from(`<svg width="240" height="42"><text x="12" y="16" fill="#dce3ed" font-family="sans-serif" font-size="12">${escapeHtml(sprite.id)}</text><text x="12" y="34" fill="#9dacbf" font-family="sans-serif" font-size="11">${sprite.width} x ${sprite.height} native pixels</text></svg>`), left, top: top + 195 });
    }
    input.push({ input: Buffer.from(`<svg width="1920" height="60"><text x="24" y="38" fill="#ffffff" font-family="sans-serif" font-size="25">Zoe Force / original baked sprite frames / sheet ${board}</text></svg>`), left: 0, top: 0 });
    const id = 'sprite-inventory-' + String(board).padStart(2, '0'), file = 'screens/' + id + '.png';
    await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#0f1520' } }).composite(input).png().toFile(path.join(OUT, file));
    const prior = captures.findIndex(c => c.id === id); if (prior >= 0) captures.splice(prior, 1);
    captures.push({ id, scene: id, label: `Original sprite frames / sheet ${board}`, group: 'Original sprite inventory', renderer: '2d', file, viewport: { width: 1920, height: 1080 }, notes: 'Original baked game canvases, enlarged with nearest-neighbor sampling for inspection. Individual transparent originals are in sprites/; sprite-index.json records native dimensions and anchors.' });
  }
  console.log(`SPRITE INVENTORY: ${sprites.length} transparent original frames`);
}

async function record(browser, origin, id, label, setup, durationFrames = 240) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: path.join(OUT, 'videos'), size: { width: 1280, height: 720 } } });
  const page = await boot(ctx, origin);
  await renderer(page, '2d');
  await page.evaluate(setup);
  await page.waitForTimeout(250);
  // Video begins at page creation. Record the selected content after boot and save exact trim times.
  const video = page.video(); const begin = Date.now();
  for (let frame = 0; frame < durationFrames; frame += 3) {
    await page.evaluate(() => ref.tick(3));
    await page.waitForTimeout(50);
  }
  const end = Date.now();
  await ctx.close();
  await video.saveAs(path.join(OUT, 'videos', id + '.webm'));
  const raw = await video.path();
  if (path.resolve(raw) !== path.resolve(path.join(OUT, 'videos', id + '.webm'))) fs.unlinkSync(raw);
  recordings.push({ id, label, file: 'videos/' + id + '.webm', simulationFrames: durationFrames, selectedWallClockMs: end - begin, notes: 'Frame-stepped capture at nominal 60 simulation frames/second; video includes boot before the selected scene. Audio not captured.' });
  console.log('VIDEO: ' + id);
}

const escapeHtml = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function gallery(info) {
  fs.mkdirSync(path.join(OUT, 'contact-sheets'), { recursive: true });
  const groups = [...new Set(captures.map(c => c.group))];
  const sheets = [];
  for (const group of groups) {
    const selected = captures.filter(c => c.group === group && c.renderer === '2d');
    const cols = 3, tileW = 480, tileH = 300, rows = Math.ceil(selected.length / cols);
    const pieces = [];
    for (let i = 0; i < selected.length; i++) {
      const c = selected[i], left = (i % cols) * tileW, top = Math.floor(i / cols) * tileH;
      const thumb = await sharp(path.join(OUT, c.file)).resize(480, 270, { fit: 'contain', background: '#000' }).png().toBuffer();
      pieces.push({ input: thumb, left, top });
      const caption = Buffer.from(`<svg width="480" height="30"><rect width="480" height="30" fill="#101621"/><text x="10" y="20" fill="#eee" font-family="sans-serif" font-size="13">${escapeHtml(c.label).slice(0, 75)}</text></svg>`);
      pieces.push({ input: caption, left, top: top + 270 });
    }
    const file = 'contact-sheets/' + group.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.jpg';
    await sharp({ create: { width: cols * tileW, height: rows * tileH, channels: 3, background: '#070b12' } }).composite(pieces).jpeg({ quality: 90 }).toFile(path.join(OUT, file));
    sheets.push({ group, file });
  }
  fs.writeFileSync(path.join(OUT, 'capture-index.json'), JSON.stringify({ baseline: info, captures, recordings, contactSheets: sheets, errors }, null, 2));
  const cards = groups.map(group => `<section id="${escapeHtml(group)}"><h2>${escapeHtml(group)}</h2><p><a href="${sheets.find(s => s.group === group).file}">Download 2D contact sheet</a></p><div class="grid">${captures.filter(c => c.group === group).map(c => `<article data-mode="${c.renderer}"><a href="${c.file}"><img loading="lazy" src="${c.file}" alt="${escapeHtml(c.label)}"></a><h3>${escapeHtml(c.label)} <small>${c.renderer}</small></h3><p>${escapeHtml(c.notes)}</p><a download href="${c.file}">Original PNG</a></article>`).join('')}</div></section>`).join('');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zoe Force — complete reference gallery</title><style>body{margin:0;background:#090c12;color:#dce3ed;font:16px/1.5 system-ui,sans-serif}main{max-width:1600px;margin:auto;padding:32px}h1{font-size:36px}h2{margin-top:45px}a{color:#97c9ff}nav{display:flex;gap:12px;flex-wrap:wrap;position:sticky;top:0;background:#090c12;padding:12px 0;z-index:2}button{background:#182235;border:1px solid #475569;color:white;padding:10px 16px;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:18px}article{background:#121823;border:1px solid #26344b;border-radius:8px;padding:12px}img,video{width:100%;height:auto;background:#000}h3{font-size:16px;margin:10px 0 4px}small{color:#ffb1d1;margin-left:8px}article p{font-size:13px;color:#9dacbf}body[data-filter="2d"] article[data-mode="voxel"],body[data-filter="voxel"] article[data-mode="2d"]{display:none}.note{border-left:3px solid #77a7df;padding:12px 18px;background:#111a28}</style><main><h1>Zoe Force: reference capture gallery</h1><p>${captures.length} original screenshots · ${recordings.length} transition recordings · local baseline ${info.commit.slice(0, 8)}</p><p class="note">Original game references, not redesign concepts. QA warps and isolated saves enable complete coverage. Gameplay pairs share the same simulation state. Screen-left means decreasing X; screen-right means increasing X. Videos are frame-stepped and include their boot lead-in; they do not establish real-time performance.</p><p><a href="capture-index.json">Capture index and source hashes</a> · <a href="baseline.diff">Pre-existing source changes</a></p><nav><button onclick="document.body.dataset.filter='all'">Both views</button><button onclick="document.body.dataset.filter='2d'">2D only</button><button onclick="document.body.dataset.filter='voxel'">Voxel only</button>${groups.map(g => `<a href="#${escapeHtml(g)}">${escapeHtml(g)}</a>`).join('')}<a href="#motion">Transitions</a></nav>${cards}<section id="motion"><h2>Original transitions</h2><div class="grid">${recordings.map(r => `<article><h3>${escapeHtml(r.label)}</h3><video controls preload="metadata" src="${r.file}"></video><p>${escapeHtml(r.notes)}</p><a download href="${r.file}">Download WebM</a></article>`).join('')}</div></section></main></html>`;
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  console.log(`COMPLETE: ${captures.length} screenshots / ${recordings.length} videos / ${errors.length} browser errors`);
}

(async () => {
  const info = baseline(); fs.writeFileSync(path.join(OUT, 'baseline.diff'), info.sourceDiff); delete info.sourceDiff;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    let page = await boot(ctx, origin);
    if (!only || only === 'ui') await ui(page);
    for (let n = 1; n <= 6; n++) {
      if (only && only !== 'stage' + n) continue;
      await page.close(); page = await boot(ctx, origin);
      await stage(page, n);
    }
    if (only === 'entrances') {
      for (let n = 1; n <= 6; n++) {
        await page.evaluate(n => ref.encounter(n, n === 2 ? 'tetran' : 'boss', 125, true), n);
        await shot(page, `stage-${n}-boss-intro`, `${bosses[n - 1]} / entrance`, `Stage ${n} — ${names[n - 1]}`, 'Original cinematic sampled with its nameplate and letterbox active.', true);
      }
    }
    if (!only || only === 'details') await details(page);
    if (!only || only === 'assets') {
      if (only === 'assets') {
        await page.evaluate(() => { ref.scene(1, .015, 320); NS.Game.player.fire(); ref.tick(5); ref.clean(); });
        await shot(page, 'detail-air-formation', 'Bio-Cathedral / natural opening enemy formation', 'Gameplay details', 'Existing wave table advanced until the full formation is inside the playfield.', true);
      }
      await spriteInventory(page);
    }
    if (!only || only === 'mobile') await mobile(page);
    await ctx.close();
    if (!only || only === 'videos') {
      await record(browser, origin, 'menu-navigation', 'Title → stage selection → main menu', () => {
        ref.title(); NS.Debug.paused = false;
        let t = 0; const oldTick = ref.tick;
        ref.tick = n => { t += n; if (t === 60) { NS.Game.titleMenu.screen = 'stages'; } if (t === 150) NS.Game.titleMenu.screen = 'main'; oldTick(n); };
      });
      await record(browser, origin, 'stage-departure-arrival', 'Stage 1 departure → vertical Stage 2 arrival', () => {
        ref.scene(1, .9, 15); NS.Game.state = 'departing'; NS.Game.nextStage = 2; NS.Game.departV = 0;
      });
      await record(browser, origin, 'boss-entrance', 'Golem Ossuary boss entrance / warning', () => {
        ref.base(1); NS.Game.scrollX = NS.Terrain.BOSS_X - 2; NS.Level1.seek(NS.Game.scrollX);
      }, 270);
      await record(browser, origin, 'final-escape-ending', 'Final lockdown escape → campaign clear', () => ref.escape(1), 660);
    }
    await gallery(info);
    if (errors.length) throw new Error('Browser errors: ' + JSON.stringify(errors));
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
