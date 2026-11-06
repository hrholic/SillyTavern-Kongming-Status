/* Independent implementation. Palette reference is documented in README.md. */
export const DEFAULTS = Object.freeze({
    enabled: true,
    theme: 'auto',
    template: 'classic',
    deep: false,
    selectors: '',
    excluded: '',
});
export const TEMPLATES = Object.freeze({
    classic: { label: '原有 · 空明', description: '透明底、渐隐细线与左对齐书卷排版，保留日夜配色。', mode: null },
    slate: { label: '墨夜 · 暗色', description: '炭黑底、细侧线与紧凑标题。', mode: 'dark' },
    paper: { label: '白纸 · 亮色', description: '纯白底、细顶线与清爽留白。', mode: 'light' },
});
// Only nodes created by this module's renderer can be treated as hidden markers.
export const ownedMarkers = new WeakSet();
export const ownedWrappers = new WeakSet();

export const PROTECTED_TAGS = 'think thinking thought thoughts analysis reasoning preprint ecot cot scratchpad scratch_pad chain_of_thought chain-of-thought internal internal_thought internal_thoughts internal_reasoning hidden_thought hidden_thoughts thinking_process reasoning_process system system_prompt instructions instruction control tool tool_call tool_calls function_call'.split(' ');
const TAGS = new Set(['status', 'statusbar', 'status_bar', 'status-panel',
    'status_panel', 'character_status', 'char_status', 'charstatus', 'stats',
    'state_bar', 'state-bar', 'top_blueprint', '状态栏', '状态面板', '角色状态']);
