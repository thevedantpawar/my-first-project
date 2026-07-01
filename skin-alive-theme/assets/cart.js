(function () {
  var drawer = document.querySelector('[data-cart-drawer]');
  var cartToggle = document.querySelector('[data-cart-toggle]');
  var cartCount = document.querySelector('[data-cart-count]');
  var currencyFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

  if (!drawer) return;

  function openDrawer() {
    drawer.setAttribute('data-open', '');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    drawer.removeAttribute('data-open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  if (cartToggle) cartToggle.addEventListener('click', function () {
    openDrawer();
    refreshDrawer();
  });
  drawer.querySelectorAll('[data-cart-close]').forEach(function (el) {
    el.addEventListener('click', closeDrawer);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
  });

  function renderItems(cart) {
    var itemsEl = drawer.querySelector('[data-cart-items]');
    var subtotalEl = drawer.querySelector('[data-cart-subtotal]');
    if (!itemsEl) return;

    if (cart.item_count === 0) {
      itemsEl.innerHTML = '<p class="cart-drawer__empty">Your cart is empty.</p>';
    } else {
      itemsEl.innerHTML =
        '<ul class="cart-drawer__list">' +
        cart.items
          .map(function (item, index) {
            return (
              '<li class="cart-drawer__item">' +
              '<img src="' + item.image + '" alt="" width="75" height="75" loading="lazy">' +
              '<div class="cart-drawer__item-details">' +
              '<p class="cart-drawer__item-title">' + item.product_title + '</p>' +
              (item.variant_title ? '<p class="cart-drawer__item-variant">' + item.variant_title + '</p>' : '') +
              '<p class="cart-drawer__item-price">' + currencyFormatter.format(item.final_price / 100) + '</p>' +
              '<div class="cart-drawer__item-qty">' +
              '<input type="number" min="0" value="' + item.quantity + '" data-cart-qty-input data-line="' + (index + 1) + '">' +
              '</div></div></li>'
            );
          })
          .join('') +
        '</ul>';
    }

    if (subtotalEl) subtotalEl.textContent = currencyFormatter.format(cart.total_price / 100);
    if (cartCount) cartCount.textContent = cart.item_count;

    itemsEl.querySelectorAll('[data-cart-qty-input]').forEach(function (input) {
      input.addEventListener('change', function () {
        changeLine(input.getAttribute('data-line'), input.value);
      });
    });
  }

  function refreshDrawer() {
    fetch('/cart.js', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(renderItems);
  }

  function changeLine(line, quantity) {
    fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ line: line, quantity: quantity }),
    })
      .then(function (r) { return r.json(); })
      .then(renderItems);
  }

  document.addEventListener('cart:added', function () {
    openDrawer();
    refreshDrawer();
  });

  // Initial count sync in case cart changed in another tab
  refreshDrawer();
})();
