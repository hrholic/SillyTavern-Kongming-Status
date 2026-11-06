import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {extractTailStatuses,planTailStatuses} from '../tail.js';
import {findStatusRoots} from '../core.js?v=0.3.1';
const data='时间：午后\n地点：窗边\n心情：平静';
function root(html){return new JSDOM(`<main>${html}</main>`).window.document.querySelector('main');}
test('multiple unknown trailing blocks without body tags are all considered',()=>{
 const raw=`正文\n<foo>${data}</foo>\n<bar>体力：80\n地点：林间</bar>`;
 assert.deepEqual(extractTailStatuses(raw).map(x=>x.tag),['foo','bar']);
 assert.equal(extractTailStatuses(raw+'接下来是正文').length,0);
});
test('nested rendered paragraphs map and field delimiters may change without changing labels or values',()=>{
 const raw=`<content>正文</content><foo>\n    时间：午后\n    地点：窗边\n    心情：平静\n</foo>`;
 const a=root('<div><p>正文</p><p>时间 午后</p><p>地点 窗边</p><p>心情 平静</p></div>');
 const plan=planTailStatuses(a,raw);assert.equal(plan.groups.length,1);assert.equal(plan.groups[0].parent,a.firstElementChild);
 const b=root('<p>正文</p><div>时间午后地点窗边心情平静</div>');
 const p=planTailStatuses(b,raw);assert.equal(p.existing.size,1);assert.equal(findStatusRoots(b,'','',raw,p.existing).roots.size,1);
});
test('Markdown table and bracket/XML fields have exact visible-text mappings',()=>{
 const raw='<content>正文</content><panel>\n| 项目 | 值 |\n| --- | --- |\n| HP | 80 |\n| 地点 | 窗边 |\n</panel>';
 const a=root('<p>正文</p><table><tr><th>项目</th><th>值</th></tr><tr><td>HP</td><td>80</td></tr><tr><td>地点</td><td>窗边</td></tr></table>');
 assert.equal(planTailStatuses(a,raw).existing.size,1);
 for(const content of ['【时间】午后\n【地点】窗边','<time>午后</time><location>窗边</location>'])assert.equal(extractTailStatuses(`<content>正文</content><panel>${content}</panel>`).length,1);
});
test('format-normalized collisions with narrative remain protected',()=>{
 const raw=`<content>时间午后地点窗边心情平静</content><panel>${data}</panel>`;
 assert.equal(planTailStatuses(root('<div>时间午后地点窗边心情平静</div>'),raw).existing.size,0);
});
test('hidden nodes are not read by fallback; code, thought and exclusion still block',()=>{
 const raw=`<content>正文</content><panel>${data}</panel>`;
 const a=root('<p>正文</p><p hidden>秘密</p><p>时间：午后</p><p>地点：窗边</p><p>心情：平静</p>');
 Object.defineProperty(a.querySelector('[hidden]'),'textContent',{get(){throw Error('read hidden text');}});
 assert.doesNotThrow(()=>planTailStatuses(a,raw));
 for(const html of [`<div><pre><code>${data}</code></pre></div>`,`<div hidden>${data}</div>`,`<thinking><div>${data}</div></thinking>`,`<div class="keep">${data}</div>`]){
  const plan=planTailStatuses(root(html),raw,'keep');assert.equal(plan.existing.size,0);assert.equal(plan.groups.length,0);
 }
});
