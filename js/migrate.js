(function(){
  let publish=()=>{}; let subscribe=()=>{};

  function parseVolumeNumber(title){
    const m = String(title||'').match(/\b(book|bk|vol|volume)\s*(\d+(?:[\.-]\d+)?)\b/i);
    return m ? parseFloat(m[2].replace('-','.')) : null;
  }

  function computeNormalizedSeries(book){
    const raw = Utils.primarySeries(book.series) || '';
    const norm = Utils.normalizeSeriesName(raw) || Utils.guessSeriesFromTitle(book.title||'');
    return norm ? Utils.normalizeSeriesName(norm) : '';
  }

  async function enrichOne(existing){
    let changed=false; const b = { ...existing };
    // Compute normalized series and volume number from existing data
    const norm = computeNormalizedSeries(b);
    if(norm && b.normalizedSeries !== norm){ b.normalizedSeries = norm; changed=true; }
    const vol = parseVolumeNumber(b.title);
    if((vol||null) !== (b.volumeNumber||null)){ b.volumeNumber = vol||null; changed=true; }

    let enriched=null;
    // If key info is missing, ask Metadata for enrichment
    if((!b.authors || b.authors.length===0) || (!b.coverUrl) || (!b.series || b.series.length===0)){
      try{ enriched = await Metadata.fetchBookByISBN(b.isbn13); }catch{}
    }
    if(enriched){
      if((!b.authors || b.authors.length===0) && Array.isArray(enriched.authors) && enriched.authors.length){ b.authors = enriched.authors; changed=true; }
      if((!b.coverUrl) && enriched.coverUrl){ b.coverUrl = enriched.coverUrl; changed=true; }
      if((!b.series || b.series.length===0) && Array.isArray(enriched.series) && enriched.series.length){ b.series = enriched.series; changed=true; }
      // Recompute normalized series/vol after potential changes
      const n2 = computeNormalizedSeries(b);
      if(n2 && b.normalizedSeries !== n2){ b.normalizedSeries = n2; changed=true; }
      const v2 = parseVolumeNumber(b.title);
      if((v2||null) !== (b.volumeNumber||null)){ b.volumeNumber = v2||null; changed=true; }
    }

    return { book:b, changed };
  }

  async function enrichAll(){
    try{
      const all = await Storage.getAllBooks();
      if(!all || !all.length){ Utils.toast('No books to migrate', { type:'info' }); return; }
      Utils.toast(`Migrating ${all.length} books…`, { type:'info', duration: 2000 });
      let updated=0;
      for(const bk of all){
        const { book:newB, changed } = await enrichOne(bk);
        if(changed){ await Storage.putBook(newB); updated++; }
      }
      Utils.toast(`Migration complete. Updated ${updated} book(s).`, { type:'ok', duration: 4000 });
      try{ const s = await Storage.getSettings(); await Storage.setSettings({ ...s, migratedEnrichmentV1: true }); }catch{}
      // Refresh shelves and search
      publish('shelves:render', {});
    }catch(e){ console.error('Migration failed', e); Utils.toast('Migration failed', { type:'error' }); }
  }

  function init(api){ publish=api.publish; subscribe=api.subscribe; subscribe('migrate:run', enrichAll); }

  window.Migrate = { init, enrichAll };
})();
