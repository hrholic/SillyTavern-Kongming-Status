/** Re-style already-visible panel shells using source boundaries and unchanged text anchors.
 * This module never renders source content, copies hidden data, or changes visibility.
 */
import {excludedNames, protectedSource} from './core.js?v=0.3.2';
import {extractPanelSources, displayText} from './tail.js?v=0.3.2';
const OMIT='pre,code,script,style,textarea,input,button,iframe,svg,canvas,[data-kms-ignore]';
function visible(node) {
    for(let p=node;p;p=p.parentElement) {
        if(p.hidden||p.getAttribute('aria-hidden')==='true')return false;
        const s=p.ownerDocument.defaultView?.getComputedStyle(p);
        if(s&&(s.display==='none'||['hidden','collapse'].includes(s.visibility)||s.opacity==='0'))return false;
        if(p.parentElement?.tagName==='DETAILS'&&!p.parentElement.open&&p.tagName!=='SUMMARY')return false;
    }
    return true;
}
function identitiesBlocked(node,names,explicit) {
    const matches=p=>p.hasAttribute('data-kms-ignore')||names.has(p.localName.toLowerCase())
        || /(?:^|[_:-])cot$/.test(p.localName.toLowerCase())
        || [p.id,...p.classList,p.getAttribute('data-role')||'',p.getAttribute('data-type')||'']
            .some(t=>explicit.has(t.toLowerCase())||(t.startsWith('custom-')&&explicit.has(t.slice(7).toLowerCase())));
    for(let p=node;p;p=p.parentElement)if(matches(p))return true;
    return [...node.querySelectorAll('*')].some(matches);
}
function textLeaves(node) {
    const out=[];
    function walk(el) {
        if(el.matches(OMIT)||!visible(el))return;
        // Combine adjacent text in a leaf but never read textContent of a hidden ancestor.
        let pending='';
        for(const child of el.childNodes) {
            if(child.nodeType===3)pending+=child.nodeValue;
            else if(child.nodeType===1) {
                if(pending.trim()){out.push(pending.trim());pending='';}
                walk(child);
            }
        }
        if(pending.trim())out.push(pending.trim());
    }
    walk(node);return out.map(displayText).filter(Boolean);
}
function panelShape(node) {
    if(node.matches('details'))return Boolean(node.querySelector(':scope > summary'));
    if(node.matches('table'))return node.querySelectorAll('tr').length>=2;
    if(node.matches('dl'))return node.querySelectorAll('dt').length>=2;
    if(node.matches('fieldset'))return Boolean(node.querySelector('legend'));
    const heading=node.querySelector('h1,h2,h3,h4,h5,h6,header,[class*="-title"],[class*="-header"]');
    const token=[node.id,...node.classList].join(' ');
    const named=/(?:^|[ _-])(?:card|panel|box|widget|window|sheet)(?:$|[ _-])/i.test(token);
    const s=node.ownerDocument.defaultView?.getComputedStyle(node);
    const edge=s&&[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth].some(x=>parseFloat(x)>0);
    const backdrop=s&&s.backgroundColor&&!['transparent','rgba(0, 0, 0, 0)'].includes(s.backgroundColor);
    return Boolean(heading&&(named||edge||backdrop));
}
export function findRenderedPanelRoots(root,raw,exclusionText='') {
    const sources=extractPanelSources(raw,exclusionText),found=new Map();
    if(!sources.length)return found;
    const names=excludedNames(exclusionText),explicit=excludedNames(exclusionText);
    if(!/(?:^|[,，;；\s])[<\/.#]*content(?:>|[,，;；\s]|$)/i.test(exclusionText))explicit.delete('content');
    if(!/(?:^|[,，;；\s])[<\/.#]*context(?:>|[,，;；\s]|$)/i.test(exclusionText))explicit.delete('context');
    const protection=protectedSource(raw,names);
    const protectedText=(protection?.rawInside||protection?.inside||[]).map(displayText);
    for(const node of root.querySelectorAll('details,section,article,aside,div,table,dl,fieldset')) {
        if(node.hasAttribute('data-kms-tail-wrapper')||node.closest(OMIT)||!visible(node)
            || identitiesBlocked(node,names,explicit)||!panelShape(node))continue;
        const leaves=textLeaves(node);
        if(leaves.some(t=>t.length>=8&&protectedText.some(p=>p.includes(t))))continue;
        const matching=sources.filter(source=>{
            const anchors=leaves.filter(t=>t.length>=4&&source.key.includes(t));
            const unmatched=leaves.filter(t=>t.length>=4&&!source.key.includes(t));
            return !unmatched.some(t=>t.length>16)&&unmatched.length<=3
                && anchors.reduce((sum,t)=>sum+t.length,0)>=24
                && (anchors.length>=2||anchors.some(t=>t.length>=40));
        });
        if(matching.length===1)found.set(node,{reason:'正文外面板结构',sourceText:matching[0].sourceText,tag:matching[0].tag});
    }
    for(const node of found.keys())for(let p=node.parentElement;p&&p!==root;p=p.parentElement)if(found.has(p)){found.delete(node);break;}
    return found;
}
