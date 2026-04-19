import Anthropic from "@anthropic-ai/sdk";
import { generateAndUploadCover } from "./lib/cover.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tpoiyykbgsgnrdwzgzvn.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");

// เพิ่ม site อื่นได้ทีหลัง
const SITES = [
  {
    slug: "jiacpr",
    audience: "คนทั่วไปและบุคลากรที่ต้องการเรียนรู้ CPR และการปฐมพยาบาล",
    topic: "CPR การกู้ชีพขั้นพื้นฐาน การปฐมพยาบาล การช่วยเหลือฉุกเฉิน",
    tone: "เข้าใจง่าย กระชับ ปฏิบัติได้จริง เน้นขั้นตอน",
    examples: "เช่น: ขั้นตอน CPR ที่ถูกต้อง, วิธีช่วยเหลือคนหัวใจหยุดเต้น, การใช้ AED, การปฐมพยาบาลเบื้องต้น",
  },
];

const ARTICLE_TOOL = {
  name: "publish_article",
  description: "Publish a Thai-language educational article to the blog.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "หัวข้อเร้าใจ น่าคลิก ไม่เกิน 80 ตัวอักษร — ต้องพาดพิงถึงวันสำคัญหรือใช้วันสำคัญเป็น hook เชื่อมกับเนื้อหา",
      },
      meta_description: {
        type: "string",
        description: "สรุปสั้น 1-2 ประโยค ไม่เกิน 160 ตัวอักษร ควรเอ่ยถึงวันสำคัญ",
      },
      content_html: {
        type: "string",
        description:
          "บทความเต็ม HTML ใช้ <p>, <h2>, <ul>, <li> ความยาว 500-700 คำ โครงสร้าง: (1) ย่อหน้าเปิดที่โยงวันสำคัญเข้ากับหัวข้อสุขภาพ (2) <h2>เกี่ยวกับวันสำคัญ</h2> อธิบายประวัติ/ความหมายของวันนั้น 80-120 คำ (3) section เนื้อหาสุขภาพที่เกี่ยวข้อง",
      },
      category: {
        type: "string",
        description: "ชื่อวันสำคัญประจำวัน — ใช้วันสำคัญจริง (ไทยหรือสากล) ของวันนั้นเสมอ แม้จะไม่เกี่ยวกับสุขภาพ เช่น 'วันมรดกโลก', 'วันครู', 'วันสงกรานต์', 'วันหัวใจโลก' ห้ามตั้งชื่อวันขึ้นมาเอง",
      },
    },
    required: ["title", "meta_description", "content_html", "category"],
  },
};

function slugify(s) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9ก-๙]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `post-${Date.now()}`
  );
}

async function generateForSite(site, anthropic) {
  const today = new Date().toLocaleDateString("th-TH", {
    timeZone: "Asia/Bangkok",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const prompt = `วันนี้คือ${today}

ขั้นตอนที่ 1: ค้นหาวันสำคัญจริง (ไทยหรือสากล) ที่ตรงกับวันที่นี้ ต้องเป็นวันสำคัญที่มีอยู่จริงเท่านั้น ไม่ว่าจะเกี่ยวกับสุขภาพหรือไม่ เช่น วันมรดกโลก วันครู วันสงกรานต์ วันแรงงาน — ห้ามตั้งชื่อวันขึ้นมาเอง ถ้ามีหลายวันสำคัญ ให้เลือกอันที่เชื่อมโยงกับเนื้อหาได้ลื่นที่สุด

ขั้นตอนที่ 2: เขียนบทความ "วันดีๆ" ประจำวันสำหรับเว็บไซต์ที่มีกลุ่มเป้าหมายเป็น: ${site.audience}
เนื้อหาความรู้ที่เกี่ยวกับ: ${site.topic}
สไตล์การเขียน: ${site.tone}
${site.examples}

กฎสำคัญ — ต้องเชื่อมวันสำคัญกับบทความให้ชัดเจน:
- **title ต้องพาดพิงถึงวันสำคัญ** หรือใช้วันสำคัญเป็น hook เช่น "วันสงกรานต์ปีนี้ พกทักษะ CPR ติดตัวไปเที่ยวกันเถอะ" (ห้าม title เป็นเรื่องทั่วไปที่ไม่เชื่อมวันสำคัญเลย)
- **ต้องมี <h2> หัวข้อ "เกี่ยวกับวันสำคัญ" เป็น section แรก** (หรือชื่อคล้ายกัน) อธิบายประวัติ/ความหมาย/ความสำคัญของวันนั้นอย่างน้อย 1 ย่อหน้า (80-120 คำ) ก่อนจะเข้า section เนื้อหาสุขภาพ — ไม่ใช่แค่เอ่ยชื่อวันผ่านๆ แล้วข้ามไปเรื่องสุขภาพ
- **ย่อหน้าแรก** (ก่อน h2 section แรก) ใช้เป็น hook โยงวันสำคัญเข้ากับหัวข้อสุขภาพ
- meta_description ควรเอ่ยถึงวันสำคัญด้วย

กฎทั่วไป:
- ความยาว 500-700 คำ (เพิ่มขึ้นเพราะมี section เกี่ยวกับวันสำคัญ)
- ภาษาไทยทั้งหมด (ยกเว้นคำศัพท์เทคนิคที่จำเป็น)
- เลือก topic ใหม่ที่ยังไม่ซ้ำซาก (อ้างอิงวันที่เพื่อกระจาย topic)
- อย่าเริ่มด้วย "วันนี้" ซ้ำๆ ทุกวัน
- จบบทความให้น่าจดจำ

เรียก tool publish_article เมื่อเขียนเสร็จ`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2500,
    tools: [ARTICLE_TOOL],
    tool_choice: { type: "tool", name: "publish_article" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error(`[${site.slug}] Claude did not return tool_use block`);
  return toolUse.input;
}

async function insertPost(article, site) {
  const bkkDateStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const nowISO = new Date().toISOString();
  const urlSlug = `${bkkDateStr}-${slugify(article.title)}`;
  const coverUrl = await generateAndUploadCover({
    title: article.title,
    audience: site.audience,
    siteSlug: site.slug,
    urlSlug,
    togetherApiKey: TOGETHER_API_KEY,
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  });

  const payload = {
    site_slug: site.slug,
    title: article.title,
    meta_description: article.meta_description,
    content_html: article.content_html,
    category: article.category,
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
    throw new Error(`[${site.slug}] Supabase insert failed: ${res.status} ${body}`);
  }
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
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  for (const site of SITES) {
    try {
      if (await alreadyPostedToday(site.slug)) {
        console.log(`[${site.slug}] Already posted today — skipping.`);
        continue;
      }
      console.log(`\n[${site.slug}] Generating...`);
      const article = await generateForSite(site, anthropic);
      console.log(`[${site.slug}] Title: ${article.title}`);
      await insertPost(article, site);
      console.log(`[${site.slug}] ✓ Inserted`);
    } catch (e) {
      console.error(`[${site.slug}] FAILED:`, e.message);
    }
  }
  console.log("\nDone.");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
