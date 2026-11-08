// halo.je Studio: product photo from a web link. POST { url } or { urls: [] } with the member's Supabase session.
// A product page uses its og:image; an image link is used as is. The photo is stored in Studio files and a signed URL returned.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
class E extends Error { constructor(message: string, public status = 400) { super(message); } }
async function member(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user?.email) throw new E("Sign in again.", 401);
  const { data: m } = await admin.from("members").select("email").ilike("email", data.user.email).maybeSingle();
  if (!m) throw new E("This login isn't set up for Studio.", 403);
}
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
function safeUrl(u: string): URL {
  let x: URL; try { x = new URL(u); } catch { throw new E("That isn't a web address."); }
  if (!/^https?:$/.test(x.protocol)) throw new E("Only web links work here.");
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/i.test(x.hostname) || !x.hostname.includes(".")) throw new E("That address isn't allowed.");
  return x;
}
function pickImage(html: string, base: URL): string | null {
  const rs = [/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["']/i, /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i, /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i];
  for (const r of rs) { const m = html.match(r); if (m) return new URL(m[1].replace(/&amp;/g, "&"), base).toString(); }
  const ld = html.match(/"image"\s*:\s*(?:\[\s*)?"([^"]+\.(?:jpe?g|png|webp)[^"]*)"/i); if (ld) return new URL(ld[1].replace(/\\\//g, "/"), base).toString();
  return null;
}
async function photo(u: string) {
  let url = safeUrl(u);
  let r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,image/*,*/*" }, redirect: "follow" });
  if (!r.ok) throw new E(`That page returned ${r.status}.`, 502);
  let type = (r.headers.get("content-type") || "").split(";")[0].trim();
  if (!type.startsWith("image/")) {
    const img = pickImage(await r.text(), new URL(r.url || url.toString()));
    if (!img) throw new E("I couldn't find a product photo on that page.", 422);
    url = safeUrl(img); r = await fetch(url, { headers: { "user-agent": UA, accept: "image/*" }, redirect: "follow" });
    if (!r.ok) throw new E(`The photo returned ${r.status}.`, 502);
    type = (r.headers.get("content-type") || "").split(";")[0].trim();
  }
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) throw new E("That link isn't a photo Studio can use.", 422);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > 8_000_000) throw new E("That photo is too big.", 413);
  const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[type];
  const path = `u/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  const up = await admin.storage.from("files").upload(path, buf, { contentType: type, upsert: false });
  if (up.error) throw new E(up.error.message, 500);
  const sg = await admin.storage.from("files").createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
  if (sg.error) throw new E(sg.error.message, 500);
  return { url: sg.data.signedUrl, source: url.toString(), size: buf.length };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    await member(req);
    const { url, urls } = await req.json().catch(() => ({}));
    if (Array.isArray(urls)) { const out = await Promise.all(urls.slice(0, 40).map((u: unknown) => photo(String(u)).catch((e) => ({ error: (e as Error).message, from: u })))); return json({ result: out }); }
    return json({ result: await photo(String(url || "")) });
  } catch (e) { return json({ error: { message: (e as Error).message } }, e instanceof E ? e.status : 500); }
});
