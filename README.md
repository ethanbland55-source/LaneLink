# Meal Hub

Four screens:

- **`/` — Today.** Daily target header, a live macro counter, one tap per meal to log
  it pre-filled from your plan, editable gram amounts, then Confirm. Arrows step back
  through previous days.
- **`/plan` — Plan & Settings.** Leads with the whole week — what each kind of day
  should be, and what your plan actually comes to on it — because one set of portions
  has to work on all of them. Then your body stats and goal, the day types that make up
  the week, and your meals: meals → ingredients → per-100g macros.
- **`/shop` — Shopping list.** The plan played forward over however many days you buy
  for, totalled up, rounded to real pack sizes and grouped by aisle.
- **`/progress` — Weight, measurements and calibration.** Weigh in with the time you
  did it, take a tape or caliper measurement and get a body fat figure out of it, see
  the trend rather than the number, and roll the whole plan forward on shopping day.

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
your containers, and the serving to weigh onto the plate. One serving, whatever day it
is — this used to hand back a different weight per day type, which is a tidy idea and
not what happens in a kitchen: you portion the tray on Sunday and take one out on
Thursday. Today's meal button shows that same figure, so the kitchen scale and the log
agree.

There's a ceiling, and the app says so rather than quietly landing short: past about
1.5× a normal plate, serving more tray stops being the answer. If your cooked meals
can't reach a big day, the cook list tells you which day and by how much, and the fix is
the mechanism already there — a meal restricted to those day types, like a shake or a
bagel, plated fresh.

## Weight, waist and body fat

### Say what time you weighed

You are lightest first thing and gain roughly a kilo through the day as food
and fluid arrive faster than they leave. None of it is fat, and all of it lands
in the trend if nothing corrects for it.

So a weigh-in carries a **clock time**. That is strictly better than the three
buckets it replaces, because 09:00 and 11:30 are both "morning" and are not the
same reading. The correction is a rate per hour awake, flattening off once the
day's food is in.

**The rate is measured on you.** Two readings a few days apart are the same
real weight, so almost all of the difference between them is the difference in
what time they were taken — divide one by the other and you have the rate, with
the trend cancelled out rather than estimated. The median across every such
pair is the robust version.

That estimator took two goes. Measuring later readings against a trend built
from morning ones biases *low*, because a "morning" reading is already an hour
into the rise. Choosing the rate that makes corrected readings sit tightest
around their own trend is circular — the trend chases the correction — and
biases *high*. Pairs avoid both.

On a synthetic subject genuinely flat at 78.00 kg, weighing at seven different
times of day, true rise 100 g/hr (`bench/weekly.ts`):

```
                      reads as        drifting
with clock times      78.00 kg        0.000 kg/wk     learned 97 g/hr
with tags only        78.18 kg        0.006 kg/wk
ignoring the time     78.54 kg        0.025 kg/wk
```

Half a kilo of phantom weight and a fake upward drift, removed by knowing what
time it was.

### Body fat, three ways

Pick whichever suits what you own. All of it lives with the weigh-in, so the
figure trends instead of being something you typed in once months ago.

| | needs | accuracy |
| --- | --- | --- |
| **Tape measure** | neck, waist (hips for women) | ±3–4 points |
| **Calipers** | three pinches | ±3 points, better on lean people |
| **Type it in** | a DEXA or InBody scan | whatever the scan was |

The tape is the US Navy circumference method; the calipers are Jackson–Pollock
3-site converted with Siri. Each site says where to put the tape or the
calipers and nothing more — consistency matters more than being exactly on the
anatomical landmark, because a repeatable 2 mm error cancels out of every
difference and a wandering one does not.

Both are **attribution-blind**: they see a smaller waist or a thinner pinch and
call all of it fat. Over a few weeks that is usually right. Over a few days it
is mostly water. And most of the error against a scan is a fixed offset for
your build, which is why the direction it moves is worth more than the number.

## The weekly roll

Your weight moves every day. **Your plan must not.**

If targets tracked the scale, Tuesday's porridge would be a different size from
Monday's for reasons that are mostly water, the shopping list would disagree
with the plan it was built from by Wednesday, and the containers in the fridge
would be wrong for the day they were opened.

So the plan is built on a **snapshot**, taken once a week **on your shopping
day**. Between rolls the numbers hold perfectly still: what you bought is what
you cook is what you eat. On shopping day the trend weight and the latest body
fat figure are read once, every target is rebuilt around them, and that is the
week you then shop for.

It reads the **trend**, not the scale — a single reading is noise, and the EWMA
of the last fortnight is the number that means something. It won't run at all
on fewer than three weigh-ins, because rebuilding a week's targets on one
reading would be worse than leaving last week's alone.

```
  Sat  measure ──► corrected for the time ──► trend
                                               │
                                               ▼
                                        roll the snapshot
                                               │
                          ┌────────────────────┼────────────────────┐
                          ▼                    ▼                    ▼
                    day-type targets    rebalance the week    shopping list
  Sun–Fri  ............ all of it holds still ............
```

