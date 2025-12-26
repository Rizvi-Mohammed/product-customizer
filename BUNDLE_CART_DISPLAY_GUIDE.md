# Displaying Bundle Properties in Cart

## What Changed

The Cart Transform function now adds bundle component details as **attributes** to merged cart lines:

- Each component is listed as a property: `"Product Name": "x1"`
- A summary property: `"Bundle": "Includes: Base Product + Accessory A, Accessory B"`
- The title is prefixed with "Bundle: " to make it clear

## How to Display in Your Theme Cart

### Option 1: Using the Snippet (Recommended)

In your cart template (e.g., `sections/main-cart.liquid` or `snippets/cart-item.liquid`), after the line item title, add:

```liquid
<div class="cart-item__details">
  <a href="{{ item.url }}">{{ item.product.title }}</a>
  
  {%- if item.product.has_only_default_variant == false or item.properties.size > 0 -%}
    <div class="cart-item__meta">
      {%- unless item.product.has_only_default_variant -%}
        <div>{{ item.variant.title }}</div>
      {%- endunless -%}
      
      {%- comment -%} RENDER BUNDLE PROPERTIES HERE {%- endcomment -%}
      {% render 'bundle-properties-display', item: item %}
    </div>
  {%- endif -%}
</div>
```

### Option 2: Inline Display (No Snippet)

Add this directly in your cart item loop:

```liquid
{%- if item.properties.size > 0 -%}
  <div class="bundle-properties">
    {%- for property in item.properties -%}
      {%- assign property_first_char = property.first | slice: 0 -%}
      {%- unless property_first_char == '_' -%}
        <div class="bundle-property">
          <strong>{{ property.first }}:</strong> {{ property.last }}
        </div>
      {%- endunless -%}
    {%- endfor -%}
  </div>
{%- endif -%}
```

### Option 3: Display Only Bundle Summary

If you only want to show the "Bundle: Includes..." line:

```liquid
{%- for property in item.properties -%}
  {%- if property.first == 'Bundle' -%}
    <div class="bundle-summary" style="color: #666; font-size: 0.875rem; margin-top: 0.5rem;">
      {{ property.last }}
    </div>
  {%- endif -%}
{%- endfor -%}
```

## Expected Output

When a bundle is in the cart, customers will see:

**Bundle: Base Product Name**
$171.00

Properties:
- **Base Product Name:** x1
- **Accessory A:** x1
- **Accessory B:** x1
- **Bundle:** Includes: Base Product Name + Accessory A, Accessory B

## Styling Tips

Add custom CSS to your theme to style bundle properties:

```css
.bundle-properties {
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: #f9f9f9;
  border-radius: 4px;
  font-size: 0.875rem;
}

.bundle-property {
  margin-bottom: 0.25rem;
  color: #666;
}

.bundle-property strong {
  color: #333;
}
```

## Testing

1. Clear your cart
2. Add a product with accessories
3. Go to cart page (`/cart`)
4. You should see all bundle components listed as properties

## Troubleshooting

**Properties not showing?**
- Ensure the theme app extension is enabled in your theme customizer
- Check that you're looking at the cart page (not a drawer/AJAX cart)
- Verify the cart transform function is activated

**Only seeing underscore properties?**
- The snippet filters these out automatically
- Make sure you're using the `unless property_first_char == '_'` check
