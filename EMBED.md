# คู่มือฝัง goody บนเว็บไซต์ของคุณเอง

มี 2 วิธี:

- **วิธี A — iframe** (แนะนำ ถ้าอยากได้หน้าตาเหมือน `goody-bay.vercel.app` เลย ไม่ต้องเขียน CSS) → ดู [Quick start](#quick-start--iframe-เหมือนเดิม)
- **วิธี B — JS SDK** (สำหรับคนที่อยากจัดสไตล์เองตามแบรนด์) → ดู [Custom styling](#custom-styling--js-sdk)

ข้อมูลอัปเดตอัตโนมัติทุกวัน (ระบบสร้างโพสต์ใหม่ตอน 06:00 น. เวลาไทย ผ่าน GitHub Actions)

---

## Quick start — iframe (เหมือนเดิม)

แค่วาง snippet นี้ในหน้าเว็บที่อยากให้ widget โผล่ ไม่ต้องเขียน CSS เพิ่ม:

### morroo.com (วันดี)

```html
<iframe id="goody-wandee"
  src="https://goody-bay.vercel.app/?site=jiacpr&type=wandee"
  style="width:100%;border:0;display:block"
  scrolling="no" loading="lazy"></iframe>
<script>
  window.addEventListener('message', (e) => {
    if (e.data?.source === 'goody' && e.data.height) {
      document.getElementById('goody-wandee').style.height = e.data.height + 'px';
    }
  });
</script>
```

### pharmru.com (ข่าวสุขภาพ)

```html
<iframe id="goody-health"
  src="https://goody-bay.vercel.app/?site=health&type=news"
  style="width:100%;border:0;display:block"
  scrolling="no" loading="lazy"></iframe>
<script>
  window.addEventListener('message', (e) => {
    if (e.data?.source === 'goody' && e.data.height) {
      document.getElementById('goody-health').style.height = e.data.height + 'px';
    }
  });
</script>
```

iframe จะส่ง `postMessage` ความสูงของเนื้อหากลับมา → script ฝั่ง parent ปรับขนาด iframe ให้พอดีอัตโนมัติ ไม่ต้อง scroll ภายใน

ถ้าหน้าเว็บมี Content Security Policy ต้อง allow `frame-src https://goody-bay.vercel.app`

---

## Custom styling — JS SDK

## API

```js
// คืนโพสต์ล่าสุด — ถ้ามีของวันนี้คืนของวันนี้, ถ้าไม่มีคืนโพสต์ล่าสุด
Goody.getLatestPost(siteSlug, { strictToday: false })
  // → Promise<post | null>

// คืนโพสต์ที่ใช้สำหรับหน้าบทความเต็ม
Goody.getFullPost(siteSlug)
  // → Promise<post | null>

// URL ของหน้าบทความเต็มบน goody-bay.vercel.app
Goody.fullUrl(siteSlug)
  // → string
```

## Schema ของ post

| field | ตัวอย่าง |
|---|---|
| `id` | `"abc-123"` |
| `title` | `"วันดีดี วันที่ 1 พฤษภาคม"` |
| `category` | `"วันมงคล"` |
| `cover_image_url` | `"https://.../cover.jpg"` |
| `content_html` | `"<p>...</p>"` (เนื้อบทความ HTML) |
| `published_at` | `"2026-05-01T06:00:00Z"` |
| `site_slug` | `"jiacpr"` หรือ `"health"` |

## site slug ที่มี

- `jiacpr` — โพสต์วันดี (สำหรับ morroo.com)
- `health` — ข่าวสุขภาพ (สำหรับ pharmru.com)

## ตัวอย่าง: morroo.com (วันดี)

```html
<div id="goody-wandee"></div>
<script src="https://goody-bay.vercel.app/embed.js"></script>
<script>
  Goody.getLatestPost('jiacpr').then(post => {
    if (!post) return;
    const date = new Date(post.published_at).toLocaleDateString('th-TH', { day:'numeric', month:'long' });
    document.getElementById('goody-wandee').innerHTML = `
      <a href="${Goody.fullUrl('jiacpr')}" class="morroo-card" target="_blank" rel="noopener">
        <img src="${post.cover_image_url}" alt="">
        <div class="morroo-card__body">
          <span class="morroo-card__badge">${post.category || 'วันดีดี'}</span>
          <span class="morroo-card__date">${date}</span>
          <h3 class="morroo-card__title">${post.title}</h3>
        </div>
      </a>`;
  });
</script>

<style>
  .morroo-card { display:block; border-radius:16px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,.08); text-decoration:none; color:inherit; }
  .morroo-card img { width:100%; height:200px; object-fit:cover; display:block; }
  .morroo-card__body { padding:16px; background:#fff; }
  .morroo-card__badge { display:inline-block; padding:4px 12px; background:#1B5E20; color:#fff; border-radius:999px; font-size:12px; font-weight:700; }
  .morroo-card__date { color:#888; font-size:12px; margin-left:8px; }
  .morroo-card__title { margin:8px 0 0; font-size:18px; line-height:1.4; }
</style>
```

## ตัวอย่าง: pharmru.com (ข่าวสุขภาพ)

```html
<div id="goody-health"></div>
<script src="https://goody-bay.vercel.app/embed.js"></script>
<script>
  Goody.getLatestPost('health').then(post => {
    if (!post) return;
    const date = new Date(post.published_at).toLocaleDateString('th-TH', { day:'numeric', month:'long' });
    document.getElementById('goody-health').innerHTML = `
      <a href="${Goody.fullUrl('health')}" class="pharmru-news" target="_blank" rel="noopener">
        <img src="${post.cover_image_url}" alt="">
        <div class="pharmru-news__body">
          <span class="pharmru-news__tag">${post.category || 'ข่าวสุขภาพ'}</span>
          <h3 class="pharmru-news__title">${post.title}</h3>
          <time>${date}</time>
        </div>
      </a>`;
  });
</script>

<style>
  /* pharmru.com ใส่ CSS ตามสไตล์แบรนด์ของตัวเองได้เลย */
  .pharmru-news { /* ... */ }
</style>
```

## ข้อมูลอัปเดตอัตโนมัติ

- ระบบรัน GitHub Actions ทุกวัน 06:00 น. (เวลาไทย) สร้างโพสต์ใหม่ลง Supabase
- เว็บที่ฝัง widget ดึงข้อมูลแบบ `Cache-Control: no-cache` ดังนั้นจะได้โพสต์ใหม่ทันทีเมื่อ user เปิดหน้าเว็บ
- ถ้าวันไหนระบบยังไม่ได้สร้างโพสต์ของวันนั้น `getLatestPost` จะคืนโพสต์ล่าสุดที่มี (fallback) เพื่อไม่ให้หน้าเว็บว่าง
- ถ้าต้องการให้ว่างเมื่อไม่มีของวันนี้ ใช้ `Goody.getLatestPost(slug, { strictToday: true })`
