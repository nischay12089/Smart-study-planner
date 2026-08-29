/* ===================================================================
   store.js — state, persistence, date helpers, seed data
   Exposes: window.Store
   =================================================================== */
(function (global) {
  'use strict';

  var KEY = 'studyforge.state.v1';

  /* ---------------- date helpers ---------------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fromISO(s) { var p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function todayISO() { return toISO(new Date()); }
  function addDays(iso, n) { var d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
  function dayDiff(a, b) { return Math.round((fromISO(b) - fromISO(a)) / 86400000); }
  function weekday(iso) { return fromISO(iso).getDay(); }               // 0=Sun
  function fmtDate(iso, opt) {
    return fromISO(iso).toLocaleDateString(undefined,
      opt || { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function fmtHours(h) {
    if (!h) return '0h';
    var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    if (mm === 60) { hh += 1; mm = 0; }
    return (hh ? hh + 'h' : '') + (mm ? (hh ? ' ' : '') + mm + 'm' : (hh ? '' : '0h'));
  }
  function fmtMins(m) { return fmtHours(m / 60); }
  function minsToClock(startMin) { return pad(Math.floor(startMin / 60) % 24) + ':' + pad(Math.round(startMin % 60)); }
  function clockToMins(c) { var p = String(c || '08:00').split(':').map(Number); return p[0] * 60 + (p[1] || 0); }

  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /* ---------------- palette ---------------- */
  var PALETTE = ['#5b6cff', '#0ea98a', '#f5a524', '#e0455c', '#8b5cf6',
                 '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];

  var uid = (function () { var n = 0; return function (p) { n++; return (p || 'id') + '_' + Date.now().toString(36) + n.toString(36); }; })();

  /* ---------------- defaults ---------------- */
  function defaultState() {
    return {
      version: 1,
      settings: {
        theme: 'dark',
        blockMinutes: 45,
        breakMinutes: 10,
        dayStart: '08:00',
        revisionShare: 0.25,
        interleave: true,
        strictLock: true,
        blockNav: true,
        soundAlerts: true,
        onboarded: false
      },
      /* hours available per weekday, 0 = Sunday */
      availability: { 0: 5, 1: 2, 2: 2, 3: 2, 4: 2, 5: 3, 6: 6 },
      exceptions: {},          // { 'YYYY-MM-DD': hours }
      subjects: [],
      plan: null,              // { generatedAt, start, end, days:[{date,capacity,blocks:[]}], deficits:[] }
      sessions: [],            // logged study sessions
      lastView: 'dashboard'
    };
  }

  /* ---------------- seed (sample data) ---------------- */
  function seedState() {
    var s = defaultState();
    var t = todayISO();
    function subj(name, color, days, diff, topics) {
      return {
        id: uid('sub'), name: name, color: color, examDate: addDays(t, days),
        difficulty: diff, createdAt: Date.now(),
        topics: topics.map(function (x) {
          return { id: uid('top'), name: x[0], estHours: x[1], priority: x[2], confidence: x[3], doneHours: 0, status: 'todo' };
        })
      };
    }
    s.subjects = [
      subj('Physics', PALETTE[0], 12, 5, [
        ['Rotational Motion', 6, 3, 2], ['Thermodynamics', 5, 3, 2], ['Wave Optics', 4, 2, 3],
        ['Electrostatics', 6, 3, 1], ['Modern Physics', 3, 1, 4]
      ]),
      subj('Mathematics', PALETTE[1], 16, 4, [
        ['Integral Calculus', 7, 3, 2], ['Probability', 4, 2, 3], ['Matrices & Determinants', 3, 1, 4],
        ['3D Geometry', 5, 2, 2], ['Differential Equations', 5, 3, 2]
      ]),
      subj('Chemistry', PALETTE[2], 20, 3, [
        ['Chemical Kinetics', 4, 2, 3], ['Organic Reactions', 8, 3, 1],
        ['Electrochemistry', 4, 2, 2], ['Coordination Compounds', 4, 2, 3]
      ]),
      subj('Computer Science', PALETTE[4], 26, 3, [
        ['Data Structures', 6, 3, 3], ['DBMS & SQL', 5, 2, 3],
        ['Operating Systems', 5, 2, 2], ['Computer Networks', 4, 1, 3]
      ])
    ];
    /* a little history so charts have shape */
    var now = Date.now();
    for (var i = 14; i >= 1; i--) {
      var n = (i % 4 === 0) ? 0 : 1 + (i % 3);
      for (var k = 0; k < n; k++) {
        var sub = s.subjects[(i + k) % s.subjects.length];
        var top = sub.topics[(i + k) % sub.topics.length];
        var mins = [25, 45, 45, 60, 50][(i + k) % 5];
        var end = now - i * 86400000 + k * 5400000;
        s.sessions.push({
          id: uid('ses'), subjectId: sub.id, topicId: top.id,
          start: end - mins * 60000, end: end, minutes: mins,
          breaches: (i + k) % 5 === 0 ? 2 : 0, completed: true,
          focusScore: (i + k) % 5 === 0 ? 78 : 96, date: toISO(new Date(end))
        });
        top.doneHours = Math.round((top.doneHours + mins / 60) * 100) / 100;
      }
    }
    s.subjects.forEach(function (sb) {
      sb.topics.forEach(function (tp) {
        if (tp.doneHours >= tp.estHours) { tp.doneHours = tp.estHours; tp.status = 'done'; }
        else if (tp.doneHours > 0) tp.status = 'doing';
      });
    });
    return s;
  }

  /* ---------------- persistence ---------------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      var d = defaultState();
      s.settings = Object.assign({}, d.settings, s.settings || {});
      s.availability = Object.assign({}, d.availability, s.availability || {});
      s.exceptions = s.exceptions || {};
      s.subjects = s.subjects || [];
      s.sessions = s.sessions || [];
      return s;
    } catch (e) { console.warn('[StudyForge] load failed', e); return null; }
  }

  var state = load() || seedState();
  var listeners = [];
  var saveTimer = null;

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(KEY, JSON.stringify(state)); }
      catch (e) { console.warn('[StudyForge] save failed', e); }
    }, 120);
  }
  function emit() { listeners.slice().forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } }); }

  /* ---------------- api ---------------- */
  var Store = {
    KEY: KEY, PALETTE: PALETTE, DAY_NAMES: DAY_NAMES, uid: uid,
    toISO: toISO, fromISO: fromISO, todayISO: todayISO, addDays: addDays, dayDiff: dayDiff,
    weekday: weekday, fmtDate: fmtDate, fmtHours: fmtHours, fmtMins: fmtMins,
    minsToClock: minsToClock, clockToMins: clockToMins, pad: pad,

    get: function () { return state; },
    subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    /** mutate state then persist + notify */
    update: function (fn) { fn(state); persist(); emit(); },
    /** persist + notify without mutation fn */
    touch: function () { persist(); emit(); },
    replace: function (next) { state = next; persist(); emit(); },
    reset: function (withSeed) { state = withSeed ? seedState() : defaultState(); persist(); emit(); },
    defaults: defaultState,

    /* ---- derived selectors ---- */
    subject: function (id) { return state.subjects.filter(function (s) { return s.id === id; })[0] || null; },
    topic: function (sid, tid) {
      var s = Store.subject(sid); if (!s) return null;
      return s.topics.filter(function (t) { return t.id === tid; })[0] || null;
    },
    /** capacity in hours for a given date */
    capacity: function (iso) {
      if (Object.prototype.hasOwnProperty.call(state.exceptions, iso)) return Number(state.exceptions[iso]) || 0;
      return Number(state.availability[weekday(iso)]) || 0;
    },
    subjectStats: function (s) {
      var est = 0, done = 0, doneTopics = 0;
      s.topics.forEach(function (t) {
        est += Number(t.estHours) || 0;
        done += Math.min(Number(t.doneHours) || 0, Number(t.estHours) || 0);
        if (t.status === 'done') doneTopics++;
      });
      var days = s.examDate ? dayDiff(todayISO(), s.examDate) : null;
      return {
        est: est, done: done, remaining: Math.max(0, est - done),
        pct: est ? Math.min(100, Math.round(done / est * 100)) : 0,
        topics: s.topics.length, doneTopics: doneTopics, daysLeft: days
      };
    },
    totals: function () {
      var est = 0, done = 0, topics = 0, doneTopics = 0;
      state.subjects.forEach(function (s) {
        var st = Store.subjectStats(s);
        est += st.est; done += st.done; topics += st.topics; doneTopics += st.doneTopics;
      });
      return { est: est, done: done, remaining: Math.max(0, est - done), topics: topics, doneTopics: doneTopics,
               pct: est ? Math.round(done / est * 100) : 0 };
    },
    nextExam: function () {
      var t = todayISO();
      return state.subjects
        .filter(function (s) { return s.examDate && dayDiff(t, s.examDate) >= 0; })
        .sort(function (a, b) { return a.examDate < b.examDate ? -1 : 1; })[0] || null;
    },
    minutesOn: function (iso) {
      return state.sessions.reduce(function (a, s) { return a + (s.date === iso ? s.minutes : 0); }, 0);
    },
    streak: function () {
      var d = todayISO(), n = 0, guard = 0;
      if (Store.minutesOn(d) === 0) d = addDays(d, -1);   // today may not have started yet
      while (guard++ < 400 && Store.minutesOn(d) > 0) { n++; d = addDays(d, -1); }
      return n;
    },
    /** log a completed (or partial) study session */
    logSession: function (rec) {
      Store.update(function (st) {
        var mins = Math.max(0, Math.round(rec.minutes || 0));
        if (mins < 1) return;
        st.sessions.push({
          id: uid('ses'), subjectId: rec.subjectId || null, topicId: rec.topicId || null,
          start: rec.start, end: rec.end, minutes: mins, breaches: rec.breaches || 0,
          completed: !!rec.completed, focusScore: rec.focusScore == null ? 100 : rec.focusScore,
          date: toISO(new Date(rec.end || Date.now()))
        });
        var t = rec.topicId && Store.topic(rec.subjectId, rec.topicId);
        if (t) {
          t.doneHours = Math.round((Number(t.doneHours || 0) + mins / 60) * 100) / 100;
          if (t.status === 'todo') t.status = 'doing';
          if (t.doneHours >= t.estHours) { t.status = 'done'; t.doneHours = t.estHours; }
        }
        if (rec.blockId && st.plan) {
          st.plan.days.forEach(function (d) {
            d.blocks.forEach(function (b) { if (b.id === rec.blockId) b.done = true; });
          });
        }
      });
    }
  };

  global.Store = Store;
})(window);
