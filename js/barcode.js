(function(){
  let publish=()=>{}; let subscribe=()=>{}; let running=false; let lastTime=0; let deviceId=null;
  const overlay = ()=> document.getElementById('scanner-overlay');

  function validateEANToISBN13(code){
    const d = Utils.normalizeDigits(code);
    if(!/^97[89]\d{10}$/.test(d)) return null;
    return Utils.isValidISBN13(d)? d : null;
  }

  function open({ deviceId:did }={}){
    if(running) return; running=true; deviceId = did || deviceId || null; overlay().hidden=false; overlay().innerHTML = `<div class="panel" style="position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;z-index:1500">
      <div id="scanner-target" class="scanner-target" style="position:relative"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:92vw">
        <button id="btn-cancel-scan" class="danger">Exit</button>
        <button id="btn-switch-cam">Switch Camera</button>
      </div>
    </div>`;

    document.getElementById('btn-cancel-scan').onclick = close;
    document.getElementById('btn-switch-cam').onclick = ()=>{
      // Try to toggle facingMode if no explicit deviceId
      try { Quagga.stop(); } catch{}
      const constraints = (!deviceId)? { facingMode: 'user' } : { deviceId: { exact: deviceId } };
      Quagga.init({
        inputStream: { type:'LiveStream', constraints: { ...constraints }, target: document.getElementById('scanner-target') },
        decoder: { readers: ['ean_reader'] },
        locate: true
      }, function(err){ if(err){ console.error(err); Utils.toast('Scanner error', {type:'error'}); close(); return; } Quagga.start(); });
      Quagga.onDetected(onDetected);
    };

    const constraints = deviceId? { deviceId: { exact: deviceId } } : { facingMode: 'environment' };
    Quagga.init({
      inputStream: { type:'LiveStream', constraints: { ...constraints }, target: document.getElementById('scanner-target') },
      decoder: { readers: ['ean_reader'] },
      locate: true
    }, function(err){ if(err){ console.error(err); Utils.toast('Scanner error', {type:'error'}); close(); return; } Quagga.start(); });

    Quagga.onDetected(onDetected);
  }

  function onDetected(result){
    const now=Date.now(); if(now-lastTime<1500) return; lastTime=now;
    const code = result?.codeResult?.code; const isbn = validateEANToISBN13(code);
    if(!isbn){ return; }
    Quagga.offDetected(onDetected); Quagga.stop(); publish('scanner:detected', { isbn13: isbn }); close();
  }

  function close(){ if(!running) return; try{ Quagga.offDetected(onDetected); Quagga.stop(); } catch{} running=false; overlay().hidden=true; overlay().innerHTML=''; publish('scanner:close',{}); }

  function init(api){ publish=api.publish; subscribe=api.subscribe; subscribe('scanner:open', open); }

  window.Scanner = { init, open, close };
})();
