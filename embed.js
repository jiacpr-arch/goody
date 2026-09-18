(function (global) {
  const SUPABASE_URL = 'https://tpoiyykbgsgnrdwzgzvn.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwb2l5eWtiZ3NnbnJkd3pnenZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NTUwMDIsImV4cCI6MjA5MDIzMTAwMn0.c7Ow_20mpmcDqDdMQ5qnsDV6-RKAO-7-eM1y-EsEXdA';
  const FULL_BASE = 'https://goody-bay.vercel.app';

  const FETCH_OPTS = {
    headers: {
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`,
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
    cache: 'no-store',
  };

  function todayBangkok() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  }

  async function getLatestPost(siteSlug, opts = {}) {
    const { strictToday = false } = opts;
    const url = `${SUPABASE_URL}/rest/v1/blog_posts?site_slug=eq.${encodeURIComponent(siteSlug)}&order=published_at.desc&limit=50&select=*`;
    const res = await fetch(url, FETCH_OPTS);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const today = todayBangkok();
    const todayPost = data.find(p =>
      Object.values(p).some(v => typeof v === 'string' && v.startsWith(today))
    );
    if (todayPost) return todayPost;
    return strictToday ? null : data[0];
  }

  async function getFullPost(siteSlug) {
    const url = `${SUPABASE_URL}/rest/v1/blog_posts?site_slug=eq.${encodeURIComponent(siteSlug)}&order=published_at.desc&limit=1&select=*`;
    const res = await fetch(url, FETCH_OPTS);
    const data = await res.json();
    return Array.isArray(data) && data[0] ? data[0] : null;
  }

  function fullUrl(siteSlug) {
    return `${FULL_BASE}/?site=${encodeURIComponent(siteSlug)}&full=1`;
  }

  function render(container, post, templateFn) {
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) return;
    el.innerHTML = post ? templateFn(post) : '';
  }

  global.Goody = { getLatestPost, getFullPost, fullUrl, render };
})(window);
