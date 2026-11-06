import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createFrameController } from '../frames.js';

function setup(html, raw = '') {
    const dom = new JSDOM('<div class="mes_text"><iframe id="TH-message--one"></iframe></div>', { pretendToBeVisual: true, url: 'https://example.test/' });
    const message = dom.window.document.querySelector('.mes_text');
    const frame = message.querySelector('iframe');
    frame.contentDocument.body.innerHTML = html;
    let settings = { enabled: true, template: 'classic', excluded: '', selectors: '' };
    let changes = 0;
    const controller = createFrameController({ getSettings: () => settings, getRawMessage: () => raw, getMode: () => 'dark', onChange: () => changes++ });
    controller.sync([message]);
    return { dom, message, frame, controller, document: frame.contentDocument, settings, setRaw: value => raw = value, changes: () => changes };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const blueprint = '<div id="tb" class="tb"><h3 class="tb-heading">角色</h3><div class="tb-meta">地点</div><div class="tb-voice" hidden>声音</div><div class="bpx-head" aria-hidden="true">内文</div><div class="tb-raw" style="display:none">secret</div></div>';

test('only explicit status shell, never story, choices, data-card or body', () => {
    const t = setup('<div class="story-text">正文</div><section class="status-section">Health 10</section><div class="choices-section">选择</div><div id="dc" class="card grid">正文卡</div>');
    assert.equal(t.controller.count(), 1);
    assert.equal(t.document.querySelector('.status-section').classList.contains('kms-frame-shell'), true);
    assert.equal(t.document.querySelectorAll('.kms-frame-shell').length, 1);
    assert.equal(t.document.body.className, '');
    const css = t.document.querySelector('[data-kms-frame-style]').textContent;
    assert.ok(!/display|visibility|opacity|\.kms-frame-shell\s+/.test(css));
    t.controller.stop(); t.dom.window.close();
});

test('known blueprint styles shell without reading or changing hidden raw children', () => {
    const t = setup(blueprint, '<top_blueprint>角色|地点|信息</top_blueprint>');
    const root = t.document.querySelector('#tb');
    assert.equal(t.controller.count(), 1);
    const raw = t.document.querySelector('.tb-raw');
    Object.defineProperty(raw, 'textContent', { get() { throw new Error('hidden raw field was read'); } });
    t.controller.refresh();
    assert.ok(root.classList.contains('kms-frame-shell'));
    assert.equal(raw.style.display, 'none');
    assert.equal(t.document.querySelector('.tb-voice').hidden, true);
    assert.equal(t.document.querySelector('.bpx-head').getAttribute('aria-hidden'), 'true');
    t.controller.stop(); t.dom.window.close();
});

test('blueprint mapping must be unique and outside protected source', () => {
    for (const raw of ['', '<!-- <top_blueprint>x</top_blueprint> -->', '<content><top_blueprint>x</top_blueprint></content>', '<think><top_blueprint>x</top_blueprint></think>', '<top_blueprint>x</top_blueprint><top_blueprint>y</top_blueprint>', '<top_blueprint><context>x</context></top_blueprint>']) {
        const t = setup(blueprint, raw);
        assert.equal(t.controller.count(), 0, raw);
        t.controller.stop(); t.dom.window.close();
    }
});

test('raw body and excluded root, descendant, ancestor and custom-prefix are protected', () => {
    const t = setup('<div class="status-panel">Body only</div>', '<content>Body only</content>');
    assert.equal(t.controller.count(), 0);
    t.setRaw('<content>Body only</content><status>Health 10</status>');
    t.document.querySelector('.status-panel').textContent = 'Health 10';
    t.controller.refresh(); assert.equal(t.controller.count(), 1);
    t.settings.excluded = 'secret';
    for (const html of ['<div class="status-panel secret">Health 10</div>', '<div class="status-panel"><span class="custom-secret">Health 10</span></div>', '<div class="secret"><div class="status-panel">Health 10</div></div>']) {
        t.document.body.innerHTML = html; t.controller.refresh(); assert.equal(t.controller.count(), 0);
    }
    t.document.body.innerHTML = blueprint;
    t.setRaw('<top_blueprint>x</top_blueprint>');
    t.settings.excluded = 'tb-raw'; t.controller.refresh(); assert.equal(t.controller.count(), 0);
    t.controller.stop(); t.dom.window.close();
});

test('hidden, inaccessible and background script frames ignored', () => {
    const t = setup('<div class="status-panel">Health 10</div>');
    t.frame.hidden = true; t.controller.refresh(); assert.equal(t.controller.count(), 0);
    t.frame.hidden = false; t.frame.id = 'TH-script--background'; t.controller.refresh(); assert.equal(t.controller.count(), 0);
    t.frame.id = 'TH-message--one';
    Object.defineProperty(t.frame, 'contentDocument', { get() { throw new Error('SecurityError'); } });
    assert.doesNotThrow(() => t.controller.refresh()); assert.equal(t.controller.count(), 0);
    t.controller.stop(); t.dom.window.close();
});

test('updates, loads, settings and cleanup preserve sources and avoid observer loops', async () => {
    const t = setup('<section class="status-section">Health 10</section>');
    const attributes = t.frame.outerHTML;
    t.document.body.insertAdjacentHTML('beforeend', '<div class="stats">Power 12</div>');
    await tick(); assert.equal(t.controller.count(), 2);
    const changes = t.changes(); await tick(); assert.equal(t.changes(), changes);
    t.settings.template = 'paper'; t.controller.refresh();
    assert.match(t.document.querySelector('style[data-kms-frame-style]').textContent, /#ffffff/);
    t.frame.dispatchEvent(new t.dom.window.Event('load'));
    assert.equal(t.document.querySelectorAll('style[data-kms-frame-style]').length, 1);
    assert.equal(t.frame.outerHTML, attributes);
    t.settings.enabled = false; t.controller.refresh();
    assert.equal(t.controller.count(), 0);
    assert.equal(t.document.querySelectorAll('.kms-frame-shell,[data-kms-frame-style]').length, 0);
    t.settings.enabled = true; t.controller.refresh(); assert.equal(t.controller.count(), 2);
    t.frame.remove(); t.controller.sync([t.message]); assert.equal(t.controller.count(), 0);
    assert.equal(t.document.querySelectorAll('.kms-frame-shell,[data-kms-frame-style]').length, 0);
    t.controller.stop(); t.dom.window.close();
});

test('templates preserve source-like classic shell and use exact slate/paper palette', () => {
    const t = setup('<div class="status-panel" style="padding:22px;font-size:17px">Health 10</div>');
    const rule = () => t.document.querySelector('[data-kms-frame-style]').textContent;
    assert.match(rule(), /background-color:transparent/);
    assert.match(rule(), /background-size:100% 1px,100% 1px/);
    assert.match(rule(), /border:0!important;border-radius:0!important;box-shadow:none/);
    assert.doesNotMatch(rule(), /padding:|font-|::before|::after/);
    t.settings.template = 'slate'; t.controller.refresh();
    for (const value of ['#141c22', '#34424d', '#e5eaed', '#a8c5cc', 'border-radius:4px', 'border-left:3px', 'box-shadow:none']) assert.ok(rule().includes(value), value);
    t.settings.template = 'paper'; t.controller.refresh();
    for (const value of ['#ffffff', '#dce1e6', '#252c34', '#465e73', 'border-radius:2px', 'border-top:3px', 'box-shadow:none']) assert.ok(rule().includes(value), value);
    t.controller.stop(); t.dom.window.close();
});

test('stripped thought/control status and blueprint remain protected', () => {
    for (const tag of ['preprint', 'ecot', 'cot', 'scratchpad', 'chain_of_thought', 'thinking_process', 'tool_call', 'system']) {
        const t = setup('<div class="status-panel">Health 10</div>', `<${tag}>Health 10</${tag}>`);
        assert.equal(t.controller.count(), 0, tag);
        t.document.body.innerHTML = blueprint;
        t.setRaw(`<${tag}><top_blueprint>x</top_blueprint></${tag}>`);
        t.controller.refresh();
        assert.equal(t.controller.count(), 0, tag);
        t.controller.stop(); t.dom.window.close();
    }
});

test('visible readable non-helper iframe accepts only mapped existing status container', () => {
    const t = setup('<div class="story-text">正文故事</div><section class="renamed-panel">地点：花园<br>心情：平静</section><div class="choices-section">选择离开</div>', '<content>正文故事</content><evening>地点：花园\n心情：平静</evening>');
    t.frame.id = 'public-html-renderer'; t.controller.refresh();
    assert.equal(t.controller.count(), 1);
    assert.ok(t.document.querySelector('.renamed-panel').classList.contains('kms-frame-shell'));
    assert.equal(t.document.querySelector('.story-text').classList.contains('kms-frame-shell'), false);
    assert.equal(t.document.querySelector('.choices-section').classList.contains('kms-frame-shell'), false);
    assert.equal(t.document.body.className, '');
    t.frame.removeAttribute('id'); t.controller.refresh(); assert.equal(t.controller.count(), 1);
    t.frame.name = 'TH-script--background'; t.controller.refresh(); assert.equal(t.controller.count(), 0);
    t.frame.name = ''; t.frame.hidden = true; t.controller.refresh(); assert.equal(t.controller.count(), 0);
    t.controller.stop(); t.dom.window.close();
});

test('non-helper mixed HTML status remains scoped and raw protected text cannot become a tail', () => {
    const t = setup('<div class="story-text">正文故事</div><section class="status-section">地点：花园<br>心情：平静</section>', '<content>正文故事</content><status>地点：花园\n心情：平静</status>');
    t.frame.id = 'html-inject'; t.controller.refresh(); assert.equal(t.controller.count(), 1);
    t.settings.excluded = 'status-section'; t.controller.refresh(); assert.equal(t.controller.count(), 0);
    t.settings.excluded = ''; t.setRaw('<content>正文故事 地点：花园 心情：平静</content>');
    t.controller.refresh(); assert.equal(t.controller.count(), 0);
    t.setRaw('<think><evening>地点：花园\n心情：平静</evening></think>');
    t.controller.refresh(); assert.equal(t.controller.count(), 0);
    t.controller.stop(); t.dom.window.close();
});

test('tail mapping never wraps loose groups or styles a whole document', () => {
    const t = setup('地点：花园<br>心情：平静', '<content>正文</content><evening>地点：花园\n心情：平静</evening>');
    t.frame.id = 'other'; t.controller.refresh(); assert.equal(t.controller.count(), 0);
    assert.equal(t.document.body.querySelector('.kms-frame-shell'), null);
    assert.equal(t.document.body.className, '');
    t.controller.stop(); t.dom.window.close();
});
