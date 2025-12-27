import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  InlineStack,
  Select,
  Banner,
  Thumbnail,
  Divider,
  Tag,
  TextField,
  Collapsible,
  Spinner,
  Icon,
  Checkbox,
} from "@shopify/polaris";
import {
  ProductIcon,
  CollectionIcon,
  ImageIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
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
  accessories?: ProductNode[];
};

type ColorGroup = {
  key: string;
  label: string;
  variants: VariantNode[];
};

type AccessoryCategoryMap = Record<string, string>;
type CategoryVariantOption = { variantId: string; label: string; accessoryId: string };
type RuleCategory = { id: string; label: string; productIds: string[] };
type Ruleset = {
  id: string;
  handle: string;
  name: string;
  baseProducts: string[];
  accessories: string[];
  categories: RuleCategory[];
  colorMapByBase: Record<string, ColorImageMap>;
  variantMapByBase: Record<string, VariantImageMap>;
};

type ColorImageMap = Record<
  string,
  Record<
    string,
    {
      fileUrl: string;
      fileId?: string;
      accessoryProductId?: string;
      variantId?: string;
      combinationKey?: string;
      accessoryIds?: string[];
      variantIds?: string[];
      // Name-based matching metadata
      baseOptionName?: string;
      baseOptionValue?: string;
      accessoryOptionName?: string;
      accessoryOptionValue?: string;
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
      variantId?: string;
      // Name-based matching metadata
      baseOptionName?: string;
      baseOptionValue?: string;
      accessoryOptionName?: string;
      accessoryOptionValue?: string;
    }
  >
>; // baseVariantId -> accessoryProductId -> payload

const toNumericId = (id?: string | null) => {
  if (!id) return id;
  return id.includes("/") ? id.split("/").pop() || id : id;
};

const buildCombinationKey = (ids: Array<string | null | undefined>) =>
  ids
    .map((id) => toNumericId(id || "") || "")
    .filter(Boolean)
    .sort()
    .join("+");

