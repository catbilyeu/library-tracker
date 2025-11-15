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

  // Temporary dictation session (auto-started for editable fields)
  const dictation = { active:false, startedMic:false };

  // Mic selection (best-effort: Web Speech API doesn't expose device routing)
  let selectedMicDeviceId=null; let micStream=null; let micLabel='';

  function supported(){ return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window; }

  function ensureHUD(){
    if(hud) return;
    hud = document.createElement('div');
    hud.className = 'voice-hud';
    hud.setAttribute('role','status');
    hud.innerHTML = `
      <div class="hud-status" aria-live="polite"></div>
    `;
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
    const statusEl = hud.querySelector('.hud-status');
    if(statusEl){ statusEl.textContent = `[${statusDot} ${status}]${mic}${transcript}`; }
  }

  function isEditableTarget(el){
    if(!el) return false;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if(el.isContentEditable) return true;
    if(tag === 'textarea') return true;
    if(tag === 'input'){
      const t = (el.type||'').toLowerCase();
      return ['text','search','email','url','tel','number','password','date'].includes(t);
    }
    return false;
  }
  function isDateInput(el){ return !!el && el.tagName && el.tagName.toLowerCase()==='input' && (el.type||'').toLowerCase()==='date'; }
  function isTextualEditable(el){
    if(!el) return false;
    if(isDateInput(el)) return false;
    if(el.isContentEditable) return true;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if(tag==='textarea') return true;
    if(tag==='input'){ const t=(el.type||'').toLowerCase(); return ['text','search','email','url','tel','number','password'].includes(t); }
    return false;
  }
  function toDateInput(ts){ try{ const d=new Date(ts); const pad=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }catch{ return ''; } }

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
    if(/^(next\s*page|go\s*(to\s*)?the\s*next\s*page|go\s*next|next)$/i.test(s)) return { type:'pager:next', payload:{} };
    if(/^(previous\s*page|prev\s*page|go\s*(back\s*to\s*the\s*)?previous\s*page|go\s*back|go\s*previous|go\s*to\s*the\s*previous\s*page|prev|previous|back)$/i.test(s)) return { type:'pager:prev', payload:{} };

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

    // "[name] is borrowing [book] [on/for/last/next/this <datePhrase>]" => lend intent (capture date if provided)
    m = s.match(/^(.+?)\s+is\s+borrow(ing)?\s+(.+?)(?:\s+(?:on|for|last|next|this)\s+(.+))?$/i);
    if(m){
      const borrower=(m[1]||'').trim(); const target=(m[3]||'').trim();
      const datePhrase=(m[4]||'').trim();
      let borrowedAt = null; if(datePhrase){ borrowedAt = Utils.parseDatePhrase(datePhrase); }
      return { type:'lend', payload:{ target, borrower, borrowedAt } };
    }

    // "[name] borrowed [book] [on/for/last/next/this <datePhrase>]" => lend intent (capture date if provided)
    m = s.match(/^([^\d]+?)\s+borrowed\s+(.+?)(?:\s+(?:on|for|last|next|this)\s+(.+))?$/i);
    if(m){
      const borrower=(m[1]||'').trim(); const target=(m[2]||'').trim();
      const datePhrase=(m[3]||'').trim();
      let borrowedAt = null; if(datePhrase){ borrowedAt = Utils.parseDatePhrase(datePhrase); }
      return { type:'lend', payload:{ target, borrower, borrowedAt } };
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

    // return [book] for [name]
    m = s.match(/^return\s+(.+?)\s+for\s+(.+)/i);
    if(m){
      const target=(m[1]||'').trim(); const borrower=(m[2]||'').trim();
      return { type:'return', payload:{ target, borrower } };
    }
    // return [book]
    m = s.match(/^return\s+(.+)/i);
    if(m){
      const target=(m[1]||'').trim();
      return { type:'return', payload:{ target } };
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

    // voice on/off and info
    m = s.match(/^voice\s*(on|off)$/i);
    if(m){ return { type:'voice:toggle', payload:{ enabled: m[1].toLowerCase()==='on' } } }
    // Also support "enable/disable voice" and "turn on/off voice"
    if(/^(enable|turn\s*on)\s+voice$/i.test(s)) return { type:'voice:toggle', payload:{ enabled: true } };
    if(/^(disable|turn\s*off)\s+voice$/i.test(s)) return { type:'voice:toggle', payload:{ enabled: false } };
    if(/^voice\s+info$/i.test(s)) return { type:'voice:info', payload:{} };

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
      // If we are in dictation mode, apply text to the focused editable target instead of parsing commands
      if(dictation.active){
        try{
          const el = dictation.target && document.activeElement === dictation.target ? dictation.target : document.activeElement;
          if(el){
            // Build combined transcript
            const combined = `${finalText}${interimText}`.trim();
            if(isDateInput(el)){
              // For dates, only apply when we have a reasonably final phrase (avoid jitter on interim)
              if(finalText){
                const ts = Utils.parseDatePhrase ? Utils.parseDatePhrase(combined) : null;
                if(ts){ el.value = toDateInput(ts); el.dispatchEvent(new Event('input', { bubbles:true })); el.dispatchEvent(new Event('change', { bubbles:true })); }
              }
            } else if(isTextualEditable(el)){
              // Replace value/textContent with combined phrase
              const val = combined;
              if(el.tagName && el.tagName.toLowerCase()==='textarea'){ el.value = val; }
              else if(el.tagName && el.tagName.toLowerCase()==='input'){ el.value = val; }
              else if(el.isContentEditable){ el.textContent = val; }
              // Fire input event so any bindings react
              try{ el.dispatchEvent(new Event('input', { bubbles:true })); }catch{}
            }
          }
        }catch{}
        status = interimText ? 'listening' : 'processing';
        renderHUD();
        return;
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
      if(restartOnEnd && (isEnabled || dictation.active) && (continuousMode || pttActive || dictation.active)){
        try{ rec.start(); status='listening'; renderHUD(); }catch{ /* noop */ }
      } else {
        status='idle'; renderHUD();
      }
    };
  }

  function startRecognition(quiet){
    if(!supported()){ Utils.toast('Voice not supported', { type:'error' }); return; }
    ensureHUD();
    if(!rec) buildRecognizer();
    rec.continuous = continuousMode;
    try{ rec.start(); restartOnEnd=true; status='listening'; renderHUD(); }catch(e){ /* already started */ }
    if(!quiet) Utils.toast('Voice listening');
  }

  function stopRecognition(quiet){
    try{ restartOnEnd=false; }catch{}
    try{ rec?.stop?.(); }catch{}
    try{ rec?.abort?.(); }catch{}
    // Fully reset dictation/PTT state
    dictation.active = false; dictation.startedMic = false; dictation.target = null;
    pttActive = false; startedByPTT = false;
    finalText=''; interimText='';
    status='idle'; renderHUD();
    if(!quiet) Utils.toast('Voice stopped');
  }

  function toggle({ enabled }){
    isEnabled = !!enabled;
    if(isEnabled){
      // If continuous mode, start immediately; otherwise wait for PTT
      if(continuousMode || pttActive) startRecognition(); else { status='idle'; renderHUD(); }
    } else {
      // Stop recognition and any active dictation immediately
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
    // Do not keep the mic stream open. We only open briefly (if needed) to learn labels, then stop.
    try{
      // Stop any previously opened stream immediately
      if(micStream){ micStream.getTracks().forEach(t=>t.stop()); micStream=null; }
      if(!navigator.mediaDevices) return;

      // First, try to map the label without opening the mic (if permission already granted elsewhere)
      try{
        const devices = await navigator.mediaDevices.enumerateDevices();
        const match = devices.find(d=> d.kind==='audioinput' && (d.deviceId===id || (!id && d.deviceId==='default')));
        if(match && match.label){ micLabel = match.label; renderHUD(); return; }
      }catch{}

      // If labels are not available yet, briefly request audio to unlock labels, then stop it right away
      let tempStream = null;
      try{
        const constraints = id ? { audio: { deviceId: { exact: id } } } : { audio: true };
        tempStream = await navigator.mediaDevices.getUserMedia(constraints);
      }catch{}
      try{
        const devices = await navigator.mediaDevices.enumerateDevices();
        const match = devices.find(d=> d.kind==='audioinput' && (d.deviceId===id || (!id && d.deviceId==='default')));
        micLabel = match?.label || (id ? `device ${id}` : 'default');
      }catch{ micLabel = id ? `device ${id}` : 'default'; }
      finally {
        try{ tempStream?.getTracks?.().forEach(t=> t.stop()); }catch{}
        tempStream = null; // ensure it is released
      }
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

  async function init(api){
    publish=api.publish; subscribe=api.subscribe;
    ensureHUD();
    // external controls
    subscribe('voice:toggle', toggle);
    subscribe('voice:setAnnouncements', ({enabled})=>{ announcements = !!enabled; });
    subscribe('voice:setProcessDelay', ({ms})=>{ processDelayMs = Math.max(0, Number(ms)||0); });
    subscribe('voice:setPtt', ({enabled})=>{ setPttMode(!!enabled); });
    // Dictation control hooks from other modules (e.g., hands-free and modal)
    subscribe('voice:dictation:start', ({ target })=>{
      if(!isEnabled) return; // hard gate when voice is disabled
      dictation.active = true; dictation.target = target || document.activeElement;
      const wasListening = (status === 'listening');
      dictation.startedMic = !wasListening;
      if(!wasListening){ startRecognition(true); }
    });
    subscribe('voice:dictation:stop', ()=>{
      if(dictation.active){
        dictation.active=false;
        if(dictation.startedMic){ stopRecognition(true); }
        dictation.startedMic=false; dictation.target=null;
        finalText=''; interimText=''; status='idle'; renderHUD();
      }
    });
    try{
      const s = await Storage.getSettings();
      if(typeof s.handsFreeSensitivity === 'number') window.HandsFree?.setSensitivity?.(s.handsFreeSensitivity);
      if(typeof s.handsFreeMirrorX === 'boolean') window.HandsFree?.setMirrorX?.(s.handsFreeMirrorX);
      if(s.handsFreeDeviceId) window.HandsFree?.setDeviceId?.(s.handsFreeDeviceId);
      announcements = s.voiceAnnouncements!==false;
      if(typeof s.voiceProcessDelayMs === 'number') processDelayMs = Math.max(0, Number(s.voiceProcessDelayMs)||0);
      setPttMode(!!s.voicePttOnly);
      renderHUD();
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
