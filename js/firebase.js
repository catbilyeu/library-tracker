(function(){
  let publish = ()=>{}; let subscribe = ()=>{};
  let app = null, auth = null, db = null; let user = null; let configured = false;

  function hasConfig(){ return !!window.firebaseConfig && !!window.firebase && !!window.firebase.initializeApp; }

  async function init(api){
    publish = api.publish; subscribe = api.subscribe;
    configured = hasConfig();
    if(!configured){ console.info('[Firebase] No config found (js/firebase-config.js). Running in offline/local mode.'); return; }
    try{
      app = firebase.initializeApp(window.firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      // Enable offline persistence if possible
      try{ await db.enablePersistence({ synchronizeTabs: true }); }
      catch(e){ console.info('[Firestore] Persistence not available or already enabled', e?.code||e?.message||e); }
      // Auth state listener
      auth.onAuthStateChanged(async (u)=>{
        user = u || null;
        publish('auth:state', { user });
      });
    }catch(e){ console.error('[Firebase] init failed', e); configured=false; }
  }

  function isConfigured(){ return configured; }
  function getUser(){ return user; }
  function getDb(){ return db; }

  async function signIn(){
    if(!configured) return;
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try{
      await auth.signInWithPopup(provider);
    }catch(e){
      // Fallback for environments where popups are blocked or COOP causes issues in gapi
      const code = e && e.code ? String(e.code) : '';
      const msg = e && e.message ? String(e.message) : '';
      if(code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request' || /popup/i.test(msg)){
        await auth.signInWithRedirect(provider);
      } else {
        throw e;
      }
    }
  }
  async function signOut(){ if(!configured) return; await auth.signOut(); }

  // Firestore-based storage implementing the same API as local Storage
  const CloudStorage = {
    async getAllBooks(){ if(!user) return []; const snap = await db.collection('users').doc(user.uid).collection('books').get(); return snap.docs.map(d=> d.data()); },
    async getBook(isbn13){ if(!user) return null; const d = await db.collection('users').doc(user.uid).collection('books').doc(isbn13).get(); return d.exists ? d.data() : null; },
    async putBook(book){ if(!user) return book; const ref = db.collection('users').doc(user.uid).collection('books').doc(book.isbn13); await ref.set(book, { merge: true }); publish('shelves:render',{}); return book; },
    async deleteBook(isbn13){ if(!user) return; const ref = db.collection('users').doc(user.uid).collection('books').doc(isbn13); await ref.delete(); publish('book:removed', { isbn13 }); },
    async bulkPut(books){ if(!user) return; const batch = db.batch(); const col = db.collection('users').doc(user.uid).collection('books');
      for(const b of books){ batch.set(col.doc(b.isbn13), b, { merge: true }); }
      await batch.commit(); publish('shelves:render', {}); publish('import:done', { addedCount: books.length, skippedCount: 0 }); },
    async exportAll(){ const books = await this.getAllBooks(); const map = {}; for(const b of books){ map[b.isbn13]=b; } return { version:1, exportedAt: Date.now(), books: map }; },
    async getSettings(){ if(!user) return (await window.StorageLocal.getSettings()); const d = await db.collection('users').doc(user.uid).collection('settings').doc('settings').get(); if(d.exists) return d.data(); return (await window.StorageLocal.getSettings()); },
    async setSettings(partial){ if(!user) return (await window.StorageLocal.setSettings(partial)); const cur = await this.getSettings(); const next = { ...cur, ...partial }; await db.collection('users').doc(user.uid).collection('settings').doc('settings').set(next, { merge: true }); return next; }
  };

  // Public API
  window.Firebase = { init, isConfigured, getUser, getDb, signIn, signOut, CloudStorage };
})();
