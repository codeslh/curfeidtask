// Demo adapter: produces sample leads so the whole flow can be tried without real platform access.
const SAMPLES = [
  { title: 'Kafe için tanıtım web sitesi', description: 'Kafemiz için menü ve iletişim sayfası olan modern bir website istiyoruz. Bütçe esnek. İletişim: kafe@example.com', budget: [5000, 12000], skills: ['HTML', 'CSS'] },
  { title: 'E-ticaret landing page tasarımı', description: 'Yeni ürünümüz için tek sayfalık landing page. WhatsApp: +905551112233', budget: [3000, 6000], skills: ['Landing page'] },
  { title: 'Kripto bot geliştirme', description: 'Telegram kripto al-sat botu.', budget: [20000, 40000], skills: ['Python'] },
  { title: 'Avukatlık bürosu website', description: 'Kurumsal website, blog bölümü olmalı.', budget: [8000, 15000], skills: ['WordPress', 'PHP'] },
];

export default {
  name: 'mock',
  label: 'Demo (örnek ilanlar)',
  async fetchLeads() {
    const hour = new Date().toISOString().slice(0, 13);
    return SAMPLES.map((s, i) => ({
      external_id: `${hour}-${i}`,
      title: s.title,
      description: s.description,
      budget_min: s.budget[0],
      budget_max: s.budget[1],
      currency: 'TRY',
      url: `https://example.com/jobs/${i}`,
      skills: s.skills,
      client_name: `Demo Müşteri ${i + 1}`,
      posted_at: new Date().toISOString(),
    }));
  },
};
