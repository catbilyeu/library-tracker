(function(){
  let publish = ()=>{}; let subscribe = ()=>{};
  let app = null, auth = null, db = null; let user = null; let configured = false;
  const AUTH_DEBUG = /[?&]authdebug=1/i.test(location.search);
  let dbgEl = null;
  function dbg(){ if(!AUTH_DEBUG) return; if(!dbgEl){ dbgEl=document.createElement('div'); dbgEl.style.cssText='position:fixed;right:8px;bottom:8px;z-index:99999;background:rgba(0,0,0,.7);color:#fff;padding:8px 10px;border-radius:8px;max-width:60vw;font:12px/1.3 system-ui, -apple-system, Segoe UI, Roboto'; document.body.appendChild(dbgEl);} dbgEl.insertAdjacentHTML('beforeend', `<div>${Array.from(arguments).map(x=>String(x)).join(' ')}</div>`); }

  function hasConfig(){ return !!window.firebaseConfig && !!window.firebase && !!window.firebase.initializeApp; }

  async function init(api){
    publish = api.publish; subscribe = api.subscribe;
    configured = hasConfig();
    dbg('[init] configured=', configured, 'origin=', location.origin);
    if(!configured){ console.info('[Firebase] No config found (js/firebase-config.js). Running in offline/local mode.'); return; }
    try{
      app = firebase.initializeApp(window.firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      dbg('[init] app=', !!app, 'projectId=', window.firebaseConfig && window.firebaseConfig.projectId);
      // Prefer LOCAL persistence (survives refresh). Fallback to SESSION for stricter contexts.
      try{
        await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        dbg('[auth] setPersistence LOCAL ok');
      } catch(e1){
        dbg('[auth] setPersistence LOCAL failed, trying SESSION', e1?.code||e1?.message||e1);
        try{
          await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
          dbg('[auth] setPersistence SESSION ok (fallback)');
        } catch(e2){
          dbg('[auth] setPersistence SESSION failed, using default', e2?.code||e2?.message||e2);
          console.info('[Auth] setPersistence failed, using default');
        }
      }
      // Enable offline persistence if possible
      try{ await db.enablePersistence({ synchronizeTabs: true }); dbg('[firestore] persistence enabled'); }
      catch(e){ dbg('[firestore] persistence not enabled', e?.code||e?.message||e); }
      // Auth state persistence: LOCAL
      try{
        await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        dbg('[auth] setPersistence LOCAL ok');
      } catch(e1){ dbg('[auth] setPersistence LOCAL failed', e1?.code||e1?.message||e1); }
      auth.onAuthStateChanged(async (u)=>{
        user = u || null;
        dbg('[auth] state', !!user, user && user.uid);
        publish('auth:state', { user });
        // If we just returned from a redirect, hide the overlay and update UI
        try{
          const overlay = document.getElementById('auth-overlay');
          if(overlay){ overlay.hidden = !!user; }
        }catch{}
      });
    }catch(e){ console.error('[Firebase] init failed', e); dbg('[init] failed', e && (e.code||e.message||e)); configured=false; }
  }

  function isConfigured(){ return configured; }
  function getUser(){ return user; }
  function getDb(){ return db; }

  async function signIn(){
    if(!configured) return;
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try{
      dbg('[auth] signInWithPopup start');
      await auth.signInWithPopup(provider);
      dbg('[auth] signInWithPopup success');
    }catch(e){
      const code = e?.code || '';
      const msg = e?.message || '';
      dbg('[auth] popup failed -> redirect fallback', code, msg);
      if(/popup/i.test(code) || /popup/i.test(msg) || /closed/i.test(msg) || /blocked/i.test(msg)){
        await auth.signInWithRedirect(provider);
      } else {
        // Unknown error: still try redirect as a fallback
        await auth.signInWithRedirect(provider);
      }
    }
  }
  async function signOut(){ if(!configured) return; dbg('[auth] signOut'); await auth.signOut(); }

  // Firestore-based storage implementing the same API as local Storage
  const CloudStorage = {
    async getAllBooks(){ if(!user) return []; const snap = await db.collection('users').doc(user.uid).collection('books').get(); return snap.docs.map(d=> d.data()); },
    async getBook(isbn13){ if(!user) return null; const d = await db.collection('users').doc(user.uid).collection('books').doc(isbn13).get(); return d.exists ? d.data() : null; },
    async putBook(book){ if(!user) return book; const ref = db.collection('users').doc(user.uid).collection('books').doc(book.isbn13); await ref.set(book, { merge: true }); publish('book:updated', { book }); publish('shelves:render',{}); return book; },
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
