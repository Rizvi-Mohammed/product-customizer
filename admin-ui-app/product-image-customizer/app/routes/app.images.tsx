import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Select,
  ChoiceList,
  InlineStack,
  Button,
  Box,
  Banner,
  Thumbnail,
  Divider,
  List,
} from "@shopify/polaris";
// Types for app-bridge actions are shimmed locally; see app/types/app-bridge-actions.d.ts
import AppBridgeActions from "@shopify/app-bridge/actions";
const { Picker, PickerCreate, ResourceType } = AppBridgeActions as any;
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    const response = await admin.graphql(`#graphql
      query {
        products(first: 50) {
          edges {
            node {
              id
              title
              featuredImage { url }
              variants(first: 50) {
                edges {
                  node {
                    id
                    title
                  }
                }
              }
              metafields(namespace: "productCustomizer", first: 20) {
                edges {
                  node {
                    key
                    value
                    type
                  }
                }
              }
            }
          }
        }
      }
    `);

    const data = (await response.json()) as any;

    if (data.errors) {
      console.error("GraphQL errors:", data.errors);
      return json({ products: [], error: data.errors });
    }

    const products = data.data.products.edges.map((edge: any) => edge.node);

    return json({ products, error: null });
  } catch (error) {
    console.error("Loader error:", error);
    return json({
      products: [],
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "enable_image_mode") {
    const productId = formData.get("productId") as string;
    await admin.graphql(`#graphql
      mutation updateMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }
    `, {
      variables: {
        metafields: [
          {
            ownerId: productId,
            namespace: "productCustomizer",
            key: "is_image_customization_enabled",
            value: "true",
            type: "boolean",
          },
          {
            ownerId: productId,
            namespace: "productCustomizer",
            key: "accessories",
            value: JSON.stringify([]),
            type: "list.product_reference",
          },
        ],
      },
    });

    return json({ ok: true });
  }

  if (actionType === "save_image_accessories") {
    const productId = formData.get("productId") as string;
    const accessories = JSON.parse(formData.get("accessories") as string) as string[];

    await admin.graphql(`#graphql
      mutation updateMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }
    `, {
      variables: {
        metafields: [
          {
            ownerId: productId,
            namespace: "productCustomizer",
            key: "is_image_customization_enabled",
            value: "true",
            type: "boolean",
          },
          {
            ownerId: productId,
            namespace: "productCustomizer",
            key: "accessories",
            value: JSON.stringify(accessories),
            type: "list.product_reference",
          },
        ],
      },
    });

    return json({ ok: true });
  }

  if (actionType === "save_variant_image_map") {
    const productId = formData.get("productId") as string;
    const imageMap = formData.get("imageMap") as string;

    await admin.graphql(`#graphql
      mutation updateMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }
    `, {
      variables: {
        metafields: [
          {
            ownerId: productId,
            namespace: "productCustomizer",
            key: "variant_accessory_images",
            value: imageMap,
            type: "json",
          },
          {
            ownerId: productId,
            namespace: "productCustomizer",
            key: "is_image_customization_enabled",
            value: "true",
            type: "boolean",
          },
        ],
      },
    });

    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

type Product = {
  id: string;
  title: string;
  featuredImage?: { url: string } | null;
  variants?: { edges: { node: { id: string; title: string } }[] };
  metafields?: { edges: { node: { key: string; value: string } }[] };
};

type ImageMap = Record<string, Record<string, { fileUrl: string; fileId?: string }>>;

export default function ImageCustomizer() {
  const { products, error } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const app = useAppBridge();

  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [selectedAccessories, setSelectedAccessories] = useState<string[]>([]);
  const [imageMap, setImageMap] = useState<ImageMap>({});
  const [step, setStep] = useState<"select" | "accessories" | "uploads">("select");

  const selectedProduct = useMemo(
    () => products.find((p: Product) => p.id === selectedProductId),
    [products, selectedProductId],
  );

  useEffect(() => {
    if (!selectedProduct) {
      setSelectedAccessories([]);
      setImageMap({});
      return;
    }

    const accessoriesMeta = selectedProduct.metafields?.edges.find(
      (m: any) => m.node.key === "accessories",
    );
    const imageMapMeta = selectedProduct.metafields?.edges.find(
      (m: any) => m.node.key === "variant_accessory_images",
    );

    setSelectedAccessories(accessoriesMeta ? JSON.parse(accessoriesMeta.node.value) : []);
    setImageMap(imageMapMeta ? JSON.parse(imageMapMeta.node.value) : {});
  }, [selectedProductId]);

  const productOptions = products.map((p: Product) => ({ label: p.title, value: p.id }));
  const accessoryOptions = products
    .filter((p: Product) => p.id !== selectedProductId)
    .map((p: Product) => ({ label: p.title, value: p.id }));

  const accessoryProducts = products.filter((p: Product) => selectedAccessories.includes(p.id));

  const baseVariants = selectedProduct?.variants?.edges?.map((edge: any) => edge.node) || [];

  const enabledImageProducts = useMemo(
    () =>
      products.filter((p: Product) =>
        p.metafields?.edges?.some(
          (m: any) => m.node.key === "is_image_customization_enabled" && m.node.value === "true",
        ),
      ),
    [products],
  );

  const handleEnable = () => {
    if (!selectedProductId) return;
    const formData = new FormData();
    formData.append("action", "enable_image_mode");
    formData.append("productId", selectedProductId);
    fetcher.submit(formData, { method: "post" });
    setStep("accessories");
  };

  const handleConfigureTile = (productId: string) => {
    setSelectedProductId(productId);
    setStep("accessories");
  };

  const handleSaveAccessories = () => {
    if (!selectedProductId) return;
    const formData = new FormData();
    formData.append("action", "save_image_accessories");
    formData.append("productId", selectedProductId);
    formData.append("accessories", JSON.stringify(selectedAccessories));
    fetcher.submit(formData, { method: "post" });
    setStep("uploads");
  };

  const handleSaveImageMap = () => {
    if (!selectedProductId) return;
    const formData = new FormData();
    formData.append("action", "save_variant_image_map");
    formData.append("productId", selectedProductId);
    formData.append("imageMap", JSON.stringify(imageMap));
    fetcher.submit(formData, { method: "post" });
    setStep("select");
  };

  const openFilePicker = (baseVariantId: string, accessoryVariantId: string) => {
    if (!app) return;
    const picker = PickerCreate(app, {
      resourceType: ResourceType.File,
      actionVerb: Picker.ActionVerb.Select,
      multiple: false,
    });

    picker.subscribe(Picker.Action.SELECT, ({ selection }: { selection?: any[] }) => {
      const file = selection?.[0];
      if (!file) return;
      const fileId = (file as any)?.id;
      const fileUrl =
        (file as any)?.url ||
        (file as any)?.image?.originalSrc ||
        (file as any)?.previewImage?.originalSrc ||
        (file as any)?.originalSrc ||
        "";

      if (!fileUrl) return;

      setImageMap((prev) => {
        const next = { ...prev };
        if (!next[baseVariantId]) next[baseVariantId] = {};
        next[baseVariantId][accessoryVariantId] = { fileUrl, fileId };
        return next;
      });
    });

    picker.dispatch(Picker.Action.OPEN);
  };

  return (
    <Page>
      <TitleBar title="Variant Image Customizer" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Create Image Tile</Text>
                {error && (
                  <Banner tone="critical" title="Error loading products">
                    <p>{JSON.stringify(error)}</p>
                  </Banner>
                )}
                <Select
                  label="Product"
                  options={productOptions}
                  value={selectedProductId}
                  onChange={(v: string) => setSelectedProductId(v)}
                  placeholder="Choose a product"
                />
                <InlineStack gap="200">
                  <Button variant="primary" onClick={handleEnable} disabled={!selectedProductId}>
                    Enable & Configure
                  </Button>
                  {selectedProduct && (
                    <Text as="p" tone="subdued">
                      Variants: {baseVariants.length}
                    </Text>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <Text as="h3" variant="headingMd">Configured Image Tiles</Text>
              <List>
                {enabledImageProducts.length === 0 && (
                  <Text as="p" tone="subdued">No image tiles created yet.</Text>
                )}
                {enabledImageProducts.map((p: any) => (
                  <Box key={p.id} paddingBlockEnd="200">
                    <InlineStack align="center">
                      <Box>
                        <Thumbnail
                          size="small"
                          source={p.featuredImage?.url || ""}
                          alt={p.title}
                        />
                      </Box>
                      <Box>
                        <Text as="p">{p.title}</Text>
                        <Button onClick={() => handleConfigureTile(p.id)}>Configure</Button>
                      </Box>
                    </InlineStack>
                  </Box>
                ))}
              </List>
            </Card>
          </Layout.Section>

          {step === "accessories" && selectedProduct && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Select accessories for {selectedProduct.title}
                  </Text>
                  <ChoiceList
                    title="Accessories"
                    choices={accessoryOptions}
                    selected={selectedAccessories}
                    onChange={(value) => setSelectedAccessories(value as string[])}
                    allowMultiple
                  />
                  <InlineStack gap="200">
                    <Button onClick={() => setStep("select")}>Back</Button>
                    <Button
                      variant="primary"
                      onClick={handleSaveAccessories}
                      disabled={selectedAccessories.length === 0}
                    >
                      Next: Upload images
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {step === "uploads" && selectedProduct && (
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Upload images per variant + accessory
                  </Text>
                  {baseVariants.length === 0 && (
                    <Text as="p" tone="subdued">No variants found for this product.</Text>
                  )}

                  {baseVariants.map((variant: any) => (
                    <BlockStack key={variant.id} gap="200">
                      <InlineStack align="space-between">
                        <Text as="h3" variant="headingSm">{variant.title}</Text>
                        <Text as="p" tone="subdued">{variant.id}</Text>
                      </InlineStack>
                      <Divider />
                      {accessoryProducts.length === 0 && (
                        <Text as="p" tone="subdued">Select accessories to configure uploads.</Text>
                      )}
                      {accessoryProducts.map((acc: any) => {
                        const accessoryVariant = acc.variants?.edges?.[0]?.node;
                        const accVariantId = accessoryVariant?.id || acc.id;
                        const current = imageMap?.[variant.id]?.[accVariantId];
                        return (
                          <Box key={`${variant.id}-${accVariantId}`} paddingBlockEnd="300">
                            <InlineStack align="space-between" blockAlign="center">
                              <InlineStack gap="200" blockAlign="center">
                                <Thumbnail
                                  size="small"
                                  source={acc.featuredImage?.url || ""}
                                  alt={acc.title}
                                />
                                <Text as="p">{acc.title}</Text>
                              </InlineStack>
                              <InlineStack gap="200" blockAlign="center">
                                {current?.fileUrl && (
                                  <Thumbnail size="small" source={current.fileUrl} alt="Uploaded" />
                                )}
                                <Button
                                  onClick={() => openFilePicker(variant.id, accVariantId)}
                                  accessibilityLabel="Choose image from Shopify files"
                                >
                                  Choose from Files
                                </Button>
                                {current?.fileUrl && (
                                  <Button
                                    tone="critical"
                                    variant="tertiary"
                                    onClick={() => {
                                      setImageMap((prev) => {
                                        const next = { ...prev };
                                        if (next[variant.id]) {
                                          const nested = { ...next[variant.id] };
                                          delete nested[accVariantId];
                                          next[variant.id] = nested;
                                        }
                                        return next;
                                      });
                                    }}
                                  >
                                    Clear
                                  </Button>
                                )}
                              </InlineStack>
                            </InlineStack>
                          </Box>
                        );
                      })}
                    </BlockStack>
                  ))}

                  <InlineStack gap="200">
                    <Button onClick={() => setStep("accessories")}>Back</Button>
                    <Button
                      variant="primary"
                      onClick={handleSaveImageMap}
                      disabled={Object.keys(imageMap).length === 0}
                    >
                      Save images
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}
