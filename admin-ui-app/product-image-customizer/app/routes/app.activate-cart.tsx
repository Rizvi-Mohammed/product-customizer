import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);

    const query = `
    query {
      cartTransform {
        id
        functionId
      }
      shopifyFunctions(first: 10, type: CART_TRANSFORM) {
        nodes {
          id
          title
          apiType
        }
      }
    }
  `;

    const response = await admin.graphql(query);
    const data = await response.json();

    return json(data.data);
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const action = formData.get("action");
    const functionId = formData.get("functionId");

    if (action === "activate" && functionId) {
        const mutation = `
      mutation cartTransformCreate($functionId: String!) {
        cartTransformCreate(cartTransform: {functionId: $functionId}) {
          cartTransform {
            id
            functionId
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

        const response = await admin.graphql(mutation, {
            variables: { functionId: String(functionId) }
        });
        const data = await response.json();

        return json({
            success: !data.data?.cartTransformCreate?.userErrors?.length,
            data: data.data,
            message: data.data?.cartTransformCreate?.userErrors?.length
                ? "Failed to activate"
                : "Cart transform activated!"
        });
    }

    if (action === "deactivate") {
        const mutation = `
      mutation {
        cartTransformDelete {
          deletedId
          userErrors {
            field
            message
          }
        }
      }
    `;

        const response = await admin.graphql(mutation);
        const data = await response.json();

        return json({
            success: !data.data?.cartTransformDelete?.userErrors?.length,
            data: data.data,
            message: "Cart transform deactivated"
        });
    }

    return json({ success: false, message: "Invalid action" });
};

export default function ActivateCart() {
    const loaderData = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();

    const currentTransform = loaderData?.cartTransform;
    const availableFunctions = loaderData?.shopifyFunctions?.nodes || [];
    const bundleFunction = availableFunctions.find((f: any) => f.title?.includes("bundle") || f.title?.includes("transform"));

    const handleActivate = () => {
        if (bundleFunction) {
            const formData = new FormData();
            formData.append("action", "activate");
            formData.append("functionId", bundleFunction.id);
            submit(formData, { method: "post" });
        }
    };

    const handleDeactivate = () => {
        const formData = new FormData();
        formData.append("action", "deactivate");
        submit(formData, { method: "post" });
    };

    return (
        <div style={{ padding: "40px", maxWidth: "800px", margin: "0 auto" }}>
            <h1 style={{ marginBottom: "30px" }}>Cart Transform Activation</h1>

            {actionData?.message && (
                <div style={{
                    padding: "15px",
                    background: actionData.success ? "#d4edda" : "#f8d7da",
                    color: actionData.success ? "#155724" : "#721c24",
                    borderRadius: "8px",
                    marginBottom: "20px"
                }}>
                    {actionData.message}
                </div>
            )}

            <div style={{
                background: "#f8f9fa",
                padding: "20px",
                borderRadius: "8px",
                marginBottom: "20px"
            }}>
                <h2>Current Status</h2>
                <p><strong>Active Transform:</strong> {currentTransform?.id || "None"}</p>
                <p><strong>Function ID:</strong> {currentTransform?.functionId || "None"}</p>
            </div>

            <div style={{
                background: "#f8f9fa",
                padding: "20px",
                borderRadius: "8px",
                marginBottom: "20px"
            }}>
                <h2>Available Functions</h2>
                {availableFunctions.length === 0 ? (
                    <p>No cart transform functions found. Deploy your app first.</p>
                ) : (
                    <ul>
                        {availableFunctions.map((func: any) => (
                            <li key={func.id}>
                                <strong>{func.title}</strong> - {func.id}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
                <button
                    onClick={handleActivate}
                    disabled={!bundleFunction || currentTransform?.functionId === bundleFunction?.id}
                    style={{
                        padding: "12px 24px",
                        background: "#007bff",
                        color: "white",
                        border: "none",
                        borderRadius: "6px",
                        cursor: bundleFunction ? "pointer" : "not-allowed",
                        fontSize: "16px"
                    }}
                >
                    Activate Cart Transform
                </button>

                <button
                    onClick={handleDeactivate}
                    disabled={!currentTransform}
                    style={{
                        padding: "12px 24px",
                        background: "#dc3545",
                        color: "white",
                        border: "none",
                        borderRadius: "6px",
                        cursor: currentTransform ? "pointer" : "not-allowed",
                        fontSize: "16px"
                    }}
                >
                    Deactivate Cart Transform
                </button>
            </div>

            <div style={{ marginTop: "30px", padding: "20px", background: "#fff3cd", borderRadius: "8px" }}>
                <h3>Instructions:</h3>
                <ol>
                    <li>Make sure your app is deployed (<code>shopify app deploy</code>)</li>
                    <li>Click "Activate Cart Transform" button above</li>
                    <li>Clear your cart completely</li>
                    <li>Add products with accessories</li>
                    <li>Check if items are bundled</li>
                </ol>
            </div>

            <pre style={{
                background: "#f5f5f5",
                padding: "20px",
                marginTop: "20px",
                borderRadius: "8px",
                fontSize: "12px",
                overflow: "auto"
            }}>
                {JSON.stringify(loaderData, null, 2)}
            </pre>
        </div>
    );
}
