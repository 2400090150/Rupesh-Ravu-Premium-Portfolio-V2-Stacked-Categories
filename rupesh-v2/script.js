const modal = document.getElementById('modal');
const portfolioStatus = document.getElementById('portfolioStatus');

function showPortfolioError(message) {
  portfolioStatus.textContent = message;
  portfolioStatus.hidden = false;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element && typeof value === 'string') element.textContent = value;
}

function setHeroTitle(value) {
  const element = document.getElementById('heroTitle');
  if (!element || typeof value !== 'string') return;
  const lines = value.split(/\r?\n/);
  const content = document.createDocumentFragment();
  lines.forEach((line, index) => {
    if (index > 0) content.append(document.createElement('br'));
    if (index === 1) {
      const accent = document.createElement('i');
      accent.textContent = line;
      content.append(accent);
    } else {
      content.append(document.createTextNode(line));
    }
  });
  element.replaceChildren(content);
}

function setAboutName(value) {
  const element = document.getElementById('aboutName');
  if (!element || typeof value !== 'string') return;
  const words = value.trim().split(/\s+/).filter(Boolean);
  const firstLine = document.createTextNode(words.shift() || '');
  const accent = document.createElement('span');
  accent.textContent = words.join(' ');
  element.replaceChildren(firstLine, document.createElement('br'), accent);
}

function createDesignCard(design, category, index) {
  const card = document.createElement('article');
  card.className = 'card';
  const image = document.createElement('img');
  card.dataset.designCategory = design.category;
  if (design.category === 'product-design') {
    card.classList.add('product-design-card');
    image.classList.add('product-design-image');
  }
  image.src = design.image;
  image.alt = `${design.title} — ${category.title}`;
  image.loading = 'lazy';
  if (design.category === 'logo-designs') {
    card.dataset.category = 'logo';
    card.style.backgroundColor = design.displayBackgroundColor || '#ffffff';
  }
  const caption = document.createElement('div');
  caption.className = 'caption';
  const number = document.createElement('small');
  number.textContent = `${String(index + 1).padStart(2, '0')} / ${category.title}`;
  const title = document.createElement('h3');
  title.textContent = design.title;
  caption.append(number, title);
  card.append(image, caption);
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Preview ${design.title}`);
  const open = () => openModal(design, category, index);
  card.addEventListener('click', open);
  card.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
  return card;
}

function openModal(design, category, index) {
  const image = document.getElementById('modalImg');
  image.src = design.image;
  image.alt = design.title;
  image.style.backgroundColor = design.displayBackgroundColor || 'transparent';
  document.getElementById('modalNo').textContent = `${String(index + 1).padStart(2, '0')} / ${category.title}`;
  document.getElementById('modalTitle').textContent = design.title;
  document.getElementById('modalText').textContent = design.description;
  modal.classList.add('open');
  document.getElementById('close').focus();
}

function closeModal() {
  modal.classList.remove('open');
}

async function loadPortfolio() {
  const response = await fetch('/api/portfolio', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Portfolio could not be loaded (HTTP ${response.status}).`);
  const portfolio = await response.json();
  const { categories, content } = portfolio;
  const customSections = portfolio.customSections ?? [];
  if (!Array.isArray(categories) || categories.length !== 4) {
    throw new Error('The portfolio must have exactly four configured design sections.');
  }
  if (!Array.isArray(customSections)) throw new Error('The custom homepage sections are invalid.');
  setHeroTitle(content.heroTitle);
  setText('heroLead', content.heroLead);
  setAboutName(content.aboutName);
  setText('aboutSummary', content.aboutSummary);
  setText('aboutText', content.aboutText);
  const toolsResponse = await fetch('/api/tools', { cache: 'no-store' });
  if (!toolsResponse.ok) throw new Error(`Tool logos could not be loaded (HTTP ${toolsResponse.status}).`);
  const { tools } = await toolsResponse.json();
  renderTools(tools);
  const instagram = document.getElementById('heroInstagram');
  if (instagram && content.contactInstagram) {
    const handle = content.contactInstagram.startsWith('@') ? content.contactInstagram : `@${content.contactInstagram}`;
    instagram.textContent = `${handle} ↗`;
    instagram.href = `https://www.instagram.com/${encodeURIComponent(handle.slice(1))}/`;
  }
  categories.forEach((category, categoryIndex) => {
    const section = document.getElementById(category.slug);
    const gallery = document.getElementById(`gallery-${category.slug}`);
    if (!section || !gallery) throw new Error(`The homepage is missing the ${category.slug} section.`);
    section.hidden = !category.visible;
    setText(`title-${category.slug}`, category.title);
    setText(`description-${category.slug}`, category.description);
    ensureSectionMarquee(section, category.marqueeText || getCategoryMarqueeText(category), category.slug);
    if (!category.visible) return;
    if (!Array.isArray(category.designs) || category.designs.length < 1 || category.designs.length > 4) {
      throw new Error(`${category.title} must have between one and four featured designs.`);
    }
    gallery.style.setProperty('--featured-count', category.designs.length);
    gallery.replaceChildren(...category.designs.map((design, index) => createDesignCard(design, category, index)));
    section.querySelector('.category-no').textContent = `${String(categoryIndex + 1).padStart(2, '0')}`;
  });
  renderCustomSections(customSections);
}

function renderCustomSections(sections) {
  const container = document.getElementById('customHomeSections');
  if (!container) return;
  const visibleSections = sections.filter(section => section.visible);
  container.replaceChildren(...visibleSections.map((section, index) => {
    const element = document.createElement('section');
    element.className = 'custom-home-section';
    const number = document.createElement('p');
    number.className = 'kicker';
    number.textContent = `ADDITIONAL / ${String(index + 1).padStart(2, '0')}`;
    const title = document.createElement('h2');
    title.textContent = section.title;
    const description = document.createElement('p');
    description.className = 'custom-home-description';
    description.textContent = section.description;
    element.append(number, title, description);
    ensureSectionMarquee(element, section.title);
    return element;
  }));
}

