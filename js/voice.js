(function(){
  // Simple event bus bindings (injected via init)
  let publish=()=>{}; let subscribe=()=>{};

  // Recognition + state
  let isEnabled=false; // external master enable
  let rec=null; let recLang = navigator.language || 'en-US';
  let hud=null; let status='idle'; // idle | listening | processing
  let interimText=''; let finalText='';
  let continuousMode=true; // continuous listening (mic open)
  let pttActive=false; // Spacebar held state
  let startedByPTT=false; // last start source
  let restartOnEnd=false; // internal restart guard
  let announcements=true; // speech confirmations
  let processDelayMs=700; // buffer time before processing final text (to allow users to finish)
  let pttOnly=false; // push-to-talk mode (Spacebar)

  // Mic selection (best-effort: Web Speech API doesn't expose device routing)
  let selectedMicDeviceId=null; let micStream=null; let micLabel='';

  function supported(){ return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window; }

  function ensureHUD(){
    if(hud) return;
    hud = document.createElement('div');
    hud.style.cssText = [
      'position:fixed','left:16px','bottom:16px','padding:8px 10px','border:1px solid var(--border)',
      'border-radius:10px','background:rgba(20,32,51,.85)','color:var(--fg)','z-index:3000','max-width:60vw',
      'font-size:12px','line-height:1.35','opacity:.95','backdrop-filter:saturate(1.5) blur(4px)'
    ].join(';');
    hud.setAttribute('role','status');
    document.body.appendChild(hud);
    renderHUD();
  }

  function renderHUD(){
    if(!hud) return;
    let statusDot = '⚪';
    if(status==='listening') statusDot='🟢';
    else if(status==='processing') statusDot='🟡';
    const mic = micLabel ? ` • mic: ${micLabel}` : '';
    const transcript = (finalText || interimText) ? `\n${finalText || interimText}` : '\nPress and hold Space to talk';
    hud.textContent = `[${statusDot} ${status}]${mic}${transcript}`;
  }

  function isEditableTarget(el){
    if(!el) return false;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if(el.isContentEditable) return true;
    if(tag === 'textarea') return true;
    if(tag === 'input'){
      const t = (el.type||'').toLowerCase();
      return ['text','search','email','url','tel','number','password'].includes(t);
    }
    return false;
  }

  // Speak confirmation using SpeechSynthesis
  function speak(text){
    try{
      if(!announcements) return;
      if(!('speechSynthesis' in window)) return;
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = recLang;
      const voices = window.speechSynthesis.getVoices();
      const match = voices.find(v=>v.lang && v.lang.toLowerCase().startsWith(recLang.toLowerCase()));
      if(match) utter.voice = match;
      window.speechSynthesis.speak(utter);
    }catch(e){ /* noop */ }
  }

  function isbnTo13(raw){
    const digits = (raw||'').replace(/[^0-9xX]/g,'');
    try{ return Utils.toISBN13(digits); }catch(e){ return null; }
  }

  function parseIntent(text){
    const s = (text||'').trim().replace(/[.,!?]+$/,'');

    // Generic confirm for pending actions (e.g., remove, bulk return)
    if(/^(yes|confirm|remove|return)$/.test(s)) return { type:'confirm:generic', payload:{} };

    // close/dismiss/cancel modal or overlays
    if(/^(close|dismiss|cancel)$/.test(s)) return { type:'modal:close', payload:{} };

    // pagination: next/previous page
    if(/^(next\s*page|go\s*(to\s*)?the\s*next\s*page|go\s*next)$/i.test(s)) return { type:'pager:next', payload:{} };
    if(/^(previous\s*page|prev\s*page|go\s*(back\s*to\s*the\s*)?previous\s*page|go\s*back|go\s*previous|go\s*to\s*the\s*previous\s*page)$/i.test(s)) return { type:'pager:prev', payload:{} };

    // search/find/lookup
    let m = s.match(/^(search|find|look\s*up|lookup)\s+(.+)/i);
    if(m) return { type:'search', payload:{ q: m[2] } };

    // clear search
    if(/^(clear|clear\s+search)$/i.test(s)) return { type:'search:clear', payload:{} };

    // "do i have ..." check
    m = s.match(/^do\s+i\s+have\s+(.+)/i);
    if(m) return { type:'book:check_have', payload:{ target: m[1] } };

    // "who's borrowing ..." or "who is borrowing ..." -> open modal to show details
    m = s.match(/^who('?s|\s+is)\s+borrow(ing)?\s+(.+)/i);
    if(m) return { type:'book:is_borrowed', payload:{ target: m[3] } };

    // "[name] started borrowing [book] (on|for|last|next|this) <datePhrase>" => lend intent with date
    m = s.match(/^(.+?)\s+started\s+borrow(ing)?\s+(.+?)(?:\s+(?:on|for|last|next|this)\s+(.+))?$/i);
    if(m){
      const borrower=(m[1]||'').trim(); const target=(m[3]||'').trim();
      const datePhrase=(m[4]||'').trim();
      let borrowedAt = null; if(datePhrase){ borrowedAt = Utils.parseDatePhrase(datePhrase); }
      return { type:'lend', payload:{ target, borrower, borrowedAt } };
    }

    // "is anyone borrowing ..." -> open modal and speak status
    m = s.match(/^is\s+any(one|body)\s+borrow(ing)?\s+(.+)/i);
    if(m) return { type:'book:is_borrowed', payload:{ target: m[3] } };

    // "which books are [name] borrowing" -> filter shelves to show active loans for name
    m = s.match(/^which\s+books\s+are\s+(.+?)\s+borrow(ing)?\??$/i);
    if(m){
      const borrower=(m[1]||'').trim();
      return { type:'borrower:list', payload:{ borrower } };
    }

    // "which books is [name] borrowing" -> filter shelves to show active loans for name
    m = s.match(/^which\s+books\s+is\s+(.+?)\s+borrow(ing)?\??$/i);
    if(m){
      const borrower=(m[1]||'').trim();
      return { type:'borrower:list', payload:{ borrower } };
    }

    // "[name] is borrowing [book]" => lend intent
    m = s.match(/^(.+?)\s+is\s+borrow(ing)?\s+(.+)/i);
    if(m){
      const borrower=(m[1]||'').trim(); const target=(m[3]||'').trim();
      return { type:'lend', payload:{ target, borrower, borrowedAt: null } };
    }

    // name borrowed book => lend intent
    m = s.match(/^([^\d]+?)\s+borrowed\s+(.+)/i);
    if(m){
      const borrower=(m[1]||'').trim(); const target=(m[2]||'').trim();
      return { type:'lend', payload:{ target, borrower, borrowedAt: null } };
    }

    // name returned the book(s) they borrowed [on <datePhrase>]
    m = s.match(/^(.+?)\s+returned\s+(the\s+)?book(s)?(\s+they\s+borrowed)?(?:\s+on\s+(.+))?$/i);
    if(m){
      const borrower=(m[1]||'').trim(); const datePhrase=(m[5]||'').trim();
      let returnedAt = null; if(datePhrase){ returnedAt = Utils.parseDatePhrase(datePhrase); }
      return { type:'borrower:return', payload:{ borrower, returnedAt } };
    }

    // open/start scanner
    if(/\b(open|start)\b\s+(the\s+)?scanner\b/.test(s) || /\bstart\b\s+scan(ner)?\b/.test(s))
      return { type:'scanner:open', payload:{} };

    // add isbn / add book 978...
    m = s.match(/^(add|scan)\s+(isbn|book)?\s*([0-9xX\-\s]{10,17})/i);
    if(m){ const isbn13 = isbnTo13(m[3]); if(isbn13) return { type:'book:add', payload:{ isbn13 } }; }

    // lend/loan X to Y [for <datePhrase>]
    // Examples: "lend dune to carlie for 11/07", "lend book to Carlie for last Monday"
    m = s.match(/^(lend|loan)\s+(.+?)\s+(?:to|->)\s+([^]+?)(?:\s+for\s+(.+))?$/i);
    if(m){
      const borrower = (m[3]||'').trim();
      const target = (m[2]||'').trim();
      const datePhrase = (m[4]||'').trim();
      let borrowedAt = null;
      if(datePhrase){ borrowedAt = Utils.parseDatePhrase(datePhrase); }
      return { type:'lend', payload:{ target, borrower, borrowedAt } };
    }

    // return all books for a borrower
    m = s.match(/^return\s+books\s+for\s+(.+)/i);
    if(m){
      const borrower=(m[1]||'').trim();
      return { type:'borrower:return_all', payload:{ borrower } };
    }
    m = s.match(/^(remove|delete|del)\s+(.+)/i);
    if(m) return { type:'remove', payload:{ target: m[2] } };

    // hands-free/continuous toggle
    m = s.match(/^(hands\s*free|handsfree|continuous)\s*(on|off)/i);
    if(m){ return { type:'handsfree:toggle', payload:{ enabled: m[2].toLowerCase()==='on' } } }

    // voice on/off
    m = s.match(/^voice\s*(on|off)/i);
    if(m){ return { type:'voice:toggle', payload:{ enabled: m[1].toLowerCase()==='on' } } }

    return null;
  }

  function confirmationFor(intent){
    if(!intent) return null;
    switch(intent.type){
      case 'search': return `Searching for ${intent.payload.q}`;
      case 'scanner:open': return 'Opening scanner';
      case 'book:add': return `Adding ISBN ${intent.payload.isbn13}`;
      case 'lend': {
        const p=intent.payload; const when = p.borrowedAt? new Date(p.borrowedAt).toLocaleDateString() : 'today';
        return `Lending ${p.target} to ${p.borrower} for ${when}`;
      }
      case 'return': return `Returning ${intent.payload.target}`;
      case 'remove': return `Removing ${intent.payload.target}`;
      case 'handsfree:toggle': return `Hands-free ${intent.payload.enabled?'on':'off'}`;
      case 'voice:toggle': return `Voice ${intent.payload.enabled?'on':'off'}`;
      default: return null;
    }
  }

  function buildRecognizer(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    rec = new SR();
    rec.continuous = continuousMode;
    rec.interimResults = true; // keep interim to build buffer
    rec.lang = recLang;

    rec.onresult = (e)=>{
      interimText='';
      for(let i=e.resultIndex; i<e.results.length; i++){
        const r=e.results[i];
        const txt = r[0]?.transcript || '';
        if(r.isFinal) finalText += txt; else interimText += txt;
      }
      status = finalText ? 'processing' : 'listening';
      renderHUD();
      if(finalText){
        const captured = finalText; // snapshot before we clear
        setTimeout(()=>{
          const intent = parseIntent(captured);
          if(intent){
            publish('voice:intent', intent);
            const msg = confirmationFor(intent); if(msg) speak(msg);
          }
          // Reset for next utterance
          finalText=''; interimText='';
          // If not continuous and we are in PTT, keep listening until keyup; otherwise stop.
          if(!continuousMode && !pttActive){ stopRecognition(/*user*/false); }
          status = (continuousMode || pttActive) ? 'listening' : 'idle';
          renderHUD();
        }, processDelayMs);
      }
    };

    rec.onerror = (ev)=>{
      // Show error but try to recover if enabled
      Utils.toast(`Voice error: ${ev.error||'unknown'}`, { type:'error' });
      status='idle'; renderHUD();
    };

    rec.onend = ()=>{
      // Chrome fires onend after stop() or after a pause.
      if(restartOnEnd && isEnabled && (continuousMode || pttActive)){
        try{ rec.start(); status='listening'; renderHUD(); }catch{ /* noop */ }
      } else {
        status='idle'; renderHUD();
      }
    };
  }

  function startRecognition(){
    if(!supported()){ Utils.toast('Voice not supported', { type:'error' }); return; }
    ensureHUD();
    if(!rec) buildRecognizer();
    rec.continuous = continuousMode;
    try{ rec.start(); restartOnEnd=true; status='listening'; renderHUD(); }catch(e){ /* already started */ }
    Utils.toast('Voice listening');
  }

  function stopRecognition(){
    try{ restartOnEnd=false; rec?.stop(); }catch{}
    status='idle'; renderHUD();
    Utils.toast('Voice stopped');
  }

  function toggle({ enabled }){
    isEnabled = !!enabled;
    if(isEnabled){
      // If continuous mode, start immediately; otherwise wait for PTT
      if(continuousMode || pttActive) startRecognition(); else { status='idle'; renderHUD(); }
    } else {
      stopRecognition();
    }
  }

  function setPttMode(on){
    pttOnly = !!on;
    continuousMode = !pttOnly;
    if(rec) rec.continuous = continuousMode;
    if(isEnabled){
      if(continuousMode){ startRecognition(); }
      else { if(!pttActive) stopRecognition(); }
    }
    try{ Storage?.setSettings?.({ voicePttOnly: pttOnly }); }catch{}
    renderHUD();
  }

  async function setMicDeviceId(id){
    selectedMicDeviceId = id || null;
    // Best-effort: acquire a stream to hint OS/browser to use this input.
    try{
      if(micStream){ micStream.getTracks().forEach(t=>t.stop()); micStream=null; }
      if(!navigator.mediaDevices) return;
      const constraints = id ? { audio: { deviceId: { exact: id } } } : { audio: true };
      micStream = await navigator.mediaDevices.getUserMedia(constraints);
      // Try to map deviceId to label (labels available after permission)
      const devices = await navigator.mediaDevices.enumerateDevices();
      const match = devices.find(d=>d.kind==='audioinput' && (d.deviceId===id || (!id && d.deviceId==='default')));
      micLabel = match?.label || (id ? `device ${id}` : 'default');
      renderHUD();
    }catch(e){
      Utils.toast('Unable to access selected microphone', { type:'error' });
    }
  }

  function onKeyDown(e){
    const isSpace = e.code==='Space' || e.key===' ' || e.key==='Spacebar';
    if(!isSpace) return;
    if(isEditableTarget(document.activeElement)) return; // ignore when typing
    if(pttActive) return; // already held
    pttActive=true; startedByPTT=true;
    if(isEnabled){
      if(continuousMode){
        // In continuous mode, Space toggles start/stop
        if(status==='listening'){ stopRecognition(); }
        else { startRecognition(); }
      } else {
        // In PTT-only mode, listen while held
        startRecognition();
      }
    }
    try{ e.preventDefault(); }catch{}
  }

  function onKeyUp(e){
    const isSpace = e.code==='Space' || e.key===' ' || e.key==='Spacebar';
    if(!isSpace) return;
    if(isEditableTarget(document.activeElement)) return;
    pttActive=false;
    if(isEnabled && !continuousMode){
      // Stop when released in PTT-only mode
      stopRecognition();
    }
    try{ e.preventDefault(); }catch{}
  }

  function init(api){
    publish=api.publish; subscribe=api.subscribe;
    ensureHUD();
    // external controls
    subscribe('voice:toggle', toggle);
    subscribe('voice:setAnnouncements', ({enabled})=>{ announcements = !!enabled; });
    subscribe('voice:setProcessDelay', ({ms})=>{ processDelayMs = Math.max(0, Number(ms)||0); });
    subscribe('voice:setPtt', ({enabled})=>{ setPttMode(!!enabled); });
    // initialize from saved settings
    try{
      Storage.getSettings().then(s=>{
        announcements = s.voiceAnnouncements!==false;
        if(typeof s.voiceProcessDelayMs === 'number') processDelayMs = Math.max(0, Number(s.voiceProcessDelayMs)||0);
        setPttMode(!!s.voicePttOnly);
        renderHUD();
      }).catch(()=>{});
    }catch{}

    // Hotkeys: push-to-talk Space
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
  }

  // Public API
  function setAnnouncements(on){ announcements = !!on; try{ Storage?.setSettings?.({ voiceAnnouncements: announcements }); } catch{} renderHUD(); }
  function setProcessDelay(ms){ processDelayMs = Math.max(0, Number(ms)||0); try{ Storage?.setSettings?.({ voiceProcessDelayMs: processDelayMs }); } catch{} renderHUD(); }
  window.Voice = { init, toggle, setMicDeviceId, setAnnouncements, setProcessDelay, setPttMode };
})();
