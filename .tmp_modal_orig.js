(function(){
  let publish=()=>{}; let subscribe=()=>{}; let current = null;
  const root = ()=> document.getElementById('book-modal');

  function close(){ const r = root(); r.classList.remove('open'); r.classList.add('closing'); setTimeout(()=>{ r.classList.remove('closing'); r.setAttribute('aria-hidden','true'); r.innerHTML=''; publish('modal:close',{}); current=null; }, 220); }

  function headerArea(b){ return `<div class="header">
    <div class="title-wrap"><h2 class="title">${b.title||'(Untitled)'}</h2><div class="subtitle">${(b.authors||[]).join(', ')}</div></div>
    <button class="close" aria-label="Close">×</button>
  </div>`; }

  function bodyArea(b){
    const isLent = (b.borrowHistory||[]).some(x=> !x.returnedAt);
    const last = (b.borrowHistory||[]).slice().reverse().find(x=>!x.returnedAt);
    return `<div class="body">
      <img class="cover" src="${b.coverUrl||`https://covers.openlibrary.org/b/isbn/${b.isbn13}-M.jpg`}" data-isbn="${b.isbn13}" onerror="Utils.coverErr(this)" alt="Cover" />
      <div>
        <div class="actions">
          ${!isLent? `<button id="btn-lend" class="accent">Lend book</button>` : `<button id="btn-return" class="accent">Mark returned (${last?.borrower||''})</button>`}
          <button id="btn-remove" class="danger">Remove</button>
        </div>
        <div class="history">
          <h3>Borrow history</h3>
          <ul>
            ${(b.borrowHistory||[]).slice().reverse().map(h=>`<li>${new Date(h.borrowedAt).toLocaleString()} — ${h.borrower}${h.returnedAt? ` (returned ${new Date(h.returnedAt).toLocaleString()})` : ' (out)'}</li>`).join('')||'<li>None</li>'}
          </ul>
        </div>
      </div>
    </div>`;
  }

  async function open({ isbn13 }){
    current = await window.Storage.getBook(isbn13);
    if(!current) return;
    const r = root();
    r.innerHTML = `<div class="panel" role="document">${headerArea(current)}${bodyArea(current)}</div>`;
    r.setAttribute('aria-hidden','false');
    r.classList.add('open');
    r.querySelector('.close').addEventListener('click', close);
    r.addEventListener('click', (e)=>{ if(e.target===r) close(); });
    const lendBtn = r.querySelector('#btn-lend');
    const returnBtn = r.querySelector('#btn-return');
    const removeBtn = r.querySelector('#btn-remove');
    if(lendBtn){ lendBtn.addEventListener('click', ()=>{
      // themed inline prompt
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4);z-index:1100';
      overlay.innerHTML = `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;min-width:min(90vw,360px);box-shadow:0 10px 40px rgba(0,0,0,.5)">
        <h3 style="margin:0 0 10px">Lend book</h3>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:6px">Borrower name</label>
        <input id="borrower-name" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);background:#0e141f;color:var(--fg)" placeholder="Alex Johnson" />
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button id="lend-cancel">Cancel</button>
          <button id="lend-confirm" class="accent">Confirm</button>
        </div>
      </div>`;
      r.appendChild(overlay);
      const input = overlay.querySelector('#borrower-name'); input.focus();
      overlay.querySelector('#lend-cancel').onclick = ()=> overlay.remove();
      const confirm = async ()=>{
        const borrower = input.value.trim(); if(!borrower) return;
        const borrowedAt = Date.now();
        current.borrowHistory = current.borrowHistory || [];
        current.borrowHistory.push({ borrower, borrowedAt });
        await window.Storage.putBook(current);
        publish('borrow:lent', { isbn13: current.isbn13, borrower, borrowedAt });
        overlay.remove();
      };
      overlay.querySelector('#lend-confirm').onclick = confirm;
      input.addEventListener('keypress', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); confirm(); }});
    }); }
    if(returnBtn){ returnBtn.addEventListener('click', async ()=>{
      const last = (current.borrowHistory||[]).slice().reverse().find(x=>!x.returnedAt); if(!last) return;
      const returnedAt = Date.now();
      last.returnedAt = returnedAt; await window.Storage.putBook(current);
      publish('borrow:returned', { isbn13: current.isbn13, returnedAt });
    }); }
    if(removeBtn){ removeBtn.addEventListener('click', async ()=>{
      if(confirm('Remove this book?')){ await window.Storage.deleteBook(current.isbn13); close(); }
    }); }
  }

  function init(api){ publish = api.publish; subscribe = api.subscribe; subscribe('modal:open', open); subscribe('book:updated', ({book})=>{ if(current && book.isbn13===current.isbn13) open({isbn13: current.isbn13}); }); }

  window.Modal = { init, open, close };
})();
