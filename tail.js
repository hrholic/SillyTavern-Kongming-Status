import { comparableText, excludedNames, protectedSource, sourceAllows, isSafeStatusNode, hiddenSourceTag } from './core.js?v=0.3.2';

const BODY = new Set(['content','context']);
const VOID = new Set(['br','hr','img','input','meta','link','source','area','base','col','embed','param','track','wbr']);
const DENIED = /(?:thinking|think|reasoning|analysis|scratchpad|preprint|ecot|chain.?of.?thought|^cot$|hidden|secret|instruction|prompt|system|update.?variable|variable|tableedit|jsonpatch|command|script|style|^head$|^code$|^pre$|memory|meow_fm|branches|choices|options|forum|^snow$|^ccd$|disclaimer|finish|思考|思维|推理|分析|隐藏|秘密|指令|提示|控制|变量|摘要|总结|分支|选项|剧场|论坛|文风|规范|格式要求)/i;
const STATUS_NAME = /(?:status|state[_-]?bar|stats|状态|人物信息|角色信息|属性面板)/i;
const FIELD_HINT = /(?:时间|日期|地点|位置|场景|环境|天气|心情|状态|体力|生命|精力|好感|关系|穿着|衣着|服装|动作|姿势|物品|背包|金钱|余额|任务|等级|能力|time|date|location|place|weather|mood|health|energy|hp|mp|inventory|money|level|relation)/i;

