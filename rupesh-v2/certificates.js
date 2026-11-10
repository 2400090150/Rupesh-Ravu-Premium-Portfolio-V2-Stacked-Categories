const gallery = document.getElementById('certificatesGallery');
const statusMessage = document.getElementById('certificatesStatus');
const certificateDialog = document.getElementById('certificateDialog');
const certificateDialogTitle = document.getElementById('certificateDialogTitle');
const certificateDialogDescription = document.getElementById('certificateDialogDescription');
const certificateDialogDocument = document.getElementById('certificateDialogDocument');
const certificateDialogActions = document.getElementById('certificateDialogActions');

function openCertificate(certificate) {
  certificateDialogTitle.textContent = certificate.title;
  certificateDialogDescription.textContent = certificate.description;
  certificateDialogDescription.hidden = !certificate.description;
  certificateDialogDocument.replaceChildren();
  certificateDialogActions.replaceChildren();

  if (certificate.fileType === 'link') {
    const onlineLink = document.createElement('a');
    onlineLink.href = certificate.file;
    onlineLink.target = '_blank';
    onlineLink.rel = 'noopener noreferrer';
    onlineLink.textContent = 'Open certificate online ↗';
    certificateDialogActions.append(onlineLink);
  } else {
    if (certificate.fileType === 'pdf') {
      const pdf = document.createElement('iframe');
      pdf.src = certificate.file;
      pdf.title = certificate.title;
      certificateDialogDocument.append(pdf);
    } else {
      const image = document.createElement('img');
      image.src = certificate.file;
      image.alt = certificate.title;
      certificateDialogDocument.append(image);
    }

    const download = document.createElement('a');
    download.href = `${certificate.file}?download=1`;
    download.setAttribute('download', '');
    download.textContent = 'Download certificate ↗';
    certificateDialogActions.append(download);
  }
  certificateDialog.showModal();
}

document.getElementById('closeCertificateDialog').addEventListener('click', () => certificateDialog.close());
certificateDialog.addEventListener('click', event => {
  if (event.target === certificateDialog) certificateDialog.close();
});
certificateDialog.addEventListener('close', () => {
  certificateDialogDocument.replaceChildren();
});

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
    const openButton = document.createElement('button');
    openButton.className = 'certificate-card-open';
    openButton.type = 'button';
    const preview = document.createElement('span');
    preview.className = 'certificate-card-preview';
    if (certificate.fileType === 'pdf') {
      const pdf = document.createElement('iframe');
      pdf.src = certificate.file;
      pdf.title = '';
      pdf.loading = 'lazy';
      pdf.tabIndex = -1;
      pdf.setAttribute('aria-hidden', 'true');
      preview.append(pdf);
    } else if (certificate.fileType === 'link') {
      preview.classList.add('certificate-card-online');
      preview.textContent = 'Online certificate ↗';
    } else {
      const image = document.createElement('img');
      image.src = certificate.file;
      image.alt = '';
      image.loading = 'lazy';
      preview.append(image);
    }
    const title = document.createElement('h2');
    title.textContent = certificate.title;
    const action = document.createElement('span');
    action.className = 'certificate-card-action';
    action.textContent = 'View certificate ↗';
    openButton.setAttribute('aria-label', `View certificate and description: ${certificate.title}`);
    openButton.append(preview, title, action);
    openButton.addEventListener('click', () => openCertificate(certificate));
    card.append(openButton);
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
