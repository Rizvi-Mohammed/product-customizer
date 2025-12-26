import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);

    // Query to check cart transform status
    const query = `
    query {
      cartTransform {
        id
        functionId
        blockOnFailure
      }
      shopifyFunctions(first: 10, type: CART_TRANSFORM) {
        nodes {
          id
          title
          apiType
          appTitle
        }
      }
    }
  `;

    try {
        const response = await admin.graphql(query);
        const data = await response.json();

        return json({
            success: true,
            data: data.data,
            errors: (data as any).errors
        });
    } catch (error) {
        return json({
            success: false,
            error: String(error)
        }, { status: 500 });
    }
};

export default function DebugCart() {
    const data = useLoaderData<typeof loader>();

    return (
        <div style={{ padding: "40px", fontFamily: "monospace" }}>
            <h1>Cart Transform Debug Info</h1>

            <div style={{
                background: "#f5f5f5",
                padding: "20px",
                marginTop: "20px",
                borderRadius: "8px",
                maxHeight: "600px",
                overflow: "auto"
            }}>
                <pre>{JSON.stringify(data, null, 2)}</pre>
            </div>

            <div style={{ marginTop: "20px", padding: "20px", background: "#fff3cd", borderRadius: "8px" }}>
                <h2>What to check:</h2>
                <ul>
                    <li><strong>cartTransform.id</strong>: Should not be null if a transform is active</li>
                    <li><strong>cartTransform.functionId</strong>: Should point to your function</li>
                    <li><strong>shopifyFunctions.nodes</strong>: Should list your cart transform function</li>
                </ul>
            </div>
        </div>
    );
}
