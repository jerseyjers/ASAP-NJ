/**
 * ASAP-NJ RTK seat billing only (public).
 * Company-wide job payments (Claim Day, thermal, deposits) use client/config.js + client portal.
 * Paste Stripe Payment Links from https://dashboard.stripe.com/payment-links
 * Leave empty until live — buttons send people to free seat signup first.
 */
window.ASAP_RTK_BILLING = {
  // Free starter (auto seat = hobby tier)
  hobby: {
    name: 'Free starter',
    priceLabel: 'Free',
    blurb: 'Try the local stream near Toms River. Fair-use daily limits.',
    minutesDay: 120,
    sessions: 1,
  },

  // Paid pro — set stripeUrl when Payment Link is ready
  proMonthly: {
    name: 'Pro monthly',
    priceLabel: '$49 / month',
    blurb: 'Workday use for survey, layout, and RTK aircraft. Same login, higher limits.',
    stripeUrl: 'https://buy.stripe.com/bJe00k8xUdX9cIu1ZV1Nu01',
    successNote: 'After pay, we flip your seat to Pro (usually same day). Keep your existing username/password.',
  },

  // Optional project week
  proWeek: {
    name: 'Pro week pass',
    priceLabel: '$29 / week',
    blurb: 'Heavy project week without a monthly commitment.',
    stripeUrl: 'https://buy.stripe.com/14A28sdSe7yLcIu5c71Nu02',
    successNote: 'After pay, reply with your NTRIP username — we enable Pro for 7 days.',
  },

  // Extras (owner archive / RINEX) — not on free seats
  extraData: {
    name: 'Base data pack',
    priceLabel: 'Quoted',
    blurb: 'RINEX / archived corrections for a date range — separate from live stream.',
    stripeUrl: '',
    contactOnly: true,
  },

  contactEmail: 'gary.colyer@asap-nj.com',
  setupUrl: 'rtk-setup.html',
};
