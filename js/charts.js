/* ===================================================================
   charts.js — dependency-free SVG charts
   Exposes: window.Charts
   =================================================================== */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    var step = v <= 4 ? 1 : v <= 10 ? 2 : v <= 30 ? 5 : v <= 60 ? 10 : 20;
    return Math.ceil(v / step) * step;
  }
  function polar(cx, cy, r, deg) {
    var a = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  function arc(cx, cy, rOut, rIn, a0, a1) {
    var large = (a1 - a0) > 180 ? 1 : 0;
    var p0 = polar(cx, cy, rOut, a0), p1 = polar(cx, cy, rOut, a1);
    var q1 = polar(cx, cy, rIn, a1), q0 = polar(cx, cy, rIn, a0);
    return 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) +
           'A' + rOut + ' ' + rOut + ' 0 ' + large + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2) +
           'L' + q1[0].toFixed(2) + ' ' + q1[1].toFixed(2) +
           'A' + rIn + ' ' + rIn + ' 0 ' + large + ' 0 ' + q0[0].toFixed(2) + ' ' + q0[1].toFixed(2) + 'Z';
  }

  /* ---------------------------------------------------------------
     1. Horizontal progress bars — hours done vs planned per subject
     --------------------------------------------------------------- */
  function subjectBars(items) {
    if (!items.length) return '<div class="empty small">No subjects yet.</div>';
    var rowH = 44, pad = 8, W = 420, H = items.length * rowH + pad;
    var max = niceMax(Math.max.apply(null, items.map(function (i) { return i.total; }).concat([1])));
    var labelW = 0, barX = 0, barW = W - 60;
    var out = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" style="height:' + H + 'px">';
    items.forEach(function (it, i) {
      var y = i * rowH + 4;
      var wTotal = Math.max(2, it.total / max * barW);
      var wDone = Math.max(0, Math.min(wTotal, it.done / max * barW));
      out += '<text x="0" y="' + (y + 10) + '" class="c-lbl">' + esc(it.label) + '</text>';
      out += '<text x="' + W + '" y="' + (y + 10) + '" text-anchor="end" class="c-val">' +
             it.done.toFixed(1) + ' / ' + it.total.toFixed(1) + 'h</text>';
      out += '<rect x="' + barX + '" y="' + (y + 18) + '" width="' + barW + '" height="9" rx="4.5" fill="var(--card2)" stroke="var(--line)"/>';
      out += '<rect x="' + barX + '" y="' + (y + 18) + '" width="' + wTotal + '" height="9" rx="4.5" fill="' + it.color + '" opacity=".26"/>';
      if (wDone > 1) out += '<rect x="' + barX + '" y="' + (y + 18) + '" width="' + wDone + '" height="9" rx="4.5" fill="' + it.color + '"/>';
      out += '<text x="' + (barX + barW + 6) + '" y="' + (y + 26) + '" class="c-val" font-size="10">' + it.pct + '%</text>';
    });
    return out + '</svg>';
  }

  /* ---------------------------------------------------------------
     2. Donut — share of remaining hours by subject
     --------------------------------------------------------------- */
  function donut(segs, centerTop, centerBottom) {
    var total = segs.reduce(function (a, s) { return a + s.value; }, 0);
    var cx = 90, cy = 90, rO = 80, rI = 54;
    var out = '<svg class="chart" viewBox="0 0 180 180" style="max-width:200px;margin:0 auto">';
    if (total <= 0) {
      out += '<circle cx="90" cy="90" r="67" fill="none" stroke="var(--card2)" stroke-width="26"/>';
    } else if (segs.filter(function (s) { return s.value > 0; }).length === 1) {
      var only = segs.filter(function (s) { return s.value > 0; })[0];
      out += '<circle cx="90" cy="90" r="67" fill="none" stroke="' + only.color + '" stroke-width="26"/>';
    } else {
      var a = 0;
      segs.forEach(function (s) {
        if (s.value <= 0) return;
        var sweep = s.value / total * 360;
        out += '<path d="' + arc(cx, cy, rO, rI, a + 0.6, a + sweep - 0.6) + '" fill="' + s.color + '">' +
               '<title>' + esc(s.label) + ' — ' + s.value.toFixed(1) + 'h</title></path>';
        a += sweep;
      });
    }
    out += '<text x="90" y="86" text-anchor="middle" class="c-val" style="font-size:22px">' + esc(centerTop) + '</text>';
    out += '<text x="90" y="103" text-anchor="middle" style="font-size:10px">' + esc(centerBottom) + '</text>';
    return out + '</svg>';
  }

  /* ---------------------------------------------------------------
     3. Stacked daily load vs available capacity
     --------------------------------------------------------------- */
  function loadChart(days, opts) {
    opts = opts || {};
    var W = 460, H = 190, L = 26, R = 8, T = 12, B = 30;
    var pw = W - L - R, ph = H - T - B;
    var max = niceMax(Math.max.apply(null, days.map(function (d) {
      return Math.max(d.capacity || 0, d.total || 0);
    }).concat([1])));
    var n = days.length || 1;
    var slot = pw / n, bw = Math.max(6, Math.min(26, slot * 0.62));
    var y = function (v) { return T + ph - (v / max) * ph; };

    var out = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" style="height:' + H + 'px">';
    /* grid */
    [0, 0.5, 1].forEach(function (f) {
      var yy = T + ph - f * ph;
      out += '<line class="grid-line" x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '"/>';
      out += '<text x="' + (L - 6) + '" y="' + (yy + 3.5) + '" text-anchor="end">' + (max * f) + 'h</text>';
    });
    /* capacity step line */
    var capPath = '';
    days.forEach(function (d, i) {
      var x0 = L + i * slot, x1 = x0 + slot, yy = y(d.capacity || 0);
      capPath += (i ? 'L' : 'M') + x0 + ' ' + yy.toFixed(1) + 'L' + x1 + ' ' + yy.toFixed(1);
    });
    out += '<path d="' + capPath + '" fill="none" stroke="var(--muted)" stroke-width="1.4" stroke-dasharray="4 3" opacity=".75"/>';
    /* stacked columns */
    days.forEach(function (d, i) {
      var x = L + i * slot + (slot - bw) / 2, acc = 0;
      (d.segs || []).forEach(function (s) {
        if (s.hours <= 0) return;
        var h = (s.hours / max) * ph;
        if (h < 0.5) return;
        acc += h;
        out += '<rect x="' + x.toFixed(1) + '" y="' + (T + ph - acc).toFixed(1) + '" width="' + bw.toFixed(1) +
               '" height="' + h.toFixed(1) + '" fill="' + s.color + '" opacity="' + (d.past ? '.35' : '.92') + '">' +
               '<title>' + esc(s.name) + ' — ' + s.hours.toFixed(2) + 'h on ' + esc(d.label) + '</title></rect>';
      });
      if (!acc) out += '<rect x="' + x.toFixed(1) + '" y="' + (T + ph - 2) + '" width="' + bw.toFixed(1) + '" height="2" rx="1" fill="var(--line2)"/>';
      if (n <= 10 || i % 2 === 0) {
        out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 15) + '" text-anchor="middle">' + esc(d.label) + '</text>';
      }
      if (d.today) out += '<circle cx="' + (x + bw / 2).toFixed(1) + '" cy="' + (H - 8) + '" r="2.4" fill="var(--accent)"/>';
    });
    return out + '</svg>';
  }

  /* ---------------------------------------------------------------
     4. Small radial ring (KPI)
     --------------------------------------------------------------- */
  function ring(pct, color, size) {
    size = size || 46;
    var r = 18, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
    return '<svg viewBox="0 0 44 44" style="width:' + size + 'px;height:' + size + 'px;flex:none">' +
      '<circle cx="22" cy="22" r="' + r + '" fill="none" stroke="var(--card2)" stroke-width="5"/>' +
      '<circle cx="22" cy="22" r="' + r + '" fill="none" stroke="' + (color || 'var(--accent)') + '" stroke-width="5" ' +
      'stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) +
      '" transform="rotate(-90 22 22)"/>' +
      '<text x="22" y="26" text-anchor="middle" class="c-val" style="font-size:11px">' + Math.round(pct) + '</text>' +
      '</svg>';
  }

  /* ---------------------------------------------------------------
     5. Consistency heatmap (last N weeks of logged minutes)
     --------------------------------------------------------------- */
  function heatmap(cells) {
    // cells: [{date,label,minutes}] ordered oldest -> newest, aligned to Sunday
    var max = Math.max.apply(null, cells.map(function (c) { return c.minutes; }).concat([1]));
    var html = '<div class="heat-wrap"><div class="heat">';
    cells.forEach(function (c) {
      var f = c.minutes / max;
      var style = c.minutes > 0
        ? 'background:color-mix(in srgb,var(--accent) ' + Math.round(18 + f * 82) + '%,var(--card2));border-color:transparent'
        : '';
      html += '<i style="' + style + '" title="' + esc(c.label) + ' — ' + (c.minutes ? Math.round(c.minutes) + ' min' : 'no study') + '"></i>';
    });
    return html + '</div></div>';
  }

  /* ---------------------------------------------------------------
     6. Sparkline
     --------------------------------------------------------------- */
  function spark(values, color) {
    if (!values.length) return '';
    var W = 120, H = 30, max = Math.max.apply(null, values.concat([1]));
    var step = values.length > 1 ? W / (values.length - 1) : W;
    var pts = values.map(function (v, i) { return (i * step).toFixed(1) + ',' + (H - (v / max) * (H - 4) - 2).toFixed(1); });
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" style="height:30px;width:120px">' +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + (color || 'var(--accent)') +
      '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function legend(items) {
    return '<div class="legend">' + items.map(function (i) {
      return '<span><i class="dot" style="background:' + i.color + '"></i>' + esc(i.label) + '</span>';
    }).join('') + '</div>';
  }

  global.Charts = { subjectBars: subjectBars, donut: donut, loadChart: loadChart, ring: ring,
                    heatmap: heatmap, spark: spark, legend: legend, esc: esc };
})(window);
