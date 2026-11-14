/*
  Stand-in pictures for the store screenshots: generated SVG scenes, no files, no network.
  <div class="pic" data-pic="hills|harbor|city|field|plate" data-seed="7"></div> is filled on load.
  Everything here is made up.
*/
(function () {
  "use strict";
  function rng(seed) { var s = (seed * 9301 + 49297) % 233280; return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
  var SKIES = [["#f6c98b", "#e98a6a", "#6d5a8c"], ["#bfe3f2", "#8fc4e8", "#4f86c6"], ["#fde6c4", "#f3b58a", "#b0688a"], ["#d7ecd9", "#9fd0c4", "#4e8f9a"], ["#e9e2f5", "#b7a7e0", "#5a4d9a"]];
  var LANDS = [["#3d5a49", "#2c4437", "#1c2e26"], ["#7a6a4a", "#5a4c36", "#3a3024"], ["#4a5f7a", "#34465e", "#202d40"], ["#6b7f3f", "#4c5e2c", "#2f3d1c"], ["#8a5a4a", "#643f36", "#3f2622"]];
  function ridge(r, w, h, base, amp, step) {
    var d = "M0," + h + " L0," + base, x = 0;
    while (x < w) { x += step * (0.6 + r() * 0.8); d += " L" + Math.round(x) + "," + Math.round(base - amp * r()); }
    return d + " L" + w + "," + h + " Z";
  }
  function svg(kind, seed) {
    var r = rng(seed), w = 800, h = 450, sky = SKIES[seed % SKIES.length], land = LANDS[(seed * 3 + 1) % LANDS.length], id = "g" + kind + seed;
    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + sky[2] + '"/><stop offset=".55" stop-color="' + sky[1] + '"/><stop offset="1" stop-color="' + sky[0] + '"/></linearGradient></defs>' +
      '<rect width="' + w + '" height="' + h + '" fill="url(#' + id + ')"/>';
    if (kind === "plate") {
      out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice" width="100%" height="100%"><rect width="800" height="450" fill="' + ["#c9b79c", "#a8b5a2", "#b9a7a0"][seed % 3] + '"/>' +
        '<rect x="0" y="330" width="800" height="120" fill="#0001"/><ellipse cx="400" cy="250" rx="250" ry="150" fill="#0002"/><ellipse cx="400" cy="235" rx="245" ry="150" fill="#f4f1ea"/><ellipse cx="400" cy="235" rx="190" ry="112" fill="#e9e3d6"/>';
      var cols = ["#c8553d", "#e0a03a", "#6f9a4b", "#8a4b2e", "#f1d27a", "#3f6b3a"];
      for (var i = 0; i < 26; i++) { var a = r() * 6.283, d = Math.sqrt(r()); out += '<ellipse cx="' + Math.round(400 + Math.cos(a) * d * 160) + '" cy="' + Math.round(235 + Math.sin(a) * d * 90) + '" rx="' + Math.round(14 + r() * 26) + '" ry="' + Math.round(9 + r() * 16) + '" fill="' + cols[Math.floor(r() * cols.length)] + '" transform="rotate(' + Math.round(r() * 180) + " " + 400 + ' 235)" opacity=".92"/>'; }
      return out + "</svg>";
    }
    var sx = 120 + r() * 560, sy = 90 + r() * 120;
    out += '<circle cx="' + sx + '" cy="' + sy + '" r="' + (34 + r() * 26) + '" fill="#fff6dc" opacity=".85"/>';
    for (var c = 0; c < 5; c++) { var cx = r() * w, cy = 40 + r() * 150; out += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + (60 + r() * 90) + '" ry="' + (10 + r() * 14) + '" fill="#fff" opacity="' + (0.18 + r() * 0.25) + '"/>'; }
    if (kind === "city") {
      for (var b = 0, x = -10; x < w; b++) { var bw = 28 + r() * 54, bh = 90 + r() * 210; out += '<rect x="' + x + '" y="' + (h - 70 - bh) + '" width="' + bw + '" height="' + (bh + 70) + '" fill="' + land[1 + (b % 2)] + '"/>';
        for (var wy = h - 60 - bh + 12; wy < h - 80; wy += 22) for (var wx = x + 6; wx < x + bw - 8; wx += 14) if (r() > 0.55) out += '<rect x="' + wx + '" y="' + wy + '" width="6" height="9" fill="#ffe7a6" opacity=".8"/>';
        x += bw + 4; }
      out += '<rect x="0" y="' + (h - 70) + '" width="' + w + '" height="70" fill="' + land[2] + '"/>';
    } else if (kind === "harbor") {
      out += '<path d="' + ridge(r, w, h, 250, 60, 90) + '" fill="' + land[0] + '" opacity=".7"/>';
      out += '<rect x="0" y="270" width="' + w + '" height="180" fill="#2f5f7d"/><rect x="0" y="270" width="' + w + '" height="180" fill="url(#' + id + ')" opacity=".25"/>';
      for (var k = 0; k < 6; k++) { var bx = 60 + k * 125 + r() * 40, by = 300 + r() * 90, s = 0.7 + r() * 0.7;
        out += '<g transform="translate(' + bx + "," + by + ") scale(" + s + ')"><path d="M-40,0 L40,0 L28,16 L-28,16 Z" fill="#f2efe6"/><rect x="-2" y="-70" width="4" height="70" fill="#3a3024"/><path d="M4,-66 L44,-8 L4,-8 Z" fill="#fff" opacity=".92"/><path d="M-4,-58 L-34,-8 L-4,-8 Z" fill="' + ["#e9765b", "#f0b44c", "#e8e4da"][k % 3] + '"/></g>'; }
      for (var q = 0; q < 30; q++) out += '<rect x="' + r() * w + '" y="' + (280 + r() * 165) + '" width="' + (20 + r() * 50) + '" height="2" fill="#fff" opacity=".18"/>';
    } else if (kind === "field") {
      out += '<path d="' + ridge(r, w, h, 260, 40, 140) + '" fill="' + land[0] + '"/>';
      for (var f = 0; f < 9; f++) out += '<path d="M' + (-100 + f * 120) + "," + h + " L" + (300 + f * 30) + ',270 L' + (330 + f * 30) + ",270 L" + (f * 120) + "," + h + ' Z" fill="' + (f % 2 ? "#d9b54a" : "#c79f38") + '"/>';
      out += '<rect x="560" y="205" width="70" height="60" fill="#9b3d2e"/><path d="M552,205 L595,172 L638,205 Z" fill="#5a2a22"/>';
    } else {
      out += '<path d="' + ridge(r, w, h, 230, 110, 70) + '" fill="' + land[0] + '" opacity=".75"/>';
      out += '<path d="' + ridge(r, w, h, 300, 80, 90) + '" fill="' + land[1] + '"/>';
      out += '<path d="' + ridge(r, w, h, 380, 50, 120) + '" fill="' + land[2] + '"/>';
      for (var t = 0; t < 22; t++) { var tx = r() * w, ty = 360 + r() * 70, th = 26 + r() * 30; out += '<path d="M' + tx + "," + (ty - th) + " L" + (tx + 10) + "," + ty + " L" + (tx - 10) + "," + ty + ' Z" fill="#14231c"/>'; }
    }
    return out + "</svg>";
  }
  function fill() {
    document.querySelectorAll(".pic[data-pic]").forEach(function (el) {
      if (el.firstChild) return;
      el.innerHTML = svg(el.getAttribute("data-pic"), parseInt(el.getAttribute("data-seed") || "1", 10));
    });
  }
  window.StandinPics = { svg: svg, fill: fill };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fill); else fill();
})();
