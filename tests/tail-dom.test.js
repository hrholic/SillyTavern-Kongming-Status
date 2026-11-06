import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const fixture=await readFile(new URL('./fixture.html',import.meta.url),'utf8');
const wait=()=>new Promise(resolve=>setTimeout(resolve,90));

test('unknown stripped tail integration: only visible nodes, reversible markers/wrapping, settings and streaming',async()=>{
 const dom=new JSDOM(fixture,{url:'http://localhost/tests/fixture.html',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window;
 for(const key of ['document','MutationObserver','SillyTavern'])globalThis[key]=w[key];
 globalThis.getComputedStyle=w.getComputedStyle.bind(w);globalThis.requestAnimationFrame=w.requestAnimationFrame.bind(w);globalThis.cancelAnimationFrame=w.cancelAnimationFrame.bind(w);globalThis.matchMedia=()=>({matches:false});
 const $=s=>w.document.querySelector(s);
 const raw='<thinking>隐去的思考</thinking><content>正文保持原样</content><旅途簿>时间：午后\n地点：窗边\n心情：平静</旅途簿>';
 w.chatFixture.push({mes:raw});
 const mes=w.document.createElement('div');mes.className='mes';mes.setAttribute('mesid','2');mes.setAttribute('is_user','false');
 mes.innerHTML='<div class="mes_text" id="tail-message"><p id="tail-body">正文保持原样</p><p>&lt;旅途簿&gt;</p><p id="tail-field">时间：午后</p><p>地点：窗边</p><p>心情：平静</p><p>&lt;/旅途簿&gt;</p></div>';
 $('#chat').append(mes);const message=$('#tail-message'),initial=[...message.childNodes],field=$('#tail-field');let clicks=0;field.addEventListener('click',()=>clicks++);
 const plugin=await import('../index.js?tail-integration');
 const setting=async(key,value)=>{const el=$(`[data-kms-setting="${key}"]`);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));await wait();};
 try{
  await wait();await wait();
  let card=message.querySelector('.kms-card');assert.ok(card);assert.equal(message.querySelectorAll('.kms-card').length,1);assert.equal(card.querySelectorAll('[data-kms-marker][hidden]').length,2);assert.equal($('#tail-body').parentNode,message);assert.equal($('#tail-body').classList.contains('kms-card'),false);assert.equal(message.textContent.includes('隐去的思考'),false);field.click();assert.equal(clicks,1);
  await wait();assert.equal(message.querySelector('.kms-card'),card);assert.equal(card.querySelectorAll('[data-kms-marker]').length,2);
  for(const template of ['slate','paper','classic']){await setting('template',template);assert.equal(message.querySelectorAll('.kms-card').length,1);}
  assert.equal($('.kms-classic-demo').hidden,false);assert.equal($('[data-kms-demo="generic"]').hidden,true);assert.match($('.kms-preview-note').textContent,/实际内容与结构/);
  await setting('excluded','旅途簿');assert.equal(message.querySelector('.kms-card'),null);assert.equal(message.querySelector('[data-kms-marker]'),null);assert.deepEqual([...message.childNodes],initial);
  await setting('excluded','');assert.ok(message.querySelector('.kms-card'));
  await setting('enabled',false);assert.deepEqual([...message.childNodes],initial);assert.equal(field,$('#tail-field'));
  await setting('enabled',true);assert.ok(message.querySelector('.kms-card'));
  assert.equal(w.chatFixture[2].mes,raw);
  // Partial/new content is not trusted until both raw closure and visible fields match.
  w.chatFixture[2].mes='<content>正文保持原样</content><旅途簿>时间：清晨\n地点：林间';message.innerHTML='<p id="tail-body">正文保持原样</p><p>时间：清晨</p><p>地点：林间</p>';await wait();assert.equal(message.querySelector('.kms-card'),null);
  w.chatFixture[2].mes+='</旅途簿>';w.emitFixture('updated');await wait();assert.ok(message.querySelector('.kms-card'));
  plugin.onDisable();assert.equal(message.querySelector('.kms-card'),null);assert.equal(message.querySelector('[data-kms-tail-wrapper]'),null);
 }finally{plugin.onDisable();dom.window.close();}
});
