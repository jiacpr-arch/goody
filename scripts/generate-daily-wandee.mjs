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
          "บทความเต็ม HTML ใช้ <p>, <h2>, <ul>, <li> ความยาว 500-700 คำ โครงสร้างเน้นวันสำคัญเป็นแกนหลัก: (1) ย่อหน้าเปิด hook เกี่ยวกับวันสำคัญ (2) <h2>เกี่ยวกับวันสำคัญ</h2> อธิบายประวัติ ที่มา ความหมาย ความสำคัญของวันนั้นแบบเจาะลึก 200-280 คำ (3) <h2>เรื่องน่ารู้เกี่ยวกับวันนี้</h2> เกร็ดที่น่าสนใจ 100-150 คำ (4) section สุขภาพ/CPR ที่เชื่อมโยงกับวันนี้แบบธรรมชาติ 150-200 คำ — ไม่ใช่โฆษณา ไม่ขายหลักสูตร ไม่เชิญชวนสมัครเรียน",
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

กฎสำคัญ — วันสำคัญต้องเป็นแกนหลักของบทความ:
- **title ต้องเด่นที่วันสำคัญ** เช่น "วันคุ้มครองโลก: โลกที่เราอยู่กำลังบอกอะไร" ไม่ใช่เน้นสุขภาพแล้วโยงวันสำคัญเฉย ๆ
- **content แบ่งสัดส่วน 70/30**: 70% เรื่องวันสำคัญ (ประวัติ, ที่มา, ความหมาย, เกร็ดน่ารู้, กิจกรรมที่เกี่ยวข้อง) + 30% สุขภาพ/CPR ที่เชื่อมโยงกับวันนี้แบบธรรมชาติ
- **ห้ามเป็นบทความโฆษณา** — ห้ามเชิญชวนสมัครเรียน ห้ามพูดถึงคอร์ส ห้ามบอก "สมัคร" "เรียน" "หลักสูตร" "ติดต่อเรา" — เขียนแบบ editorial เหมือนนิตยสารสุขภาพ ให้ความรู้บริสุทธิ์
- **section วันสำคัญต้องเจาะลึก** ไม่ใช่แค่เอ่ยชื่อผ่าน ๆ เล่าประวัติการก่อตั้ง ที่มาของชื่อ เหตุการณ์สำคัญ กิจกรรมที่คนทั่วโลก/ไทยทำในวันนี้ สถิติหรือ fact ที่น่าสนใจ
- **section สุขภาพเป็นส่วนเสริม** สั้นกระชับ 150-200 คำ เชื่อมกับธีมวันสำคัญ ให้ข้อมูล/ทักษะที่ผู้อ่านเอาไปใช้ได้ ไม่ขายคอร์ส
- **meta_description** เอ่ยวันสำคัญเป็นหลัก

กฎทั่วไป:
- ความยาว 500-700 คำ
- ภาษาไทยทั้งหมด (ยกเว้นคำศัพท์เทคนิคที่จำเป็น)
- เลือก topic ใหม่ที่ยังไม่ซ้ำซาก (อ้างอิงวันที่เพื่อกระจาย topic)
- อย่าเริ่มด้วย "วันนี้" ซ้ำ ๆ ทุกวัน
- จบบทความให้น่าจดจำด้วยแง่คิดหรือคำเชิญชวนให้ฉลอง/ตระหนักถึงวันนี้ (ไม่ใช่ขายของ)

เรียก tool publish_article เมื่อเขียนเสร็จ`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    tools: [ARTICLE_TOOL],
    tool_choice: { type: "tool", name: "publish_article" },
    messages: [{ role: "user", content: prompt }],
  });

  if (msg.stop_reason === "max_tokens") {
    throw new Error(`[${site.slug}] Claude hit max_tokens — article truncated`);
  }
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error(`[${site.slug}] Claude did not return tool_use block`);
  const input = toolUse.input;
  if (!input.content_html || !input.title) {
    throw new Error(`[${site.slug}] tool_use missing required fields: ${JSON.stringify(Object.keys(input))}`);
  }
  return input;
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
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 5 });

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
