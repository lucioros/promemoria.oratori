// Funzione Supabase per gli SMS automatici di Promemoria oratori.
// L'app Comandi dell'iPhone la chiama il lunedì mattina:
//   GET ?k=CHIAVE              -> messaggi da inviare oggi
//   GET ?k=CHIAVE&fatto=ID     -> segna l'oratore come avvisato (scrive dati.json su GitHub)
//   GET ?k=CHIAVE&anteprima=1  -> tutti i prossimi SMS, per controllo (non invia niente)
// Secret richiesto: APP_PASSWORD (la password dell'app). La CHIAVE è nei dati cifrati.

const OWNER = "lucioros", REPO = "promemoria.oratori", BRANCH = "main", PATH = "dati.json";
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${PATH}`;

const te = new TextEncoder(), td = new TextDecoder();
const toB64 = (u8: Uint8Array) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + 0x8000))); return btoa(s); };
const fromB64 = (b: string) => Uint8Array.from(atob(b.replace(/\s/g, "")), (c) => c.charCodeAt(0));

async function deriveKey(pw: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey("raw", te.encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encObj(key: CryptoKey, obj: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(obj)));
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}
async function decObj(key: CryptoKey, e: { iv: string; ct: string }) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(e.iv) }, key, fromB64(e.ct));
  return JSON.parse(td.decode(pt));
}
const ghHeaders = (tok?: string) => {
  const h: Record<string, string> = { "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "promemoria-oratori" };
  if (tok) h.Authorization = "Bearer " + tok;
  return h;
};
const todayRome = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

// legge e decifra dati.json; con il token rilegge dall'API per avere la versione più recente e lo sha
async function load(pw: string) {
  const r = await fetch(RAW + "?t=" + Date.now(), { headers: { "Cache-Control": "no-cache" } });
  if (!r.ok) throw new Error("dati.json non trovato (" + r.status + ")");
  let file = await r.json();
  let key = await deriveKey(pw, fromB64(file.kdf.salt), file.kdf.iter);
  let dati;
  try { dati = await decObj(key, file.dati); } catch { throw new Error("APP_PASSWORD non corretta"); }
  const token = file.token ? await decObj(key, file.token) : null;
  let sha: string | null = null;
  if (token) {
    const a = await fetch(API + "?ref=" + BRANCH + "&t=" + Date.now(), { headers: ghHeaders(token) });
    if (a.ok) {
      const j = await a.json();
      sha = j.sha;
      const fresh = JSON.parse(td.decode(fromB64(j.content)));
      if (fresh.kdf.salt !== file.kdf.salt) key = await deriveKey(pw, fromB64(fresh.kdf.salt), fresh.kdf.iter);
      file = fresh;
      dati = await decObj(key, file.dati);
    }
  }
  return { file, key, dati, token, sha };
}

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const k = url.searchParams.get("k") || "";
    const pw = Deno.env.get("APP_PASSWORD");
    if (!pw) return json({ errore: "Manca il secret APP_PASSWORD nella funzione" }, 500);

    let { file, key, dati, token, sha } = await load(pw);
    const st = dati.settings || {};
    if (!k || !st.smsKey || k !== st.smsKey) return json({ errore: "Chiave non valida" }, 403);

    const oggi = todayRome();
    const sent = dati.sent || {};
    const outbox: any[] = dati.outbox || [];

    // conferma di invio
    const fatto = url.searchParams.get("fatto");
    if (fatto) {
      if (!token) return json({ errore: "Token GitHub non presente nei dati" }, 500);
      for (let tentativo = 0; tentativo < 3; tentativo++) {
        dati.sent = Object.assign({}, dati.sent || {}, { [fatto]: oggi });
        dati.sentVia = Object.assign({}, dati.sentVia || {}, { [fatto]: "sms" });
        // l'outbox resta com'è: l'app la ricalcola al prossimo salvataggio
        const nuovo = Object.assign({}, file, { dati: await encObj(key, dati), aggiornato: new Date().toISOString() });
        const body: Record<string, unknown> = { message: "Promemoria oratori: SMS automatico inviato", branch: BRANCH, content: toB64(te.encode(JSON.stringify(nuovo))) };
        if (sha) body.sha = sha;
        const r = await fetch(API, { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders(token)), body: JSON.stringify(body) });
        if (r.ok) return json({ ok: true, segnato: fatto, data: oggi });
        if (r.status !== 409 && r.status !== 422) return json({ errore: "GitHub " + r.status }, 502);
        ({ file, key, dati, token, sha } = await load(pw)); // conflitto: rileggo e riprovo
      }
      return json({ errore: "Conflitto su GitHub, riprova" }, 409);
    }

    const base = `${url.origin}${url.pathname}?k=${encodeURIComponent(k)}`;
    const pronti = outbox.filter((o) => !sent[o.key] && o.date >= oggi);

    if (url.searchParams.get("anteprima")) {
      return json({
        attivo: !!st.smsAuto, oggi,
        prossimi: pronti.map((o) => ({ invio: o.sendOn, discorso: o.date, nome: o.name, telefono: o.phone, testo: o.text })),
      });
    }

    const messaggi = !st.smsAuto ? [] : pronti
      .filter((o) => o.sendOn <= oggi)
      .map((o) => ({ nome: o.name, telefono: o.phone, testo: o.text, conferma: `${base}&fatto=${encodeURIComponent(o.key)}` }));
    return json({ oggi, messaggi });
  } catch (e) {
    return json({ errore: String((e as Error).message || e) }, 500);
  }
});
