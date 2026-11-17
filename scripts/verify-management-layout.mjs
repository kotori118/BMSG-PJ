import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {fixture} from '../audit/management-fixture.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const includes=[...read('Index.html').matchAll(/include\('([^']+)'\)/g)].map(m=>m[1]+'.html');
const css=includes.flatMap(f=>[...read(f).matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[0])).join('\n');
const shell=read('AppShell.html');
const fontLinks=[...read('Index.html').matchAll(/<link[^>]+href="https:\/\/fonts.googleapis.com[^>]*>/g)].map(m=>m[0]).join('');
const contrast=(a,b)=>{const lum=s=>{const c=s.match(/[0-9.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return c[0]*.2126+c[1]*.7152+c[2]*.0722;};const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const browser=await chromium.launch();
fs.mkdirSync('layout-results',{recursive:true});
let checked=0;
try{
 for(const width of [320,375,390,768])for(const theme of ['dark','light'])for(const [section,action] of [[null,null],['songs','add'],['members','profile'],['groups','add']]){
  const f=fixture();await f.go(section,action);
  const content=f.dom.window.document.getElementById('pageContent').innerHTML;
  const body=shell.replace(/(<main[^>]*>)[\s\S]*?(<\/main>)/,'$1'+content+'$2');
  const page=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'});
  await page.setContent('<!doctype html><html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1"><head>'+fontLinks+css+'</head><body class="theme-'+theme+'"><div class="app-shell">'+body+'</div></body></html>');
  await page.evaluate(()=>document.fonts.ready);
  const geometry=await page.evaluate(()=>{
   const rect=s=>{const b=document.querySelector(s).getBoundingClientRect();return {top:b.top,bottom:b.bottom,left:b.left,right:b.right,width:b.width};};
   const wrap=document.querySelector('.page-wrap'),field=document.querySelector('#slmNewTitle'),panel=document.querySelector('.slm-panel');
   const heading=document.querySelector('.management-section-title');
   return {heading:heading?{color:getComputedStyle(heading).color,background:getComputedStyle(wrap).backgroundColor}:null,title:rect('.category-title'),tools:rect('.utility-actions'),main:rect('#pageContent'),overflow:wrap.scrollWidth>wrap.clientWidth,panel:panel?{padding:getComputedStyle(panel).padding,maxHeight:getComputedStyle(panel).maxHeight,overflow:getComputedStyle(panel).overflow}:null,field:field?rect('#slmNewTitle'):null};
  });
  const label=width+'/'+theme+'/'+section+'/'+action;
  assert.ok(geometry.title.top>=geometry.tools.bottom,label+' title overlaps shell buttons');
  assert.ok(geometry.title.right<=width,label+' title clips');
  assert.equal(geometry.overflow,false,label+' horizontal overflow');
  if(geometry.heading)assert.ok(contrast(geometry.heading.color,geometry.heading.background)>=4.5,label+' heading contrast');
  if(geometry.panel){assert.equal(geometry.panel.padding,'0px',label+' nested panel padding');assert.equal(geometry.panel.maxHeight,'none',label+' nested scroll height');}
  if(geometry.field&&width<600)assert.ok(geometry.field.width>=geometry.main.width*.9,label+' field is too narrow');
  if(width===390)await page.screenshot({path:'layout-results/'+theme+'-'+(section||'top')+'.png'});
  await page.close();f.dom.window.close();checked++;
 }
 console.log('Verified '+checked+' management layouts: 320/375/390/768px, Dark/Light, top/song/profile/group.');
}finally{await browser.close();}
