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

## Signing in

Everyone gets their own account, and every account gets its own everything:
meals, week, weigh-ins, log, shopping list, history. Nobody sees anyone else's,
and nothing you change touches theirs. New people set themselves up from the
sign-in page — **Set up a new plan**.

The first account is made for you on the first page load, from `AUTH_USER` and
`AUTH_PASSWORD` if they are set and `admin` / `1234` if they aren't, so an
install that predates accounts still has someone to sign in as. **Change that
password** from the Plan page before you give anyone the address.

Passwords are stored as PBKDF2-HMAC-SHA256 with a per-account salt at 210,000
iterations and compared in constant time. The check runs on the server and sets
a signed cookie, so it can't be stepped over in devtools the way a password
compared in the browser can, and the middleware covers `/api/*` as well as the
pages — a login that only hides the screens leaves the data sitting open behind
them.

### AUTH_SECRET — set this one

```
AUTH_SECRET=…    # a long random string
```

**What it is.** The key the server signs session cookies with. When you sign
in, the server hands your browser a cookie saying "this is account 3, valid
until 9pm", plus a signature proving the server wrote it. `AUTH_SECRET` is what
makes that signature checkable — and unforgeable.

**Why it matters now.** Without it the app falls back to a constant that is
printed in `lib/auth.ts`, in a public repo. Anyone who reads that file can mint
a valid cookie for any account, and passwords stop being the thing that keeps
accounts apart. That was survivable when there was one account and one person;
it isn't once other people have their own data in here.

**Make one.** Any long random string will do. In a terminal:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Set it on Vercel.** Project → **Settings** → **Environment Variables** → Add
new. Key `AUTH_SECRET`, paste the value, tick **Production**, **Preview** and
**Development**, save. Then **Deployments** → the latest one → **⋯** →
**Redeploy** — environment variables are read at boot, so an existing
deployment won't pick it up on its own.

Everyone gets signed out once when it changes, because every cookie issued
under the old value stops verifying. That is the correct behaviour and it only
happens once.

For local development put the same line in `.env.local`.

### The other two

```
AUTH_USER=…      # username for the first account only; defaults to admin
AUTH_PASSWORD=…  # its password; defaults to 1234
```

Both are only read when account 1 is created. Changing them later does nothing
— accounts live in the database by then, and the Plan page is where you change
a password.

**It re-locks when you come back to it.** The cookie is written without a
`Max-Age`, which makes it a session cookie — closing the app signs you out. On
a phone that isn't enough on its own, because a home-screen app is usually
*suspended* rather than closed and the browser treats the next open as the same
session. So the client also watches for the app being backgrounded and signs
out on the way back in, and the signed cookie carries a twelve-hour expiry of
its own as a third backstop.

There's a ten-minute grace period, so checking a message or putting the kettle
on doesn't cost you a sign-in. Set `NEXT_PUBLIC_LOCK_AFTER` to the number of
seconds you want, or to `0` to lock the instant you look away.

```
NEXT_PUBLIC_LOCK_AFTER=600   # default, ten minutes
```

## Deploy

