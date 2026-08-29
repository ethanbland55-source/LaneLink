# Meal Hub

Three screens:

- **`/` — Today.** Daily target header, a live macro counter, one tap per meal to log
  it pre-filled from your plan, editable gram amounts, then Confirm. Arrows step back
  through previous days.
- **`/plan` — Plan & Settings.** Your body stats and goal (which calculate the targets),
  your training week, and your meal plan: meals → ingredients → per-100g macros.
- **`/shop` — Shopping list.** The plan played forward over however many days you buy
  for, totalled up, rounded to real pack sizes and grouped by aisle.

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
   `ensureSchema`), and so do any new columns a later version adds. `schema.sql` is the
   same DDL if you'd rather run it by hand in the Neon SQL editor.

Local dev: copy `.env.example` to `.env.local`, fill in `DATABASE_URL`, then
`npm install && npm run dev`.

## How the numbers work

- **BMR** — Katch-McArdle (`370 + 21.6 × lean kg`) when you've entered a body fat
  percentage, because it works off the tissue that actually burns the calories.
  Without one it falls back to Mifflin-St Jeor:
  `10×kg + 6.25×cm − 5×age (+5 male / −161 female)`.
- **Maintenance (TDEE)** — BMR × your activity multiplier.
- **Target** — maintenance −20% cutting, +12% bulking, or unchanged maintaining.
  You can also type a manual kcal figure, which is then used as your weekly average.
- **Protein** — g/kg bodyweight, fixed; this is the one you don't move.
- **Fat** — g/kg, default 0.7.
- **Carbs** — every calorie left over, at 4 kcal/g, with a floor you set in g/kg.
  If a low day would push carbs through that floor, fat gives way instead, down to a
  hard 0.45 g/kg.
- **Fibre** — 14 g per 1000 kcal by default, minimum 25 g.

### The training week

A swim week isn't flat, so each weekday can be labelled **rest / easy / session /
double**, and each type gets its own calorie number. Protein and fat stay put and the
difference lands almost entirely on carbohydrate, which is where you want it.

The percentages are **normalised across the week**: whatever spread you set, the
seven-day average still comes out at exactly your goal figure. Eating 340 kcal more on
a Saturday double doesn't quietly turn a maintenance phase into a surplus — it borrows
from Sunday. The Plan page shows each day type's number as you drag the sliders, and
Today lets you switch a single day if the session got cancelled.

## Recalculate portions

When the plan drifts far enough off target to actually change your results —
100 kcal, 10 g protein, 25 g carbs or 12 g fat — the **Recalculate portions**
button lights up. It re-solves every gram amount in the plan at once so the macros
land on target.

**What it knows about food.** Every ingredient is classified — by name against a
dictionary of the things people actually eat, and by macro density for anything the
dictionary hasn't heard of. The class decides how far a portion may move, and that is a
much better guess than one blanket percentage:

| | may move | why |
| --- | --- | --- |
| Olive oil, butter | −25% / +20% | 9 kcal a gram; small changes are big changes |
| Chicken, fish | −30% / +45% | a portion is a portion |
| Rice, pasta, oats | −35% / +60% | the flexible middle |
| Broccoli, spinach | −50% / +160% | eat as much as you like |
| Eggs, bagels, scoops | whole units | you can't have 1.4 eggs |

Energy density tightens the band further, so a 600 kcal/100g nut butter gets less
freedom than the class default. You can still override any limit by hand, and **lock**
anything that shouldn't move at all — your numbers always win over the app's.

**How it solves.** A bounded least-squares fit with asymmetric penalties (missing
protein low is worse than overshooting it; going over calories is worse than going
under), solved by **exact coordinate descent from several starting points** — for a
fixed set of other portions the cost is a one-dimensional convex function of each
portion, so each one can be solved to its true optimum rather than nudged toward it.
Then a discrete pass snaps everything to weighable amounts and wins back what that
cost, using **pairwise moves** — one portion up, another down — because that's the
plateau single-portion tweaks get stuck on.

