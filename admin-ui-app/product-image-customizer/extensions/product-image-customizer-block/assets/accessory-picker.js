(function () {
  const normalizeColor = (val) => (val || "").toString().trim().toLowerCase();
  const normalizeProductId = (id) => (id && id.includes("/")) ? id.split("/").pop() : id;
  const normalizeVariantId = (id) => (id && id.includes("/")) ? id.split("/").pop() : id;

  const findMainImage = () =>
    document.querySelector('[data-product-media-main] img') ||
    document.querySelector('.product__media img') ||
    document.querySelector('.product-media--featured img') ||
    document.querySelector('.product__slides img') ||
    document.querySelector('.product__media-item img') ||
    document.querySelector('main img');

  const parseMaybeWrapped = (text) => {
    try {
      const first = JSON.parse(text || "{}");
      return typeof first === "string" ? JSON.parse(first) : first || {};
    } catch (e) {
      return {};
    }
  };

  const normalizePriceToCents = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") {
      if (Number.isNaN(value)) return null;
      return value > 1000 ? Math.round(value) : Math.round(value * 100);
    }
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed)) return null;
    return parsed > 1000 ? Math.round(parsed) : Math.round(parsed * 100);
  };

  const formatMoney = (() => {
    const currency =
      (typeof window !== "undefined" && window.Shopify?.currency?.active) ||
      (typeof window !== "undefined" && window.ShopifyAnalytics?.meta?.currency) ||
      "USD";
    const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
    return (cents) => (typeof cents === "number" ? formatter.format(cents / 100) : "");
  })();

  const run = () => {
    const pickers = Array.from(document.querySelectorAll("[data-accessory-picker]")).filter((p) => !p.__accessoryPickerInit);
    if (!pickers.length) return;

    pickers.forEach((picker) => {
      picker.__accessoryPickerInit = true;

      const colorMapRaw = parseMaybeWrapped(picker.querySelector("[data-color-map-script]")?.textContent || "{}");
      const variantMapRaw = parseMaybeWrapped(picker.querySelector("[data-variant-map-script]")?.textContent || "{}");
      let categoryMapRaw = parseMaybeWrapped(picker.querySelector("[data-category-map-script]")?.textContent || "{}");
      const categoryDropdowns = picker.querySelector("[data-category-dropdowns]");
      const summaryContainer = picker.querySelector("[data-accessory-summary]");
      const totalsContainer = picker.querySelector("[data-accessory-totals]");
      const totalPriceEl = picker.querySelector("[data-total-price]");
      const stockWarningEl = picker.querySelector("[data-stock-warning]");
      const items = Array.from(picker.querySelectorAll("[data-accessory-id]"));
      const categoryLabelByAccessory = {};
      const categorySelections = {};
      let stockBlocked = false;

      const normalizedColorMap = {};
      Object.keys(colorMapRaw || {}).forEach((colorKey) => {
        const cKey = normalizeColor(colorKey);
        const accs = colorMapRaw[colorKey] || {};
        const accObj = {};
        Object.keys(accs).forEach((accKey) => {
          const val = accs[accKey];
          accObj[accKey] = val;
          const numeric = normalizeProductId(accKey);
          if (numeric) accObj[numeric] = val;
        });
        normalizedColorMap[cKey] = accObj;
      });

      const normalizedVariantMap = {};
      Object.keys(variantMapRaw || {}).forEach((baseKey) => {
        const normBase = normalizeVariantId(baseKey) || baseKey;
        const accs = variantMapRaw[baseKey] || {};
        const accObj = {};
        Object.keys(accs).forEach((accKey) => {
          const val = accs[accKey];
          accObj[accKey] = val;
          const numeric = normalizeVariantId(accKey) || normalizeProductId(accKey);
          if (numeric) accObj[numeric] = val;
          if (val?.accessoryProductId) {
            const prodNumeric = normalizeProductId(val.accessoryProductId);
            if (prodNumeric) accObj[prodNumeric] = val;
          }
        });
        normalizedVariantMap[normBase] = accObj;
      });

      const variantCache = new Map();
      const variantFetchPromises = new Map();
      const baseVariantMeta = {};
      const accessoryVariantMetaByAccessory = {};

      const seedVariantCache = (meta) => {
        const norm = normalizeVariantId(meta?.id);
        if (!norm) return;
        variantCache.set(norm, { ...meta, id: norm });
      };

      const baseVariantsRaw = parseMaybeWrapped(picker.querySelector("[data-base-variants]")?.textContent || "[]");
      (Array.isArray(baseVariantsRaw) ? baseVariantsRaw : []).forEach((v) => {
        const norm = normalizeVariantId(v.id);
        if (!norm) return;
        const meta = {
          id: norm,
          title: v.title || "",
          price: normalizePriceToCents(v.price),
          available: v.available !== false,
          inventory_quantity: typeof v.inventory_quantity === "number" ? v.inventory_quantity : null,
        };
        baseVariantMeta[norm] = meta;
        seedVariantCache(meta);
      });

      if ((!Array.isArray(baseVariantsRaw) || baseVariantsRaw.length === 0) && window.ShopifyAnalytics?.meta?.product?.variants) {
        const analyticsVariants = window.ShopifyAnalytics.meta.product.variants || [];
        analyticsVariants.forEach((v) => {
          const norm = normalizeVariantId(v.id);
          if (!norm) return;
          const meta = {
            id: norm,
            title: v.public_title || v.title || "",
            price: normalizePriceToCents(v.price),
            available: v.available !== false,
            inventory_quantity: typeof v.inventory_quantity === "number" ? v.inventory_quantity : null,
          };
          baseVariantMeta[norm] = meta;
          seedVariantCache(meta);
        });
      }

      picker.querySelectorAll("[data-accessory-variants]").forEach((script) => {
        const accId = script.getAttribute("data-accessory-id");
        const arr = parseMaybeWrapped(script.textContent || "[]");
        accessoryVariantMetaByAccessory[accId] = (Array.isArray(arr) ? arr : []).map((v) => {
          const norm = normalizeVariantId(v.id);
          const meta = {
            id: norm || v.id,
            title: v.title || "",
            price: normalizePriceToCents(v.price),
            available: v.available !== false,
            accessoryId: accId,
            inventory_quantity: typeof v.inventory_quantity === "number" ? v.inventory_quantity : null,
          };
          seedVariantCache(meta);
          return meta;
        });
      });

      const getVariantMetaSync = (variantId, accessoryId) => {
        const norm = normalizeVariantId(variantId);
        if (!norm) return null;
        if (variantCache.has(norm)) return variantCache.get(norm);
        const byAccessory = accessoryVariantMetaByAccessory[accessoryId];
        if (byAccessory) {
          const found = byAccessory.find((m) => normalizeVariantId(m.id) === norm);
          if (found) return found;
        }
        if (baseVariantMeta[norm]) return baseVariantMeta[norm];
        return null;
      };

      const fetchVariantMeta = async (variantId) => {
        const norm = normalizeVariantId(variantId);
        if (!norm) return null;
        if (variantFetchPromises.has(norm)) return variantFetchPromises.get(norm);
        const promise = fetch(`/variants/${norm}.json`, { credentials: "same-origin" })
          .then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const v = json?.variant;
            if (!v) return null;
            const meta = {
              id: norm,
              title: v.title || "",
              price: normalizePriceToCents(v.price ?? v.price_usd ?? 0),
              available: v.available !== false && v.inventory_quantity !== 0,
              inventory_quantity: typeof v.inventory_quantity === "number" ? v.inventory_quantity : null,
            };
            seedVariantCache(meta);
            return meta;
          })
          .catch(() => null);
        variantFetchPromises.set(norm, promise);
        return promise;
      };

      const getVariantMetaAsync = async (variantId, accessoryId) => {
        const norm = normalizeVariantId(variantId);
        if (!norm) return null;
        const existing = getVariantMetaSync(norm, accessoryId);
        if (existing) return existing;
        return fetchVariantMeta(norm);
      };

      const accessoriesData = items.map((el) => {
        const id = el.getAttribute("data-accessory-id");
        const gid = el.getAttribute("data-accessory-gid") || id;
        const title = el.querySelector(".accessory-picker__name")?.textContent?.trim() || id || "Accessory";
        const price = el.dataset.accessoryPrice || el.getAttribute("data-accessory-price") || "";
        const image = el.dataset.accessoryImage || el.getAttribute("data-accessory-image") || "";
        const variantSelect = picker.querySelector(`[data-accessory-variant-select][data-accessory-id="${id}"]`);
        const variants = variantSelect
          ? Array.from(variantSelect.options || []).map((opt) => {
            const vid = normalizeVariantId(opt.value) || opt.value;
            const meta = getVariantMetaSync(vid, id);
            const priceCents = meta?.price;
            return {
              id: vid,
              title: opt.textContent,
              price: typeof priceCents === "number" ? formatMoney(priceCents) : price,
              priceCents,
              available: meta?.available !== false,
            };
          })
          : (() => {
            const vid = normalizeVariantId(el.getAttribute("data-accessory-variant-id")) || id;
            const meta = getVariantMetaSync(vid, id);
            const priceCents = meta?.price;
            return [
              {
                id: vid,
                title,
                price: typeof priceCents === "number" ? formatMoney(priceCents) : price,
                priceCents,
                available: meta?.available !== false,
              },
            ];
          })();
        return { id, gid, title, price, image, variants };
      });

      items.forEach((el) => {
        const accId = el.getAttribute("data-accessory-id");
        const select = picker.querySelector(`[data-accessory-variant-select][data-accessory-id="${accId}"]`);
        if (!select) return;
        Array.from(select.options || []).forEach((opt) => {
          const norm = normalizeVariantId(opt.value);
          const meta = getVariantMetaSync(norm, accId);
          if (meta?.available === false) opt.disabled = true;
          opt.dataset.baseLabel = opt.dataset.baseLabel || opt.textContent;
          if (meta?.price) {
            opt.textContent = `${opt.dataset.baseLabel} • ${formatMoney(meta.price)}`;
          }
        });
      });

      const normalizedCategoryMap = {};
      if (Array.isArray(categoryMapRaw)) {
        categoryMapRaw.forEach((cat) => {
          const label = (cat?.label || "").toString().trim() || "Accessories";
          (cat?.productIds || []).forEach((pid) => {
            const gidKey = pid;
            const numKey = normalizeProductId(pid);
            normalizedCategoryMap[gidKey] = label;
            if (numKey) normalizedCategoryMap[numKey] = label;
          });
        });
      } else {
        Object.keys(categoryMapRaw || {}).forEach((accId) => {
          const label = (categoryMapRaw?.[accId] || "").toString().trim() || "Accessories";
          const numKey = normalizeProductId(accId);
          normalizedCategoryMap[accId] = label;
          if (numKey) normalizedCategoryMap[numKey] = label;
        });
      }
      if (!normalizedCategoryMap || Object.keys(normalizedCategoryMap).length === 0) {
        accessoriesData.forEach((a) => {
          normalizedCategoryMap[a.id] = "Accessories";
        });
      }

      const buildCategorySelectors = () => {
        const container = categoryDropdowns;
        if (!container) return;
        const noneLabel = container.getAttribute("data-category-none-label") || "None";
        container.innerHTML = "";
        const groups = {};
        Object.keys(normalizedCategoryMap || {}).forEach((accId) => {
          const label = (normalizedCategoryMap?.[accId] || "").toString().trim() || "Accessories";
          if (!groups[label]) groups[label] = [];
          groups[label].push(accId);
        });

        Object.keys(groups).forEach((label, index) => {
          const wrapper = document.createElement("div");
          wrapper.className = "accessory-picker__category";
          if (index === 0) wrapper.classList.add("is-expanded"); // First category expanded by default
          wrapper.setAttribute("data-category-label", label);

          // Create header with toggle functionality
          const header = document.createElement("div");
          header.className = "accessory-picker__category-header";

          const labelWrapper = document.createElement("div");
          labelWrapper.className = "accessory-picker__category-label-wrapper";

          const heading = document.createElement("div");
          heading.className = "accessory-picker__category-label";
          heading.textContent = label;

          const count = document.createElement("span");
          count.className = "accessory-picker__category-count";
          count.dataset.categoryLabel = label;
          count.textContent = "0";

          const toggle = document.createElement("div");
          toggle.className = "accessory-picker__category-toggle";
          toggle.innerHTML = '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

          labelWrapper.appendChild(heading);
          labelWrapper.appendChild(count);
          header.appendChild(labelWrapper);
          header.appendChild(toggle);

          // Toggle functionality
          header.addEventListener("click", () => {
            const isExpanded = wrapper.classList.contains("is-expanded");
            wrapper.classList.toggle("is-expanded");

            // Optional: Close other categories when opening one (accordion behavior)
            // Uncomment the lines below if you want accordion behavior
            // if (!isExpanded) {
            //   container.querySelectorAll(".accessory-picker__category").forEach(cat => {
            //     if (cat !== wrapper) cat.classList.remove("is-expanded");
            //   });
            // }
          });

          // Create content wrapper
          const content = document.createElement("div");
          content.className = "accessory-picker__category-content";

          const list = document.createElement("div");
          list.className = "accessory-picker__category-list";

          (groups[label] || []).forEach((accId) => {
            const data = accessoriesData.find((a) => a.id === accId || a.gid === accId);
            if (!data) return;
            categoryLabelByAccessory[data.id] = label;
            const firstVariantMeta = data.variants?.[0];
            const firstVariantId = firstVariantMeta?.id || data.id;
            const priceLabel = firstVariantMeta?.price || data.price || "";
            const isUnavailable = firstVariantMeta?.available === false;
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "accessory-picker__category-option";
            if (isUnavailable) btn.classList.add("is-unavailable");
            btn.disabled = !!isUnavailable;
            btn.innerHTML = [
              `<span class="accessory-picker__option-media">`,
              data.image ? `<img src="${data.image}" alt="${data.title}" width="40" height="40" />` : "",
              `</span>`,
              `<span class="accessory-picker__option-copy">`,
              `<span class="accessory-picker__option-title">${data.title}</span>`,
              `<span class="accessory-picker__option-price">${priceLabel || ""}</span>`,
              isUnavailable ? '<span class="accessory-picker__stock-flag">Sold out</span>' : "",
              `</span>`,
            ].join("");
            btn.addEventListener("click", () => {
              const isCurrentlySelected = btn.classList.contains("is-selected");

              if (isCurrentlySelected) {
                // Deselect this item
                btn.classList.remove("is-selected");

                // Remove from category selections array
                if (categorySelections[label] && Array.isArray(categorySelections[label])) {
                  categorySelections[label] = categorySelections[label].filter(
                    item => item.accessoryId !== data.id
                  );
                  // If array is empty, delete the key
                  if (categorySelections[label].length === 0) {
                    delete categorySelections[label];
                  }
                }

                items.forEach((el) => {
                  if (el.getAttribute("data-accessory-id") === data.id) {
                    el.classList.remove("is-active");
                    delete el.dataset.selectedAccessoryVariantId;
                  }
                });
              } else {
                // Select this item (allow multiple per category)
                btn.classList.add("is-selected");

                // Initialize category selections array if needed
                if (!categorySelections[label]) {
                  categorySelections[label] = [];
                }

                // Add to category selections array
                categorySelections[label].push({
                  accessoryId: data.id,
                  accessoryGid: data.gid,
                  variantId: firstVariantId
                });

                items.forEach((el) => {
                  if (el.getAttribute("data-accessory-id") === data.id) {
                    el.dataset.selectedAccessoryVariantId = firstVariantId;
                    el.classList.add("is-active");
                  }
                });
              }
              applySelections();
            });
            list.appendChild(btn);
          });

          content.appendChild(list);
          wrapper.appendChild(header);
          wrapper.appendChild(content);
          container.appendChild(wrapper);
        });
      };

      const setActive = (ids = []) => {
        items.forEach((el) => {
          el.classList.toggle("is-active", ids.includes(el.getAttribute("data-accessory-id")));
        });
      };

      const buildCombinationKey = (ids) =>
        (ids || [])
          .map((id) => normalizeVariantId(id) || normalizeProductId(id))
          .filter(Boolean)
          .sort()
          .join("+");

      const getSelectionsFromCards = () =>
        items
          .filter((el) => el.classList.contains("is-active"))
          .map((el) => ({
            accessoryId: el.getAttribute("data-accessory-id"),
            accessoryGid: el.getAttribute("data-accessory-gid"),
            variantId: el.dataset.selectedAccessoryVariantId || el.getAttribute("data-accessory-variant-id"),
          }));

      const getSelectionsFromCategories = () => {
        const selections = [];
        Object.values(categorySelections || {}).forEach((value) => {
          if (Array.isArray(value)) {
            selections.push(...value);
          } else {
            selections.push(value);
          }
        });
        return selections;
      };

      const getAccessoryMeta = (accessoryId) =>
        accessoriesData.find((a) => a.id === accessoryId) || { title: accessoryId, price: "", image: "" };

      const resolveVariantDetails = (variantId, accessoryId) => {
        const meta = getVariantMetaSync(variantId, accessoryId);
        const priceCents = meta?.price;
        return {
          priceCents,
          priceFormatted: typeof priceCents === "number" ? formatMoney(priceCents) : "",
          available: meta?.available !== false,
          inventory: typeof meta?.inventory_quantity === "number" ? meta.inventory_quantity : null,
          variantTitle: meta?.title,
        };
      };

      const getAllSelections = () => {
        const mergedMap = new Map();
        getSelectionsFromCards().forEach((sel) => {
          if (sel?.accessoryId) mergedMap.set(sel.accessoryId, sel);
        });
        getSelectionsFromCategories().forEach((sel) => {
          if (sel?.accessoryId) mergedMap.set(sel.accessoryId, sel);
        });

        return Array.from(mergedMap.values()).map((sel) => {
          const meta = getAccessoryMeta(sel.accessoryId);
          const categoryLabel = categoryLabelByAccessory[sel.accessoryId] || "";
          const variantDetails = resolveVariantDetails(sel.variantId, sel.accessoryId);
          return {
            ...meta,
            ...sel,
            categoryLabel,
            price: variantDetails.priceFormatted || meta.price,
            priceCents: variantDetails.priceCents,
            available: variantDetails.available,
            inventory: variantDetails.inventory,
            variantTitle: variantDetails.variantTitle,
          };
        });
      };

      const getBaseVariantId = () => {
        const mainVariantInput =
          picker.querySelector('form[action*="/cart/add"] [name="id"]') ||
          document.querySelector('form[action*="/cart/add"] [name="id"]') ||
          document.querySelector('[name="id"]');
        const id =
          mainVariantInput?.value ||
          window.ShopifyAnalytics?.meta?.selectedVariantId ||
          window.ShopifyAnalytics?.meta?.variantId;
        return normalizeVariantId(id);
      };

      const parseVariantOptions = (variants) => {
        if (!variants || variants.length <= 1) return null;

        const optionsMap = {};
        const variantsByOptions = {};

        variants.forEach((variant) => {
          const title = variant.title || "";
          const parts = title.split(" / ").map(p => p.trim());

          parts.forEach((part, index) => {
            const optionName = `Option ${index + 1}`;
            if (!optionsMap[optionName]) {
              optionsMap[optionName] = new Set();
            }
            optionsMap[optionName].add(part);
          });

          const key = parts.join(" / ");
          variantsByOptions[key] = variant;
        });

        const options = Object.keys(optionsMap).map((name) => ({
          name,
          values: Array.from(optionsMap[name])
        }));

        // Try to infer option names from common patterns
        if (options.length > 0 && variants[0]?.title) {
          const firstTitle = variants[0].title;
          if (firstTitle.includes(":")) {
            // Format: "Color: Red / Size: Large"
            const inferredOptions = [];
            firstTitle.split(" / ").forEach((part) => {
              const [name, value] = part.split(":").map(p => p.trim());
              if (name && value) {
                const values = new Set();
                variants.forEach((v) => {
                  const vParts = v.title.split(" / ");
                  vParts.forEach((vPart) => {
                    const [vName, vValue] = vPart.split(":").map(p => p.trim());
                    if (vName === name && vValue) values.add(vValue);
                  });
                });
                if (values.size > 0) {
                  inferredOptions.push({ name, values: Array.from(values) });
                }
              }
            });
            if (inferredOptions.length > 0) {
              return { options: inferredOptions, variantsByOptions };
            }
          }
        }

        // Try common option names
        if (options.length === 1) {
          options[0].name = "Variant";
        } else if (options.length === 2) {
          options[0].name = "Color";
          options[1].name = "Size";
        } else if (options.length === 3) {
          options[0].name = "Color";
          options[1].name = "Size";
          options[2].name = "Style";
        }

        return { options, variantsByOptions };
      };

      const findVariantByOptions = (variants, selectedOptions) => {
        return variants.find((variant) => {
          const title = variant.title || "";
          const parts = title.split(" / ").map(p => p.trim().replace(/^.*:\s*/, ""));
          return selectedOptions.every((selected, index) => parts[index] === selected);
        });
      };

      const resolveEntryForSelections = (baseVariantId, colorVal, selections) => {
        const tryVariant = (key) => (baseVariantId && key ? normalizedVariantMap?.[baseVariantId]?.[key] : null);
        const tryColor = (key) => (colorVal && key ? normalizedColorMap?.[colorVal]?.[key] : null);

        const combinationKey = buildCombinationKey(
          (selections || []).map((sel) => sel?.variantId || sel?.accessoryId)
        );

        if (combinationKey) {
          const comboEntry = tryVariant(combinationKey) || tryColor(combinationKey);
          if (comboEntry?.fileUrl) return { entry: comboEntry, key: combinationKey };
        }

        for (const sel of selections || []) {
          const keys = [
            normalizeVariantId(sel?.variantId),
            normalizeVariantId(sel?.accessoryGid),
            sel?.accessoryId,
            normalizeProductId(sel?.accessoryId),
          ].filter(Boolean);
          for (const key of keys) {
            const entry = tryVariant(key) || tryColor(key);
            if (entry?.fileUrl) {
              return { entry, key };
            }
          }
        }
        return null;
      };

      const applyImage = (url) => {
        const mainImage = findMainImage();
        if (!mainImage || !url) return;
        if (!mainImage.dataset.originalSrc) {
          mainImage.dataset.originalSrc = mainImage.currentSrc || mainImage.src;
          if (mainImage.srcset) mainImage.dataset.originalSrcset = mainImage.srcset;
        }
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
        if (mainImage.dataset.originalSrc) mainImage.src = mainImage.dataset.originalSrc;
        if (mainImage.dataset.originalSrcset) mainImage.srcset = mainImage.dataset.originalSrcset;
      };

      const renderSummary = (selections = []) => {
        if (!summaryContainer) return;
        summaryContainer.innerHTML = "";
        if (!selections.length) {
          summaryContainer.hidden = true;
          return;
        }
        selections.forEach((sel) => {
          const data = accessoriesData.find((a) => a.id === sel.accessoryId);
          const priceText = typeof sel.priceCents === "number" ? formatMoney(sel.priceCents) : sel.price;
          const isUnavailable = sel.available === false;
          const row = document.createElement("div");
          row.className = "accessory-picker__summary-row";
          if (isUnavailable) row.classList.add("is-unavailable");
          if (sel.image) {
            const img = document.createElement("img");
            img.src = sel.image;
            img.alt = sel.title || "Accessory";
            img.width = 48;
            img.height = 48;
            row.appendChild(img);
          }
          const copy = document.createElement("div");
          copy.className = "accessory-picker__summary-copy";
          copy.innerHTML = [
            `<div class="accessory-picker__summary-meta">${sel.categoryLabel || "Accessory"}</div>`,
            `<div class="accessory-picker__summary-title">${sel.title || ""}</div>`,
            priceText ? `<div class="accessory-picker__summary-price">${priceText}</div>` : "",
            isUnavailable ? '<div class="accessory-picker__summary-stock">Sold out</div>' : "",
          ].join("");
          row.appendChild(copy);

          // Add remove button
          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "accessory-picker__summary-remove";
          removeBtn.innerHTML = "×";
          removeBtn.title = "Remove";
          removeBtn.setAttribute("aria-label", `Remove ${sel.title || "accessory"}`);
          removeBtn.addEventListener("click", () => {
            // Remove from category selections
            const categoryKey = sel.categoryLabel || "Accessories";
            if (categoryKey && categorySelections[categoryKey]) {
              if (Array.isArray(categorySelections[categoryKey])) {
                categorySelections[categoryKey] = categorySelections[categoryKey].filter(
                  item => item.accessoryId !== sel.accessoryId
                );
                if (categorySelections[categoryKey].length === 0) {
                  delete categorySelections[categoryKey];
                }
              } else {
                delete categorySelections[categoryKey];
              }
            }

            // Deactivate the item element
            items.forEach((el) => {
              if (el.getAttribute("data-accessory-id") === sel.accessoryId) {
                el.classList.remove("is-active");
                delete el.dataset.selectedAccessoryVariantId;
              }
            });

            // Update category UI if exists
            const categoryButtons = picker.querySelectorAll(`[data-accessory-id="${sel.accessoryId}"]`);
            categoryButtons.forEach((btn) => {
              if (btn.tagName === "BUTTON") {
                btn.classList.remove("is-selected");
              }
            });

            applySelections();
          });
          row.appendChild(removeBtn);

          // Add variant options selectors
          if (data?.variants?.length > 1) {
            const variantOptionsData = parseVariantOptions(data.variants);

            if (variantOptionsData) {
              const { options, variantsByOptions } = variantOptionsData;
              const optionsWrapper = document.createElement("div");
              optionsWrapper.className = "accessory-picker__summary-options";

              // Parse current variant to get selected options
              const currentVariant = data.variants.find(v => v.id === sel.variantId) || data.variants[0];
              const currentTitle = currentVariant.title || "";
              const currentParts = currentTitle.split(" / ").map(p => p.trim().replace(/^.*:\s*/, ""));

              const selectedOptions = [...currentParts];

              options.forEach((option, optionIndex) => {
                const optionGroup = document.createElement("div");
                optionGroup.className = "accessory-picker__option-group";

                const label = document.createElement("label");
                label.className = "accessory-picker__option-label";
                label.textContent = option.name;
                optionGroup.appendChild(label);

                const select = document.createElement("select");
                select.className = "accessory-picker__option-select";
                select.dataset.optionIndex = optionIndex;
                select.dataset.accessoryId = sel.accessoryId;

                option.values.forEach((value) => {
                  const opt = document.createElement("option");
                  opt.value = value;
                  opt.textContent = value;
                  opt.selected = value === currentParts[optionIndex];
                  select.appendChild(opt);
                });

                select.addEventListener("change", () => {
                  // Update selected options
                  selectedOptions[optionIndex] = select.value;

                  // Find matching variant
                  const matchingVariant = findVariantByOptions(data.variants, selectedOptions);

                  if (matchingVariant) {
                    // Update all option selects to match the found variant
                    const matchingParts = matchingVariant.title.split(" / ").map(p => p.trim().replace(/^.*:\s*/, ""));
                    optionsWrapper.querySelectorAll(".accessory-picker__option-select").forEach((sel, idx) => {
                      sel.value = matchingParts[idx];
                      selectedOptions[idx] = matchingParts[idx];
                    });

                    // Update the variant ID
                    items.forEach((el) => {
                      if (el.getAttribute("data-accessory-id") === sel.accessoryId) {
                        el.dataset.selectedAccessoryVariantId = matchingVariant.id;
                      }
                    });

                    const categoryKey = sel.categoryLabel || "Accessories";
                    if (categoryKey && categorySelections[categoryKey]) {
                      // Update in array if exists
                      if (Array.isArray(categorySelections[categoryKey])) {
                        const index = categorySelections[categoryKey].findIndex(
                          item => item.accessoryId === sel.accessoryId
                        );
                        if (index !== -1) {
                          categorySelections[categoryKey][index] = {
                            ...categorySelections[categoryKey][index],
                            variantId: matchingVariant.id,
                          };
                        }
                      } else {
                        categorySelections[categoryKey] = {
                          ...categorySelections[categoryKey],
                          variantId: matchingVariant.id,
                        };
                      }
                    }

                    applySelections();
                  }
                });

                optionGroup.appendChild(select);
                optionsWrapper.appendChild(optionGroup);
              });

              row.appendChild(optionsWrapper);
            } else {
              // Fallback to single dropdown if parsing fails
              const variantSelect = document.createElement("select");
              variantSelect.className = "accessory-picker__summary-variant";
              data.variants.forEach((v) => {
                const opt = document.createElement("option");
                opt.value = v.id;
                const meta = getVariantMetaSync(v.id, sel.accessoryId);
                const optPrice = meta?.price;
                opt.textContent = optPrice ? `${v.title} • ${formatMoney(optPrice)}` : v.title;
                if (meta?.available === false) opt.disabled = true;
                opt.selected = v.id === sel.variantId;
                variantSelect.appendChild(opt);
              });
              variantSelect.addEventListener("change", () => {
                items.forEach((el) => {
                  if (el.getAttribute("data-accessory-id") === sel.accessoryId) {
                    el.dataset.selectedAccessoryVariantId = variantSelect.value;
                  }
                });
                const categoryKey = sel.categoryLabel || "Accessories";
                if (categoryKey && categorySelections[categoryKey]) {
                  if (Array.isArray(categorySelections[categoryKey])) {
                    const index = categorySelections[categoryKey].findIndex(
                      item => item.accessoryId === sel.accessoryId
                    );
                    if (index !== -1) {
                      categorySelections[categoryKey][index] = {
                        ...categorySelections[categoryKey][index],
                        variantId: variantSelect.value,
                      };
                    }
                  } else {
                    categorySelections[categoryKey] = {
                      ...categorySelections[categoryKey],
                      variantId: variantSelect.value,
                    };
                  }
                }
                applySelections();
              });
              row.appendChild(variantSelect);
            }
          }

          summaryContainer.appendChild(row);
        });
        summaryContainer.hidden = false;
      };

      const hasMappingFor = (el, baseVariantId, colorVal) => {
        if (!el) return false;
        const accId = el.getAttribute("data-accessory-id");
        const accGid = el.getAttribute("data-accessory-gid");
        const variantId = el.dataset.selectedAccessoryVariantId || el.getAttribute("data-accessory-variant-id");
        const numeric = normalizeProductId(accGid) || normalizeProductId(accId);
        const variantEntry = baseVariantId ? normalizedVariantMap?.[baseVariantId]?.[variantId] : null;
        const colorEntry =
          colorVal &&
          (normalizedColorMap?.[colorVal]?.[accGid] ||
            normalizedColorMap?.[colorVal]?.[accId] ||
            (numeric && normalizedColorMap?.[colorVal]?.[numeric]));
        return !!(variantEntry || colorEntry);
      };

      const hasMaps =
        (normalizedColorMap && Object.keys(normalizedColorMap).length > 0) ||
        (normalizedVariantMap && Object.keys(normalizedVariantMap).length > 0);

      const updateWidgetVisibility = (baseVariantId, colorVal) => {
        if (!hasMaps) return;
        let hasAny = false;
        items.forEach((el) => {
          const m = hasMappingFor(el, baseVariantId, colorVal);
          if (m) hasAny = true;
        });
        if (!hasAny) restoreImage();
      };

      const updateCategoryCounts = () => {
        // Update category badges to show selected count
        picker.querySelectorAll(".accessory-picker__category-count").forEach((badge) => {
          const label = badge.dataset.categoryLabel;
          if (label && categorySelections[label]) {
            const count = Array.isArray(categorySelections[label])
              ? categorySelections[label].length
              : 1;
            badge.textContent = count;
            badge.style.display = count > 0 ? "" : "none";
          } else {
            badge.textContent = "0";
            badge.style.display = "none";
          }
        });
      };

      const updateTotals = async (baseVariantId, selections = []) => {
        if (!totalsContainer || !totalPriceEl) return;
        if (!baseVariantId) {
          totalsContainer.hidden = true;
          if (stockWarningEl) {
            stockWarningEl.hidden = true;
            stockWarningEl.textContent = "";
          }
          return;
        }
        let totalCents = 0;
        const warnings = [];
        const baseMeta = baseVariantId ? await getVariantMetaAsync(baseVariantId) : null;
        if (baseMeta?.price) totalCents += baseMeta.price;
        if (baseMeta && baseMeta.available === false) warnings.push("Base product is sold out");

        const hydratedSelections = await Promise.all(
          (selections || []).map(async (sel) => {
            const meta = await getVariantMetaAsync(sel.variantId, sel.accessoryId);
            const priceCents = meta?.price ?? sel.priceCents;
            const price = typeof priceCents === "number" ? formatMoney(priceCents) : sel.price;
            const available = meta?.available !== false;
            if (!meta) warnings.push(`${sel.title || "Accessory"} unavailable`);
            if (meta && meta.available === false) warnings.push(`${sel.title || "Accessory"} is sold out`);
            if (meta?.price) totalCents += meta.price;
            return {
              ...sel,
              priceCents,
              price,
              available,
              inventory: meta?.inventory_quantity ?? sel.inventory,
            };
          })
        );

        totalPriceEl.textContent = formatMoney(totalCents);
        totalsContainer.hidden = false;
        if (stockWarningEl) {
          if (warnings.length) {
            stockWarningEl.hidden = false;
            stockWarningEl.textContent = warnings.join(" • ");
          } else {
            stockWarningEl.hidden = true;
            stockWarningEl.textContent = "";
          }
        }
        stockBlocked = warnings.some((w) => /sold out|unavailable/i.test(w));
        renderSummary(hydratedSelections);
      };

      const updateFormProperties = (selections = []) => {
        const addToCartForms = document.querySelectorAll('form[action*="/cart/add"]');
        if (!addToCartForms.length) return;

        // Remove any existing accessory property inputs from all forms
        addToCartForms.forEach(form => {
          form.querySelectorAll('.accessory-bundle-prop').forEach(el => el.remove());
        });

        if (!selections || selections.length === 0) return;

        // Generate bundle group ID (same format as addBundleViaAjax)
        const bundleGroupId = `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Add bundle properties to ALL product forms
        addToCartForms.forEach(addToCartForm => {
          // Add bundle properties to the base product (parent role)
          const bundleGroupInput = document.createElement("input");
          bundleGroupInput.type = "hidden";
          bundleGroupInput.className = "accessory-bundle-prop";
          bundleGroupInput.name = "properties[_bundleGroupId]";
          bundleGroupInput.value = bundleGroupId;
          addToCartForm.appendChild(bundleGroupInput);

          const bundleRoleInput = document.createElement("input");
          bundleRoleInput.type = "hidden";
          bundleRoleInput.className = "accessory-bundle-prop";
          bundleRoleInput.name = "properties[_bundleRole]";
          bundleRoleInput.value = "parent";
          addToCartForm.appendChild(bundleRoleInput);

          const bundleSizeInput = document.createElement("input");
          bundleSizeInput.type = "hidden";
          bundleSizeInput.className = "accessory-bundle-prop";
          bundleSizeInput.name = "properties[Bundle Size]";
          bundleSizeInput.value = String(selections.length + 1);
          addToCartForm.appendChild(bundleSizeInput);

          // Add display properties for each accessory
          selections.forEach((sel, idx) => {
            const categoryLabel = sel.categoryLabel || `Accessory ${idx + 1}`;
            const labelParts = [sel.title];
            if (sel.variantTitle) labelParts.push(sel.variantTitle);
            const displayLabel = labelParts.filter(Boolean).join(" - ");

            const propInput = document.createElement("input");
            propInput.type = "hidden";
            propInput.className = "accessory-bundle-prop";
            propInput.name = `properties[Add ${categoryLabel}]`;
            propInput.value = displayLabel;
            addToCartForm.appendChild(propInput);
          });

          // Store bundle data in a data attribute for components to reference
          addToCartForm.dataset.bundleGroupId = bundleGroupId;
          addToCartForm.dataset.bundleSelections = JSON.stringify(selections);
        });
      };

      const applySelections = () => {
        const colorVal = normalizeColor(
          document.querySelector('select[name^="options["][name*="color" i]')?.value ||
          document.querySelector('input[type="radio"][name*="color" i]:checked')?.value ||
          ""
        );
        const baseVariantId = getBaseVariantId();
        const selections = getAllSelections();
        setActive(
          selections
            .map((s) => s.accessoryId)
            .filter(Boolean)
        );
        const resolved = resolveEntryForSelections(baseVariantId, colorVal, selections);
        if (resolved?.entry?.fileUrl) {
          applyImage(resolved.entry.fileUrl);
        } else {
          restoreImage();
        }
        renderSummary(selections);
        updateWidgetVisibility(baseVariantId, colorVal);
        updateCategoryCounts();
        if (totalsContainer) {
          updateTotals(baseVariantId, selections);
        }
        updateFormProperties(selections);
      };

      picker.querySelectorAll("[data-accessory-variant-select]").forEach((select) => {
        select.addEventListener("change", () => {
          const accId = select.getAttribute("data-accessory-id");
          const selectedVariant = select.value;
          items.forEach((el) => {
            if (el.getAttribute("data-accessory-id") === accId) {
              el.dataset.selectedAccessoryVariantId = selectedVariant;
            }
          });
          const categoryLabel = categoryLabelByAccessory[accId];
          if (categoryLabel && categorySelections[categoryLabel]) {
            categorySelections[categoryLabel] = {
              ...categorySelections[categoryLabel],
              variantId: selectedVariant,
            };
          }
          applySelections();
        });
      });

      const filterVisibleForColor = () => {
        if (!hasMaps) return;
        const colorVal = normalizeColor(
          document.querySelector('select[name^="options["][name*="color" i]')?.value ||
          document.querySelector('input[type="radio"][name*="color" i]:checked')?.value ||
          ""
        );
        const baseVariantId = getBaseVariantId();
        items.forEach((el) => {
          const hasMapping = hasMappingFor(el, baseVariantId, colorVal);
          el.style.display = hasMapping ? "" : "none";
        });
      };

      buildCategorySelectors();
      filterVisibleForColor();
      applySelections();

      const reapply = () => {
        filterVisibleForColor();
        applySelections();
      };

      const addBundleViaAjax = async () => {
        const baseVariantId = getBaseVariantId();
        if (!baseVariantId) return;

        if (stockBlocked) return;

        const selections = getAllSelections();
        const parentIdNumeric = Number(baseVariantId) || baseVariantId;
        const rulesetHandle = picker.getAttribute("data-ruleset-handle") || "";
        const baseProductId = picker.getAttribute("data-product-id") || "";
        const bundleProductHandle = picker.getAttribute("data-bundle-product-handle") || "";

        const qtyInput =
          picker.querySelector('form[action*="/cart/add"] [name="quantity"]') ||
          document.querySelector('form[action*="/cart/add"] [name="quantity"]');
        const quantity = Math.max(1, parseInt(qtyInput?.value || "1", 10) || 1);
        const bundleGroupId = `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const payload = (selections || []).map((sel) => ({
          category: sel.categoryLabel,
          productId: sel.accessoryGid || sel.accessoryId,
          variantId: sel.variantId,
          title: sel.title,
          price: sel.price,
          priceCents: sel.priceCents,
          available: sel.available,
          inventory: sel.inventory,
          image: sel.image,
        }));

        const hasAccessories = (selections?.length || 0) > 0;

        // Check if we should use the bundle product approach
        const useBundleProduct = bundleProductHandle && bundleProductHandle.trim() !== "" && hasAccessories;

        let bundleProductVariantId = null;
        if (useBundleProduct) {
          try {
            const root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
            const productUrl = `${root}products/${bundleProductHandle}.js`;
            const productResponse = await fetch(productUrl);
            if (productResponse.ok) {
              const productData = await productResponse.json();
              if (productData && productData.variants && productData.variants.length > 0) {
                bundleProductVariantId = productData.variants[0].id;
              }
            }
          } catch (err) {
            console.error("Failed to fetch bundle product:", err);
          }
        }

        const bundleProps = hasAccessories ? {
          Bundle: "Yes",
          bundleGroupId: bundleGroupId,
          bundleRole: useBundleProduct ? "parent" : "base",
          bundleSize: String((selections?.length || 0) + (useBundleProduct ? 2 : 1)),
          bundleParentProductId: baseProductId?.toString?.() || "",
          bundleParentVariantId: `${parentIdNumeric}`,
        } : {};

        const addonProps = {};
        (selections || []).forEach((sel, idx) => {
          const categoryLabel = sel.categoryLabel || `Accessory ${idx + 1}`;
          const labelParts = [sel.title];
          if (sel.variantTitle) labelParts.push(sel.variantTitle);
          const displayLabel = labelParts.filter(Boolean).join(" - ");
          addonProps[`Add ${categoryLabel}`] = displayLabel;
        });

        const items = [];

        // Add base product as parent (with bundle info if accessories selected)
        items.push({
          id: parentIdNumeric,
          quantity,
          properties: hasAccessories ? {
            _bundleGroupId: bundleGroupId,
            _bundleRole: "parent",
          } : {},
        });

        // Add accessories as components
        if (hasAccessories) {
          (selections || []).forEach((sel) => {
            items.push({
              id: Number(sel.variantId) || sel.variantId,
              quantity,
              properties: {
                _bundleGroupId: bundleGroupId,
                _bundleRole: "component",
              },
            });
          });
        }

        if (!items.length) return;

        const root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
        const cartAddUrl = `${root}cart/add`;

        try {
          const response = await fetch(cartAddUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ items }),
          });
          const text = await response.text();
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (e) { }

          if (!response.ok) {
            alert("Sorry, we could not add these items to your cart.");
            return;
          }

          document.dispatchEvent(
            new CustomEvent("accessory-picker:added", {
              detail: { items, response: json || text },
            })
          );
          if (document.querySelector("cart-drawer") || document.querySelector("cart-notification")) {
            document.dispatchEvent(new Event("cart:refresh"));
          } else {
            window.location.href = "/cart";
          }
        } catch (err) {
          alert("Sorry, something went wrong. Please try again.");
        }
      };

      const inlineCta = picker.querySelector("[data-accessory-submit]");
      if (inlineCta) {
        inlineCta.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          addBundleViaAjax();
        });
      }

      // Intercept form submission - SINGLE reliable handler per Shopify best practices
      let globalIsAddingAccessories = false;
      const addToCartForms = document.querySelectorAll('form[action*="/cart/add"]');
      let handlerAttached = false;

      addToCartForms.forEach(addToCartForm => {
        // Only attach to forms with submit buttons (main product form)
        if (handlerAttached) return;
        if (!addToCartForm.querySelector('[type="submit"], [name="add"]')) return;

        // Prevent double-binding
        if (addToCartForm.dataset.bundleHandlerAttached === 'true') return;
        addToCartForm.dataset.bundleHandlerAttached = 'true';
        handlerAttached = true;

        addToCartForm.addEventListener("submit", async (event) => {
          const selections = getAllSelections();

          if (!selections || selections.length === 0) {
            return; // No accessories, let Dawn's handler run normally
          }

          // We have accessories - take full control
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          const submitButton = addToCartForm.querySelector('[type="submit"], [name="add"]');
          if (submitButton) submitButton.disabled = true;

          try {
            // Get form data
            const formData = new FormData(addToCartForm);
            const variantId = formData.get('id');
            const quantity = Math.max(1, parseInt(formData.get('quantity') || '1', 10));
            const bundleGroupId = addToCartForm.dataset.bundleGroupId;

            if (!variantId || !bundleGroupId) {
              throw new Error('Missing variant ID or bundle group ID');
            }

            // Build items array: ALL items in ONE request (Shopify best practice)
            const items = [];

            // Build display properties for parent
            const displayProps = {};
            selections.forEach((sel, idx) => {
              const categoryLabel = sel.categoryLabel || `Accessory ${idx + 1}`;
              const labelParts = [sel.title];
              if (sel.variantTitle) labelParts.push(sel.variantTitle);
              const displayLabel = labelParts.filter(Boolean).join(" - ");
              displayProps[`Add ${categoryLabel}`] = displayLabel;
            });

            // Add parent product first
            items.push({
              id: Number(variantId) || variantId,
              quantity,
              properties: {
                ...displayProps,
                _bundleGroupId: bundleGroupId,
                _bundleRole: "parent",
                "Bundle Size": String(selections.length + 1),
              },
            });

            // Add accessories as components
            selections.forEach((sel) => {
              items.push({
                id: Number(sel.variantId) || sel.variantId,
                quantity,
                properties: {
                  _bundleGroupId: bundleGroupId,
                  _bundleRole: "component",
                },
              });
            });

            // SINGLE cart add with section rendering (Shopify best practice)
            const root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
            const response = await fetch(`${root}cart/add.js`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
              },
              credentials: "same-origin",
              body: JSON.stringify({
                items,
                sections: [
                  'cart-icon-bubble',
                  'cart-notification-product',
                  'cart-notification-button',
                ],
                sections_url: window.location.pathname
              }),
            });

            const responseData = await response.json();

            if (!response.ok) {
              const errorMessage = responseData?.message || responseData?.description || 'Could not add bundle to cart.';
              alert(`Error: ${errorMessage}`);
              submitButton.disabled = false;
              return;
            }

            // Success! Now update UI (wrapped to prevent UI errors from breaking cart add)
            try {
              // Update cart UI using returned sections (theme-agnostic)
              if (responseData.sections) {
                Object.entries(responseData.sections).forEach(([sectionId, sectionHtml]) => {
                  const parser = new DOMParser();
                  const doc = parser.parseFromString(sectionHtml, 'text/html');
                  const newSection = doc.getElementById(sectionId);

                  if (newSection) {
                    const currentSection = document.getElementById(sectionId);
                    if (currentSection) {
                      currentSection.replaceWith(newSection);
                    }
                  }
                });
              }

              // Theme-agnostic cart UI refresh
              // 1. Try Dawn's cart notification with renderContents
              const cartNotification = document.querySelector('cart-notification');
              if (cartNotification) {
                if (typeof cartNotification.renderContents === 'function') {
                  // Dawn's preferred method - pass the response data
                  cartNotification.renderContents(responseData);
                } else if (typeof cartNotification.open === 'function') {
                  // Fallback to just opening (sections already replaced above)
                  cartNotification.open();
                }
              }

              // 2. Try cart drawer (various themes)
              const cartDrawer = document.querySelector('cart-drawer, [data-cart-drawer], #cart-drawer');
              if (cartDrawer) {
                if (typeof cartDrawer.open === 'function') {
                  cartDrawer.open();
                } else {
                  cartDrawer.classList.add('active', 'is-open', 'open');
                  cartDrawer.setAttribute('aria-hidden', 'false');
                }
              }

              // 3. Update cart count badges (universal)
              fetch((window.Shopify?.routes?.root || '/') + 'cart.js')
                .then(res => res.json())
                .then(cart => {
                  const selectors = [
                    '[data-cart-count]',
                    '.cart-count',
                    '.cart-count-bubble',
                    '#cart-count',
                    '.header__cart-count'
                  ];
                  selectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach(el => {
                      el.textContent = cart.item_count;
                      if (cart.item_count > 0) {
                        el.classList.remove('hidden', 'hide');
                        el.style.display = '';
                      }
                    });
                  });
                })
                .catch(() => { }); // Silent fail for cart count

              // 4. Dispatch universal events for theme customizations
              document.dispatchEvent(new CustomEvent('cart:updated', {
                detail: { cart: responseData, source: 'bundle-add' }
              }));
              document.dispatchEvent(new CustomEvent('bundle:cart-updated', {
                detail: { sections: responseData.sections, cart: responseData }
              }));

              // 5. Fallback: if no cart UI found, redirect to cart page
              setTimeout(() => {
                if (!cartNotification && !cartDrawer) {
                  window.location.href = '/cart';
                }
              }, 100);

            } catch (uiError) {
              // Cart add succeeded but UI update failed - not critical
              console.warn("Cart add succeeded but UI update had an issue:", uiError);
              // Still show some feedback - reload page or redirect to cart
              window.location.href = '/cart';
            }

          } catch (err) {
            console.error("Failed to add bundle:", err);
            alert('Sorry, could not add bundle. Please try again.');
          } finally {
            submitButton.disabled = false;
          }
        }, { capture: true }); // CRITICAL: Use capture phase to run BEFORE Dawn's handler
      });

      document.addEventListener("variant:changed", reapply);
      document.addEventListener("product:variant-change", reapply);
      document.addEventListener("product:variant-change", () => setTimeout(reapply, 50));
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
  document.addEventListener("shopify:section:load", run);
  document.addEventListener("shopify:section:reorder", run);
  document.addEventListener("shopify:blocks:load", run);
})();
