# ASAP-NJ Website

Public website for **ASAP NJ Drone Services** (`https://asap-nj.com`).

## Stack

- **Hosting:** GitHub Pages (`docs/` on `main`)
- **Repo:** https://github.com/jerseyjers/ASAP-NJ
- **Contact:** Formspree
- **Client portal:** `/client/` (demo now; Supabase + Stripe for live reports/payments)
- **Field tools:** `/tools/` (internal)

## Client portal

| URL | Purpose |
|-----|---------|
| https://asap-nj.com/client/ | Login |
| https://asap-nj.com/client/dashboard.html | Reports + pay |

**Demo login:** any email + password `demo`  

Setup for real auth/files/payments: `docs/client/SETUP.md`

## Deploy

```powershell
cd C:\Users\ASAPNJDSlaptop\Documents\ASAP-NJ-website
git add -A
git commit -m "Update site"
git push origin main
```

Business owner: Gary Colyer / ASAP NJ Drone Services.
