/**
 * ASAP NJ Client Portal — configuration
 *
 * BILLING MODEL (important):
 *   - Flight jobs (claim, solar, thermal, mapping, HOA) = ALWAYS QUOTED.
 *     Never a fixed “standard day” checkout as the default.
 *   - After you quote: Stripe Invoice for exact $  OR  a one-off Payment Link
 *     stored on that job as payment_link (per report).
 *   - RTK Pro monthly/week = fixed prices on main site only (js/rtk-billing.js).
 *
 * DEMO MODE: any email + password  demo
 * LIVE: set useDemo false + Supabase auth when ready.
 */
window.ASAP_PORTAL = {
  useDemo: true,

  siteName: 'ASAP NJ Drone Services',
  siteUrl: 'https://asap-nj.com',
  supportEmail: 'gary.colyer@asap-nj.com',

  /**
   * Default job Payment Link — leave EMPTY.
   * Do not put Claim Day $349 (or any fixed package) here as a global “pay your bill” button.
   * That underprices real jobs and overcharges others.
   *
   * Per-job only: set payment_link on each report/invoice to a Stripe Invoice URL
   * or a one-off Payment Link created for THAT quoted amount.
   */
  stripePaymentLink: '',

  // Optional customer portal (saved cards / history) — not required
  stripeCustomerPortalLink: '',

  supabaseUrl: 'https://ojaxoiaqbtdnglgumtrw.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qYXhvaWFxYnRkbmdsZ3VtdHJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MDg3NzAsImV4cCI6MjEwMTE4NDc3MH0.pJGJ8vySfzPM7qwVw3iSLIhavmxaCKKk86XBe_6KJMk',

  formspreeAccess: 'https://formsubmit.co/gary.colyer@asap-nj.com'
};
