(function(){
  // Simple event bus
  const handlers = new Map();
  function subscribe(event, fn){ if(!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(fn); }
  function publish(event, payload){ const set = handlers.get(event); if(set){ for(const fn of set){ try{ fn(payload||{}); } catch(e){ console.error('Handler error for', event, e); } } } }

  function wireHeader(){
    document.getElementById('btn-scan').addEventListener('click', ()=> publish('scanner:open', {}));
    const isbnInput = document.getElementById('isbn-input');
    const add = async ()=>{
      const raw = isbnInput.value || prompt('Enter ISBN (13 or 10)'); if(!raw) return;
      let isbn13 = Utils.toISBN13(raw);
      if(!isbn13 || !Utils.isValidISBN13(isbn13)){ Utils.toast('Invalid ISBN', { type:'error' }); return; }
      publish('book:add', { isbn13 });
      isbnInput.value = '';
    };
    document.getElementById('btn-add').addEventListener('click', add);
    isbnInput.addEventListener('keypress', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); add(); } });
    document.getElementById('btn-import').addEventListener('click', ()=> document.getElementById('file-import').click());
    document.getElementById('btn-export').addEventListener('click', ()=> ImportExport.export());
    const hfBtn = document.getElementById('toggle-handsfree');
    hfBtn.addEventListener('click', ()=>{ const now = hfBtn.getAttribute('aria-pressed')!=='true'; hfBtn.setAttribute('aria-pressed', String(now)); publish('handsfree:toggle', { enabled: now }); });
    const voiceBtn = document.getElementById('toggle-voice');
    voiceBtn.addEventListener('click', ()=>{ const now = voiceBtn.getAttribute('aria-pressed')!=='true'; voiceBtn.setAttribute('aria-pressed', String(now)); publish('voice:toggle', { enabled: now }); });
    document.getElementById('btn-settings').addEventListener('click', ()=> Settings.open());
  }

  async function onBookAdd({ isbn13 }){
    try{
      const book = await Metadata.fetchBookByISBN(isbn13);
      await Storage.putBook(book);
      Utils.toast('Book added', { type:'ok' });
    } catch(e){ console.error(e); Utils.toast('Failed to add book', { type:'error' }); }
  }

  async function onScannerDetected({ isbn13 }){ publish('book:add', { isbn13 }); }

  function onHandsfreeClick({ x, y }){
    // brief hover highlight
    const el = document.elementFromPoint(x, y);
    if(el){
      el.classList?.add('hf-hover');
      setTimeout(()=> el.classList?.remove('hf-hover'), 500);
    }
    Utils.synthesizeClick(x, y);
  }

  async function resolveBooks(query){
    const all = await Storage.getAllBooks();
    // prefer direct ISBN match
    const norm = Utils.normalizeDigits(query);
    if(norm && all.find(b=> b.isbn13===norm)) return [all.find(b=> b.isbn13===norm)];
    const fuse = new Fuse(all, { includeScore:true, threshold:0.35, keys:['title','authors','isbn13','isbn10'] });
    return fuse.search(query).map(r=>r.item);
  }

  async function onVoiceIntent({ type, payload }){
    const speak = (msg)=> { try{ window.speechSynthesis?.speak(new SpeechSynthesisUtterance(msg)); } catch{} };
    switch(type){
      case 'search':
        publish('search:query', { q: payload.q }); speak(`Searching for ${payload.q}`); break;
      case 'scanner:open':
        publish('scanner:open', {}); speak('Opening scanner'); break;
      case 'book:add':
        if(!payload.isbn13){ speak('Invalid ISBN'); return; }
        publish('book:add', { isbn13: payload.isbn13 }); speak('Adding book'); break;
      case 'lend': {
        const results = await resolveBooks(payload.target);
        if(results.length===0){ speak('No matching book found'); return; }
        if(results.length>1){ publish('shelves:render', { books: results }); speak(`${results.length} matches, refine your request`); return; }
        const book = results[0];
        const borrower = payload.borrower;
        if(!borrower){ speak('Missing borrower name'); return; }
        let borrowedAt = payload.borrowedAt;
        if(typeof borrowedAt !== 'number' || isNaN(borrowedAt)) borrowedAt = Date.now();
        book.borrowHistory = book.borrowHistory||[]; book.borrowHistory.push({ borrower, borrowedAt });
        await Storage.putBook(book); speak(`Lent ${book.title} to ${borrower}`); break; }
      case 'return': {
        const results = await resolveBooks(payload.target);
        if(results.length===0){ speak('No matching book found'); return; }
        if(results.length>1){ publish('shelves:render', { books: results }); speak(`${results.length} matches, refine your request`); return; }
        const book = results[0]; const last = (book.borrowHistory||[]).slice().reverse().find(x=>!x.returnedAt);
        if(!last){ speak('Book is not currently lent out'); return; }
        last.returnedAt = Date.now(); await Storage.putBook(book); speak(`Returned ${book.title}`); break; }
      case 'remove': {
        const results = await resolveBooks(payload.target);
        if(results.length===0){ speak('No matching book found'); return; }
        if(results.length>1){ publish('shelves:render', { books: results }); speak(`${results.length} matches, refine your request`); return; }
        const book = results[0];
        // Inline confirm overlay (avoid native confirm)
        const overlay = document.createElement('div');
        overlay.className = 'inline-overlay';
        overlay.setAttribute('role','dialog');
        overlay.setAttribute('aria-modal','true');
        overlay.setAttribute('aria-labelledby','remove-title');
        const dialog = document.createElement('div');
        dialog.className = 'dialog';
        const h3 = document.createElement('h3'); h3.id = 'remove-title'; h3.textContent = 'Remove book';
        const msg = document.createElement('p'); msg.textContent = `Are you sure you want to remove "${book.title||'(Untitled)'}" from your library?`;
        const actions = document.createElement('div'); actions.className = 'actions';
        const cancelBtn = document.createElement('button'); cancelBtn.type='button'; cancelBtn.textContent='Cancel';
        const confirmBtn = document.createElement('button'); confirmBtn.type='button'; confirmBtn.className='danger'; confirmBtn.textContent='Remove';
        actions.appendChild(cancelBtn); actions.appendChild(confirmBtn);
        dialog.appendChild(h3); dialog.appendChild(msg); dialog.appendChild(actions);
        overlay.appendChild(dialog); document.body.appendChild(overlay);
        confirmBtn.focus();
        const cleanup=()=> overlay.remove();
        overlay.addEventListener('keydown',(e)=>{ if(e.key==='Escape'){ e.preventDefault(); cleanup(); }});
        cancelBtn.onclick = cleanup;
        confirmBtn.onclick = async ()=>{ await Storage.deleteBook(book.isbn13); cleanup(); speak('Removed'); };
        break; }
      case 'handsfree:toggle':
        publish('handsfree:toggle', { enabled: !!payload.enabled }); speak(`Hands free ${payload.enabled? 'on':'off'}`); break;
      case 'voice:toggle':
        publish('voice:toggle', { enabled: !!payload.enabled }); speak(`Voice ${payload.enabled? 'on':'off'}`); break;
    }
  }

  async function init(){
    // Init modules
    Storage.init(publish);
    Shelves.init({ publish, subscribe });
    Modal.init({ publish, subscribe });
    Scanner.init({ publish, subscribe });
    Search.init({ publish, subscribe });
    ImportExport.init({ publish, subscribe });
    HandsFree.init({ publish, subscribe });
    Voice.init({ publish, subscribe });
    Settings.init({ publish, subscribe });

    // Wire header and events
    wireHeader();
    subscribe('book:add', onBookAdd);
    subscribe('scanner:detected', onScannerDetected);
    subscribe('handsfree:click', onHandsfreeClick);
    subscribe('voice:intent', onVoiceIntent);

    // Load initial data
    let books = await Storage.getAllBooks();
    // Bootstrap import if empty and bundled sample exists
    if((books?.length||0) === 0){
      try{
        const res = await fetch('real-books-50.json', { cache:'no-store' });
        if(res.ok){
          const data = await res.json();
          const list = Object.values(data.books||{});
          if(list.length){
            await Storage.bulkPut(list);
            Utils.toast(`Imported ${list.length} books (bootstrap)`, { type:'ok' });
            books = await Storage.getAllBooks();
          }
        }
      }catch(e){ /* ignore */ }
    }
    Search.setIndex(books);
    Shelves.render(books);
  }

  // Register Service Worker on load
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.warn('SW registration failed', err);
      });
    });
  }

  window.App = { init, publish, subscribe };
  window.addEventListener('DOMContentLoaded', init);
})();
