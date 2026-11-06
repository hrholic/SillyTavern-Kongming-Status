/** Same-origin Tavern Helper message frames only. Never changes frame content or sources. */
import { findStatusRoots, excludedNames, protectedSource, sourceAllows } from './core.js?v=0.3.0';

const MARK = 'kms-frame-shell';
const PROTECTED = 'content context think thinking thought thoughts analysis reasoning preprint ecot cot scratchpad scratch_pad chain_of_thought chain-of-thought internal internal_thought internal_thoughts internal_reasoning hidden_thought hidden_thoughts thinking_process reasoning_process system system_prompt instructions instruction control tool tool_call tool_calls function_call';
const OMIT = 'script,style,textarea,input,pre,code,[data-kms-ignore]';

function visible(node) {
    try {
        for (let current = node; current; current = current.parentElement) {
            if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
            const style = current.ownerDocument.defaultView?.getComputedStyle(current);
            if (style && (style.display === 'none' || /hidden|collapse/.test(style.visibility) || style.opacity === '0')) return false;
            if (current.parentElement?.tagName === 'DETAILS' && !current.parentElement.open && current.tagName !== 'SUMMARY') return false;
        }
        return true;
    } catch { return false; }
}

// Do not inspect textContent on a parent with hidden raw-data descendants.
function visibleText(node) {
    let result = '';
    for (const child of node.childNodes) {
        if (child.nodeType === 3) result += child.nodeValue;
        else if (child.nodeType === 1 && !child.matches(OMIT) && visible(child)) result += visibleText(child);
    }
    return result;
}

function blockedIdentity(root, names) {
    function matches(node) {
        if (node.hasAttribute('data-kms-ignore')) return true;
        return [node.localName, node.id, ...node.classList, node.getAttribute('data-role') || '', node.getAttribute('data-type') || '']
            .some(token => names.has(token.toLowerCase()) || (token.toLowerCase().startsWith('custom-') && names.has(token.slice(7).toLowerCase())));
    }
    for (let node = root; node; node = node.parentElement) if (matches(node)) return true;
    return [...root.querySelectorAll('*')].some(matches);
}

