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

  const Storage = {
    init(publishFn){ publish = publishFn || (()=>{}); return this; },
    async getAllBooks(){ const db = await getDB(); return db.getAll('books'); },
    async getBook(isbn13){ const db = await getDB(); return db.get('books', isbn13); },
    async putBook(book){ const db = await getDB(); const existing = await db.get('books', book.isbn13);
      await db.put('books', book);
      publish(existing? 'book:updated' : 'book:added', { book });
      return book; },
    async deleteBook(isbn13){ const db = await getDB(); await db.delete('books', isbn13); publish('book:removed', { isbn13 }); },
    async bulkPut(books){ const db = await getDB(); const tx = db.transaction('books','readwrite'); const store = tx.objectStore('books');
      for(const b of books){ await store.put(b); }
      await tx.done; publish('shelves:render', {}); publish('import:done', { addedCount: books.length, skippedCount: 0 }); },
    async exportAll(){ const books = await this.getAllBooks(); const map={}; for(const b of books){ map[b.isbn13]=b; }
      return { version:1, exportedAt: Date.now(), books: map }; },
    async getSettings(){ const db = await getDB(); return (await db.get('settings','settings')) || { handsFreeEnabled:false, voiceEnabled:false, handsFreeSensitivity:0.25, handsFreeMirrorX:true, voiceAnnouncements:true } },
    async setSettings(partial){ const db = await getDB(); const cur = (await this.getSettings()) || {}; const next = { ...cur, ...partial }; await db.put('settings', next, 'settings'); return next; }
  };

  window.Storage = Storage;
})();
