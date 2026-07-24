export async function POST(request) {
  try {
    const { base64, mediaType } = await request.json();
    if (!base64) {
      return Response.json({ error: "No image provided" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "Server is missing ANTHROPIC_API_KEY. Add it in your hosting provider's environment variables." },
        { status: 500 }
      );
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: base64 } },
              {
                type: "text",
                text:
                  "You are an expert automotive spotter. Look at the car in this photo and respond with ONLY a raw JSON object, no markdown fences, no commentary, with exactly these fields: " +
                  '{"make": string, "model": string, "yearEstimate": string, "bodyStyle": string, "color": string, "confidence": "high"|"medium"|"low", "rarityTier": "Common"|"Uncommon"|"Rare"|"Exotic"|"Legendary", "estimatedValue": number, "funFact": string}. ' +
                  "Base rarity on how uncommon this vehicle is to see on a typical road, not on its price alone. If no car is clearly identifiable in the image, respond with only: " +
                  '{"error": "no car detected"}',
              },
            ],
          },
        ],
      }),
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      return Response.json({ error: data.error?.message || "Anthropic API error" }, { status: anthropicRes.status });
    }

    const text = (data.content || []).map((b) => b.text || "").join("\n");
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    return Response.json(parsed);
  } catch (err) {
    return Response.json({ error: err.message || "Something went wrong" }, { status: 500 });
  }
}