1. Push this folder to a GitHub repo.
2. Import it in Vercel (framework auto-detects as Next.js).
3. Add two environment variables, for **Production, Preview and Development**:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | your Neon **pooled** connection string |
   | `AUTH_SECRET` | a long random string — see [Signing in](#authsecret--set-this-one) |

   That's the string in Neon's "Connect to your database" dialog with
   *Connection pooling* toggled on — click **Show password** first so you copy the
   real password, not the asterisks.
4. Deploy. The tables create themselves on first page load (`lib/db.ts` →
   `ensureSchema`), and so do any new columns a later version adds. `schema.sql` is the
   same DDL if you'd rather run it by hand in the Neon SQL editor.

**On load time.** The migration is 88 statements, and Neon's HTTP driver makes
each one a separate round trip. Two things keep that off the critical path.

First, a version check: a `schema_meta` table holds the current
`SCHEMA_VERSION`, and a database already on it costs **one** query instead of
eighty-eight. Bump `SCHEMA_VERSION` in `lib/db.ts` whenever the DDL changes and
the whole thing replays; every statement is `if not exists`, so replaying is
harmless. The check fails open — if the stamp can't be read it migrates anyway,
because a missing column is a much worse failure than a slow first load.

Second, the replay itself is **batched**. `createSchema` is pure DDL, so its
statements are collected and sent in chunks with `sql.transaction` — measured,
87 HTTP requests down to 17. That matters because every route awaits
`ensureSchema()` before it answers: at 90 ms from a Vercel function to a Neon
compute, 87 sequential requests is ~8 seconds, comfortably past the function
timeout, and a page fires seven fetches at once so seven cold functions each
start their own. A schema bump could take the site down. It did.

The collector is worth a look (`lib/db.ts`): it is itself a tagged template, so
`createSchema` shadows `sql` with it and not one of the 75 statement lines has
to change.

**And a failed migration is not fatal.** `ensureSchema` memoises its promise,
which is what makes it free when warm — but memoising a *rejected* one meant a
single failure poisoned the instance, and every request on it failed instantly
for as long as it lived. A failure now clears the memo so the next request
retries, and does not fail the request: the migration is maintenance, not a
precondition. The tables are almost certainly already there, and if they are
not, the query that follows says so with a real error instead of this one
standing in front of it.

**Testing SQL.** Two harnesses, because there are two ways to be wrong.
`bench/db-harness.ts` points the real query code at an ordinary Postgres
(`lib/db.ts` exports `__setSql`), which proves the SQL is right.
`bench/neon-proxy.ts` goes further and impersonates Neon's HTTP endpoint —
same protocol, same one-statement-per-request rule, forwarding to that
Postgres — which proves the SQL survives the driver that actually runs it.
`bench/migration-http.ts` runs the whole migration through it.

```
createdb mealhub
PGTEST=postgres://localhost/mealhub npx tsx bench/staging-db.ts
PGTEST=postgres://localhost/mealhub npx tsx bench/migration-http.ts
```

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

## Shopping day and roll day are different days

You shop on Saturday. You cook on Sunday. You start eating it on Monday. So the
plan must not change when you get back from the shop — Saturday and Sunday are
still being eaten off the old one, and the containers in the fridge were
portioned against it.

Two separate days, then:

- **Shop day** (`shop_start_dow`, Saturday by default) is when the shopping list
  is for. It looks *forward*: a list built on Saturday is built against the
  targets that will apply on roll day, because that's the week the food is for.
- **Roll day** (`plan_roll_dow`, Monday by default) is when the plan itself
  changes — the weekly snapshot of trend weight and body fat is taken, and the
  block's drift steps.

The drift steps **once a week, on roll day**, rather than a little every
morning. A target that slides daily means Sunday's containers are wrong by
Wednesday and the shopping list disagrees with the plan it came from. Across the
block the average adjustment is the same either way; holding it still for the
week is simply easier to cook against.

### Staged changes

Rebalancing mid-week used to write straight to the plan, which had the same
problem one level down: press it on a Wednesday and Wednesday's lunch changed
size, except lunch was already cooked and in a box. The app was now describing
food that did not exist.

So a rebalance is **staged**. The new portions go to `pending_portions` with the
day they come into force:

- the **shopping list reads them immediately**, because the food it is buying is
  for the week those portions belong to;
- the **plan keeps showing the live portions**, because those are what is in the
  fridge;
- on the first page load on or after `apply_on` they swap in, in a single
  statement on the `/api/meals` read. No scheduler, no moving parts.

Shares are saved straight away either way. A share is an instruction to the
solver, not a weight on a plate, so there is nothing about one that has to wait.

The Plan page shows what is waiting and lets you throw it away; the footer of
the rebalance dialog offers **Stage for Mon 7 Sep** as the primary action and
**Now** as the deliberate override, for when you genuinely do want the plan to
change under you today.

#### Ingredient ids are not stable, and staging learned that the hard way

`PUT /api/meals` does `delete from ingredients where meal_id = ...` and
re-inserts the list, so **every ingredient gets a new id on every save**. The
first version of staging keyed on that id — and the staging flow saves the
meals one line before it posts the portions, so it posted ids that had ceased
to exist a fraction of a second earlier. The foreign key refused them, the 500
was swallowed, and the button did nothing while saying nothing.

Staged portions are keyed on **(meal, position, name)**, which is what actually
survives a save. If the name at that position no longer matches when the change
falls due, it is skipped — missing a change is a small problem and resizing the
wrong food is a much bigger one.

This is also why `bench/db-harness.ts` exists. The bug was a fact about the
database, not about the TypeScript, and no amount of reading the code was going
to find it. `lib/db.ts` exports `__setSql` so a test can point the real query
code at an ordinary Postgres; `bench/staging-db.ts` then runs the migration and
the whole staging flow against it, including the exact save-then-stage sequence
that broke.

```
createdb mealhub
PGTEST=postgres://localhost/mealhub npx tsx bench/staging-db.ts
```

### A settings change reaches the plan that is waiting

Staging writes the portions a fit produced *at the time you pressed it*. Change
a setting afterwards — fat per kg, protein, a session, your weight — and the
targets those grams were fitted to no longer exist. Nothing noticed: the plan
waiting for Monday sat there looking authoritative and would have come into
force as an answer to a question that had already changed.

So `PUT /api/profile` compares a signature of every field that moves a target,
before and after the save, and re-runs the fit against what is staged when one
of them changes. The day it applies on is kept; the live plan is untouched; the
note on the queue says it was re-fitted rather than still claiming to be the
rebalance you asked for.

It anchors on the **live** portions rather than the staged ones. "Keep it
close" should mean close to the food you are actually eating this week, not
close to a draft of next week's — anchoring on the draft compounds two changes
and drifts you twice as far as you meant to go.

### Putting the portions back

Three things rewrite every portion at once — the weekly re-fit, a staged change
falling due, and Recalculate — and two of those happen without anyone pressing
anything. That is right; a plan that needs you to remember to press a button is
a plan that drifts. But it means you can open the app on a Monday, find the
numbers have moved, and have no way to say *that was fine as it was*.

So each of them writes a snapshot to `portion_history` first, and the Plan page
offers to restore it. Restoring is itself snapshotted, so the undo is undoable.

There is a second route for a change that happened before any history existed:
**rebuild this week's portions from the log**. Every logged meal stores its
items exactly as they were when you tapped it, so the log is a record of what
the plan said on the day.

Reading it back is less obvious than it looks. The natural answer — take the
most common value across the week — is wrong. A re-fit that ran on the Tuesday
leaves a log of 70, 70, 43, 43, 43, and the most common value is 43: the number
you are trying to get rid of, winning by sitting there longest. So it goes in
two steps instead:

1. **Keep only what is near the earliest reading** — within 8 %, or a gram,
   whichever is larger. A rewrite moves a portion by a fifth or more, so this
   drops everything from after it. Weighing 19 g of honey instead of 20 stays,
   because that is the same portion badly weighed rather than a different plan.
2. **Take the most common of what's left**, earliest winning a tie. One bad
   morning cannot outvote four good ones.

**Locked portions are skipped entirely.** A locked portion is one the optimiser
may not touch, so no re-fit ever moved it and the live value is already right —
which makes it the wrong thing to overwrite with an estimate. Same for anything
whose name has changed since it was logged: the log says nothing about the food
that is there now.

It only covers meals you actually logged — it restores what you ate, not what
you meant to.

## Lean, fuelled, and still fast

Everything else in this app is about the size of a day. Energy availability is
about what's left of it once the training has been paid for, and it is the
difference between an athlete who gets lean and one who gets slow.

    EA (kcal per kg fat-free mass per day) = (intake − session cost) / FFM

The session term is the cost *above* rest, which is what `sessionKcal` already
computes. That distinction is the commonest error in the literature and it
inflates the answer by hundreds of calories.

**Why a calorie target isn't enough.** A weekly average can look perfectly
sensible while a Tuesday with two swims in it leaves too little to run a body
on, and the scale will not tell you. In junior swimmers, those in low energy
availability lost about 10% of their swimming speed over twelve weeks *at
stable body mass*, while adequately fuelled team-mates improved by about 8%
(Shaw et al., IJSNEM 2014). Weight stability is not evidence of being fuelled.

So `buildWeekPlan` applies an **EA floor**: every day is lifted, if needed, to
keep at least 30 kcal/kg FFM after the session cost. When the deficit and
energy availability disagree, availability wins — the fat can come off next
month, the season can't be got back. `bench/fuelling.ts` proves it binds: ask
for a 20% deficit and the floor gives most of it back, so the loss that
actually happens stays inside 1%/week no matter what you set.

It does nothing without a body-composition figure, on purpose. A floor built on
an invented fat-free mass would look like a safeguard while being a guess.

**On the thresholds.** For males the honest answer is that nobody is sure. The
2023 IOC consensus on REDs deliberately declines to set a clinical cut-off and
puts the male figure "even less understood, but appears to be lower (eg, ~9 to
25)". The 30/40 scheme came from female reproductive physiology. They are aims
and warnings here, never a diagnosis — see `lib/fuelling.ts` for the full
caveats.

