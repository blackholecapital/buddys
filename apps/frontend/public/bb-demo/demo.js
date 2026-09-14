(() => {
  const looks=[
    {id:'cascade',name:'Cascade High Low Mesh Dress',price:104.30,src:'bebe-dresses.png',iw:1349,ih:615,x:110,y:0,w:180,h:437,tags:['date','girls','vacation','new']},
    {id:'halter',name:'Bandage Halter Dress',price:117.60,src:'bebe-dresses.png',iw:1349,ih:615,x:443,y:0,w:170,h:437,tags:['date','girls','new']},
    {id:'satin',name:'Printed Satin Maxi Dress',price:68.60,src:'bebe-dresses.png',iw:1349,ih:615,x:771,y:0,w:170,h:437,tags:['wedding','vacation','new']},
    {id:'lace',name:'Marseille Lace Square Neck Tank Dress',price:96.99,src:'bebe-dresses.png',iw:1349,ih:615,x:1090,y:0,w:175,h:437,tags:['wedding','date','work']},
    {id:'ombre',name:'Ombre Bandage Strapless',price:117.60,src:'bebe-ombre.png',iw:351,ih:646,x:80,y:17,w:195,h:441,tags:['girls','vacation','new']},
    {id:'mini',name:'Cap Sleeve Bandage Mini Dress',price:118.30,src:'bebe-mini.png',iw:284,ih:652,x:92,y:10,w:166,h:441,tags:['date','girls','wedding']}
  ];
  const occasions=[['new','✦','New'],['date','♧','Date'],['girls','♡','Girls'],['wedding','♕','Wedding'],['work','▱','Work'],['vacation','☀','Away']];
  let selected='cascade',occasion='all',favorites=new Set();
  try{const saved=JSON.parse(localStorage.getItem('bb-demo-favorites')||'[]');if(Array.isArray(saved))favorites=new Set(saved.filter(id=>looks.some(l=>l.id===id)));}catch{}
  const cards=document.getElementById('looks'),nav=document.getElementById('occasions'),model=document.getElementById('modelImage');
  // SVG viewports crop the supplied catalog photographs without stretching its models.
  function crop(el,look){
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),image=document.createElementNS(ns,'image');
    svg.setAttribute('viewBox',`${look.x} ${look.y} ${look.w} ${look.h}`);
    svg.setAttribute('preserveAspectRatio','xMidYMid meet');
    const frame=document.createElementNS(ns,'svg');
    for(const [key,value] of Object.entries({x:look.x,y:look.y,width:look.w,height:look.h,viewBox:`${look.x} ${look.y} ${look.w} ${look.h}`,overflow:'hidden'}))frame.setAttribute(key,String(value));
    svg.setAttribute('aria-hidden','true');image.setAttribute('href','./'+look.src);image.setAttribute('width',String(look.iw));image.setAttribute('height',String(look.ih));frame.append(image);
    // Hide only catalog UI text at the crop edge; the source photos stay intact.
    if(['cascade','halter','satin','ombre','mini'].includes(look.id)){const cover=document.createElementNS(ns,'rect');cover.setAttribute('x',String(look.x));cover.setAttribute('y',String(look.y));cover.setAttribute('width',look.id==='ombre'?'50':look.id==='mini'?'20':'40');cover.setAttribute('height','36');cover.setAttribute('fill','#eee');frame.append(cover);}
    svg.append(frame);el.replaceChildren(svg);
  }
  function choose(look){selected=look.id;crop(model,look);model.setAttribute('aria-label',`Model wearing ${look.name}`);document.getElementById('modelLabel').textContent=look.name;render();}
  function render(){
    nav.replaceChildren();
    for(const [id,icon,label] of occasions){const b=document.createElement('button');b.type='button';b.setAttribute('aria-pressed',String(occasion===id));b.setAttribute('aria-label',`Filter ${label} looks`);const symbol=document.createElement('span');symbol.textContent=icon;symbol.setAttribute('aria-hidden','true');b.append(symbol,document.createTextNode(label));b.onclick=()=>{occasion=occasion===id?'all':id;render();};nav.append(b);}
    cards.replaceChildren();
    const visible=looks.filter(l=>occasion==='all'||l.tags.includes(occasion));
    for(const look of visible){const card=document.createElement('article');card.className='look'+(look.id===selected?' selected':'');card.dataset.look=look.id;
      const visual=document.createElement('button');visual.type='button';visual.className='look-image';visual.style.border='0';visual.style.padding='0';visual.setAttribute('aria-label',`Try ${look.name}`);crop(visual,look);visual.onclick=()=>choose(look);
      const heart=document.createElement('button');heart.type='button';heart.className='heart';heart.textContent=favorites.has(look.id)?'♥':'♡';heart.setAttribute('aria-label',`Favorite ${look.name}`);heart.setAttribute('aria-pressed',String(favorites.has(look.id)));heart.onclick=()=>{favorites.has(look.id)?favorites.delete(look.id):favorites.add(look.id);try{localStorage.setItem('bb-demo-favorites',JSON.stringify([...favorites]));}catch{}heart.textContent=favorites.has(look.id)?'♥':'♡';heart.setAttribute('aria-pressed',String(favorites.has(look.id)));};
      const title=document.createElement('h3');title.textContent=look.name;const price=document.createElement('p');price.textContent="$"+look.price.toFixed(2);const tryLook=document.createElement('button');tryLook.type='button';tryLook.className='try-look';tryLook.textContent='Try this look →';tryLook.onclick=()=>choose(look);card.append(visual,heart,title,price,tryLook);cards.append(card);
    }
  }
  document.getElementById('messageMode').onclick=()=>document.getElementById('connectionNote').scrollIntoView({block:'nearest',behavior:'smooth'});
  document.getElementById('chatForm').onsubmit=e=>e.preventDefault();
  crop(document.querySelector('.stylist-image'),{src:'bebe-stylist.png',iw:207,ih:410,x:0,y:35,w:207,h:310});
  crop(document.querySelector('.bag-thumb.first'),looks[0]);
  crop(document.querySelector('.bag-thumb.second'),looks[1]);
  choose(looks[0]);
})();
