// app_perf_optimized.js — HEIC faster: objectURL, createImageBitmap, toBlob, sequential queue
(function(){
  const $ = s => document.querySelector(s);
  const drop = $('#drop'), fi = $('#fileInput'), grid = $('#grid');
  const go = $('#go'), clr = $('#clr');
  const resizePct = $('#resizePct');

  // Accept HEIC/HEIF too
  if (fi && !/heic|heif/i.test(fi.accept||"")) {
    fi.setAttribute('accept','image/heic,image/heif,image/heif-sequence,image/heic-sequence,image/jpeg,image/png');
  }

  // Helpers --------------------------------------------------
  const hasCreateImageBitmap = 'createImageBitmap' in window;
  function objURL(fileOrBlob){ return URL.createObjectURL(fileOrBlob); }
  function revoke(u){ if(u) URL.revokeObjectURL(u); }

  async function loadBitmapOrImage(src, resizeW=0, resizeH=0){
    if (hasCreateImageBitmap){
      const opts = {};
      if (resizeW>0) opts.resizeWidth = resizeW;
      if (resizeH>0) opts.resizeHeight = resizeH;
      return await createImageBitmap(await fetch(src).then(r=>r.blob()), { colorSpaceConversion:'default', premultiplyAlpha:'default', ...opts });
    } else {
      // fallback to <img>
      return await new Promise((res,rej)=>{
        const img = new Image();
        img.onload = ()=>res(img);
        img.onerror = rej;
        img.src = src;
      });
    }
  }

  function get2d(c){
    const ctx = c.getContext('2d', {alpha:true});
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return ctx;
  }

  // Conversion queue (sequential to avoid blocking UI)
  const queue = [];
  let working = false;
  function enqueue(task){ return new Promise((resolve,reject)=>{
    queue.push({ task, resolve, reject });
    pump();
  });}
  async function pump(){
    if (working) return;
    working = true;
    while(queue.length){
      const {task, resolve, reject} = queue.shift();
      try { resolve(await task()); }
      catch(e){ reject(e); }
      await new Promise(r=>setTimeout(r, 0)); // yield
    }
    working = false;
  }

  function isHeic(f){
    const n=(f.name||'').toLowerCase(), t=(f.type||'').toLowerCase();
    return n.endsWith('.heic') || n.endsWith('.heif') || t.includes('heic') || t.includes('heif');
  }

  async function convertHeicToJpeg(f){
    // lower initial conversion quality to speed things up
    const converted = await heic2any({ blob: f, toType: 'image/jpeg', quality: 0.82 });
    return Array.isArray(converted) ? converted[0] : converted;
  }

  let files = [];
  drop?.addEventListener('click', ()=> fi?.click());
  ['dragenter','dragover'].forEach(evn=> drop?.addEventListener(evn, e=>{e.preventDefault();drop.classList.add('dragging');}));
  ;['dragleave','drop'].forEach(evn=> drop?.addEventListener(evn, e=>{e.preventDefault();drop.classList.remove('dragging');}));
  drop?.addEventListener('drop', e=> handleFiles(e.dataTransfer.files));
  fi?.addEventListener('change', e=> handleFiles(e.target.files));

  async function handleFiles(list){
    files = Array.from(list||[]);
    grid.innerHTML = '';
    for (const f of files){
      const card = document.createElement('div'); card.className='card';
      card.innerHTML = `<div class="spinner"></div><div class="meta"><span>${f.name}</span></div>`;
      grid.appendChild(card);

      try {
        // Convert HEIC sequentially via queue to prevent main thread spikes
        let blob = f;
        if (isHeic(f)){
          blob = await enqueue(()=>convertHeicToJpeg(f));
        }
        // Lightweight thumbnail: decode with createImageBitmap at small size
        const url = objURL(blob);
        const maxThumb = 480;
        const bmp = await loadBitmapOrImage(url); // get dimensions
        const scale = Math.min(1, maxThumb / Math.max(bmp.width||bmp.naturalWidth, bmp.height||bmp.naturalHeight));
        const thumbW = Math.round((bmp.width||bmp.naturalWidth) * scale);
        const thumbH = Math.round((bmp.height||bmp.naturalHeight) * scale);
        // Re-load resized if supported
        const bmp2 = hasCreateImageBitmap ? await loadBitmapOrImage(url, thumbW, thumbH) : bmp;
        const cvs = document.createElement('canvas'); cvs.width = thumbW; cvs.height = thumbH;
        const ctx = get2d(cvs);
        ctx.drawImage(bmp2, 0, 0, thumbW, thumbH);
        card.innerHTML = ''; card.appendChild(cvs);
        const meta = document.createElement('div'); meta.className='meta';
        meta.innerHTML = `<span>${f.name}</span>`;
        card.appendChild(meta);
        revoke(url);
      } catch(e){
        console.error(e);
        card.querySelector('.spinner')?.remove();
        const m = card.querySelector('.meta') || document.createElement('div');
        m.className='meta'; m.innerHTML = `<span>Gagal memuat: ${f.name}</span>`;
        card.appendChild(m);
      }
      await new Promise(r=>requestAnimationFrame(r)); // keep UI responsive
    }
  }

  clr?.addEventListener('click', ()=>{ files=[]; if(fi) fi.value=''; grid.innerHTML=''; });

  go?.addEventListener('click', async ()=>{
    if(!files.length){ alert('Pilih minimal satu gambar.'); return; }
    grid.innerHTML = '';
    for (const f of files){
      const fig = await processOne(f);
      grid.appendChild(fig);
      await new Promise(r=>requestAnimationFrame(r));
    }
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });

  async function processOne(file){
    // 1) Ensure JPEG (HEIC -> JPEG) using queued convert to avoid spikes
    let blob = file;
    if (isHeic(file)) blob = await enqueue(()=>convertHeicToJpeg(file));

    // 2) Decode source quickly via objectURL + createImageBitmap
    const srcURL = objURL(blob);
    const bmp = await loadBitmapOrImage(srcURL);
    const srcW = bmp.width || bmp.naturalWidth, srcH = bmp.height || bmp.naturalHeight;

    // 3) Base resize cap for performance (lower than before)
    const baseMaxSide = 2048; // lower cap => faster & smaller
    let W = srcW, H = srcH;
    if (Math.max(W,H) > baseMaxSide){
      const s = baseMaxSide / Math.max(W,H);
      W = Math.round(W * s); H = Math.round(H * s);
    }

    // 4) Render & watermark to canvas
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = get2d(canvas);
    ctx.drawImage(bmp, 0, 0, W, H);

    // Optional: obtain UI controls if present
    const tTop = window.tTop, tCtr = window.tCtr, tBot = window.tBot;
    const fTop = window.fTop, fCtr = window.fCtr, fBot = window.fBot;
    const sTop = window.sTop, sCtr = window.sCtr, sBot = window.sBot;
    const cTop = window.cTop, cCtr = window.cCtr, cBot = window.cBot;
    const oTop = window.oTop, oCtr = window.oCtr, oBot = window.oBot;
    const mTop = window.mTop, mCtr = window.mCtr, mBot = window.mBot;

    function drawText(text, size, font, color, alpha, x, y, baseline){
      if (!text) return;
      ctx.save();
      ctx.globalAlpha = Number(alpha||1);
      ctx.fillStyle = color || '#ffffff';
      ctx.font = `${Number(size)||40}px ${font||'Inter, system-ui, Arial'}`;
      ctx.textBaseline = baseline || 'alphabetic';
      ctx.fillText(text, x, y);
      ctx.restore();
    }

    // Top
    let text = tTop?.value || '';
    if (text){
      ctx.font = `${Number(sTop?.value)||40}px ${fTop?.value||'Inter, system-ui, Arial'}`;
      const w = ctx.measureText(text).width;
      drawText(text, sTop?.value, fTop?.value, cTop?.value, oTop?.value, (W - w)/2, Math.max(0, Number(mTop?.value||120)), 'top');
    }
    // Center
    text = tCtr?.value || '';
    if (text){
      ctx.font = `${Number(sCtr?.value)||72}px ${fCtr?.value||'Inter, system-ui, Arial'}`;
      const w = ctx.measureText(text).width;
      drawText(text, sCtr?.value, fCtr?.value, cCtr?.value, oCtr?.value, (W - w)/2, (H/2) + Number(mCtr?.value||0), 'middle');
    }
    // Bottom
    text = tBot?.value || '';
    if (text){
      ctx.font = `${Number(sBot?.value)||48}px ${fBot?.value||'Inter, system-ui, Arial'}`;
      const w = ctx.measureText(text).width;
      drawText(text, sBot?.value, fBot?.value, cBot?.value, oBot?.value, (W - w)/2, H - Math.max(0, Number(mBot?.value||80)), 'bottom');
    }

    // 5) Optional UI downscale
    const pct = Math.min(100, Math.max(10, Number(resizePct?.value||100))) / 100;
    let outCanvas = canvas;
    if (pct < 0.999){
      const c2 = document.createElement('canvas');
      c2.width = Math.round(canvas.width * pct);
      c2.height = Math.round(canvas.height * pct);
      const c2x = get2d(c2);
      c2x.drawImage(canvas, 0, 0, c2.width, c2.height);
      outCanvas = c2;
    }

    // 6) Adaptive quality & async encode via toBlob (non-blocking)
    const longSide = Math.max(outCanvas.width, outCanvas.height);
    const q = longSide >= 5000 ? 0.64 : longSide >= 4000 ? 0.68 : longSide >= 3000 ? 0.72 : longSide >= 2000 ? 0.8 : 0.86;

    const blobOut = await new Promise(res=> outCanvas.toBlob(res, 'image/jpeg', q));
    const urlOut = objURL(blobOut);

    // 7) Card UI
    const fig = document.createElement('div'); fig.className='card';
    const thumb = document.createElement('canvas');
    const s = Math.min(720, outCanvas.width);
    const sc = s / outCanvas.width;
    thumb.width = s; thumb.height = Math.round(outCanvas.height * sc);
    const tctx = get2d(thumb);
    tctx.drawImage(outCanvas, 0, 0, thumb.width, thumb.height);

    const meta = document.createElement('div'); meta.className='meta';
    const a = document.createElement('a'); a.textContent = 'Download';
    a.href = urlOut;
    a.download = `${file.name.replace(/\.[^.]+$/,'')}-story.jpg`;

    meta.appendChild(document.createElement('span')).textContent = a.download;
    meta.appendChild(a);
    fig.appendChild(thumb); fig.appendChild(meta);

    revoke(srcURL);
    // NOTE: don't revoke urlOut until user downloads
    return fig;
  }
})();
