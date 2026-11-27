// Sends daily reminders and family updates as web push notifications.
// Runs on a GitHub Actions schedule. Needs one secret: FIREBASE_SA (service account JSON).
const admin = require("firebase-admin");
const webpush = require("web-push");

if (!process.env.FIREBASE_SA) { console.log("FIREBASE_SA secret not set yet; nothing to do."); process.exit(0); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
const db = admin.firestore();
const TS = admin.firestore.Timestamp;
const START = Date.UTC(2026, 11, 1); // Dec 1, 2026

const first = n => String(n || "Someone").trim().split(/\s+/)[0];
const list = a => a.length <= 2 ? a.join(" and ") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
function localParts(tz, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, mins: (+p.hour) * 60 + (+p.minute), y: +p.year, m: +p.month, d: +p.day };
}

(async () => {
  // VAPID keys live in Firestore so only one secret is needed. meta/vapid is unreadable by clients.
  const vref = db.doc("meta/vapid");
  let v = (await vref.get()).data();
  if (!v || !v.privateKey) { v = webpush.generateVAPIDKeys(); await vref.set(v); console.log("Created VAPID keys"); }
  await db.doc("meta/public").set({ vapid: v.publicKey }, { merge: true });
  webpush.setVapidDetails("https://icy-azul.github.io/nt30/", v.publicKey, v.privateKey);

  const metaRef = db.doc("meta/notify");
  const meta = (await metaRef.get()).data() || {};
  const now = new Date();
  const since = meta.last ? meta.last.toDate() : new Date(now - 20 * 60e3);

  const subs = (await db.collection("push").get()).docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.sub && s.sub.endpoint);
  console.log(`${subs.length} subscribers`);
  if (!subs.length) { await metaRef.set({ last: TS.fromDate(now) }); return; }
  const members = new Map((await db.collection("members").get()).docs.map(d => [d.id, d.data()]));

  const send = async (s, payload) => {
    try { await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "normal" }); return true; }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { await db.doc(`push/${s.id}`).update({ sub: null }); console.log("removed expired sub", s.id); }
      else console.log("push error", s.id, e.statusCode, e.body);
      return false;
    }
  };

  // 1) family updates since the last run
  const ev = (await db.collection("feed").where("at", ">", TS.fromDate(since)).where("at", "<=", TS.fromDate(now)).get()).docs.map(d => d.data());
  let sentFam = 0;
  if (ev.length) for (const s of subs) {
    if (s.others === false) continue;
    const others = ev.filter(e => e.uid !== s.id);
    const fin = [...new Set(others.filter(e => e.type === "finish").map(e => first(e.name)))];
    const done = [...new Set(others.filter(e => e.type === "done").map(e => first(e.name)))].filter(n => !fin.includes(n));
    const th = [...new Set(others.filter(e => e.type === "thought").map(e => first(e.name)))];
    const parts = [];
    if (fin.length) parts.push(`${list(fin)} finished the whole challenge! 🎉`);
    if (done.length) parts.push(`${list(done)} finished ${done.length === 1 ? "a reading" : "their readings"}.`);
    if (th.length) parts.push(`${list(th)} shared ${th.length === 1 ? "a thought" : "thoughts"}.`);
    if (!parts.length) continue;
    if (await send(s, { title: "New Testament in 30 Days", body: parts.join(" "), tag: "family", url: "./#feed" })) sentFam++;
  }

  // 2) daily reminders at each person's chosen local time
  let sentRem = 0;
  for (const s of subs) {
    if (s.remind === false) continue;
    const tz = s.tz || "America/Denver";
    let lp; try { lp = localParts(tz, now); } catch (e) { lp = localParts("America/Denver", now); }
    if (s.lastRemind === lp.date) continue;
    const [hh, mm] = String(s.time || "19:00").split(":").map(Number);
    const target = hh * 60 + (mm || 0);
    if (lp.mins < target || lp.mins > target + 50) continue; // GitHub schedules can run late
    const m = members.get(s.id) || {};
    const off = Number.isInteger(m.off) ? m.off : (s.off || 0);
    const idx = Math.round((Date.UTC(lp.y, lp.m - 1, lp.d) - START) / 864e5) - off;
    if (idx < 0 || idx > 29) continue;
    const d = Array.isArray(m.d) ? m.d : [];
    await db.doc(`push/${s.id}`).update({ lastRemind: lp.date });
    if (d.includes(idx) || d.length >= 30) continue;
    const behind = Array.from({ length: idx }, (_, i) => i).filter(i => !d.includes(i)).length;
    const body = behind ? `Day ${idx + 1} is ready, plus ${behind} to catch up. You've got this!` : `Day ${idx + 1} is ready. A few chapters and you're done for today!`;
    if (await send(s, { title: `Time for today's reading, ${first(m.name || s.name)}`, body, tag: "remind", url: "./" })) sentRem++;
  }

  await metaRef.set({ last: TS.fromDate(now) });
  console.log(`events ${ev.length}, family pushes ${sentFam}, reminders ${sentRem}`);
})().catch(e => { console.error(e); process.exit(1); });
