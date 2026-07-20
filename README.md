# ASAP-NJ Website

Public website for **ASAP NJ Drone Services** (`https://asap-nj.com`).

## Stack

- **Hosting:** GitHub Pages (`docs/` folder on `main`)
- **Repo:** https://github.com/jerseyjers/ASAP-NJ
- **Gallery media:** Cloudflare R2
- **Contact form:** Formspree
- **Design:** Single-page multi-section static site (HTML/CSS/JS)

## Site sections

1. Hero + CTAs  
2. Trust badges (Airdata, FAA, Instagram)  
3. **Solar maintenance & thermal diagnostics** (flagship)  
4. Full services grid  
5. About / why us  
6. Work gallery (`gallery-data.json` + PhotoSwipe)  
7. Service area  
8. Contact form  

## Tools

| Tool | Who | Where |
|------|-----|--------|
| **Panel failure playground** | Customers (fun) | Site section `#playground` |
| **Field tools** | You on jobs | `docs/tools/` → `/tools/` (noindex, not in main nav) |

Field tools include: production loss estimator, string Voc helper, thermal flight checklist, field report builder.

## Do not launch marketing until

You’re comfortable running a solar thermal job with:

1. Flight checklist  
2. Loss estimate blurb for the client  
3. Same-day field report  

Then push the site live.

## Local preview

```powershell
cd docs
python -m http.server 8080
# open http://localhost:8080
```

Or open `docs/index.html` directly (gallery fetch needs a local server in some browsers).

## Deploy

```powershell
git add -A
git commit -m "Redesign site v3.0.0"
git push origin main
```

GitHub Pages serves from `/docs` on `main`. Custom domain: `asap-nj.com`.

## Version

See `version.json` and footer — currently **v3.0.0**.

Business owner: Gary Colyer / ASAP NJ Drone Services.
