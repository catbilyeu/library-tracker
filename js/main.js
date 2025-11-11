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
    // Hamburger menu
    const menu = document.getElementById('hamburger');
    const toggle = menu.querySelector('.menu-toggle');
    const list = menu.querySelector('.menu-list');
    const openMenu = ()=>{ menu.classList.add('open'); toggle.setAttribute('aria-expanded','true'); };
    const closeMenu = ()=>{ menu.classList.remove('open'); toggle.setAttribute('aria-expanded','false'); };
    toggle.addEventListener('click', (e)=>{ e.stopPropagation(); if(menu.classList.contains('open')) closeMenu(); else openMenu(); });
    document.addEventListener('click', (e)=>{ if(!menu.contains(e.target)) closeMenu(); });
    document.getElementById('btn-import').addEventListener('click', ()=> { closeMenu(); document.getElementById('file-import').click(); });
    document.getElementById('btn-export').addEventListener('click', ()=> { closeMenu(); ImportExport.export(); });
    const hfBtn = document.getElementById('toggle-handsfree');
    hfBtn.addEventListener('click', ()=>{ const now = hfBtn.getAttribute('aria-pressed')!=='true'; hfBtn.setAttribute('aria-pressed', String(now)); publish('handsfree:toggle', { enabled: now }); });
    const voiceBtn = document.getElementById('toggle-voice');
    voiceBtn.addEventListener('click', ()=>{ const now = voiceBtn.getAttribute('aria-pressed')!=='true'; voiceBtn.setAttribute('aria-pressed', String(now)); publish('voice:toggle', { enabled: now }); });
    document.getElementById('btn-settings').addEventListener('click', ()=> { closeMenu(); Settings.open(); });
    // Sort select
    const sortSel = document.getElementById('sort-select');
    if(sortSel){
      // Initialize from settings
      try{
        Storage.getSettings().then(s=>{
          const saved = s.sortMode || 'series';
          sortSel.value = saved;
          window.__sortMode = saved;
        }).catch(()=>{});
      }catch{}
      sortSel.addEventListener('change', async ()=>{
        window.__sortMode = sortSel.value;
        try{ await Storage.setSettings({ sortMode: window.__sortMode }); }catch{}
        // If there is an active search query, re-run it. Otherwise, render all.
        const q = (document.getElementById('search-input')?.value||'').trim();
        if(q){ publish('search:query', { q }); }
        else { publish('shelves:render', {}); }
      });
    }

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
    switch(type){
      case 'pager:next': publish('pager:next', {}); break;
      case 'pager:prev': publish('pager:prev', {}); break;
      case 'modal:close': {
        // Close inline overlays (including those injected by Modal or remove flow)
        const overlays = Array.from(document.querySelectorAll('.inline-overlay'));
        if(overlays.length){ overlays.forEach(o=>o.remove()); }
        // Also clear any pending voice confirm
        try{ window.__voicePendingConfirm = null; }catch{}
        // Close settings if open
        try{ Settings.close?.(); }catch{}
        // Close book modal if open
        try{ Modal.close?.(); }catch{}
        break; }
      case 'search': {
        publish('search:query', { q: payload.q });
        break; }
      case 'search:clear': {
        publish('search:query', { q: '' });
        break; }
      case 'scanner:open':
        publish('scanner:open', {}); break;
      case 'book:add':
        if(!payload.isbn13){ Utils.toast('Invalid ISBN', { type:'error' }); return; }
        publish('book:add', { isbn13: payload.isbn13 }); break;
      case 'lend': {
        const results = await resolveBooks(payload.target);
        if(results.length===0){ Utils.toast('No matching book found', { type:'warn' }); return; }
        if(results.length>1){ publish('shelves:render', { books: results }); Utils.toast(`${results.length} matches — refine your request`, { type:'info' }); return; }
        const book = results[0];
        const borrowerRaw = (payload.borrower||'').trim();
        const borrower = Utils.titleCaseName ? Utils.titleCaseName(borrowerRaw) : borrowerRaw;
        if(!borrower){ Utils.toast('Missing borrower name', { type:'warn' }); return; }
        let borrowedAt = payload.borrowedAt;
        if(typeof borrowedAt !== 'number' || isNaN(borrowedAt)) borrowedAt = Date.now();
        book.borrowHistory = book.borrowHistory||[]; book.borrowHistory.push({ borrower, borrowedAt });
        await Storage.putBook(book);
        // Emit a borrow:lent event for consistency with modal flow
        try{ publish('borrow:lent', { isbn13: book.isbn13, borrower, borrowedAt }); }catch{}
        // If announcements are off, open the book modal so the user gets visual confirmation
        try{
          const settings = await Storage.getSettings();
          if(settings.voiceAnnouncements===false){ publish('modal:open', { isbn13: book.isbn13 }); }
        }catch{}
        break; }
      case 'return': {
        const results = await resolveBooks(payload.target);
        if(results.length===0){ Utils.toast('No matching book found', { type:'warn' }); return; }
        if(results.length>1){ publish('shelves:render', { books: results }); Utils.toast(`${results.length} matches — refine your request`, { type:'info' }); return; }
        const book = results[0]; const last = (book.borrowHistory||[]).slice().reverse().find(x=>!x.returnedAt);
        if(!last){ Utils.toast('Book is not currently lent out', { type:'info' }); return; }
        last.returnedAt = Date.now(); await Storage.putBook(book); break; }
      case 'borrower:return': {
        const borrower = (payload.borrower||'').trim(); if(!borrower) return;
        let returnedAt = payload.returnedAt; if(typeof returnedAt !== 'number' || isNaN(returnedAt)) returnedAt = Date.now();
        const all = await Storage.getAllBooks();
        let count=0;
        for(const b of all){
          let changed=false;
          for(const h of (b.borrowHistory||[])){
            if(!h.returnedAt && h.borrower && h.borrower.toLowerCase().trim()===borrower.toLowerCase().trim()){
              h.returnedAt = returnedAt; changed=true; count++;
            }
          }
          if(changed){ await Storage.putBook(b); }
        }
        if(count===0){ Utils.toast(`${borrower} has no outstanding books`, { type:'info' }); }
        break; }
      case 'book:check_have': {
        const results = await resolveBooks(payload.target);
        // If exactly one, open modal for quick glance
        if(results.length===1){ publish('modal:open', { isbn13: results[0].isbn13 }); }
        else if(results.length>1){ publish('shelves:render', { books: results }); }
        break; }
      case 'book:is_borrowed': {
        const results = await resolveBooks(payload.target);
        if(results.length===0){ Utils.toast('No matching book found', { type:'warn' }); return; }
        if(results.length>1){ publish('shelves:render', { books: results }); return; }
        const book = results[0];
        publish('modal:open', { isbn13: book.isbn13 });
        break; }
      case 'borrower:list': {
        const borrowerRaw = (payload.borrower||'').trim(); if(!borrowerRaw) return;
        const borrower = Utils.titleCaseName ? Utils.titleCaseName(borrowerRaw) : borrowerRaw;
        const all = await Storage.getAllBooks();
        const filtered = all.filter(b=> (b.borrowHistory||[]).some(h=> !h.returnedAt && h.borrower && h.borrower.toLowerCase().trim()===borrower.toLowerCase().trim()));
        if(filtered.length===0){ Utils.toast(`${borrower} is not borrowing any books`, { type:'info' }); }
        publish('shelves:render', { books: filtered });
        // Speak confirmation with count if voice announcements are on
        try{
          const settings = await Storage.getSettings();
          if(settings.voiceAnnouncements!==false){
            const count = filtered.length;
            const msg = count===0 ? `${borrower} is not borrowing any books` : `${borrower} is borrowing ${count} book${count===1?'':'s'}`;
            const utter = new SpeechSynthesisUtterance(msg);
            utter.lang = navigator.language || 'en-US';
            window.speechSynthesis?.speak(utter);
          }
        }catch{}
        break; }
      case 'remove': {
        const results = await resolveBooks(payload.target);
        if(results.length===0){ Utils.toast('No matching book found', { type:'warn' }); return; }
        if(results.length>1){ publish('shelves:render', { books: results }); Utils.toast(`${results.length} matches — refine your request`, { type:'info' }); return; }
        const book = results[0];
        // Inline confirm overlay (avoid native confirm)
        const overlay = document.createElement('div');
        overlay.className = 'inline-overlay overlay-pending-remove';
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
        confirmBtn.onclick = async ()=>{ await Storage.deleteBook(book.isbn13); cleanup(); };
        // Store context on window for voice confirmation
        window.__voicePendingConfirm = { action:'removeBook', payload:{ isbn13: book.isbn13 } };
        break; }
      case 'confirm:generic': {
        const pending = window.__voicePendingConfirm;
        if(!pending) return;
        // Only handle removeBook for now
        if(pending.action==='removeBook'){
          const overlay = document.querySelector('.overlay-pending-remove');
          if(overlay){ overlay.remove(); }
          await Storage.deleteBook(pending.payload.isbn13);
        }
        window.__voicePendingConfirm = null;
        break; }
      case 'handsfree:toggle':
        publish('handsfree:toggle', { enabled: !!payload.enabled }); break;
      case 'voice:toggle':
        publish('voice:toggle', { enabled: !!payload.enabled }); break;
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
    Migrate.init({ publish, subscribe });
    // Load settings and apply preferences without auto-enabling features or changing UI toggle states
    try{
      const s = await Storage.getSettings();
      try{ Voice.setAnnouncements?.(s.voiceAnnouncements!==false); }catch{}
      if(typeof s.voiceProcessDelayMs === 'number') try{ Voice.setProcessDelay?.(s.voiceProcessDelayMs); }catch{}
      try{ Voice.setPttMode?.(!!s.voicePttOnly); }catch{}
      // Do not touch aria-pressed for header buttons here
    }catch{}
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

  // Register Service Worker only on HTTPS and non-localhost (avoid cache headaches in dev)
  if ('serviceWorker' in navigator) {
    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
    const isHttps = location.protocol === 'https:';
    if (isHttps && !isLocalhost) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => {
          console.warn('SW registration failed', err);
        });
      });
    } else {
      console.info('[Library Tracker] Skipping Service Worker registration in dev (non-HTTPS or localhost).');
    }
  }

  window.App = { init, publish, subscribe };
  window.addEventListener('DOMContentLoaded', init);
})();
/* Announce page changes for a11y */
(function(){
  const origRender = window.Shelves?.render;
  if(!origRender) return;
  window.Shelves.render = function(list){
    const before = (window.__pagerInfo||{});
    const prevPages = before.pages||0; const prevIndex = before.pageIndex||0;
    const res = origRender.apply(this, arguments);
    // After render, try to infer new paging from DOM if exposed via attributes later
    try{
      // We don’t have direct access to pages in this scope; keep simple: announce page when Next/Prev clicked
      const pager = document.getElementById('pager');
      if(pager && !pager.dataset.a11yWired){
        const prev = document.getElementById('btn-prev-page');
        const next = document.getElementById('btn-next-page');
        const live = document.getElementById('results-count');
        const announce = (text)=>{ if(live) live.textContent = text; };
        if(prev){ prev.addEventListener('click', ()=> announce('Changed page')); }
        if(next){ next.addEventListener('click', ()=> announce('Changed page')); }
        pager.dataset.a11yWired='1';
      }
    }catch{}
    return res;
  };
})();
