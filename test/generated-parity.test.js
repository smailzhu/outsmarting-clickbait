import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('synced shared modules and userscript custom protocol/profile helpers match source', () => {
  for (const [from,to] of [['shared/providers.js','extension/providers.js'],['shared/profiles.js','extension/profiles.js'],['shared/prompt.js','extension/prompt.esm.js'],['shared/extract.js','extension/extract.js']]) assert.equal(read(to),read(from));
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
