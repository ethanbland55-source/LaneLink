# Meal Hub

Three screens:

- **`/` — Today.** Daily target header, a live macro counter, one tap per meal to log
  it pre-filled from your plan, editable gram amounts, then Confirm. Arrows step back
  through previous days.
- **`/plan` — Plan & Settings.** Your body stats and goal (which calculate the targets),
  your week and the day types that make it up, and your meal plan: meals → ingredients
  → per-100g macros.
- **`/shop` — Shopping list.** The plan played forward over however many days you buy
  for, totalled up, rounded to real pack sizes and grouped by aisle.
- **`/progress` — Weight, waist and calibration.** The trend rather than the number,
  what the two measurements say together, and what your own data says your
  maintenance actually is.

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
- **A day's energy** — a baseline for everything that isn't training
  (BMR × a modest multiplier: sitting, walking about, lectures) plus the cost of
  the sessions you actually did that day. **Maintenance** is the average of those
  across your week.
- **Target** — set by the block you're in (below). You can also type a manual kcal
  figure, which is then used as your weekly average.
- **Protein** — g/kg, fixed; this is the one you don't move. Scaled by bodyweight, or
  by lean mass if you've entered a body fat percentage.
- **Fat** — g/kg, default 0.7.
- **Carbs** — every calorie left over, at 4 kcal/g, with a floor you set in g/kg.
  If a low day would push carbs through that floor, fat gives way instead, down to a
  hard 0.45 g/kg.
- **Fibre** — 14 g per 1000 kcal by default, minimum 25 g.

### Your week

A week isn't flat, and it isn't four fixed shapes either. You describe the kinds of day
you have — **day types** — and each one is just a name and a list of sessions:

| | |
| --- | --- |
| Rest | nothing |
| Gym only | gym 60 min — the pool's shut |
| Swim only | swim 90 min |
| Swim + gym | swim 90 min + gym 45 min |
| Double swim | swim 90 min + swim 75 min |

Those are the ones a new account starts with. Rename them, add sessions, delete the
ones you don't use, add "Meet day" or "Bike commute" — nothing in the app cares what
they're called. Then map each weekday to one, and Today lets you switch a single day
when a session gets cancelled without touching the week.

**Meals belong to day types.** Any meal can be limited to the day types it appears on,
so the pre-swim carb top-up simply isn't there on a rest day — on Today it isn't
offered, on the Plan page it's dimmed, and the shopping list only counts it on the days
it's actually eaten.

**Sessions decide the calories.** Each session is an activity at an intensity for a
number of minutes, costed with MET values from the Compendium of Physical Activities,
**net of resting metabolism** — the standard `MET × 3.5 × kg / 200` formula is a gross
figure that includes the calories you'd have burned sitting still for that hour, and
your baseline already counts those. Subtracting the 1 MET you'd have spent anyway is
worth about 90 kcal on a two-hour training day, in the direction that stops the number
flattering you.

**And the week still balances.** Whatever spread the sessions produce, every day is
scaled by a single factor chosen so the seven mapped days average out to exactly your
goal. Eating 900 kcal more on a Saturday double doesn't quietly turn a maintenance
phase into a surplus — it borrows from Sunday. Pin any day type to a fixed number and
it drops out of the balancing while the rest still make the week add up.

MET values are population averages, not measurements of you. Treat the result as a
starting point and adjust the baseline multiplier once you've watched your weight for
three or four weeks.

An existing database keeps its old flat-multiplier numbers until you press
**Switch to session-based energy** on the Plan page, so upgrading never silently moves
your targets.

## Blocks, and toned maintenance

A goal isn't a percentage, it's a shape over time. A **block** has a name, a start, a
length in weeks, and a target that can move from one figure to another across it.

**Toned maintenance** is the interesting one. Recomposition — losing fat and gaining
muscle at the same time — is well documented in trained people, and the levers that
decide whether it happens are protein, training, and an energy balance somewhere near
zero rather than a large deficit. So the block:

- **starts level with maintenance** and drifts to about −8% by the end, so nothing
  about training suffers while you settle in and the deficit arrives slowly enough that
  the scale barely reacts,
