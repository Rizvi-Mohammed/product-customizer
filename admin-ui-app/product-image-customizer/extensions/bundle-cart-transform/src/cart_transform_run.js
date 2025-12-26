// @ts-check
/**
 * @typedef {import("../generated/api").RunInput} RunInput
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 */

/**
 * @param {RunInput} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  /** @type {CartTransformRunResult['operations']} */
  const operations = [];

  // Group cart lines by bundleGroupId
  const bundleGroups = new Map();

  input.cart.lines.forEach(line => {
    const bundleGroupId = line.bundleGroupId?.value || line.bundleGroupIdAlt?.value;
    const bundleRole = line.bundleRole?.value || line.bundleRoleAlt?.value;

    if (bundleGroupId && bundleRole) {
      if (!bundleGroups.has(bundleGroupId)) {
        bundleGroups.set(bundleGroupId, {
          parent: null,
          components: []
        });
      }

      const group = bundleGroups.get(bundleGroupId);
      if (bundleRole === 'parent' || bundleRole === 'base') {
        group.parent = line;
      } else if (bundleRole === 'component') {
        group.components.push(line);
      }
    }
  });

  // Create merge operations for each bundle group
  bundleGroups.forEach((group, bundleGroupId) => {
    if (group.parent && group.components.length > 0) {
      // Build bundle attributes for display - only individual items, no summary
      const attributes = [];

      // Add parent product as first item
      const parentTitle = group.parent.merchandise?.product?.title || "Base Product";
      attributes.push({
        key: parentTitle,
        value: `x${group.parent.quantity}`
      });

      // Add each component as a visible property
      group.components.forEach((/** @type {any} */ component) => {
        const productTitle = component.merchandise?.product?.title || "Component";
        attributes.push({
          key: productTitle,
          value: `x${component.quantity}`
        });
      });

      // Merge parent AND components into one bundle line
      operations.push({
        linesMerge: {
          parentVariantId: group.parent.merchandise.id,
          cartLines: [
            // Include the parent line itself to prevent duplication
            {
              cartLineId: group.parent.id,
              quantity: group.parent.quantity
            },
            // Include all component lines
            ...group.components.map((/** @type {any} */ component) => ({
              cartLineId: component.id,
              quantity: component.quantity
            }))
          ],
          title: `Bundle: ${group.parent.merchandise.product.title}`,
          attributes: attributes
        }
      });
    }
  });

  return { operations };
}

