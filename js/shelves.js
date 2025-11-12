(function(){
  let publish=()=>{}; let subscribe=()=>{}; let books = [];
  // Pagination state
  let pageIndex = 0; let pageSize = 0; let cols=1; let rows=1; let pages=[];
  const el = () => document.getElementById('shelves');
  const pagerEl = () => document.getElementById('pager');
  const prevBtn = () => document.getElementById('btn-prev-page');
  const nextBtn = () => document.getElementById('btn-next-page');

  function getPrimarySeries(b){
    if(!Array.isArray(b.series)) return '';
    const firstNonEdition = b.series.find(s => s && !Utils.isEditionSeries(s));
    return firstNonEdition || '';
  }

  function card(b){
    const img = b.coverUrl || `https://covers.openlibrary.org/b/isbn/${b.isbn13}-M.jpg`;
    const esc = Utils.escapeHTML;
    const titleSafe = esc(b.title || '(Untitled)');
    const authorsSafe = esc((b.authors||[]).join(', '));
    const seriesLabelRaw = Utils.extractSeriesLabelFromTitle(b.title) || getPrimarySeries(b);
    const seriesLabelSafe = seriesLabelRaw ? esc(seriesLabelRaw) : '';
    const series = seriesLabelSafe ? `<div class="series">${seriesLabelSafe}</div>` : '';
    const volMatch = (b.title||'').match(/\b(book|bk|vol|volume)\s*(\d+([\.-]\d+)?)\b/i);
    const volume = volMatch ? `<div class="series">Vol ${esc(volMatch[2])}</div>` : '';
    const imgUrl = Utils.sanitizeURL(img);
    return `<article class="book-card" data-isbn="${b.isbn13}" tabindex="0" aria-label="${titleSafe}">\n      <img loading="lazy" src="${imgUrl}" data-isbn="${b.isbn13}" alt="Cover of ${titleSafe}" />\n      <div class="meta">\n        <h3 class="title">${titleSafe}<\/h3>\n        ${series || volume}\n        <p class="authors">${authorsSafe}<\/p>\n      <\/div>\n    <\/article>`;
  }

  function seriesKey(b){
    if(b.normalizedSeries) return b.normalizedSeries;
    const fromField = getPrimarySeries(b);
    const normField = Utils.normalizeSeriesName(fromField);
    if(normField) return normField;
    const guessed = Utils.guessSeriesFromTitle(b.title||'');
    return guessed ? Utils.normalizeSeriesName(guessed) : '';
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
    const totalPages = (Array.isArray(pages) && pages.length) ? pages.length : 1;
    const needed = totalPages > 1;
    p.hidden = !needed;
    const maxPage = Math.max(0, totalPages - 1);
    pageIndex = clamp(pageIndex, 0, maxPage);
    const atStart = pageIndex <= 0; const atEnd = pageIndex >= maxPage;
    const prev = prevBtn(); const next = nextBtn();
    if(prev){ prev.disabled = atStart; }
    if(next){ next.disabled = atEnd; }
  }

  function renderPage(){
    const root = el(); if(!root) return;
    if(!books || books.length===0){ root.innerHTML = `<div class="empty-state">No books yet. Add with Scan or Add ISBN.</div>`; updatePager(); return; }
    // Build and render via grouped pagination (preserves series boundaries)
    render();
  }

  function render(list){
    // Update local list
    if(Array.isArray(list)) { books = list.slice(); } else { books = books||[]; }

    // Ensure we have a current pageSize
    if(!pageSize || pageSize <= 0){ computePageSize(); }

    const mode = (window.__sortMode || 'series');

    // New angle: keep sorting and pagination simple. Do not group by author/series.
    // Just sort the flat list by the selected mode and then paginate sequentially.
    const sorted = (typeof applySortMode === 'function') ? applySortMode(books, mode) : books.slice();

    // Build pages by chunking the sorted list
    pages = [];
    if(sorted.length === 0){
      pages = [[]];
    } else {
      for(let i=0;i<sorted.length;i+=pageSize){
        pages.push(sorted.slice(i, i+pageSize));
      }
    }

    // Clamp and render requested page
    pageIndex = clamp(pageIndex, 0, Math.max(0, pages.length-1));

    const root = el(); if(!root) return;
    const pageItems = pages[pageIndex] || [];
    const out = pageItems.map(b=> card(b)).join('');

    root.innerHTML = out || `<div class="empty-state">No books yet. Add with Scan or Add ISBN.</div>`;
    // Replace inline onerror handlers with programmatic error fallback
    root.querySelectorAll('img[data-isbn]').forEach(img=>{
      img.addEventListener('error', ()=> Utils.coverErr(img));
    });
    attachDelegatedHandlers(root);
    updatePager();
    return;
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
  function applySortMode(list, mode){
    const arr = list.slice();
    const titleKey = (b)=> String(b.title||'').toLowerCase();
    const authorKey = (b)=> String((b.authors&&b.authors[0])||'').toLowerCase();
    const seriesKeyFn = (b)=>{
      const s = Utils.normalizeSeriesName(Utils.primarySeries(b.series)||'') || Utils.guessSeriesFromTitle(b.title||'') || '';
      return s;
    };
    const genreKey = (b)=> String((b.subjects&&b.subjects[0])||'').toLowerCase();
    switch(mode){
      case 'title':
        arr.sort((a,b)=> titleKey(a)<titleKey(b)?-1:titleKey(a)>titleKey(b)?1:0); break;
      case 'author':
        arr.sort((a,b)=> authorKey(a)<authorKey(b)?-1:authorKey(a)>authorKey(b)?1:0); break;
      case 'genre':
        arr.sort((a,b)=> genreKey(a)<genreKey(b)?-1:genreKey(a)>genreKey(b)?1:0); break;
      case 'series':
      default: {
        // Keep existing series-aware sort (series A–Z, then number, then title)
        const seriesName = (b)=>{
          if(b.normalizedSeries && !Utils.isEditionSeries(b.normalizedSeries)) return b.normalizedSeries;
          const fromField = Utils.primarySeries(b.series)||'';
          const normField = Utils.normalizeSeriesName(fromField);
          if(normField) return normField;
          const guessed = Utils.guessSeriesFromTitle(b.title||'');
          return guessed ? Utils.normalizeSeriesName(guessed) : '';
        };
        const tKey = titleKey;
        arr.sort((a,b)=>{
          const sa = seriesName(a), sb = seriesName(b);
          if(sa && sb){
            if(sa<sb) return -1; if(sa>sb) return 1;
            const va = (a.volumeNumber!=null)? a.volumeNumber : Utils.extractVolumeNumber(a.title);
            const vb = (b.volumeNumber!=null)? b.volumeNumber : Utils.extractVolumeNumber(b.title);
            const aNum = (va!=null && !isNaN(va))? va : Infinity;
            const bNum = (vb!=null && !isNaN(vb))? vb : Infinity;
            if(aNum < bNum) return -1; if(aNum > bNum) return 1;
          } else if(sa || sb){
            return sa? -1 : 1;
          }
          const ta = tKey(a), tb = tKey(b);
          if(ta<tb) return -1; if(ta>tb) return 1; return 0;
        });
      }
    }
    return arr;
  }
