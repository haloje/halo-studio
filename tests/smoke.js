const {chromium}=require('/opt/npm-tools/node_modules/playwright');const http=require('http');const fs=require('fs');const path=require('path');
(async()=>{const ROOT=path.resolve(__dirname,'..');
 const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';
   if(u==='/vendor/supabase-2.45.4.js'){r.setHeader('content-type','text/javascript');return r.end(fs.readFileSync(ROOT+'/tests/mock-supabase.js'));}
   const f=ROOT+'/docs'+u;if(!fs.existsSync(f)){r.statusCode=404;return r.end();}
   r.setHeader('content-type',u.endsWith('.js')?'text/javascript':u.endsWith('.html')?'text/html':u.endsWith('.woff2')?'font/woff2':'application/octet-stream');r.end(fs.readFileSync(f));}).listen(8124);
 const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1440,height:950}});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
 const S='/tmp/claude-0/-home-claude/7987febb-aa5d-5135-8626-976c1c6929d3/scratchpad';
 const jobs=fs.readdirSync(S+'/jobs').filter(f=>f.startsWith('j-')).map(f=>JSON.parse(fs.readFileSync(S+'/jobs/'+f)));
 const rows=[...jobs.map(j=>({collection:'jobs',id:j.data.id,data:j})),{collection:'catalog',id:'tradify',data:JSON.parse(fs.readFileSync(S+'/xero/catalog-v3.json'))},{collection:'catalog',id:'xero-clients',data:JSON.parse(fs.readFileSync(S+'/clients/combined.json'))}];
 await p.addInitScript(r=>{window.__rows=r;},rows);
 await p.goto('http://localhost:8124/');await p.waitForTimeout(1500);
 console.log('mode',await p.evaluate(()=>mode),'products',await p.evaluate(()=>products.length),'clients',await p.evaluate(()=>clients.length));
 await p.click('#tabJ');await p.waitForTimeout(500);console.log('jobs',await p.evaluate(()=>jbList.length));
 await p.click('#tabP');await p.click('#btnNew');await p.waitForTimeout(1500);console.log('writes',await p.evaluate(()=>window.__writes),'proposals rows',await p.evaluate(()=>__rows.filter(r=>r.collection==='proposals').length));
 await p.screenshot({path:ROOT+'/tests/shot-desktop.png'});
 // reload: data persists from cache + store
 await p.reload();await p.waitForTimeout(1500);console.log('after reload proposals',await p.evaluate(()=>list.length));
 // login screen when no session
 const p2=await ctx.newPage();await p2.addInitScript(()=>{window.__noSession=true;try{localStorage.clear()}catch(e){}});await p2.goto('http://localhost:8124/');await p2.waitForTimeout(800);
 console.log('login shown',!!(await p2.$('#authForm')));await p2.screenshot({path:ROOT+'/tests/shot-login.png'});
 console.log('errors',errs);await b.close();srv.close();})();