**Rate of loss.** 0.7%/week is the target, 1.0% the ceiling. In 24 elite
athletes over 11 weeks, the group losing 0.7%/week gained 2.1% lean mass, lost
31% of their fat and put 7% on their jump; the group losing 1.0–1.4% lost *less*
fat, gained no lean mass and no performance (Garthe et al., IJSNEM 2011). Faster
was worse at the thing it was supposed to be better at.

**Protein.** 1.6–2.0 g/kg is the range the evidence supports in-season. Higher
is safe but not free: on a heavy day, 8–10 g/kg of carbohydrate plus 2.4 g/kg of
protein is near 4,000 kcal before a gram of fat, so every extra gram of protein
is carbohydrate you don't eat. The benefit above ~1.8 g/kg in a *modest* deficit
is genuinely contested — a 2025 RCT at 1.2 vs 1.6 vs 2.2 g/kg found no
difference. In-season, carbohydrate should generally win that argument.

## Body composition: track the millimetres

The strongest recommendation in the current literature is one this app used to
ignore — **don't convert skinfolds to a percentage at all**. There are over a
hundred published equations and on identical measurements they disagree wildly;
one worked example put the same athlete anywhere between 4% and 8%. Skinfolds
are already indirect, and running them through a population regression to reach
a criterion that was itself an estimate makes the answer doubly indirect. The
equations were validated for saying where someone *is*, not for tracking where
an individual is *going* (Kasper et al., Nutrients 2021).

