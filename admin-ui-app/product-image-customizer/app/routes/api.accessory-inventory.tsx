import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

const QUERY_WITH_LOCATION = `#graphql
  query AccessoryAvailabilityWithLocation($variantIds: [ID!]!, $locationId: ID!) {
    nodes(ids: $variantIds) {
      ... on ProductVariant {
        id
        title
        availableForSale
        sellableOnlineQuantity
        inventoryQuantity
        inventoryItem {
          id
          inventoryLevel(locationId: $locationId) {
            id
            quantities(names: ["available"]) {
              name
              quantity
            }
          }
        }
      }
    }
  }
`;

const QUERY_NO_LOCATION = `#graphql
  query AccessoryAvailability($variantIds: [ID!]!) {
    nodes(ids: $variantIds) {
      ... on ProductVariant {
        id
        title
        availableForSale
        sellableOnlineQuantity
        inventoryQuantity
      }
    }
  }
`;

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: any = null;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const variantIds: string[] = Array.isArray(body?.variantIds) ? body.variantIds.filter(Boolean) : [];
  const locationId = typeof body?.locationId === "string" && body.locationId.trim() ? body.locationId.trim() : null;

  if (!variantIds.length) {
    return json({ error: "variantIds is required (non-empty array)" }, { status: 400 });
  }

  const { admin } = await authenticate.admin(request);

  const query = locationId ? QUERY_WITH_LOCATION : QUERY_NO_LOCATION;
  const variables: Record<string, unknown> = { variantIds };
  if (locationId) variables.locationId = locationId;

  const response = await admin.graphql(query, { variables });
  const payload = await response.json();

  if (payload?.errors) {
    return json({ error: "GraphQL error", details: payload.errors }, { status: 502 });
  }

  const nodes = payload?.data?.nodes || [];

  const availability = nodes
    .filter(Boolean)
    .filter((n: any) => n.__typename === "ProductVariant" || n.id)
    .map((node: any) => {
      const level = node.inventoryItem?.inventoryLevel;
      const availableAtLocation =
        level?.quantities?.find((q: any) => q?.name === "available")?.quantity ?? null;
      const sellableOnlineQuantity = node.sellableOnlineQuantity ?? 0;
      const inventoryQuantity = node.inventoryQuantity ?? null;

      const canSell =
        node.availableForSale === true &&
        sellableOnlineQuantity > 0 &&
        (availableAtLocation === null || availableAtLocation > 0);

      return {
        id: node.id,
        title: node.title,
        availableForSale: !!node.availableForSale,
        sellableOnlineQuantity,
        inventoryQuantity,
        availableAtLocation,
        canSell,
      };
    });

  return json({ availability });
};
