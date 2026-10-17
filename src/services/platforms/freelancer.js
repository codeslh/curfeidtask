// Freelancer.com public projects API (read-only, no auth needed for active project search).
// Contacting the client requires bidding on the platform, so these leads go to the admin.
export default {
  name: 'freelancer',
  label: 'Freelancer.com',
  async fetchLeads(scope) {
    const query = (scope.keywords || []).join(' ');
    const url = new URL('https://www.freelancer.com/api/projects/0.1/projects/active/');
    if (query) url.searchParams.set('query', query);
    url.searchParams.set('limit', String(scope.max_leads_per_scan || 20));
    url.searchParams.set('full_description', 'true');
    url.searchParams.set('job_details', 'true');
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Freelancer.com ${res.status}`);
    const data = await res.json();
    return (data.result?.projects || []).map((p) => ({
      external_id: String(p.id),
      title: p.title,
      description: p.description || p.preview_description || '',
      budget_min: p.budget?.minimum ?? null,
      budget_max: p.budget?.maximum ?? null,
      currency: p.currency?.code || null,
      url: `https://www.freelancer.com/projects/${p.seo_url}`,
      skills: (p.jobs || []).map((j) => j.name),
      client_name: null,
      posted_at: p.time_submitted ? new Date(p.time_submitted * 1000).toISOString() : null,
    }));
  },
};
