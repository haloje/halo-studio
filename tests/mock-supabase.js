// In-memory stand-in for supabase-js used by tests (the real service isn't reachable from the build machine).
window.__rows = window.__rows || [];
window.supabase = { createClient(){
  const listeners = [];
  const q = (table)=>{
    const st = { table, filters: [], from: 0, to: 1e9 };
    const api = {
      select(){ return api; }, eq(k,v){ st.filters.push([k,v]); return api; }, limit(){ return api; },
      range(a,b){ st.from=a; st.to=b; return api; },
      then(res){ let rows = st.table==="members" ? [{email:"info@halo.je",role:"owner"}] : __rows.filter(r=>st.filters.every(([k,v])=>r[k]===v));
        if(st.del){ __rows = __rows.filter(r=>!st.filters.every(([k,v])=>r[k]===v)); return Promise.resolve({ data:null, error:null }).then(res); }
        return Promise.resolve({ data: rows.slice(st.from, st.to+1).map(r=>r.data===undefined?r:({id:r.id,data:JSON.parse(JSON.stringify(r.data))})), error:null }).then(res); },
      upsert(row){ const i = __rows.findIndex(r=>r.collection===row.collection&&r.id===row.id); if(i>=0) __rows[i]=row; else __rows.push(row); window.__writes=(window.__writes||0)+1; return Promise.resolve({ error:null }); },
      delete(){ st.del = true; return api; }
    };
    return api;
  };
  return {
    from: q,
    channel(){ const ch = { on(){ return ch; }, subscribe(){ return ch; } }; return ch; },
    auth: { getSession: async()=>({ data:{ session: window.__noSession ? null : { user:{ id:"u1", email:"info@halo.je" } } } }), onAuthStateChange(){}, signInWithPassword: async()=>({ data:{ session:{ user:{ id:"u1", email:"info@halo.je" } } }, error:null }), signOut: async()=>({}) },
    storage: { from(){ return { upload: async(p)=>({ data:{ path:p }, error:null }), createSignedUrl: async(p)=>({ data:{ signedUrl:"https://signed.example/"+p }, error:null }), remove: async()=>({}) }; } }
  };
} };
