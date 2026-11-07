/** Independent, read-only adapters for verified rendered module shells.
 * No source HTML is rendered, and no element text (including hidden raw fields) is read.
 */
import { excludedNames } from './core.js?v=0.3.3';

const DENIED = /^(?:content|context|xp_cot|think|thinking|thoughts?|analysis|reasoning|preprint|ecot|cot|scratch_?pad|chain[_-]?of[_-]?thought|internal(?:[_-].*)?|hidden(?:[_-].*)?|system(?:[_-].*)?|instructions?|control|tool(?:[_-].*)?|script|style|pre|code|textarea|与此同时)$/i;
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const unprefix = value => String(value || '').toLowerCase().replace(/^custom-/, '');
const hasClass = (node, value) => [...node.classList].some(token => unprefix(token) === value.toLowerCase());
const hasId = (node, value) => unprefix(node.id) === value.toLowerCase();
const children = (node, predicate) => [...node.querySelectorAll('*')].some(predicate);

const MODULES = [
    { tags: ['top_blueprint'], match: n => hasId(n, 'tb') && hasClass(n, 'tb')
        && children(n, c => hasClass(c, 'tb-heading')) && children(n, c => hasClass(c, 'tb-meta')), hidden: true },
    { tags: ['网文元素'], match: n => hasId(n, 'bp-vision') && hasClass(n, 'bv')
        && children(n, c => hasClass(c, 'bv-head')) && children(n, c => hasClass(c, 'bv-main'))
        && children(n, c => hasClass(c, 'bv-body')), hidden: true },
    { tags: ['成就表', '成就'], pairedTags: true, match: n => n.tagName === 'DIV' && hasClass(n, 'bp-ach') },
    { tags: ['时间线'], match: n => n.tagName === 'DIV' && hasClass(n, 'bp-tl') },
    { tags: ['meow_fm'], match: n => n.tagName === 'DETAILS' && (
        (hasClass(n, 'bpx-log') && hasClass(n.parentElement || n, 'meow-fm-ghost')
            && children(n, c => c.tagName === 'SUMMARY' && hasClass(c, 'bpx-log-sum'))
            && children(n, c => hasClass(c, 'bpx-log-body')))
        || (hasClass(n, 'bp-old-fm') && [...n.children].some(c => c.tagName === 'SUMMARY'))), hidden: true },
    { tags: ['branches'], match: n => (
        (hasId(n, 'post-it-card') && hasClass(n, 'post-it-container')
            && children(n, c => hasClass(c, 'post-it-collapsible')))
        || (hasId(n, 'meowFM-OptionCard') && hasClass(n, 'meowFM-container')
            && children(n, c => hasClass(c, 'card-content'))))
        && children(n, c => hasId(c, 'options-container')), hidden: true },
];

function hiddenSelf(node) {
    try {
        const style = node.ownerDocument.defaultView?.getComputedStyle(node);
        return node.hidden || node.getAttribute('aria-hidden') === 'true'
            || style?.display === 'none' || ['hidden', 'collapse'].includes(style?.visibility) || style?.opacity === '0';
    } catch { return true; }
}
function visible(node) {
    for (let current = node; current; current = current.parentElement) {
        if (hiddenSelf(current)) return false;
        const parent = current.parentElement;
        if (parent?.tagName === 'DETAILS' && !parent.open && current.tagName !== 'SUMMARY') return false;
    }
    return true;
}
function protectedIdentity(node, names) {
    if (node.hasAttribute('data-kms-ignore')) return true;
    const identities = [node.localName, node.id, ...node.classList,
        node.getAttribute('data-role') || '', node.getAttribute('data-type') || ''];
    return identities.some(value => names.has(unprefix(value)) || DENIED.test(unprefix(value)));
}
function safeShell(root, node, names, allowHidden) {
    if (node === root || ['BODY', 'HTML'].includes(node.tagName) || !visible(node)) return false;
    for (let current = node; current; current = current.parentElement) {
        if (protectedIdentity(current, names)) return false;
    }
    for (const child of node.querySelectorAll('*')) {
        if (protectedIdentity(child, names) || (!allowHidden && hiddenSelf(child))) return false;
    }
    return true;
}

