import { comparableText, excludedNames, protectedSource, sourceAllows, isSafeStatusNode } from './core.js?v=0.3.0';

const BODY = new Set(['content','context']);
const VOID = new Set(['br','hr','img','input','meta','link','source','area','base','col','embed','param','track','wbr']);
const DENIED = /(?:thinking|think|reasoning|analysis|scratchpad|preprint|ecot|chain.?of.?thought|^cot$|hidden|secret|instruction|prompt|system|update.?variable|variable|tableedit|jsonpatch|command|script|style|^head$|^code$|^pre$|summary|memory|meow_fm|branches|choices|options|forum|^snow$|^ccd$|disclaimer|finish|思考|思维|推理|分析|隐藏|秘密|指令|提示|控制|变量|摘要|总结|分支|选项|剧场|论坛|文风|规范|格式要求)/i;
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
        if (/^(?: {4}|\t)/.test(line)) return ' '.repeat(line.length);
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
            const node = { name, start:match.index, openEnd:match.index+match[0].length, parent:stack.at(-1), valid:true };
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
        || /^\s*(?:\{|\[|const\s|let\s|function\s)/m.test(body)) return false;
    const plain = body.replace(/<br\s*\/?>|<\/(?:p|div|li|tr|dt|dd)>/gi,'\n').replace(/<[^>]*>/g,'')
        .replace(/\*\*|__/g,'');
    const keys = new Set();
    for (const line of plain.split(/[\n|｜]/)) {
        const match = line.trim().replace(/^[-*•\s]+/,'').match(/^([^:：\n]{1,24})\s*[:：]\s*(\S[\s\S]{0,300})$/);
        if (match && !/[。！？.!?]/.test(match[1])) keys.add(match[1].trim());
    }
    if (keys.size >= 3 || (keys.size >= 2 && [...keys].some(key=>FIELD_HINT.test(key)))) return true;
    // Real HTML or Markdown tables/dl are structural evidence, not prose keywords.
    if (/<table\b/i.test(body) && (body.match(/<tr\b/gi)||[]).length>=2 && (body.match(/<t[dh]\b/gi)||[]).length>=4) return true;
    if (/<dl\b/i.test(body) && (body.match(/<dt\b/gi)||[]).length>=2 && (body.match(/<dd\b/gi)||[]).length>=2) return true;
    const tableLines=plain.split('\n').filter(line=>line.includes('|'));
    return tableLines.length>=3 && /\|?\s*:?-{3,}:?\s*\|/.test(plain);
}

/** Unknown tag names are accepted only with tail position + structured-state evidence. */
export function extractTailStatuses(raw, exclusionText = '') {
    if (typeof raw !== 'string' || raw.length>500000) return [];
    const {source,nodes}=tagTree(raw);
    const excluded=excludedNames(exclusionText);
    const bodyEnds=nodes.filter(n=>BODY.has(n.name)&&n.valid&&n.end!==undefined).map(n=>n.end);
    const bodyEnd=bodyEnds.length?Math.max(...bodyEnds):-1;
    const allText=comparableText(source);
    const possible=[];
    for(const node of nodes) {
        if(!node.valid||node.end===undefined||BODY.has(node.name)||DENIED.test(node.name)||excluded.has(node.name))continue;
        let unsafe=false;
        for(let p=node.parent;p;p=p.parent)if(!p.valid||BODY.has(p.name)||DENIED.test(p.name)||excluded.has(p.name)){unsafe=true;break;}
        if(unsafe || nodes.some(child => child.start > node.start && child.start < node.end && (DENIED.test(child.name) || excluded.has(child.name))))continue;
        const body=source.slice(node.openEnd,node.closeStart);
        const text=comparableText(body);
        if(text.length<6||text.length>24000)continue;
        const known=STATUS_NAME.test(node.name);
        if(bodyEnd>=0) { if(node.start<bodyEnd)continue; }
        else if(!known && source.slice(node.end).replace(/<\/[\p{L}_][\p{L}\p{N}_.:-]*\s*>/gu,'').trim())continue;
        if(!structuredFields(body))continue;
        if(allText.indexOf(text)!==allText.lastIndexOf(text))continue;
        possible.push({tag:node.name,text,body,start:node.start,end:node.end});
    }
    // Outer structured block wins over its nested fields/formatting wrappers.
    return possible.filter(block=>!possible.some(parent=>parent!==block&&parent.start<block.start&&parent.end>block.end));
}

function canonical(node) { return comparableText(node.textContent||''); }
function visibleMarker(node, tag, closing=false) {
    return (node.textContent||'').trim().toLowerCase()===`<${closing?'/':''}${tag}>`;
}

/** Plans changes to ALREADY VISIBLE nodes. Raw contents are never rendered. */
export function planTailStatuses(root, raw, exclusionText = '') {
    const blocks=extractTailStatuses(raw,exclusionText);
    const protection=protectedSource(raw,excludedNames(exclusionText));
    const existing=new Map(),groups=[];
    const eligible=[...root.querySelectorAll('*')].filter(node=>
        !node.closest('pre,code,script,style,textarea,input,button,iframe,svg,canvas')
        && isSafeStatusNode(root,node,exclusionText));
    const siblings=[...root.childNodes];
    for(const block of blocks) {
        if(!sourceAllows(block.text,protection))continue;
        const matches=eligible.filter(node=>canonical(node)===block.text);
        const outer=matches.filter(node=>!matches.some(parent=>parent!==node&&parent.contains(node)));
        if(outer.length===1) {existing.set(outer[0],{tag:block.tag,reason:'正文后状态结构'});continue;}
        if(outer.length>1||siblings.length>200)continue;
        const ranges=[];
        for(let start=0;start<siblings.length;start++) {
            if(!canonical(siblings[start]))continue;
            let text='';
            for(let end=start;end<siblings.length;end++) {
                const node=siblings[end];
                if(node.nodeType!==3&&node.nodeType!==1)break;
                if(!isSafeStatusNode(root,node,exclusionText))break;
                text+=canonical(node);
                if(text.length>block.text.length)break;
                if(text===block.text) {
                    let a=start,b=end;
                    let before=a-1,after=b+1;
                    while(before>=0&&!siblings[before].textContent.trim())before--;
                    while(after<siblings.length&&!siblings[after].textContent.trim())after++;
                    if(before>=0&&visibleMarker(siblings[before],block.tag)&&isSafeStatusNode(root,siblings[before],exclusionText))a=before;
                    if(after<siblings.length&&visibleMarker(siblings[after],block.tag,true)&&isSafeStatusNode(root,siblings[after],exclusionText))b=after;
                    const nodes=siblings.slice(a,b+1);
                    if(nodes.length)ranges.push(nodes);
                    break;
                }
            }
        }
        if(ranges.length===1)groups.push({nodes:ranges[0],tag:block.tag,reason:'正文后状态结构'});
    }
    return {existing,groups};
}