const BLOCKS = new Set(['DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'DETAILS', 'TABLE', 'DL', 'FIELDSET']);
const SKIP = 'pre,code,script,style,textarea,input,button,svg,canvas,iframe,[hidden],[aria-hidden="true"],[data-kms-ignore]';
const TOKEN = /(?:^|[\s_-])(?:status(?:[\s_-]?(?:bar|panel|box|card|sheet|window))?|state[\s_-]bar|charstatus|character[\s_-]?(?:status|stats)|stats)(?:$|[\s_-])/i;
const CJK = /状态栏|状态面板|角色状态|人物状态|角色信息|人物信息|属性面板/;

export function normalizeSettings(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    return {
        enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
        theme: ['auto', 'light', 'dark'].includes(value.theme) ? value.theme : 'auto',
        template: Object.prototype.hasOwnProperty.call(TEMPLATES, value.template) ? value.template : 'classic',
        deep: value.deep === true,
        selectors: typeof value.selectors === 'string' ? value.selectors.slice(0, 1000) : '',
        excluded: typeof value.excluded === 'string' ? value.excluded.slice(0, 2000) : '',
    };
}

export function isStatusLabel(text) {
    const value = String(text || '').replace(/^[\s\p{P}\p{S}]+/u, '')
        .replace(/[\s\p{P}\p{S}]+$/u, '').replace(/\s+/g, ' ').trim();
    if (!value || value.length > 48) return false;
    // Full labels only. Narrative mentions of a status bar do not qualify.
    return /^(?:状态(?:栏|面板)?|角色(?:状态|信息|属性)|人物(?:状态|信息|属性)|属性面板|status(?:[ _-]*(?:bar|panel|sheet))?|(?:character|player)[ _-]*(?:status|stats|sheet)|stats)$/i.test(value)
        || /^(?:当前|实时|本回合)[\s·:：-]*(?:状态|状态栏|状态面板|角色信息)$/.test(value)
        || /^[\p{L}\p{N}· _-]{1,20}的(?:状态栏|状态面板|角色状态|状态)$/u.test(value);
}

function blocked(node, root) {
    if (!root.contains(node) || node === root || node.closest(SKIP)) return true;
    const view = root.ownerDocument.defaultView;
    for (let parent = node; parent && root.contains(parent); parent = parent.parentElement) {
        const style = view?.getComputedStyle(parent);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0')) return true;
    }
    return false;
}

function hiddenSelf(node) {
    if (ownedMarkers.has(node)) return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    return node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true'
        || style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.opacity === '0';
}

/** Strict fallback for visible escaped tags, never for HTML/hidden descendants. */
export function literalStatus(node) {
    if (!['P', 'DIV'].includes(node.tagName)) return null;
    if ([...node.childNodes].some(child => child.nodeType !== 3
        && !(child.nodeType === 1 && ownedMarkers.has(child)))) return null;
    const text = node.textContent;
    const match = text.match(/^(\s*<([\p{L}_][\p{L}\p{N}_.:-]*)>)([\s\S]+?)(<\/\2>\s*)$/iu);
    return match && TAGS.has(match[2].toLowerCase())
        ? { tag: match[2].toLowerCase(), opening: match[1], body: match[3], closing: match[4] } : null;
}

export function excludedNames(text = '') {
    return new Set(['content', 'context', ...PROTECTED_TAGS, ...String(text).split(/[,，;；\s]+/)
        .map(value => value.replace(/^[<\/.#]+|[>]+$/g, '').toLowerCase())
        .filter(value => /^[\p{L}\p{N}_:.-]+$/u.test(value))]);
}

function hasProtectedIdentity(node, names, explicitNames) {
    if (names.has(node.localName.toLowerCase())) return true;
    const tokens = [node.localName, node.id, ...node.classList,
        node.getAttribute('data-type') || '', node.getAttribute('data-role') || ''];
    return tokens.some(token => explicitNames.has(token.toLowerCase())
        || (token.startsWith('custom-') && explicitNames.has(token.slice(7).toLowerCase())));
}

/** Shared display-safety gate for source-mapped tail blocks. No raw text is rendered. */
export function isSafeStatusNode(root, node, exclusionText = '') {
    if (node.nodeType === 3) {
        const parent = node.parentElement;
        if (!parent || !root.contains(node) || parent.closest(SKIP)) return false;
        if (parent !== root) return isSafeStatusNode(root, parent, exclusionText);
        const style = root.ownerDocument.defaultView?.getComputedStyle(root);
        return !style || (style.display !== 'none' && !['hidden','collapse'].includes(style.visibility) && style.opacity !== '0');
    }
    if (node.nodeType !== 1 || blocked(node, root)) return false;
    const names = excludedNames(exclusionText);
    const explicitNames = new Set(names);
    if (!/(?:^|[,，;；\s])(?:[<\/.#]*)content(?:>|[,，;；\s]|$)/i.test(exclusionText)) explicitNames.delete('content');
    if (!/(?:^|[,，;；\s])(?:[<\/.#]*)context(?:>|[,，;；\s]|$)/i.test(exclusionText)) explicitNames.delete('context');
    for (let parent = node; parent && root.contains(parent); parent = parent.parentElement) {
        if (parent.hasAttribute('data-kms-ignore') || hasProtectedIdentity(parent, names, explicitNames)) return false;
    }
    if (node.querySelector('pre,code,script,style,textarea,input,iframe,svg,canvas')) return false;
    return ![...node.querySelectorAll('*')].some(child =>
        child.hasAttribute('data-kms-ignore') || hasProtectedIdentity(child, names, explicitNames) || hiddenSelf(child));
}

export function comparableText(value) {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return String(value).replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]*>/g, '')
        .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, name) => {
            if (name[0] !== '#') return named[name.toLowerCase()] || all;
            const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
        })
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[\s*_`~]/g, '').replace(/：/g, ':');
}

/** Read-only mapping aid. Unclosed protection tags protect the remainder. */
export function protectedSource(raw, names) {
    if (typeof raw !== 'string') return null;
    // Code examples are not instructions to style or protect other content.
    const source = raw.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1|`[^`\n]*`/g,
        match => ' '.repeat(match.length));
    const re = /<\/?([\p{L}_][\p{L}\p{N}_.:-]*)(?:\s[^<>]*?)?\s*\/?>/gu;
    const stack = [];
    const intervals = [];
    let begin = 0;
    for (const match of source.matchAll(re)) {
        const name = match[1].toLowerCase();
        if (!names.has(name) || /\/\s*>$/.test(match[0])) continue;
        if (!match[0].startsWith('</')) {
            if (!stack.length) begin = match.index;
            stack.push(name);
        } else if (stack.length && stack.at(-1) === name) {
            stack.pop();
            if (!stack.length) intervals.push([begin, match.index + match[0].length]);
        }
    }
    if (stack.length) intervals.push([begin, source.length]);
    if (!intervals.length) return null;
    const outside = [], inside = [];
    let last = 0;
    for (const [from, to] of intervals) {
        outside.push(comparableText(source.slice(last, from)));
        inside.push(comparableText(source.slice(from, to)));
        last = to;
    }
    outside.push(comparableText(source.slice(last)));
    return { outside, inside };
}

export function sourceAllows(text, protection) {
    if (!protection) return true;
    const normalized = comparableText(text);
    return normalized.length >= 4
        && protection.outside.some(part => part.includes(normalized))
        && !protection.inside.some(part => part.includes(normalized));
}

function automaticReason(node) {
    if (literalStatus(node)) return '可见标签';
    if (TAGS.has(node.localName.toLowerCase())) return '标签';
    if (!BLOCKS.has(node.tagName)) return null;
    const identity = [node.id, node.getAttribute('class') || '',
        node.getAttribute('data-type') || '', node.getAttribute('data-role') || ''].join(' ');
    if (TOKEN.test(identity) || CJK.test(identity)) return '容器名称';
    if (node.hasAttribute('data-status') || node.hasAttribute('data-status-bar')) return '状态标记';
    if (node.tagName === 'DETAILS') {
        const summary = Array.from(node.children).find(child => child.tagName === 'SUMMARY');
        if (summary && isStatusLabel(summary.textContent)) return '折叠栏标题';
    }
    if (node.tagName === 'FIELDSET') {
        const legend = Array.from(node.children).find(child => child.tagName === 'LEGEND');
        if (legend && isStatusLabel(legend.textContent)) return '分组标题';
    }
    if (node.tagName === 'TABLE') {
        if (node.caption && isStatusLabel(node.caption.textContent)) return '表格标题';
        const before = node.previousElementSibling;
        if (before && /^(H[1-6]|P|STRONG|B)$/.test(before.tagName)
            && isStatusLabel(before.textContent)) return '相邻标题';
    }
    return null;
}

/** Returns only existing DOM elements. Never interprets text as HTML. */
export function findStatusRoots(root, customSelectors = '', exclusionText = '', rawMessage, additional = new Map()) {
    const found = new Map();
    const names = excludedNames(exclusionText);
    const explicitNames = excludedNames(exclusionText);
    if (!/(?:^|[,，;；\s])(?:[<\/.#]*)content(?:>|[,，;；\s]|$)/i.test(exclusionText)) explicitNames.delete('content');
    if (!/(?:^|[,，;；\s])(?:[<\/.#]*)context(?:>|[,，;；\s]|$)/i.test(exclusionText)) explicitNames.delete('context');
    const sourceProtection = protectedSource(rawMessage, names);
    const all = [...root.querySelectorAll('*')];
    const protectedNodes = all.filter(node => node.hasAttribute('data-kms-ignore') || hasProtectedIdentity(node, names, explicitNames));
    const hiddenNodes = all.filter(hiddenSelf);
    let protectedCount = 0;
    function allowed(node) {
        if (node.querySelector('pre,code,script,style,textarea,input,iframe,svg,canvas')
            || names.has(literalStatus(node)?.tag)
            || protectedNodes.some(protectedNode => protectedNode.contains(node) || node.contains(protectedNode))
            || hiddenNodes.some(hiddenNode => node.contains(hiddenNode))
            || !sourceAllows(node.textContent, sourceProtection)) {
            protectedCount++;
            return false;
        }
        return true;
    }
    for (const node of all) {
        if (blocked(node, root)) continue;
        const reason = automaticReason(node);
        if (reason && allowed(node)) found.set(node, reason);
    }
    let selectorError = '';
    if (customSelectors.trim()) {
        try {
            for (const node of root.querySelectorAll(customSelectors)) {
                if (!blocked(node, root) && allowed(node) && (BLOCKS.has(node.tagName) || TAGS.has(node.localName.toLowerCase()))) {
                    found.set(node, '自定义选择器');
                }
            }
        } catch { selectorError = '选择器格式不正确；自动识别仍然有效。'; }
    }
    for (const [node, reason] of additional) {
        if (!blocked(node, root) && allowed(node)) found.set(node, reason);
    }
    // One outer card, not a card for every nested status row/value.
    for (const node of found.keys()) {
        let parent = node.parentElement;
        while (parent && parent !== root) {
            if (found.has(parent)) { found.delete(node); break; }
            parent = parent.parentElement;
        }
    }
    return { roots: found, selectorError, protectedCount };
}

export function textColorMeansDark(color) {
    const match = String(color || '').match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (!match) return null;
    return (0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3])) / 255 > 0.5;
}
