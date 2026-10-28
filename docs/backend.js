/* halo.je Studio: backend shim.
   Gives the Studio app the same `window.claude.use(name)` API it had inside claude.ai,
   backed by Supabase (database, realtime, storage, auth) with an offline cache and write queue. */
(function(){
  "use strict";
  const SB_URL = "https://wroblxvvdgpeviswgmvn.supabase.co";
  const SB_KEY = "sb_publishable_8m2ts1vlIL2WiYUu512_Dg_sBYTtFgK";
  const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "halo-studio-auth" } });
  window.STUDIO_NATIVE = true;
  window.studioSb = sb;

  /* ---------- small helpers ---------- */
  const LSK = "halo-studio-cache:";
  const lsGet = k => { try{ return JSON.parse(localStorage.getItem(k) || "null"); }catch(_){ return null; } };
  const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(_){ return false; } };
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const split = path => { const p = String(path).split("/"); return { collection: p.slice(0, -1).join("/"), id: p[p.length - 1] }; };

  /* ---------- auth gate ---------- */
  let session = null, ready, readyResolve;
  ready = new Promise(r=>readyResolve = r);
  function css(){
    if(document.getElementById("authCss")) return;
    const st = document.createElement("style"); st.id = "authCss";
    st.textContent = `.authwrap{position:fixed;inset:0;z-index:200;background:#121110;color:#f3efe9;display:grid;place-items:center;padding:24px;font-family:"Hanken Grotesk",system-ui,sans-serif}
.authbox{width:min(380px,100%);display:grid;gap:14px}.authbox img{height:72px;justify-self:start;margin-left:-14px}.authbox h1{font-family:"Outfit",sans-serif;font-weight:300;font-size:30px;margin:6px 0 0}
.authbox p{margin:0;color:#b5aea5;font-size:14px;line-height:1.5}.authbox input{height:46px;border-radius:10px;border:1px solid #3a3632;background:#1c1a18;color:#f3efe9;padding:0 14px;font-size:16px}
.authbox button{height:46px;border-radius:23px;border:0;background:#e8b878;color:#2a1d0e;font-weight:600;font-size:15px;cursor:pointer}.authbox button.ghost{background:none;color:#e8b878;height:auto;padding:4px 0;font-weight:500;justify-self:start}
.authbox .msg{font-size:13px;color:#e8b878;min-height:18px}.authbox .msg.err{color:#e58a76}`;
    document.head.appendChild(st);
  }
  function showLogin(){
    css();
    let w = document.getElementById("authWrap"); if(w) return;
    w = document.createElement("div"); w.className = "authwrap"; w.id = "authWrap";
    let signUp = false;
    const draw = ()=>{ w.innerHTML = `<form class="authbox" id="authForm" autocomplete="on">
      <img src="icons/logo-full.png" alt="halo.je">
      <h1>${signUp ? "Create your login" : "Studio"}</h1>
      <p>${signUp ? "Use info@halo.je and choose a password. You'll get one email to confirm it." : "Sign in to your proposals, jobs, customers and prices."}</p>
      <input type="email" id="authEmail" placeholder="Email" autocomplete="username" required value="info@halo.je">
      <input type="password" id="authPass" placeholder="Password" autocomplete="${signUp ? "new-password" : "current-password"}" required minlength="8">
      <button type="submit">${signUp ? "Create login" : "Sign in"}</button>
      <div class="msg" id="authMsg"></div>
      <button type="button" class="ghost" id="authSwap">${signUp ? "I already have a login" : "First time? Create your login"}</button>
      ${signUp ? "" : `<button type="button" class="ghost" id="authReset">Forgotten your password?</button>`}
    </form>`;
      const msg = (t, err)=>{ const m = w.querySelector("#authMsg"); m.textContent = t; m.classList.toggle("err", !!err); };
      w.querySelector("#authSwap").onclick = ()=>{ signUp = !signUp; draw(); };
      const rs = w.querySelector("#authReset");
      if(rs) rs.onclick = async ()=>{ const email = w.querySelector("#authEmail").value.trim(); if(!email){ msg("Enter your email first.", true); return; }
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        msg(error ? error.message : "Check your email for a link to set a new password.", !!error); };
      w.querySelector("#authForm").onsubmit = async e=>{
        e.preventDefault(); const email = w.querySelector("#authEmail").value.trim(), password = w.querySelector("#authPass").value;
        msg(signUp ? "Creating…" : "Signing in…");
        if(signUp){ const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
          if(error){ msg(error.message, true); return; }
          if(data.session){ start(data.session); return; }
          msg("Check your email and tap the confirm link, then come back and sign in."); signUp = false; setTimeout(draw, 3500); return; }
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if(error){ msg(error.message === "Invalid login credentials" ? "That email and password don't match." : error.message, true); return; }
        start(data.session);
      };
    };
    draw(); document.body.appendChild(w);
  }
  async function start(s){
    session = s; const w = document.getElementById("authWrap"); if(w) w.remove();
    const { data } = await sb.from("members").select("email,role").limit(1);
    if(!data || !data.length){ css(); const d = document.createElement("div"); d.className = "authwrap"; d.innerHTML = `<div class="authbox"><h1>No access yet</h1><p>${s.user.email} isn't set up for Studio. Ask Ian to add you.</p><button id="authOut">Sign out</button></div>`; document.body.appendChild(d); d.querySelector("#authOut").onclick = async ()=>{ await sb.auth.signOut(); location.reload(); }; return; }
    readyResolve(true);
  }
  sb.auth.onAuthStateChange((ev, s)=>{
    if(ev === "PASSWORD_RECOVERY"){ const p = prompt("Choose a new password (8+ characters)"); if(p) sb.auth.updateUser({ password: p }).then(({ error })=>alert(error ? error.message : "Password updated.")); }
    if(ev === "SIGNED_OUT"){ location.reload(); }
  });
  sb.auth.getSession().then(({ data })=>{ if(data.session) start(data.session); else { const go = ()=>showLogin(); document.body ? go() : addEventListener("DOMContentLoaded", go); } });
  window.studioSignOut = async ()=>{ await sb.auth.signOut(); };

  /* ---------- document store ---------- */
  const store = new Map();          // collection -> Map(id -> data)
  const loaded = new Map();         // collection -> Promise
  const subs = new Map();           // collection -> Set(fn)
  const outbox = lsGet(LSK + "outbox") || [];
  let online = navigator.onLine !== false;
  const saveCache = c => { const m = store.get(c); if(m) lsSet(LSK + "c:" + c, [...m.entries()]); };
  const emit = c => { (subs.get(c) || new Set()).forEach(fn=>{ try{ fn(); }catch(e){ console.error(e); } }); };
  function coll(c){ if(!store.has(c)){ const cached = lsGet(LSK + "c:" + c); store.set(c, new Map(cached || [])); } return store.get(c); }
  async function fetchCollection(c){
    const all = []; let from = 0;
    for(;;){ const { data, error } = await sb.from("docs").select("id,data").eq("collection", c).range(from, from + 999); if(error) throw error; all.push(...data); if(data.length < 1000) break; from += 1000; }
    const m = coll(c); const pending = new Set(outbox.filter(o=>o.collection === c).map(o=>o.id));
    const next = new Map(all.map(r=>[r.id, r.data]));
    pending.forEach(id=>{ if(m.has(id)) next.set(id, m.get(id)); else next.delete(id); });
    store.set(c, next); saveCache(c); emit(c);
  }
  function ensure(c){ if(!loaded.has(c)) loaded.set(c, ready.then(()=>fetchCollection(c)).catch(e=>{ console.warn("load", c, e); emit(c); })); return loaded.get(c); }
  async function flush(){
    if(!outbox.length || !online) return;
    while(outbox.length){
      const o = outbox[0];
      const r = o.op === "del" ? await sb.from("docs").delete().eq("collection", o.collection).eq("id", o.id)
                               : await sb.from("docs").upsert({ collection: o.collection, id: o.id, data: o.data });
      if(r.error){ console.warn("sync", r.error); if(/fetch|network|Failed/i.test(r.error.message || "")){ online = false; } break; }
      outbox.shift(); lsSet(LSK + "outbox", outbox);
    }
  }
  addEventListener("online", ()=>{ online = true; flush(); [...loaded.keys()].forEach(c=>fetchCollection(c).catch(()=>{})); });
  addEventListener("offline", ()=>{ online = false; });
  setInterval(()=>{ if(outbox.length){ online = true; flush(); } }, 15000);
  function write(c, id, data){
    const m = coll(c); if(data === null) m.delete(id); else m.set(id, clone(data)); saveCache(c); emit(c);
    for(let i = outbox.length - 1; i >= 0; i--) if(outbox[i].collection === c && outbox[i].id === id) outbox.splice(i, 1);
    outbox.push(data === null ? { op: "del", collection: c, id } : { op: "set", collection: c, id, data: clone(data) });
    lsSet(LSK + "outbox", outbox);
    return ready.then(flush);
  }
  /* realtime: other devices' changes */
  ready.then(()=>{
    sb.channel("docs").on("postgres_changes", { event: "*", schema: "public", table: "docs" }, p=>{
      const row = p.new && p.new.collection ? p.new : p.old; if(!row || !row.collection) return;
      const c = row.collection; if(!store.has(c)) return;
      if(outbox.some(o=>o.collection === c && o.id === row.id)) return;
      const m = coll(c);
      if(p.eventType === "DELETE") m.delete(row.id); else m.set(row.id, p.new.data);
      saveCache(c); emit(c);
    }).subscribe();
    flush();
  });
  const docSnap = (id, data)=>({ id, exists: data !== undefined, data: ()=>clone(data) });
  function query(c, order){
    const run = ()=>{ let rows = [...coll(c).entries()].map(([id, d])=>docSnap(id, d));
      if(order){ const [f, dir] = order; rows.sort((a,b)=>{ const x = (a.data() || {})[f], y = (b.data() || {})[f]; return (x > y ? 1 : x < y ? -1 : 0) * (dir === "desc" ? -1 : 1); }); }
      return { docs: rows, size: rows.length, empty: !rows.length }; };
    return {
      orderBy: (f, dir)=>query(c, [f, dir || "asc"]),
      limit: ()=>query(c, order),
      onSnapshot(cb, err){ const fn = ()=>cb(run()); if(!subs.has(c)) subs.set(c, new Set()); subs.get(c).add(fn); if(coll(c).size) setTimeout(fn, 0); ensure(c).then(()=>{}, e=>err && err(e)); return ()=>subs.get(c).delete(fn); },
      async get(){ await ensure(c); return run(); }
    };
  }
  function docRef(c, id){
    return {
      id,
      set: data=>write(c, id, data),
      update: patch=>write(c, id, Object.assign({}, coll(c).get(id) || {}, patch)),
      delete: ()=>write(c, id, null),
      async get(){ await ensure(c); return docSnap(id, coll(c).get(id)); },
      onSnapshot(cb, err){ const fn = ()=>cb(docSnap(id, coll(c).get(id))); if(!subs.has(c)) subs.set(c, new Set()); subs.get(c).add(fn); if(coll(c).size) setTimeout(fn, 0); ensure(c).then(()=>{}, e=>err && err(e)); return ()=>subs.get(c).delete(fn); }
    };
  }
  const db = Object.freeze({
    collection: c=>Object.assign(query(c), { doc: id=>docRef(c, id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7))) }),
    doc: path=>{ const { collection, id } = split(path); return docRef(collection, id); }
  });

  /* ---------- files (photos, plans, PDFs) ---------- */
  const TEN_YEARS = 60 * 60 * 24 * 365 * 10;
  const assets = Object.freeze({
    async upload(blob){
      await ready;
      const type = blob.type || "application/octet-stream";
      const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf", "image/svg+xml": "svg" })[type] || (blob.name && blob.name.split(".").pop()) || "bin";
      const path = `u/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
      const up = await sb.storage.from("files").upload(path, blob, { contentType: type, upsert: false });
      if(up.error) throw { code: /size|large/i.test(up.error.message) ? "too_large" : "upload_failed", message: up.error.message };
      const sg = await sb.storage.from("files").createSignedUrl(path, TEN_YEARS);
      if(sg.error) throw { code: "upload_failed", message: sg.error.message };
      return { id: path, url: sg.data.signedUrl, sizeBytes: blob.size, contentType: type };
    },
    async list(){ return { assets: [], usage: {} }; },
    async delete(id){ await sb.storage.from("files").remove([id]); }
  });

  /* ---------- downloads: real files on this device ---------- */
  const downloads = Object.freeze({
    async save({ filename, data }){
      const blob = data instanceof Blob ? data : new Blob([data], { type: /\.json$/i.test(filename) ? "application/json" : /\.csv$/i.test(filename) ? "text/csv" : /\.html?$/i.test(filename) ? "text/html" : "application/octet-stream" });
      const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
      if(standalone && navigator.canShare){ try{ const f = new File([blob], filename, { type: blob.type }); if(navigator.canShare({ files: [f] })){ await navigator.share({ files: [f] }); return { status: "saved" }; } }catch(e){ if(e && e.name === "AbortError") throw { code: "declined" }; } }
      const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 30000);
      return { status: "saved" };
    }
  });

  const user = Object.freeze({
    isOwner: ()=>true, canEdit: ()=>true, can: ()=>true,
    async id(){ return session && session.user.id; },
    async me(){ return { id: session && session.user.id, name: "Ian Lamont", email: session && session.user.email }; },
    async profiles(ids){ const o = {}; (ids || []).forEach(i=>o[i] = { name: "" }); return o; }
  });

  /* ---------- integrations: Outlook + Xero through the server function ---------- */
  const API = SB_URL + "/functions/v1/api";
  async function api(path, body){
    await ready;
    const { data } = await sb.auth.getSession(); const tok = data.session && data.session.access_token;
    let r;
    try{ r = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: "Bearer " + tok }, body: JSON.stringify(body || {}) }); }
    catch(_){ throw { code: navigator.onLine === false ? "offline" : "server_unavailable", message: "Couldn't reach the server." }; }
    const j = await r.json().catch(()=>({}));
    if(!r.ok || j.error){ const e = j.error || {}; throw { code: e.code || (r.status >= 500 ? "upstream_error" : "tool_error"), message: e.message || ("Server error " + r.status) }; }
    return j;
  }
  /* The app was written against claude.ai connector tools; map those calls onto our own server. */
  const MS_MAP = { outlook_calendar_search: "calendar_search", outlook_create_event: "create_event", outlook_update_event: "update_event", outlook_delete_event: "delete_event", outlook_send_mail: "send_mail" };
  const XERO_MAP = { new_sales_invoice: "create_invoice", add_or_update_stock_items: "upsert_items" };
  const mcp = Object.freeze({
    async callTool(server, tool, input){
      let provider, action, payload = input || {};
      if(server === "Microsoft 365" && MS_MAP[tool]){ provider = "ms"; action = MS_MAP[tool]; }
      else if(server === "Zapier" && tool === "execute_zapier_write_action" && XERO_MAP[payload.action]){ provider = "xero"; action = XERO_MAP[payload.action]; payload = payload.params || {}; }
      else if(server === "Xero"){ provider = "xero"; action = tool; }
      else throw { code: "not_in_manifest", message: "Not available in this app." };
      const { result } = await api("/call", { provider, action, input: payload });
      return { structuredContent: result, content: [] };
    },
    async listTools(){ return []; }
  });
  window.studioConnections = Object.freeze({
    status: ()=>api("/status"),
    async connect(provider){ const { url } = await api(`/connect/${provider}/start`); location.href = url; },
    disconnect: provider=>api("/disconnect", { provider })
  });
  /* Coming back from Microsoft / Xero sign-in: remember the result, tidy the address bar. */
  try{
    const q = new URLSearchParams(location.search);
    if(q.get("connect")){
      window.studioConnectResult = { provider: q.get("connect"), ok: q.get("ok") === "1", error: q.get("error") || "" };
      history.replaceState(null, "", location.pathname + location.hash);
    }
  }catch(_){}

  /* Claude drafting (sample) arrives in a later phase. */
  const caps = { db, assets, downloads, user, mcp };
  window.claude = Object.freeze({ use: async name=>{ if(name === "db" || name === "assets"){ await ready; } return caps[name] || null; } });
})();
