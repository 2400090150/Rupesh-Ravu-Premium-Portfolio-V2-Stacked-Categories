const adminStatus = document.getElementById('adminStatus');
const setupForm = document.getElementById('setupForm');
const loginForm = document.getElementById('loginForm');
const dashboard = document.getElementById('dashboard');
const designForm = document.getElementById('designForm');
const designCategory = document.getElementById('designCategory');
const libraryCategory = document.getElementById('libraryCategory');
const designList = document.getElementById('designList');
const featuredCount = document.getElementById('featuredCount');
const saveFeaturedButton = document.getElementById('saveFeaturedSelection');
const saveDesignOrderButton = document.getElementById('saveDesignOrder');
const certificateForm = document.getElementById('certificateForm');
const certificateList = document.getElementById('certificateList');
const saveCertificateOrderButton = document.getElementById('saveCertificateOrder');
const toolForm = document.getElementById('toolForm');
const toolList = document.getElementById('toolList');
const saveToolChangesButton = document.getElementById('saveToolChanges');
const siteLogoForm = document.getElementById('siteLogoForm');
const siteLogoPreview = document.getElementById('siteLogoPreview');
const portfolioUpdateChannel = 'BroadcastChannel' in window
  ? new BroadcastChannel('ravu-portfolio-updates')
  : null;
const backgroundControls = document.getElementById('logoBackgroundControls');
const backgroundSelect = document.getElementById('displayBackgroundColor');
const backgroundPicker = document.getElementById('displayBackgroundPicker');
const backgroundHex = document.getElementById('displayBackgroundHex');
const logoPreview = document.getElementById('logoPreview');
const logoPreviewImage = document.getElementById('logoPreviewImage');
let csrfToken = '';
let dashboardRecoveryAttempts = 0;
let categories = [];
let currentDesigns = [];
let currentCertificates = [];
let currentTools = [];
let savedDesignOrder = [];
let savedFeaturedIds = [];
let savedDesignCategory = '';
let savedCertificateOrder = [];
let savedTools = [];
let customSections = [];
let logoPreviewUrl = '';

function notifyPortfolioUpdated() {
  portfolioUpdateChannel?.postMessage('refresh');
}

