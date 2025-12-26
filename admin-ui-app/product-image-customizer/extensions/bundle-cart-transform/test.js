import { cartTransformRun } from './src/cart_transform_run.js';

const testInput = {
    "cart": {
        "lines": [
            {
                "id": "gid://shopify/CartLine/1",
                "quantity": 1,
                "bundleGroupId": {
                    "value": "bundle-test-123"
                },
                "bundleRole": {
                    "value": "base"
                },
                "merchandise": {
                    "__typename": "ProductVariant",
                    "id": "gid://shopify/ProductVariant/123",
                    "title": "Green",
                    "product": {
                        "id": "gid://shopify/Product/1",
                        "title": "Test Product"
                    }
                }
            },
            {
                "id": "gid://shopify/CartLine/2",
                "quantity": 1,
                "bundleGroupId": {
                    "value": "bundle-test-123"
                },
                "bundleRole": {
                    "value": "component"
                },
                "merchandise": {
                    "__typename": "ProductVariant",
                    "id": "gid://shopify/ProductVariant/456",
                    "title": "Blue",
                    "product": {
                        "id": "gid://shopify/Product/2",
                        "title": "Accessory"
                    }
                }
            }
        ]
    }
};

console.log("Testing cart transform...");
const result = cartTransformRun(testInput);
console.log("Result:", JSON.stringify(result, null, 2));
