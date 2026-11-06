import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = fileURLToPath(new URL('..', import.meta.url));
const server = createServer(async (req, res) => {
    try {
        const path = resolve(base, '.' + new URL(req.url, 'http://localhost').pathname);
        if (!path.startsWith(base + '/')) { res.writeHead(403).end(); return; }
        res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(path)] || 'text/plain');
        res.end(await readFile(path));
    } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 1300 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log('PASS', name); }
async function has(id) { return page.locator('#' + id).evaluate(node => node.classList.contains('kms-card')); }
async function settle() { await page.waitForTimeout(80); }
async function setting(key, value) {
    await page.locator(`[data-kms-setting="${key}"]`).evaluate((node, v) => {
        if (node.type === 'checkbox') node.checked = v; else node.value = v;
        node.dispatchEvent(new Event('change', { bubbles: true }));
    }, value); await settle();
}
try {
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixture.html`);
    await page.waitForSelector('#chat .kms-card');
    const originalChat = await page.evaluate(() => JSON.stringify(window.chatFixture));
    await check('visible enabled state survives collapsed settings; switch is accessible', async () => {
        assert.equal(await page.locator('.kms-settings-title').textContent(), '统一状态栏');
        assert.equal(await page.locator('.kms-enable-badge').textContent(), '已启用');
        await page.locator('#kongming-status-settings').evaluate(node => { node.open = false; });
        assert.equal(await page.locator('.kms-enable-badge').isVisible(), true);
        await page.locator('#kongming-status-settings').evaluate(node => { node.open = true; });
        await page.locator('[data-kms-setting="enabled"]').focus();
        await page.keyboard.press('Space'); await settle();
        assert.equal(await page.locator('.kms-enable-badge').textContent(), '已关闭');
        assert.match(await page.locator('.kms-count').textContent(), /已关闭/);
        await page.keyboard.press('Space'); await settle();
        assert.equal(await page.locator('.kms-enable-badge').textContent(), '已启用');
    });
    await check('named container, details, captioned table, nested outer', async () => {
        for (const id of ['named', 'fold', 'status-table', 'nested']) assert.equal(await has(id), true, id);
        assert.equal(await page.locator('#nested .kms-card').count(), 0);
    });
    await check('ordinary prose/details, code, user message, unknown panel and iframe untouched', async () => {
        for (const id of ['ordinary', 'ordinary-details', 'code', 'user-card', 'unusual']) assert.equal(await has(id), false, id);
        assert.equal(await page.locator('#external-frame').evaluate(frame => frame.contentDocument.querySelectorAll('.kms-card').length), 0);
    });
    await check('original button listener and native details behavior survive', async () => {
        await page.click('#original-action'); assert.equal(await page.evaluate(() => window.actionCount), 1);
        await page.click('#fold summary'); assert.equal(await page.locator('#fold').evaluate(node => node.open), true);
    });
    await check('exact Kongming day/night palette', async () => {
        assert.equal(await page.locator('#named').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(244, 241, 236)');
        await setting('theme', 'dark');
        assert.equal(await page.locator('#named').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(23, 25, 29)');
        await setting('theme', 'auto');
    });
    await check('fixed dark/light templates have different surfaces and visible geometry', async () => {
        await setting('template','slate');
        assert.equal(await page.locator('#named').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(20, 28, 34)');
        assert.equal(await page.locator('#named').evaluate(node=>getComputedStyle(node).borderLeftWidth),'3px');
        assert.equal(await page.locator('[data-kms-setting="theme"]').isDisabled(),true);
        await setting('template','paper');
        assert.equal(await page.locator('#named').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(255, 255, 255)');
        assert.equal(await page.locator('#named').evaluate(node=>getComputedStyle(node).borderTopWidth),'3px');
        assert.equal(await page.locator('.kms-preview').evaluate(node=>node.closest('#chat')),null);
        await setting('template','classic');
    });
    await check('custom selector catches unfamiliar wrapper', async () => {
        await setting('selectors', '.bespoke-panel'); assert.equal(await has('unusual'), true);
    });
    await check('invalid selector fails safely without disabling auto detection', async () => {
        await setting('selectors', '['); assert.equal(await has('named'), true);
        assert.match(await page.locator('.kms-error').textContent(), /格式不正确/);
        await setting('selectors', ''); assert.equal(await has('unusual'), false);
    });
    await check('exclusion immediately restores exact class/id target', async () => {
        await setting('excluded', 'status-bar'); assert.equal(await has('named'), false);
        await setting('excluded', 'named'); assert.equal(await has('named'), false);
        await setting('excluded', ''); assert.equal(await has('named'), true);
    });
    await check('excluded descendant also prevents ancestor styling', async () => {
        await page.evaluate(() => document.querySelector('#nested div').classList.add('keep-me'));
        await setting('excluded', 'keep-me'); assert.equal(await has('nested'), false);
        assert.equal(await page.locator('#nested .kms-card').count(), 0);
        await setting('excluded', ''); assert.equal(await has('nested'), true);
    });
    await check('surviving content/context wrappers protect their entire subtree', async () => {
        await page.evaluate(() => {
            const content = document.createElement('content');
            content.innerHTML = '<div class="status" id="body-protected">状态正文</div>';
            document.querySelector('.mes_text').append(content);
            const context = document.createElement('context');
            context.innerHTML = '<div class="status" id="context-protected">场景正文</div>';
            document.querySelector('.mes_text').append(context);
        }); await settle();
        assert.equal(await has('body-protected'), false); assert.equal(await has('context-protected'), false);
    });
    await check('stripped raw content tag still protects inner status; outside panel can match safely', async () => {
        await page.evaluate(() => {
            const index = window.chatFixture.length;
            window.chatFixture.push({mes:'<content><div class="status">正文里的状态证据</div></content><div class="status">外部状态:安全</div>'});
            const mes = document.createElement('div'); mes.className='mes'; mes.setAttribute('is_user','false'); mes.setAttribute('mesid', index);
            mes.innerHTML='<div class="mes_text"><div class="custom-status" id="stripped-inside">正文里的状态证据</div><div class="custom-status" id="stripped-outside">外部状态:安全</div></div>';
            document.querySelector('#chat').append(mes);
        }); await settle();
        assert.equal(await has('stripped-inside'), false); assert.equal(await has('stripped-outside'), true);
    });
    await check('raw excluded tag works after its wrapper was stripped', async () => {
        await page.evaluate(() => {
            const index = window.chatFixture.length;
            window.chatFixture.push({mes:'<special><div class="status">保留原始设计</div></special><div class="status">外部状态:仍可处理</div>'});
            const mes = document.createElement('div'); mes.className='mes'; mes.setAttribute('mesid',index); mes.setAttribute('is_user','false');
            mes.innerHTML='<div class="mes_text"><div id="raw-excluded" class="custom-status">保留原始设计</div><div id="raw-allowed" class="custom-status">外部状态:仍可处理</div></div>';document.querySelector('#chat').append(mes);
        }); await setting('excluded', 'special');
        assert.equal(await has('raw-excluded'), false); assert.equal(await has('raw-allowed'), true);
    });
    await check('content field/class inside status is not a raw body tag', async () => {
        await page.evaluate(() => { const el=document.createElement('div');el.className='status';el.id='content-field';el.innerHTML='<span class="content">状态字段内容</span>';document.querySelector('.mes_text').append(el); });
        await settle(); assert.equal(await has('content-field'), true);
    });
    await check('streaming content and appended messages are discovered', async () => {
        await page.evaluate(() => { const el=document.createElement('div');el.className='custom-state_bar';el.id='streamed';el.textContent='新增状态';document.querySelector('.mes_text').append(el); });
        await settle(); assert.equal(await has('streamed'), true);
    });
    await check('edit/swipe replacement removes stale DOM decoration', async () => {
        await page.evaluate(() => {document.getElementById('streamed').outerHTML='<p id="after-edit">编辑后是正文</p>';window.emitFixture('updated');});
        await settle(); assert.equal(await has('after-edit'), false);
    });
    await check('deep recolor is opt-in and reversible', async () => {
        await setting('deep', true); assert.equal(await page.locator('#named').evaluate(n=>n.classList.contains('kms-deep')), true);
        await setting('deep', false); assert.equal(await page.locator('#named').evaluate(n=>n.classList.contains('kms-deep')), false);
    });
    await check('disable restores DOM and re-enable redetects', async () => {
        await setting('enabled', false); assert.equal(await page.locator('#chat .kms-card').count(), 0);
        await setting('enabled', true); assert.equal(await has('named'), true);
    });
    await check('original chat contents not changed by styling or settings', async () => {
        assert.equal(await page.evaluate(() => JSON.stringify(window.chatFixture.slice(0,2))), originalChat);
    });
    await mkdir(resolve(base,'test-results'),{recursive:true});
    await page.screenshot({path:resolve(base,'test-results/desktop-light.png'),fullPage:true});
    await setting('theme','dark');
    await page.screenshot({path:resolve(base,'test-results/desktop-dark.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await setting('theme','light');
    await check('390px mobile does not overflow horizontally', async () => {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    });
    await page.screenshot({path:resolve(base,'test-results/mobile-light.png'),fullPage:true});
    for (const template of ['slate','paper']) {
        await setting('template',template);
        await check(`390px ${template} template has no horizontal overflow`, async () => {
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        });
        await page.screenshot({path:resolve(base,`test-results/mobile-${template}.png`),fullPage:true});
    }
    await check('host disable hook removes classes/listeners and does not restart', async () => {
        await page.evaluate(async () => (await import('../index.js')).onDisable()); await settle();
        assert.equal(await page.locator('.kms-card').count(), 0);
        assert.equal(await page.locator('#kongming-status-settings').count(), 0);
        await page.evaluate(() => window.emitFixture('updated')); await settle();
        assert.equal(await page.locator('.kms-card').count(), 0);
    });
    assert.deepEqual(errors, []);
    console.log(`PASS ${checks} browser checks; no uncaught browser errors.`);
} finally { await browser.close(); server.close(); }
