const menuButton = document.querySelector('.menu');
const navigation = menuButton && document.getElementById(menuButton.getAttribute('aria-controls'));

if (menuButton && navigation) {
  const setMenuOpen = open => {
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    navigation.classList.toggle('is-open', open);
  };

  menuButton.addEventListener('click', () => {
    setMenuOpen(menuButton.getAttribute('aria-expanded') !== 'true');
  });

  navigation.addEventListener('click', event => {
    if (event.target.closest('a')) setMenuOpen(false);
  });

  document.addEventListener('click', event => {
    if (menuButton.getAttribute('aria-expanded') === 'true' && !menuButton.parentElement.contains(event.target)) {
      setMenuOpen(false);
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setMenuOpen(false);
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 800) setMenuOpen(false);
  }, { passive: true });
}
