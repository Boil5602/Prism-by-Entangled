namespace PrismHost.Services;

/// <summary>
/// The phone page (2026-10-03, "a simple web app delivered via QR codes ... enabling keyboard entry from phones. The app should also enable
/// the private listening feature through the phone sound"): one page the host serves at /remote, no build step, no framework. The token
/// from the QR stays in the page's address and goes with every call. Keyboard: what is typed lands in the field focused on the wall (the
/// sign-in window when one is up). Listen: the wall's sound on the phone, as a stream of 16-bit PCM over a WebSocket, played through
/// the Web Audio API with a short buffer; the wall stays quiet while a phone listens.
/// </summary>
public static class RemotePage
{
    public const string Html = """
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Prism"><meta name="mobile-web-app-capable" content="yes"><meta name="theme-color" content="#14171C"><title>Prism</title>
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><link rel="apple-touch-icon" sizes="180x180" href="/remote/icon-180.png"><link rel="icon" href="/remote/icon.png"><link id="mf" rel="manifest" href="/remote/manifest.json?token=__TOKEN__">
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;background:#14171C;color:#E8ECF2;font:16px system-ui,-apple-system,Segoe UI,sans-serif;min-height:100vh;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}
header{display:flex;align-items:center;gap:10px;padding:14px 18px 8px}header b{color:#F2B14C;font-size:18px}header #who{color:#8A93A2;font-size:13px;margin-left:auto}header .pw{font-family:system-ui,-apple-system,Segoe UI,sans-serif}
.more{background:#1C2129;color:#E8ECF2;border:0;border-radius:10px;padding:4px 10px;font:20px system-ui;line-height:1}
.menu{display:none;flex-direction:column;gap:8px;margin:0 14px 10px;padding:12px;background:#1C2129;border-radius:12px}.menu.on{display:flex}.menu button{background:#14171C;color:#E8ECF2;border:0;border-radius:10px;padding:12px;font:inherit;text-align:left}
.menu .how{margin:0;font-size:14px;line-height:1.45;color:#E8ECF2}
.players{display:flex;align-items:center;gap:8px;padding:2px 2px 6px;font-size:14px}.players span{flex:1}.menu .players button{padding:10px 14px;border-radius:999px}.menu .players button.on{background:#F2B14C;color:#14171C;font-weight:600}.menu .players button:disabled{opacity:.4}
.banner{display:none;align-items:center;gap:10px;margin:0 14px 10px;padding:10px 12px;background:#3A2E14;color:#F2B14C;border-radius:12px;font-size:14px}.banner.on{display:flex}.banner button{margin-left:auto;background:#F2B14C;color:#14171C;border:0;border-radius:10px;padding:8px 12px;font:600 14px system-ui;white-space:nowrap}
.np{display:flex;gap:12px;align-items:center;background:#1C2129;border-radius:12px;padding:12px}.np img{width:96px;height:96px;border-radius:8px;background:#14171C;object-fit:cover;flex:none}.np img:not([src]){visibility:hidden}.np.loading img{visibility:visible;background:#1C2129;box-shadow:inset 0 0 0 1px #2A3140}.np.loading img:not([src]){visibility:visible}.np.loading b{color:#F2B14C}.npt{display:flex;flex-direction:column;gap:2px;min-width:0}.npt b{font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.npt span{font-size:14px;color:#E8ECF2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#npSvc{color:#F2B14C;font-size:13px}
.mseek{margin-top:8px}.mseek .bar{height:3px;background:#2A3140;border-radius:2px;overflow:hidden}.mseek .bar i{display:block;height:100%;width:0;background:#F2B14C}.mseek .times{margin-top:4px}
.tr{display:flex;gap:10px;margin-top:12px}.tr button{flex:1;background:#1C2129;color:#E8ECF2;border:0;border-radius:14px;padding:18px;font:26px system-ui}.tr button.go{background:#F2B14C;color:#14171C}.tr button:disabled,.row button:disabled{opacity:.4}.row button.on,.vrow button.on{color:#F2B14C;font-weight:600}
.qh{margin:18px 0 8px;font-size:14px;letter-spacing:.08em;color:#E8ECF2;text-transform:uppercase}
.restore{display:none;flex-direction:column;gap:6px;background:#3A2E14;border-radius:12px;padding:12px;margin-bottom:10px}.restore.on{display:flex}.restore b{color:#F2B14C;font-size:15px}.restore span{color:#E8ECF2;font-size:14px;line-height:1.4}.restore .row{margin-top:4px}
.lwin{display:none;margin-top:10px}.lwin.on{display:block}#lwinRow{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}#lwinRow>button{min-width:0}#lwinRow>button:first-child{grid-column:1/-1}.lwin .order button{white-space:normal;line-height:1.25}.lwin .order button small{display:block;color:#E8ECF2;font-weight:400;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.order button{font-size:13px;padding:10px 6px}.order button.on{color:#F2B14C;font-weight:600;box-shadow:inset 0 0 0 1px #F2B14C}.order button:disabled{opacity:.4}
.install{display:none;position:fixed;left:12px;right:12px;bottom:calc(14px + env(safe-area-inset-bottom));background:#1C2129;border-radius:16px;padding:14px 14px 12px;box-shadow:0 8px 30px rgba(0,0,0,.5);z-index:45;flex-direction:column;gap:10px}.install.on{display:flex;animation:installIn .25s ease-out}@media (prefers-reduced-motion:reduce){.install.on{animation:none}}@keyframes installIn{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}.install p{margin:0;font-size:15px;color:#E8ECF2;line-height:1.4}.install ol{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}.install li{display:flex;align-items:center;gap:10px;font-size:14px;color:#E8ECF2}.install li .n{flex:none;width:22px;height:22px;border-radius:50%;background:#14171C;color:#F2B14C;font:600 13px system-ui;display:inline-flex;align-items:center;justify-content:center}.install li svg{flex:none;width:20px;height:20px;fill:none;stroke:#F2B14C;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.install .row{display:flex;gap:8px;align-items:center}.install .go{flex:1;background:#F2B14C;color:#14171C;border:0;border-radius:12px;padding:12px 14px;font:600 15px system-ui}.install .later{flex:1;background:#14171C;color:#E8ECF2;border:0;border-radius:12px;padding:12px 14px;font:15px system-ui}.install .never{background:none;border:0;color:#8A93A2;font:13px system-ui;padding:6px 0 0;text-align:left}@media (display-mode:standalone){.install{display:none !important}}
.sheet{display:none;position:fixed;left:12px;right:12px;bottom:calc(14px + env(safe-area-inset-bottom));background:#1C2129;border-radius:16px;padding:14px;box-shadow:0 8px 30px rgba(0,0,0,.5);z-index:50;flex-direction:column;gap:8px}.sheet.on{display:flex}.sheet b{font-size:15px;color:#E8ECF2;margin-bottom:4px}.sheet button{background:#14171C;color:#E8ECF2;border:0;border-radius:12px;padding:14px;font:16px system-ui}.sheet button.go{background:#F2B14C;color:#14171C;font-weight:600}
.trk{display:flex;flex-direction:column;gap:6px;max-height:55vh;overflow:auto}.trk .lbl{font-size:13px;color:#E8ECF2;margin-top:6px}.trk button.sel{color:#F2B14C;font-weight:600}
.muteNote{flex-direction:column;gap:8px}.muteNote.on{display:flex}.chk{display:flex;align-items:center;gap:8px;font-size:14px;color:#E8ECF2}.chk input{width:20px;height:20px;accent-color:#F2B14C}
.work .drop{background:#14171C;color:#F2B14C;border:0;border-radius:8px;padding:4px 10px;font:13px system-ui;margin-left:6px}
.work{display:none;margin:10px 0 0;padding:10px 12px;background:#1C2129;border-radius:12px;color:#F2B14C;font-size:14px}.work.on{display:block}.work.done{color:#E8ECF2}.work i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#F2B14C;margin-right:8px;animation:pulse 1s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}
.vnp img{width:72px;height:108px}.seek{margin-top:12px}.seek input{width:100%}.times{display:flex;justify-content:space-between;font-size:13px;color:#E8ECF2;margin-top:2px}
.vtr button{padding:14px;font-size:24px}.vrow{margin-top:10px}.vrow button{flex:1;background:#1C2129;color:#E8ECF2;border:0;border-radius:12px;padding:12px 8px;font:14px system-ui}.vrow button.on{color:#F2B14C}
.cards{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;scrollbar-width:none;-webkit-overflow-scrolling:touch}.cards::-webkit-scrollbar{display:none}.card{flex:none;width:112px;background:none;border:0;padding:0;color:#E8ECF2;text-align:left;font:13px system-ui}.card .art{width:112px;height:168px;border-radius:10px;background:#1C2129;object-fit:cover;display:block}.card .art.wide{height:63px}.card .bar{height:3px;background:#2A3140;border-radius:2px;margin-top:4px;overflow:hidden}.card .bar i{display:block;height:100%;background:#F2B14C}.card b{display:block;margin-top:5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.card span{display:block;color:#E8ECF2;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.card .svc2{color:#F2B14C}
.cards .note{margin:0}.qh .info{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:1px solid #8A93A2;color:#E8ECF2;background:none;font:italic 600 12px Georgia,serif;margin-left:8px;vertical-align:middle;padding:0;text-transform:none;letter-spacing:0}.qh .info.on{border-color:#F2B14C;color:#F2B14C}.about{display:none;margin:0 0 8px;font-size:13px;line-height:1.45;color:#E8ECF2;background:#1C2129;border-radius:10px;padding:10px 12px}.about.on{display:block}.search{display:flex;gap:8px;margin-top:14px}.search .sbox{flex:1;position:relative;display:flex;min-width:0}.search input{flex:1;background:#1C2129;color:#E8ECF2;border:0;border-radius:12px;padding:12px 40px 12px 14px;font:16px system-ui;min-width:0}.search input::-webkit-search-cancel-button{display:none}.search .clr{position:absolute;right:4px;top:50%;transform:translateY(-50%);background:transparent;color:#E8ECF2;border:0;padding:6px 10px;font:22px system-ui;display:none}.search .sbox.has .clr{display:block}.search button{background:#F2B14C;color:#14171C;border:0;border-radius:12px;padding:12px 16px;font:600 15px system-ui}
.hit{display:flex;gap:10px;background:#1C2129;border-radius:12px;padding:10px;margin-top:8px}.hit img{width:56px;height:84px;border-radius:6px;object-fit:cover;background:#14171C;flex:none}.hit img:not([src]){visibility:hidden}.hit .t{flex:1;min-width:0}.hit b{display:block;font-size:15px}.hit span{display:block;font-size:13px;color:#E8ECF2}.hit .on{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.hit .on button{background:#14171C;color:#F2B14C;border:0;border-radius:999px;padding:7px 12px;font:13px system-ui}
#vEpisodes{margin-top:12px}#vEpBody .ssn{font-size:12px;letter-spacing:.08em;color:#E8ECF2;text-transform:uppercase;margin:8px 6px 4px}#vEpBody .item.now{color:#F2B14C}.lens .qh small{display:block;font-size:11px;letter-spacing:0;text-transform:none;color:#8A93A2;margin-top:2px}.svc .item .now{display:block;color:#E8ECF2;font-size:13px;margin-top:2px}
.quick{display:flex;flex-direction:column;gap:8px}.svc{background:#1C2129;border-radius:12px;overflow:hidden}.svc>button.head{width:100%;display:flex;align-items:center;gap:10px;background:none;color:#E8ECF2;border:0;padding:14px 12px;font:600 16px system-ui;text-align:left}.svc>button.head .st{margin-left:auto;font-size:13px;font-weight:400;color:#F2B14C}.svc>button.head .chev{font-size:13px;color:#8A93A2}.svc.open>button.head .chev{transform:rotate(90deg)}
.svc .body{display:none;padding:0 8px 10px}.svc.open .body{display:block}.svc .grp{font-size:12px;letter-spacing:.08em;color:#E8ECF2;text-transform:uppercase;margin:8px 6px 4px}.svc .item{display:block;width:100%;background:#14171C;color:#E8ECF2;border:0;border-radius:10px;padding:12px;font:15px system-ui;text-align:left;margin-top:6px}.svc .item .pb{display:block;height:4px;background:#2A3140;border-radius:2px;margin-top:7px;overflow:hidden}.svc .item .pb i{display:block;height:100%;background:#F2B14C}.svc .item .pb i.unk{background:#8A93A2;width:100%;opacity:.35}.svc .item .pt{display:block;color:#E8ECF2;font-size:12px;margin-top:4px}.svc .item.go{color:#F2B14C}
nav{display:flex;gap:6px;padding:0 14px 10px}nav button{flex:1;background:#1C2129;color:#E8ECF2;border:0;border-radius:12px;padding:10px;font:inherit}nav button.on{background:#3A2E14;color:#F2B14C}
main{padding:0 14px 20px}section{display:none}section.on{display:block}
textarea{width:100%;min-height:96px;background:#1C2129;color:#E8ECF2;border:1px solid #2C3442;border-radius:12px;padding:12px;font:18px system-ui;resize:vertical}
.pw{display:none;gap:8px}.pw input{flex:1;background:#1C2129;color:#E8ECF2;border:1px solid #2C3442;border-radius:12px;padding:14px 12px;font:18px system-ui;min-width:0}.pw button{background:#1C2129;color:#E8ECF2;border:0;border-radius:12px;padding:0 14px;font:inherit}
body.pw textarea{display:none}body.pw .pw{display:flex}
.row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}.row button{flex:1;min-width:92px;background:#1C2129;color:#E8ECF2;border:0;border-radius:12px;padding:14px 10px;font:inherit}
.row button.go{background:#F2B14C;color:#14171C;font-weight:600}.row button:active{filter:brightness(1.3)}.row button:disabled{opacity:.45}
.pad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}.pad button{background:#1C2129;color:#E8ECF2;border:0;border-radius:12px;padding:16px;font:20px system-ui}.pad .e{grid-column:2}
.big{width:100%;background:#F2B14C;color:#14171C;border:0;border-radius:14px;padding:18px;font:600 18px system-ui;margin-top:12px}.big.off{background:#1C2129;color:#E8ECF2}
p.note{color:#E8ECF2;font-size:14px;line-height:1.4}
.verr{display:none;margin-top:10px;padding:12px;border-radius:12px;background:#1C2129;color:#F2B14C;font-size:15px;line-height:1.4;flex-direction:column;gap:10px}.verr.on{display:flex}.verr button{align-self:flex-start;background:#F2B14C;color:#14171C;border:0;border-radius:12px;padding:12px 18px;font:600 15px system-ui}
.target{display:flex;flex-direction:column;gap:3px;background:#1C2129;border-left:4px solid #8A93A2;border-radius:10px;padding:10px 12px;margin-bottom:10px}.target.on{border-left-color:#F2B14C}
.target .tl{font-size:16px;font-weight:600;color:#E8ECF2}.target.on .tl{color:#F2B14C}.target .ts{font-size:13px;color:#E8ECF2}p.err{color:#F2B14C;font-size:14px;min-height:1.4em}
label.vol{display:block;font-size:14px;padding:4px 2px}input[type=range]{width:100%;margin-top:6px}
</style></head><body>
<header>__WORDMARK__<span id="who">on this PC</span><button id="more" class="more" aria-label="Options">&#8943;</button></header>
<div id="menu" class="menu"><div class="players"><span>Prism on PC</span><button id="plMusic">Music lounge</button><button id="plVideo">Video</button></div><button id="addHome">Add to home screen</button><button id="bwBtn">Cover YouTube TV breaks: on</button><button id="modeBtn"></button><label class="vol" id="volRow">Page volume<input id="vol" type="range" min="0" max="100" value="100"></label><p class="note" id="volNote" style="display:none">This phone keeps its volume on its own buttons; a page cannot set it.</p><button id="forget">Forget this PC</button><button id="closeMenu">Close</button><p id="howHome" class="how"></p></div>
<div id="banner" class="banner"><span id="bannerText">Prism on the PC was updated. This page refreshes in 5:00.</span><button id="refreshNow">Refresh now</button></div>
<nav><button id="tabM" class="on">Music</button><button id="tabV" style="display:none">Video</button><button id="tabK">Keyboard</button><button id="tabL">Private Listening</button></nav>
<main>
<section id="M" class="on">
<div class="restore" id="restoreCard"><b>Restore the previous session?</b><span id="restoreWhat"></span><div class="row"><button id="restoreGo" class="go">Restore</button><button id="restoreNo">Not now</button></div></div>
<div class="np" id="np"><img id="npArt" alt=""><div class="npt"><b id="npTitle">Nothing playing</b><span id="npArtist"></span><span id="npSvc"></span></div></div>
<div class="seek mseek" id="npTimeRow" style="display:none"><div class="bar"><i id="npBar"></i></div><div class="times"><span id="npTime"></span><span id="npLeft"></span></div></div>
<div class="tr"><button data-c="prev" id="trPrev">&#9198;</button><button data-c="play" id="trPlay" class="go">&#9654;</button><button data-c="next" id="trNext">&#9197;</button></div>
<div class="row"><button data-c="thumbup" id="trUp">&#128077;</button><button data-c="thumbdown" id="trDown">&#128078;</button><button data-c="mute" id="trMute">Mute Prism on PC</button></div>
<div class="row order" id="orderRow"><button data-o="normal">In order</button><button data-o="true-shuffle">True shuffle</button><button data-o="reverse">Reverse</button><button id="repeatBtn">Repeat</button></div>
<p class="work" id="mwork"></p><p class="work" id="nextLine"></p>
<div id="pickSheet" class="sheet"><b id="pickWhat"></b><button id="pickNow" class="go">Play now</button><button id="pickNext">Play after this track</button><button id="pickCancel">Cancel</button></div>
<h3 class="qh">Quick play</h3>
<div id="quick" class="quick"><p class="note">Reading your services' lists&hellip;</p></div>
<p class="err" id="merr"></p>
</section>
<section id="V">
<div class="np vnp" id="vnp"><img id="vArt" alt=""><div class="npt"><b id="vTitle">Nothing playing</b><span id="vSub"></span><span id="vSvc"></span></div></div>
<div id="vErr" class="verr"><span id="vErrText"></span><button id="vRetry">Retry</button></div>
<div class="seek" id="vSeekRow"><input id="vSeek" type="range" min="0" max="1000" value="0"><div class="times"><span id="vPos">0:00</span><span id="vDur"></span></div></div>
<div class="tr vtr"><button data-v="restart" title="Start over (the previous episode in the first 5 seconds)">&#9198;</button><button data-v="seekbackward" title="Back 10 seconds">&#8630;</button><button data-v="play" id="vPlay" class="go">&#9654;</button><button data-v="seekforward" title="Forward 10 seconds">&#8631;</button><button data-v="nextepisode" title="Next episode">&#9197;</button></div>
<div class="row vrow"><button data-v="skipintro" id="vSkip">Skip intro</button><button data-v="captions">Captions</button><button data-v="mute" id="vMute">Mute Prism on PC</button></div>
<div class="svc" id="vEpisodes" style="display:none"><button class="head"><span class="chev">&#9654;</span><span id="vEpHead">Episodes</span><span class="st" id="vEpSt"></span></button><div class="body" id="vEpBody"></div></div>
<div class="search"><div class="sbox"><input id="vq" type="search" placeholder="Search everywhere" autocomplete="off"><button id="vclear" class="clr" type="button" aria-label="Clear search">&#215;</button></div><button id="vgo" class="go">Search</button></div>
<div id="vResults"></div>
<h3 class="qh">Continue watching</h3><div id="vCont" class="cards"><p class="note">Reading the services' lists&hellip;</p></div>
<h3 class="qh">My list</h3><div id="vList" class="cards"></div>
<div id="vLenses"></div>
<h3 class="qh">Live</h3><div id="vLive" class="quick"></div>
<p class="err" id="verr"></p>
</section>
<section id="K">
<div class="target" id="target"><span class="tl">Nothing is focused in Prism</span><span class="ts">Press into a field there, then type here.</span></div>
<textarea id="t" placeholder="Type here" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
<div id="pwrow" class="pw"><input id="p" type="password" placeholder="Type the password here" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"><button id="peek" type="button">Show</button></div>
<div class="row"><button id="send" class="go">Send</button><button id="sendEnter">Send + Enter</button><button id="clear">Clear box</button></div>
<div class="pad"><button data-k="DPAD_UP" class="e">&#9650;</button><button data-k="DPAD_LEFT">&#9664;</button><button data-k="ENTER">Enter</button><button data-k="DPAD_RIGHT">&#9654;</button><button data-k="BACKSPACE">&#9003;</button><button data-k="DPAD_DOWN">&#9660;</button><button data-k="TAB">Tab</button></div>
<p class="err" id="kerr"></p>
</section>
<section id="L">
<p class="note">Prism's sound comes to this phone. The PC keeps playing for the room; its mute and volume work the room's sound while you listen, and this phone's buttons work yours.</p>
<button id="listen" class="big">Listen on this phone</button>
<p class="note" id="modeNote"></p>
<p class="note" id="lvlNote"></p>
<div id="lwin" class="lwin"><p class="note">Listening to</p><div class="row order" id="lwinRow"></div><p class="note" id="lwinNote"></p></div>
<audio id="out" playsinline preload="none"></audio>
<p class="err" id="lerr"></p><p class="work" id="netNote"></p>
<div class="work muteNote" id="muteNote"><span id="muteNoteText"></span><label class="chk"><input type="checkbox" id="muteWhile"> Mute Prism on the PC while this phone listens</label></div>
</section>
<div id="install" class="install" role="dialog" aria-label="Add Prism to your Home Screen">
<p>Add Prism to your Home Screen. It opens full-screen and stays signed in.</p>
<ol id="installSteps"></ol>
<div class="row"><button class="go" id="installGo">Add Prism to Home Screen</button><button class="later" id="installLater">Not now</button></div>
<button class="never" id="installNever">Don't show again</button>
</div>
<!-- the Captions sheet sits outside the tab sections: inside the Music section it opened display:none while the Video tab was on (2026-10-05, "Captions on the companion app still doesn't work") -->
<div id="trkSheet" class="sheet"><b>Subtitles and audio</b><div id="trkList" class="trk"></div><button id="trkClose">Close</button></div>
</main>
<script>
const token = new URLSearchParams(location.search).get('token') || '';
const q = (s) => document.querySelector(s);
if (!q('#mf').href.includes('token=') || q('#mf').href.includes('__TOKEN__')) q('#mf').href = '/remote/manifest.json?token=' + encodeURIComponent(token);
const api = async (path, body, method) => {
  const r = await fetch(path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token), { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
  return j;
};
// options: add to the home screen (Android's own prompt when the browser offers it; the two taps otherwise), forget this wall
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
q('#more').onclick = () => { q('#menu').classList.toggle('on'); q('#howHome').textContent = ''; };
// the Home Screen nudge (docs/features/companion-install.md, 2026-10-05): a browser tab on a phone, not installed, paired, after 10 s on the page;
// iOS gets the two steps (Share, then Add to Home Screen), Android the two steps of its own menu and the one button when the browser offers
// the install itself (beforeinstallprompt only fires on https, so over the home network the steps are what it has). Not now hides it for 14
// days, Don't show again and an install for good. The state lives in this phone's localStorage and goes nowhere (section 22).
const INSTALL_KEY = 'prism.install', INSTALL_LATER_MS = 14 * 24 * 3600 * 1000;
const installState = () => { try { return JSON.parse(localStorage.getItem(INSTALL_KEY) || 'null') || {}; } catch { return {}; } };
const installSave = (st) => { try { localStorage.setItem(INSTALL_KEY, JSON.stringify(st)); } catch {} };
const standalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const phoneClass = () => (navigator.maxTouchPoints || 0) > 0 && Math.min(screen.width, screen.height) <= 820;
const uaIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const uaIosSafari = () => uaIos() && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(navigator.userAgent);
let installPaired = false, installShown = false;
const SHARE_SVG = '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg>';
const PLUS_SVG = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
const DOTS_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
function installStep(n, svg, text) { const li = document.createElement('li'); li.innerHTML = '<span class="n">' + n + '</span>' + svg; li.appendChild(document.createTextNode(text)); return li; }
function installEligible() {
  if (standalone() || !phoneClass() || !installPaired || installShown) return false;
  const st = installState();
  if (st.never || st.installed) return false;
  if (st.later && Date.now() - st.later < INSTALL_LATER_MS) return false;
  return true;
}
function showInstall() {
  if (!installEligible()) return;
  const box = q('#install'), steps = q('#installSteps'); steps.innerHTML = '';
  if (uaIos()) {
    steps.appendChild(installStep(1, SHARE_SVG, uaIosSafari() ? 'Tap Share at the bottom of Safari' : 'Tap Share'));
    steps.appendChild(installStep(2, PLUS_SVG, 'Choose Add to Home Screen'));
    q('#installGo').style.display = 'none';
  } else if (installPrompt) {
    q('#installGo').style.display = '';
  } else if (/Android/.test(navigator.userAgent)) {
    steps.appendChild(installStep(1, DOTS_SVG, 'Tap the browser menu'));
    steps.appendChild(installStep(2, PLUS_SVG, 'Choose Add to Home screen'));
    q('#installGo').style.display = 'none';
  } else return;   // another phone browser with no install of its own to offer: nothing
  installShown = true; box.classList.add('on');
}
const hideInstall = () => q('#install').classList.remove('on');
q('#installLater').onclick = () => { installSave({ ...installState(), later: Date.now() }); hideInstall(); };
q('#installNever').onclick = () => { installSave({ ...installState(), never: true }); hideInstall(); };
q('#installGo').onclick = async () => { if (!installPrompt) { hideInstall(); return; } installPrompt.prompt(); try { const c = await installPrompt.userChoice; if (c && c.outcome === 'accepted') installSave({ ...installState(), installed: true }); } catch {} installPrompt = null; hideInstall(); };
window.addEventListener('appinstalled', () => { installSave({ ...installState(), installed: true }); hideInstall(); });
window.addEventListener('beforeinstallprompt', () => { if (q('#install').classList.contains('on') && !uaIos()) { q('#installSteps').innerHTML = ''; q('#installGo').style.display = ''; } });
setTimeout(showInstall, 10000);   // never on first paint: 10 s on the page, paired
q('#closeMenu').onclick = () => q('#menu').classList.remove('on');
// the break watch's switch (2026-10-07, "we'll have to make this a feature they can shut down"): the PC's own Watch settings box, from the phone
let bwOn = localStorage.getItem('prismBreakWatch') !== 'off';
function drawBw() { q('#bwBtn').textContent = 'Cover YouTube TV breaks: ' + (bwOn ? 'on' : 'off'); }
drawBw();
q('#bwBtn').onclick = async () => { bwOn = !bwOn; drawBw(); try { localStorage.setItem('prismBreakWatch', bwOn ? 'on' : 'off'); await api('/video/break-watch', { on: bwOn }); } catch (e) { bwOn = !bwOn; drawBw(); } };
q('#addHome').onclick = async () => {
  if (installPrompt) { installPrompt.prompt(); try { await installPrompt.userChoice; } catch {} installPrompt = null; return; }
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  q('#howHome').textContent = ios
    ? 'On this phone: press the Share button at the bottom of Safari, then "Add to Home Screen". The icon opens this Prism already paired.'
    : /Android/.test(ua) ? 'On this phone: open the browser menu (the three dots), then "Add to Home screen". The icon opens this Prism already paired.'
    : 'In this browser: use its "Add to home screen" or "Install" item in the menu. The shortcut opens this Prism already paired.';
  q('#howHome').textContent += ' If the PC ever gets a new address on your network, pair again from the Prism menu.';
};
q('#forget').onclick = async () => {
  if (!confirm('Forget this PC? This phone will need a new code from the Prism menu to use it again.')) return;
  try { await fetch('/pairing?token=' + encodeURIComponent(token), { method: 'DELETE' }); } catch {}
  q('#howHome').textContent = 'This phone has forgotten this PC. Pair again from the Prism menu when you want it back.';
};
const TABS = [['tabM', 'M'], ['tabV', 'V'], ['tabK', 'K'], ['tabL', 'L']];
let tabNow = 'M';
function showTab(sec) { tabNow = sec; for (const [t, s2] of TABS) { q('#' + t).classList.toggle('on', s2 === sec); q('#' + s2).classList.toggle('on', s2 === sec); } if (sec === 'M') { pollNow(); loadQuick(); } if (sec === 'V') { pollVideo(); liveReadAsk(); } if (sec === 'L') readyTicket(); }
// the Live section is a person looking at the guides (docs/features/live.md): the phone asks for the read as the PC's Live tab does
// (2026-10-05, "Why does it say no live channels on any of my services?": only the PC's tab asked, so a phone opened after a restart saw none)
let liveAskedAt = 0;
function liveReadAsk() { if (Date.now() - liveAskedAt < 15 * 60 * 1000) return; liveAskedAt = Date.now(); api('/video/live-read', {}).catch(() => {}); }
setInterval(() => { if (tabNow === 'V') liveReadAsk(); }, 60 * 1000);
for (const [tab, sec] of TABS) q('#' + tab).onclick = () => showTab(sec);
// which player Prism on the PC shows: the menu says and switches it (the PC's own switch, by route); the Music tab is only there
// while the Music lounge is (2026-10-04)
let playerNow = null, playerWas = null;
async function pollPlayers() {
  try {
    const p = await api('/players');
    q('#plMusic').classList.toggle('on', p.active === 'music'); q('#plVideo').classList.toggle('on', p.active === 'video');
    q('#plMusic').disabled = !p.music; q('#plVideo').disabled = !p.video;
    q('#plMusic').title = p.music ? '' : 'No Music player is set up yet'; q('#plVideo').title = p.video ? '' : 'No Video player is set up yet';
    if (p.active !== playerNow) {
      playerNow = p.active;
      const m2 = modeFor(p.active);
      if (m2 !== mode) { mode = m2; sayMode(); if (listening) { say('#lerr', 'The PC is on the ' + (p.active === 'video' ? 'Video' : 'Music') + ' player: the sound restarts in ' + (mode === 'low' ? 'low delay' : 'background') + ' mode.'); stopListening('').then(() => q('#listen').click()); } }
      else sayMode();
      const music = p.active !== 'video', video = p.active === 'video';
      q('#tabM').style.display = music ? '' : 'none';
      q('#tabV').style.display = video ? '' : 'none';
      if (!music && tabNow === 'M') showTab('V');
      if (!video && tabNow === 'V') showTab(p.active === 'music' ? 'M' : 'K');
      if (music && tabNow === 'K' && p.active === 'music' && playerWas === 'video') showTab('M');
      playerWas = p.active;
    }
  } catch {}
}
for (const [id, kind] of [['plMusic', 'music'], ['plVideo', 'video']]) q('#' + id).onclick = async () => {
  try { await api('/ui/route', { route: 'prism://player/' + kind }); q('#menu').classList.remove('on'); setTimeout(pollPlayers, 800); setTimeout(pollPlayers, 2500); } catch (e) { q('#howHome').textContent = e.message; }
};
pollPlayers(); setInterval(pollPlayers, 5000);
// ---- the wall updated: a banner, five minutes to a refresh, or now (2026-10-04)
let pageVersion = null, refreshAt = 0;
async function checkVersion() {
  try {
    const r = await fetch('/remote/version'); const v = (await r.json()).v;
    if (pageVersion === null) { pageVersion = v; return; }
    if (v !== pageVersion && !refreshAt) { refreshAt = Date.now() + 5 * 60 * 1000; q('#banner').classList.add('on'); tickBanner(); }
  } catch {}
}
function tickBanner() {
  if (!refreshAt) return;
  const left = Math.max(0, Math.round((refreshAt - Date.now()) / 1000));
  q('#bannerText').textContent = 'Prism on the PC was updated. This page refreshes in ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') + '.';
  if (left <= 0) { location.reload(); return; }
  setTimeout(tickBanner, 1000);
}
q('#refreshNow').onclick = () => location.reload();
checkVersion(); setInterval(checkVersion, 60000);
// ---- music: now playing and the transport, the services' Quick play as an accordion
const mmss = (t) => { t = Math.max(0, Math.round(t)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0'); };
let npPos = null, npDur = null, npPlaying = false, npAt = 0;
let npCol = null, npSupport = null, nextOrder = null, work = null, lastNow = null;   // nextOrder null: the PC's plain press (carry on where it left off)   // work: {name, service, at, tile} while a pick is on its way
let npTile = null, npSession = null, npService = '', wallMuted = false;
async function pollNow() {
  if (tabNow !== 'M') return;
  try {
    const n = await api('/now-playing');
    const now = n.now;
    npTile = now ? now.tile : null; npSession = now ? now.session : null; npService = now && now.service ? now.service : 'the service';
    wallMuted = !!n.wallMuted; for (const b of document.querySelectorAll('#trMute, #vMute')) { b.textContent = wallMuted ? 'Unmute Prism on PC' : 'Mute Prism on PC'; b.classList.toggle('on', wallMuted); }
    lastNow = now; drawWork(n); drawNext(n.next); drawRestore(n.restore);
    const md = now && now.metadata ? now.metadata : {};
    if (work) {
      // the pick on its way is what the card shows (2026-10-04, "say the new service name and collection name with new title and poster labeled Loading")
      q('#npTitle').textContent = 'Loading' + '\u2026';
      q('#npArtist').textContent = work.collection || work.name;
      q('#npSvc').textContent = work.service + (work.collection ? ' ' + '\u00b7 ' + work.collection : '');
      q('#npArt').removeAttribute('src'); q('#np').classList.add('loading');
    } else {
    q('#np').classList.remove('loading');
    q('#npTitle').textContent = now ? (md.title || 'Playing') : 'Nothing playing';
    q('#npArtist').textContent = now ? [md.artist, md.album].filter(Boolean).join(' \u00b7 ') : (n.stage && n.stage.service ? n.stage.service + ' is on the stage. Pick something under Quick play' : 'Pick something under Quick play');
    // the service and what it holds: "Pandora \u00b7 Pop Coast Hits Radio station" (2026-10-04)
    const col = now && now.collection, kindWord = col && col.kind ? { station: 'station', playlist: 'playlist', album: 'album', artist: 'artist' }[col.kind] || col.kind : '';
    q('#npSvc').textContent = now ? [now.service, col && col.label ? col.label + (kindWord ? ' ' + kindWord : '') : '', now.onStage ? '' : 'not on the stage'].filter(Boolean).join(' \u00b7 ') : '';
    const aw = md.artwork;
    const art = typeof aw === 'string' ? aw : Array.isArray(aw) && aw.length ? (aw[aw.length - 1].src || '') : '';
    if (art) q('#npArt').src = art; else q('#npArt').removeAttribute('src');
    }
    q('#trPlay').innerHTML = now && now.playbackState === 'playing' ? '&#10074;&#10074;' : '&#9654;';
    npPos = now && typeof now.position === 'number' ? now.position : null; npDur = now && typeof now.duration === 'number' && now.duration > 0 ? now.duration : null;
    npPlaying = !!(now && now.playbackState === 'playing'); npAt = Date.now(); drawTime();
    const pend0 = now && now.pending && !now.pending.failed ? now.pending : null;
    npCol = pend0 && pend0.id ? { kind: pend0.kind, id: pend0.id, label: pend0.name } : now && now.collection && now.collection.id ? now.collection : null;
    if (work && work.kind && work.id && (!npCol || npCol.id !== work.id)) npCol = { kind: work.kind, id: work.id, label: work.name };   // this phone's own pick, before the PC has said so
    npSupport = now ? now.orderSupport : null;
    drawOrder(now);
    const tr = now && now.transport ? now.transport : {};
    q('#trPrev').disabled = !now || tr.previoustrack === false; q('#trNext').disabled = !now || tr.nexttrack === false; q('#trPlay').disabled = !now;
    q('#trUp').disabled = q('#trDown').disabled = !now;
  } catch (e) { say('#merr', e.message); }
}
setInterval(pollNow, 2500); pollNow();
// ---- the order (2026-10-04, "let me select shuffle/order in the companion app"): the PC's own choices, In order / True shuffle / Reverse and a
// standing Repeat; a chip on a held collection plays it again that way through the PC's own path, a chip with nothing held sets the next pick's order
function drawOrder(now) {
  // the PC's standing order counts only when it is for the collection playing now (2026-10-04, "reverse is lit up, but the order is not reverse")
  const cur = now && now.order && npCol && now.order.id === npCol.id && now.order.kind === npCol.kind ? now.order.order : (npCol ? 'normal' : (nextOrder || 'normal'));
  for (const b of document.querySelectorAll('#orderRow [data-o]')) {
    const o = b.dataset.o;
    const can = !npSupport || o === 'normal' || npSupport.own === true;   // no card yet (a pick loading): the chips stay live
    const station = npCol && npCol.kind === 'station' && o !== 'normal';
    b.disabled = !can || station;
    b.title = !can ? npSupport.own : station ? 'A station has no order to give' : '';
    b.classList.toggle('on', o === cur);
  }
  const r = q('#repeatBtn'); r.classList.toggle('on', !!(now && now.repeat)); r.disabled = !now;
}
for (const b of document.querySelectorAll('#orderRow [data-o]')) b.onclick = async () => {
  const o = b.dataset.o;
  if (b.disabled) { say('#merr', b.title); return; }
  nextOrder = o;
  // the pick in flight first (2026-10-04, "I hit apple vibes, then reverse, and it lost the reverse request": the card had no source yet,
  // so the press became a note about the next pick); then the card's collection
  const inFlight = work && work.id ? { tile: work.tile, service: work.service, col: { kind: work.kind, id: work.id, label: work.name } } : null;
  const tile = inFlight ? inFlight.tile : npTile, col = inFlight ? inFlight.col : npCol, service = inFlight ? inFlight.service : npService;
  if (!tile || !col) { for (const x of document.querySelectorAll('#orderRow [data-o]')) x.classList.toggle('on', x.dataset.o === o); say('#merr', 'The next pick plays ' + b.textContent.toLowerCase() + '.'); return; }
  const label = col.label || 'this collection';
  startWork(label + ' ' + b.textContent.toLowerCase(), service, tile, label, col.kind, col.id);
  try { await api('/music/play', { tile, kind: col.kind, id: col.id, order: o }); setTimeout(pollNow, 1200); } catch (e) { endWork(e.message); }
};
q('#repeatBtn').onclick = async () => {
  if (!npTile) return;
  const on = !q('#repeatBtn').classList.contains('on');
  q('#repeatBtn').classList.toggle('on', on);
  try { await api('/music/repeat', { tile: npTile, on }); say('#merr', on ? 'Repeat is on.' : 'Repeat is off.'); setTimeout(pollNow, 800); } catch (e) { say('#merr', e.message); }
};
// ---- the choice on a tap while something plays: now, or after this track
function pickSheet(what, go) {
  const sh = q('#pickSheet'); q('#pickWhat').textContent = what; sh.classList.add('on');
  q('#pickNow').onclick = () => { sh.classList.remove('on'); go('now'); };
  q('#pickNext').onclick = () => { sh.classList.remove('on'); go('next'); };
  q('#pickCancel').onclick = () => sh.classList.remove('on');
}
// the previous session, offered while nothing plays (2026-10-04): its collection, order, the track and the spot; Restore or Not now
let restoreSeen = null;
function drawRestore(r) {
  const el = q('#restoreCard');
  if (!r || work) { el.classList.remove('on'); return; }
  const key = JSON.stringify(r);
  if (key !== restoreSeen) {
    restoreSeen = key;
    const orderWord = { normal: 'in order', 'true-shuffle': 'true shuffle', reverse: 'reverse', shuffle: 'shuffle' }[r.order] || r.order;
    const kindWord = r.kind === 'station' ? ' station' : r.kind === 'album' ? ' album' : '';
    q('#restoreWhat').textContent = (r.label || 'the collection') + kindWord + ' on ' + r.service + (r.kind === 'station' ? '' : ', ' + orderWord + (r.repeat ? ', repeat on' : '') + (r.title ? '. ' + r.title + (r.artist ? ' by ' + r.artist : '') + (typeof r.position === 'number' ? ' at ' + mmss(r.position) : '') : '')) + '.';
    q('#restoreGo').onclick = async () => { el.classList.remove('on'); startWork(r.label || 'the previous session', r.service, r.tile, r.label, r.kind, null); try { const x = await api('/music/restore', {}); if (x && x.ok === false) endWork(x.error || 'Could not restore it', false); setTimeout(pollNow, 1200); } catch (e) { endWork(e.message, false); } };
    q('#restoreNo').onclick = async () => { el.classList.remove('on'); try { await api('/music/restore', undefined, 'DELETE'); } catch {} };
  }
  el.classList.add('on');
}
// the queued pick, said under the card, with a way to drop it
function drawNext(next) {
  const el = q('#nextLine');
  if (!next) {
    // no queued pick: the service's own next track, where its player tells us (2026-10-04, "Do any of the audio services tell us the next track + artist?")
    const now = lastNow;
    if (now && now.upNext && now.upNext.title && now.playbackState !== 'none') { el.className = 'work on done'; el.textContent = 'Up next on ' + (now.service || 'the service') + ': ' + now.upNext.title + (now.upNext.artist ? ' by ' + now.upNext.artist : ''); return; }
    el.className = 'work'; el.textContent = ''; return;
  }
  el.className = 'work on done'; el.textContent = '';
  el.appendChild(document.createTextNode('Next: ' + next.name + ' on ' + next.service + ', after ' + (next.after || 'this track') + '. '));
  const x = document.createElement('button'); x.textContent = 'Drop'; x.className = 'drop';
  x.onclick = async () => { try { await api('/music/next', undefined, 'DELETE'); setTimeout(pollNow, 300); } catch (e) { say('#merr', e.message); } };
  el.appendChild(x);
}
// ---- the work line: a tap on a collection folds the list and says what is happening until the PC reports the track (or that it did not start)
function startWork(name, service, tile, collection, kind, id) {
  work = { name, service, at: Date.now(), tile, collection: collection || null, kind: kind || null, id: id || null };
  const w = q('#mwork'); w.className = 'work on'; w.innerHTML = '<i></i>'; w.appendChild(document.createTextNode('Opening ' + name + ' on ' + service + '\u2026'));
  for (const d of document.querySelectorAll('#quick .svc.open')) d.classList.remove('open');
  if (openSvcs) openSvcs.clear();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function workText(s) {
  const w = s.work; const n = w.count !== null && w.count !== undefined ? ' ' + w.count.toLocaleString() + (w.total ? ' of ' + w.total.toLocaleString() : '') : '';
  const what = w.what.charAt(0).toUpperCase() + w.what.slice(1);
  const colon = what.indexOf(': ');
  if (colon > 0 && w.name) return what.slice(0, colon) + ': ' + w.name + ' on ' + (s.service || 'the service') + ', ' + what.slice(colon + 2) + n + '\u2026';
  return what + (w.name ? ' of ' + w.name : '') + ' on ' + (s.service || 'the service') + n + '\u2026';
}
function endWork(text, ok) {
  const w = q('#mwork'); w.className = 'work on' + (ok ? ' done' : ''); w.textContent = text; work = null;
  setTimeout(() => { if (!work) w.className = 'work'; }, ok ? 4000 : 8000);
}
function drawWork(n) {
  // the PC's own work line for a source (reading the track list, queueing), with its count; shown whether or not this phone asked for it
  const busy = (n.sources || []).find((s) => s.work && !s.work.error);
  if (busy && !work) { const w = q('#mwork'); w.className = 'work on'; w.innerHTML = '<i></i>'; w.appendChild(document.createTextNode(workText(busy))); }
  else if (!busy && !work && q('#mwork').className === 'work on' && !q('#mwork').textContent.startsWith('Opening')) q('#mwork').className = 'work';
  if (!work) return;
  const src0 = (n.sources || []).find((s) => s.tile === work.tile);
  if (src0 && src0.work && !src0.work.error) { const w = q('#mwork'); w.innerHTML = '<i></i>'; w.appendChild(document.createTextNode(workText(src0))); }
  // done when the PC's pending pick has cleared and the page plays: the new collection, not the one that was on before the tap
  const src = (n.sources || []).find((s) => s.tile === work.tile);
  const pend = src && src.pending;
  if (pend && pend.failed) { endWork(work.name + ' did not start on ' + work.service + ' (' + pend.failed + '). Try it again, or on the PC.', false); return; }
  if (src && src.work && src.work.error) { endWork(src.work.what + ' of ' + (src.work.name || work.name) + ' on ' + work.service + ': ' + src.work.error, false); return; }
  if (src && src.work && !src.work.error) return;   // still reading or queueing: the line above says so; not done yet
  if (src && !pend && src.playbackState === 'playing' && src.metadata && src.metadata.title && Date.now() - work.at > 1500) { endWork('Playing ' + work.name + ' on ' + work.service + ': ' + src.metadata.title + (src.metadata.artist ? ' by ' + src.metadata.artist : '') + '.', true); return; }
  if (Date.now() - work.at > 45000) endWork(work.name + ' has not started on ' + work.service + ' yet. The PC may still be opening it.', false);
}
// "00:20 of 1:40" and what is left (2026-10-04): the PC's position, advanced here between polls while the track plays
function drawTime() {
  const row = q('#npTimeRow');
  if (npPos === null) { row.style.display = 'none'; return; }
  row.style.display = '';
  const pos = Math.min(npDur || Infinity, npPos + (npPlaying ? (Date.now() - npAt) / 1000 : 0));
  q('#npTime').textContent = mmss(pos) + (npDur ? ' of ' + mmss(npDur) : '');
  q('#npLeft').textContent = npDur ? '-' + mmss(npDur - pos) + ' left' : '';
  q('#npBar').style.width = npDur ? Math.round(pos / npDur * 100) + '%' : '0';
}
setInterval(drawTime, 1000);
for (const b of document.querySelectorAll('[data-c]')) b.onclick = async () => {
  if (!npTile) { say('#merr', 'Nothing is playing in Prism'); return; }
  let c = b.dataset.c;
  // a service that has signed the household out (or never let them in) will not take a press: say so, as the PC's own bar would
  if (npSession === 'signed-out' && c !== 'mute') { say('#merr', npService + ' asks for a sign-in before it plays. Sign in on the PC (Prism menu, Set up services), then press again.'); return; }
  if (c === 'play') c = q('#trPlay').textContent.trim() === '\u25b6' ? 'play' : 'pause';
  if (c === 'mute') { c = wallMuted ? 'unmute' : 'mute'; wallMuted = !wallMuted; for (const m of document.querySelectorAll('#trMute, #vMute')) { m.textContent = wallMuted ? 'Unmute Prism on PC' : 'Mute Prism on PC'; m.classList.toggle('on', wallMuted); } }
  // in the background sound mode the phone holds seconds of the stream, so a pause on the PC alone would play on here until the buffer
  // ran dry (2026-10-04, "pressed pause, and the audible music never paused"): the phone's player pauses with it, and Play fetches
  // the stream fresh so the stale seconds are dropped
  if (c === 'pause') streamHold(true); else if (c === 'play') streamHold(false);
  try { await api('/tiles/' + encodeURIComponent(npTile) + '/command', { cmd: c }); setTimeout(pollNow, 600); } catch (e) { say('#merr', e.message); }
};
// ---- video: the big window's state and the bar's verbs, Continue watching, My list, Live (2026-10-04)
let vTile = null, vPlaying = false, vSig = '', vSeeking = false, vwork = null;
// the Video tab's work line (2026-10-05, Animal Control tapped three times with no sign the first landed): a tap says what is opening,
// pulses until the page names the title, then says what plays - or why it did not
function startVWork(name, service) {
  vwork = { name, service, at: Date.now() };
  const w = q('#verr'); w.className = 'err work on'; w.innerHTML = '<i></i>'; w.appendChild(document.createTextNode('Opening ' + name + ' on ' + service + '\u2026'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function endVWork(text, ok) {
  const w = q('#verr'); w.className = 'err work on' + (ok ? ' done' : ''); w.textContent = text; vwork = null;
  setTimeout(() => { if (!vwork) { w.className = 'err'; w.textContent = ''; } }, ok ? 5000 : 9000);
}
function drawVWork(now, svc) {
  if (!vwork) return;
  const vid = now && now.video;
  if (now && now.pending && now.pending.failed) { endVWork(vwork.name + ' did not start on ' + vwork.service + ' (' + now.pending.failed + ').', false); return; }
  if (now && now.error && Date.now() - vwork.at > 4000) { endVWork(vwork.service + ' says: ' + now.error, false); return; }
  if (vid && (vid.title || vid.series) && !now.pending && Date.now() - vwork.at > 1500) {
    const what = vid.series && vid.title && vid.series !== vid.title ? vid.series + ', ' + vid.title : (vid.title || vid.series);
    endVWork((vid.ad ? 'An ad before ' : 'Playing ') + what + ' on ' + (svc ? svc.name : vwork.service) + '.', true); return;
  }
  if (Date.now() - vwork.at > 60000) endVWork(vwork.name + ' has not started on ' + vwork.service + ' yet. The PC may still be opening it.', false);
}
async function pollVideo() {
  if (tabNow !== 'V') return;
  try {
    const v = await api('/video');
    const now = v.now, vid = now && now.video;
    vTile = now ? now.tile : null; vPlaying = !!(now && now.playing);
    const svc = v.services.find((x) => x.onScreen);
    drawVWork(now, svc);
    if (vwork) { q('#vTitle').textContent = 'Loading' + '\u2026'; q('#vSub').textContent = vwork.name; q('#vSvc').textContent = vwork.service; q('#vArt').removeAttribute('src'); q('#vnp').classList.add('loading'); } else {
    q('#vnp').classList.remove('loading');
    q('#vTitle').textContent = vid && (vid.title || vid.series) ? (vid.series && vid.title && vid.series !== vid.title ? vid.series : vid.title || vid.series) : now && now.pending ? 'Opening ' + now.pending.name + '\u2026' : 'Nothing playing';
    const ep = vid && typeof vid.season === 'number' && typeof vid.episode === 'number' ? 'S' + vid.season + ' E' + vid.episode : '';
    q('#vSub').textContent = vid ? [ep, vid.series && vid.title && vid.series !== vid.title ? vid.title : '', vid.ad ? 'an ad is playing' : ''].filter(Boolean).join(' \u00b7 ') : 'Pick something below';
    q('#vSvc').textContent = svc ? svc.name : '';
    // the page's own error said plainly, with Retry (2026-10-05, Netflix's "Too many people are using your account right now": "make that play
    // through to the companion app. And add the retry option"): Retry presses the page's own Retry, or opens the title again where there is none
    q('#vErrText').textContent = now && now.error ? now.error : ''; q('#vErr').classList.toggle('on', !!(now && now.error));
    const art = now && now.art; if (art) q('#vArt').src = art; else q('#vArt').removeAttribute('src');
    }
    q('#vPlay').innerHTML = vPlaying ? '&#10074;&#10074;' : '&#9654;';
    if (tabNow === 'V' && !window.__npPolled) { api('/now-playing').then((n) => { wallMuted = !!n.wallMuted; for (const m of document.querySelectorAll('#trMute, #vMute')) { m.textContent = wallMuted ? 'Unmute Prism on PC' : 'Mute Prism on PC'; m.classList.toggle('on', wallMuted); } }).catch(() => {}); }
    const can = now ? now.can : null;
    for (const b of document.querySelectorAll('[data-v]')) b.disabled = !now || (b.dataset.v !== 'mute' && b.dataset.v !== 'play' && b.dataset.v !== 'restart' && can && !can.cmd && !/seek/.test(b.dataset.v));
    // the skip button only while the service offers a skip (2026-10-05, "the skip button should only appear when skip is available")
    q('#vSkip').textContent = now && now.skip ? now.skip : 'Skip intro'; q('#vSkip').style.display = now && now.skip ? '' : 'none';
    vCanTracks = !!(can && can.tracks);
    const pos = vid && typeof vid.position === 'number' ? vid.position : null, dur = vid && typeof vid.duration === 'number' && vid.duration > 0 ? vid.duration : null;
    q('#vSeekRow').style.visibility = pos !== null ? 'visible' : 'hidden';
    if (pos !== null && !vSeeking) { q('#vPos').textContent = mmss(pos); q('#vDur').textContent = dur ? '-' + mmss(dur - pos) : ''; q('#vSeek').value = dur ? Math.round(pos / dur * 1000) : 0; q('#vSeek').disabled = !(dur && can && can.seek); }
    // the rows only when they changed
    const sig = JSON.stringify([v.continue, v.list, v.live, !!v.liveReading, !!v.liveCanRead, Math.floor(Date.now() / 60000)]);
    if (sig !== vSig) { vSig = sig; drawCards('#vCont', v.continue, 'Nothing to carry on with yet.'); drawCards('#vList', v.list, 'Nothing on your lists yet.'); drawLive(v.live, v); }
    pollEpisodes(now); pollLenses();
  } catch (e) { say('#verr', e.message); }
}
setInterval(pollVideo, 2500);
// ---- more of the Watch screen (2026-10-05, "more of the watch screen items added to the companion app interface")
// Search everywhere: TMDB's titles matched to the household's services first, then the services' own search pages; read as it fills
let vqToken = 0;
async function runSearch() {
  const words = q('#vq').value.trim(); if (!words) return;
  const box = q('#vResults'); box.innerHTML = '<p class="note">Searching for ' + words.replace(/</g, '&lt;') + '\u2026</p>';
  const my = ++vqToken;
  try {
    await api('/video/search', { q: words });
    for (let i = 0; i < 20 && my === vqToken; i++) {
      await new Promise((r) => setTimeout(r, i ? 1200 : 400));
      const st = await api('/video/search');
      if (my !== vqToken) return;
      drawResults(st, words);
      if (st.done) break;
    }
  } catch (e) { say('#verr', e.message); }
}
q('#vgo').onclick = runSearch; q('#vq').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); q('#vq').blur(); runSearch(); } };
// the search cleared (2026-10-06, "I need a way to clear the search on the companion app"): the words and the results go, the box keeps the focus for new words
q('#vq').oninput = () => { q('#vq').parentElement.classList.toggle('has', q('#vq').value.length > 0); if (!q('#vq').value) q('#vResults').innerHTML = ''; };
q('#vclear').onclick = () => { q('#vq').value = ''; q('#vq').parentElement.classList.remove('has'); q('#vResults').innerHTML = ''; q('#vq').focus(); };
function drawResults(st, words) {
  const box = q('#vResults'); box.innerHTML = '';
  if (!st || st.none) return;
  const lib = st.library || [], rows = st.rows || [];
  // the household's own titles the words match come first (no page asked), then the catalog's titles, grouped by title
  for (const h of lib) {
    const el = hitCard(h.title, h.artwork, h.kind || '', (h.services || []).map((sv) => ({ label: 'Play on ' + sv.name + (sv.from ? ' \u00b7 ' + ({ continue: 'Continue watching', list: 'My list', owned: 'Owned' }[sv.from] || sv.from) : ''), go: () => playCard(sv.facet, sv.item, sv.name) })));
    box.appendChild(el);
  }
  const byTitle = new Map();
  for (const r of rows) { const c = r.candidate || {}; const key = (c.title || '') + '|' + (c.year || ''); if (!byTitle.has(key)) byTitle.set(key, { c, services: [] }); byTitle.get(key).services.push(r); }
  for (const [, g] of byTitle) {
    const c = g.c;
    const el = hitCard(c.title + (c.year ? ' (' + c.year + ')' : ''), c.poster || c.backdrop || null, c.kind === 'series' ? 'Series' : c.kind === 'movie' ? 'Film' : '', g.services.map((r) => ({ label: 'Play on ' + r.name + (r.offer ? ' \u00b7 ' + r.offer : ''), go: () => playResult(r.app, r.candidate, r.name) })));
    box.appendChild(el);
  }
  if (!lib.length && !rows.length) { const n = document.createElement('p'); n.className = 'note'; n.textContent = st.done ? 'Nothing for "' + words + '" on your services.' + (st.elsewhere && st.elsewhere.length ? ' TMDB lists it on ' + st.elsewhere.join(', ') + '.' : '') : 'Searching\u2026'; box.appendChild(n); }
  if (st.attribution) { const a = document.createElement('p'); a.className = 'note'; a.textContent = st.attribution; box.appendChild(a); }
}
function hitCard(title, art, sub, plays) {
  const el = document.createElement('div'); el.className = 'hit';
  const img = document.createElement('img'); img.alt = ''; if (art) img.src = art; el.appendChild(img);
  const t = document.createElement('div'); t.className = 't';
  const b = document.createElement('b'); b.textContent = title; t.appendChild(b);
  if (sub) { const sp = document.createElement('span'); sp.textContent = sub; t.appendChild(sp); }
  const on = document.createElement('div'); on.className = 'on';
  for (const pl of plays) { const btn = document.createElement('button'); btn.textContent = pl.label; btn.onclick = pl.go; on.appendChild(btn); }
  t.appendChild(on); el.appendChild(t);
  return el;
}
async function playCard(facet, it, service) {
  startVWork(it.title, service);
  try { const r = await api('/video/play', { facet, kind: it.kind || 'title', id: it.id || it.url || it.title, url: it.url, name: it.title }); if (r && r.ok === false) endVWork(r.error || 'Could not play it', false); setTimeout(pollVideo, 1500); } catch (e) { endVWork(e.message, false); }
}
async function playResult(app, candidate, service) {
  startVWork(candidate.title || 'the title', service);
  try { const r = await api('/video/play-result', { app, candidate }); if (r && r.ok === false) endVWork(r.error || 'Could not play it', false); setTimeout(pollVideo, 1500); } catch (e) { endVWork(e.message, false); }
}
// the Episodes of the series on screen, as the service lists them; the one playing marked; a press plays it on the PC
let vEpSig = '';
async function pollEpisodes(now) {
  const vid = now && now.video; const box = q('#vEpisodes');
  if (!vid || !vid.series) { box.style.display = 'none'; vEpSig = ''; return; }
  try {
    const ep = await api('/video/episodes');
    const sig = JSON.stringify([ep.series, ep.current, (ep.seasons || []).map((s) => [s.season, (s.episodes || []).length])]);
    box.style.display = '';
    q('#vEpHead').textContent = (ep.series || vid.series) + ' episodes';
    q('#vEpSt').textContent = ep.current ? 'S' + ep.current.season + ' E' + ep.current.episode : ep.ready ? '' : 'reading\u2026';
    if (sig === vEpSig) return; vEpSig = sig;
    const body = q('#vEpBody'); body.innerHTML = '';
    if (ep.error) { const n = document.createElement('p'); n.className = 'note'; n.textContent = ep.error; body.appendChild(n); return; }
    for (const sn of ep.seasons || []) {
      const h = document.createElement('div'); h.className = 'ssn'; h.textContent = 'Season ' + sn.season; body.appendChild(h);
      for (const e of sn.episodes || []) {
        const b = document.createElement('button'); b.className = 'item' + (ep.current && ep.current.season === sn.season && ep.current.episode === e.episode ? ' now' : '');
        b.textContent = 'E' + e.episode + (e.title ? ' \u00b7 ' + e.title : '');
        b.disabled = !ep.canPlay || !e.id;
        b.onclick = async () => { startVWork((ep.series || vid.series) + ' S' + sn.season + ' E' + e.episode, ep.service || ''); try { const r = await api('/video/episodes/play', { id: e.id }); if (r && r.ok === false) endVWork(r.error || 'Could not play it', false); setTimeout(pollVideo, 1500); } catch (er) { endVWork(er.message, false); } };
        body.appendChild(b);
      }
    }
  } catch (e) { say('#verr', e.message); }
}
q('#vEpisodes .head').onclick = () => q('#vEpisodes').classList.toggle('open');
// the lens rows (New episodes this week, Released this month, Most read on Wikipedia, The Binge ...): the Watch screen's own rows, as posters
let vLensSig = '', vLensAt = 0;
async function pollLenses() {
  if (Date.now() - vLensAt < 60000) return; vLensAt = Date.now();
  try {
    const r = await api('/video/lenses');
    const sig = JSON.stringify((r.rows || []).map((x) => [x.id, x.cards.length, x.reading]));
    if (sig === vLensSig) return; vLensSig = sig;
    const box = q('#vLenses'); box.innerHTML = '';
    for (const row of r.rows || []) {
      const wrap = document.createElement('div'); wrap.className = 'lens';
      const h = document.createElement('h3'); h.className = 'qh'; h.textContent = row.name + (row.reading ? ' \u00b7 still reading' : '');
      const info = document.createElement('button'); info.className = 'info'; info.textContent = 'i'; info.setAttribute('aria-label', 'About this row');
      const about = document.createElement('p'); about.className = 'about';
      about.textContent = [row.counted, row.who, row.source ? 'Source: ' + row.source : '', row.dataDate ? 'As of ' + row.dataDate : ''].filter(Boolean).map((t) => t.replace(/[.]$/, '')).join('. ') + '.';
      info.onclick = () => { about.classList.toggle('on'); info.classList.toggle('on'); };
      h.appendChild(info); wrap.appendChild(h); wrap.appendChild(about);
      const cards = document.createElement('div'); cards.className = 'cards';
      for (const c of row.cards) {
        const b = document.createElement('button'); b.className = 'card';
        const img = document.createElement('img'); img.className = 'art'; img.alt = ''; const art = c.catalog ? c.artwork : (c.item && c.item.artwork);
        if (art) img.src = art; img.onload = () => { if (img.naturalWidth > img.naturalHeight * 1.2) img.classList.add('wide'); }; b.appendChild(img);
        const t = document.createElement('b'); t.textContent = c.catalog ? c.title : c.item.title; b.appendChild(t);
        const sub = document.createElement('span'); sub.textContent = c.catalog ? (c.value || c.rating || '') : (c.lens || c.item.subtitle || c.rating || ''); if (sub.textContent) b.appendChild(sub);
        const sv = document.createElement('span'); sv.className = 'svc2'; sv.textContent = c.catalog ? (c.services || []).map((x) => x.name).join(', ') : c.service; b.appendChild(sv);
        if (c.catalog) {
          const svcs = c.services || [];
          b.onclick = () => { if (!svcs.length) { say('#verr', 'None of your services carries ' + c.title + '.'); return; } if (svcs.length === 1) browsePlay(svcs[0].app, c.id, c.title, svcs[0].name); else { const el = hitCard(c.title + (c.year ? ' (' + c.year + ')' : ''), art, 'Which service?', svcs.map((x) => ({ label: 'Play on ' + x.name + (x.offer ? ' \u00b7 ' + x.offer : ''), go: () => { q('#vResults').innerHTML = ''; browsePlay(x.app, c.id, c.title, x.name); } }))); q('#vResults').innerHTML = ''; q('#vResults').appendChild(el); window.scrollTo({ top: q('#vResults').offsetTop - 80, behavior: 'smooth' }); } };
        } else b.onclick = () => playCard(c.facet, c.item, c.service);
        cards.appendChild(b);
      }
      wrap.appendChild(cards); box.appendChild(wrap);
    }
  } catch (e) { say('#verr', e.message); }
}
async function browsePlay(app, cardId, title, service) {
  startVWork(title, service);
  try { const r = await api('/video/browse-play', { app, card: cardId }); if (r && r.ok === false) endVWork(r.error || 'Could not play it', false); setTimeout(pollVideo, 1500); } catch (e) { endVWork(e.message, false); }
}
function drawCards(sel, cards, empty) {
  const box = q(sel); box.innerHTML = '';
  if (!cards || !cards.length) { const n = document.createElement('p'); n.className = 'note'; n.textContent = empty; box.appendChild(n); return; }
  for (const c of cards) {
    const it = c.item;
    const b = document.createElement('button'); b.className = 'card';
    const img = document.createElement('img'); img.className = 'art'; img.alt = ''; if (it.artwork) img.src = it.artwork;
    img.onload = () => { if (img.naturalWidth > img.naturalHeight * 1.2) img.classList.add('wide'); };
    b.appendChild(img);
    if (typeof it.progress === 'number' && it.progress > 0) { const bar = document.createElement('div'); bar.className = 'bar'; const i = document.createElement('i'); i.style.width = Math.round(Math.min(1, it.progress) * 100) + '%'; bar.appendChild(i); b.appendChild(bar); }
    const t = document.createElement('b'); t.textContent = it.title; b.appendChild(t);
    if (it.subtitle) { const sub = document.createElement('span'); sub.textContent = it.subtitle; b.appendChild(sub); }
    const sv = document.createElement('span'); sv.className = 'svc2'; sv.textContent = c.service; b.appendChild(sv);
    b.onclick = async () => { startVWork(it.title, c.service); try { const r = await api('/video/play', { facet: c.facet, kind: it.kind || 'title', id: it.id || it.url || it.title, url: it.url, name: it.title }); if (r && r.ok === false) endVWork(r.error || 'Could not play it', false); setTimeout(pollVideo, 1500); setTimeout(pollPlayers, 1500); } catch (e) { endVWork(e.message, false); } };
    box.appendChild(b);
  }
}
// the bar under a channel's program (2026-10-05, "a data bar in each live channel ... how much runtime and how close to complete each current show is"):
// elapsed of the program's runtime from the guide; a service that says only when it ends gets the time left and a grey bar; redrawn each poll
function liveBar(b, ch) {
  if (!ch.end) return;
  const now = Date.now(), mins = (ms) => Math.max(0, Math.round(ms / 60000));
  const bar = document.createElement('span'); bar.className = 'pb'; const fill = document.createElement('i'); bar.appendChild(fill);
  const line = document.createElement('span'); line.className = 'pt';
  if (ch.start && ch.end > ch.start) {
    const total = ch.end - ch.start, done = Math.min(total, Math.max(0, now - ch.start));
    fill.style.width = Math.round(100 * done / total) + '%';
    line.textContent = mins(done) + ' of ' + mins(total) + ' min \u00b7 ' + mins(ch.end - now) + ' left';
  } else { fill.className = 'unk'; line.textContent = mins(ch.end - now) + ' min left'; }
  b.appendChild(bar); b.appendChild(line);
}
function drawLive(live, v) {
  const box = q('#vLive');
  const wasOpen = new Set([...box.querySelectorAll('.svc.open .head span:nth-child(2)')].map((e) => e.textContent));   // a redraw (the bars move each minute) keeps what was open
  box.innerHTML = '';
  if (!live || !live.length) { const n = document.createElement('p'); n.className = 'note'; n.textContent = v && v.liveReading ? 'Reading your services\' live guides\u2026' : v && v.liveCanRead ? 'No live channels read yet. They are read while this section is open; give it a moment.' : 'No live channels on your services.'; box.appendChild(n); return; }
  for (const s of live) {
    const d = document.createElement('div'); d.className = 'svc';
    const head = document.createElement('button'); head.className = 'head';
    head.innerHTML = '<span class="chev">&#9654;</span><span></span><span class="st"></span>';
    head.children[1].textContent = s.name; head.children[2].textContent = s.channels.length + (s.channels.length === 1 ? ' channel' : ' channels');
    head.onclick = () => d.classList.toggle('open');
    if (wasOpen.has(s.name)) d.classList.add('open');
    d.appendChild(head);
    const body = document.createElement('div'); body.className = 'body';
    for (const ch of s.channels) {
      const b = document.createElement('button'); b.className = 'item';
      const nm = document.createElement('span'); nm.textContent = (ch.event && ch.series ? ch.series + ' \u00b7 ' : '') + ch.name; b.appendChild(nm);
      if (ch.now) { const nw = document.createElement('span'); nw.className = 'now'; nw.textContent = ch.now; b.appendChild(nw); liveBar(b, ch); }
      b.onclick = async () => { startVWork(ch.name, s.name); try { const r = await api('/video/tune', { facet: s.facet, channel: ch.id, url: ch.url, name: ch.name }); if (r && r.ok === false) endVWork(r.error || 'Could not tune it', false); setTimeout(pollVideo, 1500); setTimeout(pollPlayers, 1500); } catch (e) { endVWork(e.message, false); } };
      body.appendChild(b);
    }
    d.appendChild(body); box.appendChild(d);
  }
}
// the Captions sheet (2026-10-05, "The caption button should open the menu of options and allow selection"): the service's own subtitle and
// audio tracks as the PC's menu lists them, the one in use marked; a tap picks it on the PC; Close lets a service's own panel close. A
// service without a tracks script gets its own captions button pressed on the PC instead, as before.
let vCanTracks = false;
async function openTracks() {
  const sh = q('#trkSheet'), list = q('#trkList'); list.innerHTML = ''; sh.classList.add('on');
  const tile = vTile;
  const p = document.createElement('p'); p.className = 'note'; p.textContent = "Reading the player's tracks" + String.fromCharCode(8230); list.appendChild(p);
  let t = null; try { t = await api('/video/tracks', { tile }); } catch (e) { t = { ok: false, error: e.message }; }
  if (!sh.classList.contains('on')) return;
  list.innerHTML = '';
  const none = (why) => { const n = document.createElement('p'); n.className = 'note'; n.textContent = why || 'The player lists no tracks right now.'; list.appendChild(n); };
  if (!t || !t.ok) { none(t && t.error); return; }
  const section = (head, kind) => {
    const rows = t[kind] || []; if (!rows.length) return;
    const h = document.createElement('div'); h.className = 'lbl'; h.textContent = head; list.appendChild(h);
    for (const tr of rows) {
      const b = document.createElement('button'); b.textContent = tr.name; b.dataset.kind = kind; if (tr.selected) b.classList.add('sel');
      b.onclick = async () => {
        for (const o of list.querySelectorAll('button')) if (o.dataset.kind === kind) o.classList.remove('sel');
        b.classList.add('sel');
        try { const r = await api('/video/track', { tile, kind, id: tr.id }); if (r && r.ok === false) say('#verr', r.error || 'Could not pick it'); } catch (e) { say('#verr', e.message); }
      };
      list.appendChild(b);
    }
  };
  section('Subtitles', 'subtitles'); section('Audio', 'audio');
  if (!list.children.length) none('');
}
q('#vRetry').onclick = async () => { if (!vTile) return; q('#vRetry').disabled = true; try { await api('/tiles/' + encodeURIComponent(vTile) + '/command', { cmd: 'retry' }); } catch (e) { say('#verr', e.message); } setTimeout(() => { q('#vRetry').disabled = false; pollVideo(); }, 1500); };
q('#trkClose').onclick = () => { q('#trkSheet').classList.remove('on'); if (vTile) api('/video/tracks-done', { tile: vTile }).catch(() => {}); };
for (const b of document.querySelectorAll('[data-v]')) b.onclick = async () => {
  if (!vTile) { say('#verr', 'Nothing is playing in Prism'); return; }
  let c = b.dataset.v;
  if (c === 'captions' && vCanTracks) { openTracks(); return; }
  if (c === 'play') c = vPlaying ? 'pause' : 'play';
  if (c === 'mute') { c = wallMuted ? 'unmute' : 'mute'; wallMuted = !wallMuted; for (const m of document.querySelectorAll('#trMute, #vMute')) { m.textContent = wallMuted ? 'Unmute Prism on PC' : 'Mute Prism on PC'; m.classList.toggle('on', wallMuted); } }
  if (c === 'pause') streamHold(true); else if (c === 'play') streamHold(false);
  try {
    if (c === 'restart') { const r = await api('/video/start-over', {}); if (r && r.ok === false) say('#verr', r.error || 'Could not start over'); }
    else await api('/tiles/' + encodeURIComponent(vTile) + '/command', { cmd: c });
    setTimeout(pollVideo, 700);
  } catch (e) { say('#verr', e.message); }
};
// the seek bar: the spot goes when the finger lifts (the PC's own bar does the same)
q('#vSeek').oninput = () => { vSeeking = true; const dur = q('#vDur').textContent; q('#vPos').textContent = '\u2026'; };
q('#vSeek').onchange = async () => {
  vSeeking = false;
  try {
    const v = await api('/video'); const vid = v.now && v.now.video; const dur = vid && vid.duration;
    if (!v.now || !dur) return;
    const r = await api('/video/seek', { tile: v.now.tile, seconds: Math.round(q('#vSeek').value / 1000 * dur) });
    if (r && r.ok === false) say('#verr', r.error || 'This service cannot seek to a spot yet');
    setTimeout(pollVideo, 800);
  } catch (e) { say('#verr', e.message); }
};
let quickSig = '', openSvcs = null;   // which services' sections are open: the person's own folds, kept across redraws (2026-10-04, "the collection menu pops open for no reason")
async function loadQuick() {
  try {
    const r = await api('/music/quick');
    const sig = JSON.stringify((r.sources || []).map((s) => [s.tile, s.name, s.session, (s.playlists || []).map((p) => p.id + p.name), (s.stations || []).map((p) => p.id + p.name)]));
    if (sig === quickSig) {
      // the same shape: only the words on the heads move (2026-10-04: a rebuild on every playback flip swallowed taps mid-pick)
      for (const s of r.sources || []) { const st = q('#quick .svc[data-tile="' + s.tile + '"] .st'); if (st) st.textContent = s.session === 'signed-out' ? 'signed out' : s.playbackState === 'playing' ? 'playing' : s.active ? 'on the stage' : ''; }
      return;
    }
    quickSig = sig;
    const box = q('#quick'); box.innerHTML = '';
    if (!r.sources || !r.sources.length) { box.innerHTML = '<p class="note">No music service is set up in Prism yet.</p>'; return; }
    for (const s of r.sources) {
      if (openSvcs === null) { openSvcs = new Set(r.sources.filter((x) => x.active).map((x) => x.tile)); }   // the first paint: the stage's service open
      const d = document.createElement('div'); d.className = 'svc' + (openSvcs.has(s.tile) ? ' open' : ''); d.dataset.tile = s.tile;
      const head = document.createElement('button'); head.className = 'head';
      head.innerHTML = '<span class="chev">&#9654;</span><span></span><span class="st"></span>';
      head.children[1].textContent = s.name;
      head.children[2].textContent = s.session === 'signed-out' ? 'signed out' : s.playbackState === 'playing' ? 'playing' : s.active ? 'on the stage' : '';
      head.onclick = () => { d.classList.toggle('open'); if (d.classList.contains('open')) openSvcs.add(s.tile); else openSvcs.delete(s.tile); };
      d.appendChild(head);
      const body = document.createElement('div'); body.className = 'body';
      const out = s.session === 'signed-out';
      const resume = document.createElement('button'); resume.className = 'item go'; resume.textContent = out ? 'Signed out. Open the sign-in on the PC' : s.active ? 'Start over' : 'Play ' + s.name;
      // signed out: the press opens the service's sign-in on the PC (the same route as Set up services) and brings the Keyboard tab up here
      resume.onclick = async () => { if (out) { try { await api('/ui/route', { route: 'prism://app/' + encodeURIComponent(s.app) + '/setup' }); say('#merr', s.name + "'s sign-in is open on the PC. Type into its fields from the Keyboard tab."); showTab('K'); } catch (e) { say('#merr', e.message); } return; } try { await api('/tiles/' + encodeURIComponent(s.tile) + '/command', { cmd: s.active ? 'restart' : 'play' }); setTimeout(pollNow, 800); } catch (e) { say('#merr', e.message); } };
      body.appendChild(resume);
      for (const [grp, items] of [['Playlists', s.playlists], ['Stations', s.stations]]) {
        if (!items || !items.length) continue;
        const g = document.createElement('div'); g.className = 'grp'; g.textContent = grp; body.appendChild(g);
        for (const it of items.slice(0, 60)) {
          const b = document.createElement('button'); b.className = 'item'; b.textContent = it.name;
          b.onclick = async () => {
            if (s.session === 'signed-out') { say('#merr', s.name + ' asks for a sign-in before it plays. Sign in on the PC first.'); return; }
            const kind = grp === 'Playlists' ? 'playlist' : 'station';
            const go = async (when) => {
              if (when === 'now') startWork(it.name, s.name, s.tile, it.name, kind, it.id);
              else { say('#merr', ''); for (const d of document.querySelectorAll('#quick .svc.open')) d.classList.remove('open'); if (openSvcs) openSvcs.clear(); window.scrollTo({ top: 0, behavior: 'smooth' }); }   // the list folds for a queued pick too (2026-10-04)
              try {
                const r = await api('/music/play', { tile: s.tile, kind, id: it.id, order: kind === 'station' || !nextOrder ? 'auto' : nextOrder, when });
                if (when === 'next' && r && r.started) startWork(it.name, s.name, s.tile, it.name, kind, it.id);
                setTimeout(pollNow, 1200);
              } catch (e) { endWork(e.message, false); }
            };
            // something plays: now, or after this track (2026-10-04, "choose to play after the current track"); nothing plays: now
            if (npPlaying || work || npTile) pickSheet(it.name + ' on ' + s.name, go); else go('now');   // anything held (playing, paused, or a pick on its way) gets the choice
          };
          body.appendChild(b);
        }
      }
      if ((!s.playlists || !s.playlists.length) && (!s.stations || !s.stations.length)) { const n = document.createElement('p'); n.className = 'note'; n.textContent = s.session === 'signed-out' ? 'Sign in on the PC first.' : 'Its lists are being read. Pull again in a moment.'; body.appendChild(n); }
      d.appendChild(body); box.appendChild(d);
    }
  } catch (e) { say('#merr', e.message); }
}
loadQuick(); setInterval(loadQuick, 15000);
api('/state').then(s => { if (s && s.name) q('#who').textContent = s.name; installPaired = true; }).catch(() => { q('#who').textContent = 'not paired: scan Prism\'s code again'; });
const say = (el, m) => { q(el).textContent = m; if (m) setTimeout(() => { if (q(el).textContent === m) q(el).textContent = ''; }, 4000); };
// the field on the wall, named as the page names it, so the phone says what it is typing into (never what the field holds)
let targetOn = false;
async function pollTarget() {
  try {
    const f = await api('/keyboard/target');
    const el = q('#target'); targetOn = !!(f && f.editable);
    el.classList.toggle('on', targetOn);
    if (targetOn) {
      // the field's role as the wall's browser reads it (its password manager's view): username, password, or the field's kind
      const kind = f.role === 'password' ? 'password' : f.role === 'username' ? 'username' : f.kind === 'email' ? 'email' : f.kind === 'search' ? 'search' : f.kind === 'tel' ? 'phone number' : f.kind === 'number' ? 'number' : 'text';
      el.querySelector('.tl').textContent = (f.label || (kind.charAt(0).toUpperCase() + kind.slice(1) + ' field'));
      el.querySelector('.ts').textContent = (f.page || f.host || 'Prism') + ' \u00b7 ' + kind + (f.length ? ' \u00b7 ' + f.length + ' character' + (f.length === 1 ? '' : 's') + ' there' : ' \u00b7 empty');
      // a password on the wall is typed into a masked box here, so this phone's keyboard neither learns nor suggests it
      document.body.classList.toggle('pw', f.role === 'password');
    } else {
      document.body.classList.remove('pw');
      el.querySelector('.tl').textContent = 'Nothing is focused in Prism';
      el.querySelector('.ts').textContent = (f && f.page ? f.page + ' \u00b7 ' : '') + 'Press into a field there, then type here.';
    }
    q('#send').disabled = q('#sendEnter').disabled = !targetOn;
  } catch (e) { /* the next poll says */ }
}
pollTarget(); setInterval(pollTarget, 1500);
const box = () => document.body.classList.contains('pw') ? q('#p') : q('#t');
async function send(submit) {
  const text = box().value; if (!text) return;
  try { await api('/keyboard/type', { text, submit }); box().value = ''; say('#kerr', submit ? 'Sent, with Enter' : 'Sent'); pollTarget(); } catch (e) { say('#kerr', e.message); }
}
q('#send').onclick = () => send(false); q('#sendEnter').onclick = () => send(true); q('#clear').onclick = () => { box().value = ''; };
q('#peek').onclick = () => { const p = q('#p'); p.type = p.type === 'password' ? 'text' : 'password'; q('#peek').textContent = p.type === 'password' ? 'Show' : 'Hide'; };
for (const b of document.querySelectorAll('.pad button')) b.onclick = async () => { try { await api('/keyboard/key', { key: b.dataset.k }); setTimeout(pollTarget, 300); } catch (e) { say('#kerr', e.message); } };
// ---- listen: a WebSocket of 16-bit PCM frames, played through the Web Audio API a little behind the wall
let ctx = null, ws = null, playAt = 0, gain = null, rate = 48000, channels = 2, dest = null, listening = false, stat = null;
let lvlPeak = 0, lvlFrames = 0, lvlShownAt = 0;
function diag(why) {
  try {
    const out = q('#out');
    const d = { why, mode, isIOS, listening, ctx: ctx ? ctx.state : null, rate: ctx ? ctx.sampleRate : null, ws: ws ? ws.readyState : null, frames: lvlFrames, peak: Math.round(lvlPeak * 1000) / 1000,
      out: { paused: out.paused, muted: out.muted, vol: out.volume, ready: out.readyState, net: out.networkState, src: out.src ? out.src.slice(0, 24) : '', stream: !!out.srcObject, err: out.error ? out.error.code + ' ' + out.error.message : null, t: Math.round(out.currentTime * 10) / 10 },
      gain: gain ? gain.gain.value : null, lead: Math.round(lead * 1000), ua: navigator.userAgent.slice(0, 80) };
    fetch('/remote/diag?token=' + encodeURIComponent(token), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }).catch(() => {});
  } catch {}
}
setInterval(() => { if (listening) diag('tick'); }, 5000);
// an interruption over (a call, Siri, another app's sound): the context resumed as soon as the phone allows
setInterval(() => { if (listening && ctx && ctx.state === 'interrupted') ctx.resume().catch(() => {}); }, 1000);
// a suspended audio context is resumed on the next touch or click anywhere, and the page says so until it runs
let nudges = 0;
async function fallbackToBackground() {
  if (mode === 'background') return;
  mode = 'background'; nudges = 0;
  q('#lvlNote').textContent = 'This phone would not start the low-delay sound, so Prism switched to the background stream (a few seconds behind the picture). Tap Listen again if it stays quiet.';
  await stopListening(''); sayMode();
  q('#listen').click();
}
function nudgeContext() {
  if (!ctx || ctx.state === 'running') return;
  if (ctx.state === 'interrupted') { ctx.resume().catch(() => {}); }
  if (++nudges >= 3 && lvlFrames > 30) { fallbackToBackground(); return; }
  q('#lvlNote').textContent = 'Tap anywhere on this page once to let the phone start the sound.';
  const kick = () => { if (ctx && ctx.state !== 'running') ctx.resume().then(() => { if (q('#lvlNote').textContent.startsWith('Tap anywhere')) q('#lvlNote').textContent = ''; }).catch(() => {}); };
  for (const ev of ['touchend', 'click', 'keydown']) document.addEventListener(ev, kick, { once: true, passive: true });
  setTimeout(() => { if (ctx && ctx.state !== 'running') nudgeContext(); }, 3000);
}
// silence from the PC: the PC's playback device asked every five seconds (2026-10-05, the sign-in session disconnected: no device, nothing to send)
let noDevice = false, deviceAskedAt = 0;
let sessionGone = false, keepConsole = false;
function askDevice() { if (Date.now() - deviceAskedAt < 5000) return; deviceAskedAt = Date.now(); api('/audio/device').then((d) => { noDevice = !!(d && d.ok && d.device === null); sessionGone = !!(d && d.session === 'disconnected'); keepConsole = !!(d && d.keepConsole); }).catch(() => {}); }
// what to say for a PC with no sound device: a session a remote desktop left behind, and the media hub switch (docs/features/media-hub.md)
function noDeviceNote() {
  if (sessionGone) return 'A remote desktop left the PC signed in but off its screen, and Windows takes every audio device away from a session like that, so there is nothing to send. ' + (keepConsole ? 'Prism is putting the session back on the screen now: tap Listen again in a moment.' : 'Sign in at the PC itself, or turn on Remote Desktop Support in the Prism menu on the PC.');
  return 'The PC has no sound device right now, so there is nothing to send. Is its speaker or TV connected and on?';
}
function noteLevel(peak) {
  if (peak > lvlPeak) lvlPeak = peak; lvlFrames++;
  const nowT = Date.now(); if (nowT - lvlShownAt < 1000) return; lvlShownAt = nowT;
  const n = q('#lvlNote'); const out = q('#out');
  if (ctx && ctx.state !== 'running') { n.textContent = 'Sound is arriving from the PC. Tap anywhere on this page once to let the phone play it.'; lvlPeak = 0; return; }
  const phone = out && !out.paused ? '' : ' This phone\'s player is not running: tap Listen again.';
  n.textContent = lvlPeak > 0.003 ? 'Sound is arriving from the PC (level ' + Math.round(lvlPeak * 100) + '%).' + phone + (lvlPeak < 0.03 ? ' It is quiet: turn the PC\'s own player up, its mute and volume do not change what the phone hears.' : '') : (noDevice ? noDeviceNote() :'Connected, but the PC is sending silence. Is anything playing there, and is its player unmuted?');
  if (lvlPeak <= 0.003) askDevice();
  lvlPeak = 0;
}
let lead = 0.09, stalls = 0, cleanSince = 0, stallTimes = [], lastArrive = 0, jitterMax = 0;   // the low-delay lead in seconds: 90 ms, grown 40 ms a stall (each stall is a cut), eased back slowly while the network is clean
function leadCap() { return playerNow === 'video' ? 0.20 : 0.30; }   // on the Video player the sound stays within a fifth of a second of the picture
function noteStall(nowT) {
  stallTimes.push(nowT); while (stallTimes.length && nowT - stallTimes[0] > 30) stallTimes.shift();
  const n = q('#netNote');
  if (stallTimes.length >= 3 && lead >= leadCap() - 0.001) {
    n.textContent = 'The Wi-Fi is uneven right now. Prism is keeping the sound close to the picture, so it may skip for a moment now and then until the network settles.';
    n.className = 'work on';
    clearTimeout(noteStall.t); noteStall.t = setTimeout(() => { n.className = 'work'; }, 25000);
  }
}
// the page's own volume lives under the options, 100% unless moved (2026-10-04); an iPhone ignores it and keeps its own on the buttons
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (isIOS) { q('#volRow').style.display = 'none'; q('#volNote').style.display = 'block'; }
function applyVol() { const v = q('#vol').value / 100; if (gain) gain.gain.value = v; try { q('#out').volume = v; } catch {} }
q('#vol').oninput = applyVol;
// two ways to carry the sound (2026-10-04, "Edge can minimize and keep playing audio/video in iOS"): a live MP3 the phone's own player
// fetches by address, which keeps playing with the page hidden or the screen locked, a few seconds behind the wall; or PCM frames over a
// WebSocket through Web Audio, a tenth of a second behind, which a phone stops when the page is put away. The first is the default
// on an iPhone, the second elsewhere; the options menu swaps them.
let modeChoice = null;   // the person's own choice, kept on the phone; null follows the PC's player
try { modeChoice = localStorage.getItem('prism.listen') || null; } catch {}
function modeFor(player) { return modeChoice || (player === 'video' ? 'low' : (isIOS ? 'background' : 'low')); }
let mode = modeFor(null);
function sayMode() {
  q('#modeBtn').textContent = mode === 'background' ? 'Sound: keeps playing in the background' : 'Sound: low delay';
  q('#modeNote').textContent = (mode === 'background' ? 'Keeps playing when you put the phone away. A few seconds behind the PC; swap to low delay under the options to follow a video.' : 'A tenth of a second behind the PC. Stops when this page is hidden; swap under the options to keep it playing in the background.') + (modeChoice ? '' : ' (chosen for the ' + (playerNow === 'video' ? 'Video' : 'Music') + ' player; the options menu overrides it)');
}
sayMode();
q('#modeBtn').onclick = async () => {
  mode = mode === 'background' ? 'low' : 'background'; modeChoice = mode;
  try { localStorage.setItem('prism.listen', mode); } catch {}
  sayMode();
  if (listening) { await stopListening(''); q('#listen').click(); }
};
// a stream ticket kept ready while the Listen tab is open and nothing plays, so a tap can start the phone's player at once (an
// iPhone only lets a tap start sound, and a wait for the network can outlast the tap)
let ticket = null, ticketAt = 0;
async function readyTicket() {
  if (listening || tabNow !== 'L' || (ticket && Date.now() - ticketAt < 40000)) return;
  try { const t = await api('/audio/stream-ticket', {}); ticket = t.ticket; ticketAt = Date.now(); } catch {}
}
setInterval(readyTicket, 5000);
// Prism on the PC muted while this phone listens (2026-10-05, "pop up a temporary dialog informing that is occurring, with a checkbox that
// turns that off"): the phone's own choice, kept on the phone, on unless unticked; the PC's mute goes back where it was when the listen ends
let muteWhile = true, mutedByMe = false;
try { muteWhile = localStorage.getItem('prism.muteWhileListening') !== 'off'; } catch {}
q('#muteWhile').checked = muteWhile;
q('#muteWhile').onchange = async () => {
  muteWhile = q('#muteWhile').checked;
  try { localStorage.setItem('prism.muteWhileListening', muteWhile ? 'on' : 'off'); } catch {}
  if (!muteWhile && mutedByMe) { mutedByMe = false; try { await api('/audio/private-mute', { on: false }); } catch {} q('#muteNoteText').textContent = 'Prism on the PC plays along with this phone. Turn its volume down there if you want the room quiet.'; }
  else if (muteWhile && listening && !mutedByMe) { try { await api('/audio/private-mute', { on: true }); mutedByMe = true; } catch {} q('#muteNoteText').textContent = 'Prism on the PC is muted while this phone listens. It comes back when you stop.'; }
};
async function muteForListen() {
  const note = q('#muteNote');
  if (!muteWhile) { note.className = 'work muteNote'; return; }
  try {
    await api('/audio/private-mute', { on: true }); mutedByMe = true; q('#muteNoteText').textContent = 'Prism on the PC is muted while this phone listens. It comes back when you stop.';
    note.className = 'work muteNote on';
    clearTimeout(muteForListen.t); muteForListen.t = setTimeout(() => { note.className = 'work muteNote'; }, 20000);
  } catch {}
}
async function unmuteAfterListen() {
  q('#muteNote').className = 'work muteNote';
  if (!mutedByMe) return; mutedByMe = false;
  try { await api('/audio/private-mute', { on: false }); } catch {}
}
// which window this phone hears (2026-10-05, "Remote listening for video should allow the user to select which window they're listening to"):
// with multiview on, a chip a window, big first; the chosen one takes the audio the stream carries (the PC's speakers are muted while a
// phone listens unless the switch below is off). Polled while listening; the PC goes back to the big window when the last phone stops.
let lwinSig = '';
async function pollListenWindows() {
  const box = q('#lwin');
  if (!listening) { box.classList.remove('on'); lwinSig = ''; return; }
  let w = null; try { w = await api('/audio/windows'); } catch { return; }
  if (!w || !w.on || !w.windows || w.windows.length < 2) { box.classList.remove('on'); lwinSig = ''; return; }
  box.classList.add('on');
  const sig = JSON.stringify(w.windows.map((x) => [x.tile, x.label, x.title, x.heard]));
  if (sig === lwinSig) return; lwinSig = sig;
  const row = q('#lwinRow'); row.innerHTML = '';
  for (const x of w.windows) {
    const b = document.createElement('button'); b.className = x.heard ? 'on' : '';
    b.textContent = x.label; const sm = document.createElement('small'); sm.textContent = x.title || x.name || ''; b.appendChild(sm);
    b.onclick = async () => { for (const o of row.children) o.className = ''; b.className = 'on'; q('#lwinNote').textContent = 'Switching to ' + x.label + '\u2026';
      try { const r = await api('/audio/listen-window', { tile: x.index === 0 ? null : x.tile }); q('#lwinNote').textContent = r && r.ok ? 'This phone hears ' + x.label + '.' : 'Could not switch: ' + ((r && r.result) || 'unknown'); } catch (e) { q('#lwinNote').textContent = e.message; }
      lwinSig = ''; setTimeout(pollListenWindows, 800); };
    row.appendChild(b);
  }
}
setInterval(pollListenWindows, 5000);
async function stopListening(sayWhy) {
  const keep = q('#lvlNote').textContent.startsWith('This phone would not start') ? q('#lvlNote').textContent : '';
  listening = false; q('#lvlNote').textContent = keep; lvlPeak = 0; lvlFrames = 0;
  unmuteAfterListen();
  if (stat) { clearInterval(stat); stat = null; }
  if (ws) { try { ws.close(); } catch {} ws = null; }
  try { const out = q('#out'); out.pause(); out.loop = false; out.srcObject = null; out.removeAttribute('src'); out.load(); } catch {}
  if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = 'none'; } catch {} }
  if (ctx) { try { await ctx.close(); } catch {} ctx = null; }
  ticket = null;
  q('#listen').textContent = 'Listen on this phone'; q('#listen').classList.remove('off');
  if (sayWhy) say('#lerr', sayWhy);
}
function mediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: 'Prism', artist: 'the sound on the PC', artwork: [{ src: '/remote/icon.png', sizes: '128x128', type: 'image/png' }] });
  navigator.mediaSession.setActionHandler('pause', () => stopListening(''));
  navigator.mediaSession.setActionHandler('stop', () => stopListening(''));
  try { navigator.mediaSession.playbackState = 'playing'; } catch {}
}
function streamHold(hold) {
  if (!listening || mode !== 'background') return;
  const out = q('#out');
  if (hold) { try { out.pause(); } catch {} return; }
  const tk = ticket && Date.now() - ticketAt < 50000 ? Promise.resolve({ ticket }) : api('/audio/stream-ticket', {});
  tk.then((t) => { ticket = t.ticket; ticketAt = Date.now(); out.src = '/audio/live.mp3?ticket=' + encodeURIComponent(t.ticket); out.load(); return out.play(); }).catch((e) => say('#lerr', 'The sound did not start again: ' + e.message));
}
q('#listen').onclick = async () => {
  if (listening) { await stopListening(''); return; }
  if (mode === 'background') {
    // the phone's own player on the live MP3; started inside the tap when a ticket is ready
    try {
      listening = true;
      const out = q('#out'); out.srcObject = null; out.muted = false; applyVol();
      const start = (tk) => { out.src = '/audio/live.mp3?ticket=' + encodeURIComponent(tk); out.load(); return out.play(); };
      if (ticket && Date.now() - ticketAt < 50000) { start(ticket).catch((e) => stopListening('The phone would not start the sound: ' + e.message)); }
      else { const t = await api('/audio/stream-ticket', {}); await start(t.ticket); }
      mediaSession();
      out.onerror = () => { if (listening) stopListening('The sound stopped: ' + (out.error ? out.error.message || 'the stream ended' : 'the stream ended')); };
      out.onended = () => { if (listening) stopListening('Prism stopped the stream'); };
      q('#listen').textContent = 'Stop listening'; q('#listen').classList.add('off'); say('#lerr', ''); muteForListen();
      let secs = 0, need = 4, started = false;
      try { need = Math.max(1, parseFloat(localStorage.getItem('prism.listen.need')) || 4); } catch {}
      const held = () => { try { const b = out.buffered; return b.length ? Math.max(0, b.end(b.length - 1) - out.currentTime) : 0; } catch { return 0; } };
      stat = setInterval(() => {
        if (!listening) return; secs++;
        const playing = !out.paused && out.readyState >= 3 && out.currentTime > 0;
        if (playing && !started) { started = true; const h = held(); if (h > 0.5) { need = h; try { localStorage.setItem('prism.listen.need', String(Math.round(h * 10) / 10)); } catch {} } }
        const h = held();
        const fill = 'filling the buffer \u00b7 ' + h.toFixed(1) + ' s' + (started ? '' : ' (' + Math.min(99, Math.round(h / need * 100)) + '%)');
        q('#lerr').textContent = (out.paused ? 'paused' : playing ? 'playing \u00b7 ' + h.toFixed(1) + ' s held' : fill) + ' \u00b7 ' + Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
      }, 1000);
    } catch (e) { await stopListening(e.message); }
    return;
  }
  try {
    listening = true;
    // the audio context is made inside the tap, before anything is awaited: a phone (iOS first) only unlocks sound made in a person's
    // gesture, and one made after a network wait stays silent
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    // the sound leaves through a media element, not the audio context alone: a phone keeps a playing media element going when the page
    // is minimized or the screen locks (and shows it among its playing media), while bare Web Audio is paused (2026-10-04, "When I
    // minimize the web app, it also mutes")
    // The same arrangement on an iPhone as everywhere else: this is what played on one at 09:26 on 2026-10-05 ("I am still hearing some of
    // that chop"). The evening's detours (the context's own output, a looped silent file, no element at all) were chasing the shadowed
    // `rate` below, not iOS; with the element gone, Control Center no longer listed Prism at all ("doesn't register on iOS that any sound
    // is playing"). The "interrupted" context seen then is what iOS does to Web Audio when the page is put away in this mode.
    gain = ctx.createGain(); gain.gain.value = q('#vol').value / 100;
    dest = ctx.createMediaStreamDestination(); gain.connect(dest);
    const out = q('#out'); out.volume = 1; out.muted = false; out.loop = false; out.removeAttribute('src'); out.srcObject = dest.stream;
    out.onpause = () => { if (listening) q('#lvlNote').textContent = 'This phone paused its player (an interruption, or the ringer switch). Tap Listen again.'; };
    const unlock = ctx.createBufferSource(); unlock.buffer = ctx.createBuffer(1, 1, 22050); unlock.connect(ctx.destination); unlock.start(0);
    ctx.resume(); out.play().then(() => diag('play ok'), (e) => diag('play failed: ' + e.message));
    mediaSession();
    const t = ticket && Date.now() - ticketAt < 50000 ? { ticket } : await api('/audio/stream-ticket', {});
    // never wait on the context (2026-10-05, "Still no sound in the companion app"): after the network wait the tap is over, and a context a
    // phone leaves suspended makes this await hang forever - no stream was ever opened, while the media element played an empty stream (the
    // phone showed Prism in control, silent). The stream opens regardless; the context is nudged now and on every tap until it runs.
    nudges = 0;
    if (ctx.state !== 'running') { ctx.resume().catch(() => {}); nudgeContext(); }
    playAt = 0;
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/audio/stream?ticket=' + encodeURIComponent(t.ticket));
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') { try { const h = JSON.parse(ev.data); if (h.rate) rate = h.rate; if (h.channels) channels = h.channels; } catch {} return; }
      const pcm = new Int16Array(ev.data); const frames = pcm.length / channels; if (!frames || !ctx) return;
      { let pk = 0; for (let i = 0; i < pcm.length; i += 5) { const a = pcm[i] < 0 ? -pcm[i] : pcm[i]; if (a > pk) pk = a; } noteLevel(pk / 32768); }
      const tArr = performance.now(); if (lastArrive) { const dev = Math.abs(tArr - lastArrive - 20); if (dev > jitterMax) jitterMax = dev; } lastArrive = tArr;
      const buf = ctx.createBuffer(channels, frames, rate);
      for (let c = 0; c < channels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < frames; i++) ch[i] = pcm[i * channels + c] / 32768; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(gain);
      const now = ctx.currentTime;
      // clock drift (2026-10-05, "I am still hearing some of that chop ... pretty steadily"): the PC captures on its clock and this phone plays on
      // its own; the gap between them drains or swells the buffer on a steady beat. The buffer is held at the lead by playing a fraction of a
      // percent faster or slower, which no ear hears, instead of letting it run dry and cut.
      // (named speed, not rate: a `const rate` here shadowed the sample rate read above, so every frame threw before it was scheduled -
      // "Sound is arriving from the PC (level 41%)" and nothing heard, from 09:47 to 20:45 on 2026-10-05, in low-delay mode on every phone)
      const ahead = playAt - now; const err = ahead - lead;
      const speed = Math.min(1.02, Math.max(0.98, 1 + err * 0.25)); src.playbackRate.value = speed;
      if (playAt < now) { stalls++; lead = Math.min(leadCap(), lead + 0.04); cleanSince = now; playAt = now + lead; noteStall(now); }   // a stall: the lead grows a step (to the cap) and the sound starts again
      else if (playAt < now + 0.02) { playAt = now + lead; }
      else if (now - cleanSince > 45 && lead > 0.09) { lead = Math.max(0.09, lead - 0.005); cleanSince = now; }   // forty-five clean seconds: a sliver of the lead given back
      src.start(playAt); playAt += buf.duration / speed;
    };
    ws.onclose = () => stopListening(ws ? 'Prism stopped the stream' : '');
    ws.onerror = () => stopListening('Could not reach the sound on the PC');
    q('#listen').textContent = 'Stop listening'; q('#listen').classList.add('off'); say('#lerr', ''); muteForListen();
    // what the phone is doing with the sound, said on the page: the audio state, frames taken, the lead
    let got = 0; stat = setInterval(() => { if (!ws) { clearInterval(stat); return; } q('#lerr').textContent = (ctx ? ctx.state : 'no audio') + ' \u00b7 ' + got + ' frames' + (ctx && playAt > ctx.currentTime ? ' \u00b7 ' + Math.round((playAt - ctx.currentTime) * 1000) + ' ms behind the PC' : '') + (stalls ? ' \u00b7 ' + stalls + ' stall' + (stalls === 1 ? '' : 's') : '') + (jitterMax ? ' \u00b7 jitter ' + Math.round(jitterMax) + ' ms' : ''); jitterMax = 0; }, 1000);
    const onmsg = ws.onmessage; ws.onmessage = (ev) => { if (typeof ev.data !== 'string') got++; onmsg(ev); };
  } catch (e) { await stopListening(e.message); }
};
</script></body></html>
""";
}
