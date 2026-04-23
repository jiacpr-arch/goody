import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";

const __dirname = dirname(fileURLToPath(import.meta.url));
GlobalFonts.registerFromPath(join(__dirname, "fonts/Sarabun-Bold.ttf"), "Sarabun");

async function generateCover(title, audience, togetherApiKey) {
  const res = await fetch("https://api.together.xyz/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${togetherApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "black-forest-labs/FLUX.1.1-pro",
      prompt: `Professional editorial photography illustrating a Thai health article titled "${title}". Target audience: ${audience}. Photorealistic, warm natural light, clean modern composition, shallow depth of field, shot in Thailand, real people or real objects relevant to the topic, no text, no letters, no watermarks. 16:9 aspect ratio.`,
      width: 1024,
      height: 576,
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

function wrapThaiText(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let current = "";
  for (const ch of text) {
    const test = current + ch;
    if (ctx.measureText(test).width > maxWidth && current) {
      if (lines.length === maxLines - 1) {
        let truncated = current;
        while (ctx.measureText(truncated + "…").width > maxWidth && truncated.length > 0) {
          truncated = truncated.slice(0, -1);
        }
        lines.push(truncated + "…");
        return lines;
      }
      lines.push(current);
      current = ch;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function compositeTitle(imageBuffer, title) {
  const img = await loadImage(imageBuffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const gradient = ctx.createLinearGradient(0, img.height * 0.35, 0, img.height);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.6, "rgba(0,0,0,0.55)");
  gradient.addColorStop(1, "rgba(0,0,0,0.9)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, img.width, img.height);

  const paddingX = Math.round(img.width * 0.05);
  const paddingBottom = Math.round(img.height * 0.07);
  const fontSize = Math.round(img.width / 16);
  ctx.font = `800 ${fontSize}px Sarabun`;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;

  const maxLines = 3;
  const lines = wrapThaiText(ctx, title, img.width - paddingX * 2, maxLines);
  const lineHeight = fontSize * 1.25;
  let y = img.height - paddingBottom;
  for (let i = lines.length - 1; i >= 0; i--) {
    ctx.fillText(lines[i], paddingX, y);
    y -= lineHeight;
  }

  return canvas.toBuffer("image/jpeg", 92);
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
  coverText,
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
    const rawBuffer = await generateCover(title, audience, togetherApiKey);
    const finalBuffer = await compositeTitle(rawBuffer, coverText || title);
    return await uploadCover(finalBuffer, siteSlug, urlSlug, supabaseUrl, serviceRoleKey);
  } catch (e) {
    console.error(`[${siteSlug}] Cover generation failed:`, e.message);
    return null;
  }
}