Happens by itself when you open the app on or after shopping day; there's a
switch on Progress to do it by hand instead, and a line saying what the plan is
built on and when it changes next.

## Meal times

Tapping a meal logs it now, which is what you want nine times in ten. The clock
beside it is for the tenth, when you're catching up in the evening — and every
logged meal shows its time inline, editable, because getting it wrong by an
hour is common and re-logging the meal to fix it is not a reasonable thing to
ask.

What the times are actually *for*: the daily protein total is doing the work,
and the spacing decides how much of that work lands. Muscle protein synthesis
rises for about three hours after a dose that clears the threshold and then
settles back whether or not more protein arrives — so four doses three to five
hours apart raise it four times, and the same protein in two sittings raises it
twice. Today tells you where the day's longest gap was, and whether the last
real dose was close enough to sleep to shorten the overnight fast.

It says nothing at all until you start logging times, which is the honest limit
of it.

## Calibration — what your maintenance actually is

**What you ate, minus what your weight did, is what you burned.** Given about two
weeks of daily weigh-ins and confirmed food logs in the same window, the app backs out
your real expenditure — `mean intake − trend slope × 7,700 kcal/kg` — and offers it in
place of the formula. On synthetic data with realistic daily noise it recovers a known
3,050 kcal expenditure to within about 10 kcal (`bench/recomp.ts`).

Accepting it scales every day type by one factor, so the shape of your week is
untouched; it's opt-in, it tells you its confidence, and it never rewrites your targets
on its own. This is the single biggest accuracy gain available — every prediction
equation in this README is fitted to a population, and you are one person.

It rests on the same corrected trend the weekly roll does, which is the other reason
the weigh-in time is worth typing: a slope contaminated by what time you stood on the
scale produces a maintenance figure that is wrong by whatever that contamination came
to, times 7,700.

## Protein distribution

The daily total does the work; the spread decides whether it's wasted. A dose under
about **0.4 g/kg of bodyweight** doesn't clear the leucine threshold that switches
muscle protein synthesis on — the protein is still used, the signal just isn't sent.
Four or five doses a day, one near training and one before sleep, is where the
physique-nutrition literature lands.

So the Plan page shows each meal's protein against that threshold, counts how many
doses actually clear it, and tells you which meal is closest to clearing and by how
much. A meal eaten twice a day counts as two doses.

## Rebalance the week

**Portions are fixed, the menu is what changes.** That is the whole idea, and getting
it wrong was the bug this replaced.

You cook on a Sunday and eat out of the same containers all week, so breakfast cannot
be re-weighed depending on whether there is a swim that evening. What actually makes a
training day bigger is the *extra meals on it* — dates before the pool, yoghurt after,
a bagel after the gym — not a bigger scoop of the same porridge.

The old dialog asked which kind of day you wanted, fitted that one, and wrote the
answer over the portions every other day also uses. Running it five times did not fix
that; it just picked a different day to be right about. On the plan that prompted the
rewrite, with the rest day fitted last:

| | days/week | target | plan actually ate | |
| --- | --- | --- | --- | --- |
| Rest | 1 | 2,239 | 2,262 | +23 |
| Swim only | 3 | 3,122 | 3,410 | **+288** |
| Swim + gym | 3 | 3,365 | 3,725 | **+360** |
| **week average** | | **3,100** | **3,381** | **+281 a day** |

281 kcal a day, every day, with the app showing a tick — because it was only ever
looking at one day at a time.

**Now there is one fit over every kind of day at once.** The portions are the unknowns,
one per ingredient because there is one of each in the fridge; each day type
contributes a row saying which of them are on the menu that day, weighted by how many
weekdays use it. Rest days set what breakfast, lunch and dinner have to be; the gap up
to a swim day is what the swim meals have to be; the gap up to a swim-and-gym day is
what the gym meal has to be. One solve, because it is genuinely one problem.

Same plan, one press:

| | target | after | |
| --- | --- | --- | --- |
| Rest | 2,239 | 2,228 | −11 |
| Swim only | 3,122 | 3,084 | −38 |
| Swim + gym | 3,365 | 3,399 | +34 |
| **week average** | **3,100** | **3,093** | **−7 a day** |

Day types that no weekday uses are named and left out of the fit rather than dragging
every shared portion toward a meal that never happens.

### Splits

Some of this is genuinely underdetermined. If dates before a swim and yoghurt after it
are the only two meals on swim days, the fit knows what the pair must add up to, but
nothing in the targets says how to divide them — 90/10 costs exactly the same as 20/80.
Left alone it picks whichever is nearest the plan already written, which is how a
handful of dates ends up carrying 41% of a session's calories.

So meals that appear on **exactly the same days** form a group, and each gets a
per-cent box. Leave it empty and the fit decides; type 20 and it holds the split.

**The same question exists one level down, for some meals.** Nothing in the
targets says how much of a yoghurt bowl should be yoghurt either — left alone the
fit will happily make it half granola if the macros come out a shade closer, and
that is not the bowl you wanted. So the ingredients of a meal can be given shares
too: 50% yoghurt, 40% granola, 10% honey.