function sourceNodes(raw, names) {
    if (typeof raw !== 'string' || raw.length > 500000) return [];
    let fence = null;
    const source = (raw.match(/[^\n]*\n|[^\n]+$/g) || []).map(line => {
        const mark = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (fence) {
            if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && line.trim() === mark[1]) fence = null;
            return ' '.repeat(line.length);
        }
        if (mark) { fence = mark[1]; return ' '.repeat(line.length); }
        if (/^(?: {4}|\t)/.test(line)) return ' '.repeat(line.length);
        return line.replace(/`[^`\n]*`/g, part => ' '.repeat(part.length));
    }).join('').replace(/<!--[\s\S]*?-->/g, part => ' '.repeat(part.length));
    const nodes = [], stack = [];
    const pattern = /<(\/?)([\p{L}_][\p{L}\p{N}_.:-]*)(?:\s+(?:"[^"]*"|'[^']*'|[^'"<>])*)?\s*\/?>/gu;
    for (const match of source.matchAll(pattern)) {
        const name = match[2].toLowerCase();
        if (match[1]) {
            if (stack.at(-1)?.name !== name) { for (const open of stack) open.valid = false; continue; }
            const closed = stack.pop();
            closed.end = match.index + match[0].length;
            closed.paired = true;
            continue;
        }
        const attrs = match[0];
        const protectedAttributes = /\s(?:hidden(?:\s|=|\/?>)|aria-hidden\s*=\s*["']?true\b)|\b(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\.0+)?(?=\s*(?:[;\"']|>|$)))/i.test(attrs);
        const identities = [...attrs.matchAll(/\b(?:class|id|data-role|data-type)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
            .flatMap(attr => (attr[1] ?? attr[2] ?? attr[3] ?? '').split(/\s+/));
        const node = { name, start: match.index, parent: stack.at(-1), valid: true,
            denied: DENIED.test(name) || names.has(name) || protectedAttributes
                || identities.some(value => names.has(unprefix(value)) || DENIED.test(unprefix(value))) };
        nodes.push(node);
        if (!VOID.has(name) && !/\/\s*>$/.test(attrs)) stack.push(node);
        else node.end = match.index + attrs.length;
    }
    return nodes;
}

/** Map existing visible shell -> non-content evidence. Consumers MUST use shell-only CSS. */
export function findBlueprintRoots(root, raw, excluded = '') {
    const found = new Map();
    if (!root?.querySelectorAll || !visible(root)) return found;
    const names = excludedNames(excluded);
    const source = sourceNodes(raw, names);
    const elements = [...root.querySelectorAll('*')];
    for (const module of MODULES) {
        // Only the verified achievement replacement emits one shell for EACH of
        // its two distinct tags. All other repeated-module cases remain ambiguous.
        const blocks = source.filter(node => module.tags.includes(node.name));
        if (module.pairedTags) {
            if (!blocks.length || blocks.length > module.tags.length
                || new Set(blocks.map(block => block.name)).size !== blocks.length) continue;
        } else if (blocks.length !== 1) continue;
        const safeSource = block => {
            if (!block.valid || !block.paired || block.end === undefined || block.denied) return false;
            for (let parent = block.parent; parent; parent = parent.parent) {
                if (parent.denied || !parent.valid || parent.end === undefined) return false;
            }
            return !source.some(node => node.start > block.start && node.start < block.end
                && (node.denied || !node.valid || node.end === undefined));
        };
        if (!blocks.every(safeSource)
            || blocks.some(block => blocks.some(other => other !== block && other.start > block.start && other.start < block.end))) continue;
        const matches = elements.filter(module.match);
        if (matches.length !== blocks.length
            || !matches.every(node => safeShell(root, node, names, module.hidden))
            || matches.some(node => matches.some(other => other !== node && node.contains(other)))) continue;
        // Both arrays retain original source/DOM order; no text or hidden data is read.
        matches.forEach((node, index) => found.set(node, {
            tag: blocks[index].name, reason: '已验证蓝图模块外壳', sourceMapped: true, shellOnly: true,
        }));
    }
    return found;
}
