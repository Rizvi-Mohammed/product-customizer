import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  List,
  InlineStack,
  Select,
  ChoiceList,
  Banner,
  Thumbnail,
  Divider,
  Tag,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { SimpleImagePicker } from "../components/SimpleImagePicker";

type VariantNode = {
  id: string;
  title: string;
  image?: { url: string } | null;
  selectedOptions?: { name: string; value: string }[];
};

type ProductNode = {
  id: string;
  title: string;
  featuredImage?: { url: string } | null;
  options?: { name: string; values: string[] }[];
  variants?: { edges: { node: VariantNode }[] };
  metafields?: { edges: { node: { key: string; value: string; type?: string } }[] };
  accessories?: ProductNode[];
};

type ColorGroup = {
  key: string;
  label: string;
  variants: VariantNode[];
};

type ColorImageMap = Record<
  string,
  Record<
    string,
    {
      fileUrl: string;
      fileId?: string;
      accessoryProductId?: string;
    }
  >
>; // baseColorKey -> accessoryProductId

type VariantImageMap = Record<
  string,
  Record<
    string,
    {
      fileUrl: string;
      fileId?: string;
      baseColor?: string;
      accessoryProductId?: string;
    }
  >
>; // baseVariantId -> accessoryProductId -> payload

const toNumericId = (id?: string | null) => {
  if (!id) return id;
  return id.includes("/") ? id.split("/").pop() || id : id;
};

const normalizeColor = (value?: string | null) =>
  (value || "default").trim().toLowerCase();

const findColorOptionName = (product?: ProductNode | null) => {
  if (!product?.options?.length) return null;
  const match = product.options.find((opt) => /color|colour/i.test(opt.name));
  return match?.name || product.options[0]?.name || null;
};

const groupVariantsByColor = (product?: ProductNode | null): ColorGroup[] => {
  if (!product?.variants?.edges?.length) return [];
  const colorOptionName = findColorOptionName(product);
  const groups: Record<string, ColorGroup> = {};

  product.variants.edges.forEach(({ node }) => {
    const color = node.selectedOptions?.find((o) =>
      colorOptionName ? o.name === colorOptionName : /color|colour/i.test(o.name)
    )?.value || node.selectedOptions?.[0]?.value || "Default";
    const key = normalizeColor(color);
    if (!groups[key]) {
      groups[key] = { key, label: color, variants: [] };
    }
    groups[key].variants.push(node);
  });

  return Object.values(groups);
};

const parseMetafield = (product: ProductNode, key: string) => {
  const meta = product.metafields?.edges?.find((m: any) => m.node.key === key)?.node?.value;
  if (!meta) return null;
  try {
    return JSON.parse(meta);
  } catch (e) {
    console.warn("Failed to parse metafield", key, e);
    return null;
  }
};

