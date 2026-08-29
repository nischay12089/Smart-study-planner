/* ===================================================================
   focus.js — Focus Lock: fullscreen study lock + breach detection
   Exposes: window.Focus
   ---------------------------------------------------------------
   Honest scope: a web page cannot switch off your phone or laptop.
   What this DOES do is make leaving impossible to do by accident and
   impossible to hide: fullscreen kiosk view, screen wake-lock, and
   every tab-switch / window-blur / fullscreen-exit recorded against
   your focus score. Settings > Device Lock explains the OS-level
   companions that CAN hard-block apps and sites.
   =================================================================== */
(function (global) {
  'use strict';

  var S = global.Store;
  var el = {};
  var CIRC = 2 * Math.PI * 104;   // dial circumference (r=104)

  var st = null;                  // active session state
  var raf = null, holdTimer = null, wakeLock = null;
  var onEndCb = null, onChangeCb = null;

  function $(id) { return document.getElementById(id); }
  function cacheDom() {
    el.overlay = $('lockOverlay'); el.phase = $('lockPhase'); el.task = $('lockTask');
    el.time = $('lockTime'); el.meta = $('lockMeta'); el.prog = $('dialProg');
    el.breaches = $('lockBreaches'); el.score = $('lockFocusScore'); el.elapsed = $('lockElapsed');
    el.pause = $('lockPause'); el.exit = $('lockExit'); el.hold = el.exit.querySelector('.hold-fill');
    el.breach = $('breachScreen'); el.breachMsg = $('breachMsg'); el.breachReturn = $('breachReturn');
    el.note = $('lockNote');
  }

  /* ---------------- audio ---------------- */
  var actx = null;
  function beep(freq, dur, type, vol) {
    if (!S.get().settings.soundAlerts) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(vol || 0.16, actx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + (dur || 0.25));
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + (dur || 0.25) + 0.02);
    } catch (e) { /* audio is a nicety, never a blocker */ }
  }
  function chime() { beep(660, .18); setTimeout(function () { beep(880, .3); }, 170); }
  function alarm() { beep(300, .35, 'square', .2); setTimeout(function () { beep(220, .45, 'square', .2); }, 260); }

  /* ---------------- screen / fullscreen ---------------- */
  function goFullscreen() {
    var e = document.documentElement;
    var fn = e.requestFullscreen || e.webkitRequestFullscreen || e.msRequestFullscreen;
    if (fn) { try { var p = fn.call(e); if (p && p.catch) p.catch(function () {}); } catch (err) {} }
  }
  function exitFullscreen() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) return;
    var fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (fn) { try { var p = fn.call(document); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
  }
  function requestWakeLock() {
    if (!navigator.wakeLock) return;
    navigator.wakeLock.request('screen').then(function (w) { wakeLock = w; }).catch(function () {});
  }
  function releaseWakeLock() { if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; } }

  /* ---------------- breach handling ---------------- */
  function score() {
    if (!st) return 100;
    var v = 100 - st.breaches * 8 - (st.awayMs / 60000) * 3;
    return Math.max(0, Math.round(v));
  }

  function registerBreach(kind) {
    if (!st || !st.armed || st.inBreach || st.phase === 'break') return;
    var now = Date.now();
    if (now - st.lastBreachAt < 1200) return;          // debounce duplicate events
    st.lastBreachAt = now;
    st.breaches++;
    st.awaySince = now;

    if (S.get().settings.strictLock) {
      st.inBreach = true;
      pauseClock();
      el.breachMsg.textContent = ({
        hidden: 'You switched away from this tab. The clock is stopped until you come back.',
        blur: 'The study window lost focus. Nothing counts while you are away.',
        fullscreen: 'You left fullscreen. Re-enter to keep the block alive.'
      })[kind] || 'Focus was interrupted.';
      el.breach.hidden = false;
      alarm();
    }
    paint();
  }

  function resumeFromBreach() {
    if (!st) return;
    if (st.awaySince) { st.awayMs += Date.now() - st.awaySince; st.awaySince = 0; }
    st.inBreach = false;
    el.breach.hidden = true;
    goFullscreen();
    resumeClock();
    paint();
  }

  function onVisibility() { if (document.hidden) registerBreach('hidden'); }
  function onBlur() { if (!document.hidden) registerBreach('blur'); }
  function onFsChange() {
    if (!st || !st.armed) return;
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fs) registerBreach('fullscreen');
  }
  function onBeforeUnload(e) {
    if (!st || !S.get().settings.blockNav) return;
    e.preventDefault(); e.returnValue = '';
    return '';
  }
  function onKey(e) {
    if (!st) return;
    /* soft-block the reflex shortcuts that live inside the page */
    var k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && ['w', 't', 'n', 'r'].indexOf(k) !== -1) { e.preventDefault(); registerBreach('blur'); }
    if (e.key === 'F5') e.preventDefault();
  }

  /* ---------------- clock ---------------- */
  function pauseClock() { if (st && !st.paused) { st.paused = true; st.pausedAt = Date.now(); paint(); } }
  function resumeClock() {
    if (st && st.paused) {
      st.phaseStart += Date.now() - st.pausedAt;
      st.paused = false; st.pausedAt = 0; paint();
    }
  }

  function loop() {
    if (!st) return;
    if (!st.paused) {
      var elapsed = Date.now() - st.phaseStart;
      var remain = st.phaseMs - elapsed;
      if (st.phase === 'focus') st.studiedMs = st.bankedMs + Math.min(elapsed, st.phaseMs);
      if (remain <= 0) { endPhase(); }
    }
    paint();
    raf = setTimeout(loop, 250);
  }

  function endPhase() {
    if (st.phase === 'focus') {
      st.bankedMs += st.phaseMs;
      st.studiedMs = st.bankedMs;
      flush(true);
      chime();
      if (st.breakMs > 0) {
        st.phase = 'break'; st.phaseMs = st.breakMs; st.phaseStart = Date.now();
        el.overlay.classList.add('is-break');
      } else {
        st.cycle++; st.phase = 'focus'; st.phaseMs = st.blockMs; st.phaseStart = Date.now();
      }
    } else {
      st.cycle++;
      st.phase = 'focus'; st.phaseMs = st.blockMs; st.phaseStart = Date.now();
      el.overlay.classList.remove('is-break');
      chime();
    }
  }

  /* commit studied time to the store */
  function flush(completedBlock) {
    if (!st) return;
    var unlogged = st.studiedMs - st.loggedMs;
    var mins = Math.floor(unlogged / 60000);
    if (mins < 1) return;
    S.logSession({
      subjectId: st.subjectId, topicId: st.topicId, blockId: completedBlock ? st.blockId : null,
      start: st.startedAt, end: Date.now(), minutes: mins,
      breaches: st.breaches, completed: !!completedBlock, focusScore: score()
    });
    st.loggedMs += mins * 60000;
    if (completedBlock) st.blockId = null;   // a block is only credited once
  }

  /* ---------------- paint ---------------- */
  function fmt(ms) {
    var t = Math.max(0, Math.ceil(ms / 1000));
    return S.pad(Math.floor(t / 60)) + ':' + S.pad(t % 60);
  }
  function paint() {
    if (!st) return;
    var elapsed = st.paused ? (st.pausedAt - st.phaseStart) : (Date.now() - st.phaseStart);
    var remain = Math.max(0, st.phaseMs - elapsed);
    el.time.textContent = fmt(remain);
    /* countdown: the ring starts full and drains as the block burns down */
    el.prog.style.strokeDashoffset = (CIRC * Math.min(1, elapsed / st.phaseMs)).toFixed(1);
    el.phase.textContent = st.paused && !st.inBreach ? 'Paused'
                         : st.phase === 'break' ? 'Break' : 'Focus';
    el.meta.textContent = 'Cycle ' + st.cycle + ' · ' +
      (st.phase === 'break' ? Math.round(st.breakMs / 60000) + ' min break' : Math.round(st.blockMs / 60000) + ' min block');
    el.breaches.textContent = st.breaches;
    el.score.textContent = score();
    el.elapsed.textContent = S.fmtMins(st.studiedMs / 60000);
    el.pause.textContent = st.paused && !st.inBreach ? 'Resume' : 'Pause';
    document.title = fmt(remain) + ' · ' + (st.phase === 'break' ? 'Break' : 'Focus') + ' — StudyForge';
  }

  /* ---------------- lifecycle ---------------- */
  function start(cfg) {
    if (st) return;
    cacheDom();
    var s = S.get().settings;
    var blockMin = cfg.minutes || s.blockMinutes || 45;
    var breakMin = cfg.breakMinutes == null ? (s.breakMinutes || 0) : cfg.breakMinutes;

    st = {
      subjectId: cfg.subjectId || null, topicId: cfg.topicId || null, blockId: cfg.blockId || null,
      label: cfg.label || 'Free study',
      blockMs: blockMin * 60000, breakMs: breakMin * 60000,
      phase: 'focus', phaseMs: blockMin * 60000, phaseStart: Date.now(),
      cycle: 1, breaches: 0, awayMs: 0, awaySince: 0, lastBreachAt: 0,
      studiedMs: 0, bankedMs: 0, loggedMs: 0,
      paused: false, pausedAt: 0, inBreach: false, armed: false,
      startedAt: Date.now()
    };

    el.overlay.hidden = false;
    el.overlay.classList.remove('is-break');
    el.breach.hidden = true;
    el.task.textContent = st.label;
    el.note.textContent = S.get().settings.strictLock
      ? 'Strict mode: leaving this window pauses the clock and costs focus score.'
      : 'Relaxed mode: distractions are counted but the clock keeps running.';

    goFullscreen();
    requestWakeLock();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('keydown', onKey, true);

    /* small grace period so the fullscreen transition is not a breach */
    setTimeout(function () { if (st) st.armed = true; }, 1200);

    paint();
    clearTimeout(raf); loop();
    if (onChangeCb) onChangeCb(true);
  }

  function stop(reason) {
    if (!st) return null;
    if (st.awaySince) { st.awayMs += Date.now() - st.awaySince; st.awaySince = 0; }
    if (st.phase === 'focus' && !st.paused) {
      st.studiedMs = st.bankedMs + Math.min(Date.now() - st.phaseStart, st.phaseMs);
    }
    flush(false);

    var summary = {
      minutes: Math.round(st.studiedMs / 60000), breaches: st.breaches,
      focusScore: score(), reason: reason || 'stopped', label: st.label
    };

    clearTimeout(raf); raf = null;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('webkitfullscreenchange', onFsChange);
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('keydown', onKey, true);

    releaseWakeLock();
    exitFullscreen();
    el.overlay.hidden = true;
    el.breach.hidden = true;
    el.overlay.classList.remove('is-break');
    document.title = 'StudyForge — Smart Study Planner';
    st = null;

    if (onChangeCb) onChangeCb(false);
    if (onEndCb) onEndCb(summary);
    return summary;
  }

  /* ---------------- wiring ---------------- */
  function bind() {
    cacheDom();

    el.pause.addEventListener('click', function () {
      if (!st || st.inBreach) return;
      st.paused ? resumeClock() : pauseClock();
    });
    el.breachReturn.addEventListener('click', resumeFromBreach);

    /* hold-to-exit: deliberate friction, so quitting is never a reflex */
    var held = 0;
    function beginHold() {
      if (!st) return;
      held = 0;
      clearInterval(holdTimer);
      holdTimer = setInterval(function () {
        held += 100;
        el.hold.style.width = Math.min(100, held / 3000 * 100) + '%';
        if (held >= 3000) { endHold(); stop('user-exit'); }
      }, 100);
    }
    function endHold() { clearInterval(holdTimer); holdTimer = null; el.hold.style.width = '0%'; }
    ['mousedown', 'touchstart'].forEach(function (e) { el.exit.addEventListener(e, beginHold, { passive: true }); });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(function (e) { el.exit.addEventListener(e, endHold); });
  }

  global.Focus = {
    init: bind,
    start: start,
    stop: stop,
    isRunning: function () { return !!st; },
    state: function () { return st ? { phase: st.phase, breaches: st.breaches, minutes: Math.round(st.studiedMs / 60000) } : null; },
    onEnd: function (fn) { onEndCb = fn; },
    onChange: function (fn) { onChangeCb = fn; }
  };
})(window);
