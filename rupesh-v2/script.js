const galleries={logo:document.getElementById('logoGallery'),product:document.getElementById('productGallery'),marketing:document.getElementById('marketingGallery'),typography:document.getElementById('typographyGallery')};
const modal=document.getElementById('modal');let works=[];
const darkLogoSet=new Set(['Orbital Systems','Synapse Studios 1','Synapse Studios','Wave Front Media']);
const excludedLogoSet=new Set(['Synapse Studios 1']);
const rawCategoryMap={
  'baked by beth':'logo',
  'clay making 2':'marketing',
  'elevate co.':'logo',
  'floura and faouna':'logo',
  'indown.ai 651549052 18043638698726024 3638122456973932506 n':'marketing',
  'leaf craft':'marketing',
  'nomad travel':'logo',
  'onam banner':'marketing',
  'orbital systems':'logo',
  'samyak ganesh chaturthii':'marketing',
  'ethnic day - surabhi':'marketing',
  'main poster - samyak 2025':'marketing',
  'media pertner':'marketing',
  'flash mob':'marketing',
  'flash mob - femflare':'marketing',
  'ethnic day':'marketing',
  'ethnic day surabhi':'marketing',
  'carnval':'marketing',
  '1 day to go - samyak':'marketing',
  '1 day to go samyak':'marketing',
  'dj night':'marketing',
  'dj night femflare':'marketing',
  'femflare brochure':'marketing',
  'saveinta.com 653403891 18044279126726024 8900326332029412482 n copy (2)':'marketing',
  'saveinta.com 655064153 18044693678726024 1061128340456383638 n copy (2)':'marketing',
  'synapse studios 1':'logo',
  'synapse studios':'logo',
  'untitled design (1)':'typography',
  'porsche 911 gte rs':'marketing',
  'porsche f8 spider':'typography',
  'billie ellish':'typography',
  'ferrari f1':'marketing',
  'pizza':'product',
  'ferrari f1 - speed':'marketing',
  'ferrari f1 speed':'marketing',
  'screening':'typography',
  'porsche':'marketing',
  'mocktails':'product',
  'typography':'typography',
  'ferrari f8 spider':'marketing',
  'untitled design copy (2)':'typography',
  'wave front media':'logo',
  'package design 1':'product',
  'package design 2':'product',
  'tug of war':'marketing',
  'untitled design (10) copy':'typography',
  'untitled design (11) copy':'typography',
  'main poster samyak 2025':'marketing'
};
const categoryMap=Object.fromEntries(Object.entries(rawCategoryMap).map(([key,value]) => [normalizeTitle(key), value]));
function normalizeTitle(title){
  return (title||'').toLowerCase().replace(/\.(jpg|jpeg|png|gif|webp)$/i,'').replace(/[_.]+/g,' ').replace(/[-()]+/g,' ').replace(/\s+/g,' ').trim();
}
function classifyWork(w){
  const title=(w.title||'').trim();
  return categoryMap[normalizeTitle(title)] || 'marketing';
}
function category(w,i){return classifyWork(w);}
function categoryLabel(c){return c==='logo'?'LOGO DESIGN':c==='product'?'PRODUCT DESIGN':c==='typography'?'TYPOGRAPHY':'MARKETING & BRANDING';}
function cleanTitle(title){return title.replace(/\.[A-Z0-9]+.*$/,'');}
function resolveImageSource(w,c){const original=(w.original||'').trim();if(c==='logo' && darkLogoSet.has(w.title)){if(w.title==='Wave Front Media')return 'assets/gallery/Wave Front Media dark.png';if(w.title==='Synapse Studios')return w.src;return `assets/raw/BCA Id cards/${encodeURI(original)}`;}if(c==='logo')return w.src;if(original && /\.png$/i.test(original))return `assets/raw/BCA Id cards/${encodeURI(original)}`;return w.src;}
function render(){Object.values(galleries).forEach(g=>g.innerHTML='');const ora=document.createElement('article');ora.className='card ora-logo-card';ora.dataset.category='logo';ora.innerHTML='<img class="ora-logo-image" src="assets/gallery/ORA%20(2).png" loading="lazy" alt="ORA Coffee logo">';ora.onclick=()=>openModal({title:'ORA Coffee',src:'assets/gallery/ORA%20(2).png'},0,'logo');galleries.logo.appendChild(ora);const packageDesigns=[{title:'Package Design 1',src:'assets/gallery/Package%20design%201.png'},{title:'Package Design 2',src:'assets/gallery/Package%20design%202.png'}];packageDesigns.forEach((w,i)=>{const el=document.createElement('article');el.className='card package-design-card';el.dataset.category='product';el.dataset.packageDesign='true';el.innerHTML=`<img src="${w.src}" loading="lazy" alt="${w.title} — PRODUCT DESIGN by Rupesh Ravu"><div class="caption"><small>PACKAGE / PRODUCT DESIGN</small><h3>${w.title}</h3></div>`;el.onclick=()=>openModal(w,i,'product');galleries.product.appendChild(el)});const marketingDesign={title:'Tug of War',src:'assets/gallery/TUG%20OF%20WAR.jpeg'};const marketingCard=document.createElement('article');marketingCard.className='card';marketingCard.dataset.category='marketing';marketingCard.innerHTML=`<img src="${marketingDesign.src}" loading="lazy" alt="${marketingDesign.title} — MARKETING & BRANDING by Rupesh Ravu"><div class="caption"><small>MARKETING &amp; BRANDING</small><h3>${marketingDesign.title}</h3></div>`;marketingCard.onclick=()=>openModal(marketingDesign,0,'marketing');galleries.marketing.appendChild(marketingCard);works.forEach((w,i)=>{const c=category(w,i);if(c==='logo' && excludedLogoSet.has(w.title))return;const gallery=galleries[c];if(!gallery)return;let el=document.createElement('article');el.className='card';el.dataset.category=c;if(c==='logo' && darkLogoSet.has(w.title))el.dataset.darkLogo='true';const imageSrc=resolveImageSource(w,c);el.innerHTML=`<img src="${imageSrc}" loading="lazy" alt="${w.title} — ${categoryLabel(c)} by Rupesh Ravu"><div class="caption"><small>${String(i+1).padStart(2,'0')} / ${categoryLabel(c)}</small><h3>${cleanTitle(w.title)}</h3></div>`;el.onclick=()=>openModal(w,i,c);gallery.appendChild(el)});}
function openModal(w,i,c){modal.classList.add('open');const imageSrc=resolveImageSource(w,c);document.getElementById('modalImg').src=imageSrc;document.getElementById('modalImg').alt=w.title;document.getElementById('modalNo').textContent=`${String(i+1).padStart(2,'0')} / ${categoryLabel(c)}`;document.getElementById('modalTitle').textContent=cleanTitle(w.title);document.getElementById('modalText').textContent=`${categoryLabel(c)} from the Ravu.FX archive.`}
document.getElementById('close').onclick=()=>modal.classList.remove('open');modal.onclick=e=>{if(e.target===modal)modal.classList.remove('open')};document.addEventListener('keydown',e=>{if(e.key==='Escape')modal.classList.remove('open')});
fetch(`works.json?t=${Date.now()}`,{cache:'no-store'}).then(r=>r.json()).then(data=>{works=data;render()});
