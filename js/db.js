(function(){
  const DB_NAME = 'library-tracker';
  const DB_VERSION = 1;
  let dbp = null; let publish = ()=>{};

  async function getDB(){
    if(!dbp){
      if(typeof idb === 'undefined'){
        try { const m = await import('https://cdn.jsdelivr.net/npm/idb@7/+esm'); window.idb = m; }
        catch(e){ console.error('Failed to load idb module', e); throw e; }
      }
      dbp = idb.openDB(DB_NAME, DB_VERSION, {
        upgrade(db){
          if(!db.objectStoreNames.contains('books')){
            const s = db.createObjectStore('books', { keyPath: 'isbn13' });
            s.createIndex('addedAt', 'addedAt');
            s.createIndex('title', 'title');
          }
          if(!db.objectStoreNames.contains('settings')){
            db.createObjectStore('settings');
          }
        }
      });
    }
    return dbp;
  }

  const StorageLocal = {
    init(publishFn){ publish = publishFn || (()=>{}); return this; },
    async getAllBooks(){ const db = await getDB(); return db.getAll('books'); },
    async getBook(isbn13){ const db = await getDB(); return db.get('books', isbn13); },
    async putBook(book){ const db = await getDB(); const existing = await db.get('books', book.isbn13);
      await db.put('books', book);
      publish(existing? 'book:updated' : 'book:added', { book });
      try{ if(window.localStorage){ localStorage.setItem('lastBookChange', String(Date.now())); } }catch{}
      return book; },
    async deleteBook(isbn13){ const db = await getDB(); await db.delete('books', isbn13); publish('book:removed', { isbn13 }); },
    async clearBooks(){ const db = await getDB(); const tx = db.transaction('books','readwrite'); await tx.objectStore('books').clear(); await tx.done; publish('shelves:render', {}); },
    async bulkPut(books){ const db = await getDB(); const tx = db.transaction('books','readwrite'); const store = tx.objectStore('books');
      for(const b of books){ await store.put(b); }
      await tx.done; publish('shelves:render', {}); publish('import:done', { addedCount: books.length, skippedCount: 0 }); },
    async exportAll(){ const books = await this.getAllBooks(); const map={}; for(const b of books){ map[b.isbn13]=b; }
      return { version:1, exportedAt: Date.now(), books: map }; },
    async getSettings(){ const db = await getDB(); return (await db.get('settings','settings')) || { handsFreeEnabled:false, voiceEnabled:false, handsFreeSensitivity:0.25, handsFreePinchSensitivity:0.25, handsFreeMirrorX:true, voiceAnnouncements:true, sortMode:'series', theme:'dark' } },
    async setSettings(partial){ const db = await getDB(); const cur = (await this.getSettings()) || {}; const next = { ...cur, ...partial }; delete next.handsFreePinchSensitivity; await db.put('settings', next, 'settings'); return next; }
  };

  // Broker that can swap between local and cloud storage backends at runtime
  const Storage = {
    _impl: null,
    init(publishFn){ StorageLocal.init(publishFn); this._impl = StorageLocal; return this; },
    setBackend(impl){ this._impl = impl || StorageLocal; return this; },
    get backend(){ return this._impl || StorageLocal; },
    async getAllBooks(){ return this.backend.getAllBooks(); },
    async getBook(isbn13){ return this.backend.getBook(isbn13); },
    async putBook(book){ return this.backend.putBook(book); },
    async deleteBook(isbn13){ return this.backend.deleteBook(isbn13); },
    async bulkPut(books){ return this.backend.bulkPut(books); },
    async exportAll(){ return this.backend.exportAll(); },
    async getSettings(){ return this.backend.getSettings(); },
    async setSettings(partial){ return this.backend.setSettings(partial); },
    // Local-only utility
    async clearLocalBooks(){ return StorageLocal.clearBooks(); }
  };

  window.StorageLocal = StorageLocal;
  window.Storage = Storage;
})();
