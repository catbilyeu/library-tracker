(function(){
  let publish=()=>{}; let subscribe=()=>{}; let isEnabled=false;
  let cursor=null; let overlay=null; let video=null; let stream=null; let hands=null;
  let lastClick=0; let hudEl=null; let stopBtn=null; let rafId=null;
  let starting=false; let restartTimer=null;

  // Sensitivity/config
  let deviceId=null; let settingsLoaded=false;
  let prevX=null, prevY=null; let lastFrameTs=null; let fpsAvg=null;

  function mapSensitivity(s){
    s = Math.max(0, Math.min(1, Number(s)||0));
    const deadzone = Math.round(40 - s*35); // px (40 -> 5)
    const alpha = 0.12 + s*(0.40-0.12);     // smoothing (0.12 -> 0.40)
    const debounceMs = Math.round(1200 - s*900); // ms (1200 -> 300)
    const maxStep = 20 + s*25;              // px/frame cap (20 -> 45)
    return { s, deadzone, alpha, debounceMs, maxStep };
  }
  let cfg = mapSensitivity(0.6);

  async function loadSettingsIfNeeded(){
    if(settingsLoaded) return;
    try{
      const s = await Storage.getSettings();
      if(typeof s.handsFreeSensitivity === 'number') cfg = mapSensitivity(s.handsFreeSensitivity);
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
    hudEl.textContent = `${state} • ${fps} fps`;
  }

  function onResults(results){
    if(!isEnabled) return;
    const now = performance.now();
    if(lastFrameTs){ const inst = 1000/(now-lastFrameTs); fpsAvg = fpsAvg? (fpsAvg*0.8 + inst*0.2) : inst; }
    lastFrameTs = now;

    if(!results.multiHandLandmarks || results.multiHandLandmarks.length===0){ updateHUD('No hand'); return; }
    const lm = results.multiHandLandmarks[0];
    const tip = lm[8]; // index fingertip
    const mid6 = lm[6]; const mid10 = lm[10]; const tip12 = lm[12];

    const x = tip.x * window.innerWidth; const y = tip.y * window.innerHeight;
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
    stopBtn = overlay.querySelector('.hf-stop');
    if(!stopBtn){
      stopBtn = document.createElement('button'); stopBtn.type='button'; stopBtn.className='hf-stop'; stopBtn.title='Stop Hands-Free'; stopBtn.setAttribute('aria-label','Stop Hands-Free'); stopBtn.textContent='Stop';
      stopBtn.addEventListener('click', (e)=>{ e.stopPropagation(); publish('handsfree:toggle', { enabled:false }); });
      overlay.appendChild(stopBtn);
    }
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

    const onFrame = async ()=>{ try{ await hands.send({ image: video }); } catch(e){} rafId = requestAnimationFrame(onFrame); };
    rafId = requestAnimationFrame(onFrame);

    Utils.toast('Hands-free is on');
    starting=false;
  }

  async function stop(){
    if(restartTimer){ clearTimeout(restartTimer); restartTimer=null; }
    overlay = document.getElementById('handsfree-overlay');
    if(overlay) overlay.hidden = true;
    if(rafId){ cancelAnimationFrame(rafId); rafId=null; }
    try{ if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } } catch{}
    try{ if(video){ try{ await video.pause(); } catch{} try{ video.srcObject=null; } catch{} video.remove(); } video=null; } catch{}
    starting=false;
  }

  function toggle({ enabled }){
    // Debounce rapid toggles to prevent play() AbortError
    if(restartTimer){ clearTimeout(restartTimer); restartTimer=null; }
    isEnabled = !!enabled;
    if(isEnabled){ restartTimer = setTimeout(()=>{ restartTimer=null; start(); }, 0); }
    else { stop(); }
  }

  function setSensitivity(v){ cfg = mapSensitivity(v); try{ Storage?.setSettings?.({ handsFreeSensitivity: cfg.s }); } catch{} }
  function setDeviceId(id){ deviceId = id || null; try{ Storage?.setSettings?.({ handsFreeDeviceId: deviceId }); } catch{} if(isEnabled){ stop().then(start); } }

  function init(api){ publish=api.publish; subscribe=api.subscribe; subscribe('handsfree:toggle', toggle); }

  window.HandsFree = { init, toggle, setSensitivity, setDeviceId };
})();