- **puts protein on lean mass** — 2.8 g/kg of fat-free mass, mid-range of the
  2.6–3.5 g/kg FFM the recomposition literature points at, which for 78 kg at 14% works
  out around 188 g, or 2.4 g/kg of bodyweight. Without a body fat figure it *converts*
  using a plausible one rather than falling back — applying a per-lean-mass number to
  scale weight would silently add about 15% (218 g instead of 179 g) — and the result is
  clamped either way so a mistyped percentage can't ask you to eat 400 g,
- **holds protein and fat flat on a rest day** and lets carbohydrate absorb the whole
  swing, with a floor under carbs and a hard 0.45 g/kg floor under fat. If the carb
  floor ever squeezes fat below 0.6 g/kg the Plan page says so, because a long block on
  very low fat isn't worth the calories it saves.

The drift composes with everything else: day types still set the shape of the week,
the week still averages exactly on the block's target for today, and the shopping list
still buys the plan you actually eat.

Cutting, maintaining and bulking are the same machinery with the start and end set
equal. Any of them can be given a ramp if you want one.

## Batch cooking

If you cook every lunch and dinner for the week on a Sunday, the usual assumption —
that each ingredient's portion is yours to adjust — is simply false. Once it's a tray in
the fridge you can't serve 12% more chicken on Saturday. You can only serve more *tray*.

So mark a meal **Cooked ahead** and it's modelled as what it physically is: **one
ingredient, served by weight**. Its per-100g macros are the weighted average of what
went in, its portion is how much goes on the plate, and the components come back out
afterwards in exactly the ratio they were cooked in. In the optimiser a four-ingredient
batch is one variable instead of four, which is both faster and the only honest
constraint — the fit can make Saturday's plate bigger without pretending you picked the
chicken out of it. Lock anything inside a batch and the whole serving pins, which is the
right reading of "this much chicken, no more".

The **cook list** on the Shop page then turns the week into a session at the hob: what
to cook, in raw weights, with the cooked weight beside it so you know what has to fit in
your containers — and what to weigh onto the plate on each kind of day, since a double
day gets a bigger serving of the same tray rather than a different recipe. Today's meal
button shows that same figure, so the kitchen scale and the log agree.

There's a ceiling, and the app says so rather than quietly landing short: past about
1.5× a normal plate, serving more tray stops being the answer. If your cooked meals
can't reach a big day, the cook list tells you which day and by how much, and the fix is
the mechanism already there — a meal restricted to those day types, like a shake or a
bagel, plated fresh.

## Weight, waist and calibration

**Nothing here looks at today's weight.** A morning reading is mostly water, glycogen
and last night's dinner; it moves ±1 kg for reasons that have nothing to do with fat.
Everything works off an exponentially weighted trend line and its slope, which is the
only part of the signal that means anything over a week.

**You don't have to weigh at the same time every day.** Time of day is *bias*, not
noise — an evening reading is about a kilo heavier, every time, so averaging morning and
evening readings together doesn't cancel out, it drags the line around according to when
you happened to stand on the scale. Tag each reading and it's corrected to
morning-equivalent before anything else touches it, using an offset the app measures
from your own data once there are a few of each (it starts from a population default and
switches over). In testing, a flat 78 kg with two evening weigh-ins a week reads as
78.35 kg drifting up 0.04 kg/week if the tags are ignored, and 78.01 kg drifting
0.00 kg/week once they're used.

A single reading also can't drag the trend more than 1.5 kg, so a mistyped 87 for 78
moves it by 0.09 kg rather than 9.

**The waist is a weekly job, not a daily one.** Three points spread over ten days is
enough for a slope, and the tape gets the same time-of-day correction as the scale.

**Waist matters more than weight in a recomp.** Weight is supposed to sit still — that
*is* the objective — so the scale gives you no feedback for months while the tape does.
The verdict on the Progress page reads them together: flat weight with the waist coming
in is "working, don't let the scale talk you out of it"; losing more than 0.7% of
bodyweight a week is flagged, because past there you're giving lean mass back and in a
training block you'll feel it in the pool before you see it anywhere else.

