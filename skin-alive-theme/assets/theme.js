document.documentElement.classList.remove('no-js');

// Mobile nav drawer
(function () {
  var toggle = document.querySelector('[data-menu-toggle]');
  var nav = document.querySelector('[data-mobile-nav]');
  if (!toggle || !nav) return;

  function openNav() {
    nav.setAttribute('data-open', '');
    nav.setAttribute('aria-hidden', 'false');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }
  function closeNav() {
    nav.removeAttribute('data-open');
    nav.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  toggle.addEventListener('click', openNav);
  nav.querySelectorAll('[data-menu-close]').forEach(function (el) {
    el.addEventListener('click', closeNav);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeNav();
  });
})();

// Collection filter drawer (mobile)
(function () {
  var toggle = document.querySelector('[data-filter-toggle]');
  var drawer = document.querySelector('[data-filter-drawer]');
  if (!toggle || !drawer) return;

  function openDrawer() {
    drawer.setAttribute('data-open', '');
    drawer.setAttribute('aria-hidden', 'false');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    drawer.removeAttribute('data-open');
    drawer.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  toggle.addEventListener('click', openDrawer);
  drawer.querySelectorAll('[data-filter-close]').forEach(function (el) {
    el.addEventListener('click', closeDrawer);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
  });
})();

// Product gallery: tap thumbnail to scroll main slide into view
(function () {
  document.querySelectorAll('[data-product-gallery]').forEach(function (gallery) {
    var main = gallery.querySelector('.product-gallery__main');
    var thumbs = gallery.querySelectorAll('.product-gallery__thumb');
    if (!main || !thumbs.length) return;

    thumbs.forEach(function (thumb) {
      thumb.addEventListener('click', function () {
        var id = thumb.getAttribute('data-media-id');
        var slide = gallery.querySelector('.product-gallery__slide[data-media-id="' + id + '"]');
        if (slide) slide.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
        thumbs.forEach(function (t) { t.classList.remove('is-active'); });
        thumb.classList.add('is-active');
      });
    });
  });
})();
