/* ===================================================================
   views.js — pure render functions (HTML strings) for every screen
   Exposes: window.Views
   =================================================================== */
(function (global) {
  'use strict';

  var S = global.Store, C = global.Charts, Sch = global.Scheduler;
  var h = C.esc;

  /* ---------------- shared helpers ---------------- */
  function subjMap(state) {
    var m = {}; state.subjects.forEach(function (s) { m[s.id] = s; }); return m;
  }
  function topicName(state, sid, tid) {
    var t = S.topic(sid, tid); return t ? t.name : 'General revision';
  }
  /** hours of capacity available between today and `endIso` (inclusive) */
  function windowCapacity(endIso) {
    var t = S.todayISO(), n = S.dayDiff(t, endIso), sum = 0;
    if (n < 0) return 0;
    for (var i = 0; i <= Math.min(n, 365); i++) sum += S.capacity(S.addDays(t, i));
    return Math.round(sum * 10) / 10;
  }
  function kpi(label, value, sub, color, extra) {
    return '<div class="card kpi" style="--c:' + color + '">' +
      '<div class="kpi-orb"></div>' +
      '<div class="kpi-label">' + h(label) + '</div>' +
      '<div class="kpi-value">' + value + '</div>' +
      '<div class="kpi-sub">' + (sub || '') + '</div>' +
      (extra || '') + '</div>';
  }
  function healthPill(state) {
    var p = state.plan;
    if (!p) return '<span class="pill neutral">No plan yet</span>';
    if (!p.deficits.length) return '<span class="pill ok">Plan fits your hours</span>';
    var total = p.deficits.reduce(function (a, d) { return a + d.hours; }, 0);
    return '<span class="pill danger">' + S.fmtHours(total) + ' will not fit</span>';
  }
  function blockRow(state, b, iso, map) {
    var s = map[b.subjectId] || { name: 'Subject', color: 'var(--muted)' };
    var isToday = iso === S.todayISO();
    return '<div class="blk ' + (b.done ? 'done' : '') + '" style="--c:' + s.color + '">' +
      '<span class="blk-time mono">' + h(b.start) + '–' + h(b.end) + '</span>' +
      '<span class="dot" style="background:' + s.color + '"></span>' +
      '<div class="grow"><div class="tname">' + h(topicName(state, b.subjectId, b.topicId)) + '</div>' +
        '<div class="tmeta"><span>' + h(s.name) + '</span><span>· ' + S.fmtHours(b.hours) + '</span>' +
        (b.type === 'revision' ? '<span class="tag">revision</span>' : '') + '</div></div>' +
      (b.done
        ? '<span class="pill ok">done</span>'
        : '<button class="btn btn-sm ' + (isToday ? 'btn-primary' : 'btn-ghost') + '" data-act="focus-block" data-id="' + b.id + '" data-date="' + iso + '">Start</button>' +
          '<button class="btn btn-sm btn-ghost" data-act="mark-block" data-id="' + b.id + '" title="Mark as done">✓</button>') +
      '</div>';
  }

  /* =================================================================
     DASHBOARD
     ================================================================= */
  function dashboard(state) {
    var map = subjMap(state), tot = S.totals(), next = S.nextExam();
    var todayIso = S.todayISO();
    var plan = state.plan;

    if (!state.subjects.length) {
      return '<div class="empty"><h4>No subjects yet</h4>' +
        '<p>Add the subjects you are being examined on, list their topics, and StudyForge will build the timetable.</p>' +
        '<div style="margin-top:16px"><button class="btn btn-primary" data-act="add-subject">Add your first subject</button> ' +
        '<button class="btn btn-ghost" data-act="load-sample">Load sample data</button></div></div>';
    }

    /* ---- KPIs ---- */
    var todayMins = S.minutesOn(todayIso);
    var weekPlanned = 0, weekCap = 0;
    for (var i = 0; i < 7; i++) {
      var iso = S.addDays(todayIso, i);
      weekCap += S.capacity(iso);
      var dp = Sch.dayPlan(plan, iso); weekPlanned += dp ? dp.hours : 0;
    }
    var streak = S.streak();
    var kpis =
      kpi('Next exam',
          next ? '<span>' + Math.max(0, S.dayDiff(todayIso, next.examDate)) + '</span><small> days</small>' : '—',
          next ? '<span class="dot" style="background:' + next.color + '"></span>' + h(next.name) + ' · ' + S.fmtDate(next.examDate)
               : 'No exam dates set',
          next ? next.color : 'var(--muted)') +
      kpi('Planned this week', S.fmtHours(weekPlanned),
          'of ' + S.fmtHours(weekCap) + ' available',
          'var(--teal)') +
      kpi('Syllabus covered', tot.pct + '<small>%</small>',
          S.fmtHours(tot.done) + ' of ' + S.fmtHours(tot.est) + ' · ' + tot.doneTopics + '/' + tot.topics + ' topics',
          'var(--accent)') +
      kpi('Today', todayMins ? S.fmtMins(todayMins) : '0h',
          streak ? '<span class="delta up">' + streak + '-day streak</span>' : 'Start a session to begin a streak',
          'var(--amber)');

    /* ---- stacked load chart ---- */
    var series = [];
    for (var d = 0; d < 14; d++) {
      var iso2 = S.addDays(todayIso, d), dp2 = Sch.dayPlan(plan, iso2);
      var segs = [], byS = {};
      if (dp2) dp2.blocks.forEach(function (b) {
        byS[b.subjectId] = (byS[b.subjectId] || 0) + b.hours;
      });
      Object.keys(byS).forEach(function (sid) {
        var s = map[sid]; if (!s) return;
        segs.push({ color: s.color, name: s.name, hours: byS[sid] });
      });
      series.push({
        date: iso2, label: S.DAY_NAMES[S.weekday(iso2)][0] + S.fromISO(iso2).getDate(),
        capacity: S.capacity(iso2), total: dp2 ? dp2.hours : 0, segs: segs, today: d === 0
      });
    }

    /* ---- donut: remaining hours by subject ---- */
    var segs = state.subjects.map(function (s) {
      var st2 = S.subjectStats(s);
      return { label: s.name, color: s.color, value: st2.remaining };
    }).filter(function (x) { return x.value > 0; });
    var remTotal = segs.reduce(function (a, x) { return a + x.value; }, 0);

    /* ---- today's blocks ---- */
    var todayPlan = Sch.dayPlan(plan, todayIso);
    var todayHtml = todayPlan && todayPlan.blocks.length
      ? '<div class="list">' + todayPlan.blocks.map(function (b) { return blockRow(state, b, todayIso, map); }).join('') + '</div>'
      : '<div class="empty small">Nothing scheduled today. ' +
        (S.capacity(todayIso) ? 'Regenerate the plan to fill it.' : 'You marked today as a rest day in Settings.') + '</div>';

    /* ---- time budget: demand vs available window ---- */
    var budget = state.subjects.slice().sort(function (a, b) {
      return (a.examDate || 'z') < (b.examDate || 'z') ? -1 : 1;
    }).map(function (s) {
      var st3 = S.subjectStats(s);
      var end = s.examDate ? S.addDays(s.examDate, -1) : S.addDays(todayIso, 21);
      var avail = windowCapacity(end);
      var need = st3.remaining * (1 + (state.settings.revisionShare || 0));
      var pct = avail ? Math.min(100, Math.round(need / avail * 100)) : 100;
      var cls = pct > 90 ? 'danger' : pct > 65 ? 'warn' : 'ok';
      return '<div class="list-row" style="padding-left:0;padding-right:0">' +
        '<span class="dot" style="background:' + s.color + '"></span>' +
        '<div class="grow"><div class="tname">' + h(s.name) + '</div>' +
        '<div class="tmeta"><span>needs ' + S.fmtHours(need) + '</span><span>· ' + S.fmtHours(avail) + ' available before exam</span></div>' +
        '<div class="bar" style="margin-top:6px"><i style="width:' + pct + '%;background:' + s.color + '"></i></div></div>' +
        '<span class="pill ' + cls + '">' + pct + '%</span></div>';
    }).join('');

    /* ---- deficit banner ---- */
    var banner = '';
    if (plan && plan.deficits.length) {
      banner = '<div class="callout"><b>Your plan does not fit.</b> ' +
        plan.deficits.map(function (d) {
          return h(d.name) + ' is short ' + S.fmtHours(d.hours) +
                 (d.daysLeft != null ? ' (' + d.daysLeft + ' days left)' : '');
        }).join(' · ') +
        '<div style="margin-top:10px" class="row wrap">' +
        '<button class="btn btn-sm btn-soft" data-act="go" data-view="settings">Add more study hours</button>' +
        '<button class="btn btn-sm btn-ghost" data-act="trim-scope">Lower estimates by 15%</button></div></div>';
    }

    return '' +
      '<div class="stack">' +
        banner +
        '<div class="grid g-kpi">' + kpis + '</div>' +

        '<div class="grid g-2">' +
          '<div class="card"><div class="card-head"><div><h3>Study load — next 14 days</h3>' +
            '<p>Stacked by subject. Dashed line is the time you said you have.</p></div>' + healthPill(state) + '</div>' +
            C.loadChart(series) + C.legend(state.subjects.map(function (s) { return { label: s.name, color: s.color }; })) +
          '</div>' +
          '<div class="card"><div class="card-head"><div><h3>Hours still to do</h3>' +
            '<p>Remaining across all topics</p></div></div>' +
            C.donut(segs, S.fmtHours(remTotal), 'remaining') +
            '<div class="list" style="margin-top:8px">' + (state.subjects.map(function (s) {
              var st4 = S.subjectStats(s);
              return '<div class="list-row" style="padding-left:0;padding-right:0">' +
                '<span class="dot" style="background:' + s.color + '"></span>' +
                '<div class="grow"><div class="tname">' + h(s.name) + '</div>' +
                '<div class="tmeta"><span>' + st4.doneTopics + '/' + st4.topics + ' topics done</span></div></div>' +
                '<b class="mono small">' + S.fmtHours(st4.remaining) + '</b></div>';
            }).join('')) + '</div>' +
          '</div>' +
        '</div>' +

        '<div class="grid g-2">' +
          '<div class="card card-pad-0"><div class="card-head" style="padding:18px 18px 0"><div><h3>Today · ' + S.fmtDate(todayIso, { weekday: 'long', day: 'numeric', month: 'long' }) + '</h3>' +
            '<p>' + (todayPlan ? todayPlan.blocks.filter(function (b) { return b.done; }).length + ' of ' + todayPlan.blocks.length + ' blocks done' : 'No blocks') + '</p></div>' +
            '<button class="btn btn-sm btn-soft" data-act="go" data-view="schedule">Full schedule</button></div>' +
            '<div style="padding:10px 0 0">' + todayHtml + '</div></div>' +
          '<div class="card"><div class="card-head"><div><h3>Time budget</h3>' +
            '<p>Work remaining vs hours left before each exam</p></div></div>' +
            '<div class="list">' + budget + '</div></div>' +
        '</div>' +

        '<div class="card"><div class="card-head"><div><h3>Subject progress</h3>' +
          '<p>Hours studied against your estimate</p></div>' +
          '<button class="btn btn-sm btn-ghost" data-act="go" data-view="subjects">Manage subjects</button></div>' +
          C.subjectBars(state.subjects.map(function (s) {
            var st5 = S.subjectStats(s);
            return { label: s.name, color: s.color, done: st5.done, total: st5.est, pct: st5.pct };
          })) +
        '</div>' +
      '</div>';
  }

  /* =================================================================
     SUBJECTS
     ================================================================= */
  function subjects(state) {
    if (!state.subjects.length) {
      return '<div class="empty"><h4>No subjects</h4><p>Start by adding a subject and its exam date.</p>' +
        '<div style="margin-top:14px"><button class="btn btn-primary" data-act="add-subject">Add subject</button> ' +
        '<button class="btn btn-ghost" data-act="load-sample">Load sample data</button></div></div>';
    }
    var cards = state.subjects.map(function (s) {
      var st = S.subjectStats(s);
      var dl = st.daysLeft;
      var pill = dl == null ? '<span class="pill neutral">no date</span>'
               : dl < 0 ? '<span class="pill neutral">past</span>'
               : dl <= 3 ? '<span class="pill danger">' + dl + 'd left</span>'
               : dl <= 10 ? '<span class="pill warn">' + dl + 'd left</span>'
               : '<span class="pill ok">' + dl + 'd left</span>';

      var topics = s.topics.length ? s.topics.map(function (t) {
        var rem = Math.max(0, (t.estHours || 0) - (t.doneHours || 0));
        return '<div class="topic ' + (t.status === 'done' ? 'done' : '') + '">' +
          '<button class="chk" data-act="toggle-topic" data-sid="' + s.id + '" data-tid="' + t.id + '" title="Mark done">' +
            '<svg viewBox="0 0 12 12"><path d="M1 6l3.2 3.4L11 2.4"/></svg></button>' +
          '<div class="grow"><div class="tname">' + h(t.name) + '</div>' +
            '<div class="tmeta"><span>' + S.fmtHours(t.doneHours || 0) + ' / ' + S.fmtHours(t.estHours || 0) + '</span>' +
            '<span>· ' + ['low', 'low', 'medium', 'high'][t.priority || 2] + ' priority</span>' +
            '<span>· confidence ' + (t.confidence || 3) + '/5</span>' +
            (rem > 0 ? '<span>· ' + S.fmtHours(rem) + ' left</span>' : '') + '</div></div>' +
          '<div class="topic-actions">' +
            '<button class="icon-btn" data-act="focus-topic" data-sid="' + s.id + '" data-tid="' + t.id + '" title="Study this now">' +
              '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg></button>' +
            '<button class="icon-btn" data-act="edit-topic" data-sid="' + s.id + '" data-tid="' + t.id + '" title="Edit">' +
              '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/></svg></button>' +
            '<button class="icon-btn" data-act="del-topic" data-sid="' + s.id + '" data-tid="' + t.id + '" title="Delete">' +
              '<svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13H7L6 7Zm3-3h6l1 2H8l1-2Z"/></svg></button>' +
          '</div></div>';
      }).join('') : '<div class="empty small" style="margin-top:10px;padding:20px">No topics yet — add the chapters you need to cover.</div>';

      return '<div class="card subj" style="--c:' + s.color + '">' +
        '<div class="subj-top"><div style="min-width:0">' +
          '<h3>' + h(s.name) + '</h3>' +
          '<div class="subj-meta">' + pill +
            (s.examDate ? '<span>' + S.fmtDate(s.examDate, { day: 'numeric', month: 'short', year: 'numeric' }) + '</span>' : '') +
            '<span>· difficulty ' + (s.difficulty || 3) + '/5</span>' +
            '<span>· ' + S.fmtHours(st.remaining) + ' to go</span>' +
          '</div></div>' +
          '<div class="row">' + C.ring(st.pct, s.color, 44) +
            '<button class="icon-btn" data-act="edit-subject" data-sid="' + s.id + '" title="Edit subject">' +
              '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/></svg></button>' +
            '<button class="icon-btn" data-act="del-subject" data-sid="' + s.id + '" title="Delete subject">' +
              '<svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13H7L6 7Zm3-3h6l1 2H8l1-2Z"/></svg></button>' +
          '</div></div>' +
        '<div class="bar" style="margin:12px 0 4px"><i style="width:' + st.pct + '%;background:' + s.color + '"></i></div>' +
        '<div class="row-between small muted"><span>' + st.doneTopics + ' of ' + st.topics + ' topics complete</span>' +
          '<span>' + S.fmtHours(st.done) + ' / ' + S.fmtHours(st.est) + '</span></div>' +
        topics +
        '<button class="btn btn-sm btn-ghost" style="margin-top:10px;width:100%" data-act="add-topic" data-sid="' + s.id + '">+ Add topic</button>' +
      '</div>';
    }).join('');

    return '<div class="stack">' +
      '<div class="row-between wrap"><p class="muted small">' + state.subjects.length + ' subjects · ' +
        S.totals().topics + ' topics · ' + S.fmtHours(S.totals().est) + ' estimated</p>' +
      '<button class="btn btn-primary" data-act="add-subject">+ New subject</button></div>' +
      '<div class="grid g-3">' + cards + '</div></div>';
  }

  /* =================================================================
     SCHEDULE
     ================================================================= */
  function schedule(state, opts) {
    opts = opts || {};
    var plan = state.plan, map = subjMap(state), todayIso = S.todayISO();
    if (!plan || !plan.days.length) {
      return '<div class="empty"><h4>No schedule yet</h4>' +
        '<p>Generate a plan and StudyForge will spread every topic across the hours you have before each exam.</p>' +
        '<div style="margin-top:14px"><button class="btn btn-primary" data-act="regenerate">Generate my plan</button></div></div>';
    }

    /* week strip */
    var strip = '';
    for (var i = 0; i < 7; i++) {
      var iso = S.addDays(todayIso, i), dp = Sch.dayPlan(plan, iso);
      var cap = S.capacity(iso), planned = dp ? dp.hours : 0;
      var uniq = {};
      if (dp) dp.blocks.forEach(function (b) { uniq[b.subjectId] = 1; });
      strip += '<div class="wk ' + (i === 0 ? 'is-today' : '') + '">' +
        '<div class="wk-d">' + S.DAY_NAMES[S.weekday(iso)] + '</div>' +
        '<div class="wk-n">' + S.fromISO(iso).getDate() + '</div>' +
        '<div class="wk-h">' + (planned ? S.fmtHours(planned) : '—') + '</div>' +
        '<div class="wk-bars">' + Object.keys(uniq).map(function (sid) {
          return '<i style="background:' + ((map[sid] || {}).color || 'var(--muted)') + '"></i>';
        }).join('') + '</div>' +
        '<div class="small muted" style="margin-top:4px;font-size:10px">' + (cap ? cap + 'h free' : 'rest') + '</div>' +
      '</div>';
    }

    var limit = opts.showAll ? plan.days.length : 10;
    var dayCards = plan.days.slice(0, limit).map(function (d) {
      if (!d.blocks.length && d.date !== todayIso) return '';
      var exams = state.subjects.filter(function (s) { return s.examDate === d.date; });
      return '<div class="day ' + (d.date === todayIso ? 'is-today' : '') + '">' +
        '<div class="day-head"><div><div class="d-date">' +
          (d.date === todayIso ? 'Today · ' : '') + S.fmtDate(d.date, { weekday: 'long', day: 'numeric', month: 'short' }) + '</div>' +
          '<div class="d-sub">' + S.fmtHours(d.hours) + ' scheduled of ' + S.fmtHours(d.capacity) + ' available</div></div>' +
        '<div class="row">' + exams.map(function (e) {
          return '<span class="pill danger">' + h(e.name) + ' exam</span>';
        }).join('') + '</div></div>' +
        (d.blocks.length
          ? d.blocks.map(function (b) { return blockRow(state, b, d.date, map); }).join('')
          : '<div class="empty small" style="border:0;padding:18px">Free day</div>') +
      '</div>';
    }).join('');

    var deficits = plan.deficits.length
      ? '<div class="callout"><b>Not everything fits.</b><div class="list" style="margin-top:8px">' +
        plan.deficits.map(function (d) {
          return '<div class="list-row" style="padding-left:0;padding-right:0"><span class="dot" style="background:' + d.color + '"></span>' +
            '<div class="grow"><div class="tname">' + h(d.name) + '</div><div class="tmeta">' +
            S.fmtHours(d.hours) + ' could not be placed before ' + S.fmtDate(d.examDate || '') + '</div></div></div>';
        }).join('') + '</div>' +
        '<p style="margin-top:10px">Fix it by raising your daily hours, trimming topic estimates, or dropping a low-priority topic.</p></div>'
      : '';

    return '<div class="stack">' +
      '<div class="row-between wrap"><div><p class="small muted">Generated ' +
        new Date(plan.generatedAt).toLocaleString() + ' · ' + S.fmtHours(plan.summary.scheduled) +
        ' across ' + plan.days.filter(function (d) { return d.blocks.length; }).length + ' days · ' +
        plan.summary.utilisation + '% of your free time used</p></div>' +
      '<div class="row">' + healthPill(state) +
        '<button class="btn btn-ghost btn-sm" data-act="regenerate">Regenerate</button></div></div>' +
      deficits +
      '<div class="card"><div class="card-head"><div><h3>This week</h3><p>Colour bars show which subjects land on each day</p></div></div>' +
        '<div class="week-strip">' + strip + '</div></div>' +
      '<div class="stack">' + dayCards + '</div>' +
      (plan.days.length > limit
        ? '<button class="btn btn-ghost" style="width:100%" data-act="show-all-days">Show all ' + plan.days.length + ' days</button>'
        : '') +
    '</div>';
  }

  /* =================================================================
     FOCUS LOCK
     ================================================================= */
  function focus(state) {
    var todayIso = S.todayISO(), map = subjMap(state);
    var next = Sch.nextBlock(state.plan, todayIso);
    var s = state.settings;

    var options = '<option value="">Free study (no topic)</option>';
    state.subjects.forEach(function (sub) {
      options += '<optgroup label="' + h(sub.name) + '">';
      sub.topics.forEach(function (t) {
        options += '<option value="' + sub.id + '|' + t.id + '"' +
          (next && next.subjectId === sub.id && next.topicId === t.id ? ' selected' : '') + '>' +
          h(t.name) + ' — ' + S.fmtHours(Math.max(0, (t.estHours || 0) - (t.doneHours || 0))) + ' left</option>';
      });
      options += '</optgroup>';
    });

    var recent = state.sessions.slice(-8).reverse().map(function (ss) {
      var sub = map[ss.subjectId];
      return '<div class="list-row">' +
        '<span class="dot" style="background:' + (sub ? sub.color : 'var(--muted)') + '"></span>' +
        '<div class="grow"><div class="tname">' + h(ss.topicId ? topicName(state, ss.subjectId, ss.topicId) : 'Free study') + '</div>' +
          '<div class="tmeta"><span>' + (sub ? h(sub.name) : 'Unassigned') + '</span><span>· ' + S.fmtDate(ss.date) + '</span></div></div>' +
        '<span class="mono small">' + S.fmtMins(ss.minutes) + '</span>' +
        '<span class="pill ' + (ss.focusScore >= 90 ? 'ok' : ss.focusScore >= 70 ? 'warn' : 'danger') + '">' + ss.focusScore + '</span>' +
      '</div>';
    }).join('') || '<div class="empty small">No sessions logged yet.</div>';

    return '<div class="stack">' +
      '<div class="focus-hero">' +
        '<div class="stack" style="gap:14px">' +
          '<div><h2 style="font-size:22px">Lock in and study</h2>' +
          '<p class="muted small" style="margin-top:5px">Fullscreen kiosk mode, screen kept awake, and every escape attempt recorded against your focus score.</p></div>' +
          '<div class="form-grid">' +
            '<div class="field"><label>What are you studying?</label><select id="focusTask">' + options + '</select></div>' +
            '<div class="field"><label>Block length</label>' +
              '<select id="focusLen">' + [15, 25, 30, 45, 50, 60, 90].map(function (m) {
                return '<option value="' + m + '"' + (m === s.blockMinutes ? ' selected' : '') + '>' + m + ' minutes</option>';
              }).join('') + '</select></div>' +
            '<div class="field"><label>Break after each block</label>' +
              '<select id="focusBreak">' + [0, 5, 10, 15, 20].map(function (m) {
                return '<option value="' + m + '"' + (m === s.breakMinutes ? ' selected' : '') + '>' + (m ? m + ' minutes' : 'No break') + '</option>';
              }).join('') + '</select></div>' +
            '<div class="field"><label>Enforcement</label>' +
              '<label class="switch" style="margin-top:6px"><input type="checkbox" id="focusStrict"' + (s.strictLock ? ' checked' : '') + '>' +
              '<span class="track"></span><span class="small">Strict — pause the clock and alarm on every escape</span></label></div>' +
          '</div>' +
          '<div class="row wrap"><button class="btn btn-primary btn-lg" data-act="start-focus">Start focus lock</button>' +
            (next ? '<span class="small muted">Next in your plan: <b>' + h(topicName(state, next.subjectId, next.topicId)) + '</b> · ' + S.fmtHours(next.hours) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="shield">' +
          '<div class="sec-title">What gets locked</div>' +
          [['FS', 'Fullscreen kiosk mode — the rest of the browser disappears'],
           ['ZZ', 'Screen wake-lock — your device will not sleep mid-block'],
           ['TB', 'Tab switch and window blur are detected and alarmed'],
           ['NV', 'Closing or reloading the tab triggers a browser warning'],
           ['3s', 'Quitting needs a deliberate 3-second hold, not a click'],
           ['SC', 'Every breach is scored and stored in your history']].map(function (r) {
            return '<div class="shield-item"><span class="s-ico">' + r[0] + '</span><span>' + r[1] + '</span></div>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<div class="callout">' +
        '<b>Straight answer on “disable my device”:</b> a web page is sandboxed — it cannot power off your phone, ' +
        'kill other apps, or block websites on its own. Focus Lock takes the browser as far as the browser allows. ' +
        'To hard-block the rest of the machine, pair it with the OS tools below — you run them once and they hold.' +
      '</div>' +

      '<div class="grid g-2e">' +
        '<div class="card"><div class="card-head"><div><h3>Windows — hard block</h3><p>Run in an admin PowerShell before a session</p></div></div>' +
          '<p class="small muted" style="margin-bottom:8px">1. Turn on Focus Assist: <b>Settings → System → Focus</b> (silences every notification).</p>' +
          '<p class="small muted" style="margin-bottom:8px">2. Block the sites that pull you away by pointing them at nowhere:</p>' +
          '<pre class="code">$sites = "www.youtube.com","www.instagram.com","x.com","www.reddit.com"\n$hosts = "$env:WinDir\\System32\\drivers\\etc\\hosts"\n$sites | % { Add-Content $hosts "127.0.0.1 $_" }\nipconfig /flushdns</pre>' +
          '<p class="small muted" style="margin-top:8px">To undo, open that hosts file in Notepad (as admin) and delete the lines you added.</p>' +
          '<button class="btn btn-sm btn-ghost" style="margin-top:10px" data-act="copy-block">Copy script</button>' +
        '</div>' +
        '<div class="card"><div class="card-head"><div><h3>Phone — hard block</h3><p>The device you actually pick up</p></div></div>' +
          '<div class="shield">' +
          [['iOS', 'Settings → Screen Time → App Limits, then Downtime for your study window'],
           ['iOS', 'Focus → Do Not Disturb, and add a schedule that matches your blocks'],
           ['And', 'Digital Wellbeing → Focus mode → pick the apps and hit Turn on now'],
           ['And', 'Bedtime mode greys the screen — surprisingly effective mid-revision'],
           ['All', 'Put the phone in another room. Nothing beats distance.']].map(function (r) {
            return '<div class="shield-item"><span class="s-ico">' + r[0] + '</span><span>' + r[1] + '</span></div>';
          }).join('') + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="card card-pad-0"><div class="card-head" style="padding:18px 18px 4px"><div><h3>Recent sessions</h3>' +
        '<p>Focus score drops 8 points per breach</p></div>' +
        '<button class="btn btn-sm btn-ghost" data-act="go" data-view="insights">All history</button></div>' +
        '<div class="list">' + recent + '</div></div>' +
    '</div>';
  }

  /* =================================================================
     INSIGHTS
     ================================================================= */
  function insights(state) {
    var map = subjMap(state), todayIso = S.todayISO();
    var sessions = state.sessions.slice().sort(function (a, b) { return b.end - a.end; });

    /* heatmap: 12 weeks aligned to Sunday */
    var cells = [], start = S.addDays(todayIso, -(11 * 7 + S.weekday(todayIso)));
    for (var i = 0; i <= S.dayDiff(start, todayIso); i++) {
      var iso = S.addDays(start, i);
      cells.push({ date: iso, label: S.fmtDate(iso), minutes: S.minutesOn(iso) });
    }

    var last14 = [], scores = [];
    for (var d = 13; d >= 0; d--) last14.push(S.minutesOn(S.addDays(todayIso, -d)));
    sessions.slice(0, 20).reverse().forEach(function (s) { scores.push(s.focusScore); });

    var totalMins = state.sessions.reduce(function (a, s) { return a + s.minutes; }, 0);
    var breaches = state.sessions.reduce(function (a, s) { return a + (s.breaches || 0); }, 0);
    var avgScore = state.sessions.length
      ? Math.round(state.sessions.reduce(function (a, s) { return a + s.focusScore; }, 0) / state.sessions.length) : 100;
    var days = {};
    state.sessions.forEach(function (s) { days[s.date] = 1; });
    var activeDays = Object.keys(days).length;

    /* time split by subject */
    var bySub = {};
    state.sessions.forEach(function (s) { if (s.subjectId) bySub[s.subjectId] = (bySub[s.subjectId] || 0) + s.minutes; });
    var segs = Object.keys(bySub).map(function (sid) {
      var sub = map[sid];
      return { label: sub ? sub.name : 'Removed', color: sub ? sub.color : 'var(--muted)', value: bySub[sid] / 60 };
    }).sort(function (a, b) { return b.value - a.value; });

    /* best hour of day */
    var hours = new Array(24).fill(0);
    state.sessions.forEach(function (s) { hours[new Date(s.start).getHours()] += s.minutes; });
    var bestHour = hours.indexOf(Math.max.apply(null, hours));

    var log = sessions.slice(0, 25).map(function (ss) {
      var sub = map[ss.subjectId];
      return '<div class="list-row">' +
        '<span class="mono small muted" style="width:104px;flex:none">' + S.fmtDate(ss.date) + '</span>' +
        '<span class="dot" style="background:' + (sub ? sub.color : 'var(--muted)') + '"></span>' +
        '<div class="grow"><div class="tname">' + h(ss.topicId ? topicName(state, ss.subjectId, ss.topicId) : 'Free study') + '</div>' +
          '<div class="tmeta"><span>' + (sub ? h(sub.name) : 'Unassigned') + '</span>' +
          (ss.breaches ? '<span>· ' + ss.breaches + ' breach' + (ss.breaches > 1 ? 'es' : '') + '</span>' : '<span>· clean run</span>') + '</div></div>' +
        '<span class="mono small">' + S.fmtMins(ss.minutes) + '</span>' +
        '<span class="pill ' + (ss.focusScore >= 90 ? 'ok' : ss.focusScore >= 70 ? 'warn' : 'danger') + '">' + ss.focusScore + '</span>' +
      '</div>';
    }).join('') || '<div class="empty small">No sessions yet.</div>';

    return '<div class="stack">' +
      '<div class="grid g-kpi">' +
        kpi('Total studied', S.fmtMins(totalMins), state.sessions.length + ' sessions', 'var(--accent)') +
        kpi('Average focus', avgScore + '<small>/100</small>', breaches + ' breaches all time', 'var(--teal)') +
        kpi('Active days', activeDays, 'Current streak ' + S.streak() + ' days', 'var(--amber)') +
        kpi('Peak hour', S.pad(bestHour) + ':00', totalMins ? 'When you study best' : 'Not enough data', 'var(--violet)') +
      '</div>' +

      '<div class="grid g-2">' +
        '<div class="card"><div class="card-head"><div><h3>Consistency</h3><p>Last 12 weeks — darker means more minutes</p></div>' +
          C.spark(last14, 'var(--accent)') + '</div>' + C.heatmap(cells) + '</div>' +
        '<div class="card"><div class="card-head"><div><h3>Where your time went</h3><p>Logged hours by subject</p></div></div>' +
          C.donut(segs, S.fmtMins(totalMins), 'logged') +
          C.legend(segs.map(function (s) { return { label: s.label + ' · ' + s.value.toFixed(1) + 'h', color: s.color }; })) +
        '</div>' +
      '</div>' +

      '<div class="card card-pad-0"><div class="card-head" style="padding:18px 18px 4px"><div><h3>Session log</h3>' +
        '<p>Most recent first</p></div>' +
        '<button class="btn btn-sm btn-ghost" data-act="export">Export JSON</button></div>' +
        '<div class="list">' + log + '</div></div>' +
    '</div>';
  }

  /* =================================================================
     SETTINGS
     ================================================================= */
  function settings(state) {
    var s = state.settings;
    var avail = S.DAY_NAMES.map(function (n, i) {
      return '<div class="field"><label>' + n + '</label>' +
        '<input type="number" min="0" max="16" step="0.5" value="' + (state.availability[i] || 0) + '" data-act="avail" data-day="' + i + '"></div>';
    }).join('');

    var totalWeek = S.DAY_NAMES.reduce(function (a, n, i) { return a + (Number(state.availability[i]) || 0); }, 0);

    var exceptions = Object.keys(state.exceptions).sort().map(function (iso) {
      return '<div class="list-row" style="padding-left:0;padding-right:0">' +
        '<div class="grow"><div class="tname">' + S.fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + '</div>' +
        '<div class="tmeta">' + (Number(state.exceptions[iso]) ? S.fmtHours(state.exceptions[iso]) + ' instead of usual' : 'Rest day — no study') + '</div></div>' +
        '<button class="icon-btn" data-act="del-exception" data-date="' + iso + '">' +
        '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" fill="none"/></svg></button></div>';
    }).join('') || '<div class="empty small" style="padding:18px">No exceptions. Add one for a holiday, a rest day, or a heavy weekend.</div>';

    function toggle(id, label, on, hint) {
      return '<label class="switch" style="align-items:flex-start"><input type="checkbox" data-act="setting" data-key="' + id + '"' + (on ? ' checked' : '') + '>' +
        '<span class="track" style="margin-top:2px"></span>' +
        '<span><b class="small">' + label + '</b><br><span class="small muted">' + hint + '</span></span></label>';
    }

    return '<div class="stack">' +
      '<div class="grid g-2e">' +
        '<div class="card"><div class="card-head"><div><h3>Hours available each week</h3>' +
          '<p>How much you can realistically study on each weekday</p></div>' +
          '<span class="pill ' + (totalWeek >= 14 ? 'ok' : totalWeek >= 7 ? 'warn' : 'danger') + '">' + totalWeek + 'h / week</span></div>' +
          '<div class="form-grid" style="grid-template-columns:repeat(7,1fr);gap:8px">' + avail + '</div>' +
          '<p class="small muted" style="margin-top:12px">This is the single biggest input to your plan. Be honest — an over-promised timetable is one you abandon.</p>' +
        '</div>' +
        '<div class="card"><div class="card-head"><div><h3>Day exceptions</h3><p>Override a specific date</p></div></div>' +
          '<div class="row" style="margin-bottom:10px">' +
            '<input type="date" id="excDate" style="flex:1">' +
            '<input type="number" id="excHours" min="0" max="16" step="0.5" value="0" style="width:90px" title="Hours">' +
            '<button class="btn btn-ghost btn-sm" data-act="add-exception">Add</button></div>' +
          '<div class="list">' + exceptions + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="grid g-2e">' +
        '<div class="card"><div class="card-head"><div><h3>How plans are built</h3><p>Tune the scheduling engine</p></div></div>' +
          '<div class="form-grid">' +
            '<div class="field"><label>Study block length</label>' +
              '<select data-act="setting" data-key="blockMinutes">' + [15, 25, 30, 45, 50, 60, 90].map(function (m) {
                return '<option value="' + m + '"' + (m === s.blockMinutes ? ' selected' : '') + '>' + m + ' min</option>';
              }).join('') + '</select></div>' +
            '<div class="field"><label>Break between blocks</label>' +
              '<select data-act="setting" data-key="breakMinutes">' + [0, 5, 10, 15, 20].map(function (m) {
                return '<option value="' + m + '"' + (m === s.breakMinutes ? ' selected' : '') + '>' + (m ? m + ' min' : 'None') + '</option>';
              }).join('') + '</select></div>' +
            '<div class="field"><label>Day starts at</label>' +
              '<input type="time" value="' + s.dayStart + '" data-act="setting" data-key="dayStart"></div>' +
            '<div class="field"><label>Revision share — ' + Math.round((s.revisionShare || 0) * 100) + '%</label>' +
              '<input type="range" min="0" max="50" step="5" value="' + Math.round((s.revisionShare || 0) * 100) + '" data-act="setting" data-key="revisionShare">' +
              '<span class="hint">Extra time reserved to re-cover weak topics</span></div>' +
            '<div class="field full">' + toggle('interleave', 'Interleave subjects',
              s.interleave !== false, 'Rotate between subjects inside a day instead of one long single-subject slog') + '</div>' +
          '</div>' +
          '<button class="btn btn-primary btn-sm" style="margin-top:14px" data-act="regenerate">Apply and regenerate plan</button>' +
        '</div>' +

        '<div class="card"><div class="card-head"><div><h3>Focus Lock</h3><p>How hard the lock pushes back</p></div></div>' +
          '<div class="stack" style="gap:14px">' +
            toggle('strictLock', 'Strict mode', s.strictLock,
              'Leaving the window stops the clock and throws a full-screen alarm until you return') +
            toggle('blockNav', 'Guard against closing the tab', s.blockNav,
              'The browser asks for confirmation before you can reload or close mid-session') +
            toggle('soundAlerts', 'Sound alerts', s.soundAlerts,
              'Chime at block end, alarm on a breach') +
          '</div>' +
          '<div class="callout" style="margin-top:14px;border-left-color:var(--accent)">' +
            'A browser tab cannot switch off your device. For a real block use <b>Windows Focus Assist</b>, ' +
            '<b>iOS Screen Time</b> or <b>Android Digital Wellbeing</b> — the Focus Lock screen has the exact steps.' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="card"><div class="card-head"><div><h3>Your data</h3>' +
        '<p>Everything lives in this browser only — nothing is uploaded anywhere</p></div></div>' +
        '<div class="row wrap">' +
          '<button class="btn btn-ghost" data-act="export">Export backup</button>' +
          '<button class="btn btn-ghost" data-act="import">Import backup</button>' +
          '<button class="btn btn-ghost" data-act="load-sample">Reload sample data</button>' +
          '<button class="btn btn-danger" data-act="wipe">Erase everything</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  global.Views = { dashboard: dashboard, subjects: subjects, schedule: schedule,
                   focus: focus, insights: insights, settings: settings };
})(window);
