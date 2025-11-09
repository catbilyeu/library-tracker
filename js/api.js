(function(){
  async function fetchJSON(url){ const res = await fetch(url, { headers:{ 'Accept':'application/json' } }); if(!res.ok) throw new Error('HTTP '+res.status); return res.json(); }

  async function fetchBookByISBN(isbn13){
    const d = Utils.toISBN13(isbn13); if(!d || !Utils.isValidISBN13(d)) { return {
      id: d||isbn13, isbn13: d||isbn13, title:'', authors:[], addedAt: Date.now(), borrowHistory: []
    }; }
    const book = { id: d, isbn13: d, isbn10: Utils.toISBN10(d) || undefined, title:'', authors:[], subjects:[], coverUrl: undefined, addedAt: Date.now(), borrowHistory: [] };
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
        }
      } catch{}
    }
    book.coverUrl = `https://covers.openlibrary.org/b/isbn/${d}-M.jpg`;
    return book;
  }

  window.Metadata = { fetchBookByISBN };
})();
