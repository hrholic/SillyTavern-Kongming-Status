import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {findRenderedPanelRoots} from '../panels.js';
import {findStatusRoots,protectedSource,excludedNames,sourceAllows} from '../core.js?v=0.3.3';
const first='清晨的图书馆二层靠窗长桌',second='准备归还借阅书籍并整理今天的笔记';
const data=`地点：${first}\n计划：${second}`;
const card=`<section class="custom-card"><header>资料面板</header><p>${first}</p><p>${second}</p></section>`;
function root(html){return new JSDOM(`<main>${html}</main>`).window.document.querySelector('main');}
test('unknown panel names before or after body match unchanged visible anchors, without a status word',()=>{
 for(const raw of [`<unusual_one>${data}</unusual_one><content>正文</content>`,`<content>正文</content><misc_sheet>${data}</misc_sheet>`]){
  const r=root(card);const before=r.innerHTML;assert.equal(findRenderedPanelRoots(r,raw).size,1);assert.equal(r.innerHTML,before);
 }
});
test('mixed narrative, raw thoughts, comments, hidden source and exclusions never become panels',()=>{
 for(const raw of [`<content>${data}</content>`,`<xp_cot><pane>${data}</pane></xp_cot><content>正文</content>`,`<!--<pane>${data}</pane>--><content>正文</content>`,`<div hidden><pane>${data}</pane></div><content>正文</content>`])assert.equal(findRenderedPanelRoots(root(card),raw).size,0);
 const raw=`<content>正文</content><pane>${data}</pane>`;
 assert.equal(findRenderedPanelRoots(root(card),raw,'pane').size,0);
 assert.equal(findRenderedPanelRoots(root(card),raw,'card').size,0);
 const mixed=root(`<section class="card"><header>页面</header><p>这是不属于面板的正文段落，必须保留原始正文外观。</p><p>${first}</p><p>${second}</p></section>`);
 assert.equal(findRenderedPanelRoots(mixed,raw).size,0);
});
test('hidden sibling/descendant text is not read or exposed and duplicate anchors fail closed',()=>{
 const r=root(card.replace('</section>','<div hidden>隐藏数据</div></section>'));
 Object.defineProperty(r.querySelector('[hidden]'),'textContent',{get(){throw Error('read hidden');}});
 assert.equal(findRenderedPanelRoots(r,`<content>正文</content><pane>${data}</pane>`).size,1);
 assert.equal(r.querySelector('[hidden]').hidden,true);
 assert.equal(findRenderedPanelRoots(root(card),`<content>${data}</content><pane>${data}</pane>`).size,0);
});
test('core protection includes xp_cot, hidden raw attributes, nested div and comments',()=>{
 const raw=`<xp_cot>私有思考内容</xp_cot><div hidden><div>隐藏内部数据</div>隐藏后段数据</div><!--<content>不闭合注释--><status>安全显示内容</status>`;
 const p=protectedSource(raw,excludedNames());
 for(const text of ['私有思考内容','隐藏内部数据','隐藏后段数据'])assert.equal(sourceAllows(text,p),false);
 assert.equal(sourceAllows('安全显示内容',p),true);
 const r=root('<div class="status">私有思考内容</div>');assert.equal(findStatusRoots(r,'','',raw).roots.size,0);
});
