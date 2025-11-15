(function(){
  // Simple event bus
  const handlers = new Map();
  function subscribe(event, fn){ if(!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(fn); }
  function publish(event, payload){ const set = handlers.get(event); if(set){ for(const fn of set){ try{ fn(payload||{}); } catch(e){ console.error('Handler error for', event, e); } } } window.__publish && window.__publish(event, payload); }

  function wireHeader(){
    document.getElementById('btn-scan').addEventListener('click', ()=> publish('scanner:open', {}));
    const isbnInput = document.getElementById('isbn-input');
    const add = async ()=>{
      const raw = isbnInput.value || prompt('Enter ISBN (13 or 10)'); if(!raw) return;
      let isbn13 = Utils.toISBN13(raw);
      if(!isbn13 || !Utils.isValidISBN13(isbn13)){ Utils.toast('Invalid ISBN', { type:'error' }); return; }
      publish('book:add', { isbn13 });
      isbnInput.value = '';
      try{ await Storage.setSettings({ lastAction: 'book:add', lastActionAt: Date.now() }); }catch{}
    };
    document.getElementById('btn-add').addEventListener('click', add);
    isbnInput.addEventListener('keypress', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); add(); } });
    // Hamburger menu
    const menu = document.getElementById('hamburger');
    const toggle = menu.querySelector('.menu-toggle');
    const list = menu.querySelector('.menu-list');
    const menuHf = document.getElementById('menu-hf-toggle');
    const menuVoice = document.getElementById('menu-voice-toggle');
    const hfBtn = document.getElementById('toggle-handsfree');
    const voiceBtn = document.getElementById('toggle-voice');
    const openMenu = ()=>{ menu.classList.add('open'); toggle.setAttribute('aria-expanded','true'); };
    const closeMenu = ()=>{ menu.classList.remove('open'); toggle.setAttribute('aria-expanded','false'); };
    toggle.addEventListener('click', (e)=>{ e.stopPropagation(); if(menu.classList.contains('open')) closeMenu(); else openMenu(); });
    document.addEventListener('click', (e)=>{ if(!menu.contains(e.target)) closeMenu(); });
    document.getElementById('btn-import').addEventListener('click', ()=> { closeMenu(); document.getElementById('file-import').click(); });
    document.getElementById('btn-export').addEventListener('click', ()=> { closeMenu(); ImportExport.export(); });
    document.getElementById('btn-settings').addEventListener('click', ()=> { closeMenu(); Settings.open(); });
    // Mirror toggle state between header buttons and menu items
    const syncMenuChecks = ()=>{
      if(menuHf && hfBtn){ menuHf.setAttribute('aria-checked', String(hfBtn.getAttribute('aria-pressed')==='true')); }
      if(menuVoice && voiceBtn){ menuVoice.setAttribute('aria-checked', String(voiceBtn.getAttribute('aria-pressed')==='true')); }
    };
    syncMenuChecks();
    menuHf?.addEventListener('click', ()=>{
      const now = !(hfBtn?.getAttribute('aria-pressed')==='true');
      hfBtn?.setAttribute('aria-pressed', String(now));
      publish('handsfree:toggle', { enabled: now });
      syncMenuChecks();
      if(now){ openInfoModal('hf'); }
      closeMenu();
    });
    menuVoice?.addEventListener('click', ()=>{
      const now = !(voiceBtn?.getAttribute('aria-pressed')==='true');
      voiceBtn?.setAttribute('aria-pressed', String(now));
      publish('voice:toggle', { enabled: now });
      syncMenuChecks();
      if(now){ openInfoModal('voice'); }
      closeMenu();
    });
    // Header quick toggles still work (desktop), keep them in sync
    hfBtn?.addEventListener('click', ()=>{ const now = hfBtn.getAttribute('aria-pressed')!=='true'; hfBtn.setAttribute('aria-pressed', String(now)); publish('handsfree:toggle', { enabled: now }); syncMenuChecks(); if(now){ openInfoModal('hf'); }});
    voiceBtn?.addEventListener('click', ()=>{ const now = voiceBtn.getAttribute('aria-pressed')!=='true'; voiceBtn.setAttribute('aria-pressed', String(now)); publish('voice:toggle', { enabled: now }); syncMenuChecks(); if(now){ openInfoModal('voice'); }});
    // Auth button
    const loginBtn = document.getElementById('btn-login');
    if(loginBtn){ loginBtn.addEventListener('click', async ()=>{
      try{
        if(Firebase?.getUser?.()){
          // Force redirect to Google login immediately after sign out
          await Firebase.signOut();
          await Firebase.signIn(); // redirect flow
        } else {
          await Firebase.signIn(); // redirect or popup
        }
      }catch(e){ Utils.toast('Auth error', { type:'error' }); }
    }); }
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

  // Show info modal for Hands-Free or Voice
  function openInfoModal(kind){
    const id = kind === 'hf' ? 'hf-info-modal' : 'voice-info-modal';
    const el = document.getElementById(id);
    if(!el) return;
    el.classList.add('open');
    el.setAttribute('aria-hidden','false');
    const cleanup = ()=>{ el.classList.remove('open'); el.setAttribute('aria-hidden','true'); };
    const closeBtn = el.querySelector('button.close');
    closeBtn?.addEventListener('click', cleanup, { once: true });
    // Close when clicking backdrop
    el.addEventListener('click', (e)=>{ if(e.target === el) cleanup(); });
    // Close with Esc
    el.addEventListener('keydown', (e)=>{ if(e.key === 'Escape'){ e.preventDefault(); cleanup(); } });
    // Focus the close button for a11y
    closeBtn?.focus?.();
  }

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
    // Attempt to focus a useful editable target before click, to help inputs pick up focus
    let clickedTarget = null;
    try{
      let target = document.elementFromPoint(x, y);
      clickedTarget = target || el;
      // If it's a label pointing to an input, focus the input first
      let candidate = clickedTarget;
      const isLabel = candidate && candidate.tagName && candidate.tagName.toLowerCase()==='label';
      if(isLabel){
        const forId = candidate.getAttribute('for');
        const linked = forId ? document.getElementById(forId) : null;
        if(linked){ linked.focus?.(); candidate = linked; }
      }
      // If not label or label had no target, find nearest editable inside or above
      if(!document.activeElement || document.activeElement===document.body){
        // Upward search for focusable
        let node = candidate;
        const isEditable = (el)=> el && ((el.isContentEditable) || (el.tagName && ['input','textarea','select'].includes(el.tagName.toLowerCase())));
        let focusEl = null;
        for(let i=0;i<3 && node;i++){
          if(isEditable(node)){ focusEl = node; break; }
          node = node.parentElement;
        }
        // Downward search if still not found
        if(!focusEl && candidate && candidate.querySelector){
          focusEl = candidate.querySelector('input,textarea,[contenteditable="true"],select');
        }
        if(focusEl){ focusEl.focus?.(); }
      }
    }catch{}

    Utils.synthesizeClick(x, y);
    // After the synthetic click settles, try to open date pickers and then optionally start dictation
    setTimeout(()=>{
      try{
        const isDateInput = (node)=> node && node.tagName && node.tagName.toLowerCase()==='input' && (node.type||'').toLowerCase()==='date';
        // Prefer the element we actually clicked, then fall back to activeElement
        let ae = document.activeElement;
        let preferred = clickedTarget;
        // If we clicked a label, resolve its control again
        if(preferred && preferred.tagName && preferred.tagName.toLowerCase()==='label'){
          const forId = preferred.getAttribute('for');
          const linked = forId ? document.getElementById(forId) : null;
          if(linked) preferred = linked;
        }
        // If we clicked inside something that contains a date input, grab that
        if(preferred && !isDateInput(preferred) && preferred.closest){
          const inside = preferred.closest('input[type="date"]') || (preferred.querySelector && preferred.querySelector('input[type="date"]')) || null;
          if(inside) preferred = inside;
        }
        // If either preferred or active element is a date input, focus and attempt to open its picker
        const dateEl = isDateInput(preferred) ? preferred : (isDateInput(ae) ? ae : null);
        if(dateEl){
          dateEl.focus?.();
          try{ if(typeof dateEl.showPicker === 'function'){ dateEl.showPicker(); } }catch{}
          // Do NOT start dictation on date inputs; they are not text fields
          return;
        }
        // Otherwise, if the focused element is an editable text field, start dictation
        if(isEditable(ae)){
          ae.focus?.();
          publish('voice:dictation:start', { target: ae });
        }
      }catch{}
    }, 0);
  }

  function isEditable(el){
    if(!el) return false;
    if(el.isContentEditable) return true;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if(tag==='textarea') return true;
    if(tag==='input'){
      const t=(el.type||'').toLowerCase();
      return ['text','search','email','url','tel','number','password','date'].includes(t);
    }
    return false;
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
        // If a confirmation or inline overlay is open, close that first and stop (do not close the book modal)
        const overlays = Array.from(document.querySelectorAll('.inline-overlay'));
        if(overlays.length){ overlays.forEach(o=>o.remove()); try{ window.__voicePendingConfirm = null; }catch{} break; }
        // Otherwise, close app-level panels and modals
        try{ Settings.close?.(); }catch{}
        try{ Modal.close?.(); }catch{}
        try{ window.Scanner?.close?.(); }catch{}
        try{
          const so = document.getElementById('scanner-overlay');
          if(so){ so.hidden = true; so.innerHTML = ''; }
        }catch{}
        try{
          ['hf-info-modal','voice-info-modal'].forEach(id=>{
            const el = document.getElementById(id);
            if(el){ el.classList.remove('open'); el.setAttribute('aria-hidden','true'); }
          });
        }catch{}
        break; }
      case 'search': {
        publish('search:query', { q: payload.q });
        break; }
      case 'search:clear': {
        publish('search:query', { q: '' });
        break; }
      case 'scanner:open':
        publish('scanner:open', {}); break;
      case 'voice:toggle': {
        const on = !!payload.enabled;
        // Reflect UI state
        try{ const vBtn = document.getElementById('toggle-voice'); if(vBtn) vBtn.setAttribute('aria-pressed', String(on)); }catch{}
        // Persist preference
        try{ await Storage.setSettings({ voiceEnabled: on }); }catch{}
        // Toggle engine
        publish('voice:toggle', { enabled: on });
        break; }
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
        // Always open the book modal to show the new entry
        try{ publish('modal:open', { isbn13: book.isbn13 }); }catch{}
        break; }
      case 'return': {
        const results = await resolveBooks(payload.target);
        if(results.length===0){ Utils.toast('No matching book found', { type:'warn' }); return; }
        if(results.length>1){ publish('shelves:render', { books: results }); Utils.toast(`${results.length} matches — refine your request`, { type:'info' }); return; }
        const book = results[0];
        const borrowerFilter = (payload.borrower||'').trim().toLowerCase();
        const openEntries = (book.borrowHistory||[]).filter(h=>!h.returnedAt);
        let entry = null;
        if(borrowerFilter){ entry = openEntries.find(h=> (h.borrower||'').trim().toLowerCase()===borrowerFilter); }
        if(!entry) entry = openEntries.slice().reverse()[0];
        if(!entry){ Utils.toast('Book is not currently lent out', { type:'info' }); return; }
        entry.returnedAt = Date.now();
        await Storage.putBook(book);
        // Open the book modal to show updated status
        try{ publish('modal:open', { isbn13: book.isbn13 }); }catch{}
        break; }
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
      case 'borrower:return_all': {
        const borrowerRaw = (payload.borrower||'').trim(); if(!borrowerRaw) return;
        const borrower = Utils.titleCaseName ? Utils.titleCaseName(borrowerRaw) : borrowerRaw;
        const all = await Storage.getAllBooks();
        const openLoans = all.filter(b=> (b.borrowHistory||[]).some(h=> !h.returnedAt && h.borrower && h.borrower.toLowerCase().trim()===borrower.toLowerCase().trim()));
        // Build confirmation overlay with list of titles
        const overlay = document.createElement('div'); overlay.className = 'inline-overlay overlay-pending-bulk-return'; overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true');
        const dialog = document.createElement('div'); dialog.className = 'dialog';
        const h3 = document.createElement('h3'); h3.id = 'bulk-return-title'; h3.textContent = `Return these books for ${borrower}?`;
        const list = document.createElement('ul'); list.style.maxHeight='40vh'; list.style.overflow='auto';
        if(openLoans.length){
          openLoans.forEach(b=>{ const li=document.createElement('li'); li.textContent = b.title || '(Untitled)'; list.appendChild(li); });
        } else {
          const li=document.createElement('li'); li.textContent = '(No outstanding books)'; list.appendChild(li);
        }
        const actions=document.createElement('div'); actions.className='actions';
        const cancelBtn=document.createElement('button'); cancelBtn.type='button'; cancelBtn.textContent='Cancel';
        const confirmBtn=document.createElement('button'); confirmBtn.type='button'; confirmBtn.className='accent'; confirmBtn.textContent='Return';
        actions.appendChild(cancelBtn); actions.appendChild(confirmBtn);
        dialog.appendChild(h3); dialog.appendChild(list); dialog.appendChild(actions);
        overlay.appendChild(dialog); document.body.appendChild(overlay);
        confirmBtn.focus();
        const cleanup=()=> overlay.remove();
        overlay.addEventListener('keydown',(e)=>{ if(e.key==='Escape'){ e.preventDefault(); cleanup(); }});
        cancelBtn.onclick = ()=>{ cleanup(); try{ window.Modal?.close?.(); }catch{} };
        confirmBtn.onclick = async ()=>{
          let count=0; const allBooks = await Storage.getAllBooks();
          for(const b of allBooks){
            const open = (b.borrowHistory||[]).find(h=> h.borrower && h.borrower.toLowerCase().trim()===borrower.toLowerCase().trim() && !h.returnedAt);
            if(open){ open.returnedAt = Date.now(); await Storage.putBook(b); count++; }
          }
          cleanup();
          try{ window.Modal?.close?.(); }catch{}
          Utils.toast(`Returned ${count} book${count===1?'':'s'} for ${borrower}`, { type:'ok' });
        };
        // Store context for voice confirmation
        window.__voicePendingConfirm = { action:'bulkReturn', payload:{ borrower } };
        // Speak announcements prompt if enabled
        try{
          const settings = await Storage.getSettings();
          if(settings.voiceAnnouncements!==false){
            const count = openLoans.length;
    // Now that we’re listening for auth:state, initialize Firebase
    try{ await Firebase.init({ publish, subscribe }); }catch{}

            const msg = `Return ${count} book${count===1?'':'s'} for ${borrower}?`;
            const utter = new SpeechSynthesisUtterance(msg);
            utter.lang = navigator.language || 'en-US';
            window.speechSynthesis?.speak(utter);
          }
        }catch{}
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
        // Open the book modal first
        try{ publish('modal:open', { isbn13: book.isbn13 }); }catch{}
        // Then show an inline confirmation overlay anchored to the modal so it appears above it
        const mkOverlay = ()=>{
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
          overlay.appendChild(dialog);
          // Append overlay to body so it persists across modal re-renders and layers above
          document.body.appendChild(overlay);
          confirmBtn.focus();
          const cleanup=()=> overlay.remove();
          overlay.addEventListener('keydown',(e)=>{ if(e.key==='Escape'){ e.preventDefault(); cleanup(); }});
          cancelBtn.onclick = ()=>{ cleanup(); try{ window.__voicePendingConfirm = null; }catch{} };
          confirmBtn.onclick = async ()=>{
            await Storage.deleteBook(book.isbn13);
            try{ publish('book:removed', { isbn13: book.isbn13 }); }catch{}
            cleanup();
            try{ window.Modal?.close?.(); }catch{}
          };
          // Store context on window for voice confirmation
          window.__voicePendingConfirm = { action:'removeBook', payload:{ isbn13: book.isbn13 } };
        };
        // Delay a tick to let modal render before inserting overlay
        setTimeout(mkOverlay, 0);
        break; }
      case 'confirm:generic': {
        const pending = window.__voicePendingConfirm;
        if(!pending) return;
        // Handle bulk return
        if(pending.action==='bulkReturn'){
          const borrower = pending.payload.borrower;
          const all = await Storage.getAllBooks();
          let count=0;
          for(const b of all){
            const open = (b.borrowHistory||[]).find(h=> h.borrower && h.borrower.toLowerCase().trim()===borrower.toLowerCase().trim() && !h.returnedAt);
            if(open){ open.returnedAt = Date.now(); await Storage.putBook(b); count++; }
          }
          Utils.toast(`Returned ${count} book${count===1?'':'s'} for ${borrower}`, { type:'ok' });
        }
        if(pending.action==='removeBook'){
          const overlay = document.querySelector('.overlay-pending-remove');
          if(overlay){ overlay.remove(); }
          await Storage.deleteBook(pending.payload.isbn13);
          try{ publish('book:removed', { isbn13: pending.payload.isbn13 }); }catch{}
          try{ window.Modal?.close?.(); }catch{}
        }
        if(pending.action==='removeHistoryEntry'){
          try{
            const book = await Storage.getBook(pending.payload.isbn13);
            const idx = pending.payload.idx;
            if(book && Array.isArray(book.borrowHistory) && idx>=0 && idx<book.borrowHistory.length){
              book.borrowHistory.splice(idx,1);
              await Storage.putBook(book);
              const ovr = document.querySelector('.overlay-pending-history-remove'); if(ovr) ovr.remove();
              publish('modal:open', { isbn13: pending.payload.isbn13 });
            }
          }catch{}
        }
        window.__voicePendingConfirm = null;
        break; }
      case 'handsfree:toggle':
        publish('handsfree:toggle', { enabled: !!payload.enabled }); break;
      case 'voice:info': {
        try{ const openInfoModal = window.App && window.App.openInfoModal ? window.App.openInfoModal : null; if(openInfoModal){ openInfoModal('voice'); } else { const el = document.getElementById('voice-info-modal'); if(el){ el.classList.add('open'); el.setAttribute('aria-hidden','false'); } } }catch{}
        break; }
    }
  }

  async function init(){
    // Init modules
    Storage.init(publish);
    // Switch Storage backend based on auth state
    subscribe('auth:state', async ({ user })=>{
      const loginBtn = document.getElementById('btn-login');
      const overlay = document.getElementById('auth-overlay');
      const hideAuthOverlay = ()=>{
        if(overlay){
          // Use the hidden attribute as the single source of truth for visibility
          overlay.hidden = true;
          try{
            // Remove any inline styles/classes from previous sessions so future show() works
            overlay.style.removeProperty('display');
            overlay.removeAttribute('aria-hidden');
            overlay.classList.remove('gone');
          }catch{}
        }
      };
      if(user){
        document.body.classList.remove('signed-out');
        Storage.setBackend(Firebase.CloudStorage);
        // Apply settings from cloud (per-user)
        try{
          const sCloud = await Storage.getSettings();
          // Theme
          try{
            const t = sCloud.theme || 'dark';
            if(t && t !== 'dark') document.documentElement.setAttribute('data-theme', t);
            else document.documentElement.removeAttribute('data-theme');
          }catch{}
          // Hands-Free/Voice runtime state based on cloud prefs
          try{
            const hfBtn = document.getElementById('toggle-handsfree');
            const vBtn = document.getElementById('toggle-voice');
            if(typeof sCloud.handsFreeEnabled === 'boolean'){
              if(hfBtn) hfBtn.setAttribute('aria-pressed', String(!!sCloud.handsFreeEnabled));
              publish('handsfree:toggle', { enabled: !!sCloud.handsFreeEnabled });
            }
            if(typeof sCloud.voiceEnabled === 'boolean'){
              if(vBtn) vBtn.setAttribute('aria-pressed', String(!!sCloud.voiceEnabled));
              publish('voice:toggle', { enabled: !!sCloud.voiceEnabled });
            }
          }catch{}
          // Sort mode from cloud settings
          try{
            const sortSel = document.getElementById('sort-select');
            if(sCloud.sortMode){
              window.__sortMode = sCloud.sortMode;
              if(sortSel) sortSel.value = sCloud.sortMode;
              // Re-render with the selected sort mode
              const allBooks = await Storage.getAllBooks();
              Search.setIndex(allBooks);
              Shelves.render(allBooks);
            }
          }catch{}
        }catch{}
        // First-time sign-in: offer to import local books to cloud if cloud is empty
        try{
          const s = await Storage.getSettings();
          const alreadyInit = !!s.__cloudInitDone;
          const localBooks = await window.StorageLocal.getAllBooks();
          const cloudBooks = await Storage.getAllBooks();
          if(!alreadyInit && (cloudBooks?.length||0) === 0 && (localBooks?.length||0) > 0){
            const overlay2 = document.createElement('div'); overlay2.className='inline-overlay overlay-import-migrate'; overlay2.setAttribute('role','dialog'); overlay2.setAttribute('aria-modal','true');
            const dialog = document.createElement('div'); dialog.className='dialog';
            const h3 = document.createElement('h3'); h3.textContent = 'Import your local books to the cloud?';
            const p = document.createElement('p'); p.textContent = `We found ${localBooks.length} book${localBooks.length===1?'':'s'} saved locally. Import them to your account so they sync across devices?`;
            const actions = document.createElement('div'); actions.className='actions';
            const skipBtn = document.createElement('button'); skipBtn.textContent='Skip';
            const importBtn = document.createElement('button'); importBtn.className='accent'; importBtn.textContent='Import';
            actions.appendChild(skipBtn); actions.appendChild(importBtn);
            dialog.appendChild(h3); dialog.appendChild(p); dialog.appendChild(actions);
            overlay2.appendChild(dialog); document.body.appendChild(overlay2);
            const cleanup = ()=> overlay2.remove();
            skipBtn.onclick = async ()=>{ await Storage.setSettings({ __cloudInitDone:true }); cleanup(); };
            importBtn.onclick = async ()=>{
              try{ await Storage.bulkPut(localBooks); await Storage.setSettings({ __cloudInitDone:true }); Utils.toast(`Imported ${localBooks.length} book${localBooks.length===1?'':'s'}`, { type:'ok' }); }
              catch(e){ console.error('Import to cloud failed', e); Utils.toast('Import failed', { type:'error' }); }
              finally{
                try{ await Storage.clearLocalBooks?.(); }catch{}
                cleanup();
                const all = await Storage.getAllBooks(); Search.setIndex(all); Shelves.render(all);
              }
            };
          } else if(!alreadyInit) {
            await Storage.setSettings({ __cloudInitDone:true });
          }
        }catch(e){ console.warn('First-time cloud init check failed', e); }
        if(loginBtn){ loginBtn.textContent = 'Sign out'; loginBtn.title = `Signed in as ${user.displayName||user.email||'user'}`; }
        hideAuthOverlay();
        Utils.toast(`Signed in as ${user.displayName||user.email}`, { type:'ok' });
        const all = await Storage.getAllBooks(); Search.setIndex(all); Shelves.render(all);
      } else {
        document.body.classList.add('signed-out');
        // Preserve current theme/settings when signing out so the UI doesn't reset
        try{
          const prev = await Storage.getSettings(); // from current backend (likely cloud)
          try{ await window.StorageLocal.setSettings(prev); }catch{}
          try{
            const t = prev.theme || 'dark';
            if(t && t !== 'dark') document.documentElement.setAttribute('data-theme', t);
            else document.documentElement.removeAttribute('data-theme');
          }catch{}
        }catch{}
        Storage.setBackend(window.StorageLocal);
        if(loginBtn){ loginBtn.textContent = 'Sign in'; loginBtn.title = 'Sign in with Google'; }
        // After sign out, show the login overlay so user can sign back in
        try{
          if(overlay){
            overlay.hidden = false;
            const btn = document.getElementById('btn-auth-google');
            btn?.focus?.();
          }
        }catch{}
      }
    });

    Shelves.init({ publish, subscribe });
    Modal.init({ publish, subscribe });
    Scanner.init({ publish, subscribe });
    Search.init({ publish, subscribe });
    ImportExport.init({ publish, subscribe });
    HandsFree.init({ publish, subscribe });
    Voice.init({ publish, subscribe });
    Migrate.init({ publish, subscribe });
    // Wire event subscriptions for Hands-Free click and Voice intents
    subscribe('handsfree:click', onHandsfreeClick);
    subscribe('voice:intent', onVoiceIntent);
    // Book add and scanner events
    subscribe('book:add', onBookAdd);
    subscribe('scanner:detected', onScannerDetected);
    // Load settings and apply preferences
    try{
      const s = await Storage.getSettings();
      try{ Voice.setAnnouncements?.(s.voiceAnnouncements!==false); }catch{}
      if(typeof s.voiceProcessDelayMs === 'number') try{ Voice.setProcessDelay?.(s.voiceProcessDelayMs); }catch{}
      try{ Voice.setPttMode?.(!!s.voicePttOnly); }catch{}
      // Apply theme
      try{
        const t = s.theme || 'dark';
        if(t && t !== 'dark') document.documentElement.setAttribute('data-theme', t);
        else document.documentElement.removeAttribute('data-theme');
      }catch{}
      // Hands-Free tuning at startup
      try{
        if(typeof s.handsFreeSensitivity === 'number') HandsFree.setSensitivity?.(s.handsFreeSensitivity);
        if(typeof s.handsFreePinchSensitivity === 'number') HandsFree.setPinchSensitivity?.(s.handsFreePinchSensitivity);
        if(typeof s.handsFreeMirrorX === 'boolean') HandsFree.setMirrorX?.(!!s.handsFreeMirrorX);
      }catch{}
      // Auto-enable features based on saved settings and reflect header toggle state
      try{
        if(s.handsFreeEnabled){
          publish('handsfree:toggle', { enabled: true });
          const btn = document.getElementById('toggle-handsfree');
          if(btn) btn.setAttribute('aria-pressed','true');
        }
        if(s.voiceEnabled){
          publish('voice:toggle', { enabled: true });
          const btn = document.getElementById('toggle-voice');
          if(btn) btn.setAttribute('aria-pressed','true');
        }
      }catch{}
    }catch{}
    Settings.init({ publish, subscribe });

    // Initialize Firebase after wiring auth listener
    try{ await Firebase.init({ publish, subscribe }); }catch{}

    // Wire header and events
    wireHeader();
    // Auth overlay buttons
    const authOverlay = document.getElementById('auth-overlay');
    const authGoogle = document.getElementById('btn-auth-google');
    if(authGoogle){ authGoogle.addEventListener('click', async ()=>{
      try{ await Firebase.signIn(); authOverlay.hidden = true; } catch(e){ Utils.toast('Sign-in failed', { type:'error' }); }
    }); }

    subscribe('auth:require', ()=>{ const o=document.getElementById('auth-overlay'); if(o) o.hidden=false; });

    // Load initial data
    let books = await Storage.getAllBooks();
    // Render immediately (even if empty) to avoid blocking on bootstrap fetch
    Search.setIndex(books);
    Shelves.render(books);
  }

  // In dev or on GitHub Pages, always register SW to ensure cache busting takes effect
  // Only register Service Worker on secure origins (https or localhost). Avoids errors on file:// or custom schemes.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    // Auto-reload the page once when a new Service Worker takes control to avoid mixed old/new assets
    let swRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swRefreshing) return; swRefreshing = true; window.location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then(()=>{
        try{ navigator.serviceWorker.getRegistrations().then(rs=> rs.forEach(r=> r.update())); }catch{}
      }).catch((err) => {
        console.warn('SW registration failed', err);
      });
    });
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

  // Info badges (hover/focus tooltips are CSS-only). Ensure keyboard focus shows content
  try{
    const infoBtns = [document.getElementById('info-handsfree'), document.getElementById('info-voice')].filter(Boolean);
    infoBtns.forEach(btn=>{
      btn.addEventListener('keydown', (e)=>{
        if(e.key==='Enter' || e.key===' '){ e.preventDefault(); const card = btn.querySelector('.info-card'); if(card){ card.style.display = card.style.display==='block' ? '' : 'block'; } }
        if(e.key==='Escape'){ const card = btn.querySelector('.info-card'); if(card){ card.style.display=''; } }
      });
      btn.addEventListener('blur', ()=>{ const card = btn.querySelector('.info-card'); if(card){ card.style.display=''; } }, true);
    });
  }catch{}
