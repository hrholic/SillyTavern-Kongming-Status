import { DEFAULTS, TEMPLATES, normalizeSettings, normalizeManualRule, findStatusRoots, textColorMeansDark, literalStatus, ownedMarkers, ownedWrappers } from './core.js?v=0.3.3';
import { planTailStatuses } from './tail.js?v=0.3.3';
import { createFrameController } from './frames.js?v=0.3.3';

import { findBlueprintRoots } from './blueprint.js?v=0.3.3';
import { findRenderedPanelRoots } from './panels.js?v=0.3.3';

const KEY = 'kongming_status';
const VERSION = '0.3.3';
let context;
let settings = { ...DEFAULTS };
let started = false;
let observer;
let themeObserver;
let scheduled = 0;
let fullScan = true;
let settingsPanel;
let disabledByHost = false;
let readyTimer = 0;
let readyListener;
let bootObserver;
let bootNotice;
let bootAttempts = 0;
let frameController;
const dirty = new Set();
const decorated = new Set();
const shellDecorated = new Set();
const protectedCounts = new Map();
const listeners = [];

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function getContextSafely() {
    try { return globalThis.SillyTavern?.getContext?.(); }
    catch { return undefined; }
}

function settingsHost() {
    return document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
}

function showBootNotice(message) {
    const host = settingsHost();
    if (!host) return;
    if (!bootNotice?.isConnected) {
        bootNotice = element('section', 'kms-settings kms-boot-notice');
        bootNotice.id = 'kongming-status-boot';
        bootNotice.append(element('strong', '', `统一状态栏 v${VERSION}`));
        const status = element('p', 'kms-boot-status'); status.setAttribute('role', 'status');
        const retry = element('button', 'menu_button', '重新加载插件'); retry.type = 'button';
        retry.addEventListener('click', () => { bootAttempts = 0; queueStart(); });
        bootNotice.append(status, retry); host.append(bootNotice);
    }
    const status = bootNotice.querySelector('.kms-boot-status');
    if (status.textContent !== message) status.textContent = message;
}

function queueStart() {
    if (disabledByHost || started) return;
    clearTimeout(readyTimer);
    readyTimer = setTimeout(start, 0);
}

function waitForHost() {
    if (document.body && !bootObserver) {
        bootObserver = new MutationObserver(() => {
            if (!started && !disabledByHost && settingsHost() && getContextSafely()?.extensionSettings) queueStart();
        });
        bootObserver.observe(document.body, { childList: true, subtree: true });
    }
    showBootNotice(bootAttempts < 80
        ? '插件已加载，正在等待酒馆加载完成。'
        : '插件已加载，但暂未连接到酒馆界面。可以点“重新加载插件”重试。');
    if (bootAttempts++ < 80) readyTimer = setTimeout(start, 250);
}

function messageFor(node) {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    const message = el?.closest?.('.mes_text');
    return message && message.closest('#chat') ? message : null;
}

function eligible(message) {
    const mes = message.closest('.mes');
    return mes && mes.getAttribute('is_user') !== 'true'
        && !mes.querySelector('.mes_edit_textarea');
}

function unstyle(node) {
    node.classList.remove('kms-card', 'kms-deep');
    node.removeAttribute('data-kms-reason');
    for (const marker of node.querySelectorAll('[data-kms-marker]')) {
        if (!ownedMarkers.has(marker)) continue;
        marker.replaceWith(document.createTextNode(marker.textContent));
    }
    decorated.delete(node);
    if (ownedWrappers.has(node)) node.replaceWith(...node.childNodes);
}

function rawMessageFor(message) {
    const idText = message.closest('.mes')?.getAttribute('mesid');
    const id = /^\d+$/.test(idText ?? '') ? Number(idText) : -1;
    const current = getContextSafely() ?? context;
    return Number.isInteger(id) && id >= 0 ? current?.chat?.[id]?.mes : undefined;
}

