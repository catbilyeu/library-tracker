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

  function mapSensitivity(s){
    s = Math.max(0, Math.min(1, Number(s)||0));
    const deadzone = Math.round(40 - s*35); // px (40 -> 5)
    const alpha = 0.12 + s*(0.40-0.12);     // smoothing (0.12 -> 0.40)
    const debounceMs = Math.round(1200 - s*900); // ms (1200 -> 300)
    const maxStep = 20 + s*25;              // px/frame cap (20 -> 45)
    return { s, deadzone, alpha, debounceMs, maxStep };
  }
  // Default sensitivity set to 25% for steadier cursor
  let cfg = mapSensitivity(0.25);
  // Mirror X by default so cursor follows your hand naturally with a front camera
  let mirrorX = true;

  async function loadSettingsIfNeeded(){
    if(settingsLoaded) return;
    try{
      const s = await Storage.getSettings();
      if(typeof s.handsFreeSensitivity === 'number') cfg = mapSensitivity(s.handsFreeSensitivity);
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

  function onResults(results){
    if(!isEnabled) return;
    const now = performance.now(); lastResultsTs = now;
    if(lastFrameTs){ const inst = 1000/(now-lastFrameTs); fpsAvg = fpsAvg? (fpsAvg*0.8 + inst*0.2) : inst; }
    lastFrameTs = now;

    if(!results.multiHandLandmarks || results.multiHandLandmarks.length===0){ updateHUD('No hand'); return; }
    const lm = results.multiHandLandmarks[0];
    const tip = lm[8]; // index fingertip
    const mid6 = lm[6]; const mid10 = lm[10]; const tip12 = lm[12];

    // Flip X to disable the "opposite movement" effect from non-mirrored camera coordinates
    const normX = mirrorX ? (1 - tip.x) : tip.x;
    const x = Math.max(0, Math.min(window.innerWidth, normX * window.innerWidth));
    const y = Math.max(0, Math.min(window.innerHeight, tip.y * window.innerHeight));
    smoothMove(x,y);

    const open = (tip.y < mid6.y && tip12.y < mid10.y);
    updateHUD(open? 'Open' : 'Closed');

    if(!open && (now - lastClick) > cfg.debounceMs){
      lastClick = now;
      publish('handsfree:click', { x: prevX||x, y: prevY||y });
    }
  }

  function smoothMove(x,y){
    if(!cursor) return;
    if(prevX==null){ prevX=x; prevY=y; }
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
  function setMirrorX(v){ mirrorX = !!v; try{ Storage?.setSettings?.({ handsFreeMirrorX: mirrorX }); } catch{} }
  function setDeviceId(id){ deviceId = id || null; try{ Storage?.setSettings?.({ handsFreeDeviceId: deviceId }); } catch{} if(isEnabled){ stop().then(start); } }

  function init(api){ publish=api.publish; subscribe=api.subscribe; subscribe('handsfree:toggle', toggle); }

  window.HandsFree = { init, toggle, setSensitivity, setDeviceId, setMirrorX };
})();