Two quieter terms sit far below the macro weights and act only as tie-breakers: an
**anchor** so that among equally accurate answers it picks the one that looks most like
the plan you wrote, and a **fibre floor**.

**Four priorities**, because "closest" depends on what you're doing: *Balanced*,
*Protein first*, *Calories exact* (chosen automatically when you've set a manual kcal
figure) and *Most food*, which breaks ties toward the more filling plan.

**When it can't get there** it says so and shows the way out: which limit is in the
way, and a one-tap button to widen exactly that one to exactly the figure that would
close the gap. No quietly serving you an unrealistic plate.

### Is it actually better?

`bench/compare.ts` runs both solvers over 400 randomised but realistic plans, against
targets constructed to be genuinely reachable within each plan's own limits — so any
error is the solver's, not the plan's.

```
                            old      new
mean macro error           0.85%    0.42%
worst macro error         18.38%    3.96%
mean calorie miss         9.4 kcal 4.6 kcal
mean protein shortfall     0.43 g   0.13 g
```

Run it yourself with `npx tsx bench/compare.ts`. A solve takes about 6 ms for a
16-ingredient day, which is why the preview re-fits live as you drag a limit.

(`bench/compare.ts --snapped` is the table above. Without the flag it aims at targets
that fall between whole eggs and whole scoops, where the new solver scores *worse* on
paper — it refuses to answer "1.4 eggs". That's the trade, and it's the right one.)

## Meal prep guide

Macros don't tell you whether a day will actually fill you up. Energy density does:
under about 150 kcal per 100 g of food on the plate and you'll finish the day full,
over 250 and you'll be hungry on the same calories.

So the **Meal prep** tab converts the plan into what you'll be looking at — cooked
weight (100 g of dry oats is 320 g of porridge; 200 g of raw chicken is 146 g cooked),
plate volume, whole-unit counts, and a verdict per meal. When there are calories spare
but not much food, it suggests the fillers that add the most bulk for the fewest
calories and adds them straight into a meal, re-fitting around them.

## Shopping list

Set how many days you're buying for — 3, 5, 7, 10, whatever — and it plays the plan
forward day by day from your shop day and totals every ingredient.

- **Day types are respected.** A double day needs more food than a rest day, so each
  day in the window is scaled by that day's own multiplier rather than assuming seven
  identical days. Meals restricted to certain day types only count on those days.
- **You buy packets, not grams.** 1,400 g of chicken is five 300 g packs; 735 g of
  banana is seven bananas. Amounts round up to real pack sizes and the leftover is
  shown.
- **Fresh food gets flagged.** Anything whose shelf life is shorter than your window
  says so, with how much to buy now and how much later — or to freeze.
- **Cupboard staples get demoted.** If you need 70 g of olive oil out of a 500 ml
  bottle, it's a "check you have it", not a purchase.
- **What you already have comes off first.** Tap *I already have some* on any line and
  it's subtracted from what you need to buy, and remembered.
- Tick things off as you go — the ticks are saved server-side, so the phone in the shop
  and the laptop at home agree. *New shop* clears them. There's a copy-to-clipboard
  export and a print stylesheet.

## Notes

- Ingredient macros are entered **per 100 g** (the way food labels print them) and
  stored that way, which is what lets the Today page rescale correctly when you change
  a gram amount. A row whose 4/4/9 arithmetic doesn't reconstruct its own calorie
  figure gets flagged, because every number downstream inherits that typo.
- Fibre values on ingredients entered before the app tracked fibre are seeded from the
  type of food and marked as estimates (dashed box) — worth correcting from the packet
  when you next touch that row.
- Only **confirmed** meals count toward the counter — added-but-unconfirmed meals are
  drafts you can still adjust.
- Weigh food raw where you can, and be consistent about it. Per-100g values off the
  packet are far more accurate than AI-estimated macros, which is the whole point of
  entering them yourself.
- Judge a phase on the trend over 3–4 weeks. Day-to-day weight swings from water and
  glycogen easily hide 0.25 kg/week of real change, and they swing hardest in a heavy
  training week.
- No login. The site is public, and anyone with the URL sees the same single profile.