const slugify = (value: string) =>
  (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

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

const groupVariantsByOption = (product?: ProductNode | null, optionName?: string): ColorGroup[] => {
  if (!product?.variants?.edges?.length) return [];

  // If "none" is selected, each variant is its own group
  if (optionName === "none") {
    return product.variants.edges.map(({ node }) => ({
      key: node.id,
      label: node.title,
      variants: [node],
    }));
  }

  // If no option specified or "color", use color grouping
  if (!optionName || optionName === "color") {
    return groupVariantsByColor(product);
  }

  // Group by specified option
  const groups: Record<string, ColorGroup> = {};
  product.variants.edges.forEach(({ node }) => {
    const optionValue = node.selectedOptions?.find((o) =>
      o.name.toLowerCase() === optionName.toLowerCase()
    )?.value || "Default";
    const key = normalizeColor(optionValue);
    if (!groups[key]) {
      groups[key] = { key, label: optionValue, variants: [] };
    }
    groups[key].variants.push(node);
  });

  return Object.values(groups);
};

const getGroupingOptionFromVariant = (variant: VariantNode, groupingOption: string) => {
  if (!variant.selectedOptions?.length) return { name: null, value: null };

  if (groupingOption === "none" || groupingOption === "color") {
    // Try to find color option
    const colorOpt = variant.selectedOptions.find(o => /color|colour/i.test(o.name));
    if (colorOpt) return { name: colorOpt.name, value: colorOpt.value };
    // Fallback to first option
    const first = variant.selectedOptions[0];
    return { name: first.name, value: first.value };
  }

  // Find the specific option by name
  const match = variant.selectedOptions.find(o =>
    o.name.toLowerCase() === groupingOption.toLowerCase()
  );
  return match ? { name: match.name, value: match.value } : { name: null, value: null };
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

const CREATE_RULESET_DEFINITION = `#graphql
mutation CreateRulesetDefinition {
  metaobjectDefinitionCreate(
    definition: {
      name: "PIC Ruleset"
      type: "pic_ruleset"
      description: "Product Image Customizer ruleset"
      fieldDefinitions: [
        { name: "Name", key: "name", type: "single_line_text_field", required: true }
        { name: "Base products", key: "base_products", type: "json" }
        { name: "Accessories", key: "accessories", type: "list.product_reference" }
        { name: "Accessory categories", key: "accessory_categories", type: "json" }
        { name: "Color map", key: "color_map", type: "json" }
        { name: "Variant map", key: "variant_map", type: "json" }
      ]
      displayNameKey: "name"
    }
  ) {
    metaobjectDefinition { id type name }
    userErrors { field message }
  }
}`;

const RULESET_LIST_QUERY = `#graphql
query Rulesets {
  metaobjects(type: "pic_ruleset", first: 50) {
    edges {
      node {
        id
        handle
        type
        fields { key value }
      }
    }
  }
}`;

const RULESET_UPSERT_MUTATION = `#graphql
mutation UpsertRuleset($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
    metaobject { id handle }
    userErrors { field message }
  }
}`;

const RULESET_DELETE_MUTATION = `#graphql
mutation DeleteRuleset($id: ID!) {
  metaobjectDelete(id: $id) {
    deletedId
    userErrors { field message }
  }
}`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    // Ensure ruleset metaobject definition exists (ignore duplicate errors quietly)
    try {
      const ensure = await admin.graphql(CREATE_RULESET_DEFINITION);
      const ensureJson = await ensure.json();
      const ensureErrors =
        ensureJson?.data?.metaobjectDefinitionCreate?.userErrors || (ensureJson as any)?.errors;
      if (Array.isArray(ensureErrors)) {
        const duplicate = ensureErrors.some(
          (err: any) => (err?.message || "").toLowerCase().includes("already been taken"),
        );
        if (ensureErrors.length && !duplicate) {
          console.error("❌ Ruleset definition create errors:", JSON.stringify(ensureErrors, null, 2));
        } else if (duplicate) {
          console.log("✅ Ruleset definition already exists");
        }
      } else {
        console.log("✅ Ruleset definition created successfully");
      }
    } catch (e) {
      console.error("❌ Error creating ruleset definition:", e);
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

    const rulesetResp = await admin.graphql(RULESET_LIST_QUERY);
    const rulesetJson = (await rulesetResp.json()) as any;
    const rulesets: Ruleset[] = (rulesetJson?.data?.metaobjects?.edges || []).map((edge: any) => {
      const fields = edge.node.fields || [];
      const getField = (key: string) => fields.find((f: any) => f.key === key)?.value;
      const parseJson = (val: string | null) => {
        if (!val) return {};
        try {
          return JSON.parse(val);
        } catch {
          return {};
        }
      };
      const parseJsonArray = (val: string | null) => {
        if (!val) return [];
        try {
          const parsed = JSON.parse(val);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      };
      return {
        id: edge.node.id,
        handle: edge.node.handle,
        name: getField("name") || edge.node.handle,
        baseProducts: parseJsonArray(getField("base_products")),
        accessories: parseJsonArray(getField("accessories")),
        categories: (parseJson(getField("accessory_categories")) || []) as RuleCategory[],
        colorMapByBase: parseJson(getField("color_map")) || {},
        variantMapByBase: parseJson(getField("variant_map")) || {},
      };
    });

    return json({ products, rulesets, error: null });
  } catch (error) {
    console.error("Loader error:", error);
    return json({
      products: [],
      rulesets: [],
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "create_ruleset") {
    const name = (formData.get("name") as string) || "Ruleset";
    const handleValue = slugify(name) || `ruleset-${Date.now()}`;
    const upsertResp = await admin.graphql(RULESET_UPSERT_MUTATION, {
      variables: {
        handle: { type: "pic_ruleset", handle: handleValue },
        metaobject: {
          handle: handleValue,
          fields: [
            { key: "name", value: name },
            { key: "base_products", value: JSON.stringify([]) },
            { key: "accessories", value: JSON.stringify([]) },
            { key: "accessory_categories", value: JSON.stringify([]) },
            { key: "color_map", value: JSON.stringify({}) },
            { key: "variant_map", value: JSON.stringify({}) },
          ],
        },
      },
    });
    const jsonResp = await upsertResp.json();
    const mo = jsonResp?.data?.metaobjectUpsert?.metaobject;
    const errors = jsonResp?.data?.metaobjectUpsert?.userErrors || (jsonResp as any)?.errors;

    if (errors && errors.length > 0) {
      console.error("❌ Create ruleset errors:", JSON.stringify(errors, null, 2));
      return json({ error: "Create failed", details: errors }, { status: 400 });
    }

    if (!mo?.id) {
      console.error("❌ No metaobject returned:", JSON.stringify(jsonResp, null, 2));
      return json({ error: "Create failed - no ID returned", details: jsonResp }, { status: 400 });
    }

    console.log("✅ Ruleset created:", mo.id);
    return json({ ok: true, rulesetId: mo.id, handle: mo.handle, name, lastAction: "create_ruleset" });
  }

  if (actionType === "delete_ruleset") {
    const rulesetId = formData.get("rulesetId") as string;
    if (!rulesetId) return json({ error: "Missing rulesetId" }, { status: 400 });
    const delResp = await admin.graphql(RULESET_DELETE_MUTATION, { variables: { id: rulesetId } });
    const delJson = await delResp.json();
    const err = delJson?.data?.metaobjectDelete?.userErrors || (delJson as any)?.errors;
    if (err?.length) return json({ error: "Delete failed", details: err }, { status: 400 });
    return json({ ok: true, deletedId: rulesetId });
  }

  if (actionType === "save_ruleset") {
    const explicitHandle = (formData.get("handle") as string) || "";
    const name = (formData.get("name") as string) || "Ruleset";
    const baseProducts = JSON.parse(formData.get("baseProducts") as string) as string[];
    const categories = JSON.parse(formData.get("categories") as string) as RuleCategory[];
    const colorMap = JSON.parse((formData.get("colorMap") as string) || "{}");
    const variantMap = JSON.parse((formData.get("variantMap") as string) || "{}");
    const handleValue = explicitHandle || slugify(name) || `ruleset-${Date.now()}`;

    // Extract all unique accessory product IDs from categories
    const allAccessories = Array.from(
      new Set(categories.flatMap((cat) => cat.productIds || []))
    );

    const metaobjectInput: any = {
      handle: handleValue,
      fields: [
        { key: "name", value: name },
        { key: "base_products", value: JSON.stringify(baseProducts || []) },
        { key: "accessories", value: JSON.stringify(allAccessories) },
        { key: "accessory_categories", value: JSON.stringify(categories || []) },
        { key: "color_map", value: JSON.stringify(colorMap || {}) },
        { key: "variant_map", value: JSON.stringify(variantMap || {}) },
      ],
    };
    const upsertResp = await admin.graphql(RULESET_UPSERT_MUTATION, {
      variables: {
        handle: { type: "pic_ruleset", handle: handleValue },
        metaobject: metaobjectInput,
      },
    });
    const upsertJson = await upsertResp.json();
    const mo = upsertJson?.data?.metaobjectUpsert?.metaobject;
    if (!mo?.id) return json({ error: "Save failed", details: upsertJson }, { status: 400 });

    // Link all base products to this ruleset via metafield
    if (baseProducts.length > 0) {
      const metafields = baseProducts.map((productId) => ({
        ownerId: productId,
        namespace: "productCustomizer",
        key: "image_customization",
        value: mo.id,
        type: "metaobject_reference",
      }));

      console.log("🔗 Linking products to ruleset:", baseProducts.length, "products");
      const linkResp = await admin.graphql(`#graphql
        mutation updateMetafields($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id key namespace }
            userErrors { field message }
          }
        }
      `, {
        variables: { metafields },
      });

      const linkJson = await linkResp.json();
      const linkErrors = linkJson?.data?.metafieldsSet?.userErrors;
      if (linkErrors && linkErrors.length > 0) {
        console.error("❌ Failed to link products:", JSON.stringify(linkErrors, null, 2));
      } else {
        console.log("✅ Products linked successfully:", linkJson?.data?.metafieldsSet?.metafields?.length || 0);
      }
    }

    return json({
      ok: true,
      rulesetId: mo.id,
      handle: mo.handle,
      name,
      baseProducts,
      categories,
      lastAction: "save_ruleset",
    });
  }

  if (actionType === "upload_image") {
    const productId = formData.get("productId") as string;
    const baseColorKey = formData.get("baseColorKey") as string;
    const accessoryId = formData.get("accessoryId") as string;
    const accessoryVariantId = formData.get("accessoryVariantId") as string | null;
    const combinationKey = formData.get("combinationKey") as string | null;
    const combinationMetaRaw = formData.get("combinationMeta") as string | null;
    const baseOptionName = formData.get("baseOptionName") as string | null;
    const baseOptionValue = formData.get("baseOptionValue") as string | null;
    const accessoryOptionName = formData.get("accessoryOptionName") as string | null;
    const accessoryOptionValue = formData.get("accessoryOptionValue") as string | null;
    let combinationMeta = null;
    if (combinationMetaRaw) {
      try {
        combinationMeta = JSON.parse(combinationMetaRaw);
      } catch (e) {
        combinationMeta = null;
      }
    }
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
    const fileSize = typeof (fileBlob as any).size === "number" ? (fileBlob as any).size : undefined;

    const stagedResp = await admin.graphql(STAGED_UPLOAD_MUTATION, {
      variables: {
        input: [
          {
            filename,
            mimeType,
            resource: "FILE",
            httpMethod: "POST",
            fileSize: typeof fileSize === "number" ? fileSize.toString() : undefined,
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
      accessoryVariantId,
      combinationKey,
      combinationMeta,
      fileId: created.id,
      fileUrl,
      baseOptionName,
      baseOptionValue,
      accessoryOptionName,
      accessoryOptionValue,
    });
  }

  if (actionType === "save_color_map") {
    const rulesetId = formData.get("rulesetId") as string | null;
    const handle = (formData.get("handle") as string) || "";
    const colorMap = formData.get("colorMap") as string;
    const variantMap = formData.get("variantMap") as string;

    if (!rulesetId) return json({ error: "Missing rulesetId" }, { status: 400 });

    try {
      const handleValue = handle || slugify(rulesetId);
      const upsertResp = await admin.graphql(RULESET_UPSERT_MUTATION, {
        variables: {
          handle: { type: "pic_ruleset", handle: handleValue },
          metaobject: {
            handle: handleValue,
            fields: [
              { key: "color_map", value: colorMap || "{}" },
              { key: "variant_map", value: variantMap || "{}" },
            ],
          },
        },
      });
      const upsertJson = await upsertResp.json();
      const mo = upsertJson?.data?.metaobjectUpsert?.metaobject;
      if (!mo?.id) return json({ error: "Save failed", details: upsertJson }, { status: 400 });
      return json({
        ok: true,
        rulesetId: mo.id,
        handle: mo.handle,
        colorMapByBase: colorMap ? JSON.parse(colorMap) : {},
        variantMapByBase: variantMap ? JSON.parse(variantMap) : {},
        lastAction: "save_color_map",
      });
    } catch (e) {
      console.error("Ruleset color map save failed", e);
      return json({ error: "Ruleset save failed" }, { status: 400 });
    }
  }

  if (actionType === "clear_mappings") {
    const rulesetId = formData.get("rulesetId") as string | null;
    const handle = (formData.get("handle") as string) || "";

    if (!rulesetId) return json({ error: "Missing rulesetId" }, { status: 400 });

    try {
      const handleValue = handle || slugify(rulesetId);
      const upsertResp = await admin.graphql(RULESET_UPSERT_MUTATION, {
        variables: {
          handle: { type: "pic_ruleset", handle: handleValue },
          metaobject: {
            handle: handleValue,
            fields: [
              { key: "color_map", value: JSON.stringify({}) },
              { key: "variant_map", value: JSON.stringify({}) },
            ],
          },
        },
      });
      const upsertJson = await upsertResp.json();
      const mo = upsertJson?.data?.metaobjectUpsert?.metaobject;
      if (!mo?.id) return json({ error: "Clear failed", details: upsertJson }, { status: 400 });
      return json({
        ok: true,
        rulesetId: mo.id,
        handle: mo.handle,
        lastAction: "clear_mappings",
      });
    } catch (e) {
      console.error("Clear mappings failed", e);
      return json({ error: "Clear failed" }, { status: 400 });
    }
  }

  if (actionType === "link_product_to_ruleset") {
    const productId = formData.get("productId") as string;
    const rulesetId = formData.get("rulesetId") as string;

    if (!productId || !rulesetId) {
      return json({ error: "Missing productId or rulesetId" }, { status: 400 });
    }

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
            key: "image_customization",
            value: rulesetId,
            type: "metaobject_reference",
          },
        ],
      },
    });

    return json({ ok: true, productId, rulesetId });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const { products, error } = loaderData;
  const rulesets = 'rulesets' in loaderData ? loaderData.rulesets : [];
  const fetcher = useFetcher<typeof action>();
  const uploadFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [rulesetList, setRulesetList] = useState<Ruleset[]>(rulesets || []);
  const [selectedRulesetId, setSelectedRulesetId] = useState<string>("");
  const [selectedRulesetHandle, setSelectedRulesetHandle] = useState<string>("");
  const [selectedRulesetName, setSelectedRulesetName] = useState<string>("Untitled ruleset");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [selectedBaseProducts, setSelectedBaseProducts] = useState<string[]>([]);
  const [selectedAccessories, setSelectedAccessories] = useState<string[]>([]);
  const [ruleCategories, setRuleCategories] = useState<RuleCategory[]>([]);
  const [accessoryCategories, setAccessoryCategories] = useState<AccessoryCategoryMap>({});
  const [accessoryVariantSelection, setAccessoryVariantSelection] = useState<Record<string, string[]>>({});
  const [step, setStep] = useState<"list" | "configure" | "mappings">("list");
  const [colorImageMap, setColorImageMap] = useState<ColorImageMap>({});
  const [colorImageMapByBase, setColorImageMapByBase] = useState<Record<string, ColorImageMap>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [mappingMode, setMappingMode] = useState<"show_all" | "create_specific">("create_specific");
  const [baseGroupingEnabled, setBaseGroupingEnabled] = useState<boolean>(true);
  const [variantGroupingMode, setVariantGroupingMode] = useState<string>("color"); // "color", "size", "none", or any option name
  const [accessoryGroupingModes, setAccessoryGroupingModes] = useState<Record<string, { enabled: boolean; option: string }>>({});
  const [selectedBaseColorKey, setSelectedBaseColorKey] = useState<string>("");
  const [selectedMappingAccessories, setSelectedMappingAccessories] = useState<string[]>([]);
  const uploadInFlight = uploadFetcher.state !== "idle";
  const uploadError = (uploadFetcher.data as any)?.error;
  // Derive upload state directly from fetcher for better Polaris compliance
  const uploadingKey = uploadFetcher.formData
    ? `${uploadFetcher.formData.get("baseColorKey")}-${uploadFetcher.formData.get("accessoryVariantId") || uploadFetcher.formData.get("accessoryId")}`
    : null;

  const selectedProduct = useMemo(
    () => products.find((p) => p?.id === selectedProductId) || null,
    [products, selectedProductId],
  );

  const baseColorGroups = useMemo(
    () => groupVariantsByOption(selectedProduct, baseGroupingEnabled ? variantGroupingMode : "none"),
    [selectedProduct, baseGroupingEnabled, variantGroupingMode]
  );

  // Get available variant options for any product
  const getAvailableOptions = useCallback((product?: ProductNode | null) => {
    if (!product?.options?.length) return [];
    return product.options.map(opt => ({
      label: opt.name,
      value: opt.name.toLowerCase(),
    }));
  }, []);

  const availableVariantOptions = useMemo(() =>
    getAvailableOptions(selectedProduct),
    [selectedProduct, getAvailableOptions]
  );

  // Get grouped variants for an accessory product
  const getAccessoryGroups = useCallback((accessoryId: string) => {
    const product = products.find(p => p?.id === accessoryId) || null;
    const grouping = accessoryGroupingModes[accessoryId];
    const optionName = grouping?.enabled ? (grouping.option || "color") : "none";
    return groupVariantsByOption(product, optionName);
  }, [products, accessoryGroupingModes]);

  const accessoryProducts = useMemo(
    () => products.filter((p) => p && selectedAccessories.includes(p.id)),
    [products, selectedAccessories],
  );

  const categoryGroups = useMemo(
    () => {
      const groups: Record<string, { label: string; accessoryIds: string[] }> = {};
      selectedAccessories.forEach((id) => {
        const rawLabel = accessoryCategories[id] || "";
        const label = rawLabel.trim() || "Accessories";
        if (!groups[label]) groups[label] = { label, accessoryIds: [] };
        groups[label].accessoryIds.push(id);
      });
      return Object.values(groups);
    },
    [selectedAccessories, accessoryCategories],
  );

  const categoryVariantOptions = useMemo(
    () =>
      categoryGroups
        .map((group) => {
          const variants: CategoryVariantOption[] = [];
          group.accessoryIds.forEach((accId) => {
            const prod = products.find((p) => p?.id === accId);
            const prodVariants = prod?.variants?.edges?.map((edge) => edge.node) || [];
            if (prodVariants.length === 0) {
              variants.push({
                accessoryId: accId,
                variantId: accId,
                label: prod?.title || "Accessory",
              });
            } else {
              prodVariants.forEach((variant) => {
                variants.push({
                  accessoryId: accId,
                  variantId: variant.id,
                  label: `${prod?.title || "Accessory"} — ${variant.title}`,
                });
              });
            }
          });
          return { label: group.label, variants };
        })
        .filter((group) => group.variants.length > 0),
    [categoryGroups, products],
  );

  const categoryCombinations = useMemo(() => {
    if (categoryVariantOptions.length < 2) return [];
    const buckets = categoryVariantOptions.map((group) => group.variants);
    const combos = buckets.reduce(
      (acc, variants) =>
        acc.flatMap((prev) => variants.map((variant) => [...prev, variant])),
      [[]] as CategoryVariantOption[][],
    );
    return combos
      .map((combo) => {
        const variantIds = combo.map((c) => c.variantId);
        const accessoryIds = combo.map((c) => c.accessoryId);
        const comboKey = buildCombinationKey(variantIds);
        return {
          key: comboKey,
          variantIds,
          accessoryIds,
          labels: combo.map((c, idx) => `${categoryVariantOptions[idx]?.label || "Category"}: ${c.label}`),
        };
      })
      .filter((entry) => entry.key);
  }, [categoryVariantOptions]);

  const resolveAccessoryVariantIds = useCallback(
    (accessoryId: string) => {
      const selected = accessoryVariantSelection[accessoryId];
      if (selected?.length) return selected;
      const prod = products.find((p) => p?.id === accessoryId);
      const allVariants = prod?.variants?.edges?.map((edge) => edge.node.id) || [];
      return allVariants.length ? allVariants : [accessoryId];
    },
    [accessoryVariantSelection, products],
  );

  const resolveAccessoryVariantTitle = useCallback(
    (accessoryId: string, variantId: string) => {
      const prod = products.find((p) => p?.id === accessoryId);
      const match = prod?.variants?.edges?.find((edge) => edge.node.id === variantId)?.node;
      return match?.title || "Variant";
    },
    [products],
  );

  const productOptions = useMemo(
    () => products.filter((p): p is ProductNode => p !== null).map((p) => ({ label: p.title, value: p.id })),
    [products],
  );

  // Keep selection valid if products change.
  useEffect(() => {
    if (!selectedProductId && products.length > 0 && products[0]) {
      setSelectedProductId(products[0].id);
      return;
    }
    const stillExists = products.some((p) => p?.id === selectedProductId);
    if (!stillExists && products.length > 0 && products[0]) {
      setSelectedProductId(products[0].id);
    }
  }, [products, selectedProductId]);

  useEffect(() => {
    setRulesetList((prev) => {
      if (!rulesets?.length) return prev;
      if (!prev.length) return rulesets;
      // Merge loader data with local state, preserving local maps/categories/base products when loader is stale.
      return rulesets.map((r: Ruleset) => {
        const local = prev.find((p) => p.id === r.id);
        if (!local) return r;
        return {
          ...r,
          baseProducts: local.baseProducts?.length ? local.baseProducts : r.baseProducts,
          categories: local.categories?.length ? local.categories : r.categories,
          colorMapByBase:
            local.colorMapByBase && Object.keys(local.colorMapByBase).length
              ? local.colorMapByBase
              : r.colorMapByBase,
          variantMapByBase:
            local.variantMapByBase && Object.keys(local.variantMapByBase).length
              ? local.variantMapByBase
              : r.variantMapByBase,
        };
      });
    });
  }, [rulesets]);

  useEffect(() => {
    if (!selectedRulesetId) return;
    const rs = rulesetList.find((r) => r.id === selectedRulesetId);
    if (!rs) return;

    // This effect ONLY loads data, navigation is handled by button click handlers
    setSelectedRulesetName(rs.name);
    setSelectedRulesetHandle(rs.handle || "");
    setSelectedBaseProducts(rs.baseProducts || []);
    setRuleCategories(rs.categories || []);
    setColorImageMapByBase((prev) => {
      const incoming = rs.colorMapByBase || {};
      if (!Object.keys(incoming).length) return prev;
      return { ...prev, ...incoming };
    });
    if (rs.baseProducts?.length) {
      setSelectedProductId(rs.baseProducts[0]);
      setColorImageMap((prev) => {
        const fromIncoming = rs.colorMapByBase?.[rs.baseProducts[0]];
        if (fromIncoming && Object.keys(fromIncoming).length) return fromIncoming;
        return prev;
      });
    }
  }, [selectedRulesetId, rulesetList]);

  useEffect(() => {
    const unionAccessories = Array.from(
      new Set(ruleCategories.flatMap((cat) => cat.productIds || [])),
    );
    setSelectedAccessories(unionAccessories);
    const accLabels: AccessoryCategoryMap = {};
    ruleCategories.forEach((cat) => {
      (cat.productIds || []).forEach((pid) => {
        accLabels[pid] = cat.label || "Accessories";
      });
    });
    setAccessoryCategories(accLabels);
  }, [ruleCategories]);

  useEffect(() => {
    if (!selectedProduct) {
      setColorImageMap({});
      return;
    }
    setColorImageMap(colorImageMapByBase[selectedProductId] || {});
  }, [selectedProductId, colorImageMapByBase]);

  // Keep accessory-variant selections in sync with accessory choices
  useEffect(() => {
    setAccessoryVariantSelection((prev) => {
      const next: Record<string, string[]> = { ...prev };
      // Drop removed accessories
      Object.keys(next).forEach((key) => {
        if (!selectedAccessories.includes(key)) {
          delete next[key];
        }
      });
      // Ensure defaults for new accessories
      selectedAccessories.forEach((id) => {
        if (!next[id]) {
          const prod = products.find((p) => p?.id === id);
          const variants = prod?.variants?.edges?.map((edge) => edge.node.id) || [];
          next[id] = variants.length ? variants : [id];
        }
      });
      return next;
    });
  }, [selectedAccessories, products]);

  useEffect(() => {
    const data = fetcher.data as any;
    const lastAction = data?.lastAction || fetcher.formData?.get("action");
    if (data?.ok && data.rulesetId) {
      // Don't set selectedRulesetId if we're doing save_color_map (returning to list)
      if (lastAction !== "save_color_map") {
        setSelectedRulesetId(data.rulesetId);
        setSelectedRulesetHandle(data.handle || "");
      }
      if (data.colorMapByBase) {
        setColorImageMapByBase((prev) => ({ ...prev, ...data.colorMapByBase }));
        if (selectedProductId && lastAction !== "save_color_map") {
          const nextMap = data.colorMapByBase[selectedProductId];
          if (nextMap) {
            setColorImageMap(nextMap);
          }
        }
      }
      if (data.handle || data.name) {
        setRulesetList((prev) => {
          const exists = prev.find((r) => r.id === data.rulesetId);
          const nextPayload = {
            baseProducts: data.baseProducts || selectedBaseProducts,
            categories: data.categories || ruleCategories,
            colorMapByBase: data.colorMapByBase || colorImageMapByBase,
            variantMapByBase: data.variantMapByBase || {},
          };
          if (exists) {
            return prev.map((r) =>
              r.id === data.rulesetId
                ? {
                  ...r,
                  name: data.name || r.name,
                  handle: data.handle || r.handle,
                  ...nextPayload,
                  variantMapByBase:
                    nextPayload.variantMapByBase && Object.keys(nextPayload.variantMapByBase).length
                      ? nextPayload.variantMapByBase
                      : r.variantMapByBase,
                }
                : r,
            );
          }
          return [
            ...prev,
            {
              id: data.rulesetId,
              handle: data.handle || data.rulesetId,
              name: data.name || "Ruleset",
              accessories: [],
              ...nextPayload,
            },
          ];
        });
      }
      if (lastAction === "save_ruleset") {
        setStep("mappings");
      } else if (lastAction === "save_color_map") {
        // Don't navigate - the button handler will do it
      } else if (lastAction === "create_ruleset") {
        setStep("configure");
      } else if (lastAction === "clear_mappings") {
        // Clear local state
        setColorImageMap({});
        setColorImageMapByBase({});
        setSelectedBaseColorKey("");
        setSelectedMappingAccessories([]);
        // Update ruleset list
        setRulesetList((prev) =>
          prev.map((r) =>
            r.id === data.rulesetId
              ? { ...r, colorMapByBase: {}, variantMapByBase: {} }
              : r
          )
        );
      }
    }
    if (data?.deletedId) {
      setSelectedRulesetId("");
      setSelectedRulesetHandle("");
      setRulesetList((prev) => prev.filter((r) => r.id !== data.deletedId));
    }
  }, [fetcher.data]);

  useEffect(() => {
    setAccessoryCategories((prev) => {
      const next: AccessoryCategoryMap = { ...prev };
      Object.keys(next).forEach((key) => {
        if (!selectedAccessories.includes(key)) {
          delete next[key];
        }
      });
      selectedAccessories.forEach((id) => {
        if (!next[id]) {
          const prod = products.find((p) => p?.id === id);
          next[id] = prod?.title || "Accessories";
        }
      });
      return next;
    });
  }, [selectedAccessories, products]);
  useEffect(() => {
    const data = uploadFetcher.data as any;
    if (data?.ok && data.fileUrl) {
      setColorImageMap((prev) => {
        const next = { ...prev } as ColorImageMap;
        const colorKey = data.baseColorKey;
        if (!colorKey) return prev;
        if (!next[colorKey]) next[colorKey] = {} as any;
        const combinationKey = data.combinationKey as string | undefined;
        const combinationMeta = (data.combinationMeta || {}) as { accessoryIds?: string[]; variantIds?: string[] };
        const payload = {
          fileUrl: data.fileUrl,
          fileId: data.fileId,
          accessoryProductId: data.accessoryId,
          variantId: data.accessoryVariantId || data.accessoryId,
          combinationKey: combinationKey || undefined,
          accessoryIds: combinationMeta.accessoryIds,
          variantIds: combinationMeta.variantIds,
          baseOptionName: data.baseOptionName,
          baseOptionValue: data.baseOptionValue,
          accessoryOptionName: data.accessoryOptionName,
          accessoryOptionValue: data.accessoryOptionValue,
        };
        if (combinationKey) {
          next[colorKey][combinationKey] = payload;
        } else {
          // Use accessory product ID as key for group-level mappings
          // This allows the mapping to apply to all variants in the group
          const key = data.accessoryId;
          next[colorKey][key] = payload;
        }
        setColorImageMapByBase((prevMaps) => ({
          ...prevMaps,
          [selectedProductId]: next,
        }));
        // Persist in ruleset list so loader revalidation doesn't wipe freshly uploaded images.
        if (selectedRulesetId) {
          setRulesetList((prev) =>
            prev.map((r) =>
              r.id === selectedRulesetId
                ? {
                  ...r,
                  colorMapByBase: { ...(r.colorMapByBase || {}), [selectedProductId]: next },
                }
                : r,
            ),
          );
        }
        return next;
      });
    }
  }, [uploadFetcher.data, selectedProductId]);

  const handleFileSelected = (
    baseColorKey: string,
    accessoryProductId: string,
    accessoryVariantId: string,
    file: File | null,
    options?: {
      combinationKey?: string;
      accessoryIds?: string[];
      variantIds?: string[];
      baseOptionName?: string;
      baseOptionValue?: string;
      accessoryOptionName?: string;
      accessoryOptionValue?: string;
    },
  ) => {
    if (!selectedProductId) return;
    if (!file) {
      setColorImageMap((prev) => {
        const next = { ...prev } as ColorImageMap;
        if (next[baseColorKey]) {
          const copy = { ...next[baseColorKey] } as any;
          if (options?.combinationKey) {
            delete copy[options.combinationKey];
          } else {
            delete copy[accessoryVariantId || accessoryProductId];
          }
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
    fd.append("accessoryId", accessoryProductId);
    fd.append("accessoryVariantId", accessoryVariantId);
    if (options?.combinationKey) {
      fd.append("combinationKey", options.combinationKey);
    }
    if (options?.accessoryIds || options?.variantIds) {
      fd.append(
        "combinationMeta",
        JSON.stringify({
          accessoryIds: options?.accessoryIds,
          variantIds: options?.variantIds,
        }),
      );
    }
    // Add option metadata for name-based matching
    if (options?.baseOptionName) fd.append("baseOptionName", options.baseOptionName);
    if (options?.baseOptionValue) fd.append("baseOptionValue", options.baseOptionValue);
    if (options?.accessoryOptionName) fd.append("accessoryOptionName", options.accessoryOptionName);
    if (options?.accessoryOptionValue) fd.append("accessoryOptionValue", options.accessoryOptionValue);
    fd.append("file", file);
    uploadFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
  };

  const handleSaveColorMap = () => {
    if (!selectedProductId) return;

    // Expand color-based map to variant-based map so storefront can resolve quickly
    const variantMap: VariantImageMap = {};
    const colorMapToSave: ColorImageMap = JSON.parse(JSON.stringify(colorImageMap || {}));

    console.log("🔧 handleSaveColorMap called");
    console.log("baseColorGroups:", baseColorGroups);
    console.log("colorImageMap:", colorImageMap);

    baseColorGroups.forEach((baseGroup) => {
      baseGroup.variants.forEach((variant) => {
        const variantKeys = [variant.id, toNumericId(variant.id)];
        variantKeys.forEach((key) => {
          if (!key) return;
          if (!variantMap[key]) variantMap[key] = {};
        });
      });

      const mapForColor = colorImageMap?.[baseGroup.key] || {};
      Object.entries(mapForColor).forEach(([key, entry]) => {
        if (!entry?.fileUrl) return;
        const payload = {
          ...entry,
          accessoryProductId: entry.accessoryProductId || key,
          variantId: entry.variantId || key,
          baseOptionName: entry.baseOptionName,
          baseOptionValue: entry.baseOptionValue,
          accessoryOptionName: entry.accessoryOptionName,
          accessoryOptionValue: entry.accessoryOptionValue,
        };

        if (!colorMapToSave[baseGroup.key]) colorMapToSave[baseGroup.key] = {};
        colorMapToSave[baseGroup.key][key] = payload;

        // Find ALL accessory variants that match the option criteria
        let accessoryVariantIds: string[] = [];

        if (entry.accessoryOptionName && entry.accessoryOptionValue && entry.accessoryProductId) {
          // Option-based matching: find all variants with matching option value
          const accProduct = products.find(p => p?.id === entry.accessoryProductId);
          if (accProduct?.variants?.edges) {
            accessoryVariantIds = accProduct.variants.edges
              .map(({ node }) => {
                const optMatch = node.selectedOptions?.find(opt =>
                  opt.name === entry.accessoryOptionName &&
                  opt.value === entry.accessoryOptionValue
                );
                return optMatch ? node.id : null;
              })
              .filter((id): id is string => id !== null);
          }
        }

        // Fallback to key-based matching if no option matching
        if (accessoryVariantIds.length === 0) {
          accessoryVariantIds = [key];
        }

        // Expand to all combinations: base variants × matching accessory variants
        baseGroup.variants.forEach((baseVariant) => {
          const baseKeys = [baseVariant.id, toNumericId(baseVariant.id)];

          accessoryVariantIds.forEach((accVariantId) => {
            const accessoryKeys = [accVariantId, toNumericId(accVariantId)].filter(Boolean);

            baseKeys.forEach((bKey) => {
              if (!bKey) return;
              if (!variantMap[bKey]) variantMap[bKey] = {};

              // Store under both accessory GID and numeric ID
              accessoryKeys.filter((k): k is string => k !== null && k !== undefined).forEach((accKey) => {
                variantMap[bKey][accKey] = {
                  ...payload,
                  baseColor: baseGroup.label,
                };
              });
            });
          });
        });
      });
    });

    console.log("📦 variantMap built:", variantMap);
    console.log("🎨 colorMapToSave built:", colorMapToSave);

    const formData = new FormData();
    formData.append("action", "save_color_map");
    formData.append("rulesetId", selectedRulesetId || "");
    if (selectedRulesetHandle) formData.append("handle", selectedRulesetHandle);
    const colorPayload = { ...colorImageMapByBase, [selectedProductId]: colorMapToSave };

    // Merge variantMap directly (not nested under product ID)
    const existingVariantMap = (rulesetList.find((r) => r.id === selectedRulesetId)?.variantMapByBase as any) || {};
    const variantPayload = { ...existingVariantMap, ...variantMap };

    console.log("📮 Submitting - colorPayload:", colorPayload);
    console.log("📮 Submitting - variantPayload:", variantPayload);
    formData.append("colorMap", JSON.stringify(colorPayload));
    formData.append("variantMap", JSON.stringify(variantPayload));
    fetcher.submit(formData, { method: "post" });
    setColorImageMapByBase(colorPayload);
  };

  const uploading = fetcher.state !== "idle" && !!fetcher.formData;

  return (
    <Page>
      <TitleBar title="Product Image Customizer" />
      <BlockStack gap="500">
        {error && (
          <Banner tone="critical" title="Error loading products">
            <p>{JSON.stringify(error)}</p>
          </Banner>
        )}

        {step === "list" && (
          <>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingLg">Image Customization Rules</Text>
                    <Text as="p" tone="subdued">
                      Configure product image mappings for accessories and variants
                    </Text>
                  </BlockStack>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setSelectedRulesetId("");
                      setSelectedRulesetName("New Ruleset");
                      setSelectedBaseProducts([]);
                      setRuleCategories([]);
                      setStep("configure");
                    }}
                  >
                    Create ruleset
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {rulesetList.length === 0 ? (
              <Card>
                <BlockStack gap="300" inlineAlign="center">
                  <Text as="p" tone="subdued" alignment="center">
                    No rulesets created yet. Create your first ruleset to get started.
                  </Text>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setSelectedRulesetId("");
                      setSelectedRulesetName("New Ruleset");
                      setSelectedBaseProducts([]);
                      setRuleCategories([]);
                      setStep("configure");
                    }}
                  >
                    Create your first ruleset
                  </Button>
                </BlockStack>
              </Card>
            ) : (
              <BlockStack gap="400">
                {rulesetList.map((ruleset) => {
                  const baseCount = ruleset.baseProducts?.length || 0;
                  const catCount = ruleset.categories?.length || 0;

                  // Debug: Log the colorMapByBase structure
                  console.log(`📊 Ruleset "${ruleset.name}" colorMapByBase:`, JSON.stringify(ruleset.colorMapByBase, null, 2));

                  // Count unique base color + accessory product combinations across ALL base products
                  const mappingCount = Object.keys(ruleset.colorMapByBase || {}).reduce(
                    (sum, baseProductId) => {
                      const baseProductMappings = ruleset.colorMapByBase[baseProductId] || {};
                      console.log(`  Base product ${baseProductId} has ${Object.keys(baseProductMappings).length} color groups`);
                      Object.values(baseProductMappings).forEach((colorGroup: any) => {
                        // Count unique accessory products per color group
                        const uniqueAccessories = new Set(
                          Object.values(colorGroup).map((m: any) => m.accessoryProductId).filter(Boolean)
                        );
                        console.log(`    Color group has ${uniqueAccessories.size} unique accessories:`, Array.from(uniqueAccessories));
                        sum += uniqueAccessories.size;
                      });
                      return sum;
                    },
                    0
                  );

                  console.log(`📈 Total mapping count for "${ruleset.name}": ${mappingCount}`);

                  return (
                    <Card key={ruleset.id}>
                      <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="start">
                          <BlockStack gap="200">
                            <Text as="h3" variant="headingMd">{ruleset.name}</Text>
                            <InlineStack gap="300">
                              <InlineStack gap="100" blockAlign="center">
                                <Icon source={ProductIcon} tone="subdued" />
                                <Text as="span" tone="subdued">{baseCount} base product{baseCount !== 1 ? 's' : ''}</Text>
                              </InlineStack>
                              <InlineStack gap="100" blockAlign="center">
                                <Icon source={CollectionIcon} tone="subdued" />
                                <Text as="span" tone="subdued">{catCount} categor{catCount !== 1 ? 'ies' : 'y'}</Text>
                              </InlineStack>
                              <InlineStack gap="100" blockAlign="center">
                                <Icon source={ImageIcon} tone="subdued" />
                                <Text as="span" tone="subdued">{mappingCount} image mapping{mappingCount !== 1 ? 's' : ''}</Text>
                              </InlineStack>
                            </InlineStack>
                          </BlockStack>
                          <InlineStack gap="200">
                            <Button
                              onClick={() => {
                                setSelectedRulesetId(ruleset.id);
                                setStep("configure");
                              }}
                            >
                              Configure
                            </Button>
                            <Button
                              onClick={() => {
                                setSelectedRulesetId(ruleset.id);
                                if (ruleset.baseProducts?.length) {
                                  setSelectedProductId(ruleset.baseProducts[0]);
                                }
                                // Clear selection state for fresh UX
                                setSelectedBaseColorKey("");
                                setSelectedMappingAccessories([]);
                                setStep("mappings");
                              }}
                              disabled={!baseCount || !catCount}
                            >
                              Image mappings
                            </Button>
                            <Button
                              tone="critical"
                              onClick={() => {
                                const fd = new FormData();
                                fd.append("action", "delete_ruleset");
                                fd.append("rulesetId", ruleset.id);
                                fetcher.submit(fd, { method: "post" });
                              }}
                            >
                              Delete
                            </Button>
                          </InlineStack>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  );
                })}
              </BlockStack>
            )}
          </>
        )}

        {step === "configure" && (
          <Card>
            <BlockStack gap="500">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    {selectedRulesetId ? "Edit Ruleset" : "Create New Ruleset"}
                  </Text>
                  <Text as="p" tone="subdued">
                    Configure base products and accessory categories
                  </Text>
                </BlockStack>
                <Button onClick={() => {
                  setSelectedRulesetId("");
                  setSelectedRulesetHandle("");
                  setSelectedRulesetName("Untitled ruleset");
                  setSelectedBaseProducts([]);
                  setSelectedProductId("");
                  setRuleCategories([]);
                  setColorImageMap({});
                  setColorImageMapByBase({});
                  setStep("list");
                }}>Cancel</Button>
              </InlineStack>

              <Divider />

              <BlockStack gap="400">
                <TextField
                  label="Ruleset name"
                  value={selectedRulesetName}
                  onChange={setSelectedRulesetName}
                  autoComplete="off"
                  placeholder="Enter a descriptive name"
                  helpText="Give your ruleset a memorable name"
                />

                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Base Products</Text>
                  <Text as="p" tone="subdued">
                    Select the main products that will display on product detail pages
                  </Text>
                  <Button
                    onClick={async () => {
                      const selection = await shopify.resourcePicker({
                        type: 'product',
                        action: 'select',
                        multiple: true,
                        selectionIds: selectedBaseProducts.map((id) => ({ id })),
                        filter: {
                          hidden: false,
                          variants: false,
                        },
                      });
                      if (selection && selection.length > 0) {
                        const newProductIds = selection.map((product: any) => product.id);
                        setSelectedBaseProducts(newProductIds);
                        // Set the first selected product as the active one for mapping view
                        if (!selectedProductId || !newProductIds.includes(selectedProductId)) {
                          setSelectedProductId(newProductIds[0]);
                        }
                        if (!selectedRulesetName.trim() || selectedRulesetName === "New Ruleset" || selectedRulesetName === "Untitled ruleset") {
                          setSelectedRulesetName(`${selection[0].title} Ruleset`);
                        }
                      }
                    }}
                  >
                    Browse products
                  </Button>
                  {selectedBaseProducts.length > 0 && (
                    <BlockStack gap="200">
                      <InlineStack gap="200" wrap>
                        {selectedBaseProducts.map((pid) => {
                          const prod = products.find((p) => p && p.id === pid);
                          return (
                            <Tag
                              key={pid}
                              onRemove={() => {
                                const newProducts = selectedBaseProducts.filter((p) => p !== pid);
                                setSelectedBaseProducts(newProducts);
                                // If removing the currently selected product, switch to another or clear
                                if (selectedProductId === pid) {
                                  setSelectedProductId(newProducts[0] || "");
                                }
                              }}
                            >
                              {prod?.title || "Base product"}
                            </Tag>
                          );
                        })}
                      </InlineStack>
                      <Button
                        size="slim"
                        variant="plain"
                        tone="critical"
                        onClick={() => {
                          setSelectedBaseProducts([]);
                          setSelectedProductId("");
                        }}
                      >
                        Clear all
                      </Button>
                    </BlockStack>
                  )}
                </BlockStack>

                <Divider />

                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingMd">Accessory Categories</Text>
                      <Text as="p" tone="subdued">
                        Organize accessories into categories for better management
                      </Text>
                    </BlockStack>
                    <Button
                      onClick={() =>
                        setRuleCategories((prev) => [
                          ...prev,
                          { id: `${Date.now()}`, label: "New Category", productIds: [] },
                        ])
                      }
                    >
                      Add category
                    </Button>
                  </InlineStack>

                  {ruleCategories.length === 0 ? (
                    <Card>
                      <BlockStack gap="200" inlineAlign="center">
                        <Text as="p" tone="subdued" alignment="center">
                          No categories yet. Add a category to organize your accessories.
                        </Text>
                      </BlockStack>
                    </Card>
                  ) : (
                    <BlockStack gap="300">
                      {ruleCategories.map((cat) => (
                        <Card key={cat.id}>
                          <BlockStack gap="300">
                            <InlineStack align="space-between" blockAlign="center">
                              <Box minWidth="300px">
                                <TextField
                                  label="Category name"
                                  labelHidden
                                  value={cat.label}
                                  onChange={(val) =>
                                    setRuleCategories((prev) =>
                                      prev.map((c) => (c.id === cat.id ? { ...c, label: val } : c)),
                                    )
                                  }
                                  autoComplete="off"
                                  placeholder="Category name"
                                />
                              </Box>
                              <InlineStack gap="200">
                                <Button
                                  onClick={async () => {
                                    const selection = await shopify.resourcePicker({
                                      type: 'product',
                                      action: 'select',
                                      multiple: true,
                                      selectionIds: cat.productIds.map((id) => ({ id })),
                                      filter: {
                                        hidden: false,
                                        variants: false,
                                      },
                                    });
                                    if (selection && selection.length > 0) {
                                      const newProductIds = selection.map((product: any) => product.id);
                                      setRuleCategories((prev) =>
                                        prev.map((c) =>
                                          c.id === cat.id ? { ...c, productIds: newProductIds } : c,
                                        ),
                                      );
                                    }
                                  }}
                                >
                                  {cat.productIds.length
                                    ? `${cat.productIds.length} product${cat.productIds.length !== 1 ? 's' : ''}`
                                    : "Select products"}
                                </Button>
                                <Button
                                  tone="critical"
                                  onClick={() =>
                                    setRuleCategories((prev) => prev.filter((c) => c.id !== cat.id))
                                  }
                                >
                                  Remove
                                </Button>
                              </InlineStack>
                            </InlineStack>
                            {cat.productIds.length > 0 && (
                              <InlineStack gap="150" wrap>
                                {cat.productIds.map((pid) => {
                                  const prod = products.find((p) => p && p.id === pid);
                                  return (
                                    <Tag
                                      key={pid}
                                      onRemove={() =>
                                        setRuleCategories((prev) =>
                                          prev.map((c) =>
                                            c.id === cat.id
                                              ? { ...c, productIds: c.productIds.filter((p) => p !== pid) }
                                              : c,
                                          ),
                                        )
                                      }
                                    >
                                      {prod?.title || "Product"}
                                    </Tag>
                                  );
                                })}
                              </InlineStack>
                            )}
                          </BlockStack>
                        </Card>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </BlockStack>

              <Divider />

              <InlineStack align="end" gap="200">
                <Button onClick={() => setStep("list")}>Cancel</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    if (!selectedRulesetId) {
                      // Create new ruleset first
                      const fd = new FormData();
                      fd.append("action", "create_ruleset");
                      fd.append("name", selectedRulesetName || "Ruleset");
                      fetcher.submit(fd, { method: "post" });
                    } else {
                      // Save existing ruleset
                      const fd = new FormData();
                      fd.append("action", "save_ruleset");
                      fd.append("rulesetId", selectedRulesetId);
                      if (selectedRulesetHandle) fd.append("handle", selectedRulesetHandle);
                      fd.append("name", (selectedRulesetName || "").trim() || "Ruleset");
                      fd.append("baseProducts", JSON.stringify(selectedBaseProducts));
                      fd.append("categories", JSON.stringify(ruleCategories));
                      fd.append("colorMap", JSON.stringify(colorImageMapByBase));
                      fd.append("variantMap", JSON.stringify({}));
                      fetcher.submit(fd, { method: "post" });
                    }
                  }}
                  disabled={!selectedProductId || selectedBaseProducts.length === 0}
                  loading={fetcher.state !== "idle"}
                >
                  {selectedRulesetId ? "Save & continue to mappings" : "Create & continue"}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {step === "mappings" && selectedProduct && selectedBaseProducts.includes(selectedProductId) && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">Image Mappings</Text>
                  <Text as="p" tone="subdued">
                    Configure images for {selectedProduct.title}
                  </Text>
                </BlockStack>
                <InlineStack gap="200">
                  <Button
                    tone="critical"
                    onClick={() => {
                      if (confirm("Are you sure you want to clear all image mappings? This cannot be undone.")) {
                        const fd = new FormData();
                        fd.append("action", "clear_mappings");
                        fd.append("rulesetId", selectedRulesetId);
                        if (selectedRulesetHandle) fd.append("handle", selectedRulesetHandle);
                        fetcher.submit(fd, { method: "post" });
                      }
                    }}
                  >
                    Clear all mappings
                  </Button>
                  <Select
                    label="Base product"
                    labelHidden
                    options={selectedBaseProducts.map((pid) => {
                      const prod = products.find((p) => p && p.id === pid);
                      return { label: prod?.title || "Product", value: pid };
                    })}
                    value={selectedProductId}
                    onChange={(val) => setSelectedProductId(val)}
                  />
                  <Button onClick={() => {
                    setSelectedBaseColorKey("");
                    setSelectedMappingAccessories([]);
                    setStep("configure");
                  }}>Back to configuration</Button>
                </InlineStack>
              </InlineStack>

              <Divider />

              {uploadError && (
                <Banner tone="critical" title="Image upload failed">
                  <p>{typeof uploadError === "string" ? uploadError : "Please try again."}</p>
                </Banner>
              )}

              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Mapping mode</Text>
                  <InlineStack gap="300">
                    <Button
                      variant={mappingMode === "create_specific" ? "primary" : undefined}
                      onClick={() => setMappingMode("create_specific")}
                    >
                      Create specific mapping
                    </Button>
                    <Button
                      variant={mappingMode === "show_all" ? "primary" : undefined}
                      onClick={() => setMappingMode("show_all")}
                    >
                      Show all combinations
                    </Button>
                  </InlineStack>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {mappingMode === "create_specific"
                      ? "Manually select which variants to map - cleaner and focused approach"
                      : "View all possible combinations automatically - comprehensive but lengthy"}
                  </Text>
                </BlockStack>
              </Card>

              {mappingMode === "create_specific" && (
                <Card>
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Create new mapping</Text>

                    <Divider />

                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">Base product grouping</Text>
                          <Text as="p" tone="subdued" variant="bodySm">
                            Group variants to create fewer mappings
                          </Text>
                        </BlockStack>
                        <Checkbox
                          label="Group variants"
                          checked={baseGroupingEnabled}
                          onChange={(checked) => {
                            setBaseGroupingEnabled(checked);
                            setSelectedBaseColorKey("");
                          }}
                        />
                      </InlineStack>
                      {baseGroupingEnabled && availableVariantOptions.length > 0 && (
                        <Select
                          label="Group by"
                          options={availableVariantOptions}
                          value={variantGroupingMode}
                          onChange={(value) => {
                            setVariantGroupingMode(value);
                            setSelectedBaseColorKey("");
                          }}
                        />
                      )}
                    </BlockStack>

                    <Divider />

                    <Select
                      label={baseGroupingEnabled
                        ? `Select base product ${availableVariantOptions.find(o => o.value === variantGroupingMode)?.label || "group"}`
                        : "Select base product variant"
                      }
                      options={baseColorGroups.map((group) => ({
                        label: group.variants.length === 1
                          ? group.label
                          : `${group.label} (${group.variants.length} variant${group.variants.length !== 1 ? 's' : ''})`,
                        value: group.key,
                      }))}
                      value={selectedBaseColorKey}
                      onChange={setSelectedBaseColorKey}
                      placeholder={baseGroupingEnabled ? "Choose a group" : "Choose a variant"}
                    />

                    {selectedBaseColorKey && (
                      <>
                        <Divider />

                        <Text as="p" variant="bodyMd" fontWeight="semibold">Select accessories and configure mappings</Text>
                        {accessoryProducts.length === 0 ? (
                          <Banner tone="info">
                            <p>No accessories configured yet. Add accessories in the configuration step.</p>
                          </Banner>
                        ) : (
                          <Text as="p" tone="subdued" variant="bodySm">
                            Choose grouping options and select variants for each accessory
                          </Text>
                        )}
                        <BlockStack gap="200">
                          {selectedAccessories.map((accId) => {
                            const accProduct = accessoryProducts.find((p) => p?.id === accId);
                            const accOptions = getAvailableOptions(accProduct);
                            const grouping = accessoryGroupingModes[accId] || { enabled: false, option: "color" };
                            const accGroups = getAccessoryGroups(accId);

                            return (
                              <Box key={accId} padding="300" borderColor="border" borderWidth="025" borderRadius="200">
                                <BlockStack gap="300">
                                  <InlineStack gap="150" blockAlign="center">
                                    <Thumbnail size="small" source={accProduct?.featuredImage?.url || ""} alt={accProduct?.title || "Accessory"} />
                                    <Text as="p" variant="bodyMd" fontWeight="semibold">{accProduct?.title || "Accessory"}</Text>
                                  </InlineStack>

                                  {accOptions.length > 0 && (
                                    <InlineStack gap="200" blockAlign="center">
                                      <Checkbox
                                        label="Group variants"
                                        checked={grouping.enabled}
                                        onChange={(checked) => {
                                          setAccessoryGroupingModes((prev) => ({
                                            ...prev,
                                            [accId]: { ...prev[accId], enabled: checked, option: prev[accId]?.option || accOptions[0]?.value || "color" },
                                          }));
                                          // Clear selection for this accessory
                                          const variantIds = resolveAccessoryVariantIds(accId);
                                          setSelectedMappingAccessories((prev) =>
                                            prev.filter((v) => !variantIds.includes(v))
                                          );
                                        }}
                                      />
                                      {grouping.enabled && (
                                        <Select
                                          label="Group by"
                                          labelHidden
                                          options={accOptions}
                                          value={grouping.option}
                                          onChange={(value) => {
                                            setAccessoryGroupingModes((prev) => ({
                                              ...prev,
                                              [accId]: { ...prev[accId], option: value },
                                            }));
                                            // Clear selection for this accessory
                                            const variantIds = resolveAccessoryVariantIds(accId);
                                            setSelectedMappingAccessories((prev) =>
                                              prev.filter((v) => !variantIds.includes(v))
                                            );
                                          }}
                                        />
                                      )}
                                    </InlineStack>
                                  )}

                                  <Select
                                    label={grouping.enabled ? `Select ${grouping.option} group` : "Select variant"}
                                    labelHidden
                                    options={[
                                      { label: grouping.enabled ? "Select a group" : "Select a variant", value: "" },
                                      ...accGroups.map((group) => ({
                                        label: group.variants.length === 1
                                          ? group.label
                                          : `${group.label} (${group.variants.length} variant${group.variants.length !== 1 ? 's' : ''})`,
                                        value: group.key,
                                      })),
                                    ]}
                                    value={(() => {
                                      // Find which group contains any selected variant for this accessory
                                      const selectedForThisAcc = selectedMappingAccessories.filter((v) => {
                                        return accGroups.some((g) => g.variants.some((variant) => variant.id === v));
                                      });
                                      if (selectedForThisAcc.length === 0) return "";
                                      // Find the group that contains the selected variant
                                      const matchingGroup = accGroups.find((g) =>
                                        g.variants.some((v) => selectedForThisAcc.includes(v.id))
                                      );
                                      return matchingGroup?.key || "";
                                    })()}
                                    onChange={(val) => {
                                      // Remove all variants from this accessory first
                                      const allVariantIds = accGroups.flatMap((g) => g.variants.map((v) => v.id));
                                      let filtered = selectedMappingAccessories.filter((v) => !allVariantIds.includes(v));

                                      if (val) {
                                        // Add representation of this group selection
                                        const selectedGroup = accGroups.find((g) => g.key === val);
                                        if (selectedGroup && selectedGroup.variants.length > 0) {
                                          // Store the first variant ID as a representative, but we'll use it differently in upload
                                          filtered = [...filtered, selectedGroup.variants[0].id];
                                        }
                                      }

                                      setSelectedMappingAccessories(filtered);
                                    }}
                                  />
                                </BlockStack>
                              </Box>
                            );
                          })}
                        </BlockStack>

                        {selectedMappingAccessories.length > 0 && (
                          <>
                            <Divider />
                            <Card>
                              <BlockStack gap="200">
                                <Text as="p" variant="headingMd">Upload image for this mapping</Text>
                                <Text as="p" tone="subdued" variant="bodySm">
                                  Base: {(() => {
                                    const baseGroup = baseColorGroups.find((g) => g.key === selectedBaseColorKey);
                                    return `${baseGroup?.label} (${baseGroup?.variants.length || 0} variant${baseGroup?.variants.length !== 1 ? 's' : ''})`;
                                  })()}
                                </Text>
                                <Text as="p" tone="subdued" variant="bodySm">
                                  Accessories: {selectedMappingAccessories.map((variantId) => {
                                    const accId = selectedAccessories.find((id) => {
                                      const prod = products.find((p) => p?.id === id);
                                      return prod?.variants?.edges?.some((e) => e.node.id === variantId);
                                    });
                                    const prod = products.find((p) => p && p.id === accId);

                                    // Check if grouping is enabled for this accessory
                                    const grouping = accessoryGroupingModes[accId || ""];
                                    if (grouping?.enabled && grouping.option) {
                                      // Find the group this variant belongs to
                                      const accGroups = getAccessoryGroups(accId || "");
                                      const group = accGroups.find(g => g.variants.some(v => v.id === variantId));
                                      if (group) {
                                        return `${prod?.title} - ${group.label} (${group.variants.length} variant${group.variants.length !== 1 ? 's' : ''})`;
                                      }
                                    }

                                    return `${prod?.title} - ${resolveAccessoryVariantTitle(accId || "", variantId)}`;
                                  }).join(", ")}
                                </Text>

                                <Box minWidth="300px">
                                  <SimpleImagePicker
                                    initialUrl={(() => {
                                      const baseGroup = baseColorGroups.find((g) => g.key === selectedBaseColorKey);
                                      if (!baseGroup) return undefined;

                                      if (selectedMappingAccessories.length === 1) {
                                        return colorImageMap?.[baseGroup.key]?.[selectedMappingAccessories[0]]?.fileUrl;
                                      } else {
                                        const comboKey = buildCombinationKey(selectedMappingAccessories);
                                        return colorImageMap?.[baseGroup.key]?.[comboKey]?.fileUrl;
                                      }
                                    })()}
                                    uploading={uploadInFlight}
                                    onFileSelected={(file) => {
                                      const baseGroup = baseColorGroups.find((g) => g.key === selectedBaseColorKey);
                                      if (!baseGroup) return;

                                      // Get base variant option metadata
                                      const baseVariant = baseGroup.variants[0];
                                      const baseOption = baseVariant ? getGroupingOptionFromVariant(baseVariant, variantGroupingMode) : { name: null, value: null };

                                      if (selectedMappingAccessories.length === 1) {
                                        const variantId = selectedMappingAccessories[0];
                                        const accId = selectedAccessories.find((id) => {
                                          const prod = products.find((p) => p?.id === id);
                                          return prod?.variants?.edges?.some((e) => e.node.id === variantId);
                                        }) || variantId;

                                        // Get accessory variant option metadata
                                        const accProd = products.find(p => p?.id === accId);
                                        const accVariant = accProd?.variants?.edges?.find(e => e.node.id === variantId)?.node;
                                        const grouping = accessoryGroupingModes[accId];
                                        const accessoryOption = accVariant ? getGroupingOptionFromVariant(accVariant, grouping?.option || "color") : { name: null, value: null };

                                        handleFileSelected(
                                          baseGroup.key,
                                          accId,
                                          variantId,
                                          file,
                                          {
                                            baseOptionName: baseOption.name || undefined,
                                            baseOptionValue: baseOption.value || undefined,
                                            accessoryOptionName: accessoryOption.name || undefined,
                                            accessoryOptionValue: accessoryOption.value || undefined,
                                          }
                                        );
                                      } else {
                                        const comboKey = buildCombinationKey(selectedMappingAccessories);
                                        const accessoryIds = selectedMappingAccessories.map((variantId) => {
                                          return selectedAccessories.find((id) => {
                                            const prod = products.find((p) => p?.id === id);
                                            return prod?.variants?.edges?.some((e) => e.node.id === variantId);
                                          }) || variantId;
                                        });
                                        handleFileSelected(
                                          baseGroup.key,
                                          comboKey,
                                          comboKey,
                                          file,
                                          {
                                            combinationKey: comboKey,
                                            accessoryIds,
                                            variantIds: selectedMappingAccessories,
                                          }
                                        );
                                      }
                                    }}
                                  />
                                </Box>
                              </BlockStack>
                            </Card>
                          </>
                        )}
                      </>
                    )}
                  </BlockStack>
                </Card>
              )}

              {baseColorGroups.length === 0 && <Text as="p" tone="subdued">No variants found.</Text>}

              {Object.keys(colorImageMap || {}).length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">Existing mappings</Text>
                    {baseColorGroups.map((group) => {
                      const groupMappings = colorImageMap?.[group.key] || {};
                      // Count unique accessory products (not variant entries)
                      const uniqueAccessories = new Set(
                        Object.values(groupMappings).map((m: any) => m.accessoryProductId).filter(Boolean)
                      );
                      const mappingCount = uniqueAccessories.size;

                      if (mappingCount === 0) return null;

                      return (
                        <Box key={`existing-${group.key}`} padding="200" borderColor="border" borderWidth="025" borderRadius="200">
                          <BlockStack gap="200">
                            <InlineStack gap="200" blockAlign="center">
                              <Tag>{group.label}</Tag>
                              <Text as="p" tone="subdued" variant="bodySm">{mappingCount} mapping(s)</Text>
                            </InlineStack>

                            <BlockStack gap="150">
                              {Object.entries(groupMappings).map(([key, mapping]) => {
                                const isCombo = !!(mapping.combinationKey || mapping.accessoryIds);

                                return (
                                  <Box key={`mapping-${key}`} padding="200" background="bg-surface-secondary" borderRadius="150">
                                    <InlineStack align="space-between" blockAlign="center">
                                      <InlineStack gap="150" blockAlign="center">
                                        <Thumbnail size="small" source={mapping.fileUrl} alt="Mapping" />
                                        <BlockStack gap="050">
                                          {isCombo ? (
                                            <>
                                              <Text as="p" variant="bodySm">Combination mapping</Text>
                                              <Text as="p" tone="subdued" variant="bodySm">
                                                {(mapping.variantIds || []).map((vId: string) => {
                                                  const accId = selectedAccessories.find((id) => {
                                                    const prod = products.find((p) => p && p.id === id);
                                                    return prod?.variants?.edges?.some((e) => e.node.id === vId);
                                                  });
                                                  const prod = products.find((p) => p && p.id === accId);
                                                  const variant = prod?.variants?.edges?.find((e) => e.node.id === vId)?.node;
                                                  return `${prod?.title || "Accessory"} - ${variant?.title || "Variant"}`;
                                                }).join(" + ")}
                                              </Text>
                                            </>
                                          ) : (
                                            <>
                                              <Text as="p" variant="bodySm">
                                                {(() => {
                                                  const accId = mapping.accessoryProductId || key;
                                                  const prod = products.find((p) => p && p.id === accId);
                                                  // Show option-based matching if available
                                                  if (mapping.accessoryOptionName && mapping.accessoryOptionValue) {
                                                    return `${prod?.title || "Accessory"} — ${mapping.accessoryOptionValue}`;
                                                  }
                                                  return prod?.title || "Accessory";
                                                })()}
                                              </Text>
                                              <Text as="p" tone="subdued" variant="bodySm">
                                                {(() => {
                                                  // Show that this applies to all matching variants
                                                  if (mapping.accessoryOptionName && mapping.accessoryOptionValue) {
                                                    const accId = mapping.accessoryProductId || key;
                                                    const prod = products.find((p) => p && p.id === accId);
                                                    const groups = getAccessoryGroups(accId);
                                                    const matchingGroup = groups.find(g => {
                                                      const firstVariant = g.variants[0];
                                                      if (!firstVariant) return false;
                                                      const opt = firstVariant.selectedOptions?.find(o =>
                                                        o.name === mapping.accessoryOptionName
                                                      );
                                                      return opt?.value === mapping.accessoryOptionValue;
                                                    });
                                                    if (matchingGroup) {
                                                      return `All ${matchingGroup.variants.length} variant(s) with ${mapping.accessoryOptionName}=${mapping.accessoryOptionValue}`;
                                                    }
                                                  }
                                                  return resolveAccessoryVariantTitle(mapping.accessoryProductId || key, mapping.variantId || key);
                                                })()}
                                              </Text>
                                            </>
                                          )}
                                        </BlockStack>
                                      </InlineStack>
                                      <Button
                                        tone="critical"
                                        size="slim"
                                        onClick={() => {
                                          setColorImageMap((prev) => {
                                            const next = { ...prev } as ColorImageMap;
                                            if (next[group.key]) {
                                              const copy = { ...next[group.key] } as any;
                                              delete copy[key];
                                              next[group.key] = copy;
                                            }
                                            return next;
                                          });
                                        }}
                                      >
                                        Remove
                                      </Button>
                                    </InlineStack>
                                  </Box>
                                );
                              })}
                            </BlockStack>
                          </BlockStack>
                        </Box>
                      );
                    })}
                  </BlockStack>
                </Card>
              )}

              {mappingMode === "show_all" && baseColorGroups.map((group) => {
                const isExpanded = expandedGroups.has(group.key);
                const mappingCount = Object.keys(colorImageMap?.[group.key] || {}).length;

                return (
                  <Card key={group.key}>
                    <BlockStack gap="200">
                      <Box paddingBlock="300" paddingInline="400">
                        <div
                          role="button"
                          tabIndex={0}
                          style={{ cursor: 'pointer', width: '100%' }}
                          onClick={() => {
                            setExpandedGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(group.key)) {
                                next.delete(group.key);
                              } else {
                                next.add(group.key);
                              }
                              return next;
                            });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setExpandedGroups((prev) => {
                                const next = new Set(prev);
                                if (next.has(group.key)) {
                                  next.delete(group.key);
                                } else {
                                  next.add(group.key);
                                }
                                return next;
                              });
                            }
                          }}
                        >
                          <InlineStack gap="200" blockAlign="center">
                            <Tag>{group.label}</Tag>
                            <Text as="span" tone="subdued">{group.variants.length} variant(s)</Text>
                            {mappingCount > 0 && (
                              <Tag>{mappingCount} mapped</Tag>
                            )}
                            <div style={{ marginLeft: 'auto' }}>
                              <Icon source={isExpanded ? ChevronUpIcon : ChevronDownIcon} />
                            </div>
                          </InlineStack>
                        </div>
                      </Box>

                      <Collapsible
                        open={isExpanded}
                        id={`collapsible-${group.key}`}
                        transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
                      >
                        <Box paddingInline="400" paddingBlockEnd="400">
                          <BlockStack gap="300">
                            {selectedAccessories.length === 0 && (
                              <Text as="p" tone="subdued">Add accessory categories to upload mappings.</Text>
                            )}

                            {selectedAccessories.flatMap((accId) => {
                              const accProduct = accessoryProducts.find((p) => p?.id === accId);
                              const variantIds = resolveAccessoryVariantIds(accId);
                              return variantIds.map((accessoryVariantId) => {
                                const accessoryVariantTitle = resolveAccessoryVariantTitle(accId, accessoryVariantId);
                                const existing = colorImageMap?.[group.key]?.[accessoryVariantId];
                                const comboKey = `${group.key}-${accessoryVariantId}`;
                                return (
                                  <Box key={`${group.key}-${accId}-${accessoryVariantId}`} paddingBlockEnd="200">
                                    <BlockStack gap="150">
                                      <InlineStack align="space-between" blockAlign="center">
                                        <InlineStack gap="150" blockAlign="center">
                                          <Thumbnail size="small" source={accProduct?.featuredImage?.url || ""} alt={accProduct?.title || "Accessory"} />
                                          <BlockStack gap="050">
                                            <Text as="p">{accProduct?.title || "Accessory"}</Text>
                                            <Text as="p" tone="subdued" variant="bodySm">{accessoryVariantTitle}</Text>
                                          </BlockStack>
                                        </InlineStack>
                                        <Tag>Accessory</Tag>
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
                                            onFileSelected={(file) => handleFileSelected(group.key, accId, accessoryVariantId, file)}
                                          />
                                        </Box>
                                      </InlineStack>
                                    </BlockStack>
                                  </Box>
                                );
                              });
                            })}
                            {categoryCombinations.length > 0 && (
                              <BlockStack gap="150">
                                <Divider />
                                <Text as="p" variant="bodySm">Category combinations</Text>
                                {categoryCombinations.map((combo) => {
                                  const existingCombo = colorImageMap?.[group.key]?.[combo.key];
                                  const comboLabel = combo.labels.join(" + ");
                                  const comboKey = `${group.key}-${combo.key}`;
                                  return (
                                    <Box key={`${group.key}-${combo.key}`} paddingBlockEnd="150">
                                      <InlineStack align="space-between" blockAlign="center">
                                        <BlockStack gap="050">
                                          <Text as="p">{comboLabel}</Text>
                                          <Text as="p" tone="subdued" variant="bodySm">Applies when all selected</Text>
                                          {existingCombo?.fileUrl && (
                                            <Thumbnail size="small" source={existingCombo.fileUrl} alt="Uploaded" />
                                          )}
                                        </BlockStack>
                                        <Box minWidth="300px">
                                          <SimpleImagePicker
                                            initialUrl={existingCombo?.fileUrl}
                                            uploading={uploadInFlight && uploadingKey === comboKey}
                                            onFileSelected={(file) =>
                                              handleFileSelected(group.key, combo.key, combo.key, file, {
                                                combinationKey: combo.key,
                                                accessoryIds: combo.accessoryIds,
                                                variantIds: combo.variantIds,
                                              })
                                            }
                                          />
                                        </Box>
                                      </InlineStack>
                                    </Box>
                                  );
                                })}
                              </BlockStack>
                            )}
                          </BlockStack>
                        </Box>
                      </Collapsible>
                    </BlockStack>
                  </Card>
                );
              })}

              <InlineStack gap="200">
                <Button onClick={() => {
                  setSelectedBaseColorKey("");
                  setSelectedMappingAccessories([]);
                  setStep("configure");
                }}>Back to configuration</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    // Save FIRST with current data, then clear and navigate
                    handleSaveColorMap();

                    // Use setTimeout to allow save to submit, then clear state
                    setTimeout(() => {
                      setSelectedRulesetId("");
                      setSelectedRulesetHandle("");
                      setSelectedRulesetName("Untitled ruleset");
                      setSelectedBaseProducts([]);
                      setSelectedProductId("");
                      setRuleCategories([]);
                      setColorImageMap({});
                      setColorImageMapByBase({});
                      setSelectedBaseColorKey("");
                      setSelectedMappingAccessories([]);
                      setStep("list");
                    }, 100);
                  }}
                  disabled={uploading || uploadInFlight}
                  loading={uploading || uploadInFlight}
                >
                  Save & return to rulesets
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
