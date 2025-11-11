(function(){
  let publish=()=>{}; let subscribe=()=>{};
  let running=false; let rafId=null; let pauseUntil=0;
  let deviceId=null; let facing='environment'; let torchOn=false;
  let usingNative=false; // BarcodeDetector vs ZXing
  let video=null; let stream=null;
  let zxingReader=null; let zxingControls=null; let zxingModule=null; let cameraList=[]; let currentCamIdx=-1;

  const overlay = ()=> document.getElementById('scanner-overlay');

  function validateEANToISBN13(code){
    const d = Utils.normalizeDigits(code||'');
    if(!/^97[89]\d{10}$/.test(d)) return null;
    return Utils.isValidISBN13(d)? d : null;
  }

  function buildOverlay(){
    overlay().hidden=false;
    overlay().innerHTML = `
      <div class="panel" style="position:fixed;inset:0;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;z-index:1500">
        <div id="scanner-target" class="scanner-target" style="position:relative"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:92vw">
          <button id="btn-cancel-scan" class="danger">Exit</button>
          <button id="btn-switch-cam">Switch Camera</button>
          <button id="btn-flashlight">Flashlight</button>
        </div>
      </div>`;
    const target = document.getElementById('scanner-target');
    video = document.createElement('video');
    video.id = 'scan-video';
    video.setAttribute('playsinline','');
    video.setAttribute('autoplay','');
    video.muted = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain';
    target.appendChild(video);

    document.getElementById('btn-cancel-scan').onclick = close;
    document.getElementById('btn-switch-cam').onclick = switchCamera;
    document.getElementById('btn-flashlight').onclick = async (e)=>{
      const ok = await toggleTorch();
      e.target.textContent = ok && torchOn ? 'Flashlight: On' : 'Flashlight';
    };

    setupGuides();
  }

  function setupGuides(){
    const target = document.getElementById('scanner-target'); if(!target) return;
    const guide = document.createElement('div'); guide.className = 'roi-overlay'; guide.innerHTML = `
      <style>
        .roi-overlay{position:absolute;inset:0;pointer-events:none}
        .roi-window{position:absolute;left:15%;right:15%;top:20%;bottom:20%;border:2px solid rgba(79,163,255,.9);border-radius:8px;box-shadow:0 0 0 9999px rgba(0,0,0,.35)}
        .roi-br{position:absolute;width:24px;height:24px;border:3px solid rgba(79,163,255,.9)}
        .roi-br.tl{left:calc(15% - 3px);top:calc(20% - 3px);border-right:none;border-bottom:none;border-radius:8px 0 0 0}
        .roi-br.tr{right:calc(15% - 3px);top:calc(20% - 3px);border-left:none;border-bottom:none;border-radius:0 8px 0 0}
        .roi-br.bl{left:calc(15% - 3px);bottom:calc(20% - 3px);border-right:none;border-top:none;border-radius:0 0 0 8px}
        .roi-br.br{right:calc(15% - 3px);bottom:calc(20% - 3px);border-left:none;border-top:none;border-radius:0 0 8px 0}
        .roi-hint{position:absolute;left:50%;transform:translateX(-50%);bottom:8%;color:#e6eef8;background:rgba(0,0,0,.5);padding:4px 8px;border-radius:6px;font-size:12px}
      </style>
      <div class="roi-window"></div>
      <div class="roi-br tl"></div><div class="roi-br tr"></div><div class="roi-br bl"></div><div class="roi-br br"></div>
      <div class="roi-hint">Align the barcode inside the box</div>`;
    target.appendChild(guide);
  }

  async function listCameras(){
    try{
      await navigator.mediaDevices.getUserMedia({ video:true, audio:false }).then(s=> s.getTracks().forEach(t=>t.stop()));
    }catch{}
    try{
      const devs = await navigator.mediaDevices.enumerateDevices();
      cameraList = devs.filter(d=> d.kind==='videoinput');
    }catch{ cameraList = []; }
    return cameraList;
  }

  async function setVideoStream(constraints){
    try{ if(stream){ stream.getTracks().forEach(t=> t.stop()); } }catch{}
    stream = null;
    const c = { audio:false, video: constraints };
    stream = await navigator.mediaDevices.getUserMedia(c);
    video.srcObject = stream; await video.play();
    return stream;
  }

  function getActiveVideoTrack(){
    try{ return (video?.srcObject?.getVideoTracks?.()||[])[0] || null; }catch{ return null; }
  }

  async function toggleTorch(){
    try{
      const track = getActiveVideoTrack(); if(!track) return false;
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if(!caps.torch){ Utils.toast('Flashlight not supported on this device', { type:'info' }); return false; }
      torchOn = !torchOn; await track.applyConstraints({ advanced: [{ torch: torchOn }] }); return true;
    }catch(e){ console.warn('[scanner] Torch toggle failed', e); Utils.toast('Flashlight not available', { type:'info' }); return false; }
  }

  async function tryBarcodeDetector(){
    // Prefer native BarcodeDetector
    if(typeof window.BarcodeDetector !== 'function') return false;
    let formats=[]; try{ formats = await window.BarcodeDetector.getSupportedFormats?.(); }catch{}
    const preferred = ['ean_13','ean_8','upc_a','isbn'];
    const useFormats = (formats && formats.length) ? preferred.filter(f=> formats.includes(f)) : ['ean_13'];
    // @ts-ignore
    const detector = new window.BarcodeDetector({ formats: useFormats });

    const attempts = [];
    if(deviceId) attempts.push({ deviceId:{ exact: deviceId }, width:{ideal:1280}, height:{ideal:720} });
    attempts.push(
      { facingMode:{ ideal:'environment' }, width:{ideal:1280}, height:{ideal:720} },
      { facingMode:{ ideal:'user' }, width:{ideal:1280}, height:{ideal:720} },
      { width:{ideal:1280}, height:{ideal:720} },
      true // any video
    );

    for(const a of attempts){
      try{
        const constraints = a===true ? true : a;
        await setVideoStream(constraints);
        usingNative = true; running = true; pauseUntil=0;
        const loop = async ()=>{
          if(!running || !usingNative) return;
          const now = Date.now(); if(now < pauseUntil){ rafId = requestAnimationFrame(loop); return; }
          try{
            const codes = await detector.detect(video);
            if(codes && codes.length){
              const text = codes[0]?.rawValue || codes[0]?.raw || '';
              const isbn = validateEANToISBN13(text);
              if(isbn){
                onDetectedIsbn(isbn); return; // close will stop loop
              }
            }
          }catch{}
          rafId = requestAnimationFrame(loop);
        };
        loop();
        console.info('[scanner] Using BarcodeDetector with formats', useFormats);
        return true;
      }catch(e){ console.warn('[scanner] BarcodeDetector stream init failed, next attempt', e?.name||e); try{ stream?.getTracks()?.forEach(t=>t.stop()); }catch{} }
    }
    return false;
  }

  async function tryZXing(){
    try{
      if(!zxingModule){ zxingModule = await import('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.1/esm/index.min.js'); }
      const { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } = zxingModule;
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.CODE_128,
      ]);
      zxingReader = new BrowserMultiFormatReader(hints);
      // Preload device list for switching
      try{ cameraList = await BrowserMultiFormatReader.listVideoInputDevices(); }catch{ cameraList = []; }
      // Choose deviceId if provided
      let initialDeviceId = deviceId || (cameraList[0]?.deviceId);
      if(initialDeviceId){ currentCamIdx = Math.max(0, cameraList.findIndex(d=> d.deviceId===initialDeviceId)); }
      zxingControls = await zxingReader.decodeFromVideoDevice(
        initialDeviceId,
        video,
        (result, err, controls)=>{
          if(result){ const text = result.getText(); const isbn = validateEANToISBN13(text); if(isbn){ onDetectedIsbn(isbn); } }
          // ignore NotFound errors during scanning
        }
      );
      usingNative = false; running = true;
      console.info('[scanner] Using ZXing fallback');
      return true;
    }catch(e){ console.warn('[scanner] ZXing init failed', e); return false; }
  }

  async function switchCamera(){
    try{
      if(usingNative){
        // Toggle facing, rebuild stream
        facing = (facing==='environment')? 'user' : 'environment';
        await setVideoStream({ facingMode:{ ideal: facing }, width:{ideal:1280}, height:{ideal:720} });
        return;
      }
      // ZXing: cycle through devices
      if(!zxingReader || !zxingModule){ return; }
      const { BrowserMultiFormatReader } = zxingModule;
      if(!cameraList || cameraList.length===0){ cameraList = await BrowserMultiFormatReader.listVideoInputDevices(); }
      if(cameraList.length===0){ return; }
      currentCamIdx = (currentCamIdx + 1) % cameraList.length;
      const nextId = cameraList[currentCamIdx].deviceId;
      // Stop previous controls before switching
      try{ zxingControls?.stop?.(); }catch{}
      zxingControls = await zxingReader.decodeFromVideoDevice(
        nextId,
        video,
        (result, err, controls)=>{
          if(result){ const text = result.getText(); const isbn = validateEANToISBN13(text); if(isbn){ onDetectedIsbn(isbn); } }
        }
      );
    }catch(e){ console.warn('[scanner] switchCamera failed', e); }
  }

  function onDetectedIsbn(isbn){
    console.info('[scanner] Detected ISBN13', isbn);
    try{ pauseUntil = Date.now() + 2000; }catch{}
    publish('scanner:detected', { isbn13: isbn });
    close();
  }

  async function open({ deviceId:did }={}){
    if(running) return; running=true;
    // Prefer saved camera from Settings if available
    try{ const s = await window.Storage.getSettings(); if(s?.cameraDeviceId) deviceId = s.cameraDeviceId; }catch{}
    deviceId = did || deviceId || null;
    buildOverlay();

    // Try native first, else ZXing
    const okNative = await tryBarcodeDetector();
    if(!okNative){
      const okZX = await tryZXing();
      if(!okZX){ Utils.toast('Unable to start scanner', { type:'error' }); close(); return; }
    }
  }

  async function stopStreams(){
    try{ if(rafId){ cancelAnimationFrame(rafId); rafId=null; } }catch{}
    try{ if(zxingControls && typeof zxingControls.stop==='function'){ zxingControls.stop(); } }catch{}
    try{ if(zxingReader && typeof zxingReader.reset==='function'){ zxingReader.reset(); } }catch{}
    zxingControls=null; zxingReader=null;
    try{ if(stream){ stream.getTracks().forEach(t=>t.stop()); } }catch{}
    stream=null;
  }

  function close(){
    if(!running) return;
    running=false; usingNative=false; pauseUntil=0; torchOn=false;
    stopStreams().finally(()=>{
      overlay().hidden=true; overlay().innerHTML='';
      publish('scanner:close',{});
    });
  }

  function init(api){ publish=api.publish; subscribe=api.subscribe; subscribe('scanner:open', open); }

  window.Scanner = { init, open, close };
})();
