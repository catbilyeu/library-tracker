(function(){
  let publish=()=>{}; let subscribe=()=>{}; let books = [];
  // Manage incremental rendering state
  let _pendingIdleId = null; let _pendingTimeoutId = null; let _renderSeq = 0;
  const el = () => document.getElementById('shelves');

  function card(b){
    const img = b.coverUrl || `https://covers.openlibrary.org/b/isbn/${b.isbn13}-M.jpg`;
    return `<article class="book-card" data-isbn="${b.isbn13}" tabindex="0" aria-label="${b.title}">
      <img loading="lazy" src="${img}" data-isbn="${b.isbn13}" onerror="Utils.coverErr(this)" alt="Cover of ${b.title||'Unknown'}" />
      <div class="meta">
        <h3 class="title">${b.title||'(Untitled)'}</h3>
        <p class="authors">${(b.authors||[]).join(', ')}</p>
      </div>
    </article>`;
  }

  // Attach event handlers using event delegation so newly appended items work automatically
  function attachDelegatedHandlers(root){
    if(!root || root.dataset.handlersAttached === '1') return;
    const open = (cardEl)=>{
      if(!cardEl) return;
      const isbn = cardEl.getAttribute('data-isbn');
      publish('modal:open', { isbn13: isbn });
    };
    root.addEventListener('click', (e)=>{
      const cardEl = e.target && e.target.closest ? e.target.closest('.book-card') : null;
      if(cardEl && root.contains(cardEl)) open(cardEl);
    });
    root.addEventListener('keypress', (e)=>{
      const cardEl = e.target && e.target.closest ? e.target.closest('.book-card') : null;
      if(cardEl && (e.key==='Enter' || e.key===' ')) { e.preventDefault(); open(cardEl); }
    });
    root.dataset.handlersAttached = '1';
  }

  function cancelPending(){
    if(typeof window !== 'undefined' && 'cancelIdleCallback' in window && _pendingIdleId!=null){
      try { window.cancelIdleCallback(_pendingIdleId); } catch(_){ /* noop */ }
    }
    if(_pendingTimeoutId!=null) clearTimeout(_pendingTimeoutId);
    _pendingIdleId = null; _pendingTimeoutId = null;
  }

  function scheduleAppend(root, startIndex, token){
    const CHUNK = 200;
    const appendChunk = () => {
      // If a new render started, abort
      if(token !== _renderSeq) return;
      const end = Math.min(startIndex + CHUNK, books.length);
      if(startIndex >= end) return;
      const html = books.slice(startIndex, end).map(card).join('');
      root.insertAdjacentHTML('beforeend', html);
      if(end < books.length){
        scheduleAppend(root, end, token);
      } else {
        _pendingIdleId = null; _pendingTimeoutId = null;
      }
    };
    if(typeof window !== 'undefined' && 'requestIdleCallback' in window){
      _pendingIdleId = window.requestIdleCallback(appendChunk);
    } else {
      _pendingTimeoutId = setTimeout(appendChunk, 0);
    }
  }

  function render(list){
    books = list || books;
    const root = el();
    if(!root) return;
    // Cancel any in-flight incremental renders and bump sequence
    cancelPending();
    _renderSeq++;
    if(!books || books.length===0){
      root.innerHTML = `<div class="empty-state">No books yet. Add with Scan or Add ISBN.</div>`; return;
    }

    const BIG = 400; const FIRST_CHUNK = 200;
    if(books.length > BIG){
      // Initial render of first chunk
      root.innerHTML = books.slice(0, FIRST_CHUNK).map(card).join('');
      attachDelegatedHandlers(root);
      // Schedule remaining chunks
      scheduleAppend(root, FIRST_CHUNK, _renderSeq);
    } else {
      // Small sets render all at once
      root.innerHTML = books.map(card).join('');
      attachDelegatedHandlers(root);
    }
  }

  function init(api){ publish = api.publish; subscribe = api.subscribe; subscribe('shelves:render', async ({books})=>{ if(books) render(books); else { const all = await window.Storage.getAllBooks(); render(all); } }); }
  // Re-render on mutations
  function attachMutations(){
    subscribe('book:added', async ()=>{ const all = await window.Storage.getAllBooks(); render(all); });
    subscribe('book:updated', async ()=>{ const all = await window.Storage.getAllBooks(); render(all); });
    subscribe('book:removed', async ()=>{ const all = await window.Storage.getAllBooks(); render(all); });
  }

  const _init = init; init = function(api){ _init(api); attachMutations(); };

  window.Shelves = { init, render };
})();
