/**
 * Public lead ingest config (safe to expose — anon key can only INSERT web leads).
 * Fill supabaseUrl + supabaseAnonKey after running docs/crm/schema.sql + form-policies.sql
 * Until then: forms still email Formsubmit only.
 */
window.ASAP_LEAD = {
  // Always email you (keep this)
  formsubmitAjax: 'https://formsubmit.co/ajax/gary.colyer@asap-nj.com',
  notifyEmail: 'gary.colyer@asap-nj.com',

  // Optional cloud CRM inbox (Supabase free project)
  supabaseUrl: 'https://ojaxoiaqbtdnglgumtrw.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qYXhvaWFxYnRkbmdsZ3VtdHJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MDg3NzAsImV4cCI6MjEwMTE4NDc3MH0.pJGJ8vySfzPM7qwVw3iSLIhavmxaCKKk86XBe_6KJMk',

  // Table used for form intake (see form-policies.sql)
  inboxTable: 'web_leads_inbox'
};
