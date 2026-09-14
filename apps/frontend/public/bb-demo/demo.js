(() => {
  const looks=[
    {id:'icon',name:'Signature Black Dress',price:129,x:2,y:2,w:307,h:590,tags:['date','girls','new']},
    {id:'blazer',name:'Sequin Blazer Ensemble',price:159,x:316,y:2,w:307,h:590,tags:['work','girls','new']},
    {id:'satin',name:'Rose Satin Dress',price:139,x:630,y:2,w:307,h:590,tags:['date','wedding','vacation']},
    {id:'sophia',name:'Sophia Blue Midi Dress',price:129,x:944,y:2,w:307,h:590,tags:['work','wedding','vacation']},
    {id:'contour',name:'Tailored Wide-Leg Jumpsuit',price:149,x:2,y:600,w:307,h:650,tags:['work','date','girls']},
    {id:'luxe',name:'Champagne Evening Gown',price:189,x:316,y:600,w:307,h:650,tags:['wedding','girls','new']}
  ];
  const occasions=[['new','✦','New'],['date','♧','Date'],['girls','♡','Girls'],['wedding','♕','Wedding'],['work','▱','Work'],['vacation','☀','Away']];
  let selected='icon',occasion='all',favorites=new Set();
  try{const saved=JSON.parse(localStorage.getItem('bb-demo-favorites')||'[]');if(Array.isArray(saved))favorites=new Set(saved.filter(id=>looks.some(l=>l.id===id)));}catch{}
  const cards=document.getElementById('looks'),nav=document.getElementById('occasions'),model=document.getElementById('modelImage');
  // SVG viewports crop the locally generated atlas without stretching its models.
  function crop(el,look){
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),image=document.createElementNS(ns,'image');
    svg.setAttribute('viewBox',`${look.x} ${look.y} ${look.w} ${look.h}`);
    svg.setAttribute('preserveAspectRatio',el.classList.contains('stylist-image')?'xMidYMid slice':'xMidYMid meet');
    const frame=document.createElementNS(ns,'svg');
    for(const [key,value] of Object.entries({x:look.x,y:look.y,width:look.w,height:look.h,viewBox:`${look.x} ${look.y} ${look.w} ${look.h}`,overflow:'hidden'}))frame.setAttribute(key,String(value));
    svg.setAttribute('aria-hidden','true');image.setAttribute('href','./catalog.png');image.setAttribute('width','1254');image.setAttribute('height','1254');frame.append(image);svg.append(frame);el.replaceChildren(svg);
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
      const title=document.createElement('h3');title.textContent=look.name;const price=document.createElement('p');price.textContent=`$${look.price}.00`;const tryLook=document.createElement('button');tryLook.type='button';tryLook.className='try-look';tryLook.textContent='Try this look →';tryLook.onclick=()=>choose(look);card.append(visual,heart,title,price,tryLook);cards.append(card);
    }
  }
  document.getElementById('messageMode').onclick=()=>document.getElementById('connectionNote').scrollIntoView({block:'nearest',behavior:'smooth'});
  document.getElementById('chatForm').onsubmit=e=>e.preventDefault();
  crop(document.querySelector('.stylist-image'),{x:630,y:600,w:307,h:400});
  crop(document.querySelector('.bag-thumb.first'),looks[0]);
  crop(document.querySelector('.bag-thumb.second'),looks[1]);
  choose(looks[0]);
})();
