/**
 * ASAP-NJ Boss desk — owner config
 * Login: company email + password you set on first visit.
 * Optional: after first setup, run Set-BossPassword.ps1 on Mini and deploy
 * so the same password works on every device.
 */
window.ASAP_BOSS = {
  siteName: 'ASAP NJ Boss Desk',

  // Only these emails may use the boss desk
  allowedEmails: [
    'gary.colyer@asap-nj.com'
  ],

  // Leave empty for first-time password setup in the browser.
  // After setup, Publish/Set-BossPassword can fill boss/data/auth.json instead.
  passwordHash: '',

  sessionHours: 12,

  // Deep link into your Cloudflare Web Analytics overview
  cloudflareAnalyticsUrl: 'https://dash.cloudflare.com/31ce13419cdeed772566d5a7156faaf3/asap-nj.com/analytics/web/overview',
  formspreeUrl: 'https://formsubmit.co/gary.colyer@asap-nj.com',
  statsUrl: 'data/stats.json',
  authUrl: 'data/auth.json',

  rtkPublicHost: 'rtk.asap-nj.com',
  rtkPublicIp: '67.205.128.14',
  rtkPort: 2101,
  rtkMount: 'ASAP-NJ',

  // ASAP CRM (Week 1: leads + pipeline + contacts)
  // local = this browser only; supabase keys enable "Pull web leads" from form inbox.
  // CRM rows still save in localStorage until crmMode is 'supabase' + full schema.sql.
  crmEnabled: true,
  crmMode: 'local', // 'local' | 'supabase'
  supabaseUrl: 'https://ojaxoiaqbtdnglgumtrw.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qYXhvaWFxYnRkbmdsZ3VtdHJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MDg3NzAsImV4cCI6MjEwMTE4NDc3MH0.pJGJ8vySfzPM7qwVw3iSLIhavmxaCKKk86XBe_6KJMk',
  crmOwnerEmail: 'gary.colyer@asap-nj.com'
};
