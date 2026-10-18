import { viewConversations } from './conversations.js';
import { viewDashboard } from './dashboard.js';
import { viewExpenses, viewPayments } from './finance.js';
import { viewLeads } from './leads.js';
import { viewProjects } from './projects.js';
import { viewProspects } from './prospects.js';
import { viewCatalog, viewCustomers } from './sales.js';
import { viewAudit, viewJobs, viewNotifications, viewSecurity, viewSettings, viewUsers } from './system.js';

export const VIEWS = {
  dashboard: viewDashboard,
  notifications: viewNotifications,
  conversations: viewConversations,
  leads: viewLeads,
  prospects: viewProspects,
  customers: viewCustomers,
  projects: viewProjects,
  catalog: viewCatalog,
  payments: viewPayments,
  expenses: viewExpenses,
  jobs: viewJobs,
  users: viewUsers,
  audit: viewAudit,
  security: viewSecurity,
  settings: viewSettings,
};
