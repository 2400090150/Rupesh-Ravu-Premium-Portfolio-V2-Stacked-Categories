const gallery = document.getElementById('certificatesGallery');
const statusMessage = document.getElementById('certificatesStatus');

async function loadCertificates() {
  const response = await fetch('/api/certificates', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Certificates could not be loaded (HTTP ${response.status}).`);
  const { certificates } = await response.json();
  if (!Array.isArray(certificates)) throw new Error('The certificate archive is invalid.');
  if (certificates.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'tool-empty';
    empty.textContent = 'Certificates will appear here when they are added.';
    gallery.replaceChildren(empty);
    return;
  }
  gallery.replaceChildren(...certificates.map(certificate => {
    const card = document.createElement('article');
    card.className = 'certificate-card';
    const previewLink = document.createElement('a');
    previewLink.className = 'certificate-preview';
    previewLink.href = certificate.file;
    previewLink.target = '_blank';
    previewLink.rel = 'noopener noreferrer';
    previewLink.setAttribute('aria-label', `${certificate.fileType === 'link' ? 'Open online' : 'View'} certificate: ${certificate.title}`);
    if (certificate.fileType === 'link') {
      previewLink.classList.add('certificate-online-link');
      const linkLabel = document.createElement('span');
      linkLabel.textContent = 'View online certificate ↗';
      previewLink.append(linkLabel);
    } else if (certificate.fileType === 'pdf') {
      const pdf = document.createElement('iframe');
      pdf.src = certificate.file;
      pdf.title = certificate.title;
      pdf.loading = 'lazy';
      pdf.tabIndex = -1;
      pdf.setAttribute('aria-hidden', 'true');
      previewLink.append(pdf);
    } else {
      const image = document.createElement('img');
      image.src = certificate.file;
      image.alt = certificate.title;
      image.loading = 'lazy';
      previewLink.append(image);
    }
    const details = document.createElement('div');
    details.className = 'certificate-details';
    const title = document.createElement('h2');
    title.textContent = certificate.title;
    const description = document.createElement('p');
    description.textContent = certificate.description;
    details.append(title, description);
    if (certificate.fileType === 'link') {
      const openLink = document.createElement('a');
      openLink.className = 'certificate-download';
      openLink.href = certificate.file;
      openLink.target = '_blank';
      openLink.rel = 'noopener noreferrer';
      openLink.textContent = 'Open certificate ↗';
      details.append(openLink);
    } else {
      const download = document.createElement('a');
      download.className = 'certificate-download';
      download.href = `${certificate.file}?download=1`;
      download.setAttribute('download', '');
      download.textContent = 'Download certificate ↗';
      details.append(download);
    }
    card.append(previewLink, details);
    return card;
  }));
}

loadCertificates().catch(error => {
  console.error(error);
  statusMessage.textContent = `${error.message} Please refresh or contact the site administrator.`;
  statusMessage.hidden = false;
});

let lastCertificatesResumeRefresh = 0;
function refreshCertificatesOnResume() {
  if (document.visibilityState !== 'visible' || Date.now() - lastCertificatesResumeRefresh < 1000) return;
  lastCertificatesResumeRefresh = Date.now();
  loadCertificates().catch(error => {
    console.error(error);
    statusMessage.textContent = `${error.message} Please refresh or contact the site administrator.`;
    statusMessage.hidden = false;
  });
}
window.addEventListener('focus', refreshCertificatesOnResume);
document.addEventListener('visibilitychange', refreshCertificatesOnResume);
