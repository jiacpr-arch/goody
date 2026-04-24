import Anthropic from "@anthropic-ai/sdk";
import { XMLParser } from "fast-xml-parser";
import { generateAndUploadCover } from "./lib/cover.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tpoiyykbgsgnrdwzgzvn.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");

const RSS_FEEDS = [
  { name: "BBC Thai", url: "https://feeds.bbci.co.uk/thai/rss.xml" },
  { name: "Hfocus", url: "https://www.hfocus.org/rss.xml" },
];

const HEALTH_KEYWORDS = [
  "สุขภาพ", "โรค", "แพทย์", "ยา", "วัคซีน", "โควิด", "มะเร็ง", "เบาหวาน",
  "หัวใจ", "ออกกำลัง", "โภชนาการ", "อาหาร", "นอน", "เครียด", "สมอง",
  "ความดัน", "ไต", "ตับ", "ปอด", "สสส", "สาธารณสุข", "WHO", "hospital", "health",
];

function isHealthRelated(text) {
  const t = (text || "").toLowerCase();
  return HEALTH_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
}

async function fetchRssItems(feed) {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "Mozilla/5.0 goody-bot/1.0" },
    });
    if (!res.ok) {
      console.warn(`[${feed.name}] HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      processEntities: false,
    });
    const doc = parser.parse(xml);
    const items = doc?.rss?.channel?.item || doc?.feed?.entry || [];
    const arr = Array.isArray(items) ? items : [items];
    return arr
      .map((i) => ({
        source: feed.name,
        title: (i.title?.["#text"] || i.title || "").toString().trim(),
        description: (i.description?.["#text"] || i.description || i.summary || "").toString().trim(),
        link: (i.link?.["#text"] || i.link?.["@_href"] || i.link || "").toString().trim(),
        pubDate: i.pubDate || i.published || i.updated || "",
      }))
      .filter((i) => i.title && i.link);
  } catch (e) {
    console.warn(`[${feed.name}] fetch failed:`, e.message);
    return [];
  }
}

async function gatherHealthItems() {
  const all = (await Promise.all(RSS_FEEDS.map(fetchRssItems))).flat();
  const filtered = all.filter((i) => isHealthRelated(i.title + " " + i.description));
  const seen = new Set();
  return filtered.filter((i) => {
    if (seen.has(i.link)) return false;
    seen.add(i.link);
    return true;
  });
}

function stripHtml(s) {
  return (s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
}

const ARTICLE_TOOL = {
  name: "publish_article",
  description: "Publish a Thai-language health article to the blog.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "หัวข้อเร้าใจ ไม่เกิน 80 ตัวอักษร" },
      meta_description: {
        type: "string",
        description: "สรุปสั้น 1-2 ประโยค ไม่เกิน 160 ตัวอักษร",
      },
      content_html: {
        type: "string",
        description:
          "บทความเต็ม HTML (ใช้ <p>, <h2>, <ul>, <li>, <a>) ไม่ต้อง escape quotes ใส่ credit ท้ายบทความถ้ามี",
      },
      category: { type: "string", description: "หมวดหมู่ เช่น 'ข่าวสุขภาพ' หรือ 'เกร็ดสุขภาพ'" },
      source_url: { type: "string", description: "URL ต้นฉบับ (ว่างถ้าไม่มี)" },
    },
    required: ["title", "meta_description", "content_html", "category"],
  },
};

async function callArticleTool(prompt) {
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 5 });
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    tools: [ARTICLE_TOOL],
    tool_choice: { type: "tool", name: "publish_article" },
    messages: [{ role: "user", content: prompt }],
  });
  if (msg.stop_reason === "max_tokens") {
    throw new Error(`Claude hit max_tokens — article truncated (stop_reason=${msg.stop_reason})`);
  }
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("Claude did not return tool_use block");
  const input = toolUse.input;
  if (!input.content_html || !input.title) {
    throw new Error(`Claude tool_use missing required fields: ${JSON.stringify(Object.keys(input))}`);
  }
  return input;
}

async function writeArticle(items) {
  const itemList = items
    .slice(0, 15)
    .map(
      (i, idx) =>
        `[${idx + 1}] ที่มา: ${i.source}\nหัวข้อ: ${i.title}\nสรุป: ${stripHtml(i.description)}\nลิงก์: ${i.link}`
    )
    .join("\n\n");

  const prompt = `คุณเป็นนักเขียนข่าวสุขภาพภาษาไทย ด้านล่างคือรายการข่าวสุขภาพจาก RSS feed

${itemList}

ภารกิจ:
1. เลือกข่าว 1 ชิ้นที่น่าสนใจและมีประโยชน์ต่อคนอ่านทั่วไปที่สุด
2. เขียนบทความใหม่เป็นภาษาไทย สไตล์อ่านง่าย เนื้อหาประมาณ 400-600 คำ
3. เขียนใหม่ด้วยสำนวนตัวเอง ไม่ copy ต้นฉบับ
4. ใส่ credit แหล่งข่าวท้ายบทความในรูปแบบ <p>ที่มา: <a href="URL">ชื่อแหล่ง</a></p>
5. category ให้ใช้ "ข่าวสุขภาพ"

จบแล้วเรียก tool publish_article`;

  return await callArticleTool(prompt);
}

async function writeFallbackTip() {
  const today = new Date().toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" });
  const prompt = `เขียนเกร็ดความรู้สุขภาพประจำวัน ${today} เป็นภาษาไทย อ่านง่าย ประมาณ 300-500 คำ เลือก topic หมุนเวียน (โภชนาการ ออกกำลัง การนอน สุขภาพจิต โรคทั่วไป ฯลฯ)

category ให้ใช้ "เกร็ดสุขภาพ" ไม่มี source_url
จบแล้วเรียก tool publish_article`;
  return await callArticleTool(prompt);
}

function slugify(s) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9ก-๙]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `health-${Date.now()}`
  );
}

async function insertPost(article) {
  const bkkDateStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const nowISO = new Date().toISOString();
  const urlSlug = `${bkkDateStr}-${slugify(article.title)}`;
  const coverUrl = await generateAndUploadCover({
    title: article.title,
    audience: "คนทั่วไปที่สนใจข่าวและเกร็ดสุขภาพ",
    siteSlug: "health",
    urlSlug,
    togetherApiKey: TOGETHER_API_KEY,
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  });

  const payload = {
    site_slug: "health",
    title: article.title,
    meta_description: article.meta_description,
    content_html: article.content_html,
    category: article.category || "ข่าวสุขภาพ",
    cover_image_url: coverUrl,
    url_slug: urlSlug,
    published_at: nowISO,
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/blog_posts`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase insert failed: ${res.status} ${body}`);
  }
  return res.status === 201 ? { ok: true } : await res.json();
}

async function alreadyPostedToday(siteSlug) {
  const todayBkk = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/blog_posts?site_slug=eq.${siteSlug}&published_at=gte.${todayBkk}T00:00:00Z&limit=1&select=id`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  const data = await res.json();
  return Array.isArray(data) && data.length > 0;
}

async function main() {
  if (await alreadyPostedToday("health")) {
    console.log("Already posted today — skipping.");
    return;
  }

  console.log("Fetching RSS feeds...");
  const items = await gatherHealthItems();
  console.log(`Found ${items.length} health-related items`);

  let article;
  if (items.length > 0) {
    console.log("Generating article from RSS...");
    article = await writeArticle(items);
  } else {
    console.log("No RSS items found, generating fallback tip...");
    article = await writeFallbackTip();
  }

  console.log("Title:", article.title);
  console.log("Inserting to Supabase...");
  await insertPost(article);
  console.log("Done ✓");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
