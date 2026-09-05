(() => {
  const panel = document.getElementById('buddyShowroom');
  const cards = document.getElementById('buddyProductCards');
  const detail = document.getElementById('buddyProductDetail');
  const categorySelect = document.getElementById('buddyCategory');
  const notice = document.getElementById('buddyShowroomNotice');
  let state = {products:[]}, callbacks = {}, openedId = '';
  function node(tag, text, className) {
    const el=document.createElement(tag);
    if(text)el.textContent=text;
    if(className)el.className=className;
    return el;
  }
  function image(product) {
    const img=node('img');
    // Only repository-owned illustration paths are accepted in V1.
    img.src=/^\/buddys\/images\/showroom\/[a-z-]+\.svg$/.test(product.image?.src || '')?product.image.src:'/buddys/images/showroom/sofa.svg';
    img.alt=product.image?.alt || 'Product category illustration';
    img.width=480;img.height=300;
    return img;
  }
  function button(label,action,className='showroom-button') {
    const b=node('button',label,className);b.type='button';b.addEventListener('click',action);return b;
  }
  function select(product,index) {
    return button(state.canSelect?'Select & prepare agreement':'Add your preferences to select',()=>{
      if(state.canSelect)callbacks.onSelect?.(index);
      else callbacks.onLead?.(product.category);
    },'showroom-button primary');
  }
  function open(product,index) {
    openedId=product.id;
    detail.replaceChildren();detail.hidden=false;
    const back=button('Back to both options',()=>{detail.hidden=true;openedId='';cards.hidden=false;cards.querySelector('button')?.focus();});
    const title=node('h3',product.name);title.tabIndex=-1;
    const specs=node('dl',null,'showroom-specs');
    for(const spec of product.specs || [])specs.append(node('dt',spec.label),node('dd',spec.value));
    const controls=node('div',null,'showroom-detail-controls');
    const store=node('a','Confirm details with your store','showroom-store-link');
    store.href='https://www.buddyrents.com/store-locator';store.target='_blank';store.rel='noopener noreferrer';
    controls.append(store);
    if(product.productUrl){
      try {
        const url=new URL(product.productUrl);
        if(url.protocol==='https:' && ['www.buddyrents.com','buddyrents.com'].includes(url.hostname)){
          const link=node('a',"View product on Buddy's website",'showroom-store-link');
          link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';controls.append(link);
        }
      }catch{}
    }
    if(!state.locked)controls.append(select(product,index));
    detail.append(back,image(product),node('span','Category illustration · exact appearance varies','showroom-caption'),title,
      node('p',product.description),specs,node('p',product.availability,'showroom-availability'),
      node('p','Dimensions, finish, pricing and payment terms: confirm with your store.','showroom-availability'),controls);
    cards.hidden=true;
    title.focus();
    callbacks.onEvent?.('product.opened',product);
  }
  function render(next,handlers) {
    state=next;callbacks=handlers;panel.hidden=false;
    categorySelect.replaceChildren();
    categorySelect.append(node('option','Choose a category'));
    categorySelect.children[0].value='';
    for(const category of next.categories || []){const option=node('option',category);option.value=category;categorySelect.append(option);}
    categorySelect.value=next.category || '';categorySelect.disabled=Boolean(next.locked || next.busy);
    notice.textContent=next.locked?'Your selected order is saved. Ask your store about changes.':next.canSelect?'Compare two options, then select an item to prepare your demo agreement.':'Explore the showroom. Add your preferences when you are ready to select.';
    cards.replaceChildren();cards.hidden=false;detail.replaceChildren();detail.hidden=true;openedId='';
    if(!next.products?.length)cards.append(node('p','Choose a category to explore two demo options.','showroom-empty'));
    for(const [index,product] of (next.products || []).entries()){
      const card=node('article',null,'showroom-product');card.dataset.productId=product.id;
      const badge=node('span',next.selectedProduct===product.name?'YOUR SELECTION':`OPTION ${index+1}`,'showroom-option');
      card.append(image(product),badge,node('h3',product.name),node('p',product.description),
        node('span','Illustration · confirm model and terms','showroom-caption'),button('View details',()=>open(product,index)));
      if(!next.locked)card.append(select(product,index));
      cards.append(card);
      callbacks.onEvent?.('product.shown',product);
    }
  }
  categorySelect.addEventListener('change',()=>{if(categorySelect.value)callbacks.onCategory?.(categorySelect.value);});
  window.BuddyShowroom={render,setBusy(busy){categorySelect.disabled=Boolean(busy||state.locked);panel.querySelectorAll('button').forEach(b=>{b.disabled=busy;});},
    closeDetails(){if(!openedId)return false;detail.hidden=true;cards.hidden=false;openedId='';cards.querySelector('button')?.focus();return true;}};
})();
