(function(){
  let publish = ()=>{}; let subscribe = ()=>{}; let current = null;
  let previouslyFocused = null; let keydownHandler = null;
  const root = () => document.getElementById('book-modal');

  function close(){
    const r = root(); if(!r) return;
    if(keydownHandler){ r.removeEventListener('keydown',keydownHandler,true); keydownHandler=null; }
    r.classList.remove('open'); r.classList.add('closing');
    const toRestore = previouslyFocused; previouslyFocused = null;
    setTimeout(()=>{
      r.classList.remove('closing');
      r.setAttribute('aria-hidden','true');
      r.innerHTML='';
      publish('modal:close',{});
      current=null;
      try{ toRestore&&toRestore.focus&&toRestore.focus(); }catch{}
    }, 220);
  }

  function headerArea(b, id){
    const title=(b&&b.title)||'(Untitled)';
    const authors=Array.isArray(b&&b.authors)? b.authors.join(', ') : '';
    return '<div class="header"><div class="title-wrap"><h2 id="'+id+'" class="title">'+title+'</h2><div class="subtitle">'+authors+'</div></div><button class="close" type="button" aria-label="Close">×</button></div>';
  }

  function bodyArea(b){
    const cover = (b&&b.coverUrl) ? b.coverUrl : ('https://covers.openlibrary.org/b/isbn/'+b.isbn13+'-M.jpg');
    const raw = (b.borrowHistory||[]);
    const isLent = raw.some(x=>!x.returnedAt);
    const last = raw.slice().reverse().find(x=>!x.returnedAt);
    const fmt = (ts)=>{ try{ const d=new Date(ts); return d.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' }); }catch{ return ''; }};
    const items = raw.map((h, idx)=>{
      const borrower = Utils.titleCaseName(h.borrower||'');
      const borrowed = fmt(h.borrowedAt);
      const returned = h.returnedAt ? fmt(h.returnedAt) : null;
      const status = returned ? 'Returned' : 'Out';
      const dateRange = returned ? `${borrowed} – ${returned}` : `${borrowed}`;
      const line = `${borrower} | ${status} | ${dateRange}`;
      return '<li data-idx="'+idx+'"><span class="row-line">'+line+'</span><span class="row-actions">'+
             '<button type="button" class="mini edit" aria-label="Edit entry">Edit</button>'+
             '<button type="button" class="mini danger remove" aria-label="Remove entry">Remove</button></span></li>';
    }).join('')||'<li>None</li>';
    return '<div class="body"><img class="cover" src="'+cover+'" data-isbn="'+b.isbn13+'" onerror="Utils.coverErr(this)" alt="Cover" /><div><div class="actions">'+(!isLent?'<button id="btn-lend" class="accent">Lend book</button>':'<button id="btn-return" class="accent">Mark returned '+(last? '('+Utils.titleCaseName(last.borrower)+')' : '')+'</button>')+'<button id="btn-remove" class="danger">Remove</button></div><div class="history"><h3>Borrow history</h3><ul class="history-list">'+items+'</ul></div></div></div>';
  }

  function getFocusable(container){
    const selectors=['a[href]','area[href]','input:not([disabled]):not([type="hidden"])','select:not([disabled])','textarea:not([disabled])','button:not([disabled])','[tabindex]:not([tabindex="-1"])'].join(',');
    const nodes=Array.from(container.querySelectorAll(selectors));
    return nodes.filter(el=>{
      const st=getComputedStyle(el);
      const visible=st.visibility!=='hidden'&&st.display!=='none'&&(el.offsetWidth>0||el.offsetHeight>0||el.getClientRects().length>0);
      return visible&&!el.hasAttribute('inert');
    });
  }

  async function open({isbn13}){
    current = await window.Storage.getBook(isbn13);
    if(!current) return;
    const r = root(); if(!r) return;
    if(keydownHandler){ r.removeEventListener('keydown',keydownHandler,true); keydownHandler=null; }
    previouslyFocused = document.activeElement;

    const titleId='book-modal-title';
    r.innerHTML = '<div class="panel">'+headerArea(current,titleId)+bodyArea(current)+'</div>';
    r.setAttribute('aria-hidden','false');
    r.setAttribute('aria-labelledby',titleId);
    r.classList.add('open');

    const panel = r.querySelector('.panel');
    panel.setAttribute('tabindex','-1');

    r.querySelector('.close').addEventListener('click', close);
    r.addEventListener('click',(e)=>{ if(e.target===r) close(); });

    const lendBtn = r.querySelector('#btn-lend');
    const returnBtn = r.querySelector('#btn-return');
    const removeBtn = r.querySelector('#btn-remove');

    const initial = lendBtn||returnBtn||removeBtn||r.querySelector('.close')||panel;
    if(initial&&initial.focus) initial.focus();

    // Wire edit/remove per-history actions
    const historyList = r.querySelector('.history ul');
    if(historyList){
      historyList.addEventListener('click', async (e)=>{
        const btn = e.target.closest('button'); if(!btn) return;
        const li = e.target.closest('li'); if(!li) return;
        const idxInRendered = parseInt(li.dataset.idx,10);
        const raw = (current.borrowHistory||[]);
        // data-idx holds the original index (we reversed only for display)
        const actualIdx = idxInRendered;
        if(actualIdx<0 || actualIdx>=raw.length) return;
        const entry = raw[actualIdx];
        if(btn.classList.contains('remove')){
          // remove the entry
          raw.splice(actualIdx,1);
          current.borrowHistory = raw;
          await window.Storage.putBook(current);
          open({ isbn13: current.isbn13 });
          return;
        }
        if(btn.classList.contains('edit')){
          // open inline edit dialog
          const overlay=document.createElement('div'); overlay.className='inline-overlay'; overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true');
          const dialog=document.createElement('div'); dialog.className='dialog';
          const h3=document.createElement('h3'); h3.textContent='Edit entry';
          const r1=document.createElement('div'); r1.className='row'; const l1=document.createElement('label'); l1.className='muted'; l1.htmlFor='edit-borrower'; l1.textContent='Borrower'; r1.appendChild(l1);
          const i1=document.createElement('input'); i1.id='edit-borrower'; i1.value=entry.borrower||'';
          const r2=document.createElement('div'); r2.className='row'; const l2=document.createElement('label'); l2.className='muted'; l2.htmlFor='edit-borrowed'; l2.textContent='Borrow date'; r2.appendChild(l2);
          const d1=document.createElement('input'); d1.id='edit-borrowed'; d1.type='date';
          const toDateInput=(ts)=>{ try{ const t=new Date(ts); const pad=n=>String(n).padStart(2,'0'); return `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`; }catch{ return ''; } };
          try{ d1.value = toDateInput(entry.borrowedAt); }catch{}
          const r3=document.createElement('div'); r3.className='row'; const l3=document.createElement('label'); l3.className='muted'; l3.htmlFor='edit-returned'; l3.textContent='Return date'; r3.appendChild(l3);
          const d2=document.createElement('input'); d2.id='edit-returned'; d2.type='date'; if(entry.returnedAt){ try{ d2.value = toDateInput(entry.returnedAt); }catch{} }
          const actions=document.createElement('div'); actions.className='actions';
          const cancel=document.createElement('button'); cancel.type='button'; cancel.textContent='Cancel';
          const save=document.createElement('button'); save.type='button'; save.className='accent'; save.textContent='Save';
          actions.appendChild(cancel); actions.appendChild(save);
          dialog.appendChild(h3); dialog.appendChild(r1); dialog.appendChild(i1); dialog.appendChild(r2); dialog.appendChild(d1); dialog.appendChild(r3); dialog.appendChild(d2); dialog.appendChild(actions);
          overlay.appendChild(dialog); r.appendChild(overlay); i1.focus();
          const parseDate=(v)=>{ if(!v) return null; try{ const d=new Date(v+'T00:00:00'); if(!isNaN(d)) return d.getTime(); }catch{} return null; };
          const doSave=async()=>{
            entry.borrower=Utils.titleCaseName((i1.value||'').trim());
            const bAt=parseDate(d1.value); if(bAt!==null) entry.borrowedAt=bAt;
            const rAt=parseDate(d2.value); entry.returnedAt = rAt; // allow clearing by empty input
            await window.Storage.putBook(current);
            overlay.remove(); open({ isbn13: current.isbn13 });
          };
          save.onclick=doSave; cancel.onclick=()=> overlay.remove();
          overlay.addEventListener('keydown',(ev)=>{ if(ev.key==='Escape'){ ev.preventDefault(); overlay.remove(); }});
        }
      });
    }

    if(lendBtn){
      lendBtn.addEventListener('click',()=>{
        const overlay=document.createElement('div');
        overlay.className='inline-overlay';
        overlay.setAttribute('role','dialog');
        overlay.setAttribute('aria-modal','true');
        const dialog=document.createElement('div'); dialog.className='dialog';
        const h3=document.createElement('h3'); h3.id='lend-title'; h3.textContent='Lend book';
        const row1=document.createElement('div'); row1.className='row';
        const label1=document.createElement('label'); label1.className='muted'; label1.htmlFor='borrower-name'; label1.textContent='Borrower name';
        row1.appendChild(label1);
        const input=document.createElement('input'); input.id='borrower-name'; input.placeholder='Alex Johnson';
        const row2=document.createElement('div'); row2.className='row';
        const label2=document.createElement('label'); label2.className='muted'; label2.htmlFor='borrow-date'; label2.textContent='Borrow date';
        row2.appendChild(label2);
        const date=document.createElement('input'); date.id='borrow-date'; date.type='date';
        // default to today in local timezone
        try{ const t=new Date(); const pad=n=>String(n).padStart(2,'0'); date.value = `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`; }catch{}
        const actions=document.createElement('div'); actions.className='actions';
        const cancelBtn=document.createElement('button'); cancelBtn.type='button'; cancelBtn.id='lend-cancel'; cancelBtn.textContent='Cancel';
        const confirmBtn=document.createElement('button'); confirmBtn.type='button'; confirmBtn.id='lend-confirm'; confirmBtn.className='accent'; confirmBtn.textContent='Confirm';
        actions.appendChild(cancelBtn); actions.appendChild(confirmBtn);
        dialog.appendChild(h3); dialog.appendChild(row1); dialog.appendChild(input); dialog.appendChild(row2); dialog.appendChild(date); dialog.appendChild(actions);
        overlay.appendChild(dialog);
        r.appendChild(overlay);
        input.focus();
        overlay.addEventListener('keydown',(e)=>{ if(e.key==='Escape'){ e.preventDefault(); overlay.remove(); }});
        cancelBtn.onclick=()=> overlay.remove();
        const parseDateVal=(v)=>{ if(!v) return Date.now(); try{ const d=new Date(v+'T00:00:00'); if(!isNaN(d.getTime())) return d.getTime(); }catch{} return Date.now(); };
        const confirm=async()=>{
          const borrower=(input.value||'').trim(); if(!borrower) return;
          const borrowedAt=parseDateVal(date.value);
          current.borrowHistory=current.borrowHistory||[];
          current.borrowHistory.push({borrower,borrowedAt});
          await window.Storage.putBook(current);
          publish('borrow:lent',{isbn13:current.isbn13,borrower,borrowedAt});
          overlay.remove();
        };
        confirmBtn.onclick=confirm;
        input.addEventListener('keypress',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); confirm(); }});
        date.addEventListener('keypress',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); confirm(); }});
      });
    }

    if(returnBtn){
      returnBtn.addEventListener('click',async()=>{
        const last=(current.borrowHistory||[]).slice().reverse().find(x=>!x.returnedAt);
        if(!last) return;
        const returnedAt=Date.now();
        last.returnedAt=returnedAt;
        await window.Storage.putBook(current);
        publish('borrow:returned',{isbn13:current.isbn13,returnedAt});
      });
    }

    if(removeBtn){
      removeBtn.addEventListener('click',async()=>{
    // Inline confirm overlay (avoid native confirm)
        const overlay=document.createElement('div');
        overlay.className='inline-overlay';
        overlay.setAttribute('role','dialog');
        overlay.setAttribute('aria-modal','true');
        overlay.setAttribute('aria-labelledby','remove-title');
        const dialog=document.createElement('div'); dialog.className='dialog';
        const h3=document.createElement('h3'); h3.id='remove-title'; h3.textContent='Remove book';
        const msg=document.createElement('p'); msg.textContent=`Are you sure you want to remove "${current.title||'(Untitled)'}" from your library?`;
        const actions=document.createElement('div'); actions.className='actions';
        const cancelBtn=document.createElement('button'); cancelBtn.type='button'; cancelBtn.id='remove-cancel'; cancelBtn.textContent='Cancel';
        const confirmBtn=document.createElement('button'); confirmBtn.type='button'; confirmBtn.id='remove-confirm'; confirmBtn.className='danger'; confirmBtn.textContent='Remove';
        actions.appendChild(cancelBtn); actions.appendChild(confirmBtn);
        dialog.appendChild(h3); dialog.appendChild(msg); dialog.appendChild(actions);
        overlay.appendChild(dialog);
        r.appendChild(overlay);
        confirmBtn.focus();
        overlay.addEventListener('keydown',(e)=>{ if(e.key==='Escape'){ e.preventDefault(); overlay.remove(); }});
        cancelBtn.onclick=()=> overlay.remove();
        const confirm=async()=>{ await window.Storage.deleteBook(current.isbn13); overlay.remove(); close(); };
        confirmBtn.onclick=confirm;
      });
    }

    // Focus trap and Esc handling
    keydownHandler=function(e){
      const container=r.querySelector('.inline-overlay')||panel;
      if(e.key==='Escape'){
        const inline=r.querySelector('.inline-overlay');
        if(inline){ e.preventDefault(); inline.remove(); return; }
        e.preventDefault(); close(); return;
      }
      if(e.key==='Tab'){
        const focusable=getFocusable(container);
        if(focusable.length===0){ e.preventDefault(); return; }
        const first=focusable[0], last=focusable[focusable.length-1];
        const active=document.activeElement;
        if(!container.contains(active)){
          e.preventDefault(); (e.shiftKey? last : first).focus(); return;
        }
        if(e.shiftKey){
          if(active===first||active===container){ last.focus(); e.preventDefault(); }
        } else {
          if(active===last){ first.focus(); e.preventDefault(); }
        }
      }
    };
    r.addEventListener('keydown',keydownHandler,true);
  }

  function init(api){ publish=api.publish; subscribe=api.subscribe; subscribe('modal:open',open); subscribe('book:updated',({book})=>{ if(current&&book.isbn13===current.isbn13) open({isbn13:current.isbn13}); }); }
  window.Modal={ init, open, close };
})();
