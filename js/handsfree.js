// (local-only) pinch sensitivity slider + mapping; no push

(function(){
  let publish=()=>{}; let subscribe=()=>{}; let isEnabled=false;
  let cursor=null; let overlay=null; let video=null; let stream=null; let hands=null;
  let lastClick=0; let hudEl=null; let rafId=null;
  let starting=false; let restartTimer=null;
  // Watchdog and hover state
  let lastResultsTs=0; let watchdogId=null; let lastHoverEl=null; let restartInFlight=false;

  // Sensitivity/config
  let deviceId=null; let settingsLoaded=false;
  let prevX=null, prevY=null; let lastFrameTs=null; let fpsAvg=null;
  let sendErrorCount=0;

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  // Cursor movement sensitivity (position smoothing, step caps, debounce)
  function mapSensitivity(s){
    s = clamp(Number(s)||0, 0, 1);
    const deadzone = Math.round(18 - s*12);      // px (18 -> 6)
    const alpha = 0.22 + s*(0.23);               // smoothing factor (0.22 -> 0.45)
    const debounceMs = Math.round(220 + (1-s)*80);  // ms (300 -> 220)
    const maxStep = Math.round(36 + s*28);       // px/frame cap (36 -> 64)
    return { s, deadzone, alpha, debounceMs, maxStep };
  }
  // Pinch sensitivity (click/grab gesture)
  function mapPinchSensitivity(s){
    s = clamp(Number(s)||0, 0, 1);
    const ease = Math.pow(s, 0.7); // more resolution at low end
    const dwellMs = Math.round(550 - ease*370); // 550 → 180ms
    const normThresh = 0.08 - ease*0.045;       // 0.080 → 0.035 (normalized distance)
    // pixel threshold relative to viewport; recompute each time based on current window size
    const pixelThresholdPx = ()=>{
      const minDim = Math.min(window.innerWidth||1280, window.innerHeight||800);
      const px = Math.round(minDim * (0.032 - ease*0.012)); // 3.2% → 2.0%
      return clamp(px, 20, 48);
    };
    const releaseNorm = normThresh + 0.008;     // hysteresis on release
    const releasePx = (px)=> Math.round(px * 1.35);
    return { s, ease, dwellMs, normThresh, releaseNorm, pixelThresholdPx, releasePx };
  }
  // Defaults
  let cfg = mapSensitivity(0.6);                 // cursor
  let pinchCfg = mapPinchSensitivity(0.25);      // pinch (separate)
  // Mirror X by default so cursor follows your hand naturally with a front camera
  let mirrorX = true;

  async function loadSettingsIfNeeded(){
    if(settingsLoaded) return;
    try{
      const s = await Storage.getSettings();
      if(typeof s.handsFreeSensitivity === 'number') cfg = mapSensitivity(s.handsFreeSensitivity);
      if(typeof s.handsFreePinchSensitivity === 'number') pinchCfg = mapPinchSensitivity(s.handsFreePinchSensitivity);
      if(typeof s.handsFreeMirrorX === 'boolean') mirrorX = !!s.handsFreeMirrorX;
      if(s.handsFreeDeviceId) deviceId = s.handsFreeDeviceId;
      settingsLoaded = true;
    } catch(e){ /* ignore */ }
  }

  function ensureMediaPipe(){
    if(hands) return true;
    if(!window.Hands){ Utils.toast('MediaPipe Hands not loaded', { type:'error' }); return false; }
    hands = new Hands({ locateFile: (file)=> `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
    hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.7, minTrackingConfidence: 0.75 });
    hands.onResults(onResults);
    return true;
  }

  function updateHUD(state){
    if(!hudEl) return;
    const fps = fpsAvg? Math.round(fpsAvg) : '—';
    const since = lastResultsTs? Math.round((performance.now()-lastResultsTs)/1000) : '—';
    hudEl.textContent = `${state} • ${fps} fps • ${since}s`;
  }

  function centerCursor(){
    try{
      const cx = Math.round(window.innerWidth/2), cy = Math.round(window.innerHeight/2);
      prevX = cx; prevY = cy;
      if(cursor){ cursor.style.left = cx+'px'; cursor.style.top = cy+'px'; }
    }catch{}
  }

  // Pinch detection state
  let pinchDown = false; let pinchStart = 0;
  let pinchFired = false;
  // Freeze pointer while pinching to prevent cursor bounce when thumb approaches index
  let freeze = false; let freezeX = 0; let freezeY = 0;

  function onResults(results){
    if(!isEnabled) return;
    const now = performance.now(); lastResultsTs = now;
    if(lastFrameTs){ const inst = 1000/(now-lastFrameTs); fpsAvg = fpsAvg? (fpsAvg*0.8 + inst*0.2) : inst; }
    lastFrameTs = now;

    if(!results.multiHandLandmarks || results.multiHandLandmarks.length===0){ updateHUD('No hand'); return; }
    const lm = results.multiHandLandmarks[0];
    const tip = lm[8]; // index fingertip
    const mid6 = lm[6]; const mid10 = lm[10]; const tip12 = lm[12];
    const thumb = lm[4]; // thumb tip

    // Flip X to disable the "opposite movement" effect from non-mirrored camera coordinates
    const normX = mirrorX ? (1 - tip.x) : tip.x;
    const x = Math.max(0, Math.min(window.innerWidth, normX * window.innerWidth));
    const y = Math.max(0, Math.min(window.innerHeight, tip.y * window.innerHeight));

    // Click/grab detection using pinch (thumb–index distance + dwell)
    // Compute pinch distance in screen and normalized units
    const tipXpx = x; const tipYpx = y;
    const thumbXnorm = mirrorX ? (1 - thumb.x) : thumb.x;
    const thumbXpx = Math.max(0, Math.min(window.innerWidth, thumbXnorm * window.innerWidth));
    const thumbYpx = Math.max(0, Math.min(window.innerHeight, thumb.y * window.innerHeight));
    const pinchDistPx = Math.hypot(tipXpx - thumbXpx, tipYpx - thumbYpx);
    const pinchDistNorm = Math.hypot((mirrorX ? (1-tip.x) : tip.x) - thumbXnorm, tip.y - thumb.y);

    // Open-hand heuristic (for HUD only)
    const open = (tip.y < mid6.y && tip12.y < mid10.y);

    // Dual-threshold pinch detection: pixel + normalized (accounts for distance from camera)
    const pixelThresh = pinchCfg.pixelThresholdPx();
    const normThresh = pinchCfg.normThresh;
    const isPinched = (pinchDistPx <= pixelThresh) || (pinchDistNorm <= normThresh);
    // On pinch, always move cursor to current position to ensure we click what's under the fingers
    // Freeze pointer at current position while pinched to avoid bounce caused by fingertip shift
    if(isPinched){
      if(!pinchDown){
        pinchDown = true; pinchStart = now; pinchFired = false;
        freeze = true; freezeX = x; freezeY = y;
        // move cursor to pinch point immediately for precise click target
        prevX = x; prevY = y; if(cursor){ cursor.style.left = x+'px'; cursor.style.top = y+'px'; }
      }
      // If sustained beyond dwell and not within debounce, fire once per pinch
      if(!pinchFired && (now - pinchStart) >= pinchCfg.dwellMs && (now - lastClick) > cfg.debounceMs){
        lastClick = now; pinchFired = true; // keep freeze until pinch releases
        publish('handsfree:click', { x: Math.round(x), y: Math.round(y) });
      }
    } else {
      // Release
      if(pinchDown){
        pinchDown = false; pinchFired = false;
      }
      // Hysteresis on release for both thresholds
      const releasedPx = pinchDistPx > pinchCfg.releasePx(pixelThresh);
      const releasedNorm = pinchDistNorm > pinchCfg.releaseNorm;
      if(releasedPx && releasedNorm){ freeze = false; }
    }

    // Apply movement (respects freeze state)
    smoothMove(x,y);

    updateHUD(isPinched ? 'Pinch' : (open ? 'Open' : 'Closed'));
  }

  function maybeAutoScroll(px, py){
    // Only enable edge scroll on mobile where scrolling is enabled
    const mobile = window.matchMedia && window.matchMedia('(max-width: 680px)').matches;
    if(!mobile) return;
    const threshold = 56; // px from edges
    const y = py;
    const atTop = y <= threshold;
    const atBottom = y >= (window.innerHeight - threshold);
    if(!atTop && !atBottom) return;

    // Determine scroll target: nearest scrollable ancestor under cursor, else page
    let target = null;
    try{
      target = document.elementFromPoint(Math.round(px), Math.round(py));
    }catch{}
    let node = target;
    const isScrollable = (el)=>{
      if(!el || el===document.body || el===document.documentElement) return false;
      const st = getComputedStyle(el);
      if(!/(auto|scroll)/.test(st.overflowY||'')) return false;
      return (el.scrollHeight - el.clientHeight) > 1;
    };
    let scrollEl = null;
    for(let i=0;i<8 && node;i++){
      if(isScrollable(node)){ scrollEl = node; break; }
      node = node.parentElement;
    }
    const scrollBy = (dy)=>{
      if(scrollEl){ scrollEl.scrollBy({ top: dy, behavior: 'auto' }); }
      else { window.scrollBy({ top: dy, behavior: 'auto' }); }
    };

    const base = 1.2; // min px per frame
    const max = 4.5;  // max px per frame
    if(atTop){
      const t = clamp(1 - (y/threshold), 0, 1);
      const delta = -(base + (max-base)*t);
      scrollBy(delta);
    } else if(atBottom){
      const t = clamp((y - (window.innerHeight - threshold))/threshold, 0, 1);
      const delta = (base + (max-base)*t);
      scrollBy(delta);
    }
  }

  function smoothMove(x,y){
    if(!cursor) return;
    if(prevX==null){ prevX=x; prevY=y; }
    // If frozen (during pinch), lock to freeze coords
    if(freeze){
      prevX = freezeX; prevY = freezeY;
      cursor.style.left = prevX+'px'; cursor.style.top = prevY+'px';
      try{
        const el = document.elementFromPoint(Math.round(prevX), Math.round(prevY));
        if(lastHoverEl && lastHoverEl!==el){ lastHoverEl.classList.remove('hf-hover'); }
        if(el){ el.classList.add('hf-hover'); lastHoverEl = el; }
      }catch{}
      // Allow auto-scroll even while frozen (e.g., while holding near edge)
      try{ maybeAutoScroll(prevX, prevY); }catch{}
      return;
    }
    let dx = x - prevX, dy = y - prevY;
    if(Math.hypot(dx,dy) < cfg.deadzone){ dx = 0; dy = 0; }
    const stepX = Math.max(Math.min(dx, cfg.maxStep), -cfg.maxStep);
    const stepY = Math.max(Math.min(dy, cfg.maxStep), -cfg.maxStep);
    prevX = prevX + stepX * cfg.alpha; prevY = prevY + stepY * cfg.alpha;
    cursor.style.left = prevX+'px'; cursor.style.top = prevY+'px';
    // Motion hover affordance to make targets more obvious
    try{
      const el = document.elementFromPoint(Math.round(prevX), Math.round(prevY));
      if(lastHoverEl && lastHoverEl!==el){ lastHoverEl.classList.remove('hf-hover'); }
      if(el){ el.classList.add('hf-hover'); lastHoverEl = el; }
    }catch{}
    // Edge auto-scroll on mobile
    try{ maybeAutoScroll(prevX, prevY); }catch{}
  }

  function setupOverlay(){
    overlay = document.getElementById('handsfree-overlay');
    if(!overlay) return;
    cursor = document.getElementById('hf-cursor');
    if(!cursor){
      cursor = document.createElement('div'); cursor.id='hf-cursor'; cursor.className='hf-cursor'; overlay.appendChild(cursor);
    }
    hudEl = overlay.querySelector('.hf-hud');
    if(!hudEl){ hudEl = document.createElement('div'); hudEl.className='hf-hud'; overlay.appendChild(hudEl); }
  }

  async function start(){
    if(starting) return; starting=true;
    if(!ensureMediaPipe()){ starting=false; return; }
    await loadSettingsIfNeeded();
    setupOverlay();
    if(overlay) overlay.hidden = false;

    // If a previous video exists, remove it to avoid play() clash
    try{ video?.pause?.(); }catch{}
    try{ video?.remove?.(); }catch{}
    video=null;
    try{ if(stream){ stream.getTracks().forEach(t=>t.stop()); } } catch{}
    stream=null;

    video = document.createElement('video'); video.playsInline = true; video.muted = true; video.autoplay = true; video.style.display='none'; document.body.appendChild(video);
    video.addEventListener('pause', ()=>{ if(isEnabled) try{ video.play(); }catch{} });

    // Try a cascade of constraints to avoid OverconstrainedError
    const tryList = [];
    if (deviceId) tryList.push({ audio:false, video:{ deviceId:{ exact: deviceId }, width:{ideal:640}, height:{ideal:480} } });
    tryList.push(
      { audio:false, video:{ facingMode:'user', width:{ideal:640}, height:{ideal:480} } },
      { audio:false, video:{ facingMode:'environment', width:{ideal:640}, height:{ideal:480} } },
      { audio:false, video:{ width:{ideal:640}, height:{ideal:480} } },
      { audio:false, video:true }
    );
    let err = null;
    for (const c of tryList){
      try { stream = await navigator.mediaDevices.getUserMedia(c); err = null; break; } catch(e){ err = e; if(e.name==='NotAllowedError'){ Utils.toast('Camera permission denied', { type:'error' }); break; } }
    }
    if(!stream){ console.error(err); Utils.toast('Unable to access camera', { type:'error' }); starting=false; return; }
    video.srcObject = stream; 
    try { await video.play(); }
    catch(e){
      // If play was interrupted by a new load request, retry once after brief delay
      if(e.name==='AbortError'){
        await new Promise(r=> setTimeout(r, 50));
        try { await video.play(); } catch(e2){ console.warn('Video play failed after retry', e2); }
      } else {
        console.warn('Video play failed', e);
      }
    }

    const onFrame = async ()=>{
      try{
        if(!video || video.readyState < 2){ rafId = requestAnimationFrame(onFrame); return; }
        const vw = video.videoWidth||0, vh = video.videoHeight||0;
        if(vw<=0 || vh<=0){ rafId = requestAnimationFrame(onFrame); return; }
        await hands.send({ image: video });
        sendErrorCount = 0;
      } catch(e){
        sendErrorCount++;
        const msg = String(e && (e.message||e));
        if(msg.includes('ROI width') || msg.includes('Aborted') || sendErrorCount>=5){
          console.warn('[motion-cursor] onFrame error, restarting', msg);
          await hardRestart(); return;
        }
      }
      rafId = requestAnimationFrame(onFrame);
    };
    rafId = requestAnimationFrame(onFrame);

    Utils.toast('Hands-free is on');
    starting=false;
    // Reset cursor to center on start
    centerCursor();

    // Watchdog: restart pipeline if no frames processed for 5s
    if(watchdogId){ try{ clearInterval(watchdogId); }catch{} watchdogId=null; }
    watchdogId = setInterval(async ()=>{
      if(!isEnabled || restartInFlight) return;
      const gap = performance.now() - (lastResultsTs||0);
      if(gap > 5000){
        console.warn('[motion-cursor] Watchdog restart after', Math.round(gap),'ms without frames');
        restartInFlight = true;
        await hardRestart();
        restartInFlight = false;
      }
    }, 2000);

    // If camera track ends (device sleep / permission flip), restart
    try{
      const tracks = stream?.getVideoTracks?.() || [];
      for(const t of tracks){ t.onended = ()=>{ if(isEnabled){ console.warn('[motion-cursor] video track ended, restarting'); stop().then(start); } }; }
    }catch{}
  }

  async function stop(){
    if(restartTimer){ clearTimeout(restartTimer); restartTimer=null; }
    if(watchdogId){ try{ clearInterval(watchdogId); }catch{} watchdogId=null; }
    overlay = document.getElementById('handsfree-overlay');
    if(overlay) overlay.hidden = true;
    if(rafId){ cancelAnimationFrame(rafId); rafId=null; }
    try{ if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } } catch{}
    try{ if(video){ try{ await video.pause(); } catch{} try{ video.srcObject=null; } catch{} video.remove(); } video=null; } catch{}
    try{ if(lastHoverEl){ lastHoverEl.classList.remove('hf-hover'); lastHoverEl=null; } }catch{}
    prevX=null; prevY=null; sendErrorCount=0;
    // Reset gesture state
    pinchDown = false; freeze = false; freezeX = 0; freezeY = 0; lastClick = 0;
    starting=false;
  }

  async function hardRestart(){
    try{
      await stop();
      // Tear down MediaPipe instance to clear any internal stuck state
      try{ await hands?.close?.(); }catch{}
      hands = null;
      // Recreate instance and start fresh
      ensureMediaPipe();
      await start();
    }catch(e){ console.warn('[motion-cursor] hardRestart failed', e); }
  }

  function toggle({ enabled }){
    // Debounce rapid toggles to prevent play() AbortError
    if(restartTimer){ clearTimeout(restartTimer); restartTimer=null; }
    isEnabled = !!enabled;
    if(isEnabled){ restartTimer = setTimeout(()=>{ restartTimer=null; start(); }, 0); }
    else { stop(); }
  }

  function setSensitivity(v){ cfg = mapSensitivity(v); try{ Storage?.setSettings?.({ handsFreeSensitivity: cfg.s }); } catch{} }
  function setPinchSensitivity(v){ pinchCfg = mapPinchSensitivity(v); try{ Storage?.setSettings?.({ handsFreePinchSensitivity: pinchCfg.s }); } catch{} }
  function setMirrorX(v){ mirrorX = !!v; try{ Storage?.setSettings?.({ handsFreeMirrorX: mirrorX }); } catch{} }
  function setDeviceId(id){ deviceId = id || null; try{ Storage?.setSettings?.({ handsFreeDeviceId: deviceId }); } catch{} if(isEnabled){ stop().then(start); } }

  function init(api){ publish=api.publish; subscribe=api.subscribe; subscribe('handsfree:toggle', toggle); }

  window.HandsFree = { init, toggle, setSensitivity, setPinchSensitivity, setDeviceId, setMirrorX };})();