function showStatus(message, isError = false) {
  adminStatus.textContent = message;
  adminStatus.hidden = false;
  adminStatus.dataset.error = String(isError);
  adminStatus.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const method = String(options.method || 'GET').toUpperCase();
  if (csrfToken && method !== 'GET') headers.set('x-csrf-token', csrfToken);
  const canRetry = method === 'GET';
  const isSessionRequest = url.startsWith('/api/admin/session');
  let response;
  let data;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
      data = await response.json().catch(() => ({}));
    } catch (error) {
      if (!canRetry || attempt >= 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
      continue;
    }
    const storageUnavailable = isSessionRequest && data.storageUnavailable;
    if (canRetry && attempt < 4 && (!response.ok && response.status >= 500 || storageUnavailable)) {
      await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
      continue;
    }
    break;
  }
  if (!response.ok) {
    const message = data.detail ? `${data.error || 'The request failed.'} ${data.detail}` : data.error;
    const error = new Error(message || `Request failed (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function setAuthenticated(session) {
  csrfToken = session.csrfToken || '';
  document.getElementById('authPanel').hidden = Boolean(csrfToken);
  dashboard.hidden = !csrfToken;
  if (csrfToken) loadDashboardWithRecovery();
}

function loadDashboardWithRecovery() {
  loadDashboard().then(() => {
    const recovered = dashboardRecoveryAttempts > 0;
    dashboardRecoveryAttempts = 0;
    if (recovered) showStatus('Dashboard reconnected. Admin changes are ready.');
  }).catch(error => {
    showStatus(error.message, true);
    if (dashboardRecoveryAttempts < 4 && (error.status >= 500 || error instanceof TypeError)) {
      dashboardRecoveryAttempts++;
      setTimeout(loadDashboardWithRecovery, 800 * dashboardRecoveryAttempts);
    }
  });
}

function addSelectOptions(select) {
  const previousValue = select.value;
  select.replaceChildren(...categories.map(category => {
    const option = document.createElement('option');
    option.value = category.slug;
    option.textContent = category.title;
    return option;
  }));
  if (categories.length && (!previousValue || !categories.some(category => category.slug === previousValue))) {
    select.value = categories[0].slug;
  } else if (select.value) {
    const active = categories.find(category => category.slug === select.value);
    if (!active) select.value = categories[0].slug;
  }
}

async function initialize() {
  let session;
  let attempt = 0;
  for (;;) {
    try {
      session = await request('/api/admin/session');
    } catch (error) {
      if (!(error.status >= 500 || error instanceof TypeError)) throw error;
    }
    if (session && !session.storageUnavailable) break;
    showStorageReconnect();
    const delay = Math.min(1000 * (2 ** Math.min(attempt, 4)), 15000);
    attempt++;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  if (!session.storageConfigured) {
    if (session.storageUnavailable) {
      document.querySelector('#storageSetup h2').textContent = 'Admin editing is temporarily unavailable.';
      document.getElementById('storageSetupMessage').textContent =
        'The portfolio is available in read-only mode because persistent storage could not be reached. Check the deployment configuration and server logs before enabling admin edits.';
      document.getElementById('storageMigrationHelp').hidden = true;
    } else {
      document.querySelector('#storageSetup h2').textContent = 'Admin editing is unavailable.';
      document.getElementById('storageSetupMessage').textContent =
        'The live portfolio is showing its original artwork in read-only mode. To enable sign-in, saved edits, and durable image uploads, configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy.';
      document.getElementById('storageMigrationHelp').hidden = false;
    }
    document.getElementById('storageSetup').hidden = false;
    return;
  }
  document.getElementById('storageSetup').hidden = true;
  if (session.authenticated) {
    setAuthenticated(session);
    return;
  }
  setupForm.hidden = !session.requiresSetup;
  loginForm.hidden = session.requiresSetup;
}

function showStorageReconnect() {
  setupForm.hidden = true;
  loginForm.hidden = true;
  const storageSetup = document.getElementById('storageSetup');
  storageSetup.hidden = false;
  storageSetup.querySelector('h2').textContent = 'Reconnecting to persistent storage...';
  document.getElementById('storageSetupMessage').textContent =
    'The storage connection is temporarily unavailable. This page will keep retrying automatically.';
  document.getElementById('storageMigrationHelp').hidden = true;
}

async function loadDashboard() {
  const contentResult = await request('/api/admin/content');
  categories = contentResult.categories;
  customSections = contentResult.customSections || [];
  addSelectOptions(designCategory);
  addSelectOptions(libraryCategory);
  updateLogoBackgroundControls();
  fillContentForm(contentResult.content, categories, customSections);
  await Promise.all([loadDesigns(), loadCertificates(), loadTools()]);
}

function fillContentForm(content, sectionData, customSectionData) {
  const form = document.getElementById('contentForm');
  for (const [key, value] of Object.entries(content)) {
    const field = form.elements.namedItem(key);
    if (field) field.value = value;
  }
  const settings = document.getElementById('sectionSettings');
  settings.replaceChildren();
  const heading = document.createElement('p');
  heading.className = 'kicker wide-field';
  heading.textContent = 'HOMEPAGE DESIGN SECTIONS';
  settings.append(heading);
  sectionData.forEach(category => {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'section-setting';
    const legend = document.createElement('legend');
    legend.textContent = category.slug;
    const titleLabel = document.createElement('label');
    titleLabel.textContent = 'Section title';
    const titleInput = document.createElement('input');
    titleInput.name = `section-title-${category.slug}`;
    titleInput.value = category.title;
    titleInput.maxLength = 80;
    titleInput.required = true;
    titleLabel.append(titleInput);
    const marqueeLabel = document.createElement('label');
    marqueeLabel.textContent = 'Moving marquee text';
    const marqueeInput = document.createElement('input');
    marqueeInput.name = `section-marquee-${category.slug}`;
    marqueeInput.value = category.marqueeText;
    marqueeInput.maxLength = 80;
    marqueeInput.required = true;
    marqueeLabel.append(marqueeInput);
    const descriptionLabel = document.createElement('label');
    descriptionLabel.textContent = 'Section description';
    const descriptionInput = document.createElement('textarea');
    descriptionInput.name = `section-description-${category.slug}`;
    descriptionInput.value = category.description;
    descriptionInput.rows = 3;
    descriptionInput.maxLength = 500;
    descriptionInput.required = true;
    descriptionLabel.append(descriptionInput);
    const visibilityLabel = document.createElement('label');
    visibilityLabel.className = 'visibility-control';
    const visibilityInput = document.createElement('input');
    visibilityInput.name = `section-visible-${category.slug}`;
    visibilityInput.type = 'checkbox';
    visibilityInput.checked = category.visible;
    visibilityLabel.append(visibilityInput, document.createTextNode(' Show on homepage'));
    fieldset.append(legend, titleLabel, marqueeLabel, descriptionLabel, visibilityLabel);
    settings.append(fieldset);
  });
  renderCustomSections(customSectionData);
}

function renderCustomSections(sections = customSections) {
  customSections = sections;
  const container = document.getElementById('customSectionSettings');
  container.replaceChildren();
  if (!customSections.length) {
    const empty = document.createElement('p');
    empty.className = 'form-help wide-field';
    empty.textContent = 'No additional homepage sections yet.';
    container.append(empty);
    return;
  }
  customSections.forEach((section, index) => {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'section-setting custom-home-setting';
    const legend = document.createElement('legend');
    legend.textContent = `CUSTOM SECTION ${String(index + 1).padStart(2, '0')}`;
    const titleLabel = document.createElement('label');
    titleLabel.textContent = 'Section title';
    const titleInput = document.createElement('input');
    titleInput.value = section.pendingTitle ?? section.title;
    titleInput.maxLength = 80;
    titleInput.required = true;
    titleInput.addEventListener('input', () => { section.title = titleInput.value; });
    titleLabel.append(titleInput);
    const descriptionLabel = document.createElement('label');
    descriptionLabel.textContent = 'Section description';
    const descriptionInput = document.createElement('textarea');
    descriptionInput.value = section.description;
    descriptionInput.rows = 3;
    descriptionInput.maxLength = 1000;
    descriptionInput.required = true;
    descriptionInput.addEventListener('input', () => { section.description = descriptionInput.value; });
    descriptionLabel.append(descriptionInput);
    const visibilityLabel = document.createElement('label');
    visibilityLabel.className = 'visibility-control';
    const visibilityInput = document.createElement('input');
    visibilityInput.type = 'checkbox';
    visibilityInput.checked = section.visible;
    visibilityInput.addEventListener('change', () => { section.visible = visibilityInput.checked; });
    visibilityLabel.append(visibilityInput, document.createTextNode(' Show on homepage'));
    const actions = document.createElement('div');
    actions.className = 'design-row-actions custom-section-actions';
    const moveUp = document.createElement('button');
    moveUp.type = 'button';
    moveUp.textContent = '↑';
    moveUp.setAttribute('aria-label', 'Move section up');
    moveUp.disabled = index === 0;
    moveUp.addEventListener('click', () => moveCustomSection(index, -1));
    const moveDown = document.createElement('button');
    moveDown.type = 'button';
    moveDown.textContent = '↓';
    moveDown.setAttribute('aria-label', 'Move section down');
    moveDown.disabled = index === customSections.length - 1;
    moveDown.addEventListener('click', () => moveCustomSection(index, 1));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      customSections.splice(index, 1);
      renderCustomSections();
    });
    actions.append(moveUp, moveDown, remove);
    fieldset.append(legend, titleLabel, descriptionLabel, visibilityLabel, actions);
    container.append(fieldset);
  });
}

function moveCustomSection(index, offset) {
  const targetIndex = index + offset;
  if (targetIndex < 0 || targetIndex >= customSections.length) return;
  [customSections[index], customSections[targetIndex]] = [customSections[targetIndex], customSections[index]];
  renderCustomSections();
}

function updateFeaturedCount() {
  const selected = designList.querySelectorAll('input[name="featured"]:checked').length;
  featuredCount.textContent = `${selected} of 4 selected · save to publish`;
  updateDesignSaveButtons();
}

function updateDesignSaveButtons() {
  const designIds = currentDesigns.map(design => design.id);
  const selectedIds = [...designList.querySelectorAll('input[name="featured"]:checked')].map(input => input.value);
  saveDesignOrderButton.disabled = designIds.length === savedDesignOrder.length &&
    designIds.every((id, index) => id === savedDesignOrder[index]);
  saveFeaturedButton.disabled = selectedIds.length === savedFeaturedIds.length &&
    selectedIds.every((id, index) => id === savedFeaturedIds[index]);
}

async function saveFeaturedSelection() {
  const checkboxes = [...designList.querySelectorAll('input[name="featured"]')];
  const designIds = checkboxes.filter(input => input.checked).map(input => input.value);
  if (designIds.length > 4) {
    showStatus('Choose up to four designs for this homepage section.', true);
    return;
  }
  if (designIds.length === 0) {
    showStatus('Keep at least one design selected for this homepage section.', true);
    return;
  }

  saveFeaturedButton.disabled = true;
  try {
    await request('/api/admin/featured', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: libraryCategory.value, designIds })
    });
    savedFeaturedIds = designIds;
    notifyPortfolioUpdated();
    updateDesignSaveButtons();
    showStatus('Homepage selection updated.');
  } catch (error) {
    updateDesignSaveButtons();
    showStatus(error.message, true);
  }
}

function renderDesigns() {
  designList.replaceChildren();
  currentDesigns.forEach((design, index) => {
    const row = document.createElement('article');
    row.className = 'design-row';
    row.dataset.designId = design.id;
    const featureLabel = document.createElement('label');
    featureLabel.className = 'feature-pick';
    const feature = document.createElement('input');
    feature.type = 'checkbox';
    feature.name = 'featured';
    feature.value = design.id;
    feature.checked = design.featured;
    feature.setAttribute('aria-label', `Feature ${design.title} on the homepage`);
    feature.addEventListener('change', () => {
      design.featured = feature.checked;
      updateFeaturedCount();
    });
    featureLabel.append(feature);
    const image = document.createElement('img');
    image.src = design.image;
    image.alt = '';
    image.loading = 'lazy';
    if (design.category === 'logo-designs') {
      image.className = 'logo-preview-thumb';
      image.style.backgroundColor = design.displayBackgroundColor || '#ffffff';
    }
    const details = document.createElement('div');
    details.className = 'design-row-details';
    const title = document.createElement('h3');
    title.textContent = design.title;
    const description = document.createElement('p');
    description.textContent = design.description;
    details.append(title, description);
    const actions = document.createElement('div');
    actions.className = 'design-row-actions';
    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '↑';
    up.title = 'Move design up';
    up.disabled = index === 0;
    up.addEventListener('click', () => moveDesign(index, -1));
    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '↓';
    down.title = 'Move design down';
    down.disabled = index === currentDesigns.length - 1;
    down.addEventListener('click', () => moveDesign(index, 1));
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => editDesign(design).catch(error => showStatus(error.message, true)));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => deleteDesign(design));
    actions.append(up, down, edit, remove);
    row.append(featureLabel, image, details, actions);
    designList.append(row);
  });
  updateFeaturedCount();
}

async function loadDesigns(category = libraryCategory.value) {
  const result = await request(`/api/admin/designs?category=${encodeURIComponent(category)}`);
  if (category !== libraryCategory.value) return;
  savedDesignCategory = category;
  currentDesigns = result.designs;
  savedDesignOrder = currentDesigns.map(design => design.id);
  savedFeaturedIds = currentDesigns.filter(design => design.featured).map(design => design.id);
  renderDesigns();
}

function moveDesign(index, direction) {
  const target = index + direction;
  [currentDesigns[index], currentDesigns[target]] = [currentDesigns[target], currentDesigns[index]];
  renderDesigns();
}

async function saveDesignOrder() {
  const designIds = currentDesigns.map(design => design.id);
  saveDesignOrderButton.disabled = true;
  try {
    await request('/api/admin/design-order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: libraryCategory.value, designIds })
    });
    savedDesignOrder = designIds;
    notifyPortfolioUpdated();
    updateDesignSaveButtons();
    showStatus('Design order updated.');
  } catch (error) {
    updateDesignSaveButtons();
    showStatus(error.message, true);
  }
}

async function editDesign(design) {
  designForm.elements.namedItem('editingId').value = design.id;
  designCategory.value = design.category;
  designForm.elements.namedItem('title').value = design.title;
  designForm.elements.namedItem('description').value = design.description;
  const designBackgroundColor = design.displayBackgroundColor || '#ffffff';
  backgroundHex.value = designBackgroundColor;
  backgroundPicker.value = designBackgroundColor;
  backgroundSelect.value = ['#ffffff', '#000000', '#d9d9d9', '#333333'].includes(designBackgroundColor)
    ? designBackgroundColor
    : 'custom';
  setLogoPreviewImage(design.image);
  updateLogoBackgroundControls();
  const imageInput = designForm.elements.namedItem('image');
  imageInput.required = false;
  imageInput.value = '';
  designForm.querySelector('button[type="submit"]').textContent = 'Save design changes';
  document.getElementById('cancelEdit').hidden = false;
  designForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetDesignForm() {
  designForm.reset();
  designForm.elements.namedItem('editingId').value = '';
  designForm.elements.namedItem('image').required = true;
  designForm.querySelector('button[type="submit"]').textContent = 'Upload design';
  document.getElementById('cancelEdit').hidden = true;
  backgroundSelect.value = '#ffffff';
  backgroundHex.value = '#ffffff';
  backgroundPicker.value = '#ffffff';
  updateLogoPreviewBackground();
  setLogoPreviewImage('');
  updateLogoBackgroundControls();
}

function updateLogoBackgroundControls() {
  const isLogo = designCategory.value === 'logo-designs';
  backgroundControls.hidden = !isLogo;
  if (isLogo && logoPreviewUrl) updateLogoPreviewBackground();
}

function updateLogoPreviewBackground() {
  const color = /^#[\da-f]{6}$/i.test(backgroundHex.value) ? backgroundHex.value : '#ffffff';
  logoPreview.style.backgroundColor = color;
  if (designList) {
    const editingId = designForm.elements.namedItem('editingId').value;
    const existing = currentDesigns.find(design => design.id === editingId);
    if (existing) {
      const thumbnail = [...designList.querySelectorAll('.logo-preview-thumb')].find(image =>
        image.closest('.design-row')?.dataset.designId === existing.id
      );
      if (thumbnail) thumbnail.style.backgroundColor = color;
    }
  }
}

function setLogoPreviewImage(source) {
  if (logoPreviewUrl) {
    URL.revokeObjectURL(logoPreviewUrl);
    logoPreviewUrl = '';
  }
  if (source instanceof File) {
    logoPreviewUrl = URL.createObjectURL(source);
    logoPreviewImage.src = logoPreviewUrl;
    logoPreviewImage.hidden = false;
  } else if (typeof source === 'string' && source) {
    logoPreviewImage.src = source;
    logoPreviewImage.hidden = false;
  } else {
    logoPreviewImage.removeAttribute('src');
    logoPreviewImage.hidden = true;
  }
}

function updatePresetFromColor(color) {
  backgroundSelect.value = ['#ffffff', '#000000', '#d9d9d9', '#333333'].includes(color.toLowerCase())
    ? color.toLowerCase()
    : 'custom';
}

backgroundSelect.addEventListener('change', () => {
  if (backgroundSelect.value === 'custom') {
    backgroundPicker.click();
    return;
  }
  backgroundHex.value = backgroundSelect.value;
  backgroundPicker.value = backgroundSelect.value;
  updateLogoPreviewBackground();
});
backgroundPicker.addEventListener('input', () => {
  backgroundHex.value = backgroundPicker.value;
  updatePresetFromColor(backgroundPicker.value);
  updateLogoPreviewBackground();
});
backgroundHex.addEventListener('input', () => {
  if (!/^#[\da-f]{6}$/i.test(backgroundHex.value)) return;
  backgroundPicker.value = backgroundHex.value;
  updatePresetFromColor(backgroundHex.value);
  updateLogoPreviewBackground();
});
designCategory.addEventListener('change', updateLogoBackgroundControls);
designForm.elements.namedItem('image').addEventListener('change', event => {
  const [file] = event.currentTarget.files;
  if (file) setLogoPreviewImage(file);
});

async function deleteDesign(design) {
  const pendingWarning = hasUnsavedCategoryChanges() ? ' Unsaved category changes will be discarded.' : '';
  if (!window.confirm(`Delete "${design.title}"? This cannot be undone.${pendingWarning}`)) return;
  try {
    await request(`/api/admin/designs/${encodeURIComponent(design.id)}`, { method: 'DELETE' });
    notifyPortfolioUpdated();
    await loadDesigns();
    showStatus(`"${design.title}" was deleted.`);
  } catch (error) {
    showStatus(error.message, true);
  }
}

function assetAction(label, action, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener('click', action);
  return button;
}

function renderCertificates() {
  certificateList.replaceChildren();
  updateCertificateOrderButton();
  if (!currentCertificates.length) {
    const empty = document.createElement('p');
    empty.className = 'form-help';
    empty.textContent = 'No certificates uploaded yet.';
    certificateList.append(empty);
    return;
  }
  currentCertificates.forEach((certificate, index) => {
    const row = document.createElement('article');
    row.className = 'asset-row';
    const details = document.createElement('div');
    details.className = 'asset-row-details';
    const title = document.createElement('h3');
    title.textContent = certificate.title;
    const description = document.createElement('p');
    description.textContent = certificate.description || `${certificate.fileType.toUpperCase()} certificate`;
    const fileLink = document.createElement('a');
    fileLink.href = certificate.file;
    fileLink.target = '_blank';
    fileLink.rel = 'noopener noreferrer';
    fileLink.textContent = certificate.fileType === 'link' ? 'Open certificate link ↗' : `Open ${certificate.fileType.toUpperCase()}`;
    details.append(title, description, fileLink);
    const actions = document.createElement('div');
    actions.className = 'asset-row-actions';
    actions.append(
      assetAction('↑', () => moveAsset('certificates', index, -1), index === 0),
      assetAction('↓', () => moveAsset('certificates', index, 1), index === currentCertificates.length - 1),
      assetAction('Edit', () => editCertificate(certificate)),
      assetAction('Delete', () => deleteCertificate(certificate))
    );
    row.append(details, actions);
    certificateList.append(row);
  });
}

async function loadCertificates() {
  const result = await request('/api/admin/certificates');
  currentCertificates = result.certificates;
  savedCertificateOrder = currentCertificates.map(certificate => certificate.id);
  renderCertificates();
}

function editCertificate(certificate) {
  certificateForm.elements.namedItem('editingId').value = certificate.id;
  certificateForm.elements.namedItem('title').value = certificate.title;
  certificateForm.elements.namedItem('description').value = certificate.description;
  certificateForm.elements.namedItem('file').value = '';
  certificateForm.elements.namedItem('certificateUrl').value = certificate.fileType === 'link' ? certificate.file : '';
  certificateForm.querySelector('button[type="submit"]').textContent = 'Save certificate changes';
  document.getElementById('cancelCertificateEdit').hidden = false;
  certificateForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetCertificateForm() {
  certificateForm.reset();
  certificateForm.elements.namedItem('editingId').value = '';
  certificateForm.querySelector('button[type="submit"]').textContent = 'Upload certificate';
  document.getElementById('cancelCertificateEdit').hidden = true;
}

async function deleteCertificate(certificate) {
  if (!window.confirm(`Delete "${certificate.title}"? This cannot be undone.`)) return;
  try {
    await request(`/api/admin/certificates/${encodeURIComponent(certificate.id)}`, { method: 'DELETE' });
    notifyPortfolioUpdated();
    await loadCertificates();
    showStatus(`"${certificate.title}" was deleted.`);
  } catch (error) {
    showStatus(error.message, true);
  }
}

function renderTools() {
  toolList.replaceChildren();
  updateToolSaveButton();
  if (!currentTools.length) {
    const empty = document.createElement('p');
    empty.className = 'form-help';
    empty.textContent = 'No tool logos uploaded yet.';
    toolList.append(empty);
    return;
  }
  currentTools.forEach((tool, index) => {
    const row = document.createElement('article');
    row.className = 'design-row tool-admin-row';
    row.dataset.toolId = tool.id;
    const image = document.createElement('img');
    image.src = tool.image;
    image.alt = tool.name;
    image.loading = 'lazy';
    image.className = 'tool-admin-image';
    const details = document.createElement('div');
    details.className = 'design-row-details';
    const title = document.createElement('h3');
    title.textContent = tool.name;
    const category = document.createElement('p');
    category.textContent = tool.category || 'Uncategorized';
    details.append(title, category);
    const visibilityLabel = document.createElement('label');
    visibilityLabel.className = 'visibility-control tool-visibility';
    const visibility = document.createElement('input');
    visibility.type = 'checkbox';
    visibility.checked = tool.visible;
    visibility.setAttribute('aria-label', `Show ${tool.name} on the homepage`);
    visibility.addEventListener('change', () => {
      tool.visible = visibility.checked;
      updateToolSaveButton();
    });
    visibilityLabel.append(visibility, document.createTextNode(' Show'));
    const actions = document.createElement('div');
    actions.className = 'design-row-actions';
    actions.append(
      assetAction('↑', () => moveAsset('tools', index, -1), index === 0),
      assetAction('↓', () => moveAsset('tools', index, 1), index === currentTools.length - 1),
      assetAction('Edit', () => editTool(tool)),
      assetAction('Delete', () => deleteTool(tool))
    );
    row.append(image, details, visibilityLabel, actions);
    toolList.append(row);
  });
}

async function loadTools() {
  const result = await request('/api/admin/tools');
  currentTools = result.tools;
  savedTools = currentTools.map(tool => ({ ...tool }));
  renderTools();
}

function moveAsset(type, index, direction) {
  const records = type === 'certificates' ? currentCertificates : currentTools;
  const target = index + direction;
  [records[index], records[target]] = [records[target], records[index]];
  if (type === 'certificates') renderCertificates();
  else renderTools();
}

function updateCertificateOrderButton() {
  saveCertificateOrderButton.disabled = currentCertificates.length === savedCertificateOrder.length &&
    currentCertificates.every((certificate, index) => certificate.id === savedCertificateOrder[index]);
}

async function saveCertificateOrder() {
  const ids = currentCertificates.map(certificate => certificate.id);
  saveCertificateOrderButton.disabled = true;
  try {
    await request('/api/admin/certificate-order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    savedCertificateOrder = ids;
    updateCertificateOrderButton();
    notifyPortfolioUpdated();
    showStatus('Certificate order updated.');
  } catch (error) {
    updateCertificateOrderButton();
    showStatus(error.message, true);
  }
}

function updateToolSaveButton() {
  const orderChanged = currentTools.length !== savedTools.length ||
    currentTools.some((tool, index) => tool.id !== savedTools[index]?.id);
  const visibilityChanged = currentTools.some(tool => {
    const savedTool = savedTools.find(item => item.id === tool.id);
    return savedTool && Boolean(tool.visible) !== Boolean(savedTool.visible);
  });
  saveToolChangesButton.disabled = !orderChanged && !visibilityChanged;
}

async function saveToolChanges() {
  const toolsToSave = currentTools.map(tool => ({ ...tool }));
  const savedToolOrder = toolsToSave.map(tool => tool.id);
  saveToolChangesButton.disabled = true;
  try {
    for (const tool of toolsToSave) {
      const savedTool = savedTools.find(item => item.id === tool.id);
      if (savedTool && Boolean(tool.visible) !== Boolean(savedTool.visible)) {
        await updateTool(tool, { visible: tool.visible });
      }
    }
    const orderChanged = savedToolOrder.length !== savedTools.length ||
      savedToolOrder.some((id, index) => id !== savedTools[index]?.id);
    if (orderChanged) {
      await request('/api/admin/tool-order', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: savedToolOrder })
      });
    }
    savedTools = toolsToSave;
    notifyPortfolioUpdated();
    updateToolSaveButton();
    showStatus('Tool logo changes saved.');
  } catch (error) {
    updateToolSaveButton();
    showStatus(error.message, true);
  }
}

function editTool(tool) {
  toolForm.elements.namedItem('editingId').value = tool.id;
  toolForm.elements.namedItem('name').value = tool.name;
  toolForm.elements.namedItem('category').value = tool.category;
  toolForm.elements.namedItem('visible').checked = tool.visible;
  toolForm.elements.namedItem('image').required = false;
  toolForm.elements.namedItem('image').value = '';
  toolForm.querySelector('button[type="submit"]').textContent = 'Save tool logo changes';
  document.getElementById('cancelToolEdit').hidden = false;
  toolForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetToolForm() {
  toolForm.reset();
  toolForm.elements.namedItem('editingId').value = '';
  toolForm.elements.namedItem('visible').checked = true;
  toolForm.elements.namedItem('image').required = true;
  toolForm.querySelector('button[type="submit"]').textContent = 'Upload tool logo';
  document.getElementById('cancelToolEdit').hidden = true;
}

async function updateTool(tool, changes) {
  const body = new FormData();
  body.set('name', changes.name ?? tool.name);
  body.set('category', changes.category ?? tool.category);
  body.set('visible', String(changes.visible ?? tool.visible));
  await request(`/api/admin/tools/${encodeURIComponent(tool.id)}`, { method: 'PUT', body });
}

async function deleteTool(tool) {
  if (!window.confirm(`Delete the "${tool.name}" logo? This cannot be undone.`)) return;
  try {
    await request(`/api/admin/tools/${encodeURIComponent(tool.id)}`, { method: 'DELETE' });
    notifyPortfolioUpdated();
    await loadTools();
    showStatus(`"${tool.name}" was deleted.`);
  } catch (error) {
    showStatus(error.message, true);
  }
}

setupForm.addEventListener('submit', async event => {
  event.preventDefault();
  const formData = new FormData(setupForm);
  try {
    const session = await request('/api/admin/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: formData.get('token'),
        email: formData.get('email'),
        password: formData.get('password')
      })
    });
    setupForm.reset();
    setAuthenticated(session);
    showStatus('Admin account created.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const session = await request('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: new FormData(loginForm).get('email'),
        password: new FormData(loginForm).get('password')
      })
    });
    loginForm.reset();
    setAuthenticated(session);
    showStatus('Signed in.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

function hasUnsavedCategoryChanges() {
  return !saveFeaturedButton.disabled || !saveDesignOrderButton.disabled;
}

designForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (hasUnsavedCategoryChanges() &&
      !window.confirm('Save this design and discard the unsaved category changes?')) return;
  const editingId = designForm.elements.namedItem('editingId').value;
  const body = new FormData(designForm);
  body.delete('editingId');
  body.set('displayBackgroundColor', designCategory.value === 'logo-designs' ? backgroundHex.value : '#ffffff');
  try {
    await request(editingId ? `/api/admin/designs/${encodeURIComponent(editingId)}` : '/api/admin/designs', {
      method: editingId ? 'PUT' : 'POST',
      body
    });
    notifyPortfolioUpdated();
    const category = designCategory.value;
    resetDesignForm();
    libraryCategory.value = category;
    await loadDesigns();
    showStatus(editingId ? 'Design details updated.' : 'Design uploaded and added to the homepage.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.getElementById('cancelEdit').addEventListener('click', resetDesignForm);
saveFeaturedButton.addEventListener('click', saveFeaturedSelection);
saveDesignOrderButton.addEventListener('click', saveDesignOrder);
libraryCategory.addEventListener('change', () => {
  if (hasUnsavedCategoryChanges() && !window.confirm('Discard unsaved changes for this category?')) {
    libraryCategory.value = savedDesignCategory;
    return;
  }
  loadDesigns().catch(error => showStatus(error.message, true));
});

certificateForm.addEventListener('submit', async event => {
  event.preventDefault();
  const editingId = certificateForm.elements.namedItem('editingId').value;
  const body = new FormData(certificateForm);
  body.delete('editingId');
  const certificateFile = certificateForm.elements.namedItem('file').files[0];
  const certificateUrl = certificateForm.elements.namedItem('certificateUrl').value.trim();
  if (certificateFile && certificateUrl) {
    showStatus('Choose either a certificate file or a URL, not both.', true);
    return;
  }
  if (!editingId && !certificateFile && !certificateUrl) {
    showStatus('Choose a certificate file or enter a certificate URL.', true);
    return;
  }
  try {
    await request(editingId
      ? `/api/admin/certificates/${encodeURIComponent(editingId)}`
      : '/api/admin/certificates', { method: editingId ? 'PUT' : 'POST', body });
    notifyPortfolioUpdated();
    resetCertificateForm();
    await loadCertificates();
    showStatus(editingId ? 'Certificate details updated.' : 'Certificate uploaded.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.getElementById('cancelCertificateEdit').addEventListener('click', resetCertificateForm);
saveCertificateOrderButton.addEventListener('click', saveCertificateOrder);
certificateForm.elements.namedItem('file').addEventListener('change', event => {
  if (event.currentTarget.files.length) certificateForm.elements.namedItem('certificateUrl').value = '';
});
certificateForm.elements.namedItem('certificateUrl').addEventListener('input', event => {
  if (event.currentTarget.value.trim()) certificateForm.elements.namedItem('file').value = '';
});

toolForm.addEventListener('submit', async event => {
  event.preventDefault();
  const editingId = toolForm.elements.namedItem('editingId').value;
  const body = new FormData(toolForm);
  body.delete('editingId');
  body.set('visible', String(toolForm.elements.namedItem('visible').checked));
  try {
    await request(editingId
      ? `/api/admin/tools/${encodeURIComponent(editingId)}`
      : '/api/admin/tools', { method: editingId ? 'PUT' : 'POST', body });
    notifyPortfolioUpdated();
    resetToolForm();
    await loadTools();
    showStatus(editingId ? 'Tool logo updated.' : 'Tool logo uploaded.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.getElementById('cancelToolEdit').addEventListener('click', resetToolForm);
saveToolChangesButton.addEventListener('click', saveToolChanges);

siteLogoForm.addEventListener('submit', async event => {
  event.preventDefault();
  const image = siteLogoForm.elements.namedItem('image').files[0];
  if (!image) {
    showStatus('Choose a PNG, JPG, or WebP logo image.', true);
    return;
  }
  const body = new FormData();
  body.set('image', image);
  try {
    await request('/api/admin/site-logo', { method: 'PUT', body });
    const updatedUrl = `/api/site-logo?updated=${Date.now()}`;
    siteLogoPreview.src = updatedUrl;
    document.querySelectorAll('header .logo img, .contact-logo img').forEach(logo => {
      logo.src = updatedUrl;
    });
    notifyPortfolioUpdated();
    siteLogoForm.reset();
    showStatus('Header logo updated across the website.');
  } catch (error) {
    const message = error.message === 'API route not found.'
      ? 'Restart the portfolio server to enable header logo uploads.'
      : error.message;
    showStatus(message, true);
  }
});

document.getElementById('contentForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const content = {};
  for (const key of ['heroTitle', 'heroLead', 'aboutName', 'aboutSummary', 'aboutText', 'contactPhone', 'contactEmail', 'contactInstagram']) {
    content[key] = formData.get(key);
  }
  const sectionSettings = categories.map(category => ({
    slug: category.slug,
    title: formData.get(`section-title-${category.slug}`),
    marqueeText: formData.get(`section-marquee-${category.slug}`),
    description: formData.get(`section-description-${category.slug}`),
    visible: formData.get(`section-visible-${category.slug}`) === 'on'
  }));
  const customSectionSettings = customSections.map(section => ({
    id: section.id,
    title: section.title,
    description: section.description,
    visible: section.visible
  }));
  try {
    const result = await request('/api/admin/content', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, categories: sectionSettings, customSections: customSectionSettings })
    });
    notifyPortfolioUpdated();
    categories = result.categories;
    customSections = result.customSections;
    fillContentForm(result.content, categories, customSections);
    showStatus('Homepage and contact information updated.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.getElementById('addCustomSection').addEventListener('click', () => {
  if (customSections.length >= 50) {
    showStatus('A maximum of 50 custom homepage sections is supported.', true);
    return;
  }
  customSections.push({
    id: crypto.randomUUID(),
    title: 'New section',
    description: 'Add a description for this section.',
    visible: true
  });
  renderCustomSections();
});

document.getElementById('logoutButton').addEventListener('click', async () => {
  try {
    await request('/api/admin/logout', { method: 'POST' });
    csrfToken = '';
    dashboard.hidden = true;
    loginForm.hidden = false;
    document.getElementById('authPanel').hidden = false;
    showStatus('Signed out.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

initialize().catch(error => showStatus(error.message, true));