**Body fat, without knowing your body fat.** Lean-mass protein targets want a
percentage and most people don't have one, so the app will estimate it from a tape using
the US Navy circumference method — height, neck and waist. Neck is a one-off; the waist
you're measuring anyway, so the estimate keeps itself current. It's worth ±3–4 points
against a DEXA scan, but most of that error is a fixed offset for a given build, which
makes the absolute number approximate and the *direction it moves* the part worth
trusting. Don't read a rising lean-mass figure as muscle gained — a shrinking waist at
the same weight will produce one whether or not any muscle appeared.

**Waist matters more than weight in a recomp.** Weight is supposed to sit still — that
*is* the objective — so the scale gives you no feedback for months while the tape does.
The verdict on the Progress page reads them together: flat weight with the waist coming
in is "working, don't let the scale talk you out of it"; losing more than 0.7% of
bodyweight a week is flagged, because past there you're giving lean mass back and in a
training block you'll feel it in the pool before you see it anywhere else.

**Then it calibrates.** What you ate, minus what your weight did, is what you burned.
Given about two weeks of daily weigh-ins and confirmed food logs in the same window,
the app backs out your real expenditure — `mean intake − trend slope × 7,700 kcal/kg` —
and offers it in place of the formula. On synthetic data with realistic daily noise it
recovers a known 3,050 kcal expenditure to within about 10 kcal (`bench/recomp.ts`).

Accepting it scales every day type by one factor, so the shape of your week is
untouched; it's opt-in, it tells you its confidence, and it never rewrites your targets
on its own. This is the single biggest accuracy gain available — every prediction
equation in this README is fitted to a population, and you are one person.

## Protein distribution

The daily total does the work; the spread decides whether it's wasted. A dose under
about **0.4 g/kg of bodyweight** doesn't clear the leucine threshold that switches
muscle protein synthesis on — the protein is still used, the signal just isn't sent.
Four or five doses a day, one near training and one before sleep, is where the
physique-nutrition literature lands.

So the Plan page shows each meal's protein against that threshold, counts how many
doses actually clear it, and tells you which meal is closest to clearing and by how
much. A meal eaten twice a day counts as two doses.

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

- **Day types are respected.** Each day in the window is looked up against your week,
  and a meal limited to certain day types is only counted on those days — five swim
  days at one bagel each is five bagels, not seven. The list buys the plan exactly as
  written and never quietly scales portions up to meet a target: a bigger day is meant
  to be handled by the meals you put on it, and scaling on top of that would count the
  difference twice. If a day type's meals don't add up to its target, that's a warning
  before you shop rather than a silent adjustment.
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

## Where the numbers come from

- Barakat et al. (2020), *Body Recomposition: Can Trained Individuals Build Muscle and
  Lose Fat at the Same Time?*, Strength & Conditioning Journal — protein at
  2.6–3.5 g/kg FFM, resistance training at least 3×/week, recomposition observed across
  a range of energy balances.
- Iraki, Fitschen, Espinar & Helms (2019), *Nutritional Recommendations for Physique
  Athletes* — protein 1.8–2.7 g/kg, fat 10–25% of calories with a strong caution
  against long periods below that, carbohydrate 2–5 g/kg, weight loss ≤0.5% of body
  mass per week, four or five protein doses a day with one near training and one before
  sleep.
- Helms et al. (2014), *A Systematic Review of Dietary Protein During Caloric
  Restriction in Resistance Trained Lean Athletes* — the case for higher protein
  expressed per kg of fat-free mass while in a deficit.
- Ainsworth et al., *Compendium of Physical Activities* — the MET values behind every
  session cost.
- Hodgdon & Beckett (1984), the US Navy circumference equations — the tape body fat
  estimate, quoted at roughly ±3–4 percentage points against hydrostatic weighing.
- Mifflin-St Jeor and Katch-McArdle for BMR; the trend line is the Hacker's Diet EWMA.

They're population averages, not measurements of you. That's exactly why the
calibration exists — once you have your own data, it wins.

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
