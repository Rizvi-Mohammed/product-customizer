type AdminApi = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const METAFIELD_NAMESPACE = "productCustomizer";

const METAFIELD_DEFINITIONS = [
  {
    key: "image_customization",
    name: "Image customization ruleset",
    description: "Reference to the PIC ruleset metaobject containing all customization data (accessories, categories, image mappings).",
    type: "metaobject_reference",
    validations: [
      {
        name: "metaobject_definition_id",
        value: JSON.stringify("pic_ruleset"),
      },
    ],
  },
];

const METAOBJECT_DEFINITION_QUERY = `#graphql
  query GetMetaobjectDefinition($type: String!) {
    metaobjectDefinitionByType(type: $type) {
      id
      type
    }
  }
`;

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
  // First, get the pic_ruleset metaobject definition ID
  let picRulesetDefinitionId: string | null = null;
  try {
    const moResponse = await admin.graphql(METAOBJECT_DEFINITION_QUERY, {
      variables: { type: "pic_ruleset" },
    });
    const moPayload = await moResponse.json();
    picRulesetDefinitionId = moPayload?.data?.metaobjectDefinitionByType?.id;

    if (!picRulesetDefinitionId) {
      console.error("❌ pic_ruleset metaobject definition not found. Create it first!");
      return;
    }
    console.log("✅ Found pic_ruleset definition:", picRulesetDefinitionId);
  } catch (error) {
    console.error("Error fetching pic_ruleset definition:", error);
    return;
  }

  for (const definition of METAFIELD_DEFINITIONS) {
    try {
      // Replace the validation value with the actual metaobject definition ID
      const validations = definition.validations?.map(v => ({
        ...v,
        value: v.name === "metaobject_definition_id" ? picRulesetDefinitionId : v.value,
      })) || [];

      const response = await admin.graphql(METAFIELD_DEFINITION_MUTATION, {
        variables: {
          definition: {
            namespace: METAFIELD_NAMESPACE,
            key: definition.key,
            name: definition.name,
            description: definition.description,
            ownerType: "PRODUCT",
            type: definition.type,
            validations,
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