function maskExamples(raw) {
    let fence = null;
    return (raw.match(/[^\n]*\n|[^\n]+$/g)||[]).map(line => {
        const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (fence) {
            const masked = ' '.repeat(line.length);
            if (match && match[1][0] === fence[0] && match[1].length >= fence.length && line.trim() === match[1]) fence = null;
            return masked;
        }
        if (match) { fence = match[1]; return ' '.repeat(line.length); }
        // Indentation inside HTML is not necessarily Markdown code. Final DOM safety
        // rejects pre/code and their ancestors; never turn displayed code into a panel.
        return line.replace(/`[^`\n]*`/g, match => ' '.repeat(match.length));
    }).join('').replace(/<!--[\s\S]*?-->/g, match => ' '.repeat(match.length));
}

function tagTree(raw) {
    const source = maskExamples(raw);
    const stack = [], nodes = [];
    const tags = /<(\/?)([\p{L}_][\p{L}\p{N}_.:-]*)(?:\s+(?:"[^"]*"|'[^']*'|[^'"<>])*)?\s*\/?>/gu;
    for (const match of source.matchAll(tags)) {
        const name = match[2].toLowerCase();
        if (VOID.has(name) || /\/\s*>$/.test(match[0])) continue;
        if (!match[1]) {
            const node = { name, start:match.index, openEnd:match.index+match[0].length, parent:stack.at(-1), valid:true, hidden:hiddenSourceTag(match[0]) };
            nodes.push(node); stack.push(node);
        } else {
            const node = stack.at(-1);
            if (!node || node.name !== name) { for (const open of stack) open.valid=false; continue; }
            stack.pop(); node.closeStart=match.index; node.end=match.index+match[0].length;
        }
    }
    return { source, nodes };
}

function structuredFields(body) {
    if (/<(?:script|style|pre|code)\b/i.test(body)
        || /\{\{\s*(?:setvar|incvar|decvar|addvar|deletevar|run|execute)\b/i.test(body)
        || /^\s*(?:\{|\[\s*[{\"]|const\s|let\s|function\s)/m.test(body)) return false;
    const plain = body.replace(/<br\s*\/?>|<\/(?:p|div|li|tr|dt|dd)>/gi,'\n').replace(/<[^>]*>/g,'')
        .replace(/\*\*|__/g,'');
    const keys = new Set();
    for (const line of plain.split(/[\n|｜]/)) {
        const field=line.trim().replace(/^[-*•\s]+/,'').replace(/^[【\[]([^】\]]+)[】\]]\s*[:：=]?\s*/, '$1：');
        const match = field.match(/^([^:：=\n]{1,24})\s*[:：=]\s*(\S[\s\S]{0,300})$/);
        if (match && !/[。！？.!?]/.test(match[1])) keys.add(match[1].trim());
    }
    if (keys.size >= 3 || (keys.size >= 2 && [...keys].some(key=>FIELD_HINT.test(key)))) return true;
    // XML-like field tags preserve structure without imposing status container names.
    const tagged=[...body.matchAll(/<([\p{L}_][\p{L}\p{N}_-]*)[^<>]*>([^<>]{1,300})<\/\1>/gu)];
    if(tagged.length>=2 && tagged.filter(match=>FIELD_HINT.test(match[1])).length>=2)return true;
    // Real HTML or Markdown tables/dl are structural evidence, not prose keywords.
    if (/<table\b/i.test(body) && (body.match(/<tr\b/gi)||[]).length>=2 && (body.match(/<t[dh]\b/gi)||[]).length>=4) return true;
    if (/<dl\b/i.test(body) && (body.match(/<dt\b/gi)||[]).length>=2 && (body.match(/<dd\b/gi)||[]).length>=2) return true;
    const tableLines=plain.split('\n').filter(line=>line.includes('|'));
    return tableLines.length>=3 && /\|?\s*:?-{3,}:?\s*\|/.test(plain);
}

/** Formatting-only normalization; labels and values must still match in full. */
export function displayText(value) {
    return comparableText(String(value)
        .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm,'')
        .replace(/^ {0,3}#{1,6}\s+/gm,'')
        .replace(/^\s*(?:[-*+] |\d+[.)] )/gm,''))
        .replace(/[|｜:：=\[\]【】]/g,'');
}
function mappedAllows(text, protection) {
    if(!protection)return true;
    const key=displayText(text);
    return key.length>=4 && (protection.rawOutside||protection.outside).some(part=>displayText(part).includes(key))
        && !(protection.rawInside||protection.inside).some(part=>displayText(part).includes(key));
}

/** Unknown tags need complete source boundaries and structured-state evidence. */
export function extractTailStatuses(raw, exclusionText = '') {
    if (typeof raw !== 'string' || raw.length>500000) return [];
    const {source,nodes}=tagTree(raw);
    const excluded=excludedNames(exclusionText);
    const bodyEnds=nodes.filter(n=>BODY.has(n.name)&&n.valid&&n.end!==undefined).map(n=>n.end);
    const bodyEnd=bodyEnds.length?Math.max(...bodyEnds):-1;
    const allText=displayText(source);
    const possible=[];
    for(const node of nodes) {
        if(!node.valid||node.hidden||node.end===undefined||BODY.has(node.name)||DENIED.test(node.name)||excluded.has(node.name))continue;
        let unsafe=false;
        for(let p=node.parent;p;p=p.parent)if(!p.valid||p.hidden||BODY.has(p.name)||DENIED.test(p.name)||excluded.has(p.name)){unsafe=true;break;}
        if(unsafe || nodes.some(child => child.start > node.start && child.start < node.end && (child.hidden || DENIED.test(child.name) || excluded.has(child.name))))continue;
        const body=source.slice(node.openEnd,node.closeStart);
        const text=comparableText(body),key=displayText(body);
        if(key.length<4||key.length>24000||!structuredFields(body))continue;
        if(bodyEnd>=0 && node.start<bodyEnd)continue;
        if(allText.indexOf(key)!==allText.lastIndexOf(key))continue;
        possible.push({tag:node.name,text,key,body,start:node.start,end:node.end});
    }
    // Without body tags, accept the whole trailing run of structured siblings,
    // rather than only its last item. Any prose after that run still blocks it.
    const positionSafe=possible.filter(block=>{
        if(bodyEnd>=0||STATUS_NAME.test(block.tag))return true;
        let suffix=source.slice(block.end);
        for(const later of possible.filter(x=>x.start>=block.end).sort((a,b)=>b.start-a.start)) {
            const offset=later.start-block.end;
            suffix=suffix.slice(0,offset)+' '.repeat(later.end-later.start)+suffix.slice(later.end-block.end);
        }
        return !suffix.replace(/<\/[\p{L}_][\p{L}\p{N}_.:-]*\s*>/gu,'').trim();
    });
    return positionSafe.filter(block=>!positionSafe.some(parent=>parent!==block&&parent.start<block.start&&parent.end>block.end));
}

/** Broad source boundaries for already-rendered independent panels, not raw rendering. */
export function extractPanelSources(raw, exclusionText='') {
    if(typeof raw!=='string'||raw.length>500000)return [];
    const {source,nodes}=tagTree(raw),names=excludedNames(exclusionText);
    const hasBody=nodes.some(n=>BODY.has(n.name)&&n.valid&&n.end!==undefined);
    const unsafe=n=>!n.valid||n.hidden||names.has(n.name)||/(?:^|[_:-])cot$/.test(n.name)
        || /^(?:head|html|body|tool|tool_call|command|updatevariable|tableedit|jsonpatch)$/i.test(n.name);
    const out=[];
    for(const node of nodes) {
        if(unsafe(node)||node.end===undefined)continue;
        let blocked=false;for(let p=node.parent;p;p=p.parent)if(unsafe(p)){blocked=true;break;}
        if(blocked||nodes.some(n=>n.start>node.start&&n.start<node.end&&unsafe(n)))continue;
        const body=source.slice(node.openEnd,node.closeStart),key=displayText(body);
        if(key.length<4||key.length>60000||(!hasBody&&!structuredFields(body)))continue;
        if(!sourceAllows(comparableText(body),protectedSource(raw,names)))continue;
        out.push({tag:node.name,body,key,sourceText:comparableText(body),start:node.start,end:node.end});
    }
    return out.filter(n=>!out.some(p=>p.start<n.start&&p.end>n.end));
}

function canonical(node) { return displayText(node.textContent||''); }
function visibleMarker(node, tag, closing=false) {
    return (node.textContent||'').trim().toLowerCase()===`<${closing?'/':''}${tag}>`;
}

/** Plans changes to ALREADY VISIBLE nodes. Raw contents are never rendered. */
export function planTailStatuses(root, raw, exclusionText = '', options = {}) {
    const blocks=extractTailStatuses(raw,exclusionText);
    const protection=protectedSource(raw,excludedNames(exclusionText));
    const existing=new Map(),groups=[];
    const all=[...root.querySelectorAll('*')];
    const eligible=all.filter(node=>!node.closest('pre,code,script,style,textarea,input,button,iframe,svg,canvas')
        && isSafeStatusNode(root,node,exclusionText));
    // Nested render wrappers are common. Each member is safety-checked separately.
    const parents=[root,...all.filter(node=>node.childNodes.length>1&&!node.closest('pre,code,script,style,textarea,input,button,iframe,svg,canvas'))].slice(0,160);
    for(const block of blocks) {
        if(!sourceAllows(block.text,protection)||!mappedAllows(block.key,protection))continue;
        const matches=eligible.filter(node=>canonical(node)===block.key);
        const outer=matches.filter(node=>!matches.some(parent=>parent!==node&&parent.contains(node)));
        const evidence={tag:block.tag,sourceText:block.text,reason:'正文后状态结构'};
        if(outer.length===1) {existing.set(outer[0],evidence);continue;}
        if(outer.length>1||options.existingOnly)continue;
        const ranges=[];
        for(const parent of parents) {
            const siblings=[...parent.childNodes];if(siblings.length>200)continue;
            for(let start=0;start<siblings.length;start++) {
                if(!isSafeStatusNode(root,siblings[start],exclusionText)||!canonical(siblings[start]))continue;
                let text='';
                for(let end=start;end<siblings.length;end++) {
                    const node=siblings[end];
                    if(!isSafeStatusNode(root,node,exclusionText))break;
                    text+=canonical(node);
                    if(text.length>block.key.length)break;
                    if(text===block.key) {
                        let a=start,b=end,before=a-1,after=b+1;
                        while(before>=0&&isSafeStatusNode(root,siblings[before],exclusionText)&&!siblings[before].textContent.trim())before--;
                        while(after<siblings.length&&isSafeStatusNode(root,siblings[after],exclusionText)&&!siblings[after].textContent.trim())after++;
                        if(before>=0&&isSafeStatusNode(root,siblings[before],exclusionText)&&visibleMarker(siblings[before],block.tag))a=before;
                        if(after<siblings.length&&isSafeStatusNode(root,siblings[after],exclusionText)&&visibleMarker(siblings[after],block.tag,true))b=after;
                        ranges.push({parent,nodes:siblings.slice(a,b+1),...evidence});break;
                    }
                }
            }
        }
        if(ranges.length===1)groups.push(ranges[0]);
    }
    return {existing,groups};
}
