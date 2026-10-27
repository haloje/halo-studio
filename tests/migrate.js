const {chromium}=require('/opt/npm-tools/node_modules/playwright');const http=require('http');const fs=require('fs');const path=require('path');
(async()=>{const ROOT=path.resolve(__dirname,'..');const S='/tmp/claude-0/-home-claude/7987febb-aa5d-5135-8626-976c1c6929d3/scratchpad';
 const b=await chromium.launch();
 // 1) export from the old (claude.ai) Studio
 const p=await b.newPage();await p.route('**/cdnjs.cloudflare.com/**',r=>r.fulfill({body:'',contentType:'text/javascript'}));
 await p.route('**/_blob/**',r=>r.fulfill({path:S+'/site.png',contentType:'image/png'}));
 await p.route('http://old.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"></head><body><script>window.__dl=null;const __d=Object.freeze({save:async o=>{window.__dl=o;return {status:"saved"}}});window.claude={use:async k=>k==="downloads"?__d:null};</script>'+fs.readFileSync(S+'/app/proposals.html','utf8')+'</body></html>'}));
 await p.goto('http://old.test/');await p.waitForTimeout(800);
 await p.evaluate(()=>{ mode="db"; const data={proposals:[{id:'p1',data:{title:'T',data:{id:'p1',titleA:'Test',systems:[{name:'A',items:[{item:'X',img:'/_blob/abc123'}]}]}}}],products:[{id:'pr1',data:{id:'pr1',item:'Cam',img:'/_blob/abc123'}}],jobs:[],drawings:[],clients:[],settings:[],catalog:[{id:'tradify',data:{items:[{id:'t1',item:'Thing',price:5}]}}]};
   db={collection:c=>({get:async()=>({docs:(data[c]||[]).map(d=>({id:d.id,data:()=>d.data}))})})}; });
 await p.evaluate(()=>{const b=document.createElement('button');document.body.appendChild(b);return mgExport(b);});
 const pack=await p.evaluate(()=>window.__dl&&window.__dl.data);fs.writeFileSync(ROOT+'/tests/pack.json',pack);const pj=JSON.parse(pack);
 console.log('export',pj.kind,Object.keys(pj.collections),Object.keys(pj.assets),pj.assets['/_blob/abc123']&&pj.assets['/_blob/abc123'].slice(0,30));
 // 2) import into the new app
 const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';
   if(u==='/vendor/supabase-2.45.4.js'){r.setHeader('content-type','text/javascript');return r.end(fs.readFileSync(ROOT+'/tests/mock-supabase.js'));}
   const f=ROOT+'/docs'+u;if(!fs.existsSync(f)){r.statusCode=404;return r.end();}r.setHeader('content-type',u.endsWith('.js')?'text/javascript':'text/html');r.end(fs.readFileSync(f));}).listen(8125);
 const q=await b.newPage();const errs=[];q.on('pageerror',e=>errs.push(e.message));
 await q.goto('http://localhost:8125/');await q.waitForTimeout(1200);
 await q.click('#tabJ');await q.waitForTimeout(300);await q.click('[data-jv=reports]');await q.waitForTimeout(300);
 await q.setInputFiles('[data-rpimport]',ROOT+'/tests/pack.json');await q.waitForTimeout(1500);
 console.log('rows',JSON.stringify(await q.evaluate(()=>__rows.map(r=>[r.collection,r.id,JSON.stringify(r.data).match(/signed\.example[^"]*/)?'img-ok':'']))));
 console.log(errs);await b.close();srv.close();})();
