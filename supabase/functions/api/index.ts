// halo.je Studio API: Microsoft 365 (Outlook calendar + mail) and Xero, called by the app.
// Routes:
//   POST /api/connect/{ms|xero}/start     (signed-in member)  -> { url } to the provider's consent screen
//   GET  /api/connect/{ms|xero}/callback  (provider redirect)  -> stores tokens, sends you back to the app
//   POST /api/status                      (signed-in member)  -> which connections are live
//   POST /api/disconnect                  (signed-in member)  -> { provider }
//   POST /api/call                        (signed-in member)  -> { provider, action, input }
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") || "https://haloje.github.io/halo-studio/";
const MS_TENANT = Deno.env.get("MS_TENANT_ID") || "organizations";
const MS_ID = Deno.env.get("MS_CLIENT_ID") || "";
const MS_SECRET = Deno.env.get("MS_CLIENT_SECRET") || "";
const XERO_ID = Deno.env.get("XERO_CLIENT_ID") || "";
const XERO_SECRET = Deno.env.get("XERO_CLIENT_SECRET") || "";
const FN_BASE = `${SB_URL}/functions/v1/api`;
const MS_SCOPES = "offline_access openid email User.Read Calendars.ReadWrite Mail.Send Mail.Read";
const MS_SCOPES_V1 = "offline_access openid email User.Read Calendars.ReadWrite Mail.Send"; // what connections made before Mail.Read were granted
const XERO_SCOPES = "openid profile email offline_access accounting.invoices accounting.contacts accounting.settings";

const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ error: { code, message } }, status);
class ApiError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }

async function member(req: Request): Promise<string> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new ApiError("not_signed_in", "Sign in first.", 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user?.email) throw new ApiError("not_signed_in", "Sign in again.", 401);
  const { data: m } = await admin.from("members").select("email").ilike("email", data.user.email).maybeSingle();
  if (!m) throw new ApiError("not_member", "This login isn't set up for Studio.", 403);
  return data.user.email;
}
async function getConn(provider: string) { const { data } = await admin.from("integrations").select("data").eq("provider", provider).maybeSingle(); return data?.data || null; }
async function setConn(provider: string, d: Record<string, unknown>) { await admin.from("integrations").upsert({ provider, data: d, updated_at: new Date().toISOString() }); }
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

