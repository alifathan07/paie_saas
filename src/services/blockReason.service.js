const DEFAULT_REASON = "Paiement en attente";

function cleanReason(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 191);
}

export async function polishBlockReason(input) {
    const original = cleanReason(input) || DEFAULT_REASON;
    const apiKey = String(process.env.GROQ_API_KEY || process.env.DEEPSEEK_API_KEY || "").trim();
    if (!apiKey) return original;

    const isDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY) && !process.env.GROQ_API_KEY;
    const endpoint = isDeepSeek
        ? "https://api.deepseek.com/chat/completions"
        : "https://api.groq.com/openai/v1/chat/completions";
    const model = String(process.env[isDeepSeek ? "DEEPSEEK_MODEL" : "GROQ_MODEL"] || (isDeepSeek ? "deepseek-chat" : "llama-3.1-8b-instant")).trim();

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model,
                temperature: 0.2,
                max_tokens: 80,
                messages: [
                    { role: "system", content: "Tu rédiges des messages professionnels très courts en français pour expliquer le blocage temporaire d’un compte client. Reformule sans inventer de motif, sans menace, sans salutation, en une seule phrase claire de 12 à 25 mots. Conserve exactement le sens fourni." },
                    { role: "user", content: original },
                ],
            }),
        });
        if (!response.ok) throw new Error(`AI_BLOCK_REASON_${response.status}`);
        const data = await response.json();
        const polished = cleanReason(data?.choices?.[0]?.message?.content);
        return polished || original;
    } catch (error) {
        console.warn("[block.reason] AI rewrite unavailable; using admin text", { message: error.message });
        return original;
    }
}

