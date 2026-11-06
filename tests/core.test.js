import test from 'node:test';
import assert from 'node:assert/strict';
import { isStatusLabel, normalizeSettings, textColorMeansDark, excludedNames,
    protectedSource, sourceAllows, comparableText } from '../core.js';

test('recognizes exact short status headings, including decorated labels', () => {
    for (const value of ['状态栏', '🧭 角色状态', 'Status Panel', '当前状态', '顾舟的状态栏', '人物信息']) {
        assert.equal(isStatusLabel(value), true, value);
    }
});
test('does not mistake prose, HP words, or generic headings for status panels', () => {
    for (const value of ['他看了一眼状态栏', '使用状态栏的说明', '时间与天气', '正文', 'context', 'HP: 80', '状态栏'.repeat(30)]) {
        assert.equal(isStatusLabel(value), false, value);
    }
});
test('settings reject invalid types and clamp selector/exclusion length', () => {
    assert.deepEqual(normalizeSettings({ enabled: 'false', theme: 'blue', deep: 1 }),
        { enabled: true, theme: 'auto', deep: false, selectors: '', excluded: '' });
    assert.equal(normalizeSettings({ selectors: 'x'.repeat(1200) }).selectors.length, 1000);
});
test('day/night derived from text luminance, with unknown-color fallback', () => {
    assert.equal(textColorMeansDark('rgba(236, 234, 230, 1)'), true);
    assert.equal(textColorMeansDark('rgb(20 22 26)'), false);
    assert.equal(textColorMeansDark('inherit'), null);
});
test('exclude names are exact and accept tag/class/id notation', () => {
    assert.deepEqual([...excludedNames('<My-Status>, .keep #special\n状态栏')],
        ['content', 'context', 'my-status', 'keep', 'special', '状态栏']);
});
test('raw content/context protection allows an identifiable outside panel', () => {
    const p = protectedSource('<content><div class="status">正文状态:不应改</div></content><details><summary>状态栏</summary>HP:80</details>', excludedNames());
    assert.equal(sourceAllows('正文状态:不应改', p), false);
    assert.equal(sourceAllows('状态栏HP:80', p), true);
    assert.equal(sourceAllows('无法定位的新内容', p), false);
});
test('nested exclusions and partial streaming remain protected', () => {
    const p = protectedSource('<keep>外层<context>正文</context>末尾</keep><status>安全:好</status>', excludedNames('keep'));
    assert.equal(sourceAllows('外层正文末尾', p), false);
    assert.equal(sourceAllows('安全:好', p), true);
    assert.equal(sourceAllows('仍在生成', protectedSource('<content>仍在生成', excludedNames())), false);
});
test('ambiguous repeated text inside and outside protection is not decorated', () => {
    const p = protectedSource('<content>状态栏HP:80</content><status>状态栏HP:80</status>', excludedNames());
    assert.equal(sourceAllows('状态栏HP:80', p), false);
});
test('code examples do not create raw protected spans', () => {
    assert.equal(protectedSource('```html\n<content>示例</content>\n```\n正文', excludedNames()), null);
    assert.equal(protectedSource('示例 `<context>文本</context>`', excludedNames()), null);
});
test('content fields in data are not treated as body tags', () => {
    assert.equal(protectedSource('{"content":"状态数据"}', excludedNames()), null);
});
test('text mapping handles entities and simple Markdown without evaluating markup', () => {
    assert.equal(comparableText('<b>生命</b>： **80** &amp; &#x41;'), '生命:80&A');
});
