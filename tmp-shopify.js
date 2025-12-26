const headers = {
    "accept": "application/json",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json",
    "origin": "https://shopify.dev",
    "referer": "https://shopify.dev/docs",
    "sec-ch-ua": "\"Google Chrome\";v=\"143\", \"Chromium\";v=\"143\", \"Not A(Brand\";v=\"24\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    "x-shopify-dev-use-openai-search": "true",
    "cookie": process.env.SHOPIFY_COOKIES,
};
(async () => {
    const res = await fetch("https://shopify.dev/assistant/conversations", {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: "yo", prompt_history: [] }),
    });
    console.error("status", res.status, res.headers.get("content-type"));
    const text = await res.text();
    console.log(text);
})();
