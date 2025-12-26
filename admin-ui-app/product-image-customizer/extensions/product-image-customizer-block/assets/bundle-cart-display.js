/**
 * Bundle Cart Display - Hides hidden components
 */
(function () {
  'use strict';

  function hideHiddenComponents() {
    const cartItems = document.querySelectorAll('.cart-item, [class*="cart"][class*="item"], .line-item, [data-line-item], tr[data-key]');

    cartItems.forEach(itemEl => {
      const text = itemEl.textContent || '';
      if (text.includes('_isHiddenComponent') || text.includes('isHiddenComponent')) {
        itemEl.style.display = 'none';
      }
    });
  }

  // Run immediately
  setTimeout(hideHiddenComponents, 100);

  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(hideHiddenComponents, 200));
  }

  // Listen for cart updates
  document.addEventListener('cart:refresh', () => setTimeout(hideHiddenComponents, 200));
  document.addEventListener('cart:updated', () => setTimeout(hideHiddenComponents, 200));

  // Watch for DOM changes in cart
  const observer = new MutationObserver(() => setTimeout(hideHiddenComponents, 300));
  setTimeout(() => {
    const cartContainer = document.querySelector('.cart, [data-cart], main, body');
    if (cartContainer) {
      observer.observe(cartContainer, { childList: true, subtree: true });
    }
  }, 500);
})();

/**
 * Reorganize bundles in cart
 */
(function () {
  'use strict';

  function reorganizeBundlesInCart() {
    const cartItems = document.querySelectorAll('.cart-item, [class*="cart"][class*="item"], .line-item, [data-line-item], tr[data-key]');

    const bundleGroups = new Map();
    const processedItems = new Set();

    // Group items by bundleGroupId
    cartItems.forEach(itemEl => {
      if (processedItems.has(itemEl)) return;

      const properties = extractPropertiesFromElement(itemEl);

      const bundleGroupId = properties.bundleGroupId || properties._bundleGroupId;
      const bundleRole = properties.bundleRole || properties._bundleRole;

      if (!bundleGroupId) return;

      if (!bundleGroups.has(bundleGroupId)) {
        bundleGroups.set(bundleGroupId, { parent: null, components: [] });
      }

      const group = bundleGroups.get(bundleGroupId);

      if (bundleRole === 'parent') {
        group.parent = itemEl;
      } else if (bundleRole === 'component') {
        group.components.push(itemEl);
      }

      processedItems.add(itemEl);
    });

    // Reorganize each bundle
    bundleGroups.forEach((group, bundleId) => {
      if (!group.parent || group.components.length === 0) {
        return;
      }

      // Hide the parent ($0 bundle product)
      group.parent.style.display = 'none';
      group.parent.classList.add('bundle-parent-hidden');

      // Style the first component as the bundle container
      const firstComponent = group.components[0];
      firstComponent.classList.add('bundle-container');
      firstComponent.style.cssText = `
        border: 2px solid #4CAF50 !important;
        border-radius: 8px !important;
        padding: 16px !important;
        margin-bottom: 16px !important;
        background: linear-gradient(135deg, #f8fff9 0%, #f0fdf4 100%) !important;
        position: relative !important;
      `;

      // Add bundle badge to first component
      let badge = firstComponent.querySelector('.bundle-badge');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'bundle-badge';
        badge.textContent = '🎁 Bundle';
        badge.style.cssText = `
          position: absolute;
          top: 12px;
          right: 12px;
          background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
          color: white;
          padding: 6px 16px;
          border-radius: 16px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
          z-index: 10;
        `;
        firstComponent.insertBefore(badge, firstComponent.firstChild);
      }

      // Style remaining components
      group.components.slice(1).forEach((componentEl, index) => {
        componentEl.classList.add('bundle-component');
        componentEl.style.cssText = `
          margin-left: 24px !important;
          padding-left: 16px !important;
          border-left: 3px solid #4CAF50 !important;
          opacity: 0.95 !important;
        `;
      });
    });

    console.log('✅ Bundle reorganization complete');
  }

  function extractPropertiesFromElement(itemEl) {
    const properties = {};

    // Try to find properties in the DOM
    const propsContainer = itemEl.querySelector('[data-cart-item-properties], .cart-item__properties, .line-item-properties, [data-line-item-properties]');

    if (propsContainer) {
      const propElements = propsContainer.querySelectorAll('[data-property], .property, dt, .line-item-property');
      propElements.forEach(propEl => {
        const key = propEl.getAttribute('data-property') ||
          propEl.textContent.replace(':', '').trim();
        const valueEl = propEl.nextElementSibling || propEl.querySelector('+ dd, + .property-value');
        const value = valueEl ? valueEl.textContent.trim() : null;

        if (key && value) {
          properties[key] = value;
        }
      });
    }

    // Also check text content for property patterns
    const text = itemEl.textContent || '';
    const bundleGroupMatch = text.match(/bundleGroupId:\s*([^\s,]+)/i) ||
      text.match(/_bundleGroupId:\s*([^\s,]+)/i);
    const bundleRoleMatch = text.match(/bundleRole:\s*([^\s,]+)/i) ||
      text.match(/_bundleRole:\s*([^\s,]+)/i);

    if (bundleGroupMatch) {
      properties.bundleGroupId = bundleGroupMatch[1];
      properties._bundleGroupId = bundleGroupMatch[1];
    }
    if (bundleRoleMatch) {
      properties.bundleRole = bundleRoleMatch[1];
      properties._bundleRole = bundleRoleMatch[1];
    }

    return properties;
  }

  // Run immediately
  setTimeout(reorganizeBundlesInCart, 100);

  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(reorganizeBundlesInCart, 200));
  }

  // Listen for cart updates
  document.addEventListener('cart:refresh', () => setTimeout(reorganizeBundlesInCart, 200));
  document.addEventListener('cart:updated', () => setTimeout(reorganizeBundlesInCart, 200));

  // Watch for DOM changes in cart
  const observer = new MutationObserver(() => {
    setTimeout(reorganizeBundlesInCart, 300);
  });

  setTimeout(() => {
    const cartContainer = document.querySelector('.cart, [data-cart], main, body');
    if (cartContainer) {
      observer.observe(cartContainer, { childList: true, subtree: true });
      console.log('👀 Watching for cart changes');
    }
  }, 500);

})();
