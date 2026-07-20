# ASAP Field Tools (internal)

**URL (when site is live):** `https://asap-nj.com/tools/`  
**Local:** open `docs/tools/index.html` via the same local server as the main site (`http://localhost:8080/tools/`)

These tools back up what the marketing site advertises so jobs feel professional:

| Tab | Purpose |
|-----|---------|
| **Loss estimator** | Failed modules / offline strings → kWh + $ blurb for clients |
| **String helper** | Cold Voc sanity check vs inverter max |
| **Flight checklist** | Pre/post solar thermal flight quality control |
| **Field report** | Same-day write-up template (copy to email/PDF) |

## Privacy

- `noindex` meta tag (search engines asked not to list it)
- **Not linked** from the public homepage nav
- Still publicly reachable if someone guesses `/tools/` — don’t put secrets here
- Checklist + loss inputs can save to **browser localStorage** only

## Not a substitute for

- Radiometric thermal software / FLIR etc.
- Licensed electrical work
- Utility-grade production guarantees

## Next upgrades (later)

- Import thermal CSV / module map
- Optimizer vs string-inverter loss models
- Photo attach + PDF export
- Password gate if you want it private on the open web
