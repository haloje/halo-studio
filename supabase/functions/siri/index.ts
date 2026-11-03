// halo.je Studio: Siri commands from the iPhone app, authenticated by the phone's device key.
//   POST /siri/clock  { action: "on" | "off", at: "YYYY-MM-DD HH:MM" }  -> { message }
//   POST /siri/todo   { text, at }                                      -> { message }
//   POST /siri/day    { at }                                            -> { message }
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const say = (message: string) => json({ message });
async function sha256(t: string) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
const mins = (t: string) => { const [h, m] = String(t || "").split(":").map(Number); return isFinite(h) ? h * 60 + (m || 0) : 0; };
function localNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const spokenTime = (t: string) => { const [h, m] = t.split(":").map(Number); const hh = ((h + 11) % 12) + 1, ap = h < 12 ? "am" : "pm"; return m ? `${hh}:${String(m).padStart(2, "0")} ${ap}` : `${hh} ${ap}`; };
const place = (j: any) => String(j.site || j.address || j.customer || "the site").split(/\n|,/)[0].trim();
const OPEN = ["To Book", "Scheduled", "In Progress", "On Hold"];

async function who(req: Request) {
  const key = req.headers.get("X-Device-Key") || ""; if (key.length < 32) return null;
  const { data } = await admin.from("devices").select("email").eq("key_hash", await sha256(key)).maybeSingle();
  return data?.email as string | null;
}
async function jobs() { const { data } = await admin.from("docs").select("id,data").eq("collection", "jobs"); return (data || []) as any[]; }
async function saveJob(row: any, j: any, by: string) { const doc = row.data; j.updated = Date.now(); doc.data = j; doc.updated = j.updated; if (j.status) doc.status = j.status;
  await admin.from("docs").update({ data: doc, updated_at: new Date().toISOString(), updated_by: by + " (Siri)" }).eq("collection", "jobs").eq("id", row.id); }

async function clock(action: string, at: string, by: string) {
  const rows = await jobs(), on = rows.find((r) => r.data?.data?.clock);
  if (action === "off") {
    if (!on) return "You're not on the clock.";
    const j = on.data.data, s = String(j.clock), same = s.slice(0, 10) === at.slice(0, 10), m = same ? Math.max(0, mins(at.slice(11)) - mins(s.slice(11, 16))) : 0;
    j.time = j.time || []; j.time.push({ id: "t" + Date.now().toString(36), date: s.slice(0, 10), start: s.slice(11, 16), end: same ? at.slice(11) : "", hours: Math.round(m / 60 * 100) / 100, staff: j.staff || "Ian Lamont", note: "Clocked off with Siri" + (same ? "" : " (check the end time)") });
    j.clock = null; delete j.clockAuto; await saveJob(on, j, by);
    const h = Math.floor(m / 60), mm = m % 60;
    return same ? `Clocked off at ${place(j)}. ${h ? `${h} hour${h > 1 ? "s" : ""}${mm ? " " + mm + " minutes" : ""}` : `${mm} minutes`} logged to ${j.number}.` : `Clocked off at ${place(j)}. The clock ran past midnight, so check the end time in Studio.`;
  }
  if (on) return `You're already on the clock at ${place(on.data.data)}.`;
  const day = at.slice(0, 10), t = mins(at.slice(11)), cands: any[] = [];
  for (const r of rows) { const j = r.data?.data; if (!j || !OPEN.includes(j.status)) continue; for (const v of j.visits || []) if (v.date === day && v.start) cands.push({ r, j, v, s: mins(v.start), e: v.end ? mins(v.end) : mins(v.start) + 120 }); }
  if (!cands.length) return "There's no visit booked today. Open Studio and use the plus button on the job to clock on.";
  cands.sort((a, b) => a.s - b.s);
  const pick = cands.find((c) => t >= c.s - 60 && t <= c.e + 30) || cands.find((c) => c.s >= t) || cands[cands.length - 1];
  const j = pick.j; j.clock = at; delete j.clockAuto; if (j.status === "Scheduled" || j.status === "To Book") j.status = "In Progress";
  await saveJob(pick.r, j, by);
  return `Clocked on at ${place(j)}, ${j.number}, at ${spokenTime(at.slice(11))}.`;
}
async function todo(text: string, at: string) {
  let title = String(text || "").trim(); if (!title) return "I didn't catch the to-do.";
  const today = at.slice(0, 10); let due = today, when = "today";
  if (/\btomorrow\b/i.test(title)) { due = addDays(today, 1); when = "tomorrow"; }
  title = title.replace(/\b(for |by )?(today|tomorrow)\b/ig, "").replace(/\s{2,}/g, " ").replace(/^[,\s]+|[,\s]+$/g, "");
  title = title.charAt(0).toUpperCase() + title.slice(1);
  const id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), now = Date.now();
  const { error } = await admin.from("docs").insert({ collection: "tasks", id, data: { id, title, notes: "Added with Siri", due, time: "", done: false, doneAt: "", flag: false, clientId: "", jobId: "", proposalId: "", outlook: false, outlookId: "", created: now, updated: now }, updated_at: new Date().toISOString(), updated_by: "Siri" });
  if (error) return "I couldn't save that to-do. Try again in a moment.";
  return `Added "${title}" to your to-dos for ${when}.`;
}
async function myDay(at: string) {
  const day = at.slice(0, 10), rows = await jobs(), vs: any[] = [];
  for (const r of rows) { const j = r.data?.data; if (!j || j.status === "Complete") continue; for (const v of j.visits || []) if (v.date === day && v.start) vs.push({ j, v }); }
  vs.sort((a, b) => a.v.start.localeCompare(b.v.start));
  const { data: ts } = await admin.from("docs").select("data").eq("collection", "tasks");
  const due = (ts || []).map((x: any) => x.data).filter((t: any) => t && !t.done && t.due && t.due <= day);
  const parts: string[] = [];
  parts.push(vs.length ? `You've got ${vs.length} visit${vs.length > 1 ? "s" : ""} today. ` + vs.map((x) => `${spokenTime(x.v.start)}, ${x.j.customer || place(x.j)}${x.j.site && x.j.customer ? " at " + place(x.j) : ""}`).join(". ") + "." : "Nothing's booked today.");
  if (due.length) parts.push(`${due.length} to-do${due.length > 1 ? "s are" : " is"} due${due.length <= 3 ? ": " + due.map((t: any) => t.title).join(", ") : ""}.`);
  const on = rows.find((r) => r.data?.data?.clock); if (on) parts.push(`You're on the clock at ${place(on.data.data)}.`);
  return parts.join(" ");
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: { message: "POST only" } }, 405);
    const email = await who(req); if (!email) return json({ error: { message: "This phone isn't linked to Studio. Open Studio once and sign in." } }, 401);
    const path = new URL(req.url).pathname.replace(/^.*\/siri/, "");
    const b = await req.json().catch(() => ({}));
    const at = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(b.at || "")) ? String(b.at) : localNow();
    if (path === "/clock") return say(await clock(b.action === "off" ? "off" : "on", at, email));
    if (path === "/todo") return say(await todo(b.text, at));
    if (path === "/day") return say(await myDay(at));
    return json({ error: { message: "Unknown command." } }, 404);
  } catch (e) { console.error(e); return json({ error: { message: "Studio had a problem with that. Try again in a moment." } }, 500); }
});
