import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findBlueprintRoots } from '../blueprint.js';

const signatures = [
    ['网文元素', '<div id="bp-vision" class="bv"><div class="bv-head"></div><div class="bv-main"><div class="bv-body"></div><span aria-hidden="true"></span></div></div>'],
    ['top_blueprint', '<div id="tb" class="tb"><div class="tb-heading"></div><div class="tb-meta"></div><div class="tb-voice" hidden></div><div class="bpx-head" aria-hidden="true"></div></div>'],
    ['成就表', '<div class="bp-ach"></div>'],
    ['时间线', '<div class="bp-tl"></div>'],
    ['meow_FM', '<div class="meow-fm-ghost"><details class="bpx-log"><summary class="bpx-log-sum"></summary><div class="bpx-log-body"></div></details></div>'],
    ['branches', '<div id="post-it-card" class="post-it-container"><div class="bpx-head" aria-hidden="true"></div><div class="post-it-collapsible"><div id="options-container"></div></div></div>'],
];
function withDom(html, run) {
    const dom = new JSDOM(`<main class="mes_text">${html}</main>`, { pretendToBeVisual: true });
    try { run(dom.window.document.querySelector('main'), dom.window.document); } finally { dom.window.close(); }
}

test('verified modules before and after content map shells without reading any node text', () => {
    const html = signatures.map(([, markup]) => markup).join('') + '<div id="bv-raw" class="hidden-data-container" hidden></div><div id="raw-options-data" hidden></div>';
    const raw = '<网文元素>x</网文元素><top_blueprint>x</top_blueprint><content>x</content><成就表>x</成就表><时间线>x</时间线><meow_FM>x</meow_FM><branches>x</branches>';
    withDom(html, (root) => {
        const before = root.innerHTML;
        for (const node of root.querySelectorAll('*')) Object.defineProperty(node, 'textContent', { get() { throw new Error('text read'); } });
        const roots = findBlueprintRoots(root, raw);
        assert.equal(roots.size, 6);
        for (const [node, evidence] of roots) {
            assert.notEqual(node, root); assert.equal(evidence.shellOnly, true);
            assert.equal(evidence.sourceMapped, true);
        }
        assert.equal(root.innerHTML, before);
        assert.equal(root.querySelector('.tb-voice').hidden, true);
    });
});

test('source protection dominates even exact signatures and custom-prefix identities', () => {
    for (const [tag, html] of signatures) withDom(html, root => {
        const block = `<${tag}>x</${tag}>`;
        for (const raw of [`<content>${block}</content>`, `<xp_cot>${block}</xp_cot>`, `<与此同时>${block}</与此同时>`, `<div hidden>${block}</div>`, `<div style="display:none">${block}</div>`, `<${tag}><xp_cot>x</xp_cot></${tag}>`, `${block}${block}`, `<!--${block}-->`, `\`\`\`html\n${block}\n\`\`\``, `<${tag}>x`, `<${tag}/>`]) {
            assert.equal(findBlueprintRoots(root, raw).size, 0, `${tag}: ${raw}`);
        }
        assert.equal(findBlueprintRoots(root, block, tag).size, 0);
    });
    withDom('<div class="custom-bp-ach"></div>', root => {
        assert.equal(findBlueprintRoots(root, '<成就>x</成就>').size, 1);
        assert.equal(findBlueprintRoots(root, '<成就>x</成就>', 'bp-ach').size, 0);
    });
});

test('hidden root, protected ancestor/descendant, duplicates and unrelated cards are skipped', () => {
    const raw = '<top_blueprint>x</top_blueprint>';
    const html = signatures[1][1];
    for (const markup of [`<div hidden>${html}</div>`, `<xp_cot>${html}</xp_cot>`, html + html]) {
        withDom(markup, root => assert.equal(findBlueprintRoots(root, raw).size, 0));
    }
    withDom(html, root => {
        root.querySelector('.tb-meta').classList.add('custom-private');
        assert.equal(findBlueprintRoots(root, raw, 'private').size, 0);
    });
    withDom('<div id="dc" class="card grid"></div><div class="bv"></div>', root => assert.equal(findBlueprintRoots(root, '<网文元素>x</网文元素>').size, 0));
    withDom('<div class="bp-ach"><div hidden></div></div>', root => assert.equal(findBlueprintRoots(root, '<成就>x</成就>').size, 0));
});

test('old summary and floating branches select only verified visible shells', () => {
    withDom('<details class="bp-old-fm"><summary></summary><div></div></details>', root => assert.equal(findBlueprintRoots(root, '<meow_FM>x</meow_FM>').size, 1));
    withDom('<div id="meowFM-Option"><div id="meowFM-OptionOverlay"></div><div id="meowFM-OptionCard" class="meowFM-container"><div class="card-content"><div id="options-container"></div></div></div></div>', root => {
        const roots = findBlueprintRoots(root, '<branches>x</branches>');
        assert.equal(roots.size, 1); assert.equal([...roots.keys()][0].id, 'meowFM-OptionCard');
        root.querySelector('#meowFM-OptionCard').style.display = 'none';
        assert.equal(findBlueprintRoots(root, '<branches>x</branches>').size, 0);
    });
});

test('anonymous seven-module structure pairs distinct achievement tags in source/DOM order', () => {
    const html = signatures.map(([, markup], index) => markup + (index === 2 ? '<div class="custom-bp-ach"></div>' : '')).join('');
    const raw = '<网文元素>x</网文元素><top_blueprint>x</top_blueprint><content>x</content><成就表>x</成就表><成就>x</成就><时间线>x</时间线><meow_FM>x</meow_FM><branches>x</branches>';
    withDom(html, root => {
        for (const node of root.querySelectorAll('*')) Object.defineProperty(node, 'textContent', { get() { throw new Error('text read'); } });
        const roots = findBlueprintRoots(root, raw);
        assert.equal(roots.size, 7);
        assert.equal(roots.get(root.querySelector('.bp-ach')).tag, '成就表');
        assert.equal(roots.get(root.querySelector('.custom-bp-ach')).tag, '成就');
    });
    withDom('<div class="bp-ach"></div><div class="bp-ach"></div>', root => {
        const roots = findBlueprintRoots(root, '<成就>x</成就><成就表>x</成就表>');
        assert.deepEqual([...roots.values()].map(value => value.tag), ['成就', '成就表']);
        for (const raw of ['<成就>x</成就><成就>x</成就>', '<成就>x</成就>', '<成就>x</成就><content><成就表>x</成就表></content>', '<成就>x</成就><成就表><xp_cot>x</xp_cot></成就表>', '<成就表><成就>x</成就></成就表>']) {
            assert.equal(findBlueprintRoots(root, raw).size, 0, raw);
        }
        assert.equal(findBlueprintRoots(root, '<成就>x</成就><成就表>x</成就表>', '成就表').size, 0);
        root.lastElementChild.hidden = true;
        assert.equal(findBlueprintRoots(root, '<成就>x</成就><成就表>x</成就表>').size, 0);
    });
    withDom('<div class="bp-ach"></div>', root => assert.equal(findBlueprintRoots(root, '<成就>x</成就><成就表>x</成就表>').size, 0));
    withDom('<div class="bp-ach"><div class="bp-ach"></div></div>', root => assert.equal(findBlueprintRoots(root, '<成就>x</成就><成就表>x</成就表>').size, 0));
});