function getCategoryMarqueeText(category) {
  const defaultMarquees = {
    'logo-designs': { titles: ['LOGO DESIGNS'], text: 'LOGOPHOLIO' },
    'product-design': { titles: ['PRODUCT DESIGN', 'PACKAGE DESIGN'], text: 'PACKAGING' },
    'marketing-branding': { titles: ['MARKETING & BRANDING'], text: 'BRANDING' },
    typography: { titles: ['TYPOGRAPHY'], text: 'TYPOPHOLIO' }
  };
  const defaultMarquee = defaultMarquees[category.slug];
  const title = category.title.trim().toUpperCase();
  return defaultMarquee?.titles.includes(title) ? defaultMarquee.text : category.title;
}

function ensureSectionMarquee(section, text, slug = '') {
  let viewport = section.querySelector(':scope > .section-title-marquee');
  if (!viewport) {
    viewport = document.createElement('div');
    viewport.className = 'section-title-marquee';
    viewport.setAttribute('aria-hidden', 'true');
    const track = document.createElement('div');
    track.className = 'section-title-marquee-track';
    const group = document.createElement('div');
    group.className = 'section-title-marquee-group';
    track.append(group);
    viewport.append(track);
    section.prepend(viewport);
  }
  viewport.dataset.marqueeText = text;
  viewport.dataset.direction = ['logo-designs', 'marketing-branding'].includes(slug) ? 'left' : 'right';
  buildSectionMarquee(viewport);
}

function buildSectionMarquee(viewport) {
  const track = viewport.querySelector('.section-title-marquee-track');
  const group = track?.querySelector('.section-title-marquee-group');
  const width = viewport.getBoundingClientRect().width;
  if (!track || !group || !width) return;

  const word = document.createElement('span');
  word.textContent = viewport.dataset.marqueeText || 'LOGOPHOLIO';
  group.replaceChildren(word);
  while (group.scrollWidth < width) group.append(word.cloneNode(true));

  const duplicate = group.cloneNode(true);
  duplicate.setAttribute('aria-hidden', 'true');
  track.replaceChildren(group, duplicate);
  track.style.setProperty('--marquee-duration', `${group.scrollWidth / 90}s`);
  track.dataset.direction = viewport.dataset.direction || 'right';
}

function refreshSectionMarquees() {
  document.querySelectorAll('.section-title-marquee').forEach(buildSectionMarquee);
}

let marqueeResizeScheduled = false;
function scheduleSectionMarqueeRefresh() {
  if (marqueeResizeScheduled) return;
  marqueeResizeScheduled = true;
  window.requestAnimationFrame(() => {
    marqueeResizeScheduled = false;
    refreshSectionMarquees();
  });
}

function renderTools(tools) {
  const gallery = document.getElementById('toolGallery');
  if (!gallery) return;
  if (!Array.isArray(tools)) throw new Error('The published tool logo list is invalid.');
  if (tools.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'tool-empty';
    empty.textContent = 'Tool logos coming soon.';
    gallery.replaceChildren(empty);
    return;
  }
  gallery.replaceChildren(...tools.map(tool => {
    const item = document.createElement('figure');
    item.className = 'tool-logo';
    if (tool.category) item.dataset.category = tool.category;
    const image = document.createElement('img');
    image.src = tool.image;
    image.alt = tool.name;
    image.loading = 'lazy';
    item.append(image);
    return item;
  }));
}

function initializeMarquee() {
  const track = document.querySelector('.marquee-track');
  const group = track?.querySelector('.marquee-group');
  const source = group?.querySelector('.marquee-text');
  if (!track || !group || !source) return;

  const text = source.textContent.trim();
  if (!text) return;
  let viewportWidth = 0;
  const buildTrack = () => {
    viewportWidth = window.innerWidth;
    group.replaceChildren();
    const first = source.cloneNode(true);
    first.textContent = text;
    group.append(first);
    while (group.scrollWidth < viewportWidth) {
      const repeat = source.cloneNode(true);
      repeat.textContent = text;
      repeat.setAttribute('aria-hidden', 'true');
      group.append(repeat);
    }

    const duplicate = group.cloneNode(true);
    duplicate.setAttribute('aria-hidden', 'true');
    track.replaceChildren(group, duplicate);
  };

  const rebuildOnResize = () => {
    if (window.innerWidth !== viewportWidth) buildTrack();
  };

  buildTrack();
  if (document.fonts?.ready) document.fonts.ready.then(buildTrack);
  window.addEventListener('resize', rebuildOnResize, { passive: true });
}

initializeMarquee();
window.addEventListener('resize', scheduleSectionMarqueeRefresh, { passive: true });
if (document.fonts?.ready) document.fonts.ready.then(refreshSectionMarquees);
document.getElementById('close').addEventListener('click', closeModal);
modal.addEventListener('click', event => {
  if (event.target === modal) closeModal();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeModal();
});

if ('BroadcastChannel' in window) {
  const portfolioUpdates = new BroadcastChannel('ravu-portfolio-updates');
  portfolioUpdates.addEventListener('message', event => {
    if (event.data === 'refresh') {
      loadPortfolio().catch(error => {
        console.error(error);
        showPortfolioError(`${error.message} Please refresh or contact the site administrator.`);
      });
    }
  });
}

loadPortfolio().catch(error => {
  console.error(error);
  showPortfolioError(`${error.message} Please refresh or contact the site administrator.`);
});