So `sumOfSites` is the metric to watch: the raw sum in millimetres, with a
noise gate. ISAK's repeat-measure tolerance for the same tester is 7.5%, so on
a sum of 55 mm anything under about 4 mm is not a change and the app says so
rather than drawing a trend through it. Same person, same calipers, same sites —
between two testers the comparison isn't valid at all.

Two changes to the estimates themselves:

- **Men now use Evans, not Jackson–Pollock + Siri.** Siri assumes fat-free
  tissue has a density of 1.100 g/cm³, which a young high-bone-mineral athlete
  does not, and that bias doesn't wash out over repeated measures. Evans was
  built on 132 collegiate athletes against a four-component model, and beat both
  Jackson–Pollock and Lohman in an independent head-to-head in young athletes.
  Its published race coefficient is deliberately omitted — see `lib/bodyfat.ts`.
- **The Navy tape is demoted to a rough fallback.** Validated against DXA on
  1,407 recruits it over-reads at the lean end and tracked change *worse* over
  eight weeks of training. It has no term that can tell a lost centimetre of
  waist from a gained centimetre of shoulder, so a swimmer building a back and
  losing belly fat can watch it move the wrong way while everything goes right.

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

## Sheets on a phone

A `position: fixed` overlay with a scrolling area inside it is where iOS Safari
does its worst, so the rebalance dialog is a proper bottom sheet
(`app/sheet.tsx`) rather than a div that happens to be on top. Everything it
does is a thing that actually went wrong:

- **The page scrolled behind it.** Dragging the header, the backdrop or the
  footer scrolled the document underneath; so did reaching the end of the inner
  scroll and carrying on. `overscroll-behavior: contain` fixes the second. Only
  pinning the body — `position: fixed`, remembering the offset — fixes the
  first, and remembering it is what stops the page jumping to the top when the
  sheet closes.
- **The keyboard hid the field you were typing in.** `dvh` accounts for browser
  chrome and not for the keyboard, so a fixed sheet stayed full height and the
  input went under it. The sheet is sized from `visualViewport` instead, which
  is the only thing that knows.
- **It didn't move like a sheet.** There's a grip, it follows your thumb, and a
  flick past 110px closes it. Tapping the backdrop closes it; so does Escape.

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

### How much it is allowed to change

Two questions hide behind one button, and they want different answers:

- *"What is the best plan for these targets?"* — right the first time you build
  a plan.
- *"These targets moved a little; what is the smallest change to the plan I
  already have?"* — right every time after that.

Answering the second with the first gives you a plan that is marginally better
on paper and unrecognisable in the kitchen. The solver has no reason not to
halve the rice cakes and make it up in rice, because to the arithmetic those are
the same calories. They are not the same to you: you bought the rice cakes and
you know what 70 g of them looks like.

