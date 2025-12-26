import { json, type ActionFunctionArgs } from "@remix-run/node";
import { useActionData, useSubmit } from "@remix-run/react";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);

    // Query to check if cart transform is enabled
    const checkQuery = `
    query {
      cartTransform {
        id
        functionId
      }
    }
  `;

    // Mutation to enable cart transform
    const enableMutation = `
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

    try {
        // First check current status
        const checkResponse = await admin.graphql(checkQuery);
        const checkData = await checkResponse.json();

        console.log("Current cart transform:", checkData);

        // If no transform is active, we need to activate it
        // We need to get the function ID from the deployment
        // For now, let's just return the status

        return json({
            success: true,
            currentTransform: checkData.data?.cartTransform,
            message: "Check console for cart transform status"
        });
    } catch (error) {
        console.error("Error checking cart transform:", error);
        return json({ success: false, error: String(error) }, { status: 500 });
    }
};

export default function ActivateFunction() {
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();

    const handleCheck = () => {
        submit({}, { method: "post" });
    };

    return (
        <div style={{ padding: "20px" }}>
            <h1>Cart Transform Function Status</h1>
            <button onClick={handleCheck}>Check Cart Transform Status</button>
            {actionData && (
                <pre style={{
                    background: "#f5f5f5",
                    padding: "20px",
                    marginTop: "20px",
                    borderRadius: "8px"
                }}>
                    {JSON.stringify(actionData, null, 2)}
                </pre>
            )}
        </div>
    );
}
