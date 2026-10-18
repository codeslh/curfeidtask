import { viewConversations } from './conversations.js';
import { viewCustomers } from './customers.js';
import { viewDashboard } from './dashboard.js';
import { viewLeads, viewVacancies } from './leads.js';
import { viewProspects } from './prospects.js';
import { viewSources } from './sources.js';
import { viewAudit, viewJobs, viewNotifications, viewSecurity, viewSettings, viewUsers } from './system.js';

export const VIEWS = {
  dashboard: viewDashboard,
  notifications: viewNotifications,
  leads: viewLeads,
  vacancies: viewVacancies,
  prospects: viewProspects,
  sources: viewSources,
  conversations: viewConversations,
  customers: viewCustomers,
  jobs: viewJobs,
  users: viewUsers,
  audit: viewAudit,
  security: viewSecurity,
  settings: viewSettings,
};
