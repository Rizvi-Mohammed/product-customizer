# Dynamic Bundle Feature Setup

## Overview
This feature allows you to create dynamic bundles where a "Create Your Bundle" product is added to the cart with the base product and selected accessories as bundled items (similar to the example screenshot).

## Setup Instructions

### 1. Create Your Bundle Product
First, create a product in your Shopify store that will serve as the bundle container:

1. Go to Shopify Admin → Products → Add product
2. Create a product with a name like "Create Your Bundle" or "Custom Bundle"
3. Set the price to $0 (the price will come from the bundled items)
4. Note the product **handle** (e.g., `create-your-bundle`)

### 2. Configure the Theme Block
After creating your bundle product, configure the accessory picker block in your theme:

1. Go to your Shopify theme editor
2. Navigate to a product page template
3. Find the **"Accessory picker"** block
4. In the block settings, enter your bundle product handle in the **"Bundle Product Handle"** field
   - Example: `create-your-bundle`
5. Save your theme

### 3. How It Works

When a customer:
1. Views a product detail page (PDP)
2. Selects accessories using the widget
3. Clicks "Add to cart"

The system will:
- Add your "Create Your Bundle" product to the cart as the **parent item**
- Add the base product as a **bundled component**
- Add all selected accessories as **bundled components**

All items will be grouped together and displayed as a single bundle in the cart, similar to the screenshot example.

### 4. Cart Transform Function

The bundle cart transform function automatically:
- Groups items with the same `bundleGroupId`
- Merges component items into the parent bundle product
- Ensures the bundle displays correctly in cart and checkout

### 5. Testing

To test the feature:
1. Go to any product with the accessory picker block
2. Select one or more accessories
3. Click "Add with accessories"
4. View your cart - you should see:
   - The "Create Your Bundle" product as the main line item
   - The base product and accessories nested under it as bundle components

### 6. Important Notes

- If no bundle product handle is configured, the system falls back to the original behavior (adding items separately)
- The bundle product handle must exactly match the product handle in Shopify
- Make sure the bundle product is active and available
- The cart transform function requires the bundle-cart-transform extension to be deployed

## Technical Details

### Properties Added to Cart Lines

**Parent Bundle Product:**
- `bundleGroupId`: Unique identifier for the bundle group
- `bundleRole`: "parent"
- `_bundleGroupId`: Same as above (for cart transform)
- `_bundleRole`: "parent" (for cart transform)

**Base Product & Accessories:**
- `bundleGroupId`: Matches the parent's group ID
- `bundleRole`: "component"
- `_bundleGroupId`: Same as above
- `_bundleRole`: "component"
- `_bundleParentVariantId`: ID of the parent bundle variant

The cart transform function uses these properties to identify and merge the bundle items.

## Troubleshooting

**Bundle not appearing:**
- Verify the bundle product handle is correct
- Check that the product exists and is active
- Ensure the cart transform extension is deployed

**Items not merging:**
- Check browser console for errors
- Verify the bundleGroupId is the same for all items
- Ensure the cart transform function is active in your Shopify store

**Price is wrong:**
- The bundle product should have a $0 price
- The price will be calculated from the bundled components