function hideSourceMarkers(root, tag) {
    if ([...root.querySelectorAll('[data-kms-marker]')].some(node=>ownedMarkers.has(node))) return;
    const walker=document.createTreeWalker(root,4),texts=[];
    let text;while((text=walker.nextNode()))if(text.nodeValue.trim())texts.push(text);
    if(!texts.length)return;
    const escaped=tag.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const first=texts[0],last=texts.at(-1);
    const open=first.nodeValue.match(new RegExp(`^\\s*<${escaped}>`,'i'));
    const close=last.nodeValue.match(new RegExp(`</${escaped}>\\s*$`,'i'));
    if(!open||!close)return;
    function marker(value){const node=element('span','',value);node.hidden=true;node.setAttribute('data-kms-marker','');ownedMarkers.add(node);return node;}
    if(first===last)first.replaceWith(marker(open[0]),document.createTextNode(first.nodeValue.slice(open[0].length,-close[0].length)),marker(close[0]));
    else {
        first.replaceWith(marker(open[0]),document.createTextNode(first.nodeValue.slice(open[0].length)));
        last.replaceWith(document.createTextNode(last.nodeValue.slice(0,-close[0].length)),marker(close[0]));
    }
}

function scan(message) {
    const raw = rawMessageFor(message);
    const shells=settings.enabled&&eligible(message)?new Map([
        ...findRenderedPanelRoots(message,raw,settings.excluded,settings.manualRules),
        ...findBlueprintRoots(message,raw,settings.excluded),
    ]):new Map();
    for(const node of shells.keys())for(let p=node.parentElement;p&&p!==message;p=p.parentElement)if(shells.has(p)){shells.delete(node);break;}
    const plan=settings.enabled&&eligible(message)?planTailStatuses(message,raw,settings.excluded,{manualRules:settings.manualRules}):{existing:new Map(),groups:[]};
    const additional=new Map(),sourceTags=new Map(),created=[];
    for(const [node,item] of plan.existing){additional.set(node,item);sourceTags.set(node,item.tag);}
    for(const group of plan.groups){
        const parent=group.parent||message;
        if(!message.contains(parent)||!group.nodes.length||!group.nodes.every(node=>node.parentNode===parent))continue;
        const wrapper=element('section');wrapper.setAttribute('data-kms-tail-wrapper','');ownedWrappers.add(wrapper);
        group.nodes[0].before(wrapper);wrapper.append(...group.nodes);created.push(wrapper);
        additional.set(wrapper,group);sourceTags.set(wrapper,group.tag);
    }
    const { roots, protectedCount = 0 } = settings.enabled && eligible(message)
        ? findStatusRoots(message, settings.selectors, settings.excluded, raw, additional) : { roots: new Map() };
    for(const node of roots.keys())if([...shells.keys()].some(shell=>shell.contains(node)||node.contains(shell)))roots.delete(node);
    for(const node of shellDecorated)if(!node.isConnected||(message.contains(node)&&!shells.has(node))){
        node.classList.remove('kms-shell');node.removeAttribute('data-kms-shell-reason');shellDecorated.delete(node);
    }
    for(const [node,evidence] of shells){node.classList.add('kms-shell');node.setAttribute('data-kms-shell-reason',evidence.reason);shellDecorated.add(node);}
    for(const wrapper of created)if(!roots.has(wrapper))wrapper.replaceWith(...wrapper.childNodes);
    protectedCounts.set(message, protectedCount);
    for (const node of decorated) {
        if (!node.isConnected || (message.contains(node) && !roots.has(node))) unstyle(node);
    }
    for (const [node, reason] of roots) {
        node.classList.add('kms-card');
        node.classList.toggle('kms-deep', settings.deep);
        node.setAttribute('data-kms-reason', reason);
        if(sourceTags.has(node))hideSourceMarkers(node,sourceTags.get(node));
        if (reason === '可见标签' && !node.querySelector('[data-kms-marker]')) {
            const literal = literalStatus(node);
            if (literal) {
                const open = element('span', '', literal.opening);
                const close = element('span', '', literal.closing);
                open.hidden = close.hidden = true;
                open.setAttribute('data-kms-marker', ''); close.setAttribute('data-kms-marker', '');
                ownedMarkers.add(open); ownedMarkers.add(close);
                node.replaceChildren(open, document.createTextNode(literal.body), close);
            }
        }
        decorated.add(node);
    }
}

