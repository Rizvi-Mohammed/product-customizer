/**
 * Minimal helper to call the Shopify Dev Assistant endpoint using the same headers
 * the browser sends. You must supply fresh cookies from DevTools via SHOPIFY_COOKIES.
 *
 * Usage:
 *   SHOPIFY_COOKIES="<paste from DevTools>" node shopify-bridge.js "your prompt"
 *
 * If you see 400/401, recopy cookies (and any CSRF header) from DevTools.
 */

const SHOPIFY_COOKIES = process.env.SHOPIFY_COOKIES; // e.g. "_shopify_y=...; _shopify_s=...; _shopify_essential_=..."
const SHOPIFY_CSRF = process.env.SHOPIFY_CSRF; // optional: include if DevTools shows an x-csrf-token

if (!SHOPIFY_COOKIES) {
    console.error("Missing SHOPIFY_COOKIES env var. Copy cookies from DevTools and set SHOPIFY_COOKIES before running.");
    process.exit(1);
}

const baseHeaders = {
    accept: "application/json",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json",
    origin: "https://shopify.dev",
    referer: "https://shopify.dev/docs",
    "sec-ch-ua": '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    "x-shopify-dev-use-openai-search": "true",
    cookie: SHOPIFY_COOKIES,
};

if (SHOPIFY_CSRF) {
    baseHeaders["x-csrf-token"] = SHOPIFY_CSRF;
}

async function askShopify(prompt, promptHistory = [], conversationId) {
    const body = {
        prompt,
        prompt_history: promptHistory,
    };
    if (conversationId) body.conversation_id = conversationId;

    const res = await fetch("https://shopify.dev/assistant/conversations", {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Shopify AI failed: ${res.status} ${text}`);
    }

    const contentType = res.headers.get("content-type") || "";
    // The endpoint currently responds with text/event-stream. Parse data: lines and aggregate text tokens.
    if (contentType.includes("text/event-stream")) {
        const text = await res.text();
        const lines = text.split(/\r?\n/);
        const events = [];
        const textParts = [];
        let conversationId;
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.replace(/^data:\s*/, "");
            if (!payload) continue;
            try {
                const parsed = JSON.parse(payload);
                events.push(parsed);
                if (parsed && typeof parsed === "object" && parsed.conversation_id) {
                    conversationId = parsed.conversation_id;
                }
                if (typeof parsed === "string") {
                    textParts.push(parsed);
                }
            } catch {
                // if it's a plain string without JSON quoting, keep it
                textParts.push(payload);
            }
        }
        const assembled = textParts.join("");
        return {
            conversationId,
            text: assembled || null,
            events,
            raw: text,
        };
    }

    return res.json();
}

async function main() {
    const prompt = process.argv.slice(2).join(" ") || "yo";
    try {
        const reply = await askShopify(prompt, []);
        if (reply && typeof reply === "object" && Object.prototype.hasOwnProperty.call(reply, "text")) {
            console.log(reply.text ?? "");
        } else {
            console.log(typeof reply === "string" ? reply : JSON.stringify(reply, null, 2));
        }
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
}

// Node 18+ has global fetch; if using older Node, install node-fetch and run with: node -r node-fetch/register shopify-bridge.js
if (typeof fetch === "undefined") {
    console.error("Global fetch is not available. Use Node 18+ or run with `node -r node-fetch/register shopify-bridge.js`.");
    process.exit(1);
}

if (require.main === module) {
    main();
}
