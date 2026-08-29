# StudyForge — Smart Study Planner

A single-page study planner that turns *"I have four exams and not enough time"* into a
concrete, day-by-day timetable — then locks your browser down while you work through it.

No build step, no dependencies, no server, no account. Open `index.html` and it runs.
All data lives in `localStorage` on your machine.

```bash
start index.html
```

---

## What it does

| | |
|---|---|
| **Dashboard** | Days to next exam, hours planned vs available, syllabus covered, streak. Stacked 14-day load chart, remaining-hours donut, today's blocks, per-subject time budget. |
| **Subjects** | Subjects → topics, each with an hour estimate, priority, confidence and exam date. Progress rings and per-topic hour tracking. |
| **Schedule** | The generated timetable: week strip, day cards, clock times, revision blocks, and an explicit warning when the plan does not fit. |
| **Focus Lock** | Fullscreen kiosk timer with breach detection, screen wake-lock and hold-to-quit. |
| **Insights** | 12-week consistency heatmap, focus-score history, time split by subject, peak study hour, full session log. |
| **Settings** | Weekly availability, per-date exceptions, engine tuning, lock strictness, export/import/erase. |

---

## The scheduling engine

`js/scheduler.js`. Every topic becomes a queue of study blocks plus spaced revision
blocks, and each day's free hours are divided between subjects by **pressure**:

```
pressure(subject, day) = hours still to do ÷ hours available before that subject's exam
share(subject, day)    = pressure ^ 1.9   (normalised across eligible subjects)
```

The exponent means a subject that genuinely cannot finish pulls most of the day toward
itself, while the others still tick over instead of being starved. Within a day the
blocks are emitted round-robin, so you interleave subjects rather than grinding one for
six hours — which is also what the recall research supports.

Other behaviour worth knowing:

- Topics are ordered **high priority first, then lowest confidence first** — the things you
  are shakiest on get scheduled earliest and revised most.
- Nothing is scheduled for a subject after its exam date.
- A configurable share of each subject's time (default 25%) is reserved for revision and
  lands after that subject's first pass.
- If the work genuinely does not fit the hours you have, the plan **says so** and names the
  shortfall per subject rather than quietly dropping topics. You then either add hours,
  trim estimates by 15% in one click, or drop a topic.

---

## About "disable my device while studying"

Worth being straight about this, because it shaped the design: **a web page cannot switch
off your device.** Browsers sandbox pages precisely so a website cannot kill your apps,
block other sites, or power down your phone. Any web app claiming otherwise is not doing it.

What Focus Lock *does* do, which is everything the browser actually permits:

- **Fullscreen kiosk mode** — tabs, address bar and bookmarks disappear
- **Screen wake-lock** — the device will not sleep mid-block
- **Breach detection** — tab switch, window blur and fullscreen exit each trigger a
  full-screen red alarm, **stop the clock**, and cost 8 focus-score points
- **Navigation guard** — the browser challenges you before a reload or tab close
- **Hold-to-quit** — leaving requires a deliberate 3-second press, not a reflex click
- **Permanent record** — every breach is stored against the session in your history

For a genuine device-level block, the Focus Lock screen ships the exact steps for
Windows Focus Assist + a hosts-file site blocker, iOS Screen Time / Downtime, and
Android Digital Wellbeing Focus Mode. Those are OS features you run once; StudyForge
handles the browser half and the accountability.

---

## Files

```
index.html          markup shell + overlays
assets/styles.css   design system, light + dark themes, responsive
js/store.js         state, persistence, date helpers, sample data
js/scheduler.js     the planning algorithm
js/charts.js        dependency-free SVG charts
js/focus.js         Focus Lock engine
js/views.js         pure render functions per screen
js/app.js           routing, events, modals
```

Shortcuts: `1`–`6` switch views, `F` starts a focus session on the next scheduled block.

Loads with sample data (Physics, Maths, Chemistry, CS) so the charts have shape.
**Settings → Erase everything** clears it and starts you empty.
