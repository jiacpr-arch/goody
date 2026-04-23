import { generateAndUploadCover } from "./lib/cover.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tpoiyykbgsgnrdwzgzvn.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;
// FORCE_DAYS=7 → regenerate all posts from last 7 days regardless of existing cover
const FORCE_DAYS = process.env.FORCE_DAYS ? parseInt(process.env.FORCE_DAYS, 10) : 0;

if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
if (!TOGETHER_API_KEY) throw new Error("TOGETHER_API_KEY missing");

const AUDIENCE = {
  jiacpr: "คนทั่วไปและบุคลากรที่ต้องการเรียนรู้ CPR และการปฐมพยาบาล",
  health: "คนทั่วไปที่สนใจข่าวและเกร็ดสุขภาพ",
};

const HEADERS = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function fetchPosts() {
  let url;
  if (FORCE_DAYS > 0) {
    const since = new Date(Date.now() - FORCE_DAYS * 86400_000).toISOString();
    url = `${SUPABASE_URL}/rest/v1/blog_posts?published_at=gte.${since}&order=published_at.desc&limit=50&select=id,site_slug,title,category,url_slug`;
    console.log(`Force mode: regenerating all posts from last ${FORCE_DAYS} day(s)`);
  } else {
    url = `${SUPABASE_URL}/rest/v1/blog_posts?cover_image_url=is.null&order=published_at.desc&limit=20&select=id,site_slug,title,category,url_slug`;
  }
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Query failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function updateCoverUrl(id, coverUrl) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/blog_posts?id=eq.${id}`, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify({ cover_image_url: coverUrl }),
  });
  if (!res.ok) throw new Error(`Update failed: ${res.status} ${await res.text()}`);
}

async function main() {
  const posts = await fetchPosts();
  console.log(`Found ${posts.length} posts to process`);

  for (const p of posts) {
    const audience = AUDIENCE[p.site_slug] || AUDIENCE.health;
    console.log(`\n[${p.site_slug}] ${p.title}`);
    const coverUrl = await generateAndUploadCover({
      title: p.title,
      coverText: p.category,
      audience,
      siteSlug: p.site_slug,
      urlSlug: p.url_slug,
      togetherApiKey: TOGETHER_API_KEY,
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    });
    if (!coverUrl) {
      console.log(`[${p.site_slug}] Cover gen returned null — skipping DB update`);
      continue;
    }
    await updateCoverUrl(p.id, coverUrl);
    console.log(`[${p.site_slug}] ✓ Updated cover_image_url`);
  }
  console.log("\nDone.");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