const STAGED_UPLOAD_MUTATION = `#graphql
mutation StagedUploads($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets {
      url
      resourceUrl
      parameters {
        name
        value
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

const CREATE_PRODUCT_METAFIELD_DEFINITION = `#graphql
mutation CreateProductMetafieldDefinition($definition: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $definition) {
    createdDefinition {
      id
      name
      namespace
      key
      access {
        admin
        storefront
      }
    }
    userErrors { field message }
  }
}`;

const UPDATE_PRODUCT_METAFIELD_DEFINITION = `#graphql
mutation UpdateProductMetafieldDefinition($id: ID!, $definition: MetafieldDefinitionUpdateInput!) {
  metafieldDefinitionUpdate(id: $id, definition: $definition) {
    updatedDefinition {
      id
      access { admin storefront }
    }
    userErrors { field message }
  }
}`;

const FILE_CREATE_MUTATION = `#graphql
mutation CreateFiles($files: [FileCreateInput!]!) {
  fileCreate(files: $files) {
    files {
      id
      alt
      ... on GenericFile {
        url
      }
      ... on MediaImage {
        image {
          url
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

const METAOBJECT_UPSERT_MUTATION = `#graphql
mutation UpsertImageCustomization($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
    metaobject {
      id
      handle
      type
    }
    userErrors {
      field
      message
    }
  }
}`;

const CREATE_IMAGE_CUSTOMIZATION_DEFINITION = `#graphql
mutation CreateImageCustomizationDefinition {
  metaobjectDefinitionCreate(
    definition: {
      name: "Image customization"
      type: "image_customization"
      description: "Stores product image customization mappings"
      fieldDefinitions: [
        { name: "Product ID", key: "product_id", type: "single_line_text_field", required: true }
        { name: "Accessories", key: "accessories", type: "json" }
        { name: "Color map", key: "color_map", type: "json" }
        { name: "Variant map", key: "variant_map", type: "json" }
      ]
      displayNameKey: "product_id"
    }
  ) {
    metaobjectDefinition {
      id
      type
      name
    }
    userErrors {
      field
      message
    }
  }
}`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    // Ensure metafield definitions exist and are storefront-accessible
    const metafieldDefinitions: Array<{ name: string; namespace: string; key: string; type: string }> = [
      { name: "Accessories", namespace: "productCustomizer", key: "accessories", type: "list.product_reference" },
      { name: "Color Combination Images", namespace: "productCustomizer", key: "color_combination_images", type: "json" },
      { name: "Variant Accessory Images", namespace: "productCustomizer", key: "variant_accessory_images", type: "json" },
      { name: "Image Customization Enabled", namespace: "productCustomizer", key: "is_image_customization_enabled", type: "boolean" },
      { name: "Image Customization Metaobject", namespace: "productCustomizer", key: "image_customization", type: "metaobject_reference" },
    ];

    for (const def of metafieldDefinitions) {
      try {
        const createResp = await admin.graphql(CREATE_PRODUCT_METAFIELD_DEFINITION, {
          variables: {
            definition: {
              name: def.name,
              namespace: def.namespace,
              key: def.key,
              type: def.type,
              ownerType: "PRODUCT",
              access: { admin: true, storefront: true },
            },
          },
        });
        const createJson = await createResp.json();
        const errors = createJson?.data?.metafieldDefinitionCreate?.userErrors || createJson?.errors;
        if (errors?.length) {
          const alreadyExists = errors.some((e: any) => (e?.message || "").toLowerCase().includes("already exists"));
          if (!alreadyExists) {
            console.warn("Metafield definition create errors", def.key, errors);
          }
        }
      } catch (e) {
        console.warn("Metafield definition create failed", def.key, e);
      }
    }

    // Ensure metaobject definition exists (idempotent: ignore duplicate errors)
    try {
      const ensure = await admin.graphql(CREATE_IMAGE_CUSTOMIZATION_DEFINITION);
      const ensureJson = await ensure.json();
      const ensureErrors = ensureJson?.data?.metaobjectDefinitionCreate?.userErrors || ensureJson?.errors;
      if (ensureErrors?.length && !String(ensureErrors[0]?.message || "").toLowerCase().includes("already exists")) {
        console.warn("Metaobject definition create errors", ensureErrors);
      }
    } catch (e) {
      console.warn("Metaobject definition create failed", e);
    }

    const response = await admin.graphql(`#graphql
      query {
        products(first: 50) {
          edges {
            node {
              id
              title
              featuredImage { url }
              options { name values }
              variants(first: 50) {
                edges {
                  node {
                    id
                    title
                    image { url }
                    selectedOptions { name value }
                  }
                }
              }
              metafields(namespace: "productCustomizer", first: 30) {
                edges { node { key value type } }
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

    const products: ProductNode[] = data.data.products.edges.map((edge: any) => edge.node);

    // Attach accessory product objects for easier lookups
    products.forEach((product) => {
      const accessoriesRaw = parseMetafield(product, "accessories") as string[] | null;
      if (accessoriesRaw?.length) {
        product.accessories = accessoriesRaw
          .map((id) => products.find((p) => p.id === id))
          .filter(Boolean) as ProductNode[];
      }
    });

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

  if (actionType === "upload_image") {
    const productId = formData.get("productId") as string;
    const baseColorKey = formData.get("baseColorKey") as string;
    const accessoryId = formData.get("accessoryId") as string;
    const file = formData.get("file");

    if (!productId || !baseColorKey || !accessoryId) {
      return json({ error: "Missing identifiers" }, { status: 400 });
    }

    if (!file || typeof (file as any).arrayBuffer !== "function") {
      return json({ error: "No file provided or invalid upload" }, { status: 400 });
    }

    const fileBlob = file as Blob;
    const filename = (file as any).name || "upload.jpg";
    const mimeType = fileBlob.type || "image/jpeg";
    // Shopify expects UnsignedInt64 encoded as string.
    const fileSize =
      typeof (fileBlob as any).size === "number"
        ? (fileBlob as any).size.toString()
        : undefined;

    const stagedResp = await admin.graphql(STAGED_UPLOAD_MUTATION, {
      variables: {
        input: [
          {
            filename,
            mimeType,
            resource: "FILE",
            httpMethod: "POST",
            fileSize,
          },
        ],
      },
    });
    const stagedJson = (await stagedResp.json()) as any;
    const stagedErrors = stagedJson?.data?.stagedUploadsCreate?.userErrors || stagedJson?.errors;
    if (stagedErrors?.length) {
      console.error("stagedUploadsCreate errors", stagedErrors);
      return json({ error: "Upload init failed", details: stagedErrors }, { status: 400 });
    }

    const target = stagedJson?.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target?.url || !target?.parameters) {
      return json({ error: "No staged target returned" }, { status: 400 });
    }

    const uploadForm = new FormData();
    target.parameters.forEach((param: any) => uploadForm.append(param.name, param.value));
    uploadForm.append("file", file);

    const uploadRes = await fetch(target.url, { method: "POST", body: uploadForm });
    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      console.error("Upload failed", text);
      return json({ error: "Upload failed", details: text }, { status: 400 });
    }

    const fileCreateResp = await admin.graphql(FILE_CREATE_MUTATION, {
      variables: {
        files: [
          {
            contentType: "IMAGE",
            originalSource: target.resourceUrl,
            alt: filename,
          },
        ],
      },
    });
    const fileCreateJson = (await fileCreateResp.json()) as any;
    const createErrors = fileCreateJson?.data?.fileCreate?.userErrors || fileCreateJson?.errors;
    if (createErrors?.length) {
      console.error("fileCreate errors", createErrors);
      return json({ error: "fileCreate failed", details: createErrors }, { status: 400 });
    }
    const created = fileCreateJson?.data?.fileCreate?.files?.[0];
    const fileUrl = created?.url || created?.image?.url || target.resourceUrl || "";
    if (!created?.id || !fileUrl) {
      console.error("File not returned from fileCreate", fileCreateJson);
      return json({ error: "File not returned", details: fileCreateJson }, { status: 400 });
    }

    return json({
      ok: true,
      baseColorKey,
      accessoryId,
      fileId: created.id,
      fileUrl,
    });
  }

  if (actionType === "enable_color_mode") {
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

  if (actionType === "save_accessories") {
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

  if (actionType === "save_color_map") {
    const productId = formData.get("productId") as string;
    const accessories = JSON.parse(formData.get("accessories") as string) as string[];
    const colorMap = formData.get("colorMap") as string;
    const variantMap = formData.get("variantMap") as string;

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
          {
            ownerId: productId,
            namespace: "productCustomizer",
            key: "color_combination_images",
            value: colorMap,
            type: "json",
          },
          {
            ownerId: productId,
            namespace: "productCustomizer",
            key: "variant_accessory_images",
            value: variantMap,
            type: "json",
          },
        ],
      },
    });

    // Canonical storage in metaobjects (requires a definition of type image_customization).
    try {
      const handleValue = `product-${toNumericId(productId) || productId}`;
      const upsertResp = await admin.graphql(METAOBJECT_UPSERT_MUTATION, {
        variables: {
          handle: { type: "image_customization", handle: handleValue },
          metaobject: {
            handle: handleValue,
            fields: [
              { key: "product_id", value: productId },
              { key: "accessories", value: JSON.stringify(accessories) },
              { key: "color_map", value: colorMap },
              { key: "variant_map", value: variantMap },
            ],
          },
        },
      });
      const upsertJson = (await upsertResp.json()) as any;
      const metaobjectId = upsertJson?.data?.metaobjectUpsert?.metaobject?.id;
      if (metaobjectId) {
        // Link the metaobject to the product via a reference metafield (storefront-readable)
        await admin.graphql(`#graphql
          mutation LinkImageCustomization($metafields: [MetafieldsSetInput!]!) {
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
                key: "image_customization",
                type: "metaobject_reference",
                value: metaobjectId,
              },
            ],
          },
        });
      } else {
        console.error("Metaobject upsert missing id", upsertJson);
      }
    } catch (e) {
      console.error("Metaobject upsert failed", e);
    }

    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function Index() {
  const { products, error } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const uploadFetcher = useFetcher<typeof action>();

  const initialProductId = products[0]?.id || "";
  const [selectedProductId, setSelectedProductId] = useState<string>(initialProductId);
  const [selectedAccessories, setSelectedAccessories] = useState<string[]>([]);
  const [step, setStep] = useState<"select" | "accessories" | "uploads">("select");
  const [colorImageMap, setColorImageMap] = useState<ColorImageMap>({});
  const uploadInFlight = uploadFetcher.state !== "idle";
  const uploadingKey = useMemo(() => {
    const fd = uploadFetcher.formData;
    if (!fd) return null;
    return `${fd.get("baseColorKey")}-${fd.get("accessoryId")}`;
  }, [uploadFetcher.formData]);

  const selectedProduct = useMemo(
    () => products.find((p: ProductNode) => p.id === selectedProductId),
    [products, selectedProductId],
  );

  const enabledProducts = useMemo(
    () =>
      products.filter((p: ProductNode) =>
        p.metafields?.edges?.some(
          (m: any) => m.node.key === "is_image_customization_enabled" && m.node.value === "true",
        ),
      ),
    [products],
  );

  const baseColorGroups = useMemo(() => groupVariantsByColor(selectedProduct), [selectedProduct]);

  const accessoryProducts = useMemo(
    () => products.filter((p: ProductNode) => selectedAccessories.includes(p.id)),
    [products, selectedAccessories],
  );

  // Keep selection valid if products change.
  useEffect(() => {
    if (!selectedProductId && products.length > 0) {
      setSelectedProductId(products[0].id);
      return;
    }
    const stillExists = products.some((p) => p.id === selectedProductId);
    if (!stillExists && products.length > 0) {
      setSelectedProductId(products[0].id);
    }
  }, [products, selectedProductId]);

  useEffect(() => {
    if (!selectedProduct) {
      setSelectedAccessories([]);
      setColorImageMap({});
      return;
    }

    const accessoriesMeta = parseMetafield(selectedProduct, "accessories") as string[] | null;
    const colorMapMeta = parseMetafield(selectedProduct, "color_combination_images") as ColorImageMap | null;

    setSelectedAccessories(accessoriesMeta || []);
    setColorImageMap(colorMapMeta || {});
  }, [selectedProductId]);

  const productOptions = products.map((p: ProductNode) => ({ label: p.title, value: p.id }));
  const accessoryOptions = products
    .filter((p: ProductNode) => p.id !== selectedProductId)
    .map((p: ProductNode) => ({ label: p.title, value: p.id }));

  const handleEnableProduct = () => {
    if (!selectedProductId) return;
    const formData = new FormData();
    formData.append("action", "enable_color_mode");
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
    formData.append("action", "save_accessories");
    formData.append("productId", selectedProductId);
    formData.append("accessories", JSON.stringify(selectedAccessories));
    fetcher.submit(formData, { method: "post" });
    setStep("uploads");
  };

  useEffect(() => {
    const data = uploadFetcher.data as any;
    if (data?.ok && data.fileUrl) {
      setColorImageMap((prev) => {
        const next = { ...prev } as ColorImageMap;
        if (!next[data.baseColorKey]) next[data.baseColorKey] = {} as any;
        next[data.baseColorKey][data.accessoryId] = {
          fileUrl: data.fileUrl,
          fileId: data.fileId,
          accessoryProductId: data.accessoryId,
        };
        return next;
      });
    }
  }, [uploadFetcher.data]);

  const handleFileSelected = (
    baseColorKey: string,
    accessoryId: string,
    file: File | null,
  ) => {
    if (!selectedProductId) return;
    if (!file) {
      setColorImageMap((prev) => {
        const next = { ...prev } as ColorImageMap;
        if (next[baseColorKey]?.[accessoryId]) {
          const copy = { ...next[baseColorKey] } as any;
          delete copy[accessoryId];
          next[baseColorKey] = copy;
        }
        return next;
      });
      return;
    }

    const fd = new FormData();
    fd.append("action", "upload_image");
    fd.append("productId", selectedProductId);
    fd.append("baseColorKey", baseColorKey);
    fd.append("accessoryId", accessoryId);
    fd.append("file", file);
    uploadFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
  };

  const handleSaveColorMap = () => {
    if (!selectedProductId) return;

    // Expand color-based map to variant-based map so storefront can resolve quickly
    const variantMap: VariantImageMap = {};

    baseColorGroups.forEach((baseGroup) => {
      const accessoriesForColor = colorImageMap[baseGroup.key] || {};
      baseGroup.variants.forEach((variant) => {
        const variantKeys = [variant.id, toNumericId(variant.id)];
        variantKeys.forEach((key) => {
          if (!key) return;
          if (!variantMap[key]) variantMap[key] = {};
        });
      });

      Object.entries(accessoriesForColor).forEach(([accessoryId, entry]) => {
        if (!entry?.fileUrl) return;
        baseGroup.variants.forEach((baseVariant) => {
          const baseKeys = [baseVariant.id, toNumericId(baseVariant.id)];
          baseKeys.forEach((bKey) => {
            if (!bKey) return;
            if (!variantMap[bKey]) variantMap[bKey] = {};
            variantMap[bKey][accessoryId] = {
              fileUrl: entry.fileUrl,
              fileId: entry.fileId,
              baseColor: baseGroup.label,
              accessoryProductId: accessoryId,
            };
          });
        });
      });
    });

    const formData = new FormData();
    formData.append("action", "save_color_map");
    formData.append("productId", selectedProductId);
    formData.append("accessories", JSON.stringify(selectedAccessories));
    formData.append("colorMap", JSON.stringify(colorImageMap));
    formData.append("variantMap", JSON.stringify(variantMap));
    fetcher.submit(formData, { method: "post" });
    setStep("select");
  };

  const uploading = fetcher.state !== "idle" && !!fetcher.formData;

  return (
    <Page>
      <TitleBar title="Product Image Customizer" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Choose base product</Text>
                {error && (
                  <Banner tone="critical" title="Error loading products">
                    <p>{JSON.stringify(error)}</p>
                  </Banner>
                )}
                <Select
                  label="Product"
                  options={productOptions}
                  value={selectedProductId || ""}
                  onChange={(v: string) => {
                    setSelectedProductId(v || "");
                    setStep("select");
                  }}
                  placeholder="Pick the product to customize"
                />
                <InlineStack gap="200">
                  <Button
                    variant="primary"
                    onClick={handleEnableProduct}
                    disabled={!selectedProductId || uploading || !selectedProduct}
                    loading={uploading}
                  >
                    Enable & configure
                  </Button>
                  {selectedProduct && (
                    <Tag>{selectedProduct.variants?.edges?.length || 0} variants</Tag>
                  )}
                  {!selectedProduct && (
                    <Tag tone="critical">No product selected</Tag>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <Text as="h3" variant="headingMd">Configured products</Text>
              <List>
                {enabledProducts.length === 0 && <Text tone="subdued">Nothing enabled yet.</Text>}
                {enabledProducts.map((p: ProductNode) => (
                  <Box key={p.id} paddingBlockEnd="200">
                    <InlineStack align="center">
                      <Thumbnail size="small" source={p.featuredImage?.url || ""} alt={p.title} />
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
                  <Text as="h2" variant="headingMd">Select accessories for {selectedProduct.title}</Text>
                  <ChoiceList
                    title="Accessories"
                    choices={accessoryOptions}
                    selected={selectedAccessories}
                    onChange={(value) => setSelectedAccessories(value as string[])}
                    allowMultiple
                  />
                  <InlineStack gap="200">
                    <Button onClick={() => setStep("select")}>Back</Button>
                    <Button variant="primary" onClick={handleSaveAccessories} disabled={selectedAccessories.length === 0 || uploading}>
                      Next: Upload combos
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {step === "uploads" && selectedProduct && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Upload images for each color combination</Text>
                  {baseColorGroups.length === 0 && (
                    <Text tone="subdued">No variants found on this product.</Text>
                  )}

                  {baseColorGroups.map((group) => (
                    <Box key={group.key} paddingBlockEnd="400" paddingBlockStart="200" borderColor="border-subdued" borderWidth="025" borderRadius="200">
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="150" blockAlign="center">
                            <Tag>{group.label}</Tag>
                            <Text tone="subdued">{group.variants.length} variant(s)</Text>
                          </InlineStack>
                        </InlineStack>
                        <Divider />

                        {selectedAccessories.length === 0 && (
                          <Text tone="subdued">Pick accessories first.</Text>
                        )}

        {selectedAccessories.map((accId) => {
          const accProduct = accessoryProducts.find((p) => p.id === accId);
          const existing = colorImageMap?.[group.key]?.[accId];
          const comboKey = `${group.key}-${accId}`;
          return (
            <Box key={`${group.key}-${accId}`} paddingBlockEnd="200">
              <BlockStack gap="150">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="150" blockAlign="center">
                    <Thumbnail size="small" source={accProduct?.featuredImage?.url || ""} alt={accProduct?.title || "Accessory"} />
                    <Text as="p">{accProduct?.title || "Accessory"}</Text>
                  </InlineStack>
                  <Tag tone="attention">Accessory</Tag>
                </InlineStack>

                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="150" blockAlign="center">
                    {existing?.fileUrl && (
                      <Thumbnail size="small" source={existing.fileUrl} alt="Uploaded" />
                    )}
                  </InlineStack>
                  <Box minWidth="300px">
                    <SimpleImagePicker
                      initialUrl={existing?.fileUrl}
                      uploading={uploadInFlight && uploadingKey === comboKey}
                      onFileSelected={(file) => handleFileSelected(group.key, accId, file)}
                    />
                  </Box>
                </InlineStack>
              </BlockStack>
            </Box>
          );
        })}
                      </BlockStack>
                    </Box>
                  ))}

                  <InlineStack gap="200">
                    <Button onClick={() => setStep("accessories")}>Back</Button>
                    <Button
                      variant="primary"
                      onClick={handleSaveColorMap}
                      disabled={uploading || uploadInFlight || Object.keys(colorImageMap || {}).length === 0}
                    >
                      Save mappings
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
