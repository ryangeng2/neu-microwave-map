// Data + auth backend. Firebase when config.js has a config; otherwise a
// browser-only preview store with the same interface.
import { firebaseConfig } from "./config.js?v=3";

const FB = "https://www.gstatic.com/firebasejs/12.19.0";

export async function createStore() {
  return firebaseConfig ? createFirebaseStore() : createPreviewStore();
}

async function createFirebaseStore() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  const col = F.collection(db, "microwaves");
  const verifyUrl = location.origin + location.pathname;

  const toUser = (u) => u && { uid: u.uid, email: u.email, emailVerified: u.emailVerified };

  return {
    preview: false,
    onAuth(cb) { return A.onAuthStateChanged(auth, (u) => cb(toUser(u))); },
    async signIn(email, password) { await A.signInWithEmailAndPassword(auth, email, password); },
    async signUp(email, password) {
      const { user } = await A.createUserWithEmailAndPassword(auth, email, password);
      await A.sendEmailVerification(user, { url: verifyUrl });
    },
    async resendVerification() { if (auth.currentUser) await A.sendEmailVerification(auth.currentUser, { url: verifyUrl }); },
    async refreshUser() {
      if (!auth.currentUser) return null;
      await auth.currentUser.reload();
      await auth.currentUser.getIdToken(true); // pick up email_verified for the security rules
      return toUser(auth.currentUser);
    },
    async resetPassword(email) { await A.sendPasswordResetEmail(auth, email, { url: verifyUrl }); },
    async signOut() { await A.signOut(auth); },

    subscribe(next, onError) {
      return F.onSnapshot(col, (snap) => {
        next(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }, onError);
    },
    async add(data) {
      await F.addDoc(col, { ...data, createdBy: auth.currentUser.uid, createdAt: F.serverTimestamp(), votes: {} });
    },
    async update(id, data) {
      await F.updateDoc(F.doc(db, "microwaves", id), { ...data, updatedAt: F.serverTimestamp() });
    },
    async remove(id) { await F.deleteDoc(F.doc(db, "microwaves", id)); },
    async vote(id, value) {
      const uid = auth.currentUser.uid;
      await F.updateDoc(F.doc(db, "microwaves", id), { [`votes.${uid}`]: value ?? F.deleteField() });
    },
  };
}

function createPreviewStore() {
  const KEY = "neu-microwaves-preview";
  const me = { uid: "preview-user", email: "you@northeastern.edu", emailVerified: true };
  let user = null;
  let items = [];
  const authSubs = new Set();
  const dataSubs = new Set();
  try { items = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { items = []; }
  try { if (localStorage.getItem(KEY + ":signedin")) user = me; } catch {}

  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
    dataSubs.forEach((cb) => cb(items.map((x) => ({ ...x }))));
  };
  const setUser = (u) => {
    user = u;
    try { u ? localStorage.setItem(KEY + ":signedin", "1") : localStorage.removeItem(KEY + ":signedin"); } catch {}
    authSubs.forEach((cb) => cb(user));
  };

  return {
    preview: true,
    onAuth(cb) { authSubs.add(cb); queueMicrotask(() => cb(user)); return () => authSubs.delete(cb); },
    async signIn() { setUser(me); },
    async signUp() { setUser(me); },
    async resendVerification() {},
    async refreshUser() { return user; },
    async resetPassword() {},
    async signOut() { setUser(null); },
    subscribe(next) { dataSubs.add(next); queueMicrotask(() => next(items.map((x) => ({ ...x })))); return () => dataSubs.delete(next); },
    async add(data) {
      items.push({ ...data, id: crypto.randomUUID(), createdBy: me.uid, createdAt: Date.now(), votes: {} });
      save();
    },
    async update(id, data) { items = items.map((x) => (x.id === id ? { ...x, ...data } : x)); save(); },
    async remove(id) { items = items.filter((x) => x.id !== id); save(); },
    async vote(id, value) {
      items = items.map((x) => {
        if (x.id !== id) return x;
        const votes = { ...x.votes };
        if (value) votes[me.uid] = value; else delete votes[me.uid];
        return { ...x, votes };
      });
      save();
    },
  };
}
