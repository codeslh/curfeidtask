import freelancer from './freelancer.js';
import mock from './mock.js';
import rss from './rss.js';

// Add new platform adapters here. Each exposes { name, label, fetchLeads(scope) }.
export const PLATFORMS = { mock, freelancer, rss };
