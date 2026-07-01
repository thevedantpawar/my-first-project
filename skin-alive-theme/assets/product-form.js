(function () {
  var currencyFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

  document.querySelectorAll('[data-product-gallery]').forEach(initProductSection);

  function initProductSection() {
    var section = document.querySelector('.product-section');
    if (!section) return;

    var variantScript = section.querySelector('[data-product-variants]');
    var variants = variantScript ? JSON.parse(variantScript.textContent) : [];
    var form = section.querySelector('[data-add-to-cart]') && section.querySelector('.product-form');
    if (!form) return;

    var variantIdInput = form.querySelector('[data-product-form-variant-id]');
    var submitButton = form.querySelector('[data-add-to-cart]');
    var submitText = form.querySelector('[data-add-to-cart-text]');
    var priceEl = section.querySelector('.price');

    function selectedOptions() {
      var options = [];
      form.querySelectorAll('fieldset.product-form__option').forEach(function (fieldset) {
        var checked = fieldset.querySelector('input:checked');
        options.push(checked ? checked.value : null);
      });
      return options;
    }

    function findMatchingVariant(options) {
      return variants.find(function (variant) {
        return variant.options.every(function (value, index) {
          return options[index] === null || options[index] === undefined || value === options[index];
        });
      });
    }

    function updateForVariant(variant) {
      if (!variant) return;
      variantIdInput.value = variant.id;
      if (priceEl) {
        var regular = priceEl.querySelector('.price__regular');
        var sale = priceEl.querySelector('.price__sale');
        var compareAt = priceEl.querySelector('.price__compare-at');
        var formatted = currencyFormatter.format(variant.price / 100);
        if (variant.compare_at_price && variant.compare_at_price > variant.price) {
          if (sale) sale.textContent = formatted;
          if (compareAt) compareAt.querySelector('s') && (compareAt.querySelector('s').textContent = currencyFormatter.format(variant.compare_at_price / 100));
        } else if (regular) {
          regular.textContent = formatted;
        }
      }
      submitButton.disabled = !variant.available;
      submitText.textContent = variant.available ? submitText.textContent : 'Sold out';
    }

    form.querySelectorAll('input[type="radio"]').forEach(function (input) {
      input.addEventListener('change', function () {
        var match = findMatchingVariant(selectedOptions());
        updateForVariant(match);
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitButton.disabled = true;
      var formData = new FormData(form);

      fetch('/cart/add.js', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: formData,
      })
        .then(function (response) {
          return response.json().then(function (data) {
            if (!response.ok) throw data;
            return data;
          });
        })
        .then(function () {
          document.dispatchEvent(new CustomEvent('cart:added'));
        })
        .catch(function (err) {
          var message = (err && err.description) || 'Could not add this product to your cart.';
          var note = form.querySelector('.product-form__note');
          if (note) note.textContent = message;
        })
        .finally(function () {
          submitButton.disabled = false;
        });
    });
  }
})();
