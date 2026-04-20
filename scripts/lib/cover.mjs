import { createHash } from "node:crypto";

async function generateCover(title, audience, togetherApiKey) {
  const res = await fetch("https://api.together.xyz/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${togetherApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "black-forest-labs/FLUX.1-dev",
      prompt: `Professional editorial photography illustrating a Thai health article titled "${title}". Target audience: ${audience}. Photorealistic, warm natural light, clean modern composition, shallow depth of field, shot in Thailand, real people or real objects relevant to the topic, no text, no letters, no watermarks. 16:9 aspect ratio.`,
      width: 1024,
      height: 576,
      steps: 20,
      n: 1,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Together API failed: ${res.status} ${JSON.stringify(data)}`);
  const url = data.data?.[0]?.url;
  const b64 = data.data?.[0]?.b64_json;
  if (b64) return Buffer.from(b64, "base64");
  if (!url) throw new Error(`Together returned no image: ${JSON.stringify(data)}`);
  const imgRes = await fetch(url);
  if (!imgRes.ok) throw new Error(`Failed to download image: ${imgRes.status}`);
  return Buffer.from(await imgRes.arrayBuffer());
}

function asciiStorageKey(urlSlug) {
  const dateMatch = urlSlug.match(/^(\d{4}-\d{2}-\d{2})/);
  const datePrefix = dateMatch ? dateMatch[1] : "nodate";
  const hash = createHash("sha256").update(urlSlug).digest("hex").slice(0, 10);
  const nonce = Date.now().toString(36);
  return `${datePrefix}-${hash}-${nonce}`;
}

async function uploadCover(buffer, siteSlug, urlSlug, supabaseUrl, serviceRoleKey) {
  const path = `${siteSlug}/${asciiStorageKey(urlSlug)}.jpg`;
  const res = await fetch(`${supabaseUrl}/storage/v1/object/blog-covers/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "image/jpeg",
      "x-upsert": "true",
    },
    body: buffer,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Storage upload failed: ${res.status} ${body}`);
  }
  return `${supabaseUrl}/storage/v1/object/public/blog-covers/${path}`;
}

export async function generateAndUploadCover({
  title,
  audience,
  siteSlug,
  urlSlug,
  togetherApiKey,
  supabaseUrl,
  serviceRoleKey,
}) {
  if (!togetherApiKey) {
    console.log(`[${siteSlug}] TOGETHER_API_KEY missing — skipping cover image`);
    return null;
  }
  try {
    const buffer = await generateCover(title, audience, togetherApiKey);
    return await uploadCover(buffer, siteSlug, urlSlug, supabaseUrl, serviceRoleKey);
  } catch (e) {
    console.error(`[${siteSlug}] Cover generation failed:`, e.message);
    return null;
  }
}
