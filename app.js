// app_fix_heic.js — versi dengan dukungan HEIC/HEIF otomatis
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

  function readAsDataURL(file){
    return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); });
  }
  function loadImage(src){
    return new Promise((res,rej)=>{ const img=new Image(); img.onload=()=>res(img); img.onerror=rej; img.src=src; });
  }

  const $ = s => document.querySelector(s);
  const drop = $('#drop'), fi = $('#fileInput'), grid = $('#grid');
  const go = $('#go'), clr = $('#clr');
  const preset = $('#preset'); const resizePct = $('#resizePct');
  let files = [];

  drop.addEventListener('click', ()=> fi.click());
  ['dragenter','dragover'].forEach(evn=> drop.addEventListener(evn, e=>{e.preventDefault();drop.style.opacity=0.85;}));
  ;['dragleave','drop'].forEach(evn=> drop.addEventListener(evn, e=>{e.preventDefault();drop.style.opacity=1;}));
  drop.addEventListener('drop', e=> handleFiles(e.dataTransfer.files));
  fi.addEventListener('change', e=> handleFiles(e.target.files));

  async function handleFiles(list){
    files = Array.from(list);
    grid.innerHTML = '';
    for (const f of files) {
      let blobToUse = f;

      // 🔍 Deteksi & konversi HEIC/HEIF
      if (f.type.includes('heic') || f.name.toLowerCase().endsWith('.heic') ||
          f.type.includes('heif') || f.name.toLowerCase().endsWith('.heif')) {
        try {
          const converted = await heic2any({ blob: f, toType: 'image/jpeg', quality: 0.95 });
          blobToUse = new File([converted], f.name.replace(/\.[^/.]+$/, '.jpg'), { type: 'image/jpeg' });
        } catch (err) {
          console.error('Konversi HEIC gagal:', err);
          continue;
        }
      }

      const img = await loadImage(await readAsDataURL(blobToUse));
      const card = document.createElement('div'); card.className = 'card';
      const canvas = document.createElement('canvas'); const ctx = get2d(canvas);
      const [W,H] = getWH();
      canvas.width = Math.min(W, 480);
      canvas.height = Math.round(canvas.width * (H/W));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      card.appendChild(canvas);
      const meta = document.createElement('div'); meta.className='meta';
      meta.innerHTML = `<span>${blobToUse.name}</span>`;
      card.appendChild(meta);
      grid.appendChild(card);
    }
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
    let blobToUse = file;
    if (file.type.includes('heic') || file.name.toLowerCase().endsWith('.heic') ||
        file.type.includes('heif') || file.name.toLowerCase().endsWith('.heif')) {
      try {
        const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
        blobToUse = new File([converted], file.name.replace(/\.[^/.]+$/, '.jpg'), { type: 'image/jpeg' });
      } catch (err) {
        console.error('Konversi HEIC gagal:', err);
        return document.createTextNode('Gagal konversi HEIC');
      }
    }

    const img = await loadImage(await readAsDataURL(blobToUse));
    const maxSide = 2560;
    let W = img.width, H = img.height;
    if (W > maxSide || H > maxSide){ const scale = Math.min(maxSide/W, maxSide/H); W=Math.round(W*scale); H=Math.round(H*scale); }

    const canvas = document.createElement('canvas'); canvas.width=W; canvas.height=H;
    const ctx = get2d(canvas);
    ctx.drawImage(img,0,0,W,H);

    // Gambar watermark (disamakan dengan versi lama)
    ctx.globalAlpha = Number(oTop?.value||1);
    ctx.fillStyle = cTop?.value||'#fff';
    ctx.font = `${Number(sTop?.value)||40}px ${fTop?.value||'Inter, system-ui, Arial'}`;
    ctx.textBaseline='top';
    const m1=ctx.measureText(tTop?.value||'');
    const x1=(W - m1.width)/2, y1=Math.max(0, Number(mTop?.value||120));
    ctx.fillText(tTop?.value||'',x1,y1);

    ctx.globalAlpha=Number(oCtr?.value||1);
    ctx.fillStyle=cCtr?.value||'#fff';
    ctx.font=`${Number(sCtr?.value)||72}px ${fCtr?.value||'Inter, system-ui, Arial'}`;
    ctx.textBaseline='middle';
    const mC=ctx.measureText(tCtr?.value||''); const xC=(W - mC.width)/2, yC=(H/2)+Number(mCtr?.value||0);
    ctx.fillText(tCtr?.value||'',xC,yC);

    ctx.globalAlpha=Number(oBot?.value||1);
    ctx.fillStyle=cBot?.value||'#fff';
    ctx.font=`${Number(sBot?.value)||48}px ${fBot?.value||'Inter, system-ui, Arial'}`;
    ctx.textBaseline='bottom';
    const mB=ctx.measureText(tBot?.value||''); const xB=(W - mB.width)/2, yBpos=H - Math.max(0, Number(mBot?.value||80));
    ctx.fillText(tBot?.value||'',xB,yBpos);

    ctx.globalAlpha=1;

    const fig=document.createElement('div'); fig.className='card';
    const thumb=document.createElement('canvas');
    const s=Math.min(720,W); const sca=s/W;
    thumb.width=s; thumb.height=Math.round(H*sca);
    const tctx=get2d(thumb); tctx.drawImage(canvas,0,0,thumb.width,thumb.height);

    const meta=document.createElement('div'); meta.className='meta';
    const a=document.createElement('a'); a.textContent='Download';
    const pct=Math.min(100, Math.max(10, Number(resizePct?.value||100)))/100;
    if(pct>=0.999){ a.href=canvas.toDataURL('image/jpeg',1.0);} else {
      const out=document.createElement('canvas'); out.width=Math.round(canvas.width*pct); out.height=Math.round(canvas.height*pct);
      const octx=get2d(out); octx.drawImage(canvas,0,0,out.width,out.height);
      a.href=out.toDataURL('image/jpeg',1.0);
    }
    const base=file.name.replace(/\.[^.]+$/,'')+'-story';
    a.download=`${base}.jpg`;
    meta.appendChild(document.createElement('span')).textContent=a.download;
    meta.appendChild(a);

    fig.appendChild(thumb); fig.appendChild(meta);
    return fig;
  }
})();
