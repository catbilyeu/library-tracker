(function(){
  let publish=()=>{}; let subscribe=()=>{}; let fuse=null; let books=[];
  const input = ()=> document.getElementById('search-input');

  function setIndex(list){ books = list||[]; fuse = new Fuse(books, { includeScore:true, threshold:0.35, keys:['title','authors','isbn13','isbn10'] }); }

  function query(q){
    const str = (q||'').trim(); if(!str){ publish('shelves:render',{}); return; }
    if(!fuse) return;
    const res = fuse.search(str).map(r=>r.item);
    if(res.length===1){ publish('modal:open', { isbn13: res[0].isbn13 }); }
    else { publish('shelves:render', { books: res }); }
  }

  function init(api){ publish=api.publish; subscribe=api.subscribe;
    const onInput = Utils.debounce(()=> query(input().value), 200);
    input().addEventListener('input', onInput);
    subscribe('search:query', ({q})=>{ input().value = q||''; query(q); });
    subscribe('book:added', async ()=>{ const all = await window.Storage.getAllBooks(); setIndex(all); });
    subscribe('book:updated', async ()=>{ const all = await window.Storage.getAllBooks(); setIndex(all); });
    subscribe('book:removed', async ()=>{ const all = await window.Storage.getAllBooks(); setIndex(all); publish('shelves:render',{}); });
    subscribe('import:done', async ()=>{ const all = await window.Storage.getAllBooks(); setIndex(all); publish('shelves:render',{}); });
  }

  window.Search = { init, setIndex, query };
})();
