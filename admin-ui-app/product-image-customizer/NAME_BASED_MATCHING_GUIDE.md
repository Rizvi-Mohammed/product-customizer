# Name-Based Image Matching System

## Overview
This system uses **name-based matching** instead of variant ID matching, making image mappings more flexible and reducing the number of explicit mappings needed.

## How It Works

### Traditional ID-Based Matching (Old System)
- **Problem**: Hat Variant #12345 → Charm Variant #67890
- If you add a new variant, you need a new mapping
- Example: 10 hat colors × 26 charm letters = **260 explicit mappings** 😱

### Name-Based Matching (New System)
- **Solution**: Hat (Color: Caramel) → Charm (Color: Gold)
- System checks option **values**, not IDs
- Example: 10 hat colors × 2 charm colors = **20 mappings** ✅

## Data Structure

### What Gets Saved in Metaobjects
```json
{
  "baseColorKey": "caramel",
  "accessoryVariantId": "gid://shopify/ProductVariant/123",
  "fileUrl": "https://cdn.shopify.com/...",
  "baseOptionName": "Color",
  "baseOptionValue": "Caramel",
  "accessoryOptionName": "Color", 
  "accessoryOptionValue": "Gold"
}
```

### How Frontend Matches Images

1. **Customer selects product variant**: Hat in Caramel
2. **Customer selects accessory**: Charm (Gold, Letter A)
3. **System checks**:
   - Does product variant have Color = "Caramel"? ✓
   - Does accessory variant have Color = "Gold"? ✓
4. **System swaps image** to the mapped image

**Result**: All charm variants with Gold color (A-Z) use the same mapping!

## Merchant UX: Grouping Controls

### Base Product Grouping

**Toggle**: Group variants ☑️ / ☐  
**Dropdown**: Group by Color | Size | Material | etc.

**Example - Hat Product**:
- Options: Color (10 values), Size (3 values)
- **Grouped by Color**: 10 groups, each with 3 variants
  - Caramel (S, M, L)
  - Navy (S, M, L)
  - Charcoal (S, M, L)
- **Grouped by Size**: 3 groups, each with 10 variants
  - Small (10 colors)
  - Medium (10 colors)
  - Large (10 colors)
- **Ungrouped**: 30 individual variants

### Accessory Grouping

**Each accessory has its own grouping control**:

**Example - Charm Product**:
- Options: Color (2 values: Gold, Silver), Letter (26 values: A-Z)
- **Grouped by Color**: 2 groups covering 52 variants total
  - Gold (A, B, C, ..., Z) - 26 variants
  - Silver (A, B, C, ..., Z) - 26 variants
- **Grouped by Letter**: 26 groups covering 52 variants total
  - A (Gold, Silver)
  - B (Gold, Silver)
  - ...
- **Ungrouped**: 52 individual variants

**Recommendation**: Group by the option with **fewer values** to reduce UI clutter.

## Creating Mappings

### Step 1: Select Base Variant Group
```
Select base product: Hat → Caramel (3 variants: S, M, L)
```

### Step 2: Select Accessory Group
```
Charm → Gold (26 variants: A-Z)
```

### Step 3: Upload Image
The system shows:
```
Matching: Color=Caramel → Color=Gold
Covers: 3 base variants × 26 accessory variants = 78 combinations
```

Upload **one image** that applies to all these combinations!

## Benefits

### For Merchants
1. **Fewer mappings**: Instead of hundreds, just dozens
2. **Flexible**: Add new variants without remapping
3. **Intuitive**: "Caramel goes with Gold" makes sense
4. **Scalable**: Works for products with many variants

### For Customers
1. **Consistent**: Same look for related variants
2. **Fast**: No need to upload hundreds of images
3. **Smart**: System auto-applies to matching variants

## Example Scenarios

### Scenario 1: Simple Color Matching
**Product**: T-Shirt with 5 colors  
**Accessory**: Patch with 3 colors

**Setup**:
- Group base by: Color (5 groups)
- Group accessory by: Color (3 groups)
- **Total mappings needed**: 5 × 3 = **15 mappings**

### Scenario 2: Multi-Option Products
**Product**: Shoes with Color (8) and Size (10) = 80 variants  
**Accessory**: Laces with Color (6) and Length (2) = 12 variants

**Smart Setup**:
- Group base by: Color (8 groups, each with 10 sizes)
- Group accessory by: Color (6 groups, each with 2 lengths)
- **Total mappings needed**: 8 × 6 = **48 mappings**

**Without grouping**: 80 × 12 = **960 mappings** 😱

### Scenario 3: Complex Accessories
**Product**: Hat with Color (10)  
**Accessory 1**: Charm with Color (2) and Letter (26) = 52 variants  
**Accessory 2**: Badge with Style (4)

**Smart Setup**:
- Base: Group by Color (10 groups)
- Charm: Group by Color (2 groups) ← Smart! Covers all 26 letters per color
- Badge: Ungrouped (4 variants)
- **Total mappings**: 10 × (2 + 4) = **60 mappings**

## Technical Implementation

### Frontend Block Script (Liquid/JS)
```javascript
function findMatchingImage(baseVariant, accessoryVariant, mappings) {
  // Get base variant option value
  const baseColor = baseVariant.options.find(o => o.name === 'Color')?.value;
  
  // Get accessory variant option value
  const accColor = accessoryVariant.options.find(o => o.name === 'Color')?.value;
  
  // Find mapping that matches both
  const mapping = mappings.find(m => 
    m.baseOptionValue === baseColor && 
    m.accessoryOptionValue === accColor
  );
  
  return mapping?.fileUrl || baseVariant.image;
}
```

### Key Matching Logic
1. Extract option name and value from selected variants
2. Compare against saved mappings
3. Match when **both** option values align
4. Return the image URL or fallback to default

## Best Practices

### 1. Choose the Right Grouping Option
- Use the option with **visual significance** (usually Color)
- Avoid grouping by options that don't affect appearance

### 2. Start with Fewer Groups
- Begin with color grouping (usually 3-10 groups)
- Only use ungrouped for very specific cases

### 3. Test Your Mappings
- Select different variant combinations
- Verify correct images appear
- Check that all options within a group work

### 4. Document Your Logic
Example:
```
Hat Caramel → Charm Gold
Hat Navy → Charm Silver
Hat Charcoal → Charm Black
```

## Troubleshooting

### Issue: "Too many mapping slots!"
**Solution**: Enable grouping for accessories with many variants

### Issue: "Image doesn't change for some variants"
**Solution**: Check if those variants have different option names (e.g., "Colour" vs "Color")

### Issue: "Need different images per letter"
**Solution**: Group by Letter instead of Color, or disable grouping

## Migration from ID-Based System

If you previously used variant IDs:

1. **Old mapping** stored only IDs
2. **New mapping** stores IDs + option metadata
3. Frontend tries name-based first, falls back to ID-based
4. Re-upload images to create name-based mappings

## Summary

✅ **Name-based matching** = Flexible, scalable, intuitive  
✅ **Grouping controls** = Manageable UI, fewer mappings  
✅ **Smart defaults** = Group by color for most products  
✅ **Merchant-friendly** = Logical organization, clear relationships

This system dramatically reduces the mapping workload while maintaining full flexibility for complex product catalogs!
