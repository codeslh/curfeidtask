// Generic RSS/Atom adapter: any job board that publishes a feed (configured in settings.scanner.rss_feeds).
const decode = (s = '') => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};

export function parseFeed(xml) {
  const items = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  return items.map((item) => {
    const link = decode(tag(item, 'link')) || (item.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
    const description = decode(tag(item, 'description') || tag(item, 'summary') || tag(item, 'content'));
    const budget = description.match(/(?:budget|bütçe)[^0-9$€₺]*([$€₺])?\s?([\d.,]+)/i);
    return {
      external_id: decode(tag(item, 'guid') || tag(item, 'id')) || link,
      title: decode(tag(item, 'title')),
      description,
      budget_min: null,
      budget_max: budget ? Number(budget[2].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')) : null,
      currency: budget?.[1] === '$' ? 'USD' : budget?.[1] === '€' ? 'EUR' : budget?.[1] === '₺' ? 'TRY' : null,
      url: link,
      skills: [],
      client_name: decode(tag(item, 'author') || tag(item, 'dc:creator')) || null,
      posted_at: decode(tag(item, 'pubDate') || tag(item, 'published') || tag(item, 'updated')) || null,
    };
  });
}

export default {
  name: 'rss',
  label: 'RSS beslemeleri',
  async fetchLeads(scope) {
    const out = [];
    for (const feed of scope.rss_feeds || []) {
      const res = await fetch(feed.url);
      if (!res.ok) throw new Error(`${feed.name || feed.url}: ${res.status}`);
      for (const lead of parseFeed(await res.text())) out.push({ ...lead, external_id: `${feed.name || feed.url}:${lead.external_id}` });
    }
    return out;
  },
};
