/**
 * ASAP NJ — company-wide billing notes (public, safe).
 * Stripe Payment Links / portal URLs live in:
 *   - client/config.js  (job invoices, portal pay)
 *   - js/rtk-billing.js (RTK Pro seats)
 */
window.ASAP_COMPANY_BILLING = {
  company: 'ASAP NJ Drone Services',
  supportEmail: 'gary.colyer@asap-nj.com',
  // What Stripe is for (whole business)
  accepts: [
    'Inspection packages (claim, solar thermal, roof/HVAC, mapping)',
    'Job deposits and remaining balances via client portal',
    'RTK Pro monthly seats and week passes',
    'Quoted on-site RTK and base data / RINEX packs',
  ],
  clientPortal: '/client/',
  rtkPlans: '/#rtk-plans',
};
