# Client portal setup (reports + payments)

The portal lives at **`https://asap-nj.com/client/`**.

## What clients get

1. **Login** — private access  
2. **Reports list** — inspection packages, status, dates  
3. **Download** — PDF / photo package links when you attach them  
4. **Pay** — Stripe Payment Link (deposit or balance)  
5. **Request access** — form hits your Formspree inbox  

## Demo mode (works now)

`config.js` → `useDemo: true`

- Any email + password **`demo`**
- Sample reports + pay buttons (pay needs a real Stripe link)

Perfect to click through and look pro. Flip off when Supabase is ready.

---

## Go live in two layers

### A) Payments only (fastest — do this first)

1. Create a free [Stripe](https://dashboard.stripe.com) account  
2. **Payment Links** → create “Inspection deposit” or “Invoice balance”  
3. Paste URL into `config.js`:

```js
stripePaymentLink: 'https://buy.stripe.com/your_link',
```

4. Optional: enable [Customer Portal](https://dashboard.stripe.com/settings/billing/portal) and paste:

```js
stripeCustomerPortalLink: 'https://billing.stripe.com/p/login/...',
```

5. Push site. Clients can pay even while reports are still emailed manually.

### B) Real logins + report files (Supabase)

1. Create project at [supabase.com](https://supabase.com)  
2. **Authentication** → enable Email provider  
3. **SQL** → run `supabase-schema.sql` in this folder  
4. **Storage** → bucket `client-reports` (private)  
5. Put keys in `config.js`:

```js
useDemo: false,
supabaseUrl: 'https://XXXX.supabase.co',
supabaseAnonKey: 'eyJ...',
supportEmail: 'you@yourdomain.com',
```

6. Create a client user in Supabase Auth (or invite by email)  
7. Insert a row in `client_reports` with their `user_id` and optional `file_url` (signed URL or public report host)  
8. Set `payment_link` per invoice if different from the default Stripe link  

### RLS (security)

The schema enables row-level security so clients **only see their own rows**. Never put the service role key in the website.

---

## Your job workflow (when you book a client)

1. Do the flight / write the report (field tools help)  
2. Upload PDF to Storage (or Google Drive with share link)  
3. Create/login for client in Supabase  
4. Insert `client_reports` row + amount_due + payment_link  
5. Email client: “Portal: https://asap-nj.com/client/ — check your email for password reset if needed”  
6. Client pays via Stripe → you mark `amount_due = 0` (or automate later with Stripe webhooks)

---

## Not included yet (later upgrades)

- Automatic “paid → unlock PDF” via Stripe webhook  
- Magic-link only login (no password)  
- Your admin UI to upload reports (for now: Supabase dashboard is the admin UI)  

We can wire those when the first real paid job lands.
