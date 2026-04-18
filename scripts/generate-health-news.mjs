import Anthropic from "@anthropic-ai/sdk";
import { XMLParser } from "fast-xml-parser";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tpoiyykbgsgnrdwzgzvn.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");

const RSS_FEEDS = [
  { name: "Hfocus", url: "https://www.hfocus.org/rss.xml" },
  { name: "BBC Thai", url: "https://feeds.bbci.co.uk/thai/rss.xml" },
  { name: "ThaiPBS", url: "https://www.thaipbs.or.th/rss/news" },
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
    const parser = new XMLParser({ ignoreAttributes: false });
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

async function writeArticle(items) {
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

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
2. เขียนบทความใหม่เป็นภาษาไทย สไตล์อ่านง่าย ให้ข้อมูลแบบเกร็ดความรู้/ข่าวสั้น ประมาณ 400-600 คำ
3. ไม่ copy ต้นฉบับ เขียนใหม่ด้วยสำนวนตัวเอง
4. ใส่ credit แหล่งข่าวท้ายบทความ

ตอบเป็น JSON object เท่านั้น รูปแบบ:
{
  "title": "หัวข้อเร้าใจ ไม่เกิน 80 ตัวอักษร",
  "meta_description": "สรุปสั้น 1-2 ประโยค ไม่เกิน 160 ตัวอักษร",
  "content_html": "<p>...</p><h2>...</h2><p>...</p><p>ที่มา: <a href=\\"URL\\">ชื่อแหล่ง</a></p>",
  "category": "ข่าวสุขภาพ",
  "cover_image_url": "",
  "source_url": "URL ต้นฉบับ"
}`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude returned no JSON");
  return JSON.parse(jsonMatch[0]);
}

async function writeFallbackTip() {
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const today = new Date().toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" });
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: `เขียนเกร็ดความรู้สุขภาพประจำวัน ${today} เป็นภาษาไทย อ่านง่าย ประมาณ 300-500 คำ เลือก topic หมุนเวียน (โภชนาการ ออกกำลัง การนอน สุขภาพจิต โรคทั่วไป ฯลฯ)

ตอบเป็น JSON object เท่านั้น:
{
  "title": "หัวข้อเร้าใจ ไม่เกิน 80 ตัวอักษร",
  "meta_description": "สรุปสั้น 1-2 ประโยค ไม่เกิน 160 ตัวอักษร",
  "content_html": "<p>...</p><h2>...</h2><p>...</p>",
  "category": "เกร็ดสุขภาพ",
  "cover_image_url": "",
  "source_url": ""
}`,
      },
    ],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude returned no JSON");
  return JSON.parse(jsonMatch[0]);
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

  const payload = {
    site_slug: "health",
    title: article.title,
    meta_description: article.meta_description,
    content_html: article.content_html,
    category: article.category || "ข่าวสุขภาพ",
    cover_image_url: article.cover_image_url || null,
    url_slug: `${bkkDateStr}-${slugify(article.title)}`,
    published_at: nowISO,
    date: bkkDateStr,
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/blog_posts`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase insert failed: ${res.status} ${body}`);
  }
  return await res.json();
}

async function main() {
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
  const result = await insertPost(article);
  console.log("Inserted:", result?.[0]?.id || "(unknown id)");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
