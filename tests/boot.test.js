import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// Simulates an extension loaded after APP_READY on an emitter without replay.
const original = await readFile(new URL('./fixture.html', import.meta.url), 'utf8');
const fixture = original.replace("if(name==='ready'){queueMicrotask(fn);return;}", "if(name==='ready'){return;}");
assert.notEqual(fixture, original);
const dom = new JSDOM(fixture, { url: 'http://localhost/tests/fixture.html', runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window;
for (const key of ['document','MutationObserver','SillyTavern']) globalThis[key] = w[key];
globalThis.getComputedStyle = w.getComputedStyle.bind(w);
globalThis.requestAnimationFrame = w.requestAnimationFrame.bind(w);
globalThis.cancelAnimationFrame = w.cancelAnimationFrame.bind(w);
globalThis.matchMedia = () => ({ matches:false });
const plugin = await import('../index.js');

test('boot does not depend on APP_READY being replayed', async () => {
    for (let i=0;i<30&&!w.document.querySelector('#chat .kms-card');i++) await new Promise(resolve=>setTimeout(resolve,20));
    const output = w.document.querySelector('#kongming-status-settings .kms-count');
    assert.ok(output, 'custom settings and status must mount even without a new APP_READY event');
    assert.match(output.textContent, /已启用/);
    assert.ok(w.document.querySelector('#chat .kms-card'), 'existing messages must be scanned');
    assert.equal(w.document.querySelectorAll('#kongming-status-settings').length,1);
});

test('late settings host mounts once with a nonblank current status', async () => {
    w.document.getElementById('extensions_settings').remove();
    await new Promise(resolve=>setTimeout(resolve,30));
    const host=w.document.createElement('div');host.id='extensions_settings2';w.document.body.append(host);
    await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(host.querySelectorAll('#kongming-status-settings').length,1);
    assert.match(host.querySelector('.kms-count').textContent,/已启用/);
});

test.after(() => { plugin.onDisable(); dom.window.close(); });
