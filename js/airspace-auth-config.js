/**
 * Airspace free-account gate
 * Google button shows always; it only redirects to Google when Supabase
 * has Google provider enabled (auto-detected from /auth/v1/settings).
 */
window.ASAP_AIRSPACE_AUTH = {
  formsubmitAjax: 'https://formsubmit.co/ajax/gary.colyer@asap-nj.com',
  notifyEmail: 'gary.colyer@asap-nj.com',

  supabaseUrl: 'https://ojaxoiaqbtdnglgumtrw.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qYXhvaWFxYnRkbmdsZ3VtdHJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MDg3NzAsImV4cCI6MjEwMTE4NDc3MH0.pJGJ8vySfzPM7qwVw3iSLIhavmxaCKKk86XBe_6KJMk',

  // Prefer these when auto-detect fails
  oauth: {
    google: true,   // show Google — live redirect only if Supabase has it enabled
    apple: false,
    azure: false
  },

  googleClientId: '',
  siteUrl: 'https://asap-nj.com',
  sessionKey: 'asap_airspace_user_v1',
  accountsKey: 'asap_airspace_accounts_v1'
};
