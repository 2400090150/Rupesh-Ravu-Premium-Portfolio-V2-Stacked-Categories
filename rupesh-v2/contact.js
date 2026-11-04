async function updateContactDetails() {
  const response = await fetch('/api/portfolio', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Contact information could not be loaded (HTTP ${response.status}).`);
  const { content } = await response.json();
  const phone = document.getElementById('contactPhone');
  const phoneLink = document.getElementById('contactPhoneLink');
  const email = document.getElementById('contactEmail');
  const emailLink = document.getElementById('contactEmailLink');
  const instagram = document.getElementById('contactInstagram');
  const instagramLink = document.getElementById('contactInstagramLink');
  phone.textContent = content.contactPhone;
  phoneLink.href = `https://wa.me/${content.contactPhone.replace(/\D/g, '')}`;
  email.textContent = content.contactEmail;
  emailLink.href = `mailto:${content.contactEmail}?subject=Project%20Inquiry`;
  const handle = content.contactInstagram.startsWith('@') ? content.contactInstagram : `@${content.contactInstagram}`;
  instagram.textContent = handle;
  instagramLink.href = `https://www.instagram.com/${encodeURIComponent(handle.slice(1))}/`;
}

updateContactDetails().catch(error => {
  console.error(error);
  const message = document.createElement('p');
  message.className = 'portfolio-status';
  message.textContent = `${error.message} Please refresh or contact the site administrator.`;
  document.querySelector('.contact-page').append(message);
});