So **Keep it close** is the default. It weights movement away from the current
portions heavily enough that a change gets spread over everything instead of
being dumped on whichever ingredient is cheapest to sacrifice. **Best fit** is
the old behaviour, kept for building a plan from scratch.

`bench/anchor-sweep.ts` is why the weight is 0.3 and not something else — four
sizes of change against seven weights:

| change | free fit: worst move | at 0.3 | worst macro, free → 0.3 |
| --- | --- | --- | --- |
| 4 % | 20 % | 11 % | 4.5 % → 4.6 % |
| 8 % | 50 % | 20 % | 5.7 % → **4.3 %** |

On the change that actually matters it is both gentler *and* more accurate.
Past about 0.6 the accuracy starts to go, which is the wrong trade — the point
is to change the plan gently, not to refuse to change it.

The dialog reports the movement directly: how many portions move, the biggest as
a percentage, and the four largest with their before-and-after grams.

The weekly automatic re-fit (`lib/refit.ts`) always uses **Keep it close**. A
roll moves the targets by a percent or two, and a free fit is entitled to answer
that by halving the banana — which you would find out about at 6 am on a Monday.

## Cheat meals

One a week, optional, and priced honestly.

On a deficit a cheat meal is close to free: you are running 500 kcal under every
day, so a 1200 kcal meal out spends two days of deficit and the week still ends
where it was going. Most advice about cheat meals was written for that case.

Toned maintenance has no deficit to spend. A meal that lands 900 kcal over the
day is 900 kcal with nowhere to go, and at maintenance that means stored — about
six kilos a year if it happens every week and nothing absorbs it.

Enter it as **macros, not grams**. You are at a table with a menu; there is no
scale and no ingredient list. Calories alone is a fine answer and the split gets
estimated (a fifth protein, a third fat — what a meal out usually is). If the
place publishes the full breakdown, type it in and the day is worked out
properly rather than approximately.

`lib/cheat.ts` then works down a ladder, each rung dearer than the last:

1. **The meal it replaces comes off.** Usually most of the room, and it costs
   nothing — you weren't going to eat dinner *and* a curry.
2. **The rest of the day is re-fitted**, `protein_first` and `keep_close`, over
   the portions that can still move.
3. **Meals come off**, cheapest first — but only once the overshoot is bigger
   than the rest of the week could absorb, because deleting your lunch to solve
   a problem four other days could share is the blunt answer.
4. **What's left is spread over the remaining days of the plan week**, no day
   giving up more than 12 % of its own target, and stopping at roll day — next
   week gets its targets from its own weigh-in and should not inherit a debt.
5. **Anything still unplaced is reported in calories and in grams of fat.**

**Protein is a filter, not a preference.** Left as a weighted term in the
drop-scoring it lost: breakfast is 900 kcal of the 1200 you need to find, and
"close to the size of the overshoot" outvoted "half the day's protein is in
it" — a 2000 kcal meal came out costing 34 g of protein. Meals that would take
the day below 90 % of its protein target are now removed from consideration
entirely, and only come back if there is genuinely nothing else. When it happens
anyway, the card says so and suggests a shake.

The day's meal list on Today is rebuilt from the result, with the cheat meal in
it as an ordinary row carrying its own macros. Working out that dinner comes off
and lunch shrinks is worth nothing if the list you tap through still shows the
plan you are no longer eating.

Nothing here is written back to the plan. A cheat meal is a fact about one day;
the portions in the fridge do not change because you went out on Friday.

`bench/cheat.ts` runs it against the real plan — an ordinary meal out, a
blowout, one with nothing swapped, and one on a Sunday with nowhere left to
spread.

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

## Supplements

A supplement is **a dose you take, not a portion you weigh**, and modelling it as
an ingredient breaks two things at once: the optimiser would shrink your creatine
to help hit a carb target, and the shopping list would try to buy 5 g of it. So
they live in their own table, contribute their macros to the day as a fixed cost
the fit cannot negotiate with, and get ticked off rather than weighed.

They can be attached to a meal, restricted to particular day types, and taken
more than once a day. Almost all of them carry no macros at all; the ones that do
— a whey scoop is 120 kcal and 25 g of protein — matter, because a plan that
ignores them is 25 g of protein wrong every day.

