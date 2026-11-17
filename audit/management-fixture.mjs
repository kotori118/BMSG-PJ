import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const read=f=>fs.readFileSync(path.join(import.meta.dirname,'..',f),'utf8');
export function fixture({admin=true,uid='U001'}={}){
  const files=['CatalogManagement.html','SongLyricsManagement.html','ProfileManagement.html','ImageManagement.html','ManagementOperations.html','ManagementPage.html'];
  const html='<div id="pageContent"></div><div id="searchOverlay"></div><div id="settingsOverlay"></div><div id="toastRegion"></div>'+files.map(f=>read(f).replace(/<script>[\s\S]*?<\/script>/g,'')).join('');
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://example.test/'}),ctx=dom.getInternalVMContext(),calls=[],history=[];
  const groups=[{GroupID:'1',GroupName:'BE:FIRST',GroupKind:'GROUP',ColorHex:'#123456'},{GroupID:'6',GroupName:'ShowMinorSavage',GroupKind:'UNIT',ColorHex:'#654321'}];
  const members=[{MemberID:'101',GroupID:'1',DisplayName:'SOTA',ColorHex:'#00AFCC'}];
  const song={songId:'1001',title:'Test song',artist:'BE:FIRST',releaseDate:'2026-01-01',form:'シングル',cdTitle:'',isTitleTrack:false,songType:'NORMAL',soloMemberId:''};
  const data={getManagementPageAccess:{registered:true,catalog:admin},getCatalogManagementBootstrap:{groups,members,songs:[{SongID:'1001',Title:'Test song'}],schema:{ready:true},memberships:[]},getCatalogManagementProfileFields:{ok:true,fields:[]},getSongLyricsManagementBootstrap:{artists:['BE:FIRST'],existingArtists:['BE:FIRST'],songs:[song],forms:['シングル'],singerOptions:[],soloMembers:[{value:'101',label:'SOTA'}]},getSongLyricsManagementSong:{song,credits:{},parts:[{singers:[],lyrics:'example'}]},getProfileManagementBootstrap:{groups:[{name:'BE:FIRST',members:[{memberId:'101',name:'SOTA'}]}],fields:[]},getProfileManagementMember:{values:{}},getImageManagementBootstrap:{groups:[{name:'BE:FIRST',members:[{memberId:'101',name:'SOTA'}]}]},saveNewSongLyricsManagement:{ok:true,songId:'1001'},catalogManagementCreateSongDraft:{ok:true,songId:'1001'},auditCatalogManagementDatabase:{warnings:[]}};
  data.getManagementOperationsBootstrap={ok:true,schema:{ready:true},groups:data.getCatalogManagementBootstrap.groups,guests:[],members:data.getCatalogManagementBootstrap.members,images:[],fields:[],backups:[],flags:{}};
  let change;
  function runner(success,failure){return new Proxy({}, {get(_,key){if(key==='withSuccessHandler')return f=>runner(f,failure);if(key==='withFailureHandler')return f=>runner(success,f);return(...args)=>{calls.push({key,args});queueMicrotask(()=>{try{if(data[key] instanceof Error){failure?.(data[key]);return;}success?.(structuredClone(data[key]??{ok:true}));}catch(e){throw e;}});};}});}
  Object.assign(ctx,{getUniverseUserId:()=>uid,closeSettings:()=>{},showToast:()=>{},renderUniverseLoading:()=>'<div role="status">LOADING</div>',setPageAtmosphere:()=>{},setTheme:()=>{},setActiveNav:()=>{},scrollAppToTop:()=>{},syncCurrentFavoriteButton:()=>{},renderHome:()=>'<h1>HOME</h1>',initHomePage:()=>{},renderData:()=>'',renderLab:()=>'',resetUniverseCrossLinks:()=>{},mountUniverseSingerEditor:()=>{},google:{script:{run:runner(),history:{push:s=>history.push(s),replace:s=>history.push(s),setChangeHandler:f=>change=f},url:{getLocation:f=>f({parameter:{page:'home'}})}}}});
  ctx.window.confirm=()=>true;
  const scripts=[read('AppCore.html'),...files.map(read),read('Router.html')].flatMap(s=>Array.from(s.matchAll(/<script>([\s\S]*?)<\/script>/g),m=>m[1]));
  vm.runInContext(scripts.join('\n'),ctx);
  const run=s=>vm.runInContext(s,ctx);
  const settle=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
  const go=async(section,action)=>{run('navigateToWithParams("manage",'+JSON.stringify({section,action})+')');await settle();};
  return{dom,ctx,run,calls,data,history,go,settle,change:(p)=>change({location:{parameter:p}})};
}
