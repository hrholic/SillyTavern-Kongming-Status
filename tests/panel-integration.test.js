import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const wait=()=>new Promise(resolve=>setTimeout(resolve,90));

test('anonymous seven-module rendering: shell styling, hidden protection and reversible disable',async()=>{
 const fixture=await readFile(new URL('./fixture.html',import.meta.url),'utf8');
 const dom=new JSDOM(fixture,{url:'http://localhost/',runScripts:'dangerously',pretendToBeVisual:true}),w=dom.window;
 for(const key of ['document','MutationObserver','SillyTavern'])globalThis[key]=w[key];
 globalThis.getComputedStyle=w.getComputedStyle.bind(w);globalThis.requestAnimationFrame=w.requestAnimationFrame.bind(w);globalThis.cancelAnimationFrame=w.cancelAnimationFrame.bind(w);globalThis.matchMedia=()=>({matches:false});
 const raw='<网文元素>题材：日常\n路线：整理书架</网文元素><top_blueprint>标题：新的一天</top_blueprint><xp_cot>隐藏思考</xp_cot><content>正文不改</content><成就表>1|书|阅读|整理书架|1|初级|book</成就表><成就>1</成就><时间线>今天|2030-01-01|早晨</时间线><meow_FM>serial:1\ntime:早晨\nplot:整理书架</meow_FM><branches><details><summary>分支</summary>A. 去图书馆</details></branches><div hidden><与此同时>后台状态</与此同时></div>';
 w.chatFixture.push({mes:raw});
 const mes=w.document.createElement('div');mes.className='mes';mes.setAttribute('mesid','2');mes.setAttribute('is_user','false');
 mes.innerHTML='<div class="mes_text" id="realistic-message"><div id="bp-vision" class="bv"><div class="bv-head"></div><div class="bv-main"><div class="bv-body">远景</div></div></div><div id="tb" class="tb"><div class="tb-heading">标题</div><div class="tb-meta">信息</div><div class="tb-voice" hidden>不读取</div></div><p id="safe-story">正文不改</p><div class="custom-bp-ach">🏆</div><div class="custom-bp-ach">🏆1</div><div class="custom-bp-tl">时间线</div><div class="meow-fm-ghost"><details class="bpx-log"><summary class="bpx-log-sum">摘要</summary><div class="bpx-log-body">事件</div></details></div><div id="post-it-card" class="post-it-container"><div class="post-it-collapsible"><div id="options-container">选项</div></div></div><div hidden class="qrf-world-simulation-projection">后台状态</div></div>';
 w.document.querySelector('#chat').append(mes);
 const plugin=await import('../index.js?seven-module-basic');
 try{
  await wait();await wait();
  assert.equal(mes.querySelectorAll('.kms-shell').length,7);
  assert.equal(mes.querySelector('#safe-story').className,'');assert.equal(mes.querySelector('.tb-voice').hidden,true);assert.equal(mes.querySelector('.qrf-world-simulation-projection').hidden,true);
  assert.equal(w.chatFixture[2].mes,raw);
  const input=w.document.querySelector('[data-kms-setting="enabled"]');input.checked=false;input.dispatchEvent(new w.Event('change',{bubbles:true}));await wait();assert.equal(mes.querySelectorAll('.kms-shell').length,0);
  assert.equal(mes.querySelector('.tb-voice').hidden,true);assert.equal(w.chatFixture[2].mes,raw);
 }finally{plugin.onDisable();dom.window.close();}
});