function mode() {
    if (TEMPLATES[settings.template].mode) return TEMPLATES[settings.template].mode;
    if (settings.theme !== 'auto') return settings.theme;
    const style = getComputedStyle(document.body);
    const smart = style.getPropertyValue('--SmartThemeBodyColor').trim();
    const dark = textColorMeansDark(smart) ?? textColorMeansDark(style.color);
    return (dark ?? matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

function applyTheme() {
    const chat = document.getElementById('chat');
    const resolvedMode = mode();
    for (const target of [chat, settingsPanel?.querySelector('.kms-preview')]) {
        if (!target) continue;
        target.setAttribute('data-kms-mode', resolvedMode);
        target.setAttribute('data-kms-template', settings.template);
    }
}

function refreshControls() {
    if (!settingsPanel) return;
    settingsPanel.setAttribute('data-kms-enabled', String(settings.enabled));
    const badge = settingsPanel.querySelector('.kms-enable-badge');
    if (badge) badge.textContent = settings.enabled ? '已启用' : '已关闭';
    const input = settingsPanel.querySelector('[data-kms-setting="enabled"]');
    if (input) { input.checked = settings.enabled; input.setAttribute('aria-checked', String(settings.enabled)); }
    const switchWord = settingsPanel.querySelector('.kms-switch-word');
    if (switchWord) switchWord.textContent = settings.enabled ? '开' : '关';
    const count = settingsPanel.querySelector('.kms-count');
    if (count && !count.textContent) count.textContent = settings.enabled ? '已启用，正在识别当前聊天。' : '已关闭，保留原有显示。';
    const template = TEMPLATES[settings.template];
    const theme = settingsPanel.querySelector('[data-kms-setting="theme"]');
    if (theme) theme.disabled = Boolean(template.mode);
    const themeNote = settingsPanel.querySelector('.kms-theme-note');
    if (themeNote) themeNote.textContent = template.mode
        ? `这个模板固定为${template.mode === 'dark' ? '暗色' : '亮色'}；原有模板的日夜偏好会保留。`
        : '可跟随酒馆，也可固定日间或夜间。';
    const description = settingsPanel.querySelector('.kms-template-description');
    if (description) description.textContent = template.description;
    const previewNote = settingsPanel.querySelector('.kms-preview-note');
    if (previewNote) previewNote.textContent = settings.enabled
        ? (settings.template==='classic' ? '空明章节排版示例 · 实际内容与结构由原状态栏决定' : '样式预览 · 示例内容，不属于聊天记录')
        : '样式预览 · 已关闭，以下样式未应用到聊天';
    for(const node of settingsPanel.querySelectorAll('[data-kms-demo]')) node.hidden = node.dataset.kmsDemo !== (settings.template==='classic'?'classic':'generic');
    applyTheme();
}

function refreshCount() {
    const output = settingsPanel?.querySelector('.kms-count');
    if (!output) return;
    const count = [...decorated].filter(node => node.isConnected).length+[...shellDecorated].filter(node=>node.isConnected).length+(frameController?.count()||0);
    const skipped = [...protectedCounts].filter(([node]) => node.isConnected).reduce((sum, [, n]) => sum + n, 0);
    const text = settings.enabled
        ? `${count ? `已启用，当前已美化 ${count} 个状态栏。` : '已启用，当前未识别到可美化的状态栏。'}${skipped ? `正文保护 / 排除名单保留了 ${skipped} 个候选容器。` : ''}`
        : '已关闭，原有显示已恢复。';
    if (output.textContent !== text) output.textContent = text;
}

function flush() {
    scheduled = 0;
    applyTheme();
    if (fullScan) {
        for (const node of decorated) if (!node.isConnected) unstyle(node);
        for (const node of protectedCounts.keys()) if (!node.isConnected) protectedCounts.delete(node);
        document.querySelectorAll('#chat .mes .mes_text').forEach(scan);
    } else {
        dirty.forEach(message => { if (message.isConnected) scan(message); });
    }
    frameController?.sync([...document.querySelectorAll('#chat .mes .mes_text')].filter(eligible));
    fullScan = false;
    dirty.clear();
    refreshCount();
}

function schedule(all = false) {
    fullScan ||= all;
    if (!scheduled) scheduled = requestAnimationFrame(flush);
}

function save() {
    if (context?.extensionSettings) {
        context.extensionSettings[KEY] = { ...settings };
        context.saveSettingsDebounced?.();
    }
    refreshControls();
    schedule(true);
}

function manualRulesEditor() {
    const section = element('section', 'kms-manual-rules');
    section.setAttribute('aria-label', '手动状态栏标签');
    section.append(element('strong', '', '手动指定状态栏'));
    section.append(element('p', 'kms-help', '填一次开始和结束标签，保存后会用于当前及之后的聊天。每组标签保存一条，不需要写选择器。'));
    const fields = element('div', 'kms-manual-fields');
    function field(label, name, placeholder) {
        const row = element('label', 'kms-field', label), input = element('input', 'text_pole');
        input.type = 'text'; input.maxLength = 100; input.placeholder = placeholder;
        input.dataset.kmsRule = name; input.autocomplete = 'off'; input.spellcheck = false;
        row.append(input); fields.append(row); return input;
    }
    const opening = field('开始标签', 'start', '<my_panel>');
    const closing = field('结束标签', 'end', '</my_panel>');
    const actions = element('div', 'kms-actions');
    const submit = element('button', 'menu_button', '保存规则'); submit.type = 'button'; submit.dataset.kmsRuleAction = 'save';
    const cancel = element('button', 'menu_button', '取消修改'); cancel.type = 'button'; cancel.hidden = true;
    const status = element('p', 'kms-help'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    status.dataset.kmsRuleStatus = '';
    const list = element('ul', 'kms-rule-list');
    let editing = null;
    function reset() { editing = null; opening.value = closing.value = ''; submit.textContent = '保存规则'; cancel.hidden = true; }
    function renderList() {
        list.replaceChildren();
        if (!settings.manualRules.length) list.append(element('li', 'kms-help', '还没有保存规则。'));
        for (const rule of settings.manualRules) {
            const row = element('li', 'kms-rule-row');
            row.append(element('span', 'kms-rule-pair', `${rule.start} … ${rule.end}`));
            const edit = element('button', 'menu_button', '修改'); edit.type = 'button';
            edit.setAttribute('aria-label', `修改 ${rule.start} 规则`);
            edit.addEventListener('click', () => {
                editing = rule.start; opening.value = rule.start; closing.value = rule.end;
                submit.textContent = '保存修改'; cancel.hidden = false; status.textContent = ''; opening.focus();
            });
            const remove = element('button', 'menu_button', '删除'); remove.type = 'button';
            remove.setAttribute('aria-label', `删除 ${rule.start} 规则`);
            remove.addEventListener('click', () => {
                settings.manualRules = settings.manualRules.filter(item => item.start !== rule.start);
                if (editing === rule.start) reset();
                save(); renderList(); status.textContent = '规则已删除。自动识别与不识别名单仍然生效。';
            });
            row.append(edit, remove); list.append(row);
        }
    }
    opening.addEventListener('change', () => {
        const match = opening.value.trim().match(/^<([\p{L}_][\p{L}\p{N}_.:-]*)>$/u);
        if (match && !closing.value.trim()) closing.value = `</${match[1]}>`;
    });
    submit.addEventListener('click', () => {
        const rule = normalizeManualRule({ start: opening.value, end: closing.value });
        if (!rule) {
            status.textContent = '请填同名成对标签，例如 <my_panel> 和 </my_panel>。暂不支持带属性的标签、正则或任意分隔符；正文、思考、隐藏标签不能添加。';
            return;
        }
        if (settings.manualRules.some(item => item.start === rule.start && item.start !== editing)) {
            status.textContent = '这组标签已经保存，可以在下方点“修改”。'; return;
        }
        if (editing === null && settings.manualRules.length >= 50) {
            status.textContent = '最多保存 50 条规则，请先删除不用的规则。'; return;
        }
        settings.manualRules = editing === null ? [...settings.manualRules, rule]
            : settings.manualRules.map(item => item.start === editing ? rule : item);
        reset(); save(); renderList();
        status.textContent = '已保存，正在重新识别当前聊天；之后的聊天会自动沿用。';
    });
    cancel.addEventListener('click', () => { reset(); status.textContent = '已取消修改，保存的规则没有改变。'; });
    actions.append(submit, cancel); section.append(fields, actions, status, list);
    section.append(element('p', 'kms-help', '不识别名单与正文 / 思考 / 隐藏保护始终优先。只美化能对应到已显示内容的区域；复杂正则或 iframe 若已丢失对应关系，仍可能跳过。不会取出原文中的隐藏内容。'));
    renderList(); return section;
}

function buildSettings() {
    const target = settingsHost();
    if (!target || settingsPanel?.isConnected) return;
    settingsPanel = element('details', 'kms-settings');
    settingsPanel.id = 'kongming-status-settings';
    settingsPanel.open = true;
    const heading = element('summary', 'kms-settings-heading');
    const badge = element('span', 'kms-enable-badge'); badge.setAttribute('role', 'status');
    heading.append(element('span', 'kms-settings-title', '统一状态栏'), element('small', 'kms-version', `v${VERSION}`), badge);
    settingsPanel.append(heading);
    const content = element('div', 'kms-settings-body');

    const enableRow = element('label', 'kms-enable-control');
    const enableText = element('span', 'kms-enable-copy');
    enableText.append(element('strong', '', '启用统一美化'), element('small', '', '仅处理助手消息中的已识别状态栏'));
    const enableInput = element('input', 'kms-switch-input');
    enableInput.type = 'checkbox'; enableInput.checked = settings.enabled;
    enableInput.dataset.kmsSetting = 'enabled'; enableInput.setAttribute('role', 'switch');
    enableInput.setAttribute('aria-label', '启用统一美化');
    enableInput.addEventListener('change', () => { settings.enabled = enableInput.checked; save(); });
    const switchTrack = element('span', 'kms-switch-track'); switchTrack.setAttribute('aria-hidden', 'true');
    switchTrack.append(element('span', 'kms-switch-word'));
    enableRow.append(enableText, enableInput, switchTrack); content.append(enableRow);
    const count = element('p', 'kms-count'); count.setAttribute('role', 'status'); count.setAttribute('aria-live', 'polite');
    content.append(count, manualRulesEditor());

    const templateLabel = element('label', 'kms-field', '样式模板');
    const templateSelect = element('select', 'text_pole'); templateSelect.dataset.kmsSetting = 'template';
    for (const [value, item] of Object.entries(TEMPLATES)) {
        const option = element('option', '', item.label); option.value = value; templateSelect.append(option);
    }
    templateSelect.value = settings.template;
    templateSelect.addEventListener('change', () => { settings.template = templateSelect.value; save(); });
    templateLabel.append(templateSelect); content.append(templateLabel, element('p', 'kms-template-description'));

    const preview = element('div', 'kms-preview');
    preview.setAttribute('aria-label', '当前模板的静态样式预览');
    const previewCard = element('section', 'kms-card');
    previewCard.dataset.kmsDemo='generic';
    previewCard.append(element('h4', '', '状态栏预览'));
    const previewFields = element('dl');
    for (const [key, value] of [['地点', '窗边'], ['心情', '平静'], ['体力', '80 / 100']]) {
        previewFields.append(element('dt', '', key), element('dd', '', value));
    }
    previewCard.append(previewFields); preview.append(previewCard);
    const classic = element('section','kms-card kms-classic-demo'); classic.dataset.kmsDemo='classic';
    const strip=element('header','kms-classic-strip');
    strip.append(element('span','kms-classic-label','CHAPTER'),element('span','','开篇示例'),element('span','kms-classic-location','AT 窗边 · WX 晴'));
    const body=element('div','kms-classic-body');
    body.append(element('p','kms-classic-number','CHAPTER 01'),element('h4','kms-classic-title','午后的空白页'),element('p','kms-classic-subtitle','An Unwritten Afternoon'));
    const facts=element('p','kms-classic-facts');facts.append(element('span','kms-classic-key','STATE'),document.createTextNode(' 平静 · 体力 80 / 100'));
    const tags=element('div','kms-classic-tags');tags.append(element('span','kms-classic-tag','#日常'),element('span','kms-classic-tag','#晴朗'));
    const epigraph=element('div','kms-classic-epigraph'),quote=element('p','kms-classic-quote');
    quote.append(element('span','kms-classic-initial','风'),document.createTextNode('轻轻翻过一页，午后仍有留白。'));
    epigraph.append(element('p','kms-classic-caption','A QUIET MOMENT'),quote);body.append(facts,tags,epigraph);classic.append(strip,body);preview.append(classic);
    content.append(preview, element('p', 'kms-preview-note'));

    function checkbox(title, key) {
        const label = element('label', 'checkbox_label');
        const input = element('input'); input.type = 'checkbox'; input.checked = settings[key];
        input.dataset.kmsSetting = key;
        input.addEventListener('change', () => { settings[key] = input.checked; save(); });
        label.append(input, element('span', '', title)); content.append(label);
    }
    const label = element('label', 'kms-field', '原有模板 · 日夜配色');
    const select = element('select', 'text_pole'); select.dataset.kmsSetting = 'theme';
    for (const [value, text] of [['auto', '跟随酒馆'], ['light', '日间'], ['dark', '夜间']]) {
        const option = element('option', '', text); option.value = value; select.append(option);
    }
    select.value = settings.theme;
    select.addEventListener('change', () => { settings.theme = select.value; save(); });
    label.append(select); content.append(label, element('p', 'kms-theme-note'));
    checkbox('深入配色（覆盖内部文字与底色，可能改变原栏配色）', 'deep');
    const custom = element('label', 'kms-field', '高级：额外状态栏选择器（选填）');
    const input = element('input', 'text_pole'); input.type = 'text'; input.maxLength = 1000;
    input.placeholder = '.my-status, #character-panel'; input.value = settings.selectors;
    input.dataset.kmsSetting = 'selectors';
    const error = element('div', 'kms-error'); error.setAttribute('role', 'status');
    input.addEventListener('change', () => {
        settings.selectors = input.value.trim();
        try { document.createElement('div').querySelectorAll(settings.selectors || ':not(*)'); error.textContent = ''; }
        catch { error.textContent = '选择器格式不正确；自动识别仍然有效。'; }
        save();
    });
    custom.append(input); content.append(custom, error);
    const excluded = element('label', 'kms-field', '不识别名单（标签名 / 类名 / ID，逗号或换行分隔）');
    const excludeInput = element('textarea', 'text_pole');
    excludeInput.rows = 3; excludeInput.maxLength = 2000; excludeInput.value = settings.excluded;
    excludeInput.placeholder = 'my-status, special-panel'; excludeInput.dataset.kmsSetting = 'excluded';
    excludeInput.addEventListener('change', () => { settings.excluded = excludeInput.value.trim(); save(); });
    excluded.append(excludeInput); content.append(excluded);
    content.append(element('p', 'kms-help', '排除容器及后代保留原设计；为避免父级样式影响，也不美化包住它的状态栏。content / context 始终保护；原始标签已被剥掉时，只处理能够对应到保护区外的状态栏。'));
    content.append(element('p', 'kms-help', '自动识别已有状态容器，以及正文外完整标签对应的独立面板；只对应已经显示的内容，不从原文取出隐藏信息。支持可读取的酒馆助手消息内状态页，跨域页面与后台脚本页保持原样。'));
    const actions = element('div', 'kms-actions');
    const rescan = element('button', 'menu_button', '重新识别'); rescan.type = 'button';
    rescan.addEventListener('click', () => schedule(true));
    actions.append(rescan);
    content.append(actions); settingsPanel.append(content); target.append(settingsPanel);
    refreshControls();
    refreshCount();
    return true;
}

function onMutations(records) {
    for (const record of records) {
        if (record.type === 'attributes' && record.attributeName === 'class') {
            const clean = value => String(value || '').split(/\s+/).filter(name => name && !['kms-card', 'kms-deep', 'kms-shell'].includes(name)).sort().join(' ');
            if (clean(record.oldValue) === clean(record.target.getAttribute('class'))) continue;
        }
        const message = messageFor(record.target);
        if (message) { dirty.add(message); continue; }
        if (record.type !== 'childList') continue;
        for (const node of [...record.addedNodes, ...record.removedNodes]) {
            if (node.nodeType !== 1) continue;
            if (node.matches('#chat,.mes,.mes_text') || node.querySelector('#chat,.mes,.mes_text')) fullScan = true;
        }
    }
    if (fullScan || dirty.size) schedule();
    if (!settingsPanel?.isConnected && buildSettings()) schedule(true);
}

function start() {
    readyTimer = 0;
    if (disabledByHost || started) return;
    const availableContext = getContextSafely();
    if (!document.body || !settingsHost() || !availableContext?.extensionSettings) {
        waitForHost();
        return;
    }
    context = availableContext;
    settings = normalizeSettings(context?.extensionSettings?.[KEY]);
    frameController=createFrameController({getSettings:()=>settings,getMode:mode,getRawMessage:rawMessageFor,onChange:refreshCount});
    buildSettings();
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, {
        childList: true, subtree: true, characterData: true, attributes: true, attributeOldValue: true,
        attributeFilter: ['class', 'id', 'style', 'hidden', 'aria-hidden', 'data-type', 'data-role', 'data-status', 'data-status-bar', 'data-kms-ignore'],
    });
    themeObserver = new MutationObserver(() => schedule());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
    const events = context?.eventTypes ?? context?.event_types;
    for (const name of ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_UPDATED',
        'MESSAGE_SWIPED', 'CHAT_CHANGED', 'MORE_MESSAGES_LOADED', 'MESSAGE_DELETED']) {
        if (!events?.[name] || !context?.eventSource?.on) continue;
        const handler = () => schedule(true);
        context.eventSource.on(events[name], handler);
        listeners.push([events[name], handler]);
    }
    started = true;
    bootObserver?.disconnect(); bootObserver = null;
    bootNotice?.remove(); bootNotice = null;
    bootAttempts = 0;
    schedule(true);
}

// Also useful for extension development and a clean shutdown before reload.
export function stop() {
    frameController?.stop();frameController=null;
    clearTimeout(readyTimer); readyTimer = 0;
    bootObserver?.disconnect(); bootObserver = null;
    bootNotice?.remove(); bootNotice = null;
    observer?.disconnect(); themeObserver?.disconnect();
    if (scheduled) cancelAnimationFrame(scheduled);
    scheduled = 0;
    for (const [name, handler] of listeners) context?.eventSource?.removeListener?.(name, handler);
    listeners.length = 0;
    for (const node of [...decorated]) unstyle(node);
    for(const node of shellDecorated){node.classList.remove('kms-shell');node.removeAttribute('data-kms-shell-reason');}shellDecorated.clear();
    document.getElementById('chat')?.removeAttribute('data-kms-mode');
    document.getElementById('chat')?.removeAttribute('data-kms-template');
    settingsPanel?.remove(); settingsPanel = null;
    dirty.clear(); fullScan = true; started = false;
    protectedCounts.clear();
}

export function onDisable() {
    disabledByHost = true;
    clearTimeout(readyTimer);
    if (readyListener) initialContext?.eventSource?.removeListener?.(ready, readyListener);
    document.removeEventListener('DOMContentLoaded', queueStart);
    stop();
}

const initialContext = getContextSafely();
const ready = (initialContext?.eventTypes ?? initialContext?.event_types)?.APP_READY;
if (ready && initialContext?.eventSource?.on) {
    readyListener = queueStart;
    initialContext.eventSource.on(ready, readyListener);
}
// APP_READY may already have fired (older ST emitters do not replay it).
// Bootstrap independently, and retry boundedly until the API and settings host exist.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', queueStart, { once: true });
} else {
    queueStart();
}
