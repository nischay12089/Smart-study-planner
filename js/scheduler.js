/* ===================================================================
   scheduler.js — the "smart" bit.
   Deadline-aware, pressure-weighted allocation of topic blocks into the
   hours you actually have, with spaced revision and interleaving.
   Exposes: window.Scheduler
   =================================================================== */
(function (global) {
  'use strict';

  var S = global.Store;
  var MIN_BLOCK = 0.25;          // never schedule less than 15 min
  var MAX_HORIZON = 180;         // days
  var URGENCY = 1.9;             // how hard a near deadline pulls the day toward it

  function r2(n) { return Math.round(n * 100) / 100; }

  /* Weakest + most important first. */
  function orderTopics(topics) {
    return topics.slice().sort(function (a, b) {
      var pr = (b.priority || 2) - (a.priority || 2);            if (pr) return pr;
      var cf = (a.confidence || 3) - (b.confidence || 3);        if (cf) return cf;
      return (b.estHours || 0) - (a.estHours || 0);
    });
  }

  /* Break a subject into an ordered queue of study blocks + revision blocks. */
  function buildQueue(subject, settings) {
    var blockH = Math.max(MIN_BLOCK, (settings.blockMinutes || 45) / 60);
    var queue = [], totalStudy = 0;
    var topics = orderTopics(subject.topics.filter(function (t) {
      return (Number(t.estHours) || 0) > 0 && t.status !== 'done';
    }));

    topics.forEach(function (t) {
      var rem = Math.max(0, (Number(t.estHours) || 0) - (Number(t.doneHours) || 0));
      if (rem < MIN_BLOCK) return;
      totalStudy += rem;
      var left = rem;
      while (left >= MIN_BLOCK) {
        var h = Math.min(blockH, left);
        if (left - h > 0 && left - h < MIN_BLOCK) h = left;      // absorb a tiny tail
        queue.push({ topicId: t.id, hours: r2(h), type: 'study' });
        left = r2(left - h);
      }
    });

    /* Spaced revision — weighted to the topics you are least sure about. */
    var share = Math.max(0, Math.min(0.6, settings.revisionShare == null ? 0.25 : settings.revisionShare));
    var revH = totalStudy * share;
    if (revH >= MIN_BLOCK) {
      var pool = orderTopics(subject.topics.filter(function (t) { return (Number(t.estHours) || 0) > 0; }));
      if (pool.length) {
        var n = Math.max(1, Math.round(revH / blockH)), i = 0;
        while (n-- > 0) {
          queue.push({ topicId: pool[i % pool.length].id, hours: r2(blockH), type: 'revision' });
          i++;
        }
      }
    }
    return { queue: queue, studyHours: r2(totalStudy), revisionHours: r2(Math.max(0, revH)) };
  }

  /**
   * Generate a full plan.
   * @returns {{generatedAt:number,start:string,end:string,days:Array,deficits:Array,summary:Object}}
   */
  function generate(state) {
    var settings = state.settings;
    var today = S.todayISO();
    var subjects = state.subjects.filter(function (s) { return s.topics && s.topics.length; });

    if (!subjects.length) {
      return { generatedAt: Date.now(), start: today, end: today, days: [], deficits: [],
               summary: { scheduled: 0, capacity: 0, bySubject: {}, feasible: true } };
    }

    /* --- horizon: up to the last exam (or 21 days if no exams set) --- */
    var lastExam = null;
    subjects.forEach(function (s) {
      if (s.examDate && S.dayDiff(today, s.examDate) >= 0) {
        if (!lastExam || s.examDate > lastExam) lastExam = s.examDate;
      }
    });
    var horizonEnd = lastExam || S.addDays(today, 21);
    var span = Math.min(MAX_HORIZON, Math.max(1, S.dayDiff(today, horizonEnd) + 1));

    /* --- day list with capacity --- */
    var days = [], dates = [], capOf = {};
    for (var i = 0; i < span; i++) {
      var iso = S.addDays(today, i);
      var cap = Math.max(0, S.capacity(iso));
      dates.push(iso); capOf[iso] = cap;
      days.push({ date: iso, capacity: cap, blocks: [] });
    }

    /* --- per-subject work queues and deadlines --- */
    var work = subjects.map(function (s) {
      var q = buildQueue(s, settings);
      /* study up to the day *before* the exam; if the exam is today, today is it */
      var last = horizonEnd;
      if (s.examDate) {
        var d = S.dayDiff(today, s.examDate);
        last = d <= 0 ? today : S.addDays(s.examDate, -1);
        if (last > horizonEnd) last = horizonEnd;
      }
      return {
        subject: s, lastDay: last, queue: q.queue, ptr: 0,
        remaining: q.queue.reduce(function (a, b) { return a + b.hours; }, 0),
        studyHours: q.studyHours, revisionHours: q.revisionHours, scheduled: 0
      };
    }).filter(function (w) { return w.queue.length; });

    /* --- suffix capacity sums so "pressure" is O(1) --- */
    var suffix = new Array(span + 1); suffix[span] = 0;
    for (var j = span - 1; j >= 0; j--) suffix[j] = suffix[j + 1] + capOf[dates[j]];
    function capBetween(fromIdx, lastIso) {
      var endIdx = Math.min(span - 1, S.dayDiff(today, lastIso));
      if (endIdx < fromIdx) return 0;
      return suffix[fromIdx] - suffix[endIdx + 1];
    }

    /* --- allocate, day by day ---
       Each day's capacity is split between subjects in proportion to how
       much pressure each one is under (work left ÷ time left before its
       exam), then emitted round-robin so a day covers several subjects
       rather than one long slog. --- */
    var blockH = Math.max(MIN_BLOCK, (settings.blockMinutes || 45) / 60);

    for (var di = 0; di < span; di++) {
      var day = days[di];
      var left = day.capacity;
      if (left < MIN_BLOCK) continue;

      var elig = work.filter(function (w) {
        return w.ptr < w.queue.length && day.date <= w.lastDay;
      });
      if (!elig.length) continue;

      /* pressure = share of the remaining window this subject still needs.
         Weighted superlinearly (^URGENCY) so a subject that is genuinely at
         risk pulls most of the day, while the rest still tick over. */
      var sumP = 0;
      elig.forEach(function (w) {
        var room = capBetween(di, w.lastDay);
        var p = (w.remaining - w.scheduled) / Math.max(0.25, room);
        /* nudge: the nearer deadline wins a tie */
        p += 0.002 / Math.max(1, S.dayDiff(day.date, w.lastDay) + 1);
        w.pressure = Math.max(0.0001, p);
        w.weight = Math.pow(w.pressure, URGENCY);
        sumP += w.weight;
      });
      elig.sort(function (a, b) { return b.pressure - a.pressure; });

      /* how many blocks each subject gets today */
      var totalBlocks = Math.max(1, Math.round(day.capacity / blockH));
      var quota = elig.map(function (w) {
        return { w: w, n: 0, avail: w.queue.length - w.ptr };
      });
      var assigned = 0;
      quota.forEach(function (q) {
        var n = Math.min(q.avail, Math.floor(totalBlocks * (q.w.weight / sumP)));
        q.n = n; assigned += n;
      });
      /* hand any leftover blocks down the pressure order */
      var cursor = 0, guard = 0;
      while (assigned < totalBlocks && guard++ < 400) {
        var q0 = quota[cursor % quota.length];
        if (q0.n < q0.avail) { q0.n++; assigned++; }
        cursor++;
        if (quota.every(function (x) { return x.n >= x.avail; })) break;
      }

      /* emit — interleaved across subjects, or grouped if the user prefers */
      var order = [];
      if (settings.interleave !== false) {
        var more = true, spin = 0;
        while (more && spin++ < 400) {
          more = false;
          quota.forEach(function (q) { if (q.n > 0) { order.push(q.w); q.n--; more = true; } });
        }
      } else {
        quota.forEach(function (q) { while (q.n-- > 0) order.push(q.w); });
      }

      function place(w) {
        if (left < MIN_BLOCK || w.ptr >= w.queue.length) return false;
        var item = w.queue[w.ptr];
        var hours = Math.min(item.hours, left);
        if (hours < MIN_BLOCK) return false;
        day.blocks.push({
          id: S.uid('blk'), subjectId: w.subject.id, topicId: item.topicId,
          type: item.type, hours: r2(hours), done: false
        });
        left = r2(left - hours);
        w.scheduled = r2(w.scheduled + hours);
        if (hours < item.hours - 1e-6) item.hours = r2(item.hours - hours);
        else w.ptr++;
        return true;
      }

      order.forEach(place);

      /* soak up any capacity the rounding left behind */
      var spare = 0;
      while (left >= MIN_BLOCK && spare++ < 40) {
        var cand = elig.filter(function (w) { return w.ptr < w.queue.length; })[0];
        if (!cand || !place(cand)) break;
      }
    }

    /* --- clock times --- */
    var startMin = S.clockToMins(settings.dayStart || '08:00');
    var brk = Number(settings.breakMinutes || 10);
    days.forEach(function (d) {
      var cur = startMin;
      d.blocks.forEach(function (b, idx) {
        b.start = S.minsToClock(cur);
        cur += b.hours * 60;
        b.end = S.minsToClock(cur);
        if (idx < d.blocks.length - 1) cur += brk;
      });
      d.hours = r2(d.blocks.reduce(function (a, b) { return a + b.hours; }, 0));
    });

    /* --- what did not fit --- */
    var deficits = [], bySubject = {};
    work.forEach(function (w) {
      var unscheduled = 0;
      for (var k = w.ptr; k < w.queue.length; k++) unscheduled += w.queue[k].hours;
      bySubject[w.subject.id] = { scheduled: r2(w.scheduled), needed: r2(w.remaining),
                                  study: w.studyHours, revision: w.revisionHours };
      if (unscheduled >= MIN_BLOCK) {
        deficits.push({
          subjectId: w.subject.id, name: w.subject.name, color: w.subject.color,
          hours: r2(unscheduled), examDate: w.subject.examDate,
          daysLeft: w.subject.examDate ? S.dayDiff(today, w.subject.examDate) : null
        });
      }
    });

    var scheduled = days.reduce(function (a, d) { return a + d.hours; }, 0);
    var capacity = days.reduce(function (a, d) { return a + d.capacity; }, 0);

    return {
      generatedAt: Date.now(), start: today, end: horizonEnd,
      days: days.filter(function (d) { return d.blocks.length || d.capacity > 0; }),
      deficits: deficits,
      summary: {
        scheduled: r2(scheduled), capacity: r2(capacity), bySubject: bySubject,
        feasible: deficits.length === 0,
        utilisation: capacity ? Math.round(scheduled / capacity * 100) : 0
      }
    };
  }

  /* ---------- lookups used by the views ---------- */
  function dayPlan(plan, iso) {
    if (!plan) return null;
    return plan.days.filter(function (d) { return d.date === iso; })[0] || null;
  }
  function nextBlock(plan, iso) {
    var d = dayPlan(plan, iso || S.todayISO());
    if (!d) return null;
    return d.blocks.filter(function (b) { return !b.done; })[0] || null;
  }
  /** hours per day for the next n days: [{date, planned, capacity, done}] */
  function loadSeries(plan, n) {
    var out = [], t = S.todayISO();
    for (var i = 0; i < (n || 14); i++) {
      var iso = S.addDays(t, i), d = dayPlan(plan, iso);
      out.push({
        date: iso,
        planned: d ? d.hours : 0,
        capacity: S.capacity(iso),
        done: d ? d.blocks.reduce(function (a, b) { return a + (b.done ? b.hours : 0); }, 0) : 0
      });
    }
    return out;
  }

  global.Scheduler = { generate: generate, dayPlan: dayPlan, nextBlock: nextBlock, loadSeries: loadSeries };
})(window);
