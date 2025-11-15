(function(){
  let publish=()=>{}; let subscribe=()=>{}; let fuse=null; let books=[]; let lastQuery='';
  const input = ()=> document.getElementById('search-input');

  function setIndex(list){ books = list||[]; fuse = new Fuse(books, { includeScore:true, threshold:0.35, keys:['title','authors','series','isbn13','isbn10'] }); }

  function isModalOpen(){
    try{
      const r = document.getElementById('book-modal');
      return !!(r && r.classList.contains('open') && r.getAttribute('aria-hidden') !== 'true');
    }catch{ return false; }
  }

  function query(q){
    const str = (q||'').trim(); lastQuery = str;
    const clearBtn = document.getElementById('btn-clear-search');
    const countEl = document.getElementById('results-count');
    if(clearBtn){ clearBtn.hidden = !str; }
    if(!str){ if(countEl) countEl.textContent=''; publish('shelves:render',{}); return; }
    if(!fuse) return;
    const res = fuse.search(str).map(r=>r.item);
    if(countEl) countEl.textContent = `${res.length} result${res.length===1?'':'s'}`;
    if(res.length===1){
      // Avoid hijacking the UI if a book modal is already open (e.g., during returns)
      if(!isModalOpen()){
        publish('modal:open', { isbn13: res[0].isbn13 });
      }
    } else {
      publish('shelves:render', { books: res });
    }
  }

  function init(api){ publish=api.publish; subscribe=api.subscribe;
    const onInput = Utils.debounce(()=> query(input().value), 200);
    input().addEventListener('input', onInput);
    const clearBtn = document.getElementById('btn-clear-search');
    if(clearBtn){ clearBtn.addEventListener('click', ()=>{ input().value=''; query(''); }); }
    subscribe('search:query', ({q})=>{ input().value = q||''; query(q); });
    const refresh = async ()=>{
      const all = await window.Storage.getAllBooks(); setIndex(all);
      if((lastQuery||'').length){ query(lastQuery); } else { publish('shelves:render',{}); }
    };
    subscribe('book:added', refresh);
    subscribe('book:updated', refresh);
    subscribe('book:removed', refresh);
    subscribe('import:done', refresh);
  }

  window.Search = { init, setIndex, query };
})();