/* ---------- OAuth ---------- */
function authorizeUrl(provider: string, state: string) {
  if (provider === "ms") return `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/authorize?` + form({ client_id: MS_ID, response_type: "code", redirect_uri: `${FN_BASE}/connect/ms/callback`, response_mode: "query", scope: MS_SCOPES, state, prompt: "select_account" });
  if (provider === "xero") return "https://login.xero.com/identity/connect/authorize?" + form({ client_id: XERO_ID, response_type: "code", redirect_uri: `${FN_BASE}/connect/xero/callback`, scope: XERO_SCOPES, state });
  throw new ApiError("bad_provider", "Unknown connection.");
}
async function tokenRequest(provider: string, params: Record<string, string>, scope?: string) {
  const url = provider === "ms" ? `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token` : "https://identity.xero.com/connect/token";
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  const body: Record<string, string> = { ...params };
  if (provider === "ms") { body.client_id = MS_ID; body.client_secret = MS_SECRET; body.scope = scope || MS_SCOPES; }
  else headers.Authorization = "Basic " + btoa(`${XERO_ID}:${XERO_SECRET}`);
  const r = await fetch(url, { method: "POST", headers, body: form(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError("auth_failed", j.error_description || j.error || `Token request failed (${r.status})`, 400);
  return j;
}
async function accessToken(provider: string): Promise<{ token: string; conn: Record<string, any> }> {
  const conn = await getConn(provider);
  if (!conn?.refresh_token) throw new ApiError("not_connected", provider === "ms" ? "Microsoft 365 isn't connected yet." : "Xero isn't connected yet.", 409);
  if (conn.access_token && conn.expires_at && Date.now() < conn.expires_at - 60_000) return { token: conn.access_token, conn };
  try {
    const t = await tokenRequest(provider, { grant_type: "refresh_token", refresh_token: conn.refresh_token }, provider === "ms" ? (conn.scope || MS_SCOPES_V1) : undefined);
    const next = { ...conn, access_token: t.access_token, refresh_token: t.refresh_token || conn.refresh_token, expires_at: Date.now() + (t.expires_in || 1800) * 1000 };
    await setConn(provider, next);
    return { token: next.access_token, conn: next };
  } catch (e) {
    throw new ApiError("needs_reauth", (provider === "ms" ? "Microsoft 365" : "Xero") + " needs reconnecting. " + ((e as Error).message || ""), 409);
  }
}

/* ---------- Microsoft Graph ---------- */
async function graph(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const { token } = await accessToken("ms");
  const r = await fetch("https://graph.microsoft.com/v1.0" + path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extra }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204 || r.status === 202) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError("tool_error", j?.error?.message || `Outlook error ${r.status}`, 400);
  return j;
}
const evOut = (e: any) => ({ id: e.id, subject: e.subject, start: e.start, end: e.end, location: e.location?.displayName || "", webLink: e.webLink, isAllDay: e.isAllDay, isCancelled: e.isCancelled, showAs: e.showAs });
const evIn = (i: any) => { const o: any = {}; if (i.subject) o.subject = i.subject; if (i.start) o.start = i.start; if (i.end) o.end = i.end; if (i.location != null) o.location = { displayName: i.location };
  if (i.body != null) o.body = { contentType: i.bodyType === "html" ? "HTML" : "Text", content: i.body }; if (i.showAs) o.showAs = i.showAs; return o; };
async function msCall(action: string, i: any) {
  if (action === "calendar_search") {
    const start = new Date((i.afterDateTime || "").slice(0, 10) + "T00:00:00Z").toISOString(), end = new Date((i.beforeDateTime || "").slice(0, 10) + "T00:00:00Z").toISOString();
    const out: any[] = []; let next = `/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$top=100&$orderby=start/dateTime&$select=id,subject,start,end,location,webLink,isAllDay,isCancelled,showAs`;
    for (let k = 0; k < 5 && next; k++) { const j: any = await graph("GET", next.replace("https://graph.microsoft.com/v1.0", ""), undefined, { Prefer: 'outlook.timezone="GMT Standard Time"' }); out.push(...(j.value || []).map(evOut)); next = j["@odata.nextLink"] || ""; }
    return { events: out, moreResults: false };
  }
  if (action === "create_event") { const e: any = await graph("POST", "/me/events", evIn(i)); return { id: e.id, webLink: e.webLink }; }
  if (action === "update_event") { if (!i.eventId) throw new ApiError("bad_request", "eventId missing"); const e: any = await graph("PATCH", `/me/events/${encodeURIComponent(i.eventId)}`, evIn(i)); return { id: e.id || i.eventId, webLink: e.webLink }; }
  if (action === "delete_event") { if (!i.eventId) throw new ApiError("bad_request", "eventId missing"); try { await graph("DELETE", `/me/events/${encodeURIComponent(i.eventId)}`); } catch (e) { if (!/not found/i.test((e as Error).message)) throw e; } return { deleted: true }; }
  if (action === "send_mail") {
    const to = (i.to || []).filter(Boolean); if (!to.length) throw new ApiError("bad_request", "No recipient.");
    const message: any = { subject: i.subject || "", body: { contentType: i.bodyType === "html" ? "HTML" : "Text", content: i.body || "" }, toRecipients: to.map((a: string) => ({ emailAddress: { address: a } })) };
    if (i.cc?.length) message.ccRecipients = i.cc.map((a: string) => ({ emailAddress: { address: a } }));
    if (i.attachments?.length) message.attachments = i.attachments.map((a: any) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentType: a.contentType || "application/octet-stream", contentBytes: a.contentBytes }));
    await graph("POST", "/me/sendMail", { message, saveToSentItems: true });
    return { sent: true };
  }
  if (action === "planning_sync") return await planningSync(i);
  throw new ApiError("bad_request", "Unknown Outlook action.");
}

