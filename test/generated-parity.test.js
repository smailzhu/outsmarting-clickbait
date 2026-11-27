import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('synced shared modules and userscript custom protocol/profile helpers match source', () => {
  for (const [from,to] of [['shared/hover-activation.js','extension/hover-activation.js'],['shared/providers.js','extension/providers.js'],['shared/profiles.js','extension/profiles.js'],['shared/prompt.js','extension/prompt.esm.js'],['shared/extract.js','extension/extract.js']]) assert.equal(read(to),read(from));
  const script = read('userscript/debait.user.js');
  assert.ok(script.includes(read('shared/providers.js').replace(/^export /gm,'')));
  assert.ok(script.includes(read('shared/profiles.js').replace('globalThis','profileScope')));
});
test('custom adds no extension permissions and declares only the approved sandbox grant', () => {
  const manifest=JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.version,JSON.parse(read('package.json')).version);
  assert.deepEqual(manifest.permissions,['storage','contextMenus']);
  assert.deepEqual(manifest.host_permissions,['https://*/*','http://*/*']);
  assert.match(read('userscript/debait.user.js'), /@sandbox\s+DOM/);
  const grants = [...read('userscript/debait.user.js').matchAll(/@grant\s+(\w+)/g)].map((match) => match[1]);
  assert.deepEqual(grants, ['GM_info','GM_xmlhttpRequest','GM_setValue','GM_getValue','GM_registerMenuCommand']);
});

test('hover helpers load in actual production order, never in userscript/content writer', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const scripts = manifest.content_scripts[0].js;
  assert.equal(scripts.indexOf('hover-activation.js'), scripts.indexOf('content.js') - 1);
  assert.ok(!scripts.includes('hover-provenance.js'));
  const options = read('extension/options.html');
  assert.ok(options.indexOf('src="hover-activation.js"') < options.indexOf('src="hover-provenance.js"'));
  assert.ok(options.indexOf('src="hover-provenance.js"') < options.indexOf('src="options.js"'));
  const worker = read('extension/background.js');
  assert.ok(worker.indexOf('import "./hover-activation.js"') < worker.indexOf('import "./hover-provenance.js"'));
  assert.ok(worker.indexOf('import "./hover-provenance.js"') < worker.indexOf('ensureInitialized()'));
  assert.ok(!read('userscript/debait.user.js').includes('DebaitHoverActivation'));
  assert.ok(!read('extension/content.js').includes('navigator.locks'));
  assert.ok(!read('extension/content.js').includes('DebaitHoverProvenance'));
  for (const lang of ['en', 'zh_TW', 'nan-Hanlo']) {
    const raw = read(lang === 'nan-Hanlo' ? `locales-extra/${lang}/messages.json` : `extension/_locales/${lang}/messages.json`);
    assert.ok(read('extension/messages.gen.js').includes(JSON.stringify(JSON.parse(raw))));
  }
});
