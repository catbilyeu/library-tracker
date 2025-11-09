(function(){
  let publish=()=>{}; let subscribe=()=>{};

  async function exportAll(){ const data = await window.Storage.exportAll(); const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`library-export-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 1000); }

  // Validate minimal schema and import with skip-on-conflict by default.
  async function importFile(file){
    try{
      const text = await file.text();
      const json = JSON.parse(text);

      // Basic schema validation: required keys present; ignore unknown keys
      const requiredKeys = ['version','exportedAt','books'];
      if(!json || typeof json !== 'object') throw new Error('Invalid file: JSON expected');
      for(const k of requiredKeys){ if(!(k in json)) throw new Error(`Invalid file: missing "${k}"`); }
      if(typeof json.version !== 'number') throw new Error('Invalid file: "version" must be a number');
      if(typeof json.exportedAt !== 'number') throw new Error('Invalid file: "exportedAt" must be a timestamp');
      if(!json.books || (typeof json.books !== 'object' && !Array.isArray(json.books))) throw new Error('Invalid file: "books" must be an object or array');

      // Normalize books to an array and strip unknown wrapper keys
      const incoming = Array.isArray(json.books) ? json.books : Object.values(json.books||{});

      // Load existing ISBNs to skip conflicts
      const existing = await window.Storage.getAllBooks();
      const existingIsbns = new Set(existing.map(b=>b && b.isbn13).filter(Boolean));

      // Filter to only new, valid books (must have isbn13 and not already present)
      const validIncoming = (incoming||[]).filter(b => b && typeof b === 'object' && b.isbn13);
      const newBooks = validIncoming.filter(b => !existingIsbns.has(b.isbn13));

      const totalIncoming = validIncoming.length;
      const addedCount = newBooks.length;
      const skippedCount = totalIncoming - addedCount;

      // Chunk writes in batches of 100, using bulkPut when available; fallback to per-put
      const CHUNK = 100;
      for(let i=0; i<newBooks.length; i+=CHUNK){
        const chunk = newBooks.slice(i, i+CHUNK);
        if(chunk.length === 0) continue;
        if(window.Storage && typeof window.Storage.bulkPut === 'function'){
          try{ await window.Storage.bulkPut(chunk); }
          catch(e){
            // Fallback to per-put if bulkPut fails for any reason
            for(const b of chunk){ try{ await window.Storage.putBook(b); } catch(e2){ /* ignore per-put failure */ } }
          }
        } else {
          for(const b of chunk){ try{ await window.Storage.putBook(b); } catch(e2){ /* ignore per-put failure */ } }
        }
      }

      publish('import:done', { addedCount, skippedCount });
      Utils.toast(`Imported ${addedCount} new, skipped ${skippedCount}`, { type:'ok' });
    } catch(e){ console.error(e); Utils.toast(`Import failed: ${e?.message||'Unknown error'}`, { type:'error' }); }
  }

  function init(api){ publish=api.publish; subscribe=api.subscribe; window.addEventListener('change', (e)=>{ if(e.target && e.target.id==='file-import' && e.target.files?.[0]) importFile(e.target.files[0]); }); }

  window.ImportExport = { init, export: exportAll, import: importFile };
})();
