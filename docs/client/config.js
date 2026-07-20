/**
 * ASAP NJ Client Portal — configuration
 *
 * DEMO MODE (default): works now with no accounts.
 *   Login: any email + password  demo
 *   Or:    client@demo.asap-nj.com / demo
 *
 * LIVE MODE: fill Supabase + Stripe below, set useDemo = false.
 *   See SETUP.md in this folder.
 */
window.ASAP_PORTAL = {
  useDemo: true,

  // Public site
  siteName: 'ASAP NJ Drone Services',
  siteUrl: 'https://asap-nj.com',
  supportEmail: 'hello@asap-nj.com', // change to your real inbox

  // Stripe Payment Link (create at https://dashboard.stripe.com/payment-links)
  // Used as default "Pay balance" button when a report has no custom link.
  stripePaymentLink: '', // e.g. 'https://buy.stripe.com/xxxxx'

  // Optional: Stripe Customer Portal (billing history / saved cards)
  // https://dashboard.stripe.com/settings/billing/portal
  stripeCustomerPortalLink: '',

  // Supabase project (Auth + database + storage for report PDFs)
  // https://supabase.com — free tier is fine to start
  supabaseUrl: '',
  supabaseAnonKey: '',

  // Formspree (request access / forgot password fallback)
  formspreeAccess: 'https://formspree.io/f/xldpaodl'
};
