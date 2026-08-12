# Meal Hub

Two screens:

- **`/` — Today.** Daily target header, a live macro counter, one tap per meal to log
  it pre-filled from your plan, editable gram amounts, then Confirm.
- **`/plan` — Plan & Settings.** Your body stats + goal (which calculate the targets),
  and your meal plan: meals → ingredients → per-100g macros.

The logging day rolls over at **03:00 local time**, so a late-night meal still counts
toward the day you'd call it.

## Deploy

1. Push this folder to a GitHub repo.
2. Import it in Vercel (framework auto-detects as Next.js).
3. Add one environment variable, for **Production, Preview and Development**:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | your Neon **pooled** connection string |

   That's the string in Neon's "Connect to your database" dialog with
   *Connection pooling* toggled on — click **Show password** first so you copy the
   real password, not the asterisks.
4. Deploy. The tables create themselves on first page load (`lib/db.ts` →
   `ensureSchema`). `schema.sql` is the same DDL if you'd rather run it by hand in
   the Neon SQL editor.

Local dev: copy `.env.example` to `.env.local`, fill in `DATABASE_URL`, then
`npm install && npm run dev`.

## How the numbers work

- **BMR** — Mifflin-St Jeor, the default formula behind calculator.net's BMR calculator:
  `10×kg + 6.25×cm − 5×age (+5 male / −161 female)`.
- **Maintenance (TDEE)** — BMR × your activity multiplier.
- **Target** — maintenance −20% cutting, +12% bulking, or unchanged maintaining.
  You can also type a manual kcal override.
- **Protein** — 2 g/kg bodyweight (fixed; this is the one you don't move).
- **Fat** — 0.6–0.8 g/kg (default 0.7).
- **Carbs** — every calorie left over, at 4 kcal/g.

The Plan page shows your meal plan's total against the target, so you can see at a
glance whether the plan actually hits the number.

Two things worth knowing about your current situation: 2.5 weeks is a short window —
day-to-day weight swings from water and glycogen easily hide 0.25 kg/week of real fat
loss, so judge it on the trend over 3–4 weeks. And per-100g values off the packet are
far more accurate than AI-estimated macros, which is what this app is for. Weigh food
raw where you can, and be consistent about it.

## Notes

- Ingredient macros are entered **per 100 g** (the way food labels print them) and
  stored that way, which is what lets the Today page rescale correctly when you change
  a gram amount.
- Only **confirmed** meals count toward the counter — added-but-unconfirmed meals are
  drafts you can still adjust.
- No login. The site is public, and anyone with the URL sees the same single profile.
