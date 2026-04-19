import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FONT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fonts", "Sarabun-Bold.ttf");
const FONT_BASE64 = readFileSync(FONT_PATH).toString("base64");

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

function wrapThaiTitle(title, maxCharsPerLine = 28) {
  const words = title.split(/(\s+)/);
  const lines = [];
  let current = "";
  for (const w of words) {
    if ((current + w).length > maxCharsPerLine && current.trim()) {
      lines.push(current.trim());
      current = w.trimStart();
    } else {
      current += w;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.slice(0, 3);
}

async function generateCoverBase(title, audience, togetherApiKey) {
  const res = await fetch("https://api.together.xyz/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${togetherApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "black-forest-labs/FLUX.1-schnell",
      prompt: `Clean modern flat illustration for a Thai educational health article about "${title}". Audience: ${audience}. Soft pastel colors, minimal composition, no text, no letters, 16:9 banner composition, plenty of negative space at the bottom half for overlay.`,
      width: 1024,
      height: 576,
      steps: 4,
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

async function overlayTitle(imageBuffer, title, category) {
  const lines = wrapThaiTitle(title, 28);
  const lineHeight = 56;
  const boxHeight = lines.length * lineHeight + 80;
  const boxY = 576 - boxHeight;
  const textStartY = boxY + 52;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="576">
    <defs>
      <style type="text/css"><![CDATA[
        @font-face {
          font-family: 'Sarabun';
          src: url('data:font/ttf;base64,${FONT_BASE64}') format('truetype');
          font-weight: 700;
        }
        .title { font-family: 'Sarabun'; font-size: 44px; font-weight: 700; fill: #fff; }
        .cat   { font-family: 'Sarabun'; font-size: 20px; font-weight: 700; fill: #fff; opacity: 0.85; }
      ]]></style>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="rgba(0,0,0,0)"/>
        <stop offset="1" stop-color="rgba(0,0,0,0.78)"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${boxY - 60}" width="1024" height="${boxHeight + 60}" fill="url(#g)"/>
    <text x="40" y="${textStartY - 30}" class="cat">${escapeXml(category)}</text>
    ${lines.map((l, i) => `<text x="40" y="${textStartY + i * lineHeight}" class="title">${escapeXml(l)}</text>`).join("")}
  </svg>`;

  return await sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function uploadCover(buffer, siteSlug, urlSlug, supabaseUrl, serviceRoleKey) {
  const path = `${siteSlug}/${urlSlug}.jpg`;
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
  category,
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
    const base = await generateCoverBase(title, audience, togetherApiKey);
    const final = await overlayTitle(base, title, category);
    return await uploadCover(final, siteSlug, urlSlug, supabaseUrl, serviceRoleKey);
  } catch (e) {
    console.error(`[${siteSlug}] Cover generation failed:`, e.message);
    return null;
  }
}
