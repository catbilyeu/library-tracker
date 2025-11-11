(function(){
  async function fetchJSON(url){ const res = await fetch(url, { headers:{ 'Accept':'application/json' } }); if(!res.ok) throw new Error('HTTP '+res.status); return res.json(); }

  async function fetchBookByISBN(isbn13){
    const d = Utils.toISBN13(isbn13); if(!d || !Utils.isValidISBN13(d)) { return {
      id: d||isbn13, isbn13: d||isbn13, title:'', authors:[], addedAt: Date.now(), borrowHistory: []
    }; }
    const book = { id: d, isbn13: d, isbn10: Utils.toISBN10(d) || undefined, title:'', authors:[], subjects:[], series:[], normalizedSeries:'', volumeNumber:null, coverUrl: undefined, addedAt: Date.now(), borrowHistory: [] };
    const primaryUrl = `https://openlibrary.org/isbn/${d}.json`;
    try {
      const data = await fetchJSON(primaryUrl);
      book.title = data.title || '';
      if(Array.isArray(data.authors)){
        const names = [];
        for(const a of data.authors){
          if(a && a.key){ try{ const ad = await fetchJSON(`https://openlibrary.org${a.key}.json`); if(ad && ad.name) names.push(ad.name); } catch{} }
        }
        book.authors = names;
      }
      if(Array.isArray(data.subjects)) book.subjects = data.subjects.map(s=> typeof s==='string'? s : (s && s.name)||'');
      // If edition has no authors, try the work record's authors
      if((!book.authors || book.authors.length===0) && (data.work || (data.works && data.works[0] && data.works[0].key))){
        const workKey = data.work || (data.works[0] && data.works[0].key);
        try{
          const wd = await fetchJSON(`https://openlibrary.org${workKey}.json`);
          if(Array.isArray(wd?.authors)){
            const names=[];
            for(const wa of wd.authors){
              const akey = wa?.author?.key; if(akey){ try{ const ad = await fetchJSON(`https://openlibrary.org${akey}.json`); if(ad?.name) names.push(ad.name); }catch{} }
            }
            if(names.length) book.authors = names;
          }
        }catch{}
      }
      // Series from Open Library works or notes fields
      if(Array.isArray(data.series)) book.series = data.series.map(s=> typeof s==='string'? s : (s && s.name)||'').filter(Boolean);
      else if(typeof data.work === 'string' || (data.works && data.works[0] && data.works[0].key)){
        const workKey = data.work || (data.works[0] && data.works[0].key);
        try{ const wd = await fetchJSON(`https://openlibrary.org${workKey}.json`); if(wd){
          if(Array.isArray(wd.series)) book.series = wd.series.map(s=> typeof s==='string'? s : (s && s.name)||'').filter(Boolean);
          // Try extracting series from work title parentheses if OL doesn’t provide series
          if((!book.series || book.series.length===0) && wd.title){
            const g = Utils.guessSeriesFromTitle(wd.title); if(g) book.series = [g];
          }
        } }catch{}
      }
      // Also try to derive series from edition title if present
      if((!book.series || book.series.length===0) && book.title){
        const g = Utils.guessSeriesFromTitle(book.title); if(g) book.series = [g];
      }
    } catch(e){
      // fallback API
      try {
        const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${d}&jscmd=data&format=json`;
        const data = await fetchJSON(url);
        const k = `ISBN:${d}`;
        if(data && data[k]){
          const bd = data[k];
          book.title = bd.title || '';
          if(Array.isArray(bd.authors)) book.authors = bd.authors.map(a=>a.name).filter(Boolean);
          if(Array.isArray(bd.subjects)) book.subjects = bd.subjects.map(s=>s.name).filter(Boolean);
          if(Array.isArray(bd.series)) book.series = bd.series.map(s=> s.name || s).filter(Boolean);
          if((!book.series || book.series.length===0) && bd.title){ const g = Utils.guessSeriesFromTitle(bd.title); if(g) book.series=[g]; }
        }
      } catch{}
    }
    // Enrich authors/cover via Google Books if still missing
    if(!book.authors || book.authors.length===0 || !book.coverUrl || !book.series || book.series.length===0){
      try{
        const g = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${d}`).then(r=>r.ok?r.json():null);
        const item = g?.items?.[0]?.volumeInfo;
        if(item){
          if((!book.authors || book.authors.length===0) && Array.isArray(item.authors)) book.authors = item.authors;
          if(!book.coverUrl && item.imageLinks){
            book.coverUrl = (item.imageLinks.thumbnail || item.imageLinks.smallThumbnail || '').replace('http://','https://');
          }
          // Some volumes encode series in title or series property
          if((!book.series || book.series.length===0)){
            if(typeof item.series === 'string'){ book.series = [Utils.normalizeSeriesName(item.series)]; }
            else if(item.title){ const g2 = Utils.guessSeriesFromTitle(item.title); if(g2) book.series=[g2]; }
          }
        }
      }catch{}
    }
    // If authors still missing, try Google Books by title query
    if((!book.authors || book.authors.length===0) && book.title){
      try{
        const q = encodeURIComponent(`intitle:"${book.title}"`);
        const g2 = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1`).then(r=>r.ok?r.json():null);
        const item2 = g2?.items?.[0]?.volumeInfo;
        if(Array.isArray(item2?.authors) && item2.authors.length){ book.authors = item2.authors; }
      }catch{}
    }
    // Final cover default if still missing (will cascade via Utils.coverErr on error)
    book.coverUrl = book.coverUrl || `https://covers.openlibrary.org/b/isbn/${d}-M.jpg`;
    // Normalize series and parse volume number once we have title/series
    try{
      const rawSeries = Utils.primarySeries(book.series) || '';
      const norm = Utils.normalizeSeriesName(rawSeries) || Utils.guessSeriesFromTitle(book.title||'');
      book.normalizedSeries = norm ? Utils.normalizeSeriesName(norm) : '';
      const volGuess = Utils.extractVolumeNumber(book.title||'');
      book.volumeNumber = (volGuess!=null)? volGuess : null;
    }catch{}
    return book;
  }

  async function searchGoogleBooks(query){
    try{
      const q = encodeURIComponent(query||'');
      const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=8`);
      if(!res.ok) return [];
      const data = await res.json();
      const items = Array.isArray(data.items)? data.items : [];
      return items.map(it=>{
        const v = it?.volumeInfo||{};
        return {
          id: it.id,
          title: v.title||'',
          authors: Array.isArray(v.authors)? v.authors : [],
          image: (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || '').replace('http://','https://'),
          seriesGuess: Utils.guessSeriesFromTitle(v.title||''),
        };
      });
    }catch{ return []; }
  }

  window.Metadata = { fetchBookByISBN, searchGoogleBooks };
})();
