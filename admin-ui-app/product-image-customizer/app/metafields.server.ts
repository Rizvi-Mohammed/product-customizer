type AdminApi = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const METAFIELD_NAMESPACE = "productCustomizer";

const METAFIELD_DEFINITIONS = [
  {
    key: "is_customization_enabled",
    name: "Customization enabled",
    description: "Controls whether the product image customizer widget shows.",
    type: "boolean",
  },
  {
    key: "accessories",
    name: "Accessories",
    description: "Accessory products available for this customizable product.",
    type: "list.product_reference",
  },
  {
    key: "canvas_image",
    name: "Canvas Image",
    description: "Image used for canvas customization (PNG with transparency).",
    type: "file_reference",
  },
  {
    key: "accessory_positions",
    name: "Accessory Positions",
    description: "JSON object storing positions of accessories on the canvas.",
    type: "json",
  },
];

const METAFIELD_DEFINITION_MUTATION = `#graphql
  mutation MetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        namespace
        key
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export async function ensureProductCustomizerMetafields(admin: AdminApi) {
  for (const definition of METAFIELD_DEFINITIONS) {
    try {
      const response = await admin.graphql(METAFIELD_DEFINITION_MUTATION, {
        variables: {
          definition: {
            namespace: METAFIELD_NAMESPACE,
            key: definition.key,
            name: definition.name,
            description: definition.description,
            ownerType: "PRODUCT",
            type: definition.type,
            access: {
              storefront: "PUBLIC_READ",
            },
          },
        },
      });

      const payload = await response.json();
      const userErrors = payload?.data?.metafieldDefinitionCreate?.userErrors;
      const createdDefinition =
        payload?.data?.metafieldDefinitionCreate?.createdDefinition;

      if (Array.isArray(userErrors) && userErrors.length > 0) {
        const alreadyExists = userErrors.some((error: { message?: string }) =>
          (error.message || "").toLowerCase().includes("already exists"),
        );

        if (!alreadyExists) {
          console.error(
            "Metafield definition creation failed:",
            definition.key,
            userErrors,
          );
        } else {
          console.info(
            "Metafield definition already exists:",
            definition.key,
          );
        }
      } else if (createdDefinition?.id) {
        console.info("Metafield definition created:", {
          key: definition.key,
          id: createdDefinition.id,
        });
      }
    } catch (error) {
      console.error(
        "Metafield definition creation error:",
        definition.key,
        error,
      );
    }
  }
}
