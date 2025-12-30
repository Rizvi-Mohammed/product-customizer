# Storefront Image Matching Logic

## Quick Reference for Theme Block Implementation

### Data Structure from Metaobject

```javascript
// Each mapping contains:
{
  fileUrl: "https://cdn.shopify.com/image.jpg",
  baseOptionName: "Color",           // e.g., "Color", "Size", "Material"
  baseOptionValue: "Caramel",        // e.g., "Caramel", "Small", "Leather"
  accessoryOptionName: "Color",      // Option to match on accessory
  accessoryOptionValue: "Gold",      // Value to match
  variantId: "gid://...",           // Fallback for ID-based matching
  accessoryProductId: "gid://..."   // Which accessory product this applies to
}
```

### Matching Algorithm (Pseudocode)

```javascript
function getCustomImage(baseVariant, selectedAccessories, mappings) {
  // 1. Filter mappings for relevant accessories
  const relevantMappings = mappings.filter(mapping => 
    selectedAccessories.some(acc => 
      acc.productId === mapping.accessoryProductId
    )
  );
  
  // 2. Try name-based matching first
  for (const mapping of relevantMappings) {
    // Check if base variant matches
    const baseMatches = baseVariant.options.some(opt => 
      opt.name === mapping.baseOptionName && 
      opt.value === mapping.baseOptionValue
    );
    
    if (!baseMatches) continue;
    
    // Check if ALL selected accessories match their criteria
    const accessoryMatches = selectedAccessories.every(acc => {
      const accMapping = relevantMappings.find(m => 
        m.accessoryProductId === acc.productId
      );
      
      if (!accMapping) return true; // No mapping = no constraint
      
      return acc.selectedVariant.options.some(opt =>
        opt.name === accMapping.accessoryOptionName &&
        opt.value === accMapping.accessoryOptionValue
      );
    });
    
    if (accessoryMatches) {
      return mapping.fileUrl; // ✅ Found match!
    }
  }
  
  // 3. Fallback to ID-based matching (legacy)
  const idMatch = relevantMappings.find(mapping =>
    mapping.variantId === baseVariant.id &&
    selectedAccessories.some(acc => 
      mapping.variantId === acc.selectedVariant.id
    )
  );
  
  if (idMatch) return idMatch.fileUrl;
  
  // 4. No match found - use default
  return baseVariant.image?.src || product.featuredImage?.src;
}
```

### Liquid Implementation Example

```liquid
{% comment %}
  Get mappings from metaobject
{% endcomment %}
{% assign ruleset = product.metafields.productCustomizer.image_customization.value %}
{% assign variant_map = ruleset.variant_map | parse_json %}

<script>
  // Build mappings array
  const mappings = {{ variant_map | json }};
  
  // Current selection
  const currentVariant = {{ product.selected_or_first_available_variant | json }};
  const selectedAccessories = []; // Populated from cart/UI
  
  // Find matching image
  function updateProductImage() {
    const baseOption = currentVariant.options.find(o => o.name === 'Color');
    
    for (const mapping of Object.values(mappings)) {
      // Check base variant option match
      if (mapping.baseOptionName === 'Color' && 
          mapping.baseOptionValue === baseOption?.value) {
        
        // Check accessory match
        const accVariant = selectedAccessories[0]; // Simplified
        const accOption = accVariant?.options.find(o => 
          o.name === mapping.accessoryOptionName
        );
        
        if (accOption?.value === mapping.accessoryOptionValue) {
          // ✅ Match found! Update image
          document.querySelector('.product-image').src = mapping.fileUrl;
          return;
        }
      }
    }
    
    // No match - use default
    document.querySelector('.product-image').src = currentVariant.featured_image?.src;
  }
  
  // Listen for variant/accessory changes
  document.addEventListener('variant-change', updateProductImage);
  document.addEventListener('accessory-change', updateProductImage);
</script>
```

### Real Example

**Scenario**: Customer views Hat (Caramel, Medium) with Charm (Gold, Letter M)

**Mapping in database**:
```json
{
  "baseOptionName": "Color",
  "baseOptionValue": "Caramel",
  "accessoryOptionName": "Color",
  "accessoryOptionValue": "Gold",
  "fileUrl": "https://cdn.shopify.com/hat-caramel-charm-gold.jpg"
}
```

