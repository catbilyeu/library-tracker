(function(){
  const Utils = {
    debounce(fn, ms){ let t; return function(...args){ clearTimeout(t); t=setTimeout(()=>fn.apply(this,args), ms); }},
    throttle(fn, ms){ let t=0; return function(...args){ const now=Date.now(); if(now-t>=ms){ t=now; fn.apply(this,args);} }},

    toast(msg, opts={}){
      const cont = document.getElementById('toast-container'); if(!cont) return;
      const div = document.createElement('div'); div.className = 'toast ' + (opts.type||''); div.textContent = msg;
      cont.appendChild(div); setTimeout(()=>{ div.remove(); }, opts.duration||3000);
    },

    // HTML escape for safe interpolation
    escapeHTML(s){
      return String(s)
        .replaceAll('&','&amp;')
        .replaceAll('<','&lt;')
        .replaceAll('>','&gt;')
        .replaceAll('"','&quot;')
        .replaceAll("'",'&#39;');
    },

    // DOM helpers
    elementFromPointSafe(x,y){ const el = document.elementFromPoint(x,y); return el; },
    synthesizeClick(x, y){
      const el = this.elementFromPointSafe(x,y); if(!el) return false;
      const opts = { bubbles:true, cancelable:true, clientX:x, clientY:y, view:window, buttons:1 };
      try{ el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType:'mouse' })); } catch{}
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      return true;
    },

    // Names: title case first and last tokens (and hyphenated parts)
    titleCaseName(name){
      if(!name) return '';
      const tcPart = (p)=> p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
      return String(name)
        .trim()
        .split(/\s+/)
        .map(word=> word.split('-').map(tcPart).join('-'))
        .join(' ');
    },

    // ISBN helpers
    normalizeDigits(s){ return (s||'').replace(/\D/g,''); },
    isValidISBN13(isbn){
      const d = this.normalizeDigits(isbn);
      if(!/^97[89]\d{10}$/.test(d)) return false;
      let sum=0; for(let i=0;i<12;i++){ const n=+d[i]; sum += (i%2===0)? n : n*3; }
      const check = (10 - (sum % 10)) % 10; return check === +d[12];
    },
    toISBN13(isbn){
      let d = this.normalizeDigits(isbn);
      if(d.length===13 && /^97[89]/.test(d)) return d;
      if(d.length===10){ d = '978' + d.slice(0,9); // drop old check, add 978 prefix
        let sum=0; for(let i=0;i<12;i++){ const n=+d[i]; sum += (i%2===0)? n : n*3; }
        const check = (10 - (sum % 10)) % 10; return d + check; }
      return null;
    },
    toISBN10(isbn13){
      const d = this.normalizeDigits(isbn13);
      if(!/^978\d{10}$/.test(d)) return null;
      const core = d.slice(3,12);
      let sum=0; for(let i=0;i<9;i++){ sum += (10-i) * (+core[i]); }
      let check = 11 - (sum % 11); check = (check===10)? 'X' : (check===11? '0' : String(check));
      return core + check;
    },

    // Cover fallbacks and URL sanitization
    sanitizeURL(url, opts={}){
      try{
        if(!url || typeof url !== 'string') return '';
        let s = url.trim().replace(/["'<>\u0000-\u001F\u007F]/g,'');
        const u = new URL(s, window.location.origin);
        const proto = (u.protocol||'').toLowerCase();
        const allowData = !!opts.allowData;
        if(proto !== 'http:' && proto !== 'https:' && !(allowData && proto==='data:')) return '';
        return u.href;
      }catch{ return ''; }
    },

    async coverErr(img){
      if(img.dataset.fallbackTried==='done') return;
      const step = parseInt(img.dataset.fallbackStep||'0',10);
      const isbn = img.dataset.isbn;
      if(step===0){ img.dataset.fallbackStep='1'; img.src = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`; return; }
      if(step===1){ img.dataset.fallbackStep='2'; img.src = `https://covers.openlibrary.org/b/isbn/${isbn}-S.jpg?default=false`; return; }
      if(step===2){
        img.dataset.fallbackStep='3';
        const alt = await this.fetchGoogleCover(isbn);
        if(alt){ img.src = alt; return; }
      }
      img.dataset.fallbackTried='done';
      img.src = `https://placehold.co/320x480?text=No+Cover`;
    },

    // Series helpers
    normalizeSeriesName(name){
      if(!name) return '';
      let s = String(name).toLowerCase();
      s = s.replace(/\(\s*series\s*\)/g,'');
      s = s.replace(/^(the|a|an)\s+/,'');
      s = s.replace(/[#:]|\(|\)|\[|\]|\{|\}|\./g,' ');
      s = s.replace(/\b(book|bk|vol|volume)\s*\d+[\w\.-]*\b/g,'');
      s = s.replace(/\s{2,}/g,' ').trim();
      return s;
    },
    isEditionSeries(name){
      if(!name) return false;
      const s = String(name).toLowerCase();
      const keywords = [
        // Formats / editions
        'paperback','hardcover','mass market','trade paperback','edition','special edition','collector','collectors',
        'signed','edges','sprayed edges','painted edges','cover','dust jacket','illustrated','box set','boxed set',
        'anniversary','limited','exclusive','target exclusive','indigo exclusive','waterstones',
        // Publisher/collection imprints that are not true series
        'penguin classics','penguin modern classics','penguin english library','vintage international','bantam classics',
        "oxford world's classics","oxford worlds classics","everyman's library","everymans library",
        'modern library','barnes & noble classics','signet classics','folio society','harper perennial','picador',
        'tor essentials','anchor books','scribner classics'
      ];
      return keywords.some(k => s.includes(k));
    },
    guessSeriesFromTitle(title){
      if(!title) return '';
      const t = String(title);
      // Look for a parenthetical that also implies numbering, e.g., "(The Empyrean, 1)" or "(Empyrean Book 1)"
      const m = t.match(/\(([^)]+)\)/);
      if(m){
        const inside = m[1].trim();
        const indicative = /(,\s*\d+\b)|\b(book|bk|vol|volume)\s*\d+\b|#\s*\d+\b/i;
        if(indicative.test(inside)){
          const part = inside.split(',')[0].trim();
          return this.normalizeSeriesName(part);
        }
      }
      return '';
    },
    extractSeriesLabelFromTitle(title){
      if(!title) return '';
      const t = String(title);
      const m = t.match(/\(([^)]+)\)/);
      if(m){
        const inside = m[1].trim();
        const indicative = /(,\s*\d+\b)|\b(book|bk|vol|volume)\s*\d+\b|#\s*\d+\b/i;
        if(indicative.test(inside)){
          return inside.split(',')[0].trim();
        }
      }
      return '';
    },
    primarySeries(list){
      if(!Array.isArray(list) || !list.length) return '';
      for(const s of list){ if(s && !this.isEditionSeries(s)) return s; }
      return list[0] || '';
    },
    extractVolumeNumber(title){
      if(!title) return null;
      const s = String(title);
      // (Series, 1) pattern
      let m = s.match(/\([^\)]*,\s*(\d+(?:[\.-]\d+)?)\)/);
      if(m) return parseFloat(m[1].replace('-','.'));
      // Book/Vol numeric patterns
      m = s.match(/\b(book|bk|vol|volume)\s*(\d+(?:[\.-]\d+)?)\b/i);
      if(m) return parseFloat(m[2].replace('-','.'));
      // #1 shorthand (ensure not part of ISBN)
      m = s.match(/(?:^|\s)#(\d+(?:[\.-]\d+)?)(?:\s|$)/);
      if(m) return parseFloat(m[1].replace('-','.'));
      // Roman numerals (e.g., Book IV, Vol II)
      m = s.match(/\b(book|bk|vol|volume)\s*([ivxlcdm]+)\b/i);
      if(m){ const roman = m[2].toUpperCase(); const val = (function(r){
        const map={I:1,V:5,X:10,L:50,C:100,D:500,M:1000}; let total=0, prev=0;
        for(let i=r.length-1;i>=0;i--){ const cur=map[r[i]]||0; if(cur<prev) total-=cur; else { total+=cur; prev=cur; } }
        return total||null; })(roman); if(val!=null) return val; }
      // Word numbers (e.g., Book One, Volume Seven)
      m = s.match(/\b(book|bk|vol|volume)\s*(one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
      if(m){ const word=m[2].toLowerCase(); const map={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10}; const val=map[word]; if(val!=null) return val; }
      return null;
    },    // - Numeric: 11/07, 11/7, 11/07/2025
    // - Month name: Nov 7, November 7 (optional year)
    // - Keywords: today, yesterday, tomorrow
    // - Relative weekday: last Monday, next Tue(sday), this Friday
    parseDatePhrase(input){
      if(!input || typeof input !== 'string') return null;
      let s = input.trim().toLowerCase();
      // Normalize ordinals: 1st, 2nd, 3rd, 4th -> 1,2,3,4
      s = s.replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, '$1');
      const toMidnight = (d)=>{ const dt=new Date(d.getFullYear(), d.getMonth(), d.getDate()); return dt.getTime(); };
      const now = new Date();

      // Keywords
      if(s === 'today') return toMidnight(now);
      if(s === 'yesterday') return toMidnight(new Date(now.getFullYear(), now.getMonth(), now.getDate()-1));
      if(s === 'tomorrow') return toMidnight(new Date(now.getFullYear(), now.getMonth(), now.getDate()+1));

      // Numeric m/d[/yyyy]
      let m = s.match(/^([0-9]{1,2})[\/\-]([0-9]{1,2})(?:[\/\-]([0-9]{2,4}))?$/);
      if(m){
        let month = parseInt(m[1],10); let day = parseInt(m[2],10); let year = m[3]? parseInt(m[3],10) : now.getFullYear();
        if(year < 100) year += 2000; // interpret 2-digit years as 2000+
        if(month>=1 && month<=12 && day>=1 && day<=31){ const d = new Date(year, month-1, day); if(!isNaN(d)) return toMidnight(d); }
      }

      // Month name
      const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
      m = s.match(/^([a-zA-Z]+)\s+([0-9]{1,2})(?:,?\s*([0-9]{2,4}))?$/);
      if(m){
        const mi = months.findIndex(name=> name.startsWith(m[1].toLowerCase()));
        if(mi>=0){ const day = parseInt(m[2],10); let year = m[3]? parseInt(m[3],10) : now.getFullYear(); if(year<100) year+=2000; const d=new Date(year, mi, day); if(!isNaN(d)) return toMidnight(d); }
      }

      // Relative weekday: last|next|this <weekday>
      m = s.match(/^(last|next|this)\s+([a-zA-Z]+)$/);
      if(m){
        const ref = m[1]; const wd = m[2].toLowerCase();
        const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
        const target = weekdays.findIndex(w=> w.startsWith(wd));
        if(target>=0){
          const cur = now.getDay();
          let diff = target - cur; // how many days to add
          if(ref==='this'){
            // If target already passed this week, keep it in the same week by moving backwards/forwards to current week's occurrence
            // We interpret "this" as the occurrence within the current week (Sun-Sat)
          } else if(ref==='next'){
            if(diff <= 0) diff += 7;
          } else if(ref==='last'){
            if(diff >= 0) diff -= 7;
          }
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
          return toMidnight(d);
        }
      }

      return null;
    },
  };
  window.Utils = Utils;
})();
