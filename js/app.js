/* ===================================================================
   app.js — routing, event delegation, modals, wiring
   =================================================================== */
(function (global) {
  'use strict';

  var S = global.Store, V = global.Views, Sch = global.Scheduler, F = global.Focus;

  var VIEW_META = {
    dashboard: ['Dashboard', 'Your exam-ready overview'],
    subjects:  ['Subjects', 'Topics, estimates and exam dates'],
    schedule:  ['Schedule', 'The generated day-by-day timetable'],
    focus:     ['Focus Lock', 'Distraction-proof study sessions'],
    insights:  ['Insights', 'Where your hours actually go'],
    settings:  ['Settings', 'Availability, engine and data']
  };

  var BLOCK_SCRIPT =
    '$sites = "www.youtube.com","www.instagram.com","x.com","www.reddit.com"\n' +
    '$hosts = "$env:WinDir\\System32\\drivers\\etc\\hosts"\n' +
    '$sites | % { Add-Content $hosts "127.0.0.1 $_" }\n' +
    'ipconfig /flushdns';

  var view = 'dashboard';
  var showAllDays = false;
  var quiet = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return global.Charts.esc(s); }

  /* ---------------- toasts ---------------- */
  function toast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s,transform .3s';
      t.style.opacity = '0'; t.style.transform = 'translateX(20px)';
      setTimeout(function () { t.remove(); }, 320);
    }, 2800);
  }

  /* ---------------- modal ---------------- */
  var modalSave = null;
  function openModal(title, body, saveLabel, onSave) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = body;
    $('modalFoot').innerHTML = saveLabel
      ? '<button class="btn btn-ghost" data-close>Cancel</button>' +
        '<button class="btn btn-primary" id="modalSave">' + esc(saveLabel) + '</button>' : '';
    $('modal').hidden = false;
    modalSave = onSave || null;
    if (saveLabel) $('modalSave').addEventListener('click', function () { if (modalSave) modalSave(); });
    var first = $('modalBody').querySelector('input,select,textarea');
    if (first) setTimeout(function () { first.focus(); first.select && first.select(); }, 40);
  }
  function closeModal() { $('modal').hidden = true; modalSave = null; }

  function confirmModal(title, msg, label, fn) {
    openModal(title, '<p class="small" style="color:var(--text2)">' + esc(msg) + '</p>', label, function () {
      closeModal(); fn();
    });
    var b = $('modalSave'); if (b) b.className = 'btn btn-danger';
  }

  /* ---------------- render ---------------- */
  function render() {
    var st = S.get();
    var meta = VIEW_META[view] || VIEW_META.dashboard;
    $('viewTitle').textContent = meta[0];
    $('viewSub').textContent = meta[1];
    Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (b) {
      b.classList.toggle('is-active', b.dataset.view === view);
    });
    var root = $('viewRoot');
    var keepScroll = root.scrollTop;
    root.innerHTML = V[view] ? V[view](st, { showAll: showAllDays }) : '';
    root.scrollTop = keepScroll;
    renderCountdown(st);
    $('navFocusBadge').hidden = !F.isRunning();
  }

  function renderCountdown(st) {
    var box = $('sideCountdown'), next = S.nextExam();
    if (!next) { box.className = 'countdown is-empty'; box.innerHTML = ''; return; }
    var d = Math.max(0, S.dayDiff(S.todayISO(), next.examDate));
    box.className = 'countdown';
    box.innerHTML = '<div class="cd-label">Next exam</div>' +
      '<div class="cd-value" style="color:' + next.color + '">' + d + (d === 1 ? ' day' : ' days') + '</div>' +
      '<div class="cd-sub">' + esc(next.name) + '</div>';
  }

  function setView(v) {
    if (!VIEW_META[v]) v = 'dashboard';
    view = v; showAllDays = false;
    S.update(function (st) { st.lastView = v; });
    document.getElementById('app').classList.remove('nav-open');
    $('viewRoot').scrollTop = 0;
  }

  function regenerate(silentToast) {
    S.update(function (st) { st.plan = Sch.generate(st); });
    if (!silentToast) {
      var p = S.get().plan;
      toast(p.deficits.length
        ? 'Plan rebuilt — ' + p.deficits.length + ' subject(s) will not fit'
        : 'Plan rebuilt — ' + S.fmtHours(p.summary.scheduled) + ' scheduled', p.deficits.length ? 'warn' : 'ok');
    }
  }

  /* ---------------- forms ---------------- */
  function subjectForm(s) {
    var colors = S.PALETTE.map(function (c) {
      return '<button type="button" class="swatch' + (s && s.color === c ? ' is-on' : '') + '" data-color="' + c + '" style="background:' + c + '"></button>';
    }).join('');
    return '<div class="form-grid">' +
      '<div class="field full"><label>Subject name</label>' +
        '<input type="text" id="fName" placeholder="e.g. Organic Chemistry" value="' + esc(s ? s.name : '') + '"></div>' +
      '<div class="field"><label>Exam date</label>' +
        '<input type="date" id="fExam" value="' + esc(s && s.examDate ? s.examDate : '') + '"></div>' +
      '<div class="field"><label>Difficulty (1–5)</label>' +
        '<input type="number" id="fDiff" min="1" max="5" value="' + (s ? s.difficulty || 3 : 3) + '"></div>' +
      '<div class="field full"><label>Colour</label><div class="swatches" id="fColors">' + colors + '</div></div>' +
    '</div>';
  }
  function topicForm(t) {
    return '<div class="form-grid">' +
      '<div class="field full"><label>Topic / chapter</label>' +
        '<input type="text" id="tName" placeholder="e.g. Rotational Motion" value="' + esc(t ? t.name : '') + '"></div>' +
      '<div class="field"><label>Estimated hours</label>' +
        '<input type="number" id="tHours" min="0.5" max="100" step="0.5" value="' + (t ? t.estHours : 4) + '"></div>' +
      '<div class="field"><label>Hours already done</label>' +
        '<input type="number" id="tDone" min="0" max="100" step="0.5" value="' + (t ? t.doneHours || 0 : 0) + '"></div>' +
      '<div class="field"><label>Priority</label><select id="tPri">' +
        [[1, 'Low'], [2, 'Medium'], [3, 'High']].map(function (p) {
          return '<option value="' + p[0] + '"' + (t && t.priority === p[0] ? ' selected' : (!t && p[0] === 2 ? ' selected' : '')) + '>' + p[1] + '</option>';
        }).join('') + '</select></div>' +
      '<div class="field"><label>Confidence (1 = shaky, 5 = solid)</label>' +
        '<input type="number" id="tConf" min="1" max="5" value="' + (t ? t.confidence || 3 : 3) + '"></div>' +
      '<div class="field full"><span class="hint">Low confidence and high priority get scheduled first, and get more revision.</span></div>' +
    '</div>';
  }
  function pickedColor(fallback) {
    var on = document.querySelector('#fColors .swatch.is-on');
    return on ? on.dataset.color : fallback;
  }

  /* ---------------- actions ---------------- */
  var actions = {
    go: function (el) { setView(el.dataset.view); },

    regenerate: function () { regenerate(); },
    'show-all-days': function () { showAllDays = true; render(); },

    'add-subject': function () {
      openModal('New subject', subjectForm(null), 'Add subject', function () {
        var name = $('fName').value.trim();
        if (!name) return toast('Give the subject a name', 'err');
        S.update(function (st) {
          st.subjects.push({
            id: S.uid('sub'), name: name, color: pickedColor(S.PALETTE[st.subjects.length % S.PALETTE.length]),
            examDate: $('fExam').value || '', difficulty: Number($('fDiff').value) || 3,
            createdAt: Date.now(), topics: []
          });
          st.plan = Sch.generate(st);
        });
        closeModal(); toast('Subject added — now add its topics', 'ok');
      });
    },
    'edit-subject': function (el) {
      var s = S.subject(el.dataset.sid); if (!s) return;
      openModal('Edit ' + s.name, subjectForm(s), 'Save', function () {
        var name = $('fName').value.trim(); if (!name) return toast('Name cannot be empty', 'err');
        S.update(function (st) {
          var x = S.subject(s.id);
          x.name = name; x.examDate = $('fExam').value || '';
          x.difficulty = Number($('fDiff').value) || 3; x.color = pickedColor(x.color);
          st.plan = Sch.generate(st);
        });
        closeModal(); toast('Subject updated', 'ok');
      });
    },
    'del-subject': function (el) {
      var s = S.subject(el.dataset.sid); if (!s) return;
      confirmModal('Delete ' + s.name + '?', 'Its ' + s.topics.length + ' topics and their estimates go too. Logged sessions are kept.',
        'Delete subject', function () {
          S.update(function (st) {
            st.subjects = st.subjects.filter(function (x) { return x.id !== s.id; });
            st.plan = Sch.generate(st);
          });
          toast('Subject deleted');
        });
    },

    'add-topic': function (el) {
      var sid = el.dataset.sid;
      openModal('New topic', topicForm(null), 'Add topic', function () {
        var name = $('tName').value.trim(); if (!name) return toast('Give the topic a name', 'err');
        S.update(function (st) {
          var s = S.subject(sid); if (!s) return;
          var done = Number($('tDone').value) || 0, est = Number($('tHours').value) || 1;
          s.topics.push({
            id: S.uid('top'), name: name, estHours: est, doneHours: Math.min(done, est),
            priority: Number($('tPri').value) || 2, confidence: Number($('tConf').value) || 3,
            status: done >= est ? 'done' : done > 0 ? 'doing' : 'todo'
          });
          st.plan = Sch.generate(st);
        });
        closeModal(); toast('Topic added', 'ok');
      });
    },
    'edit-topic': function (el) {
      var sid = el.dataset.sid, tid = el.dataset.tid, t = S.topic(sid, tid); if (!t) return;
      openModal('Edit topic', topicForm(t), 'Save', function () {
        var name = $('tName').value.trim(); if (!name) return toast('Name cannot be empty', 'err');
        S.update(function (st) {
          var x = S.topic(sid, tid);
          x.name = name; x.estHours = Number($('tHours').value) || 1;
          x.doneHours = Math.min(Number($('tDone').value) || 0, x.estHours);
          x.priority = Number($('tPri').value) || 2; x.confidence = Number($('tConf').value) || 3;
          x.status = x.doneHours >= x.estHours ? 'done' : x.doneHours > 0 ? 'doing' : 'todo';
          st.plan = Sch.generate(st);
        });
        closeModal(); toast('Topic updated', 'ok');
      });
    },
    'del-topic': function (el) {
      var sid = el.dataset.sid, tid = el.dataset.tid;
      S.update(function (st) {
        var s = S.subject(sid); if (!s) return;
        s.topics = s.topics.filter(function (t) { return t.id !== tid; });
        st.plan = Sch.generate(st);
      });
      toast('Topic removed');
    },
    'toggle-topic': function (el) {
      var sid = el.dataset.sid, tid = el.dataset.tid;
      S.update(function (st) {
        var t = S.topic(sid, tid); if (!t) return;
        if (t.status === 'done') { t.status = t.doneHours > 0 ? 'doing' : 'todo'; }
        else { t.status = 'done'; t.doneHours = t.estHours; }
        st.plan = Sch.generate(st);
      });
    },

    'focus-topic': function (el) {
      startFocus({ subjectId: el.dataset.sid, topicId: el.dataset.tid });
    },
    'focus-block': function (el) {
      var id = el.dataset.id, date = el.dataset.date, blk = null;
      var d = Sch.dayPlan(S.get().plan, date);
      if (d) blk = d.blocks.filter(function (b) { return b.id === id; })[0];
      if (!blk) return;
      startFocus({ subjectId: blk.subjectId, topicId: blk.topicId, blockId: blk.id,
                   minutes: Math.max(5, Math.round(blk.hours * 60)) });
    },
    'mark-block': function (el) {
      var id = el.dataset.id;
      S.update(function (st) {
        if (!st.plan) return;
        st.plan.days.forEach(function (d) {
          d.blocks.forEach(function (b) {
            if (b.id !== id || b.done) return;
            b.done = true;
            var t = S.topic(b.subjectId, b.topicId);
            if (t && b.type === 'study') {
              t.doneHours = Math.round((Number(t.doneHours || 0) + b.hours) * 100) / 100;
              if (t.doneHours >= t.estHours) { t.doneHours = t.estHours; t.status = 'done'; }
              else if (t.status === 'todo') t.status = 'doing';
            }
            st.sessions.push({
              id: S.uid('ses'), subjectId: b.subjectId, topicId: b.topicId,
              start: Date.now() - b.hours * 3600000, end: Date.now(), minutes: Math.round(b.hours * 60),
              breaches: 0, completed: true, focusScore: 100, date: S.todayISO()
            });
          });
        });
      });
      toast('Block marked done', 'ok');
    },

    'start-focus': function () {
      var sel = $('focusTask'), parts = (sel && sel.value ? sel.value : '').split('|');
      var len = Number(($('focusLen') || {}).value) || S.get().settings.blockMinutes;
      var brk = Number(($('focusBreak') || {}).value);
      var strict = $('focusStrict') ? $('focusStrict').checked : S.get().settings.strictLock;
      S.update(function (st) {
        st.settings.blockMinutes = len;
        st.settings.breakMinutes = isNaN(brk) ? st.settings.breakMinutes : brk;
        st.settings.strictLock = strict;
      });
      startFocus({ subjectId: parts[0] || null, topicId: parts[1] || null, minutes: len, breakMinutes: brk });
    },

    'trim-scope': function () {
      confirmModal('Trim every estimate by 15%?', 'Estimates are a guess anyway. This lowers each topic\'s hours so the plan fits, then regenerates.',
        'Trim and regenerate', function () {
          S.update(function (st) {
            st.subjects.forEach(function (s) {
              s.topics.forEach(function (t) {
                t.estHours = Math.max(0.5, Math.round(t.estHours * 0.85 * 2) / 2);
                if (t.doneHours > t.estHours) t.doneHours = t.estHours;
              });
            });
            st.plan = Sch.generate(st);
          });
          toast('Estimates trimmed and plan rebuilt', 'ok');
        });
    },

    'add-exception': function () {
      var d = $('excDate').value, hrs = Number($('excHours').value);
      if (!d) return toast('Pick a date first', 'err');
      S.update(function (st) { st.exceptions[d] = isNaN(hrs) ? 0 : Math.max(0, hrs); st.plan = Sch.generate(st); });
      toast('Exception added for ' + S.fmtDate(d), 'ok');
    },
    'del-exception': function (el) {
      S.update(function (st) { delete st.exceptions[el.dataset.date]; st.plan = Sch.generate(st); });
    },

    'copy-block': function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(BLOCK_SCRIPT)
          .then(function () { toast('Script copied — run it in an admin PowerShell', 'ok'); })
          .catch(function () { toast('Copy failed — select the text manually', 'err'); });
      } else { toast('Select the text and copy manually', 'warn'); }
    },

    'load-sample': function () {
      confirmModal('Load sample data?', 'This replaces your current subjects, plan and history with a worked example.',
        'Replace with sample', function () { S.reset(true); regenerate(true); toast('Sample data loaded', 'ok'); });
    },
    wipe: function () {
      confirmModal('Erase everything?', 'Subjects, plan and every logged session are deleted from this browser. This cannot be undone.',
        'Erase all data', function () { S.reset(false); toast('All data erased'); });
    },
    export: function () {
      var data = JSON.stringify(S.get(), null, 2);
      var blob = new Blob([data], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'studyforge-backup-' + S.todayISO() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      toast('Backup downloaded', 'ok');
    },
    import: function () {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'application/json,.json';
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        var r = new FileReader();
        r.onload = function () {
          try {
            var next = JSON.parse(r.result);
            if (!next || !Array.isArray(next.subjects)) throw new Error('bad shape');
            next.settings = Object.assign({}, S.defaults().settings, next.settings || {});
            next.availability = Object.assign({}, S.defaults().availability, next.availability || {});
            next.exceptions = next.exceptions || {}; next.sessions = next.sessions || [];
            S.replace(next);
            applyTheme(); toast('Backup restored', 'ok');
          } catch (e) { toast('That file is not a StudyForge backup', 'err'); }
        };
        r.readAsText(f);
      });
      inp.click();
    }
  };

  /* ---------------- focus lifecycle ---------------- */
  function startFocus(cfg) {
    if (F.isRunning()) return toast('A focus session is already running', 'warn');
    var st = S.get();
    var label = 'Free study';
    if (cfg.topicId) {
      var sub = S.subject(cfg.subjectId), t = S.topic(cfg.subjectId, cfg.topicId);
      if (t) label = (sub ? sub.name + ' · ' : '') + t.name;
    } else if (cfg.subjectId) {
      var s2 = S.subject(cfg.subjectId); if (s2) label = s2.name;
    }
    F.start({
      subjectId: cfg.subjectId || null, topicId: cfg.topicId || null, blockId: cfg.blockId || null,
      minutes: cfg.minutes || st.settings.blockMinutes,
      breakMinutes: cfg.breakMinutes == null ? st.settings.breakMinutes : cfg.breakMinutes,
      label: label
    });
  }

  function quickFocus() {
    if (F.isRunning()) return;
    var nb = Sch.nextBlock(S.get().plan, S.todayISO());
    if (nb) {
      startFocus({ subjectId: nb.subjectId, topicId: nb.topicId, blockId: nb.id,
                   minutes: Math.max(5, Math.round(nb.hours * 60)) });
    } else {
      setView('focus'); render();
      toast('Nothing scheduled right now — pick a topic', 'warn');
    }
  }

  /* ---------------- theme ---------------- */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', S.get().settings.theme === 'light' ? 'light' : 'dark');
  }

  /* ---------------- settings inputs ---------------- */
  function readSetting(el) {
    var key = el.dataset.key, val;
    if (el.type === 'checkbox') val = el.checked;
    else if (key === 'revisionShare') val = Number(el.value) / 100;
    else if (key === 'blockMinutes' || key === 'breakMinutes') val = Number(el.value);
    else val = el.value;
    return [key, val];
  }

  function handleFieldChange(el, isLive) {
    if (el.dataset.act === 'avail') {
      var day = el.dataset.day, v = Math.max(0, Number(el.value) || 0);
      quiet = isLive;
      S.update(function (st) { st.availability[day] = v; });
      quiet = false;
      if (isLive) {
        var total = S.DAY_NAMES.reduce(function (a, n, i) { return a + (Number(S.get().availability[i]) || 0); }, 0);
        var pill = document.querySelector('.card-head .pill');
        if (pill) { pill.textContent = total + 'h / week'; pill.className = 'pill ' + (total >= 14 ? 'ok' : total >= 7 ? 'warn' : 'danger'); }
      }
      return;
    }
    if (el.dataset.act === 'setting') {
      var kv = readSetting(el);
      quiet = isLive;
      S.update(function (st) { st.settings[kv[0]] = kv[1]; });
      quiet = false;
      if (isLive && kv[0] === 'revisionShare') {
        var lbl = el.parentNode.querySelector('label');
        if (lbl) lbl.textContent = 'Revision share — ' + Math.round(kv[1] * 100) + '%';
      }
      if (kv[0] === 'theme') applyTheme();
    }
  }

  /* ---------------- boot ---------------- */
  function boot() {
    applyTheme();
    F.init();

    var st = S.get();
    view = VIEW_META[st.lastView] ? st.lastView : 'dashboard';
    if (!st.plan) regenerate(true);

    S.subscribe(function () { if (!quiet) render(); });

    /* nav */
    $('nav').addEventListener('click', function (e) {
      var b = e.target.closest('.nav-item'); if (!b) return;
      setView(b.dataset.view); render();
    });
    $('menuBtn').addEventListener('click', function () {
      document.getElementById('app').classList.toggle('nav-open');
    });
    $('themeToggle').addEventListener('click', function () {
      S.update(function (s) { s.settings.theme = s.settings.theme === 'dark' ? 'light' : 'dark'; });
      applyTheme();
    });
    $('btnRegenerate').addEventListener('click', function () { regenerate(); });
    $('btnQuickFocus').addEventListener('click', quickFocus);

    /* delegated clicks */
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) { closeModal(); return; }
      var sw = e.target.closest('.swatch');
      if (sw) {
        Array.prototype.forEach.call(sw.parentNode.children, function (c) { c.classList.remove('is-on'); });
        sw.classList.add('is-on'); return;
      }
      var a = e.target.closest('[data-act]');
      if (!a || a.tagName === 'INPUT' || a.tagName === 'SELECT') return;
      var fn = actions[a.dataset.act];
      if (fn) { e.preventDefault(); fn(a); }
    });

    /* delegated field edits */
    document.addEventListener('input', function (e) {
      var el = e.target.closest('[data-act="avail"],[data-act="setting"]');
      if (el && el.type !== 'checkbox' && el.tagName !== 'SELECT') handleFieldChange(el, true);
    });
    document.addEventListener('change', function (e) {
      var el = e.target.closest('[data-act="avail"],[data-act="setting"]');
      if (!el) return;
      handleFieldChange(el, el.tagName !== 'SELECT' && el.type !== 'checkbox');
    });

    /* keyboard */
    document.addEventListener('keydown', function (e) {
      if (F.isRunning()) return;
      if (e.key === 'Escape' && !$('modal').hidden) closeModal();
      if (e.target.matches('input,select,textarea')) return;
      var idx = ['1', '2', '3', '4', '5', '6'].indexOf(e.key);
      if (idx >= 0) { setView(Object.keys(VIEW_META)[idx]); render(); }
      if (e.key.toLowerCase() === 'f') quickFocus();
    });

    /* focus session results */
    F.onChange(function () { render(); });
    F.onEnd(function (sum) {
      if (sum.minutes >= 1) {
        toast('Logged ' + S.fmtMins(sum.minutes) + ' · focus score ' + sum.focusScore +
              (sum.breaches ? ' · ' + sum.breaches + ' breach' + (sum.breaches > 1 ? 'es' : '') : ' · clean run'),
              sum.focusScore >= 90 ? 'ok' : 'warn');
      } else {
        toast('Session too short to log', 'warn');
      }
      render();
    });

    render();

    if (!S.get().settings.onboarded) {
      S.update(function (s) { s.settings.onboarded = true; });
      setTimeout(function () {
        toast('Loaded with sample subjects — press 1-6 to switch views, F to start focusing', 'ok');
      }, 600);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
