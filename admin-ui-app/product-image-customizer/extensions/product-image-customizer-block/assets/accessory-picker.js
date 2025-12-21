(function () {
  const normalizeColor = (val) => (val || "").toString().trim().toLowerCase();
  const normalizeProductId = (id) => {
    if (!id) return id;
    return id.indexOf("/") > -1 ? id.split("/").pop() : id;
  };
  const normalizeVariantId = (id) => {
    if (!id) return id;
    return id.indexOf("/") > -1 ? id.split("/").pop() : id;
  };

  // Build a lookup of variantId -> color value from available product JSON
  const buildVariantColorLookup = () => {
    const map = {};
    const tryAdd = (variants, colorIndex = 0) => {
      (variants || []).forEach((v) => {
        const opts = v.options || [v.option1, v.option2, v.option3];
        const colorCandidate = opts?.[colorIndex] || opts?.find((o) => o) || v.title || "";
        if (v.id) map[v.id.toString()] = normalizeColor(colorCandidate);
      });
    };

    const analytics = window.ShopifyAnalytics?.meta;
    if (analytics?.product?.variants && analytics?.product?.options) {
      const colorIdx = (analytics.product.options || []).findIndex((o) => /color|colour/i.test(o));
      tryAdd(analytics.product.variants, colorIdx === -1 ? 0 : colorIdx);
    } else {
      // Try embedded product JSON script
      const jsonNode =
        document.querySelector('script[type="application/json"][data-product]') ||
        document.querySelector('script[type="application/json"][data-product-json]') ||
        document.querySelector('script[id*="ProductJson"]');
      if (jsonNode?.textContent) {
        try {
          const prod = JSON.parse(jsonNode.textContent);
          const colorIdx = (prod.options_with_values || prod.options || [])
            .findIndex((o) => /color|colour/i.test(o.name || o));
          tryAdd(prod.variants, colorIdx === -1 ? 0 : colorIdx);
        } catch (e) {
          console.warn("[AccessoryPicker] failed parsing product JSON for colors", e);
        }
      }
    }
    return map;
  };

  const findMainImage = () =>
    document.querySelector('[data-product-media-main] img') ||
    document.querySelector(".product__media img") ||
    document.querySelector(".product-media--featured img") ||
    document.querySelector(".product__slides img") ||
    document.querySelector(".product__media-item img") ||
    document.querySelector("main img");

  const getColorValue = (variantColorLookup) => {
    const colorSelect = document.querySelector('select[name^="options["][name*="color" i]');
    if (colorSelect && colorSelect.value) return normalizeColor(colorSelect.value);
    const colorRadio = document.querySelector('input[type="radio"][name*="color" i]:checked');
    if (colorRadio && colorRadio.value) return normalizeColor(colorRadio.value);

    const variantIdInput = document.querySelector('form[action*="/cart/add"] [name="id"]');
    const variantIdVal = variantIdInput?.value ? normalizeProductId(variantIdInput.value) : null;
    if (variantIdVal && variantColorLookup[variantIdVal]) {
      return variantColorLookup[variantIdVal];
    }
    return null;
  };

  const run = () => {
    const pickers = document.querySelectorAll("[data-accessory-picker]");
    if (!pickers.length) return;
    const variantColorLookup = buildVariantColorLookup();

    pickers.forEach((picker, idx) => {
      let colorMap = {};
      const mapScript = picker.querySelector("[data-color-map-script]");
      if (mapScript) {
        try {
          colorMap = JSON.parse(mapScript.textContent || "{}");
          console.log("[AccessoryPicker] raw map script", mapScript.textContent);
        } catch (e) {
          console.warn("[AccessoryPicker] parse error", e, mapScript.textContent);
        }
      }
      // normalize color keys and accessory ids (both gid and numeric)
      const normalizedMap = {};
      Object.keys(colorMap || {}).forEach((colorKey) => {
        const cKey = normalizeColor(colorKey);
        const accessories = colorMap[colorKey] || {};
        const accObj = {};
        Object.keys(accessories).forEach((accKey) => {
          const val = accessories[accKey];
          accObj[accKey] = val; // keep original key (gid)
          const numeric = normalizeProductId(accKey);
          if (numeric) accObj[numeric] = val;
        });
        normalizedMap[cKey] = accObj;
      });
      colorMap = normalizedMap;

      const items = picker.querySelectorAll("[data-accessory-id]");
      console.log("[AccessoryPicker] init", { idx, colorMap, items: items.length, hasMainImage: !!findMainImage() });

      const setActive = (accessoryId) => {
        items.forEach((el) => {
          el.classList.toggle("is-active", el.getAttribute("data-accessory-id") === accessoryId);
        });
      };

      const applyImage = (url) => {
        const mainImage = findMainImage();
        if (!mainImage || !url) return;
        if (!mainImage.dataset.originalSrc) {
          mainImage.dataset.originalSrc = mainImage.currentSrc || mainImage.src;
          if (mainImage.srcset) mainImage.dataset.originalSrcset = mainImage.srcset;
        }
        console.log("[AccessoryPicker] apply image", { url, node: mainImage });
        if (mainImage.tagName === "IMG") {
          mainImage.src = url;
          mainImage.srcset = "";
        } else if (mainImage.style && "backgroundImage" in mainImage.style) {
          mainImage.style.backgroundImage = `url(${url})`;
        }
      };

      const restoreImage = () => {
        const mainImage = findMainImage();
        if (!mainImage) return;
        console.log("[AccessoryPicker] restore image");
        if (mainImage.dataset.originalSrc) mainImage.src = mainImage.dataset.originalSrc;
        if (mainImage.dataset.originalSrcset) mainImage.srcset = mainImage.dataset.originalSrcset;
      };

      const filterVisibleForColor = () => {
        const colorVal = getColorValue(variantColorLookup);
        console.log("[AccessoryPicker] filter", { colorVal, mapKeys: Object.keys(colorMap || {}) });
        items.forEach((el) => {
          const accId = el.getAttribute("data-accessory-id");
          const accGid = el.getAttribute("data-accessory-gid");
          const numeric = normalizeProductId(accGid) || normalizeProductId(accId);
          const hasMapping =
            colorVal &&
            (colorMap?.[colorVal]?.[accGid] ||
              colorMap?.[colorVal]?.[accId] ||
              (numeric && colorMap?.[colorVal]?.[numeric]));
          if (colorVal) {
            console.log("[AccessoryPicker] check accessory", { color: colorVal, accId, accGid, numeric, hasMapping });
          }
          el.style.display = hasMapping ? "" : "none";
        });
      };

      const selectAccessory = (accessoryId) => {
        const colorVal = getColorValue(variantColorLookup);
        const accGid = document.querySelector(`[data-accessory-id="${accessoryId}"]`)?.getAttribute("data-accessory-gid");
        const numeric = normalizeProductId(accGid) || normalizeProductId(accessoryId);
        const entry =
          colorVal &&
          (colorMap?.[colorVal]?.[accGid] ||
            colorMap?.[colorVal]?.[accessoryId] ||
            (numeric && colorMap?.[colorVal]?.[numeric]));
        console.log("[AccessoryPicker] select", { accessoryId, accGid, numeric, colorVal, entry });
        if (entry?.fileUrl) {
          applyImage(entry.fileUrl);
          setActive(accessoryId);
        } else {
          restoreImage();
          setActive(null);
        }
      };

      items.forEach((item) => {
        item.addEventListener("click", () => {
          const id = item.getAttribute("data-accessory-id");
          const isActive = item.classList.contains("is-active");
          if (isActive) {
            restoreImage();
            setActive(null);
          } else {
            selectAccessory(id);
          }
        });
      });

      // On add-to-cart, piggyback a background add for the accessory (let the main form proceed)
      const form = picker.closest('form[action*="/cart/add"]') || document.querySelector('form[action*="/cart/add"]');

      const addAccessoryToCart = () => {
        const active = picker.querySelector(".accessory-picker__item.is-active");
        const accessoryVariantId = active?.getAttribute("data-accessory-variant-id");
        if (!accessoryVariantId) return null; // no accessory selected, let form proceed

        const mainVariantInput =
          form?.querySelector('[name="id"]') ||
          document.querySelector('form[action*="/cart/add"] [name="id"]') ||
          document.querySelector('[name="id"]');
        const qtyInput = form?.querySelector('[name="quantity"]');
        const mainVariantId = normalizeVariantId(
          mainVariantInput?.value ||
          window.ShopifyAnalytics?.meta?.selectedVariantId ||
          window.ShopifyAnalytics?.meta?.variantId
        );
        const accessoryVariantIdNorm = normalizeVariantId(accessoryVariantId);
        const quantity = qtyInput?.value ? parseInt(qtyInput.value, 10) || 1 : 1;

        if (!mainVariantId || !accessoryVariantIdNorm) {
          console.warn("[AccessoryPicker] missing variant ids", { mainVariantId, accessoryVariantId });
          return null;
        }

        const accessoryPayload = {
          items: [
            {
              id: accessoryVariantIdNorm,
              quantity,
              properties: { _accessory_for: mainVariantId },
            },
          ],
        };

        console.log("[AccessoryPicker] accessory add attempt", {
          accessoryVariantId: accessoryVariantIdNorm,
          mainVariantId,
          quantity,
          formFound: !!form,
        });

        // Fire-and-forget accessory add; let main form continue its normal flow (Ajax or redirect)
        return fetch("/cart/add.js", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          credentials: "same-origin",
          keepalive: true,
          body: JSON.stringify(accessoryPayload),
        })
          .then(async (res) => {
            const text = await res.text();
            if (!res.ok) {
              console.error("[AccessoryPicker] accessory add error", {
                status: res.status,
                url: res.url,
                body: text,
              });
              throw new Error(text || `HTTP ${res.status}`);
            }
            console.log("[AccessoryPicker] accessory add success", { status: res.status, body: text });
          })
          .catch((err) => {
            console.error("[AccessoryPicker] accessory add fetch failed", err);
          });
      };

      // Some themes trigger add-to-cart via button click without a form submit.
      // Deduplicate so click + submit in the same tick only fire once.
      let accessoryAddLocked = false;
      const triggerAccessoryAdd = () => {
        if (accessoryAddLocked) return;
        accessoryAddLocked = true;
        queueMicrotask(() => {
          accessoryAddLocked = false;
        });
        addAccessoryToCart();
      };

      if (form) {
        form.addEventListener("submit", triggerAccessoryAdd);
        const addButtons = form.querySelectorAll('button[name="add"], button[type="submit"], input[type="submit"]');
        addButtons.forEach((btn) => {
          if (btn.type && btn.type.toLowerCase() === "submit") return; // submit already covered
          btn.addEventListener("click", triggerAccessoryAdd);
        });
      }

      // Fallback: if the picker is outside the product form or the theme intercepts submit,
      // listen globally for add-to-cart button clicks and trigger once per click.
      const globalAddSelector = 'button[name="add"], button[type="submit"], input[type="submit"], [data-add-to-cart], [data-product-add]';
      document.addEventListener(
        "click",
        (event) => {
          const target = event.target?.closest(globalAddSelector);
          if (!target) return;
          triggerAccessoryAdd();
        },
        true
      );

      const reapply = () => {
        filterVisibleForColor();
        const active = picker.querySelector(".accessory-picker__item.is-active");
        if (active && active.style.display !== "none") {
          selectAccessory(active.getAttribute("data-accessory-id"));
        } else {
          restoreImage();
          setActive(null);
        }
      };

      if (form) {
        form.addEventListener("change", (event) => {
          if (event.target && event.target.name === "id") {
            reapply();
            setTimeout(reapply, 50);
          }
        });
      }
      document.addEventListener("variant:changed", reapply);
      document.addEventListener("product:variant-change", reapply);
      document.addEventListener("product:variant-change", () => setTimeout(reapply, 50));

      filterVisibleForColor();
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