**Each one is graded, and the grades are the point.** Creatine and vitamin K2 are
not the same proposition, and a list that presents them identically launders the
weak one. Grades follow the IOC consensus statement and the IJSNEM review beside
it, both of which are deliberately unkind:

| | grade | why |
| --- | --- | --- |
| Creatine monohydrate | **Strong** | Repeat-sprint work, training quality, a little lean mass |
| Caffeine | **Strong** | 3–6 mg/kg, an hour before |
| Whey protein | **Strong** | For reaching a protein target, not for anything the protein wouldn't do |
| Beta-alanine | Moderate | Buffers the 1–4 minute window — a 100 or a 200, almost exactly |
| Sodium bicarbonate | Moderate | Same window, outside the muscle. Gut upset is common |
| Vitamin D3 | Moderate | Corrects a shortfall. Indoor athletes are the at-risk group |
| Iron | Moderate | Only on a blood test. Genuinely harmful in excess |
| Magnesium | Limited | Helps where intake is low; not shown to add anything on top |
| Omega-3 | Limited | Two portions of oily fish a week does the same |
| Vitamin K2 | **Not shown to help** | No performance evidence. It's on the list because people take it with D3 |

The caveat gets the same weight as the claim, because for half this list the
caveat *is* the finding.

## Leaning protein and fat on the day

Carbohydrate periodisation is well established. Protein and fat are a weaker
case, and this is the honest version of it.

**Protein should not swing much.** Muscle protein synthesis stays raised for a
day or two after a session (Phillips et al. 1997), so a rest day between two
training days is still working through the last one. In a deficit, protein
protects lean mass on every day, trained or not (Mettler et al. 2010). Anyone
who drops protein hard on rest days is doing something the evidence does not
support.

**But a range is a range.** The recommendations are bands, not points —
2.3–3.1 g/kg of fat-free mass through a deficit (Helms et al. 2014). Sitting
near the bottom of that band on a day with no training and near the top on a
hard double is periodisation *within* the evidence rather than outside it, and
it is what a periodised framework actually does (Stellingwerff et al. 2019).

**Fat as grams per kilo was the wrong shape.** Fat guidance is written as a
share of energy — roughly 20–35% for athletes (Thomas et al. 2016), lower for
physique work (Iraki et al. 2019) — over a floor for hormonal health. A flat
gram figure inverts that:

```
                     flat 63 g            leaning on the day
  Rest day           63 g = 25% of kcal   50 g = 20%
  Swim only          63 g = 18%           63 g = 18%
  Swim + gym         63 g = 17%           67 g = 18%
```

The old model quietly made the rest day the fattiest one of the week.

The spread is small (±10% on protein, ±14% on fat) and **the week still
averages exactly the figures you set** — it moves protein and fat between days
rather than adding any. `periodise` on the profile turns it off.

It also happens to make the plan solvable. With protein and fat identical on
every day, the difference between a rest day and a swim day is 100%
carbohydrate, and nothing real is 100% carbohydrate — so no arrangement of
portions could put both days on target at once. Letting the training day carry
the protein and fat that comes with the extra food closes that gap.

## Fuelling the work

The check a percentage-based macro split can never make, and the one that matters
most in a pool.

**Carbohydrate requirement scales with the training a day holds, not with the size
of its calorie budget.** Burke's bands, in grams per kg of bodyweight per day:

| | g/kg | when |
| --- | --- | --- |
| Light | 3–5 | Little or no training |
| Moderate | 5–7 | About an hour of real work |
| High | 6–10 | One to three hours — a normal pool day |
| Very high | 8–12 | Four hours plus, or two hard sessions |

Days are placed by **MET-weighted** training minutes rather than clock minutes, so
an hour of technique doesn't count like an hour of main set.

Two things it is careful about:

- **Under the band on a light day is the point**, not a fault — fuelling for the
  work required means low days are meant to be low. Only a *training* day under
  its band is called a problem.
- **The bands assume energy balance.** In a deficit you can't clear them and
  shouldn't try. The useful reading is whether the training days carry more than
  the rest days, and the fix for a shortfall is usually to move carbohydrate
  toward the session rather than to add any.

On the plan that prompted this: swim days sit at 5.4 g/kg against a 6–10 band,
three days a week. That is a training-quality finding a calorie-based view would
never have surfaced.

## Where the numbers come from

Every constant that could have been guessed is pinned to a source instead, and
`lib/evidence.ts` is the register of them — so the app can answer "why that
number?" on screen, and so changing a constant means changing its citation too.

