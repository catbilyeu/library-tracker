(function(){
  let publish = ()=>{}; let subscribe = ()=>{}; let current = null;
  let previouslyFocused = null; let keydownHandler = null;
  const root = () => document.getElementById('book-modal');
  function close(){ const r=root(); if(!r) return; if(keydownHandler){ r.removeEventListener('keydown',keydownHandler,true); keydownHandler=null; } r.classList.remove('open'); r.classList.add('closing'); const toRestore=previouslyFocused; previouslyFocused=null; setTimeout(()=>{ r.classList.remove('closing'); r.setAttribute('aria-hidden','true'); r.innerHTML=''; publish('modal:close',{}); current=null; try{ toRestore&&toRestore.focus&&toRestore.focus(); }catch{} },220); }
  function headerArea(b, id){ const title=(b&&b.title)||'(Untitled)'; const authors=Array.isArray(b&&b.authors)? b.authors.join(', ') : ''; return '<div class="header"><div class="title-wrap"><h2 id="'+id+'" class="title">'+title+'</h2><div class="subtitle">'+authors+'</div></div><button class="close" type="button" aria-label="Close">×</button></div>'; }
  function bodyArea(b){ const cover= (b&&b.coverUrl) ? b.coverUrl : ('https://covers.openlibrary.org/b/isbn/'+b.isbn13+'-M.jpg'); const isLent=(b.borrowHistory||[]).some(x=>!x.returnedAt); const last=(b.borrowHistory||[]).slice().reverse().find(x=>!x.returnedAt); const history=(b.borrowHistory||[]).slice().reverse().map(h=>{ const when=new Date(h.borrowedAt).toLocaleString(); const ret=h.returnedAt?(' (returned '+new Date(h.returnedAt).toLocaleString()+')'):' (out)'; return '<li>'+when+' — '+h.borrower+ret+'</li>'; }).join('')||'<li>None</li>'; return '<div class="body"><img class="cover" src="'+cover+'" data-isbn="'+b.isbn13+'" onerror="Utils.coverErr(this)" alt="Cover" /><div><div class="actions">'+(!isLent?'<button id="btn-lend" class="accent">Lend book</button>':'<button id="btn-return" class="accent">Mark returned '+(last? '('+last.borrower+')' : '')+'</button>')+'<button id="btn-remove" class="danger">Remove</button></div><div class="history"><h3>Borrow history</h3><ul>'+history+'</ul></div></div></div>'; }
  function getFocusable(container){ const selectors=['a[href]','area[href]','input:not([disabled]):not([type="hidden"])','select:not([disabled])','textarea:not([disabled])','button:not([disabled])','[tabindex]:not([tabindex="-1"])'].join(','); const nodes=Array.from(container.querySelectorAll(selectors)); return nodes.filter(el=>{ const st=getComputedStyle(el); const visible=st.visibility!=='hidden'&&st.display!=='none'&&(el.offsetWidth>0||el.offsetHeight>0||el.getClientRects().length>0); return visible&&!el.hasAttribute('inert'); }); }
    if(lendBtn){ lendBtn.addEventListener('click',()=>{ const overlay=document.createElement('div'); overlay.className='inline-overlay'; overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true'); const dialog=document.createElement('div'); dialog.className='dialog'; const h3=document.createElement('h3'); h3.id='lend-title'; h3.textContent='Lend book'; const row1=document.createElement('div'); row1.className='row'; const label1=document.createElement('label'); label1.className='muted'; label1.htmlFor='borrower-name'; label1.textContent='Borrower name'; row1.appendChild(label1); const input=document.createElement('input'); input.id='borrower-name'; input.placeholder='Alex Johnson'; const row2=document.createElement('div'); row2.className='row'; const label2=document.createElement('label'); label2.className='muted'; label2.htmlFor='borrow-date'; label2.textContent='Borrow date'; row2.appendChild(label2); const date=document.createElement('input'); date.id='borrow-date'; date.type='date'; try{ const t=new Date(); const pad=n=>String(n).padStart(2,'0'); date.value = `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`; }catch{} const actions=document.createElement('div'); actions.className='actions'; const cancelBtn=document.createElement('button'); cancelBtn.type='button'; cancelBtn.id='lend-cancel'; cancelBtn.textContent='Cancel'; const confirmBtn=document.createElement('button'); confirmBtn.type='button'; confirmBtn.id='lend-confirm'; confirmBtn.className='accent'; confirmBtn.textContent='Confirm'; actions.appendChild(cancelBtn); actions.appendChild(confirmBtn); dialog.appendChild(h3); dialog.appendChild(row1); dialog.appendChild(input); dialog.appendChild(row2); dialog.appendChild(date); dialog.appendChild(actions); overlay.appendChild(dialog); r.appendChild(overlay); input.focus(); overlay.addEventListener('keydown',(e)=>{ if(e.key==='Escape'){ e.preventDefault(); overlay.remove(); }}); cancelBtn.onclick=()=> overlay.remove(); const parseDateVal=(v)=>{ if(!v) return Date.now(); try{ const d=new Date(v+'T00:00:00'); if(!isNaN(d.getTime())) return d.getTime(); }catch{} return Date.now(); }; const confirm=async()=>{ const borrower=(input.value||'').trim(); if(!borrower) return; const borrowedAt=parseDateVal(date.value); current.borrowHistory=current.borrowHistory||[]; current.borrowHistory.push({borrower,borrowedAt}); await window.Storage.putBook(current); publish('borrow:lent',{isbn13:current.isbn13,borrower,borrowedAt}); overlay.remove(); }; confirmBtn.onclick=confirm; input.addEventListener('keypress',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); confirm(); }}); date.addEventListener('keypress',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); confirm(); }}); }); }
    if(returnBtn){ returnBtn.addEventListener('click',async()=>{ const last=(current.borrowHistory||[]).slice().reverse().find(x=>!x.returnedAt); if(!last) return; const returnedAt=Date.now(); last.returnedAt=returnedAt; await window.Storage.putBook(current); publish('borrow:returned',{isbn13:current.isbn13,returnedAt}); }); }
    if(removeBtn){ removeBtn.addEventListener('click',async()=>{ 
      // Inline confirmation overlay (avoid native confirm for accessibility/motion cursor)
      const overlay=document.createElement('div');
      overlay.className='inline-overlay';
      overlay.setAttribute('role','dialog');
      overlay.setAttribute('aria-modal','true');
      overlay.setAttribute('aria-labelledby','remove-title');
      const dialog=document.createElement('div');
      dialog.className='dialog';
      const h3=document.createElement('h3');
      h3.id='remove-title';
      h3.textContent='Remove book';
      const msg=document.createElement('p');
      msg.textContent=`Are you sure you want to remove "${current.title||'(Untitled)'}" from your library?`;
      const actions=document.createElement('div');
      actions.className='actions';
      const cancelBtn=document.createElement('button');
      cancelBtn.type='button';
      cancelBtn.id='remove-cancel';
      cancelBtn.textContent='Cancel';
      const confirmBtn=document.createElement('button');
      confirmBtn.type='button';
      confirmBtn.id='remove-confirm';
      confirmBtn.className='danger';
      confirmBtn.textContent='Remove';
      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      dialog.appendChild(h3);
      dialog.appendChild(msg);
      dialog.appendChild(actions);
      overlay.appendChild(dialog);
      r.appendChild(overlay);
      confirmBtn.focus();
      overlay.addEventListener('keydown',(e)=>{ if(e.key==='Escape'){ e.preventDefault(); overlay.remove(); }});
      cancelBtn.onclick=()=> overlay.remove();
      const confirm=async()=>{ await window.Storage.deleteBook(current.isbn13); overlay.remove(); close(); };
      confirmBtn.onclick=confirm;
    }); }
    keydownHandler=function(e){ const container=r.querySelector('.inline-overlay')||panel; if(e.key==='Escape'){ const inline=r.querySelector('.inline-overlay'); if(inline){ e.preventDefault(); inline.remove(); return; } e.preventDefault(); close(); return; } if(e.key==='Tab'){ const focusable=getFocusable(container); if(focusable.length===0){ e.preventDefault(); return; } const first=focusable[0], last=focusable[focusable.length-1]; const active=document.activeElement; if(!container.contains(active)){ e.preventDefault(); (e.shiftKey? last : first).focus(); return; } if(e.shiftKey){ if(active===first||active===container){ last.focus(); e.preventDefault(); } } else { if(active===last){ first.focus(); e.preventDefault(); } } } }; r.addEventListener('keydown',keydownHandler,true); }
  function init(api){ publish=api.publish; subscribe=api.subscribe; subscribe('modal:open',open); subscribe('book:updated',({book})=>{ if(current&&book.isbn13===current.isbn13) open({isbn13:current.isbn13}); }); }
  window.Modal={ init, open, close };
})();
