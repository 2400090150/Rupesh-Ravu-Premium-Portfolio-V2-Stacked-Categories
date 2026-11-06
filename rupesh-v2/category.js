const CATEGORY_SLUGS = ['logo-designs', 'product-design', 'marketing-branding', 'typography'];
const currentCategory = window.location.pathname.replace(/^\/+|\/+$/g, '');
const gallery = document.getElementById('categoryGallery');
const sectionsContainer = document.getElementById('categorySections');
const statusMessage = document.getElementById('categoryStatus');
const modal = document.getElementById('modal');
const portfolioUpdateChannel = 'BroadcastChannel' in window
  ? new BroadcastChannel('ravu-portfolio-updates')
  : null;

function showCategoryError(message) {
  statusMessage.textContent = message;
  statusMessage.hidden = false;
}

function makeCard(design, category, index) {
  const card = document.createElement('article');
  card.className = 'card';
  const image = document.createElement('img');
  image.addEventListener('load', () => {
    card.classList.toggle('landscape-design', image.naturalWidth > image.naturalHeight);
  }, { once: true });
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
  const description = document.createElement('p');
  description.textContent = design.description;
  caption.append(number, title, description);
  card.append(image, caption);
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Preview ${design.title}`);
  const open = () => openPreview(design, category, index);
  card.addEventListener('click', open);
  card.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
  return card;
}

function openPreview(design, category, index) {
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

async function loadCategory() {
  if (!CATEGORY_SLUGS.includes(currentCategory)) throw new Error('This design category does not exist.');
  const response = await fetch(`/api/categories/${encodeURIComponent(currentCategory)}/designs`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`The design archive could not be loaded (HTTP ${response.status}).`);
  const { category, designs, sections = [] } = await response.json();
  gallery.dataset.category = category.slug;
  document.title = `${category.title} — Rupesh Ravu`;
  document.getElementById('categoryNumber').textContent = `0${CATEGORY_SLUGS.indexOf(category.slug) + 1} / 04 — FULL ARCHIVE`;
  document.getElementById('categoryTitle').textContent = category.title;
  document.getElementById('categoryDescription').textContent = category.description;
  const unassignedDesigns = designs.filter(design => !design.sectionId);
  gallery.hidden = unassignedDesigns.length === 0;
  gallery.replaceChildren(...unassignedDesigns.map((design, index) => makeCard(design, category, index)));
  sectionsContainer.replaceChildren(...sections.map((section, sectionIndex) => {
    const sectionElement = document.createElement('section');
    sectionElement.className = 'internal-category-section';
    const heading = document.createElement('div');
    heading.className = 'internal-section-heading';
    const kicker = document.createElement('p');
    kicker.className = 'kicker';
    kicker.textContent = `SECTION ${String(sectionIndex + 1).padStart(2, '0')}`;
    const title = document.createElement('h2');
    title.textContent = section.title;
    heading.append(kicker, title);
    const sectionGallery = document.createElement('div');
    sectionGallery.className = 'grid category-gallery';
    sectionGallery.dataset.category = category.slug;
    sectionGallery.replaceChildren(...section.designs.map((design, index) => makeCard(design, category, index)));
    sectionElement.append(heading, sectionGallery);
    return sectionElement;
  }));
}

portfolioUpdateChannel?.addEventListener('message', event => {
  if (event.data === 'refresh') loadCategory().catch(error => {
    console.error(error);
    showCategoryError(`${error.message} Please refresh or contact the site administrator.`);
  });
});

document.getElementById('close').addEventListener('click', () => modal.classList.remove('open'));
modal.addEventListener('click', event => {
  if (event.target === modal) modal.classList.remove('open');
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') modal.classList.remove('open');
});

loadCategory().catch(error => {
  console.error(error);
  showCategoryError(`${error.message} Please refresh or contact the site administrator.`);
});
