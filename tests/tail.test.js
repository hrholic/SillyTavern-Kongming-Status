import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractTailStatuses, planTailStatuses } from '../tail.js';
import { findStatusRoots } from '../core.js?v=0.3.0';
const data='时间：午后\n地点：窗边\n心情：平静';
const wrapped=(tag='随身记录',inside=data)=>`<thinking>不可读取的思考</thinking><content>正文保持原样</content><${tag}>${inside}</${tag}>`;
function root(html){const dom=new JSDOM(`<main>${html}</main>`);return dom.window.document.querySelector('main');}

test('unknown Chinese/English tags after complete narrative are identified by fields, not a fixed status word',()=>{
 for(const tag of ['随身记录','alice_notes','bio-panel'])assert.equal(extractTailStatuses(wrapped(tag))[0]?.tag,tag);
 assert.equal(extractTailStatuses(wrapped('record','名字：甲\n职业：向导\n阵营：中立')).length,1);
 assert.equal(extractTailStatuses(wrapped('record','地点：窗边\n心情：平静')).length,1);
});
test('ordinary narrative, control blocks and nested protected children are not state',()=>{
 for(const body of ['他看着时间，心情平静。','甲：你好\n乙：你好','{"HP":80,"MP":20}','<thinking>'+data+'</thinking>','<choices>'+data+'</choices>'])assert.equal(extractTailStatuses(wrapped('panel',body)).length,0,body);
 for(const tag of ['thinking','ecot','preprint','analysis','choices','UpdateVariable','summary','memory'])assert.equal(extractTailStatuses(wrapped(tag)).length,0,tag);
 assert.equal(extractTailStatuses(`<content>${data}<panel>${data}</panel></content>`).length,0);
 assert.equal(extractTailStatuses(`<thinking><panel>${data}</panel></thinking>`).length,0);
});
test('partial, malformed, repeated, excluded and code examples fail closed',()=>{
 const samples=[`<content>正文<panel>${data}</panel>`,`<content>正文</content><panel>${data}`,`<content>正文</content><panel><broken>${data}</panel>`,`<content>${data}</content><panel>${data}</panel>`,`~~~html\n${wrapped()}\n~~~`,`\`\`\`html\n${wrapped()}`];
 for(const raw of samples)assert.equal(extractTailStatuses(raw).length,0,raw);
 assert.equal(extractTailStatuses(wrapped('keep-panel'),'keep-panel').length,0);
 assert.equal(extractTailStatuses(`<content>正文</content><keep><panel>${data}</panel></keep>`,'keep').length,0);
});
test('two tail panels, HTML table/dl structures and no-body final fields are supported',()=>{
 assert.deepEqual(extractTailStatuses(`<content>正文</content><aaa>${data}</aaa><bbb>天气：晴朗\n体力：80</bbb>`).map(x=>x.tag),['aaa','bbb']);
 for(const body of ['<table><tr><td>体力</td><td>80</td></tr><tr><td>精力</td><td>50</td></tr></table>','<dl><dt>体力</dt><dd>80</dd><dt>精力</dt><dd>50</dd></dl>'])assert.equal(extractTailStatuses(wrapped('记录',body)).length,1);
 assert.equal(extractTailStatuses(`正文\n<card>${data}</card>`).length,1);
 assert.equal(extractTailStatuses(`<card>${data}</card>\n后续正文`).length,0);
});
test('existing visible HTML and stripped multi-paragraph output are mapped without rendering raw',()=>{
 const a=root('<p>正文保持原样</p><div id="panel">时间：午后<br>地点：窗边<br>心情：平静</div>');
 assert.equal(planTailStatuses(a,wrapped()).existing.size,1);
 const b=root('<p>正文保持原样</p><p>时间：午后</p><p>地点：窗边</p><p>心情：平静</p>');
 const plan=planTailStatuses(b,wrapped());assert.equal(plan.groups.length,1);assert.equal(plan.groups[0].nodes.length,3);
 const single=root('');single.append(single.ownerDocument.createTextNode(data));assert.equal(planTailStatuses(single,wrapped()).groups[0].nodes.length,1);
 const c=root('<p>正文保持原样</p>');assert.equal(planTailStatuses(c,wrapped()).groups.length,0);assert.equal(c.textContent,'正文保持原样');
});
test('escaped paired markers are included only around the matching visible group',()=>{
 const a=root('<p>正文保持原样</p><p>&lt;随身记录&gt;</p><p>时间：午后</p><p>地点：窗边</p><p>心情：平静</p><p>&lt;/随身记录&gt;</p>');
 const plan=planTailStatuses(a,wrapped());assert.equal(plan.groups.length,1);assert.equal(plan.groups[0].nodes.length,5);
});
test('hidden, excluded, body and duplicate DOM targets are never mapped',()=>{
 for(const html of [
 `<div hidden>${data}</div>`,`<div style="opacity:0">${data}</div>`,`<content><div>${data}</div></content>`,`<div class="keep">${data}</div>`,`<div><span hidden>秘密</span>${data}</div>`,`<div>${data}</div><div>${data}</div>`,
 ]){const plan=planTailStatuses(root(html),wrapped(),'keep');assert.equal(plan.existing.size,0,html);assert.equal(plan.groups.length,0,html);}
});
test('existing semantic route also protects raw thought/control after DOM sanitization',()=>{
 for(const tag of ['thinking','preprint','ecot','cot','analysis','system','tool_call']){
  const a=root(`<div class="status">${data}</div>`);assert.equal(findStatusRoots(a,'','',`<${tag}><status>${data}</status></${tag}>`).roots.size,0,tag);
 }
});

test('indented code and wrappers around code are not state panels',()=>{
 const raw='<content>正文</content>\n\n    <panel>\n    时间：午后\n    地点：窗边\n    心情：平静\n    </panel>';
 assert.equal(extractTailStatuses(raw).length,0);
 const a=root('<div><pre><code>&lt;panel&gt;'+data+'&lt;/panel&gt;</code></pre></div>');
 assert.equal(planTailStatuses(a,wrapped('panel')).existing.size,0);
});