/* ---------- Planning leads: Government of Jersey planning notification emails ---------- */
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const REF_RE = /\b([A-Z]{1,4}\/\d{4}\/\d{3,5})\b/;
function parseNotification(html: string) {
  const out: { ref: string; address: string; kind: string; label: string; url: string }[] = [];
  const parts = html.split(/<h3[^>]*>/i).slice(1);
  for (const part of parts) {
    const head = decode(part.split(/<\/h3>/i)[0].replace(/<[^>]+>/g, "")).trim();
    const kind = /approved/i.test(head) ? "approved" : /refused|rejected/i.test(head) ? "refused" : /withdrawn/i.test(head) ? "withdrawn" : /^new planning/i.test(head) ? "new" : /document/i.test(head) ? "docs" : "update";
    for (const m of part.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const text = decode(m[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim(), r = text.match(REF_RE);
      if (!r) continue;
      const before = text.slice(0, r.index).trim(), after = text.slice((r.index || 0) + r[1].length).replace(/^[,\s]+/, "").trim();
      out.push({ ref: r[1], address: after, kind, label: kind === "docs" ? (before || "New documents") : head, url: decode(m[1]) });
    }
  }
  return out;
}
function gazetteFields(html: string) {
  const text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>|<\/(p|div|td|th|tr|li|h\d|dt|dd|span|label|strong|b)>/gi, "\n").replace(/<[^>]+>/g, ""));
  const lines = text.split("\n").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  const LABELS = ["description", "applicant", "agent company", "agent", "address", "reference", "planning application", "published by", "type", "date published"];
  const get = (label: string) => { const i = lines.findIndex((l) => l.toLowerCase().replace(/:$/, "") === label); if (i < 0) return ""; const v = lines[i + 1] || ""; return LABELS.includes(v.toLowerCase().replace(/:$/, "")) ? "" : v; };
  return { description: get("description"), applicant: get("applicant"), agent: get("agent company") || get("agent") };
}
async function planningSync(i: any) {
  const { conn } = await accessToken("ms");
  if (!/mail\.read\b/i.test(String(conn.scope || ""))) throw new ApiError("needs_reauth", "Studio needs permission to read the planning emails. Press Reconnect for Microsoft 365 in Reports › Connections, then try again.", 409);
  const { data: st } = await admin.from("docs").select("data").eq("collection", "settings").eq("id", "planning").maybeSingle();
  const state: any = st?.data || {};
  const since = i.since || state.lastReceived || new Date(Date.now() - (i.days || 365) * 864e5).toISOString();
  const filter = `receivedDateTime gt ${since} and from/emailAddress/address eq 'noreply@gov.je'`;
  let next = `/me/messages?$filter=${encodeURIComponent(filter)}&$orderby=receivedDateTime asc&$select=id,subject,receivedDateTime,body&$top=20`;
  const found = new Map<string, any>(); let last = since, msgs = 0, more = false;
  for (let k = 0; k < 3 && next; k++) {
    const j: any = await graph("GET", next.replace("https://graph.microsoft.com/v1.0", ""));
    for (const m of j.value || []) {
      msgs++; last = m.receivedDateTime || last;
      if (!/planning/i.test(m.subject || "")) continue;
      const day = String(m.receivedDateTime || "").slice(0, 10);
      for (const e of parseNotification(m.body?.content || "")) {
        const f = found.get(e.ref) || { ref: e.ref, address: e.address, events: [] as any[] };
        if (!f.address && e.address) f.address = e.address;
        f.events.push({ kind: e.kind, label: e.label, date: day }); found.set(e.ref, f);
      }
    }
    next = j["@odata.nextLink"] || ""; more = !!next;
  }
  let added = 0, updated = 0;
  const refs = [...found.keys()], ids = refs.map((r) => r.replace(/\//g, "-").toLowerCase());
  const existing = new Map<string, any>();
  for (let k = 0; k < ids.length; k += 100) { const { data } = await admin.from("docs").select("id,data").eq("collection", "leads").in("id", ids.slice(k, k + 100)); (data || []).forEach((r: any) => existing.set(r.id, r.data)); }
  const rows: any[] = [];
  refs.forEach((ref, n) => {
    const f = found.get(ref), id = ids[n], cur = existing.get(id);
    if (!cur && !f.events.some((e: any) => e.kind !== "docs")) return; // documents-only notices update leads we already have
    const d: any = cur ? { ...cur } : { id, ref, type: ref.split("/")[0], status: "new", notes: "", created: Date.now() };
    if (!d.address && f.address) d.address = f.address;
    const pms = [...String(d.address || "").matchAll(/\b(St\.? ?(?:Helier|Saviour|Clement|Lawrence|Brelade|Peter|Ouen|Mary|John|Martin)|Grouville|Trinity)\b/g)]; if (pms.length && !d.parish) d.parish = pms[pms.length - 1][1].replace(/^St\.? ?/, "St. ");
    const ev = (d.events || []).slice();
    for (const e of f.events) if (!ev.some((x: any) => x.kind === e.kind && x.date === e.date && x.label === e.label)) ev.push(e);
    ev.sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
    d.events = ev.slice(-30); d.firstSeen = d.firstSeen || ev[0]?.date || ""; d.lastSeen = ev[ev.length - 1]?.date || d.lastSeen || "";
    if (ev.some((e: any) => e.kind === "approved")) d.stage = "approved"; else if (ev.some((e: any) => e.kind === "refused")) d.stage = "refused"; else if (!d.stage) d.stage = "submitted";
    if (cur && cur.status && cur.status !== "new" && f.events.some((e: any) => e.kind === "approved") && !(cur.events || []).some((e: any) => e.kind === "approved")) d.flagApproved = true;
    d.updated = Date.now(); cur ? updated++ : added++;
    rows.push({ collection: "leads", id, data: d, updated_at: new Date().toISOString(), updated_by: "planning-sync" });
  });
  for (let k = 0; k < rows.length; k += 200) { const { error } = await admin.from("docs").upsert(rows.slice(k, k + 200)); if (error) throw new ApiError("tool_error", "Couldn't save leads: " + error.message, 500); }
  await admin.from("docs").upsert({ collection: "settings", id: "planning", data: { ...state, lastReceived: last, lastRun: new Date().toISOString() }, updated_at: new Date().toISOString(), updated_by: "planning-sync" });
  /* details from the Gazette page (description, applicant, agent) for a few leads per run */
  let enriched = 0;
  const want = (i.refs || []) as string[];
  let q = admin.from("docs").select("id,data").eq("collection", "leads");
  q = want.length ? q.in("id", want.map((r) => r.replace(/\//g, "-").toLowerCase())) : q.is("data->gz", null).order("updated_at", { ascending: false }).limit(12);
  const { data: todo } = await q;
  for (const r of todo || []) {
    const d: any = r.data; if (d.gz && !want.length) continue;
    try {
      const res = await fetch(`https://www.gov.je/gazette/Pages/PlanningApplication-${String(d.ref).replace(/\//g, "")}.aspx`, { headers: { "User-Agent": "Mozilla/5.0 halo.je Studio" } });
      if (res.ok) { const g = gazetteFields(await res.text()); if (g.description) d.description = g.description; if (g.applicant) d.applicant = g.applicant; if (g.agent) d.agent = g.agent; }
      d.gz = res.ok ? "ok" : String(res.status);
    } catch (_) { d.gz = "err"; }
    await admin.from("docs").update({ data: d, updated_at: new Date().toISOString(), updated_by: "planning-sync" }).eq("collection", "leads").eq("id", r.id);
    enriched++;
  }
  const { count } = await admin.from("docs").select("id", { count: "exact", head: true }).eq("collection", "leads").is("data->gz", null);
  return { messages: msgs, added, updated, enriched, more: more || (count || 0) > 0, pendingDetails: count || 0, lastReceived: last };
}

/* ---------- Xero ---------- */
async function xero(method: string, path: string, body?: unknown) {
  const { token, conn } = await accessToken("xero");
  if (!conn.tenantId) throw new ApiError("not_connected", "Xero is connected but no organisation was chosen. Connect again.", 409);
  const r = await fetch("https://api.xero.com/api.xro/2.0" + path, { method, headers: { Authorization: `Bearer ${token}`, "Xero-tenant-id": conn.tenantId, Accept: "application/json", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 400) throw new ApiError("tool_error", j?.Detail || j?.Message || j?.Title || `Xero error ${r.status}`, 400);
  return { status: r.status, body: j };
}
const xeroErrors = (o: any) => (o?.ValidationErrors || []).map((v: any) => v.Message).join("; ");
async function xeroCall(action: string, p: any) {
  if (action === "create_invoice") {
    const inv: any = { Type: "ACCREC", Contact: { Name: p.contact_name }, Date: p.date, DueDate: p.due_date, Reference: p.reference || "", Status: (p.status || "draft").toUpperCase() === "AUTHORISED" ? "AUTHORISED" : "DRAFT", LineAmountTypes: "NoTax", CurrencyCode: p.currency || "GBP",
      LineItems: (p.line_items || []).map((l: any) => { const o: any = { Description: l.line_description, Quantity: l.line_quantity, UnitAmount: l.line_unit_amount, AccountCode: l.line_account_code || "200" }; if (l.line_tax_type) o.TaxType = l.line_tax_type; return o; }) };
    if (p.email_address) inv.Contact.EmailAddress = p.email_address;
    if (p.number) inv.InvoiceNumber = p.number;
    const r = await xero("POST", "/Invoices?summarizeErrors=false", { Invoices: [inv] });
    const out = r.body?.Invoices?.[0];
    if (!out || out.HasErrors || r.status === 400) throw new ApiError("tool_error", xeroErrors(out) || r.body?.Message || "Xero refused the invoice.", 400);
    return { results: [{ InvoiceID: out.InvoiceID, InvoiceNumber: out.InvoiceNumber, Status: out.Status, Total: out.Total }] };
  }
  if (action === "upsert_items") {
    const items = (p.line_items || []).map((l: any) => { const o: any = { Code: l.item_code, Name: l.item_name, Description: l.item_description || l.item_name, IsSold: true, IsTrackedAsInventory: false,
        SalesDetails: { UnitPrice: l.sales_unit_price ?? 0, AccountCode: l.sales_account_code || "200", TaxType: l.sales_tax_type || "NONE" } };
      if (l.is_purchased) { o.IsPurchased = true; o.PurchaseDescription = l.purchase_description || o.Description; o.PurchaseDetails = { UnitPrice: l.purchase_unit_price ?? 0, AccountCode: l.purchase_account_code || "310", TaxType: l.purchase_tax_type || "INPUT" }; }
      return o; });
    const r = await xero("POST", "/Items?summarizeErrors=false", { Items: items });
    const res = (r.body?.Items || []).map((it: any) => ({ Code: it.Code, ItemID: it.ItemID, error: it.ValidationErrors?.length ? xeroErrors(it) : "" }));
    const bad = res.filter((x: any) => x.error);
    if (bad.length && bad.length === res.length) throw new ApiError("tool_error", bad.map((b: any) => `${b.Code}: ${b.error}`).join("; "), 400);
    return { results: res };
  }
  if (action === "invoice_status") {
    const ids = (p.ids || []).filter(Boolean).slice(0, 40); if (!ids.length) return { results: [] };
    const r = await xero("GET", `/Invoices?IDs=${ids.map(encodeURIComponent).join(",")}`);
    return { results: (r.body?.Invoices || []).map((x: any) => ({ InvoiceID: x.InvoiceID, InvoiceNumber: x.InvoiceNumber, Status: x.Status, AmountDue: x.AmountDue, AmountPaid: x.AmountPaid, Total: x.Total })) };
  }
  throw new ApiError("bad_request", "Unknown Xero action.");
}

/* ---------- router ---------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/api/, "") || "/";
  try {
    let m = path.match(/^\/connect\/(ms|xero)\/start$/);
    if (m && req.method === "POST") {
      const email = await member(req), provider = m[1];
      if (provider === "ms" && (!MS_ID || !MS_SECRET)) throw new ApiError("not_configured", "The Microsoft app keys haven't been added yet.");
      if (provider === "xero" && (!XERO_ID || !XERO_SECRET)) throw new ApiError("not_configured", "The Xero app keys haven't been added yet.");
      const state = crypto.randomUUID();
      await admin.from("oauth_states").insert({ state, provider, email });
      return json({ url: authorizeUrl(provider, state) });
    }
    m = path.match(/^\/connect\/(ms|xero)\/callback$/);
    if (m) {
      const provider = m[1], code = url.searchParams.get("code"), state = url.searchParams.get("state") || "";
      const back = (q: string) => Response.redirect(APP_URL + (APP_URL.includes("?") ? "&" : "?") + q, 302);
      if (url.searchParams.get("error")) return back(`connect=${provider}&error=${encodeURIComponent(url.searchParams.get("error_description") || url.searchParams.get("error") || "")}`);
      const { data: st } = await admin.from("oauth_states").select("*").eq("state", state).eq("provider", provider).maybeSingle();
      if (!st || Date.now() - new Date(st.created_at).getTime() > 15 * 60_000 || !code) return back(`connect=${provider}&error=expired`);
      await admin.from("oauth_states").delete().eq("state", state);
      const t = await tokenRequest(provider, { grant_type: "authorization_code", code, redirect_uri: `${FN_BASE}/connect/${provider}/callback` });
      const conn: Record<string, unknown> = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in || 1800) * 1000, connected_by: st.email, connected_at: new Date().toISOString() };
      if (provider === "ms") {
        const me = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName", { headers: { Authorization: `Bearer ${t.access_token}` } }).then((r) => r.json()).catch(() => ({}));
        conn.account = me.mail || me.userPrincipalName || ""; conn.name = me.displayName || "";
        conn.scope = "offline_access " + String(t.scope || MS_SCOPES).replace(/https:\/\/graph\.microsoft\.com\//g, "").replace(/\boffline_access\b/g, "").replace(/\s+/g, " ").trim();
      } else {
        const cs = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${t.access_token}` } }).then((r) => r.json()).catch(() => []);
        const org = (Array.isArray(cs) ? cs : []).find((c: any) => c.tenantType === "ORGANISATION") || (Array.isArray(cs) ? cs[0] : null);
        conn.tenantId = org?.tenantId || ""; conn.account = org?.tenantName || "";
      }
      await setConn(provider, conn);
      return back(`connect=${provider}&ok=1`);
    }
    if (path === "/status" && req.method === "POST") {
      await member(req);
      const { data } = await admin.from("integrations").select("provider,data,updated_at");
      const out: Record<string, unknown> = { ms: { configured: !!(MS_ID && MS_SECRET), connected: false }, xero: { configured: !!(XERO_ID && XERO_SECRET), connected: false } };
      (data || []).forEach((r: any) => { out[r.provider] = { ...(out[r.provider] as object), connected: !!r.data?.refresh_token, account: r.data?.account || "", since: r.data?.connected_at || r.updated_at }; });
      return json(out);
    }
    if (path === "/disconnect" && req.method === "POST") {
      await member(req); const { provider } = await req.json();
      await admin.from("integrations").delete().eq("provider", provider);
      return json({ ok: true });
    }
    if (path === "/call" && req.method === "POST") {
      await member(req);
      const { provider, action, input } = await req.json();
      const result = provider === "ms" ? await msCall(action, input || {}) : provider === "xero" ? await xeroCall(action, input || {}) : (() => { throw new ApiError("bad_provider", "Unknown connection."); })();
      return json({ result });
    }
    return fail("not_found", "No such route.", 404);
  } catch (e) {
    if (e instanceof ApiError) return fail(e.code, e.message, e.status);
    console.error(e);
    return fail("upstream_error", (e as Error).message || "Something went wrong.", 500);
  }
});
