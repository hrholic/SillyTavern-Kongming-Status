import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const fixture = await readFile(new URL('./fixture.html',import.meta.url),'utf8');
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
function setup() {
    const dom=new JSDOM(fixture,{url:'http://localhost/tests/fixture.html',runScripts:'dangerously',pretendToBeVisual:true});
    const w=dom.window;
    for(const key of ['document','MutationObserver'])globalThis[key]=w[key];
    globalThis.getComputedStyle=w.getComputedStyle.bind(w);
    globalThis.requestAnimationFrame=w.requestAnimationFrame.bind(w);
    globalThis.cancelAnimationFrame=w.cancelAnimationFrame.bind(w);
    globalThis.matchMedia=()=>({matches:false});
    return {dom,w,api:w.SillyTavern};
}
async function until(predicate) {
    for(let i=0;i<50&&!predicate();i++)await delay(20);
    assert.ok(predicate(),'expected lifecycle condition within one second');
}

test('late context uses saved settings, not permanently captured defaults',async()=>{
    const {dom,w,api}=setup();
    w.settingsFixture.kongming_status={enabled:false,theme:'dark',template:'paper',excluded:'keep-panel'};
    globalThis.SillyTavern=undefined;
    const plugin=await import('../index.js?test=late-context');
    try {
        await until(()=>w.document.querySelector('#kongming-status-boot'));
        assert.match(w.document.querySelector('.kms-boot-status').textContent,/等待酒馆/);
        assert.equal(w.document.querySelector('#kongming-status-settings'),null);
        globalThis.SillyTavern=api;
        await until(()=>w.document.querySelector('#kongming-status-settings'));
        assert.equal(w.document.querySelector('.kms-enable-badge').textContent,'已关闭');
        assert.equal(w.document.querySelector('[data-kms-setting="excluded"]').value,'keep-panel');
        assert.equal(w.document.querySelector('[data-kms-setting="template"]').value,'paper');
        assert.equal(w.document.querySelector('#chat .kms-card'),null);
        assert.equal(w.document.querySelector('#kongming-status-boot'),null);
    } finally {plugin.onDisable();dom.window.close();}
});

test('host disable cancels delayed-context retry and passive bootstrap observer',async()=>{
    const {dom,w,api}=setup();globalThis.SillyTavern=undefined;
    const plugin=await import('../index.js?test=disable-before-context');
    try {
        await until(()=>w.document.querySelector('#kongming-status-boot'));
        plugin.onDisable();globalThis.SillyTavern=api;
        w.document.body.append(w.document.createElement('div'));
        await delay(350);
        assert.equal(w.document.querySelector('#kongming-status-settings'),null);
        assert.equal(w.document.querySelector('#kongming-status-boot'),null);
        assert.equal(w.document.querySelector('#chat .kms-card'),null);
    } finally {plugin.onDisable();dom.window.close();}
});

test('missing initial settings host is retried without creating duplicate panels',async()=>{
    const {dom,w,api}=setup();globalThis.SillyTavern=api;
    w.document.getElementById('extensions_settings').remove();
    const plugin=await import('../index.js?test=late-host');
    try {
        await delay(60);assert.equal(w.document.querySelector('#kongming-status-settings'),null);
        const host=w.document.createElement('div');host.id='extensions_settings2';w.document.body.append(host);
        await until(()=>host.querySelector('.kms-count'));
        assert.equal(w.document.querySelectorAll('#kongming-status-settings').length,1);
        assert.match(host.querySelector('.kms-count').textContent,/已启用/);
        assert.equal(host.querySelector('.kms-version').textContent,'v0.3.2');
    } finally {plugin.onDisable();dom.window.close();}
});
