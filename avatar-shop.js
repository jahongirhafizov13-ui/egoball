// ============================================================================
// avatar-shop.js - Player Avatar Customization Shop (overlay/modal, not a
// separate page). Wrapped in its own IIFE module so its internal state
// (selectedColors, activeTab, etc.) never leaks into or collides with the
// rest of EgoBall's global scope - it only touches the outside world through
// the small public API at the bottom (AvatarShopModule.open/close) and by
// reading the game's existing `account`/`socket` globals when it needs to.
// ============================================================================
const AvatarShopModule = (function(){
  "use strict";

  // ---- module-local state (never exposed globally) -------------------------
  let activeTab = 'pattern';
  let design = {
    colors: ['#e5484d', '#e0b13c', '#4fb0ff'], // 3-color pattern, matches the game's existing COLORS palette style
    borderId: null,
    iconId: null,
    posX: 0, posY: 0,   // -1..1 offset pad
    size: 1.0,           // 0.7..1.3
    angle: 0              // 0..360
  };
  let selectedCarouselItem = null;

  // ---- catalog (placeholder data - wire this up to your real shop data/store.js) --
  const BORDERS = [
    { id:'border1', name:'Bronza', price:0,   owned:true  },
    { id:'border2', name:'Kumush', price:150, owned:false },
    { id:'border3', name:'Oltin',  price:400, owned:false },
    { id:'border4', name:'Olmos',  price:800, owned:false }
  ];
  const ICONS = [
    { id:'icon1', name:'Yulduz', price:0,   emoji:'⭐', owned:true },
    { id:'icon2', name:"Chaqmoq", price:120, emoji:'⚡', owned:false },
    { id:'icon3', name:'Olov',   price:180, emoji:'🔥', owned:false },
    { id:'icon4', name:'Tuman',  price:220, emoji:'💠', owned:false }
  ];
  const PREMADE = [
    { id:'pre1', name:'Klassik', price:0,   colors:['#e5484d','#e0b13c','#4fb0ff'], owned:true },
    { id:'pre2', name:'Zumrad',  price:250, colors:['#1a3d2c','#39c477','#0c2018'], owned:false },
    { id:'pre3', name:'Binafsha',price:300, colors:['#2a1a3d','#9a6bff','#150c20'], owned:false }
  ];

  // ---- canvas preview (isolated - its own canvas/context, never touches the main game loop) --
  let previewCanvas, previewCtx;
  function initPreviewCanvas(){
    previewCanvas = document.getElementById('avshopPreviewCanvas');
    previewCtx = previewCanvas.getContext('2d');
    previewCanvas.width = 220; previewCanvas.height = 220;
  }
  function drawPreview(){
    if(!previewCtx) return;
    const ctx = previewCtx, w = previewCanvas.width, h = previewCanvas.height;
    ctx.clearRect(0,0,w,h);
    ctx.save();
    ctx.translate(w/2 + design.posX*20, h/2 + design.posY*20);
    ctx.rotate(design.angle * Math.PI/180);
    const r = 70 * design.size;

    const wedgeCount = design.colors.length;
    for(let i=0;i<wedgeCount;i++){
      ctx.beginPath();
      ctx.moveTo(0,0);
      const a0 = (i/wedgeCount)*Math.PI*2, a1 = ((i+1)/wedgeCount)*Math.PI*2;
      ctx.arc(0,0,r,a0,a1);
      ctx.closePath();
      ctx.fillStyle = design.colors[i];
      ctx.fill();
    }

    const border = BORDERS.find(b=>b.id===design.borderId);
    ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2);
    ctx.lineWidth = 8;
    ctx.strokeStyle = border ? '#f6dd8a' : 'rgba(255,255,255,.4)';
    ctx.stroke();

    ctx.restore();

    const icon = ICONS.find(i=>i.id===design.iconId);
    if(icon){
      ctx.font = '32px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(icon.emoji, w/2 + design.posX*20, h/2 + design.posY*20 - r*0.55);
    }
  }

  // ---- tab controls (right panel) -------------------------------------------
  function renderControls(){
    const el = document.getElementById('avshopControls');
    el.innerHTML = '';
    if(activeTab==='pattern'){
      el.innerHTML = `<div class="avshop-row-label">Ranglar (3 ta)</div>
        <div class="avshop-colorpickers" id="avshopColorPickers"></div>`;
      const wrap = document.getElementById('avshopColorPickers');
      design.colors.forEach((c,i)=>{
        const cell = document.createElement('div'); cell.className='avshop-color-cell';
        cell.innerHTML = `<input type="color" value="${c}"><span>${i+1}</span>`;
        cell.querySelector('input').addEventListener('input', e=>{
          design.colors[i] = e.target.value; drawPreview();
        });
        wrap.appendChild(cell);
      });
    } else if(activeTab==='border'){
      el.innerHTML = `<div class="avshop-row-label">Ramka</div>`;
      renderCarousel(BORDERS, (item)=>{ design.borderId = item.id; drawPreview(); }, design.borderId);
      return;
    } else if(activeTab==='icon'){
      el.innerHTML = `<div class="avshop-row-label">Belgi</div>`;
      renderCarousel(ICONS, (item)=>{ design.iconId = item.id; drawPreview(); }, design.iconId);
      return;
    } else if(activeTab==='premade'){
      el.innerHTML = `<div class="avshop-row-label">Tayyor dizaynlar</div>`;
      renderCarousel(PREMADE, (item)=>{ design.colors = [...item.colors]; drawPreview(); }, null);
      return;
    } else if(activeTab==='inventory'){
      el.innerHTML = `<div class="avshop-row-label">Sizning kolleksiyangiz</div>
        <div style="font-size:12px;color:var(--txt-dim);">Sotib olingan barcha ramka/belgi shu yerda ko'rinadi.</div>`;
      const owned = [...BORDERS, ...ICONS].filter(i=>i.owned);
      renderCarousel(owned, (item)=>{
        if(BORDERS.includes(item)){ design.borderId = item.id; } else { design.iconId = item.id; }
        drawPreview();
      }, null);
      return;
    }
    const posBlock = document.createElement('div');
    posBlock.innerHTML = `
      <div class="avshop-row-label">Joylashuv</div>
      <div class="avshop-pospad" id="avshopPosPad"><div class="avshop-posdot" id="avshopPosDot"></div></div>
      <div class="avshop-row-label">O'lcham va burchak</div>
      <div class="avshop-slider-row"><label>O'lcham</label><input type="range" id="avshopSizeSlider" min="0.7" max="1.3" step="0.01" value="${design.size}"></div>
      <div class="avshop-slider-row"><label>Burchak</label><input type="range" id="avshopAngleSlider" min="0" max="360" step="1" value="${design.angle}"></div>
    `;
    el.appendChild(posBlock);
    wirePositionPad();
    document.getElementById('avshopSizeSlider').addEventListener('input', e=>{ design.size = +e.target.value; drawPreview(); });
    document.getElementById('avshopAngleSlider').addEventListener('input', e=>{ design.angle = +e.target.value; drawPreview(); });
  }

  function renderCarousel(items, onSelect, selectedId){
    const carousel = document.getElementById('avshopCarousel');
    carousel.innerHTML = '';
    items.forEach(item=>{
      const card = document.createElement('div');
      card.className = 'avshop-item-card' + (item.id===selectedId?' selected':'') + (item.owned?' owned':'');
      card.innerHTML = `
        <div class="avshop-item-thumb">${item.emoji || '🎨'}</div>
        <div class="avshop-item-name">${item.name}</div>
        <div class="avshop-item-price">${item.owned ? "Bor ✓" : (item.price>0 ? `💰 ${item.price}` : "Bepul")}</div>
      `;
      card.addEventListener('click', ()=>{
        selectedCarouselItem = item;
        carousel.querySelectorAll('.avshop-item-card').forEach(c=>c.classList.remove('selected'));
        card.classList.add('selected');
        onSelect(item);
        updateBuyButton(item);
      });
      carousel.appendChild(card);
    });
  }

  // ---- draggable X/Y offset pad ----------------------------------------------
  function wirePositionPad(){
    const pad = document.getElementById('avshopPosPad');
    const dot = document.getElementById('avshopPosDot');
    if(!pad || !dot) return;
    dot.style.left = (50 + design.posX*40) + '%';
    dot.style.top = (50 + design.posY*40) + '%';
    let dragging = false;
    function setFromEvent(clientX, clientY){
      const rect = pad.getBoundingClientRect();
      let x = (clientX - rect.left - rect.width/2) / (rect.width/2);
      let y = (clientY - rect.top - rect.height/2) / (rect.height/2);
      x = Math.max(-1, Math.min(1, x)); y = Math.max(-1, Math.min(1, y));
      design.posX = x; design.posY = y;
      dot.style.left = (50 + x*40) + '%'; dot.style.top = (50 + y*40) + '%';
      drawPreview();
    }
    dot.addEventListener('pointerdown', e=>{ dragging=true; dot.setPointerCapture(e.pointerId); });
    dot.addEventListener('pointermove', e=>{ if(dragging) setFromEvent(e.clientX, e.clientY); });
    dot.addEventListener('pointerup', ()=> dragging=false);
  }

  // ---- Buy/Done button + economy hook ----------------------------------------
  function updateBuyButton(item){
    const label = document.getElementById('avshopBuyLabel');
    const price = document.getElementById('avshopBuyPrice');
    if(!item){ label.textContent = 'Saqlash'; price.textContent = ''; return; }
    if(item.owned){ label.textContent = 'Kiyish'; price.textContent = ''; }
    else { label.textContent = 'Sotib olish'; price.textContent = item.price>0 ? `💰 ${item.price}` : 'Bepul'; }
  }

  // Called when the green Buy/Done button is pressed. Builds the final design
  // payload and (placeholder) sends it to the server for validation/purchase -
  // the server must be the one that actually deducts currency and grants
  // ownership; never trust a client-side "I bought it" claim.
  function purchaseSkin(skinData, cost){
    const finalSkinObject = {
      colors: design.colors,
      borderId: design.borderId,
      iconId: design.iconId,
      posX: design.posX, posY: design.posY,
      size: design.size, angle: design.angle,
      selectedItemId: skinData ? skinData.id : null,
      cost: cost || 0
    };

    // ---- NETWORK READINESS ----------------------------------------------
    // Wire this up to your real server once you have a matching handler:
    //   socket.emit('buyAvatar', finalSkinObject, (res) => {
    //     if(res && res.ok){ account.coins = res.coins; /* refresh balance UI */ }
    //     else { /* show res.error to the player */ }
    //   });
    // The server (not this client code) must verify the account can afford
    // `cost`, deduct it, and persist the design - exactly like openCase/
    // equipCharacter already do elsewhere in this game's economy.js.
    console.log('[AvatarShopModule] purchaseSkin ->', finalSkinObject);

    // Optimistic local UI feedback only - replace with the real ack above.
    if(skinData) skinData.owned = true;
    renderControls();
  }

  document.addEventListener('DOMContentLoaded', wireStaticHandlers, { once:true });
  if(document.readyState !== 'loading') wireStaticHandlers();

  function wireStaticHandlers(){
    const modal = document.getElementById('avatar-shop-modal');
    if(!modal) return;
    initPreviewCanvas();

    document.getElementById('avshopClose').addEventListener('click', close);

    document.getElementById('avshopTabs').addEventListener('click', e=>{
      const tabEl = e.target.closest('.avshop-tab');
      if(!tabEl) return;
      activeTab = tabEl.getAttribute('data-tab');
      document.querySelectorAll('.avshop-tab').forEach(t=> t.classList.toggle('active', t===tabEl));
      renderControls();
    });

    document.getElementById('avshopBuyBtn').addEventListener('click', ()=>{
      purchaseSkin(selectedCarouselItem, selectedCarouselItem ? selectedCarouselItem.price : 0);
    });

    renderControls();
    drawPreview();
  }

  function syncBalanceDisplay(){
    const acc = (typeof account !== 'undefined') ? account : null;
    const eEl = document.getElementById('avshopEcoin');
    const gEl = document.getElementById('avshopGcoin');
    if(eEl) eEl.textContent = acc ? (acc.coins||0) : 0;
    if(gEl) gEl.textContent = acc ? (acc.gcoin||0) : 0;
  }

  function open(){
    const modal = document.getElementById('avatar-shop-modal');
    if(!modal) return;
    modal.classList.remove('hidden');
    syncBalanceDisplay();
    drawPreview();
  }
  function close(){
    const modal = document.getElementById('avatar-shop-modal');
    if(modal) modal.classList.add('hidden');
  }

  return { open, close, purchaseSkin };
})();
