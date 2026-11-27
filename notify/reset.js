// Resets a family member's password. Run from GitHub: Actions > Reset a password > Run workflow.
const admin = require("firebase-admin");
const user = String(process.env.RESET_USER || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
const pw = String(process.env.RESET_PW || "");
if (!process.env.FIREBASE_SA) { console.log("FIREBASE_SA secret is not set."); process.exit(1); }
if (!user || pw.length < 6) { console.log("Enter a username and a new password of at least 6 characters."); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
admin.auth().getUserByEmail(`${user}@nt30.family`)
  .then(u => admin.auth().updateUser(u.uid, { password: pw }).then(() => console.log(`Password reset for ${user} (${u.displayName || "no name"}).`)))
  .catch(e => { console.log(e.code === "auth/user-not-found" ? `No account with username "${user}".` : e.message); process.exit(1); });