It is **opt in per meal**, because most meals are not like that. Chicken and rice
is a recipe, not a ratio, and a per-cent box under every ingredient of every meal
asks you to have an opinion about how much of your dinner is rice. Open the one
meal you actually balance deliberately and leave the rest alone.

All of this is **plan-building**. Shares shape the portions the fit lands on, and
that is the whole of what they do — nothing in the log, the shopping list or the
cook list reads them.

Every figure is a share of the **calories**, at both levels, because that is the
thing being divided. By weight a yoghurt bowl is 80% yoghurt and the number tells
you nothing.

On a **cooked-ahead** meal the ingredient shares are the *recipe* rather than a
preference — you cannot serve more of the chicken in a tray, only more tray. So
they are applied directly: the amounts are re-proportioned to match, the tray
stays the same size, and the fit then sizes the serving.

It is a soft term on purpose, swept against the real plan: below about 0.05 it barely
moves the split, above about 1.0 it will buy the split with 100 kcal a day. At 0.3 the
split moves as far as the portion limits allow *and* the mean daily miss improves,
because pinning the degenerate direction leaves a better-posed problem behind.

Where a limit blocks it, the row says so and offers the fix: *"held at its
smallest allowed size — tap to allow 64 g and reach 20%"*. Where nothing is in
the way and the split still hasn't landed, that is the macros disagreeing, and it
says that instead: *"nothing's in the way — the macros land closer at 46%"*. A
typed number sitting next to a different achieved one with no explanation is the
one thing this must never do.

### What it knows about food

Every ingredient is classified — by name against a dictionary of the things people
actually eat, and by macro density for anything the dictionary hasn't heard of. The
class decides how far a portion may move, and that is a much better guess than one
blanket percentage:

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

### How it solves

A bounded least-squares fit with asymmetric penalties (missing protein low is worse
than overshooting it; going over calories is worse than going under), summed over every
kind of day and weighted by how often each comes round. Solved by **exact coordinate
descent from several starting points** — for a fixed set of other portions the cost is
a one-dimensional convex function of each portion, so each can be solved to its true
optimum rather than nudged toward it. Then a discrete pass snaps everything to
weighable amounts and wins back what that cost, using **pairwise moves** — one portion
up, another down — because that's the plateau single-portion tweaks get stuck on.

An **anchor** term sits far below the macro weights and acts only as a tie-breaker, so
among equally accurate answers it picks the one that looks most like the plan you
wrote.

**Four priorities**, because "closest" depends on what you're doing: *Balanced*,
*Protein first*, *Calories exact* (chosen automatically when you've set a manual kcal
figure) and *Most food*, which breaks ties toward the more filling plan.

**When it can't get there** it says so and shows the way out: which limit is in the
way, on which kind of day, and a one-tap button to widen exactly that one to exactly
the figure that would close the gap.

### Is it actually better?

`bench/compare.ts` runs the old single-target solver against the new one over 400
randomised but realistic plans, with targets constructed to be genuinely reachable
within each plan's own limits — so any error is the solver's, not the plan's.

```
                            old      new
mean macro error           0.85%    0.47%
worst macro error         18.38%    6.95%
mean calorie miss         9.4 kcal 5.3 kcal
mean protein shortfall     0.43 g   0.17 g

new error, median / p90 / p99      0.24% / 1.09% / 3.72%
```

Read the median and the p90. The score weights all four macros equally and the solver
deliberately does not — protein carries nearly three times the weight of carbohydrate —
so the handful of plans at the top of `--worst` are mostly ones where the two genuinely
conflict and the solver protected protein, which is the behaviour asked for being
scored as an error. `bench/compare.ts --snapped --worst` prints them with their
denominators.

A solve takes about 6 ms for a 16-ingredient day, which is why the dialog re-fits live
as you type.

(`--snapped` is the table above. Without the flag it aims at targets that fall between
whole eggs and whole scoops, where the new solver scores *worse* on paper — it refuses
to answer "1.4 eggs". That's the trade, and it's the right one.)

`bench/weekfit-check.ts` runs the whole-week fit against the real plan and prints both
tables above; `bench/share-explain.ts` checks that a share it can't reach names the
limit that's in the way.

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
- The app tracks **four** numbers: calories, protein, carbs and fat. It briefly
  tracked fibre as a fifth and no longer does — the columns are still created so no
  existing database loses anything, but nothing reads them.
- Only **confirmed** meals count toward the counter — added-but-unconfirmed meals are
  drafts you can still adjust.
- Weigh food raw where you can, and be consistent about it. Per-100g values off the
  packet are far more accurate than AI-estimated macros, which is the whole point of
  entering them yourself.
- Judge a phase on the trend over 3–4 weeks. Day-to-day weight swings from water and
  glycogen easily hide 0.25 kg/week of real change, and they swing hardest in a heavy
  training week.
- No login. The site is public, and anyone with the URL sees the same single profile.
