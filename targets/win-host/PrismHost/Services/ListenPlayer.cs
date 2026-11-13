namespace PrismHost.Services;

/// <summary>
/// One player for every listener (2026-11-03): the PC's sound as 16-bit PCM in 20 ms frames over /audio/stream, each frame stamped with its time on the PC's stream clock
/// (ListenStream, ?stamp=1), played by the page itself with Web Audio at that time plus a hold. The hold is three seconds for the house (the
/// listen page, and the companion app's Private Listening while the Music player has the sound: the room sits the same three seconds
/// back), or the network's floor plus a short lead when the sound follows a picture (the Video player). So every listener plays the same
/// moment together whatever its browser and wherever its start landed, and a stop and a start change nothing. Before this each page held
/// three seconds behind the arrival of its own first frame, and two pages could sit a quarter second apart for good (2026-11-03,
/// 3.3 s against 3.0 s after one restarted).
///
/// The clock: GET /audio/clock with the stream's ticket, the tightest round trip kept; the error between where a frame is due and where
/// the chain of scheduled frames stands is smoothed over about a second and taken by a speed within half a percent (which no ear hears,
/// 2026-10-31 night), and past three tenths of a second by one short cut under a fade. A frame that arrives past its time (the page was
/// held) is dropped, not played late.
///
/// Spliced into the phone page (RemotePage.cs) and the listen page (ListenPage.cs) where each says __LISTEN_PLAYER__. Plain script, no
/// modules, pure ASCII; the page makes the AudioContext inside its own tap and hands the player a gain node to play into (the phone's
/// goes on to a media element, the listen page's to the context's output).
/// </summary>
public static class ListenPlayer
{
    public const string Js = """
// makeListenPlayer(o): the one player for the PC's sound (ListenPlayer.cs). o: { ctx() the AudioContext the page made inside its tap;
// sink() the GainNode the frames play into; ticket() a promise of a fresh stream ticket; policy() 'house' (three seconds behind the PC's
// clock, with the room) or 'close' (the network's floor plus a short lead, for a picture); leadCap() the 'close' lead's cap in seconds;
// targetMs the house hold; trimMs() ms taken off the house hold on this device (the way to its speaker the browser does not report, set by
// the person: an Echo Show sounded a shade after an iPhone with both reporting 3.0 s, 2026-11-03); onFrame(peak) each frame; onStall() the
// sound ran dry; onEnd(why, closed) the stream is gone; diag(text) }.
function makeListenPlayer(o) {
  var P = { ws: null, ticket: '', got: 0, late: 0, stalls: 0, lastFrameAt: 0, playAt: 0, pending: [], rate: 48000, channels: 2, stampBytes: 0,
    clk: null, clkRtt: 1e9, floor: null, floorLog: [], lead: 0.09, cleanSince: 0, holdErr: null, lagLog: [], lastArrive: 0, jitter: 0,
    reopens: 0, reopenAt: 0, listening: false, clkTimer: 0, watchTimer: 0, targetMs: o.targetMs || 3000 };
  function ctx() { return o.ctx(); }
  function outLat() { try { var c = ctx(); return Math.min(1.5, (c.outputLatency || 0) + (c.baseLatency || 0)); } catch (e) { return 0; } }   // the way from the context to the speaker, where the browser says
  function level() { try { return o.sink().gain.value; } catch (e) { return 1; } }
  function trim() { try { var v = o.trimMs ? o.trimMs() : 0; return isFinite(v) ? Math.max(-1000, Math.min(1000, v)) : 0; } catch (e) { return 0; } }
  function say(t) { if (o.diag) { try { o.diag(t); } catch (e) {} } }
  // the sound cut to a new moment (2026-10-31 night): what was scheduled past the seam is stopped, and a short fade either side hides its edge
  function recut(seam, was) {
    for (var i = 0; i < P.pending.length; i++) { try { P.pending[i].stop(seam); } catch (e) {} }
    var g = o.sink().gain, lvl = level(), now = ctx().currentTime, end = Math.max(now, Math.min(was, seam));
    try { g.cancelScheduledValues(now); g.setValueAtTime(lvl, Math.max(now, end - 0.012)); g.linearRampToValueAtTime(0, Math.max(now + 0.001, end - 0.002)); g.setValueAtTime(0, seam); g.linearRampToValueAtTime(lvl, seam + 0.012); } catch (e) {}
  }
  // the PC's clock: where it stands less this page's performance.now, from the tightest round trip (the truest), the rest followed slowly
  function syncClock() {
    if (!P.listening || !P.ticket) return;
    var tk = P.ticket, a = performance.now();
    fetch('/audio/clock?ticket=' + encodeURIComponent(tk), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || P.ticket !== tk) return;
      var b = performance.now(), rtt = b - a, offset = j.now + rtt / 2 - b;
      if (P.clk === null || rtt <= P.clkRtt) { P.clk = offset; P.clkRtt = rtt; } else { P.clk += (offset - P.clk) * 0.1; P.clkRtt *= 1.05; }
    }).catch(function () {});
  }
  function onMessage(s, ev) {
    if (P.ws !== s) return;
    var c = ctx(); if (!c) return;
    if (typeof ev.data === 'string') { try { var h = JSON.parse(ev.data); if (h.rate) P.rate = h.rate; if (h.channels) P.channels = h.channels; P.stampBytes = h.stamp || 0; } catch (e) {} return; }
    P.got++; P.lastFrameAt = Date.now(); if (P.reopens && Date.now() - P.reopenAt > 5000) P.reopens = 0;
    var tArr = performance.now(); if (P.lastArrive) { var dev = Math.abs(tArr - P.lastArrive - 20); if (dev > P.jitter) P.jitter = dev; } P.lastArrive = tArr;
    var stamp = null, data = ev.data;
    if (P.stampBytes >= 8 && data.byteLength > P.stampBytes) { stamp = new DataView(data).getFloat64(0, true); data = data.slice(P.stampBytes); }
    var pcm = new Int16Array(data); var frames = pcm.length / P.channels; if (!frames) return;
    var pk = 0; for (var i = 0; i < pcm.length; i += 5) { var av = pcm[i] < 0 ? -pcm[i] : pcm[i]; if (av > pk) pk = av; }
    if (o.onFrame) o.onFrame(pk / 32768);
    var buf = c.createBuffer(P.channels, frames, P.rate);
    for (var ch = 0; ch < P.channels; ch++) { var d = buf.getChannelData(ch); for (var k = 0; k < frames; k++) d[k] = pcm[k * P.channels + ch] / 32768; }
    var src = c.createBufferSource(); src.buffer = buf; src.connect(o.sink());
    var now = c.currentTime, close = o.policy() === 'close', dry = !!P.playAt && P.playAt < now + 0.005;   // dry: the sound ran out before this frame
    // where this frame is due: its stamp plus the hold on the PC's clock, turned into the context's time; without a clock yet (the first
    // second) the hold behind arrival. The 'close' hold is the least the network has made a frame wait in the last ten seconds plus the
    // lead, the floor measured afresh from a frame the sound ran dry before (the network's delay moved up)
    var due, holdMs;
    if (stamp !== null && P.clk !== null) {
      var pcNow = tArr + P.clk, behind = pcNow - stamp;
      if (close) {
        if (dry) P.floorLog = [];
        P.floorLog.push({ at: tArr, v: behind }); while (P.floorLog.length && tArr - P.floorLog[0].at > 10000) P.floorLog.shift();
        var fl = Infinity; for (var j = 0; j < P.floorLog.length; j++) if (P.floorLog[j].v < fl) fl = P.floorLog[j].v;
        P.floor = fl; holdMs = fl + P.lead * 1000;
      } else holdMs = P.targetMs - trim();
      due = now + (stamp + holdMs - pcNow) / 1000 - outLat();
    } else { holdMs = close ? P.lead * 1000 : P.targetMs - trim(); due = now + holdMs / 1000 - (close ? 0 : outLat()); }
    if (!close && due < now + 0.01) { P.late++; return; }   // past its time (the page was held, a burst behind it): not played late, the next in time plays
    if (!P.playAt || dry) {   // the first frame, or the sound ran dry (a stall)
      if (dry) { P.stalls++; if (close) { P.lead = Math.min(o.leadCap ? o.leadCap() : 0.3, P.lead + 0.04); P.cleanSince = now; } if (o.onStall) o.onStall(); }
      P.playAt = Math.max(due, now + 0.02); P.holdErr = 0;
    } else {
      var err = P.playAt - due;   // scheduled later than due: behind, so a touch faster; the error smoothed over about a second
      P.holdErr = P.holdErr === null ? err : P.holdErr + (err - P.holdErr) * 0.03;
      // past three tenths (a fraction more following a picture, where each stall is a cut as before): one short cut under a fade, never by pitch
      if (Math.abs(P.holdErr) > (close ? 0.15 : 0.3)) { var to = Math.max(due, now + 0.02); recut(to, P.playAt); P.playAt = to; P.holdErr = 0; }
      else if (close && now - P.cleanSince > 45 && P.lead > 0.09) { P.lead = Math.max(0.09, P.lead - 0.005); P.cleanSince = now; }   // forty-five clean seconds: a sliver of the lead given back
    }
    var speed = 1 + Math.min(0.005, Math.max(-0.005, P.holdErr * 0.02));
    src.playbackRate.value = speed;
    var startAt = P.playAt;
    src.start(startAt); P.playAt += buf.duration / speed;
    src.onended = function () { var ix = P.pending.indexOf(src); if (ix >= 0) P.pending.splice(ix, 1); }; P.pending.push(src);
    // the lag this frame has at the speaker against the PC's clock, for the report (without a clock, the hold plus the encode and the network)
    P.lagLog.push(stamp !== null && P.clk !== null ? (tArr + P.clk - stamp) + (startAt - now + outLat()) * 1000 : (startAt - now + outLat()) * 1000 + 80);
    if (P.lagLog.length > 50) P.lagLog.shift();
  }
  function open(tk, old) {
    var s = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/audio/stream?ticket=' + encodeURIComponent(tk) + '&stamp=1');
    s.binaryType = 'arraybuffer';
    if (old) s.__old = old;
    s.onopen = function () {
      if (old) { try { old.onclose = null; old.onerror = null; old.onmessage = null; old.close(); } catch (e) {} if (s.__old === old) s.__old = null; }
      P.ticket = tk; P.clk = null; P.clkRtt = 1e9; syncClock(); setTimeout(syncClock, 1000);
    };
    s.onmessage = function (ev) { onMessage(s, ev); };
    s.onclose = function () { if (P.ws === s && P.listening) end('PRISM stopped the stream', true); };
    s.onerror = function () { if (P.ws === s && P.listening) end('Could not reach the sound on the PC', true); };
    P.ws = s;
  }
  // three seconds without a frame (the PC sends through silence too): a fresh ticket and a new socket, the old one closed once the new is
  // open, so the PC never counts no listener in between; twice in a row with nothing, the stream is given up and the page told why
  function watch() {
    if (!P.listening || !P.ws || P.ws.readyState !== 1 || Date.now() - P.lastFrameAt < 3000) return;
    if (P.reopens >= 2) { end('The sound from the PC stopped arriving. Tap Listen again.', false); return; }
    P.reopens++; P.reopenAt = Date.now(); P.lastFrameAt = Date.now(); say('stream frozen, reopening ' + P.reopens);
    var old = P.ws;
    o.ticket().then(function (tk) { if (P.listening && P.ws === old) open(tk, old); }).catch(function (e) { end('Could not reach the sound on the PC: ' + e.message, false); });
  }
  function start() {
    P.listening = true; P.playAt = 0; P.holdErr = null; P.pending = []; P.lagLog = []; P.got = 0; P.late = 0; P.stalls = 0; P.floorLog = []; P.floor = null;
    P.lead = 0.09; P.cleanSince = 0; P.reopens = 0; P.lastFrameAt = Date.now(); P.clk = null; P.clkRtt = 1e9; P.lastArrive = 0; P.jitter = 0; P.stampBytes = 0;
    return o.ticket().then(function (tk) {
      if (!P.listening) return;
      open(tk, null);
      if (!P.clkTimer) P.clkTimer = setInterval(syncClock, 5000);
      if (!P.watchTimer) P.watchTimer = setInterval(watch, 1000);
    });
  }
  function stop() {
    P.listening = false;
    if (P.ws) { var s = P.ws; P.ws = null; try { if (s.__old) s.__old.close(); } catch (e) {} try { s.onclose = null; s.onerror = null; s.onmessage = null; s.close(); } catch (e) {} }
    if (P.clkTimer) { clearInterval(P.clkTimer); P.clkTimer = 0; } if (P.watchTimer) { clearInterval(P.watchTimer); P.watchTimer = 0; }
    for (var i = 0; i < P.pending.length; i++) { try { P.pending[i].stop(); } catch (e) {} }
    P.pending = []; P.playAt = 0; P.ticket = '';
  }
  function end(why, closed) { if (!P.listening) return; stop(); if (o.onEnd) o.onEnd(why, closed); }
  function lagMs() { if (!P.lagLog.length) return null; var s = 0; for (var i = 0; i < P.lagLog.length; i++) s += P.lagLog[i]; return Math.round(s / P.lagLog.length); }
  function holdMs() { return o.policy() === 'close' ? lagMs() : P.targetMs; }   // what it holds to: the house figure, or, following a picture, its lag as it is
  function info() {
    var c = ctx();
    var r = { state: c ? c.state : 'no audio', ws: P.ws ? P.ws.readyState : null, got: P.got, late: P.late, stalls: P.stalls, lead: Math.round(P.lead * 1000), floor: P.floor === null ? null : Math.round(P.floor),
      clock: P.clk !== null, lag: lagMs(), ahead: c && P.playAt > c.currentTime ? Math.round((P.playAt - c.currentTime) * 1000) : 0, jitter: Math.round(P.jitter) };
    P.jitter = 0; return r;
  }
  return { start: start, stop: stop, lagMs: lagMs, holdMs: holdMs, info: info, listening: function () { return P.listening; }, setTarget: function (ms) { if (ms > 0) P.targetMs = ms; } };
}
""";
}