**Matching process**:
1. Extract base variant Color option → "Caramel" ✅
2. Extract accessory variant Color option → "Gold" ✅
3. Find mapping where both match → Found! ✅
4. Update image to fileUrl

**Note**: Size and Letter options are **ignored** - only Color matters!

### Edge Cases

#### Multiple Accessories
```javascript
// Customer selects: Hat + Charm + Badge
// Need to match ALL accessories simultaneously

const allMatch = selectedAccessories.every(acc => {
  const mapping = mappings.find(m => m.accessoryProductId === acc.productId);
  if (!mapping) return true; // No constraint for this accessory
  
  return acc.selectedVariant.options.some(opt =>
    opt.name === mapping.accessoryOptionName &&
    opt.value === mapping.accessoryOptionValue
  );
});
```

#### Case-Insensitive Matching
```javascript
// Normalize for comparison
function normalize(value) {
  return value?.toLowerCase().trim();
}

const matches = normalize(variant.optionValue) === normalize(mapping.baseOptionValue);
```

#### Missing Metadata (Legacy)
```javascript
// If no option metadata, fall back to ID matching
if (!mapping.baseOptionName || !mapping.baseOptionValue) {
  return mapping.variantId === currentVariant.id;
}
```

### Performance Optimization

```javascript
// Cache mappings by base option value for faster lookup
const mappingCache = {};

Object.values(mappings).forEach(mapping => {
  const key = `${mapping.baseOptionName}:${mapping.baseOptionValue}`;
  if (!mappingCache[key]) mappingCache[key] = [];
  mappingCache[key].push(mapping);
});

// Fast lookup
function findMapping(baseVariant, accessory) {
  const baseOption = baseVariant.options[0]; // Assuming first option
  const cacheKey = `${baseOption.name}:${baseOption.value}`;
  const candidates = mappingCache[cacheKey] || [];
  
  return candidates.find(m => /* match accessory */);
}
```

### Testing Checklist

- [ ] Base variant alone (no accessories) shows default image
- [ ] Adding matching accessory swaps to custom image
- [ ] Changing base variant color updates image correctly
- [ ] Changing accessory variant (same color) keeps same image
- [ ] Changing accessory color updates to different image
- [ ] Removing accessory reverts to default image
- [ ] Multiple accessories all match correctly
- [ ] Legacy ID-based mappings still work

### Debug Helper

```javascript
function debugMatch(baseVariant, accessories, mappings) {
  console.group('Image Matching Debug');
  
  console.log('Base Variant:', baseVariant.title);
  baseVariant.options.forEach(opt => {
    console.log(`  ${opt.name}: ${opt.value}`);
  });
  
  console.log('Selected Accessories:', accessories.length);
  accessories.forEach(acc => {
    console.log(`  ${acc.product.title} - ${acc.selectedVariant.title}`);
    acc.selectedVariant.options.forEach(opt => {
      console.log(`    ${opt.name}: ${opt.value}`);
    });
  });
  
  console.log('Checking mappings...');
  mappings.forEach((mapping, idx) => {
    const baseMatch = baseVariant.options.some(opt =>
      opt.name === mapping.baseOptionName &&
      opt.value === mapping.baseOptionValue
    );
    console.log(`  Mapping ${idx}: Base ${baseMatch ? '✅' : '❌'}`);
    
    if (baseMatch) {
      accessories.forEach(acc => {
        const accMatch = acc.selectedVariant.options.some(opt =>
          opt.name === mapping.accessoryOptionName &&
          opt.value === mapping.accessoryOptionValue
        );
        console.log(`    Accessory ${acc.product.title}: ${accMatch ? '✅' : '❌'}`);
      });
    }
  });
  
  console.groupEnd();
}
```

## Summary

✅ Match on **option values**, not variant IDs  
✅ Check `baseOptionName`/`baseOptionValue` against base variant  
✅ Check `accessoryOptionName`/`accessoryOptionValue` against accessory  
✅ **Both must match** for image to apply  
✅ Fallback to ID-based for legacy mappings  
✅ Return default image if no matches found

This allows one mapping to cover many variant combinations!