function blueprintSourceAllowed(raw, names) {
    if (typeof raw !== 'string') return false;
    // Require exactly one paired marker, outside fenced examples and all protected tags.
    const source = raw.replace(/<!--[\s\S]*?-->/g, match => ' '.repeat(match.length)).replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1|`[^`\n]*`/g, match => ' '.repeat(match.length));
    const tokens = [...source.matchAll(/<\/?top_blueprint\b[^<>]*>/gi)];
    if (tokens.length !== 2 || tokens[0][0].startsWith('</') || !tokens[1][0].startsWith('</') || /\/\s*>$/.test(tokens[0][0])) return false;
    // A unique sentinel lets core's protection parser test position, without interpreting raw HTML.
    let sentinel = 'KMSBLUEPRINTSOURCEBOUNDARY';
    while (source.includes(sentinel)) sentinel += 'X';
    const from = tokens[0].index;
    const to = tokens[1].index + tokens[1][0].length;
    const marked = source.slice(0, from) + sentinel + source.slice(to);
    if (!sourceAllows(sentinel, protectedSource(marked, names))) return false;
    // Protected children also dominate a blueprint wrapper.
    return !protectedSource(source.slice(from, to), names);
}

function css(settings, mode) {
    const template = ['classic', 'slate', 'paper'].includes(settings.template) ? settings.template : 'classic';
    if (template === 'classic') {
        const line = mode === 'dark' ? '#a8c5cc66' : '#465e7366';
        const rule = `linear-gradient(to right,transparent,${line},transparent)`;
        // Two independent one-pixel background rules avoid touching source pseudo-elements,
        // padding, typography, positioning, or any descendant (including hidden fields).
        return `.${MARK}{background-color:transparent!important;background-image:${rule},${rule}!important;background-position:left top,left bottom!important;background-size:100% 1px,100% 1px!important;background-repeat:no-repeat!important;border:0!important;border-radius:0!important;box-shadow:none!important;}`;
    }
    const slate = template === 'slate';
    const background = slate ? '#141c22' : '#ffffff';
    const border = slate ? '#34424d' : '#dce1e6';
    const text = slate ? '#e5eaed' : '#252c34';
    const radius = slate ? '4px' : '2px';
    const accent = slate ? 'border-left:3px solid #a8c5cc!important;' : 'border-top:3px solid #465e73!important;';
    return `.${MARK}{background:${background}!important;color:${text}!important;border:1px solid ${border}!important;border-radius:${radius}!important;padding:14px 16px!important;box-shadow:none!important;${accent}}`;
}

export function createFrameController({ getSettings, getMode = () => 'light', getRawMessage = () => undefined, onChange = () => {} }) {
    const frames = new Map();
    let messages = [];
    let stopped = false;
    let total = 0;
    function publish() {
        const next = [...frames.values()].reduce((sum, state) => sum + state.roots.size, 0);
        if (next !== total) { total = next; onChange(); }
    }
    function clearDocument(state) {
        state.observer?.disconnect();
        state.observer = null;
        for (const root of state.roots) root.classList.remove(MARK);
        state.roots.clear();
        state.style?.remove();
        state.style = null;
        state.document = null;
    }
    function scan(state) {
        if (stopped) return;
        state.observer?.disconnect();
        const settings = getSettings();
        let doc;
        try { doc = state.frame.contentDocument; } catch { doc = null; }
        if (!settings.enabled || !state.frame.isConnected || !visible(state.frame) || !doc?.body || !doc.defaultView) {
            clearDocument(state); publish(); return;
        }
        if (state.document !== doc) clearDocument(state);
        state.document = doc;
        const names = excludedNames(`${PROTECTED} ${settings.excluded || ''}`);
        const raw = getRawMessage(state.message);
        const protection = protectedSource(raw, names);
        const roots = new Set();
        const blueprints = [...doc.body.querySelectorAll('#tb.tb')];
        const found = findStatusRoots(doc.body, settings.selectors || '', `${PROTECTED} ${settings.excluded || ''}`, raw);
        for (const root of found.roots.keys()) {
            if (!blueprints.some(blueprint => blueprint.contains(root) || root.contains(blueprint))
                && visible(root) && !blockedIdentity(root, names) && !blockedIdentity(state.frame, names)
                && sourceAllows(visibleText(root), protection)) roots.add(root);
        }
        if (blueprints.length === 1 && blueprintSourceAllowed(raw, names)) {
            const root = blueprints[0];
            if (visible(root) && root.querySelector('.tb-heading') && root.querySelector('.tb-meta')
                && !blockedIdentity(root, names) && !blockedIdentity(state.frame, names)) roots.add(root);
        }
        for (const root of roots) {
            if ([...roots].some(other => other !== root && other.contains(root))) roots.delete(root);
        }
        for (const root of state.roots) if (!roots.has(root)) root.classList.remove(MARK);
        for (const root of roots) root.classList.add(MARK);
        state.roots = roots;
        if (roots.size) {
            if (!state.style?.isConnected) {
                state.style = doc.createElement('style');
                state.style.setAttribute('data-kms-frame-style', '');
                (doc.head || doc.body).append(state.style);
            }
            const value = css(settings, getMode());
            if (state.style.textContent !== value) state.style.textContent = value;
        } else { state.style?.remove(); state.style = null; }
        state.observer ||= new doc.defaultView.MutationObserver(() => scan(state));
        state.observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
        publish();
    }
    function remove(state) {
        state.frame.removeEventListener('load', state.load);
        clearDocument(state);
        frames.delete(state.frame);
    }
    function sync(nextMessages = messages) {
        if (stopped) return;
        messages = Array.from(nextMessages);
        const wanted = new Map();
        if (getSettings().enabled) for (const message of messages) {
            if (!message.isConnected || !visible(message)) continue;
            for (const frame of message.querySelectorAll('iframe[id^="TH-message--"]')) {
                if (visible(frame)) wanted.set(frame, message);
            }
        }
        for (const state of frames.values()) if (!wanted.has(state.frame)) remove(state);
        for (const [frame, message] of wanted) {
            let state = frames.get(frame);
            if (!state) {
                state = { frame, message, roots: new Set(), document: null, observer: null, style: null };
                state.load = () => { clearDocument(state); scan(state); };
                frames.set(frame, state);
                frame.addEventListener('load', state.load);
            }
            state.message = message;
            scan(state);
        }
        publish();
    }
    return {
        sync,
        refresh: () => sync(messages),
        count: () => total,
        diagnostics: () => ({ frames: frames.size, roots: total }),
        stop() { stopped = true; for (const state of frames.values()) remove(state); messages = []; publish(); },
    };
}
