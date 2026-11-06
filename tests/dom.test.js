import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const fixture = await readFile(new URL('./fixture.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const dom = new JSDOM(fixture, { url: 'http://localhost/tests/fixture.html', runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window;
w.settingsFixture.kongming_status = { enabled: true, theme: 'auto', deep: false, selectors: '', excluded: '' };
for (const key of ['document', 'MutationObserver', 'SillyTavern']) globalThis[key] = w[key];
globalThis.getComputedStyle = w.getComputedStyle.bind(w);
globalThis.requestAnimationFrame = w.requestAnimationFrame.bind(w);
globalThis.cancelAnimationFrame = w.cancelAnimationFrame.bind(w);
globalThis.matchMedia = () => ({ matches: false });
const style = w.document.createElement('style'); style.textContent = css; w.document.head.append(style);
const plugin = await import('../index.js');
const { findStatusRoots } = await import('../core.js');
const settle = () => new Promise(resolve => setTimeout(resolve, 60));
for (let attempt = 0; attempt < 30 && !w.document.querySelector('#chat .kms-card'); attempt++) await settle();
const $ = selector => w.document.querySelector(selector);
const has = id => $('#' + id)?.classList.contains('kms-card') || false;
const originalChat = JSON.stringify(w.chatFixture);
async function setting(key, value) {
    const input = $(`[data-kms-setting="${key}"]`);
    if (input.type === 'checkbox') input.checked = value; else input.value = value;
    input.dispatchEvent(new w.Event('change', { bubbles: true })); await settle();
}
function add(html) { const div=w.document.createElement('div');div.innerHTML=html;$('.mes_text').append(...div.childNodes); }

test('DOM: renamed header, visible enabled badge and accessible switch agree on startup', () => {
    assert.equal($('.kms-settings-title').textContent, '统一状态栏');
    assert.equal($('.kms-enable-badge').textContent, '已启用');
    assert.equal($('[data-kms-setting="enabled"]').getAttribute('role'), 'switch');
    assert.equal($('[data-kms-setting="enabled"]').checked, true);
    assert.equal($('[data-kms-setting="enabled"]').getAttribute('aria-checked'), 'true');
    assert.match($('.kms-count').textContent, /已启用/);
    assert.equal($('#chat').getAttribute('data-kms-template'), 'classic');
    $('#kongming-status-settings').open = false;
    assert.equal($('#kongming-status-settings > summary .kms-enable-badge').textContent, '已启用');
    $('#kongming-status-settings').open = true;
});
test('DOM: automatic status containers, details and tables; no nested double wrapping', () => {
    for (const id of ['named','fold','status-table','nested']) assert.equal(has(id),true,id);
    assert.equal($('#nested').querySelectorAll('.kms-card').length,0);
});
test('DOM: zero recognized cards is explicitly enabled, not mistaken for disabled', async () => {
    await setting('excluded', 'status-bar, status, fold, status-table');
    assert.equal(w.document.querySelectorAll('#chat .kms-card').length, 0);
    assert.equal($('.kms-enable-badge').textContent, '已启用');
    assert.match($('.kms-count').textContent, /已启用，当前未识别/);
    await setting('excluded', '');
});
test('DOM: both new templates update cards and isolated preview with fixed dark/light modes', async () => {
    const card = $('#named');
    await setting('theme','dark');
    for (const [template,mode] of [['slate','dark'],['paper','light']]) {
        await setting('template',template);
        assert.equal($('#chat').getAttribute('data-kms-template'),template);
        assert.equal($('#chat').getAttribute('data-kms-mode'),mode);
        assert.equal($('.kms-preview').getAttribute('data-kms-template'),template);
        assert.equal($('.kms-preview').getAttribute('data-kms-mode'),mode);
        assert.equal($('[data-kms-setting="theme"]').disabled,true);
        assert.equal($('#named'),card);
        assert.equal(w.settingsFixture.kongming_status.template,template);
    }
    assert.equal($('.kms-preview').closest('#chat'),null);
    assert.equal($('#chat').textContent.includes('状态栏预览'),false);
    assert.equal(JSON.stringify(w.chatFixture),originalChat);
    await setting('template','classic');
    assert.equal($('[data-kms-setting="theme"]').disabled,false);
    assert.equal($('#chat').getAttribute('data-kms-mode'),'dark');
    await setting('theme','auto');
});
test('DOM: off state remains unmistakable; preview is labelled as unapplied', async () => {
    await setting('enabled',false);
    assert.equal($('.kms-enable-badge').textContent,'已关闭');
    assert.equal($('[data-kms-setting="enabled"]').checked,false);
    assert.equal($('[data-kms-setting="enabled"]').getAttribute('aria-checked'),'false');
    assert.equal($('.kms-switch-word').textContent,'关');
    assert.match($('.kms-count').textContent,/已关闭/);
    assert.match($('.kms-preview-note').textContent,/未应用到聊天/);
    await setting('template','paper');
    assert.equal(w.document.querySelectorAll('#chat .kms-card').length,0);
    assert.equal($('.kms-preview').getAttribute('data-kms-template'),'paper');
    await setting('enabled',true);
    assert.equal($('.kms-enable-badge').textContent,'已启用');
    assert.equal($('.kms-switch-word').textContent,'开');
    await setting('template','classic');
});
test('DOM: prose, code, ordinary details, user message, unknown panel, iframe untouched', () => {
    for (const id of ['ordinary','code','ordinary-details','user-card','unusual','external-frame']) assert.equal(has(id),false,id);
});
test('DOM: existing click listeners and details content remain intact', () => {
    $('#original-action').click();assert.equal(w.actionCount,1);
    assert.equal($('#fold').open,false);$('#fold').open=true;assert.match($('#fold').textContent,/体力：80/);
});
test('DOM: theme settings and own settings persistence', async () => {
    await setting('theme','dark');assert.equal($('#chat').getAttribute('data-kms-mode'),'dark');
    assert.equal(w.settingsFixture.kongming_status.theme,'dark');assert.ok(w.saved>0);
    await setting('theme','auto');assert.equal($('#chat').getAttribute('data-kms-mode'),'light');
});
test('DOM: custom selector and invalid-selector recovery', async () => {
    await setting('selectors','.bespoke-panel');assert.equal(has('unusual'),true);
    await setting('selectors','[');assert.equal(has('named'),true);assert.match($('.kms-error').textContent,/格式不正确/);
    await setting('selectors','');assert.equal(has('unusual'),false);
});
test('DOM: exclusions restore class and id targets immediately', async () => {
    await setting('excluded','status-bar');assert.equal(has('named'),false);
    await setting('excluded','named');assert.equal(has('named'),false);
    await setting('excluded','');assert.equal(has('named'),true);
});
test('DOM: excluded descendants protect the ancestor and nested layout', async () => {
    $('#nested div').classList.add('keep-me');await setting('excluded','keep-me');
    assert.equal(has('nested'),false);assert.equal($('#nested').querySelectorAll('.kms-card').length,0);
    await setting('excluded','');assert.equal(has('nested'),true);
});
test('DOM: dynamic exclusion identity changes are observed', async () => {
    await setting('excluded','special-keep');$('#named').classList.add('custom-special-keep');await settle();assert.equal(has('named'),false);
    $('#named').classList.remove('custom-special-keep');await settle();assert.equal(has('named'),true);
    await setting('excluded','');
});
test('DOM: content/context tags protect their descendants', async () => {
    add('<content><div class="status" id="protected-body">正文不能改</div></content><context><div class="status" id="protected-context">场景不能改</div></context>');await settle();
    assert.equal(has('protected-body'),false);assert.equal(has('protected-context'),false);
});
test('DOM: stripped raw tags protect inside while matching clear outside status', async () => {
    const id=w.chatFixture.length;
    w.chatFixture.push({mes:'<content><div class="status">正文里的状态</div></content><div class="status">外部状态:安全</div>'});
    const mes=w.document.createElement('div');mes.className='mes';mes.setAttribute('is_user','false');mes.setAttribute('mesid',id);
    mes.innerHTML='<div class="mes_text"><div class="custom-status" id="raw-inside">正文里的状态</div><div class="custom-status" id="raw-outside">外部状态:安全</div></div>';$('#chat').append(mes);await settle();
    assert.equal(has('raw-inside'),false);assert.equal(has('raw-outside'),true);
});
test('DOM: stripped raw excluded tags remain excluded', async () => {
    const id=w.chatFixture.length;w.chatFixture.push({mes:'<private-panel><div class="status">保留原设计</div></private-panel><div class="status">外部状态:依旧安全</div>'});
    const mes=w.document.createElement('div');mes.className='mes';mes.setAttribute('mesid',id);mes.setAttribute('is_user','false');
    mes.innerHTML='<div class="mes_text"><div class="status" id="raw-excluded">保留原设计</div><div class="status" id="raw-safe">外部状态:依旧安全</div></div>';$('#chat').append(mes);
    await setting('excluded','private-panel');assert.equal(has('raw-excluded'),false);assert.equal(has('raw-safe'),true);
});
test('DOM: content field/class is not confused with a content body tag', async () => {
    add('<div class="status" id="field-test"><span class="content">状态数据</span></div>');await settle();assert.equal(has('field-test'),true);
});
test('DOM: visible complete status markers are hidden, preserved and reversibly restored', async () => {
    const p=w.document.createElement('p');p.id='literal';p.textContent='<state_bar>心情：平静\n地点：窗边</state_bar>';$('.mes_text').append(p);await settle();
    assert.equal(has('literal'),true);assert.equal(p.querySelectorAll('[data-kms-marker][hidden]').length,2);
    assert.equal(p.textContent,'<state_bar>心情：平静\n地点：窗边</state_bar>');
    await setting('excluded','state_bar');assert.equal(has('literal'),false);assert.equal(p.querySelectorAll('[data-kms-marker]').length,0);
    await setting('excluded','');assert.equal(has('literal'),true);
});
test('DOM: incomplete, mixed and code markers are not converted', async () => {
    add('<p id="partial">&lt;status&gt;未完成</p><p id="mixed">正文 &lt;status&gt;状态&lt;/status&gt;</p><p id="fake-marker">&lt;status&gt;数据<span data-kms-marker="">&lt;/status&gt;</span></p>');await settle();
    for(const id of ['partial','mixed','fake-marker'])assert.equal(has(id),false,id);
    assert.equal($('#fake-marker span').getAttribute('data-kms-marker'),'');
});
test('DOM: hidden roots and hidden descendants are never made visible', async () => {
    add('<div class="status" id="hidden-root" style="display:none">隐藏内容</div><div class="status" id="hidden-parent"><table id="hidden-table" hidden><tr><td>秘密</td></tr></table></div><div class="status" id="aria-root" aria-hidden="true">隐藏内容</div>');await settle();
    for(const id of ['hidden-root','hidden-parent','aria-root'])assert.equal(has(id),false,id);
    assert.equal(w.getComputedStyle($('#hidden-table')).display,'none');
    $('#named').hidden=true;await settle();assert.equal(has('named'),false);assert.equal(w.getComputedStyle($('#named')).display,'none');
    $('#named').hidden=false;await settle();assert.equal(has('named'),true);
});
test('DOM: explicit ignore descendants prevent parent/deep recolor', async () => {
    add('<div class="status" id="ignore-parent"><section data-kms-ignore><h2>原设计</h2></section></div>');await setting('deep',true);
    assert.equal(has('ignore-parent'),false);await setting('deep',false);
});
test('DOM: new templates keep exclusions, body and hidden protections intact', async () => {
    await setting('excluded','status-bar');
    for (const template of ['slate','paper']) {
        await setting('template',template);
        for(const id of ['named','protected-body','protected-context','raw-inside','hidden-root','hidden-parent','aria-root','ignore-parent'])assert.equal(has(id),false,id);
        assert.equal(w.getComputedStyle($('#hidden-table')).display,'none');
    }
    await setting('template','classic');await setting('excluded','');
});
test('DOM: streamed new nodes and edit/swipe replacement', async () => {
    add('<div class="custom-state_bar" id="stream">新的状态</div>');await settle();assert.equal(has('stream'),true);
    $('#stream').outerHTML='<p id="after-edit">新的正文</p>';w.emitFixture('updated');await settle();assert.equal(has('after-edit'),false);
});
test('DOM: disable reverses classes and markers; enabling detects again', async () => {
    await setting('enabled',false);assert.equal(w.document.querySelectorAll('#chat .kms-card').length,0);assert.equal($('#literal').querySelectorAll('[data-kms-marker]').length,0);
    assert.equal($('#fake-marker span').getAttribute('data-kms-marker'),'');
    await setting('enabled',true);assert.equal(has('named'),true);assert.equal(has('literal'),true);
});
test('DOM: history unchanged, host disable cleans up and does not restart', async () => {
    assert.equal(JSON.stringify(w.chatFixture.slice(0,2)),originalChat);
    plugin.onDisable();await settle();assert.equal(w.document.querySelectorAll('.kms-card').length,0);assert.equal($('#kongming-status-settings'),null);
    w.emitFixture('updated');await settle();assert.equal(w.document.querySelectorAll('.kms-card').length,0);
    assert.equal($('#literal').querySelectorAll('[data-kms-marker]').length,0);
    assert.equal($('#fake-marker span').getAttribute('data-kms-marker'),'');
    dom.window.close();
});
