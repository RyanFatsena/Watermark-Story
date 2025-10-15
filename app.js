(function(){

  function get2d(ctxCanvas){
    let ctx;
    try {
      ctx = ctxCanvas.getContext('2d', { alpha: true, colorSpace: 'display-p3' });
    } catch(e){
      ctx = ctxCanvas.getContext('2d', { alpha: true });
    }
    if(ctx){ ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; }
    return ctx;
  }

  // Multi-step downscale to preserve detail (approximates Lanczos)
  function downscaleCanvas(srcCanvas, targetW, targetH){
    let cur = srcCanvas;
    let curW = cur.width, curH = cur.height;
    if (targetW >= curW && targetH >= curH){
      // no upscale here; just return original
      return cur;
    }
    // iterative downscale by 0.5 until near target
    while (curW * 0.5 > targetW && curH * 0.5 > targetH){
      const tmp = document.createElement('canvas');
      tmp.width = Math.round(curW * 0.5);
      tmp.height = Math.round(curH * 0.5);
      const tctx = get2d(tmp);
      tctx.drawImage(cur, 0, 0, tmp.width, tmp.height);
      cur = tmp;
      curW = cur.width; curH = cur.height;
    }
    // final draw to exact target
    const out = document.createElement('canvas');
    out.width = targetW; out.height = targetH;
    const octx = get2d(out);
    octx.drawImage(cur, 0, 0, out.width, out.height);
    return out;
  }

  // Mild unsharp mask-like sharpen
  function sharpenCanvas(srcCanvas, amount=0.35){
    // Convolution kernel: simple sharpen
    const w = srcCanvas.width, h = srcCanvas.height;
    // Skip if too large for performance
    if (w*h > 9_000_000) return srcCanvas; // >9MP, skip
    const ctx = get2d(srcCanvas);
    const img = ctx.getImageData(0,0,w,h);
    const data = img.data;
    const copy = new Uint8ClampedArray(data);

    const weights = [0,-1,0,-1,5,-1,0,-1,0];
    const side = 3;
    const half = Math.floor(side/2);

    function idx(x,y){ return (y*w + x) * 4; }
    for(let y=half; y<h-half; y++){
      for(let x=half; x<w-half; x++){
        let r=0,g=0,b=0;
        let i=0;
        for(let ky=-half; ky<=half; ky++){
          for(let kx=-half; kx<=half; kx++){
            const di = idx(x+kx, y+ky);
            const wt = weights[i++];
            r += copy[di] * wt;
            g += copy[di+1] * wt;
            b += copy[di+2] * wt;
          }
        }
        const oi = idx(x,y);
        data[oi]   = Math.max(0, Math.min(255, (1-amount)*copy[oi]   + amount*r));
        data[oi+1] = Math.max(0, Math.min(255, (1-amount)*copy[oi+1] + amount*g));
        data[oi+2] = Math.max(0, Math.min(255, (1-amount)*copy[oi+2] + amount*b));
        // alpha unchanged
      }
    }
    ctx.putImageData(img,0,0);
    return srcCanvas;
  }

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const drop = $('#drop'), fi = $('#fileInput'), grid = $('#grid');
  const go = $('#go'), clr = $('#clr');
  const preset = $('#preset'); const resizePct = $('#resizePct');

  let files = [];

  drop.addEventListener('click', ()=> fi.click());
  ['dragenter','dragover'].forEach(evn=> drop.addEventListener(evn, e=>{e.preventDefault();drop.style.opacity=0.85;}));
  ;['dragleave','drop'].forEach(evn=> drop.addEventListener(evn, e=>{e.preventDefault();drop.style.opacity=1;}));
  drop.addEventListener('drop', e=> handleFiles(e.dataTransfer.files));
  fi.addEventListener('change', e=> handleFiles(e.target.files));

  function handleFiles(list){
    files = Array.from(list).filter(f=>f.type.startsWith('image/'));
    grid.innerHTML='';
    files.forEach(async f=>{
      const img = await loadImage(await readAsDataURL(f));
      const card = document.createElement('div'); card.className='card';
      const canvas = document.createElement('canvas'); const ctx = get2d(canvas);
      const [W,H] = getWH();
      canvas.width = Math.min(W, 480); // small thumb for preview
      canvas.height = Math.round(canvas.width * (H/W));
      ctx.fillStyle = '#000'; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img,0,0,canvas.width,canvas.height); // rough preview
      card.appendChild(canvas);
      const meta = document.createElement('div'); meta.className='meta';
      meta.innerHTML = `<span>${f.name}</span>`;
      card.appendChild(meta);
      grid.appendChild(card);
    });
  }

  clr.addEventListener('click', ()=>{ files=[]; fi.value=''; grid.innerHTML=''; });

  go.addEventListener('click', async ()=>{
    if(files.length===0){ alert('Pilih minimal satu gambar.'); return; }
    grid.innerHTML='';
    for(const file of files){
      const fig = await processOne(file);
      grid.appendChild(fig);
    }
    window.scrollTo({top:document.body.scrollHeight, behavior:'smooth'});
  });

  function getWH(){
    const [w,h] = preset.value.split('x').map(Number);
    return [w,h];
  }

  
  async function processOne(file){
    // Load original image
    const img = await loadImage(await readAsDataURL(file));

    // ===== HD-efficient sizing =====
    // Limit longest side to maxSide to save memory, keep aspect ratio
    const maxSide = 2560;
    let W = img.width, H = img.height;
    if (W > maxSide || H > maxSide){
      const scale = Math.min(maxSide / W, maxSide / H);
      W = Math.round(W * scale);
      H = Math.round(H * scale);
    }

    // Canvas for full-resolution composition
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = get2d(canvas);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw base image (fit to canvas, no crop)
    ctx.drawImage(img, 0, 0, W, H);

    // ===== Draw Watermark Texts (Top, Center, Bottom) =====
    // TOP
    ctx.globalAlpha = Number(oTop?.value||1);
    ctx.fillStyle = cTop?.value||'#fff';
    ctx.font = `${Number(sTop?.value)||40}px ${fTop?.value||'Inter, system-ui, Arial'}`;
    ctx.textBaseline = 'top';
    const m1 = ctx.measureText(tTop?.value||''); const tw1 = m1.width;
    const x1 = (W - tw1)/2, y1 = Math.max(0, Number(mTop?.value||120));
    
    ctx.fillText(tTop?.value||'', x1, y1);

    // CENTER
    ctx.globalAlpha = Number(oCtr?.value||1);
    ctx.fillStyle = cCtr?.value||'#fff';
    ctx.font = `${Number(sCtr?.value)||72}px ${fCtr?.value||'Inter, system-ui, Arial'}`;
    ctx.textBaseline = 'middle';
    const mC = ctx.measureText(tCtr?.value||''); const twC = mC.width;
    const xC = (W - twC)/2, yC = (H/2) + Number(mCtr?.value||0);
    
    ctx.fillText(tCtr?.value||'', xC, yC);

    // BOTTOM
    ctx.globalAlpha = Number(oBot?.value||1);
    ctx.fillStyle = cBot?.value||'#fff';
    ctx.font = `${Number(sBot?.value)||48}px ${fBot?.value||'Inter, system-ui, Arial'}`;
    ctx.textBaseline = 'bottom';
    const mB = ctx.measureText(tBot?.value||''); const twB = mB.width;
    const xB = (W - twB)/2, yB = Math.max(0, Number(mBot?.value||80));
    const yBpos = H - yB;
    
    ctx.fillText(tBot?.value||'', xB, yBpos);

    // Reset alpha
    ctx.globalAlpha = 1;

    // ===== Build card with preview (thumb) =====
    const fig = document.createElement('div'); fig.className='card';
    const thumb = document.createElement('canvas');
    const s = Math.min(720, W);
    const sca = s/W;
    thumb.width = s; thumb.height = Math.round(H*sca);
    const tctx = get2d(thumb);
    tctx.imageSmoothingEnabled = true; tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(canvas,0,0,thumb.width,thumb.height);

    const meta = document.createElement('div'); meta.className='meta';
    const outExt = 'jpg';
    const a = document.createElement('a'); a.textContent = 'Download';

    // ===== Export JPG (allow downscale if user wants) =====
    (function(){
      const pct = Math.min(100, Math.max(10, Number(resizePct?.value||100)))/100;
      if(pct >= 0.999){
        a.href = canvas.toDataURL('image/jpeg', 1.0);
      } else {
        const out = document.createElement('canvas');
        out.width = Math.round(canvas.width * pct);
        out.height = Math.round(canvas.height * pct);
        const octx = get2d(out);
        octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = 'high';
        octx.drawImage(canvas, 0, 0, out.width, out.height);
        a.href = out.toDataURL('image/jpeg', 1.0);
      }
    })();

    const base = file.name.replace(/\.[^.]+$/,'') + '-story';
    a.download = `${base}.${outExt}`;
    meta.appendChild(document.createElement('span')).textContent = a.download;
    meta.appendChild(a);

    fig.appendChild(thumb); fig.appendChild(meta);
    return fig;
  }

  function readAsDataURL(file){
    return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); });
  }
  function loadImage(src){
    return new Promise((res,rej)=>{ const img=new Image(); img.onload=()=>res(img); img.onerror=rej; img.src=src; });
  }
})();
