(function(){
  let publish=()=>{}; let subscribe=()=>{};
  const elRootId = 'settings-panel';

  function qs(root, sel){ return (root||document).querySelector(sel); }
  function qsa(root, sel){ return Array.from((root||document).querySelectorAll(sel)); }

  async function ensureDeviceLabels(){
    if(!navigator.mediaDevices?.getUserMedia) return;
    try{
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true, video:true });
      // stop tracks immediately
      stream.getTracks().forEach(t=>{ try{ t.stop(); } catch{} });
    }catch(e){ /* user may deny; it's ok */ }
  }

  async function listDevices(){
    try{
      if(!navigator.mediaDevices?.enumerateDevices) return { cams:[], mics:[] };
      try{ await ensureDeviceLabels(); }catch{}
      const devs = await navigator.mediaDevices.enumerateDevices();
      const cams = devs.filter(d=> d.kind === 'videoinput');
      const mics = devs.filter(d=> d.kind === 'audioinput');
      return { cams, mics };
    }catch(e){ return { cams:[], mics:[] }; }
  }

  function option(label, value, selected){
    const opt = document.createElement('option'); opt.value = value||''; opt.textContent = label||'Unknown'; if(selected) opt.selected = true; return opt;
  }

  function repopulateSelect(sel, items, getLabel, getValue, selected){
    if(!sel) return;
    sel.innerHTML = '';
    if(!items || items.length===0){ sel.appendChild(option('No devices found (permission may be required)','',true)); sel.disabled = true; return; }
    items.forEach((it, i)=> sel.appendChild(option(getLabel(it,i), getValue(it), selected && getValue(it)===selected)));
    sel.disabled = false;
    if(!sel.value && items[0]) sel.value = getValue(items[0]);
  }

  function buildUI(settings, devices){
    const root = document.getElementById(elRootId);
    if(!root) return;
    const s = settings || {};
    const { cams=[], mics=[] } = devices || {};
    root.innerHTML = `
      <div class="settings-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="settings-panel">
          <div class="settings-header">
            <div>
              <h2 id="settings-title">Settings</h2>
              <div class="muted">Choose input devices and hands-free sensitivity</div>
            </div>
            <button class="icon close" id="settings-close" aria-label="Close">✕</button>
          </div>
          <div class="settings-body">
            <div class="settings-section">
              <h3>Hands-Free</h3>
              <div class="settings-row">
                <label for="hf-enabled">Enable Hands-Free</label>
                <input id="hf-enabled" type="checkbox" ${s.handsFreeEnabled? 'checked':''} />
              </div>
              <div class="settings-row">
                <label for="hf-mirror">Mirror cursor (recommended for front camera)</label>
                <input id="hf-mirror" type="checkbox" ${s.handsFreeMirrorX!==false? 'checked':''} />
              </div>
              <div class="settings-row">
                <label for="camera-select">Camera</label>
                <select id="camera-select" aria-label="Camera"></select>
              </div>
              <div class="settings-row">
                <label for="hf-sens">Sensitivity</label>
                <div class="range-wrap">
                  <input id="hf-sens" type="range" min="0" max="1" step="0.05" value="${s.handsFreeSensitivity ?? 0.25}" />
                  <span id="hf-sens-value" class="muted">${(Math.round(((s.handsFreeSensitivity ?? 0.25))*100))}%</span>
                </div>
              </div>
            </div>
            <div class="settings-section">
              <h3>Voice</h3>
              <div class="settings-row">
                <label for="voice-enabled">Enable Voice</label>
                <input id="voice-enabled" type="checkbox" ${s.voiceEnabled? 'checked':''} />
              </div>
              <div class="settings-row">
                <label for="mic-select">Microphone</label>
                <select id="mic-select" aria-label="Microphone"></select>
              </div>
            </div>
          </div>
          <div class="settings-actions">
            <button id="settings-cancel">Cancel</button>
            <button id="settings-apply" class="accent">Apply</button>
          </div>
        </div>
      </div>`;

    // Populate selects initially (may be empty; we'll repopulate async)
    const camSel = qs(root, '#camera-select');
    repopulateSelect(camSel, cams, (c,i)=> c.label || `Camera ${i+1}`, (c)=> c.deviceId, s.cameraDeviceId);
    const micSel = qs(root, '#mic-select');
    repopulateSelect(micSel, mics, (m,i)=> m.label || `Microphone ${i+1}`, (m)=> m.deviceId, s.micDeviceId);

    // Sens value live
    const sens = qs(root, '#hf-sens'); const sensVal = qs(root, '#hf-sens-value');
    sens.addEventListener('input', ()=>{ sensVal.textContent = `${Math.round(+sens.value*100)}%`; });

    // Wire buttons
    qs(root, '#settings-close').addEventListener('click', close);
    qs(root, '#settings-cancel').addEventListener('click', close);
    qs(root, '#settings-apply').addEventListener('click', async ()=>{
      const next = {
        handsFreeEnabled: qs(root,'#hf-enabled').checked,
        voiceEnabled: qs(root,'#voice-enabled').checked,
        cameraDeviceId: camSel.value || '',
        micDeviceId: micSel.value || '',
        handsFreeSensitivity: parseFloat(sens.value),
        handsFreeMirrorX: qs(root,'#hf-mirror').checked
      };
      try{
        const saved = await window.Storage.setSettings(next);
    // Publish toggles AFTER applying device/sensitivity to avoid start/stop race conditions
        try{ window.HandsFree?.setDeviceId?.(saved.cameraDeviceId); } catch{}
        try{ window.Voice?.setMicDeviceId?.(saved.micDeviceId); } catch{}
        try{ window.HandsFree?.setSensitivity?.(saved.handsFreeSensitivity); } catch{}
        try{ window.HandsFree?.setMirrorX?.(saved.handsFreeMirrorX!==false); } catch{}
        try{ publish('handsfree:toggle', { enabled: !!saved.handsFreeEnabled }); } catch{}
        try{ publish('voice:toggle', { enabled: !!saved.voiceEnabled }); } catch{}
        // Reflect state on header toggles if present
        const hfBtn = document.getElementById('toggle-handsfree'); if(hfBtn) hfBtn.setAttribute('aria-pressed', String(!!saved.handsFreeEnabled));
        const vBtn = document.getElementById('toggle-voice'); if(vBtn) vBtn.setAttribute('aria-pressed', String(!!saved.voiceEnabled));
        Utils.toast('Settings applied', { type:'ok' });
        close();
      }catch(e){ console.error(e); Utils.toast('Failed to save settings', { type:'error' }); }
    });

    // Escape to close
    const onKey = (e)=>{ if(e.key==='Escape'){ e.preventDefault(); close(); }};
    root.dataset.keyHandler = 'true';
    document.addEventListener('keydown', onKey, { once:true });
  }

  async function open(){
    const root = document.getElementById(elRootId); if(!root) return;
    root.hidden = false;
    let settings = {};
    try{ settings = await window.Storage.getSettings(); } catch{}
    // Render immediately with no devices; then populate asynchronously
    try{ buildUI(settings, { cams:[], mics:[] }); } catch(e){ console.error('Settings build failed', e); Utils.toast('Failed to render Settings', { type:'error' }); }
    // Populate devices after render
    try{
      const devices = await listDevices();
      const camSel = root.querySelector('#camera-select');
      const micSel = root.querySelector('#mic-select');
      repopulateSelect(camSel, devices.cams, (c,i)=> c.label || `Camera ${i+1}`, (c)=> c.deviceId, settings.cameraDeviceId);
      repopulateSelect(micSel, devices.mics, (m,i)=> m.label || `Microphone ${i+1}`, (m)=> m.deviceId, settings.micDeviceId);
    } catch(e){ console.error('Device populate failed', e); }
  }

  function close(){ const root = document.getElementById(elRootId); if(!root) return; root.hidden = true; root.innerHTML = ''; }

  // Expose simple apply passthrough for any external callers
  async function apply(settings){
    const saved = await window.Storage.setSettings(settings||{});
    publish('handsfree:toggle', { enabled: !!saved.handsFreeEnabled });
    publish('voice:toggle', { enabled: !!saved.voiceEnabled });
  }

  function init(api){ publish=api.publish; subscribe=api.subscribe; }

  window.Settings = { init, open, close, apply };
})();
