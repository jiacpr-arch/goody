import Anthropic from "@anthropic-ai/sdk";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tpoiyykbgsgnrdwzgzvn.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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
      title: { type: "string", description: "หัวข้อเร้าใจ น่าคลิก ไม่เกิน 80 ตัวอักษร" },
      meta_description: {
        type: "string",
        description: "สรุปสั้น 1-2 ประโยค ไม่เกิน 160 ตัวอักษร",
      },
      content_html: {
        type: "string",
        description: "บทความเต็ม HTML ใช้ <p>, <h2>, <ul>, <li> ความยาว 400-600 คำ",
      },
      category: {
        type: "string",
        description: "ชื่อวันสำคัญประจำวัน — ค้นหาว่าวันนี้มีวันสำคัญอะไร (ไทยหรือสากล) ที่เกี่ยวกับ CPR สุขภาพ หรือการแพทย์ เช่น 'วันหัวใจโลก', 'วันผู้บริจาคโลหิตโลก', 'วันพยาบาลสากล' ถ้าไม่มีวันสำคัญจริงให้ตั้งชื่อวันที่เหมาะกับเนื้อหาบทความนั้น เช่น 'วันรู้จัก AED', 'วันใส่ใจหัวใจ'",
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

ขั้นตอนที่ 1: ค้นหาว่าวันที่นี้มีวันสำคัญอะไร (ไทยหรือสากล) ที่เกี่ยวกับ CPR สุขภาพ หรือการแพทย์ ถ้าไม่มีให้ตั้งชื่อวันที่เหมาะกับเนื้อหา เช่น "วันรู้จัก AED" หรือ "วันใส่ใจหัวใจ"

ขั้นตอนที่ 2: เขียนบทความ "วันดีๆ" ประจำวันสำหรับเว็บไซต์ที่มีกลุ่มเป้าหมายเป็น: ${site.audience}
เนื้อหาความรู้ที่เกี่ยวกับ: ${site.topic}
สไตล์การเขียน: ${site.tone}
${site.examples}

กฎ:
- ความยาว 400-600 คำ
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

async function insertPost(article, siteSlug) {
  const bkkDateStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const nowISO = new Date().toISOString();

  const payload = {
    site_slug: siteSlug,
    title: article.title,
    meta_description: article.meta_description,
    content_html: article.content_html,
    category: article.category,
    cover_image_url: null,
    url_slug: `${bkkDateStr}-${slugify(article.title)}`,
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
    throw new Error(`[${siteSlug}] Supabase insert failed: ${res.status} ${body}`);
  }
}

async function main() {
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  for (const site of SITES) {
    try {
      console.log(`\n[${site.slug}] Generating...`);
      const article = await generateForSite(site, anthropic);
      console.log(`[${site.slug}] Title: ${article.title}`);
      await insertPost(article, site.slug);
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
