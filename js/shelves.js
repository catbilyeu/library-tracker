(function(){
  let publish=()=>{}; let subscribe=()=>{}; let books = [];
  // Pagination state
  let pageIndex = 0; let pageSize = 0; let cols=1; let rows=1;
  const el = () => document.getElementById('shelves');
  const pagerEl = () => document.getElementById('pager');
  const prevBtn = () => document.getElementById('btn-prev-page');
  const nextBtn = () => document.getElementById('btn-next-page');

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

  // Event delegation for cards
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

  function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }

  function getNumberPx(val){ const n = parseFloat(val||'0'); return isFinite(n)? n : 0; }

  function computeAvailableHeight(){
    const header = document.querySelector('.app-header');
    const main = document.querySelector('main');
    const headerH = header ? header.getBoundingClientRect().height : 0;
    const styles = window.getComputedStyle(main);
    const padY = getNumberPx(styles.paddingTop) + getNumberPx(styles.paddingBottom);
    const h = Math.max(0, Math.floor(window.innerHeight - headerH - padY));
    const root = el(); if(root){ root.style.height = h + 'px'; }
    return h;
  }

  function computePageSize(){
    const root = el(); if(!root) return;
    const gap = 12; // shelves.css grid gap
    const minCardW = 150; // minmax(150px,1fr)
    const w = root.clientWidth; const h = computeAvailableHeight();
    cols = Math.max(1, Math.floor((w + gap) / (minCardW + gap)));
    const cardW = Math.floor((w - Math.max(0,(cols-1))*gap) / Math.max(1,cols));
    const metaH = 56; // fixed meta block height to equalize card heights
    const cardH = Math.round(cardW * 1.5 + metaH); // 2/3 aspect => height ~ 1.5 * width
    rows = Math.max(1, Math.floor((h + gap) / (cardH + gap)));
    pageSize = Math.max(1, rows * cols);
  }

  function updatePager(){
    const p = pagerEl(); if(!p) return;
    const total = books.length; const needed = total > pageSize;
    p.hidden = !needed;
    const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
    const atStart = pageIndex <= 0; const atEnd = pageIndex >= maxPage;
    const prev = prevBtn(); const next = nextBtn();
    if(prev){ prev.disabled = atStart; }
    if(next){ next.disabled = atEnd; }
  }

  function renderPage(){
    const root = el(); if(!root) return;
    if(!books || books.length===0){ root.innerHTML = `<div class="empty-state">No books yet. Add with Scan or Add ISBN.</div>`; updatePager(); return; }
    const totalPages = Math.max(1, Math.ceil(books.length / pageSize));
    pageIndex = clamp(pageIndex, 0, totalPages - 1);
    const start = pageIndex * pageSize; const end = Math.min(start + pageSize, books.length);
    root.innerHTML = books.slice(start, end).map(card).join('');
    attachDelegatedHandlers(root);
    updatePager();
  }

  function render(list){
    if(Array.isArray(list)) { books = list; pageIndex = 0; }
    computePageSize();
    renderPage();
  }

  function nextPage(){ pageIndex++; renderPage(); }
  function prevPage(){ pageIndex--; renderPage(); }

  function handleResize(){
    computePageSize();
    renderPage();
  }

  function wirePagerButtons(){
    const p = pagerEl(); if(!p) return;
    const prev = prevBtn(); const next = nextBtn();
    if(prev && !prev.dataset.wired){ prev.addEventListener('click', ()=> publish('pager:prev', {})); prev.dataset.wired='1'; }
    if(next && !next.dataset.wired){ next.addEventListener('click', ()=> publish('pager:next', {})); next.dataset.wired='1'; }
  }

  function init(api){
    publish = api.publish; subscribe = api.subscribe;
    wirePagerButtons();
    subscribe('shelves:render', async ({books})=>{
      if(books) render(books); else { const all = await window.Storage.getAllBooks(); render(all); }
    });
    subscribe('pager:next', ()=> nextPage());
    subscribe('pager:prev', ()=> prevPage());
    // Recompute on resize
    window.addEventListener('resize', Utils.debounce(handleResize, 100));
    // Initial compute on init
    requestAnimationFrame(handleResize);
  }

  // Re-render on mutations
  function attachMutations(){
    subscribe('book:added', async ()=>{ const all = await window.Storage.getAllBooks(); render(all); });
    subscribe('book:updated', async ()=>{ const all = await window.Storage.getAllBooks(); render(all); });
    subscribe('book:removed', async ()=>{ const all = await window.Storage.getAllBooks(); render(all); });
  }

  const _init = init; init = function(api){ _init(api); attachMutations(); };

  window.Shelves = { init, render };
})();
