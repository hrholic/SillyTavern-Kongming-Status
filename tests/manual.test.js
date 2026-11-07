import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { normalizeSettings, normalizeManualRule, normalizeManualRules } from '../core.js?v=0.3.3';
import { extractManualStatuses, planTailStatuses } from '../tail.js?v=0.3.3';
import { createFrameController } from '../frames.js?v=0.3.3';
const rules = [{ start: '<my_panel>', end: '</my_panel>' }];
const value = '今天已经完成阅读';
const raw = `<my_panel>${value}</my_panel><content>一段独立正文</content>`;
function root(html) { return new JSDOM(`<main>${html}</main>`).window.document.querySelector('main'); }

test('saved rule validation, migration, deduplication and bounds', () => {
    assert.deepEqual(normalizeSettings({ excluded: 'leave' }).manualRules, []);
    assert.equal(normalizeSettings({ excluded: 'leave', manualRules: rules }).excluded, 'leave');
    assert.deepEqual(normalizeManualRule({ start: ' <MY_PANEL> ', end: '</my_panel>' }), rules[0]);
    assert.equal(normalizeManualRules([...rules, ...rules, null]).length, 1);
    for (const tag of ['content', 'context', 'think', 'xp_cot', 'hidden_raw', 'script', 'iframe']) {
        assert.equal(normalizeManualRule({ start: `<${tag}>`, end: `</${tag}>` }), null);
    }
    for (const pair of [['<one>', '</two>'], ['.*', '.*'], ['<one hidden>', '</one>'], ['<one>', '']]) {
        assert.equal(normalizeManualRule({ start: pair[0], end: pair[1] }), null);
    }
});

test('explicit tags match before body without automatic field-shape guesses', () => {
    const r = root(`<section>${value}</section><p>一段独立正文</p>`), before = r.innerHTML;
    assert.equal(planTailStatuses(r, raw).existing.size, 0);
    assert.equal(planTailStatuses(r, raw, '', { manualRules: rules }).existing.size, 1);
    assert.equal(r.innerHTML, before);
    assert.equal(extractManualStatuses(`<my_panel>${value}</my_panel>`, rules).length, 1);
});

test('manual rules cannot override source protection or ambiguous/missing boundaries', () => {
    for (const source of [
        `<content>${raw}</content>`, `<xp_cot>${raw}</xp_cot>`, `<div hidden>${raw}</div>`,
        `<div class="thinking">${raw}</div>`, `<div class="custom-keep">${raw}</div>`,
        `<!--${raw}-->`, `<!--${raw}`, `<div style=display:none>${raw}</div>`, '```html\n' + raw + '\n```',
        `<my_panel>${value}`, `<my_panel><div hidden>${value}</div></my_panel>`,
        `<my_panel>${value}</my_panel><content>${value}</content>`,
    ]) assert.equal(extractManualStatuses(source, rules, 'keep').length, 0, source);
    assert.equal(extractManualStatuses(raw, rules, 'my_panel').length, 0);
});

test('manual mappings reject hidden DOM without reading its text, and reject mixed or duplicate text', () => {
    for (const html of [
        `<section hidden>${value}</section>`, `<section><span hidden>${value}</span></section>`,
        `<details><summary>标题</summary><p>${value}</p></details>`,
    ]) {
        const r = root(html), hidden = r.querySelector('[hidden], details p');
        Object.defineProperty(hidden, 'textContent', { get() { throw Error('hidden text read'); } });
        assert.equal(planTailStatuses(r, raw, '', { manualRules: rules }).existing.size, 0);
    }
    for (const html of [`<section>附加正文${value}</section>`, `<section>${value}</section><section>${value}</section>`]) {
        const plan = planTailStatuses(root(html), raw, '', { manualRules: rules });
        assert.equal(plan.existing.size + plan.groups.length, 0);
    }
});

test('same-origin frame uses saved rules only for corresponding visible existing nodes', () => {
    const dom = new JSDOM('<div class="mes_text"><iframe></iframe></div>', { url: 'https://example.test/', pretendToBeVisual: true });
    const message = dom.window.document.querySelector('.mes_text'), frame = message.querySelector('iframe');
    frame.contentDocument.body.innerHTML = `<section>${value}</section><p>一段独立正文</p>`;
    const settings = { enabled: true, excluded: '', selectors: '', manualRules: rules };
    const controller = createFrameController({ getSettings: () => settings, getRawMessage: () => raw });
    try {
        controller.sync([message]); assert.equal(controller.count(), 1);
        assert.equal(frame.contentDocument.body.className, '');
        settings.excluded = 'my_panel'; controller.refresh(); assert.equal(controller.count(), 0);
        settings.excluded = ''; frame.contentDocument.body.innerHTML = '<section>完全改写的渲染文字</section>';
        controller.refresh(); assert.equal(controller.count(), 0);
    } finally { controller.stop(); dom.window.close(); }
});