Position stands and consensus statements are preferred over single trials
throughout: they are a field's considered summary rather than one result, and
they are what a sports dietitian would actually work from.

**Framework and energy**
- Thomas DT, Erdman KA, Burke LM (2016). Position of the Academy of Nutrition and
  Dietetics, Dietitians of Canada, and the ACSM: Nutrition and Athletic
  Performance. *Med Sci Sports Exerc* 48(3):543–568.
- Mifflin MD, St Jeor ST, Hill LA, et al. (1990). A new predictive equation for
  resting energy expenditure in healthy individuals. *Am J Clin Nutr* 51(2):241–247.
- Ainsworth BE, Haskell WL, Herrmann SD, et al. (2011). 2011 Compendium of
  Physical Activities. *Med Sci Sports Exerc* 43(8):1575–1581.

**Carbohydrate, and swimming**
- Burke LM, Hawley JA, Wong SHS, Jeukendrup AE (2011). Carbohydrates for training
  and competition. *J Sports Sci* 29(sup1):S17–S27.
- Shaw G, Boyd KT, Burke LM, Koivisto A (2014). Nutrition for swimming.
  *Int J Sport Nutr Exerc Metab* 24(4):360–372.
- Impey SG, Hearris MA, Hammond KM, et al. (2018). Fuel for the Work Required.
  *Sports Med* 48:1031–1048.

**Protein**
- Jäger R, Kerksick CM, Campbell BI, et al. (2017). ISSN Position Stand: protein
  and exercise. *J Int Soc Sports Nutr* 14:20.
- Morton RW, Murphy KT, McKellar SR, et al. (2018). A systematic review,
  meta-analysis and meta-regression of the effect of protein supplementation on
  resistance training-induced gains. *Br J Sports Med* 52:376–384.
- Areta JL, Burke LM, Ross ML, et al. (2013). Timing and distribution of protein
  ingestion during prolonged recovery from resistance exercise alters myofibrillar
  protein synthesis. *J Physiol* 591(9):2319–2331.
- Helms ER, Aragon AA, Fitschen PJ (2014). Evidence-based recommendations for
  natural bodybuilding contest preparation. *J Int Soc Sports Nutr* 11:20.

**Recomposition**
- Barakat C, Pearson J, Escalante G, Campbell B, De Souza EO (2020). Body
  Recomposition: Can Trained Individuals Build Muscle and Lose Fat at the Same
  Time? *Strength Cond J* 42(5):7–21.
- Iraki J, Fitschen P, Espinar S, Helms E (2019). Nutrition Recommendations for
  Bodybuilders in the Off-Season. *Sports* 7(7):154.

**Supplements**
- Maughan RJ, Burke LM, Dvorak J, et al. (2018). IOC consensus statement: dietary
  supplements and the high-performance athlete. *Br J Sports Med* 52:439–455.
- Peeling P, Binnie MJ, Goods PSR, Sim M, Burke LM (2018). Evidence-Based
  Supplements for the Enhancement of Athletic Performance.
  *Int J Sport Nutr Exerc Metab* 28(2):178–187.
- Kreider RB, Kalman DS, Antonio J, et al. (2017). ISSN position stand: safety and
  efficacy of creatine supplementation. *J Int Soc Sports Nutr* 14:18.
- Owens DJ, Allison R, Close GL (2018). Vitamin D and the Athlete: Current
  Perspectives and New Challenges. *Sports Med* 48(Suppl 1):3–16.

**Body composition**
- Hodgdon JA, Beckett MB (1984). Prediction of percent body fat for U.S. Navy men
  and women from body circumferences and height. *Naval Health Research Center*.
- Jackson AS, Pollock ML (1978). Generalized equations for predicting body density
  of men. *Br J Nutr* 40(3):497–504.
- Siri WE (1961). Body composition from fluid spaces and density.
  *Techniques for Measuring Body Composition*, National Academy of Sciences.

Every one of these is fitted to a population, and you are one person. They are
the right place to start and the wrong place to finish — which is exactly what
the calibration on the Progress page is for, and why it wins once it has three
weeks of your own data.

**None of this is medical advice.** Two things in particular belong to a doctor
rather than an app: iron, which is harmful in excess and should only ever follow
a blood test, and vitamin D, where the whole effect is correcting a deficiency
you would need a test to establish.

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
