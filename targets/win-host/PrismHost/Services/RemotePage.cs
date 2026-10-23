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
:root{color-scheme:dark;--ink:#E8ECF2;--dim:#8A93A2;--amber:#F2B14C;--amber-ink:#14171C;--amber-on:#3A2E14;--ground:#14171C;--panel:#1C2129;--chip:#2C3442;--raised:#2A303A;--track:#2A3140;--well:#0E1218;--faint:#4A5262;--danger:#D06A5A}*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font:16px system-ui,-apple-system,Segoe UI,sans-serif;min-height:100vh;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}
header{display:flex;align-items:center;gap:10px;padding:14px 18px 8px}header b{color:var(--amber);font-size:18px}header #who{color:var(--dim);font-size:13px;margin-left:auto}header .pw{font-family:system-ui,-apple-system,Segoe UI,sans-serif}
.more{background:var(--panel);color:var(--ink);border:0;border-radius:10px;padding:4px 10px;font:20px system-ui;line-height:1}
.menu{display:none;flex-direction:column;gap:8px;margin:0 14px 10px;padding:12px;background:var(--panel);border-radius:12px}.menu.on{display:flex}.menu button{background:var(--ground);color:var(--ink);border:0;border-radius:10px;padding:12px;font:inherit;text-align:left}.menu .give{padding:2px 2px 4px}.menu .give a{color:var(--amber);text-decoration:underline}
.menu .how{margin:0;font-size:14px;line-height:1.45;color:var(--ink)}.menu button.danger{color:var(--danger);margin-top:12px}
.players{display:flex;align-items:center;gap:8px;padding:2px 2px 6px;font-size:14px}.players span{flex:1}.menu .players button{padding:10px 14px;border-radius:999px}.menu .players button.on{background:var(--amber);color:var(--amber-ink);font-weight:600}.menu .players button:disabled{opacity:.4}
.banner{display:none;align-items:center;gap:10px;margin:0 14px 10px;padding:10px 12px;background:var(--amber-on);color:var(--amber);border-radius:12px;font-size:14px}.banner.on{display:flex}.banner button{margin-left:auto;background:var(--amber);color:var(--amber-ink);border:0;border-radius:10px;padding:8px 12px;font:600 14px system-ui;white-space:nowrap}
.np{display:flex;gap:12px;align-items:center;background:var(--panel);border-radius:12px;padding:12px}.np img{width:96px;height:96px;border-radius:8px;background:var(--ground);object-fit:cover;flex:none}.np img:not([src]){visibility:hidden}.np.loading img{visibility:visible;background:var(--panel);box-shadow:inset 0 0 0 1px var(--track)}.np.loading img:not([src]){visibility:visible}.np.loading b{color:var(--amber)}.npt{display:flex;flex-direction:column;gap:2px;min-width:0}.npt b{font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.npt span{font-size:14px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#npSvc{color:var(--amber);font-size:13px}
.mseek{margin-top:8px}.mseek .bar{height:3px;background:var(--track);border-radius:2px;overflow:hidden}.mseek .bar i{display:block;height:100%;width:0;background:var(--amber)}.mseek .times{margin-top:4px}
.tr{display:flex;gap:10px;margin-top:12px}.tr button{flex:1;background:var(--panel);color:var(--ink);border:0;border-radius:14px;padding:18px;font:26px system-ui}.tr button.go{background:var(--amber);color:var(--amber-ink)}.tr button:disabled,.row button:disabled{opacity:.4}.row button.on,.vrow button.on{color:var(--amber);font-weight:600}
.qh{margin:20px 0 8px;font:600 16px system-ui;color:var(--ink)}
.restore{display:none;flex-direction:column;gap:6px;background:var(--amber-on);border-radius:12px;padding:12px;margin-bottom:10px}.restore.on{display:flex}.restore b{color:var(--amber);font-size:15px}.restore span{color:var(--ink);font-size:14px;line-height:1.4}.restore .row{margin-top:4px}
.vwins{display:none;margin:10px 0 6px}.vwins.on{display:block}#vwinList{display:grid;grid-template-columns:1fr 1fr;gap:8px}.vwin{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0;padding:8px 10px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(255,255,255,.03);color:inherit;text-align:left}.vwin.big{grid-column:1/-1}.vwin.on{border-color:var(--amber);background:rgba(242,177,76,.12)}.vwin .lab{font-size:12px;color:var(--ink)}.vwin.on .lab{color:var(--amber)}.vwin .what{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:var(--ink)}.vwin .svc2{font-size:12px;color:var(--ink)}.vwin{cursor:pointer}.vwin .clr{margin-top:6px;padding:6px 14px;border:1px solid var(--amber);border-radius:999px;background:transparent;color:var(--amber);font-size:13px}.vwin.add{align-items:center;justify-content:center;border-style:dashed}.vwin.add .what{text-align:center}.lwin{display:none;margin-top:10px}.lwin.on{display:block}#lwinRow{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}#lwinRow>button{min-width:0}#lwinRow>button:first-child{grid-column:1/-1}.lwin .order button{white-space:normal;line-height:1.25}.lwin .order button small{display:block;color:var(--ink);font-weight:400;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.order button{font-size:13px;padding:10px 6px}.order button.on{color:var(--amber);font-weight:600;box-shadow:inset 0 0 0 1px var(--amber)}.order button:disabled{opacity:.4}
.install{display:none;position:fixed;left:12px;right:12px;bottom:calc(14px + env(safe-area-inset-bottom));background:var(--panel);border-radius:16px;padding:14px 14px 12px;box-shadow:0 8px 30px rgba(0,0,0,.5);z-index:45;flex-direction:column;gap:10px}.install.on{display:flex;animation:installIn .25s ease-out}@media (prefers-reduced-motion:reduce){.install.on{animation:none}}@keyframes installIn{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}.install p{margin:0;font-size:15px;color:var(--ink);line-height:1.4}.install ol{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}.install li{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--ink)}.install li .n{flex:none;width:22px;height:22px;border-radius:50%;background:var(--ground);color:var(--amber);font:600 13px system-ui;display:inline-flex;align-items:center;justify-content:center}.install li svg{flex:none;width:20px;height:20px;fill:none;stroke:var(--amber);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.install .row{display:flex;gap:8px;align-items:center}.install .go{flex:1;background:var(--amber);color:var(--amber-ink);border:0;border-radius:12px;padding:12px 14px;font:600 15px system-ui}.install .later{flex:1;background:var(--ground);color:var(--ink);border:0;border-radius:12px;padding:12px 14px;font:15px system-ui}.install .never{background:none;border:0;color:var(--dim);font:13px system-ui;padding:6px 0 0;text-align:left}@media (display-mode:standalone){.install{display:none !important}}
.sheet{display:none;position:fixed;left:12px;right:12px;bottom:calc(14px + env(safe-area-inset-bottom));background:var(--panel);border-radius:16px;padding:14px;box-shadow:0 8px 30px rgba(0,0,0,.5);z-index:50;flex-direction:column;gap:8px}.sheet.on{display:flex}.sheet b{font-size:15px;color:var(--ink);margin-bottom:4px}.sheet button{background:var(--ground);color:var(--ink);border:0;border-radius:12px;padding:14px;font:16px system-ui}.sheet button.go{background:var(--amber);color:var(--amber-ink);font-weight:600}
.sheet .keyNote{font-size:14px;line-height:1.4;color:var(--ink)}.sheet .keyNote.bad{color:var(--amber)}.sheet input{background:var(--ground);color:var(--ink);border:1px solid var(--chip);border-radius:12px;padding:14px 12px;font:18px system-ui;min-width:0}
.openOn{display:flex;align-items:center;gap:8px;margin-top:14px;font-size:14px;color:var(--ink)}.openOn span{flex:1}.openOn button{background:var(--panel);color:var(--ink);border:0;border-radius:999px;padding:10px 14px;font:14px system-ui}.openOn button.on{background:var(--amber);color:var(--amber-ink);font-weight:600}
.trk{display:flex;flex-direction:column;gap:6px;max-height:55vh;overflow:auto}.trk .lbl{font-size:13px;color:var(--ink);margin-top:6px}.trk button.sel{color:var(--amber);font-weight:600}
.muteNote{flex-direction:column;gap:8px}.muteNote.on{display:flex}.chk{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--ink)}.chk input{width:20px;height:20px;accent-color:var(--amber)}
.work .drop{background:var(--ground);color:var(--amber);border:0;border-radius:8px;padding:4px 10px;font:13px system-ui;margin-left:6px}
.work{display:none;margin:10px 0 0;padding:10px 12px;background:var(--panel);border-radius:12px;color:var(--amber);font-size:14px}.work.on{display:block}.work.done{color:var(--ink)}.work i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--amber);margin-right:8px;animation:pulse 1s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}
.vnp img{width:72px;height:108px}.seek{margin-top:12px}.seek input{width:100%}.times{display:flex;justify-content:space-between;font-size:13px;color:var(--ink);margin-top:2px}
.ic{width:26px;height:26px;fill:currentColor;display:block}.mtr{gap:8px;align-items:center}.mtr button{flex:1;height:58px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:16px}.mtr button.go{flex:1.35;height:68px}.mtr button.go .ic{width:32px;height:32px}.mtr button:disabled{opacity:.35}#orderRow button{min-width:0;flex:1}#orderRow button.on{color:var(--amber)}#orderRow button.on .ic{fill:var(--amber)}.vtr{gap:8px;align-items:center}.vtr button{flex:1;height:58px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:16px}.vtr button.go{flex:1.35;height:68px}.vtr button.go .ic{width:32px;height:32px}.vtr button:disabled{opacity:.35}.vrow button{display:flex;flex-direction:column;align-items:center;gap:5px;font:13px system-ui;padding:10px 6px}.vrow .ic{width:22px;height:22px}.sbox .glass{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:20px;height:20px;fill:var(--dim);pointer-events:none}.search .sbox input{padding-left:40px;-webkit-appearance:none;appearance:none}.sbox input::-webkit-search-decoration,.sbox input::-webkit-search-cancel-button,.sbox input::-webkit-search-results-button{-webkit-appearance:none;display:none}#vLivePanel > .body{padding:8px}.lq{width:100%;box-sizing:border-box;background:var(--ground);color:var(--ink);border:1px solid var(--chip);border-radius:10px;padding:10px 12px;font:15px system-ui;margin-bottom:8px}#vLive .item.hidden{display:none}#vLive .grp{margin:10px 6px 2px;font-size:11px;letter-spacing:.08em;color:var(--ink);text-transform:uppercase}#vLive .grp.hidden{display:none}#vLive .item.ch{padding:9px 10px;margin-top:4px}#vLive .ch .l1{display:flex;gap:10px;align-items:baseline}#vLive .ch .l1 span:first-child{flex:none;max-width:46%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#vLive .ch .l1 .now{flex:1;display:block;margin:0;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink);font-size:13px}#vLive .ch .pb{margin-top:6px}#vLive .ch .pt{display:none}#vLive .jump{position:sticky;top:0;z-index:2;display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:8px 0;background:var(--panel)}#vLive .jump::-webkit-scrollbar{display:none}#vLive .jump button{flex:none;background:var(--chip);color:var(--ink);border:0;border-radius:999px;padding:6px 11px;font:12px system-ui}#vLive .jump.hidden{display:none}.openOn{margin:4px 0 10px}.vrow{margin-top:10px}.vrow button{flex:1;background:var(--panel);color:var(--ink);border:0;border-radius:12px;padding:12px 8px;font:14px system-ui}.vrow button.on{color:var(--amber)}
.cards{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;scrollbar-width:none;-webkit-overflow-scrolling:touch}.cards::-webkit-scrollbar{display:none}.card{flex:none;width:112px;background:none;border:0;padding:0;color:var(--ink);text-align:left;font:13px system-ui}.card{position:relative;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}.card .art{width:112px;height:168px;border-radius:10px;background:var(--panel);object-fit:cover;display:block}.card .di{position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:13px;border:0;background:rgba(5,6,9,.75);color:var(--ink);font:600 13px system-ui;padding:0}.card .mk{position:absolute;top:6px;left:6px;min-width:26px;height:26px;padding:0 4px;border-radius:7px;background:rgba(5,6,9,.78);color:var(--ink);font:700 11px system-ui;display:flex;align-items:center;justify-content:center;overflow:hidden;box-sizing:border-box}.card .mk img{width:26px;height:26px;object-fit:cover;display:block;margin:0 -4px}.sheet.full>*{flex-shrink:0}.sheet.full{top:0;left:0;right:0;bottom:0;border-radius:0;padding:0 14px calc(20px + env(safe-area-inset-bottom));max-height:none;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;z-index:60}.sheet.full .top{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 0 10px;background:var(--panel);z-index:1}.sheet.full .top b{flex:1;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sheet.full .top button{background:var(--chip);color:var(--ink);border:0;border-radius:999px;padding:9px 14px;font:600 14px system-ui}body.locked{overflow:hidden;position:fixed;left:0;right:0;width:100%}#srSheet{flex-direction:column;gap:0}#wsSheet{flex-direction:column;gap:4px}#wsNote:empty{display:none}#wsBody p.ver{margin:2px 0;padding:0;background:none;font:600 16px system-ui;color:var(--ink)}#wsBody .chlog{margin-top:8px;max-height:60vh;overflow-y:auto;-webkit-overflow-scrolling:touch;border-left:3px solid var(--amber);padding-left:12px}#wsBody .chlog .rel{padding:8px 0;border-bottom:1px solid var(--track)}#wsBody .chlog .rel b{display:block;font-size:14px;color:var(--ink)}#wsBody .chlog .rel b.new{color:var(--amber)}#wsBody .chlog .rel p{margin:4px 0 0;font-size:13px;line-height:1.4;color:var(--ink);white-space:pre-wrap}#wsBody .wsLink{display:block;margin-top:8px;padding:12px;border-radius:12px;background:var(--amber);color:var(--amber-ink);font:600 15px system-ui;text-align:center;text-decoration:none}#wsBody h4{margin:16px 0 6px;font-size:12px;letter-spacing:.08em;color:var(--amber);text-transform:uppercase}#wsBody .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}#wsBody .chips button{background:var(--chip);color:var(--ink);border:1px solid transparent;border-radius:999px;padding:8px 12px;font:13px system-ui;text-align:left}#wsBody .chips button.on{color:var(--amber);border-color:var(--amber)}#wsBody .fld{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:14px;color:var(--ink)}#wsBody .fld span{flex:1}#wsBody .fld input{width:110px;padding:8px 10px;font:16px system-ui}#wsBody .act{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap}#wsBody .act button{flex:1;padding:12px;font:15px system-ui;border-radius:12px;border:0;background:var(--chip);color:var(--ink)}#wsBody .act button.go{background:var(--amber);color:var(--amber-ink);font-weight:600}#wsBody .cat{background:var(--ground);border-radius:12px;padding:10px;margin-top:8px}#wsBody .cat input{width:100%;margin-top:6px;padding:10px 12px;font:15px system-ui;background:var(--panel)}#wsBody .hid{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--track);font-size:14px;color:var(--ink)}#wsBody .hid span{flex:1;line-height:1.35}#wsBody .hid b{color:var(--ink)}#wsBody .hid button{padding:8px 10px;font:13px system-ui;border-radius:10px;background:var(--chip);color:var(--ink);border:0}#wsBody p.sub{margin:2px 0 0;font-size:12px;color:var(--dim)}#wsBody .jump{position:sticky;top:calc(50px + env(safe-area-inset-top));z-index:2;display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:8px 0;background:var(--panel)}#wsBody .jump::-webkit-scrollbar{display:none}#wsBody .jump button{flex:none;background:var(--chip);color:var(--ink);border:0;border-radius:999px;padding:7px 12px;font:13px system-ui}#wsBody .wsSec{margin-top:8px;background:var(--ground)}#wsBody .wsSec>button.head{padding:14px 12px}#wsBody .wsSec>.body{padding:0 12px 12px}#wsBody .wsSec h4:first-child{margin-top:4px}#wsBody .wsSec .cat{background:var(--panel)}#wsBody .wsSec .cat input{background:var(--ground)}#srq{flex:1;padding:10px 12px;font:16px system-ui;-webkit-appearance:none;appearance:none}#srq::-webkit-search-decoration,#srq::-webkit-search-cancel-button,#srq::-webkit-search-results-button{-webkit-appearance:none;display:none}#detSheet{flex-direction:column;gap:8px}#detSheet .dh{display:flex;gap:12px}#detSheet .dh img{width:84px;height:126px;border-radius:8px;object-fit:cover;background:var(--well);flex:none}#detSheet .dh b{font-size:17px}#detSheet .dh span{display:block;color:var(--ink);font-size:13px;margin-top:3px}#detSheet .dv{color:var(--ink);font-size:14px;line-height:1.35}#detSheet .dcast{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none}#detSheet .dcast button{flex:none;width:64px;font-size:11px;color:var(--ink);text-align:center;background:none;border:0;padding:0;font-family:system-ui}#detSheet .dcast button span{display:block}#chSheet{max-height:85vh;overflow-y:auto;flex-direction:column;gap:8px}#chSheet .dh{display:flex;gap:12px}#chSheet .dh img{width:72px;height:72px;border-radius:36px;object-fit:cover;background:var(--well);flex:none}#chSheet .dh b{font-size:17px}#chSheet .dh span{display:block;color:var(--ink);font-size:13px;margin-top:3px}#chSheet .dv{color:var(--ink);font-size:13px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden}#chSheet .cards{flex-wrap:wrap;overflow:visible}#detSheet .dtags{display:flex;flex-wrap:wrap;gap:6px}#detSheet .dtags:empty{display:none}#detSheet .dtags button{background:var(--chip);color:var(--ink);border:0;border-radius:999px;padding:7px 11px;font:13px system-ui}#detSheet .dchan{display:flex;flex-direction:column;gap:8px;background:var(--ground);border-radius:12px;padding:10px}#detSheet .dchan:empty{display:none}#detSheet .dchan .ch1{display:flex;align-items:center;gap:10px}#detSheet .dchan .ch1 img{width:44px;height:44px;border-radius:22px;object-fit:cover;background:var(--well);flex:none}#detSheet .dchan .ch1 b{display:block;font-size:15px}#detSheet .dchan .ch1 span{display:block;color:var(--ink);font-size:12px}#detSheet .dchan .chd{color:var(--ink);font-size:13px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}#detSheet .dchan .chl{font-size:12px;letter-spacing:.08em;color:var(--ink);text-transform:uppercase;margin-top:2px}#detSheet .dchan .cards{margin:0}#detSheet .dchan .chb{display:flex;gap:8px}#detSheet .dchan .chb button{background:var(--chip);color:var(--ink);border:0;border-radius:10px;padding:8px 10px;font:13px system-ui}#perSheet{max-height:85vh;overflow-y:auto;flex-direction:column;gap:8px}#perSheet .dh{display:flex;gap:12px}#perSheet .dh img{width:84px;height:84px;border-radius:42px;object-fit:cover;background:var(--well);flex:none}#perSheet .dh b{font-size:17px}#perSheet .dh span{display:block;color:var(--ink);font-size:13px;margin-top:3px}#perSheet .dv{color:var(--ink);font-size:13px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}#perSheet .cards{flex-wrap:wrap;overflow:visible}#perSheet .psort{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink)}#perSheet .psort button{background:var(--chip);color:var(--ink);border:1px solid transparent;border-radius:999px;padding:7px 12px;font:13px system-ui}#perSheet .psort button.on{color:var(--amber);border-color:var(--amber)}#perSheet .card.here .art,#detSheet .dcast button.here img{outline:2px solid var(--amber);outline-offset:2px}#detSheet .dcast button.here span{color:var(--amber)}#vSvcBody .srow{display:flex;align-items:center;gap:10px;padding:6px 0}#vSvcBody .srow b{flex:1;font-weight:500}#vSvcBody .srow span{color:var(--ink);font-size:12px}#vSvcBody .srow span.amber{color:var(--amber)}#vSvcBody .srow button{background:var(--chip);color:var(--ink);border:0;border-radius:10px;padding:8px 10px;font:13px system-ui}#detSheet .dcast img{width:56px;height:56px;border-radius:28px;object-fit:cover;background:var(--well)}#detSheet .dwhere{font-size:13px;color:var(--ink)}#detSheet .dwhere b{color:var(--amber)}.card .art.wide{height:63px}.card .art.wide ~ .ago{top:37px}.card .art.wide ~ .sc{top:37px}.zoom{display:none;position:fixed;inset:0;z-index:80;background:rgba(5,6,9,.94);align-items:center;justify-content:center;flex-direction:column;gap:10px;padding:16px;box-sizing:border-box}.zoom.on{display:flex}.zoom img{max-width:100%;max-height:calc(100% - 40px);object-fit:contain;border-radius:10px}.zoom span{color:var(--ink);font:13px system-ui}#detArt{cursor:zoom-in}.card .nm{position:absolute;left:0;top:84px;width:112px;box-sizing:border-box;padding:16px 6px 6px;border-radius:0 0 10px 10px;background:linear-gradient(rgba(5,6,9,0),rgba(5,6,9,.88) 40%);color:var(--ink);font:600 12px/1.25 system-ui;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;height:56px}.card .ago{position:absolute;left:6px;top:142px;padding:3px 7px;border-radius:7px;background:rgba(5,6,9,.78);color:var(--ink);font:600 11px system-ui;white-space:nowrap}.card .sc{position:absolute;right:6px;top:142px;padding:3px 7px;border-radius:7px;background:rgba(5,6,9,.78);color:var(--ink);font:600 11px system-ui;white-space:nowrap}.card .sc.mine{color:var(--amber)}.card .bar{height:3px;background:var(--track);border-radius:2px;margin-top:4px;overflow:hidden}.card .bar i{display:block;height:100%;background:var(--amber)}.card b{display:block;margin-top:5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.card span{display:block;color:var(--ink);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.card .svc2{color:var(--amber)}
.cards .note{margin:0}.qh .info{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:1px solid var(--dim);color:var(--ink);background:none;font:italic 600 12px Georgia,serif;margin-left:8px;vertical-align:middle;padding:0;text-transform:none;letter-spacing:0}.gpick{display:block;width:100%;margin:2px 0 8px;padding:10px 12px;font:16px system-ui;background:var(--panel);color:var(--ink);border:1px solid var(--chip);border-radius:10px}.catRow select{flex:2;min-width:0;padding:10px 12px;font:16px system-ui;background:var(--panel);color:var(--ink);border:1px solid var(--chip);border-radius:10px}.cat.here{outline:2px solid var(--amber);outline-offset:4px;border-radius:8px}.qh .info.pen{font:15px system-ui;font-style:normal;border-color:var(--amber)}.qh .info.on{border-color:var(--amber);color:var(--amber)}.about{display:none;margin:0 0 8px;font-size:13px;line-height:1.45;color:var(--ink);background:var(--panel);border-radius:10px;padding:10px 12px}.about b{display:block;color:var(--amber);font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin:8px 0 2px}.about b:first-child{margin-top:0}.about.on{display:block}.search{display:flex;gap:8px;margin-top:14px}.search .sbox{flex:1;position:relative;display:flex;min-width:0}.search input{flex:1;background:var(--panel);color:var(--ink);border:0;border-radius:12px;padding:12px 40px 12px 14px;font:16px system-ui;min-width:0}.search input::-webkit-search-cancel-button{display:none}.search .clr{position:absolute;right:4px;top:50%;transform:translateY(-50%);background:transparent;color:var(--ink);border:0;padding:6px 10px;font:22px system-ui;display:none}.search .sbox.has .clr{display:block}.search button{background:var(--amber);color:var(--amber-ink);border:0;border-radius:12px;padding:12px 16px;font:600 15px system-ui}
.hit{display:flex;gap:10px;background:var(--panel);border-radius:12px;padding:10px;margin-top:8px}.hit img{width:56px;height:84px;border-radius:6px;object-fit:cover;background:var(--ground);flex:none}.hit img:not([src]){visibility:hidden}.hit .t{flex:1;min-width:0}.hit b{display:block;font-size:15px}.hit span{display:block;font-size:13px;color:var(--ink)}.hit .on{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.hit .on button{background:var(--ground);color:var(--amber);border:0;border-radius:999px;padding:7px 12px;font:13px system-ui}.hit span.amber{color:var(--amber)}
.shead{font-size:12px;letter-spacing:.08em;color:var(--ink);text-transform:uppercase;margin:12px 6px 2px}.topr{background:var(--panel);border-radius:12px;overflow:hidden;margin-top:8px}.topr img{width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;display:block;background:var(--ground)}.topr img.poster{object-fit:contain;max-height:240px}.topr .tb{padding:10px 12px 12px}.topr small{color:var(--amber);font-size:11px;letter-spacing:.08em;text-transform:uppercase}.topr b{display:block;font-size:18px;margin-top:2px}.topr .f{color:var(--ink);font-size:13px;margin-top:3px}.topr .o{color:var(--ink);font-size:13px;line-height:1.35;margin-top:6px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.topr .on{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.topr .on button{background:var(--ground);color:var(--amber);border:0;border-radius:999px;padding:8px 12px;font:13px system-ui}.topr .on button.d{color:var(--ink)}
.people{display:flex;gap:12px;overflow-x:auto;scrollbar-width:none;padding:4px 0}.people::-webkit-scrollbar{display:none}.people button{flex:none;width:84px;background:none;border:0;color:var(--ink);font:12px system-ui;text-align:center;padding:0}.people img,.people .mono{width:64px;height:64px;border-radius:32px;object-fit:cover;background:var(--panel);display:block;margin:0 auto 4px}.people .mono{line-height:64px;font-size:20px;color:var(--dim)}.people span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fchips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin-top:8px}.fchips::-webkit-scrollbar{display:none}.fchips button{flex:none;background:var(--chip);color:var(--ink);border:1px solid transparent;border-radius:999px;padding:6px 11px;font:12px system-ui}.fchips button.on{color:var(--amber);border-color:var(--amber)}
#detActs,#ctxTop,#ctxActs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}#detActs.fold{display:none;margin-top:0}#detActs.fold.on{display:grid}#detActs [data-rm]{grid-column:1/-1}#detSheet .dbar{display:flex;gap:8px}#detSheet .dbar button{flex:1;min-height:46px;padding:10px 12px;border-radius:10px;border:0;font:600 15px system-ui;background:var(--raised);color:var(--ink)}#detSheet .dbar button.go{background:var(--amber);color:var(--amber-ink)}#detNote:empty{display:none}#ctxActs:empty{display:none}#ctxTop button{min-height:56px;padding:12px;border-radius:12px;background:var(--raised);color:var(--ink);border:0;font-size:16px;text-align:center}.ctxHead{display:flex;gap:12px;align-items:flex-start;margin-top:6px}#ctxSheet .dh img{width:84px;height:126px;border-radius:8px;object-fit:cover;background:var(--well);flex:none}.ctxHead b{display:block;font-size:18px;color:var(--ink)}.ctxHead span{display:block;margin-top:4px;font-size:14px;color:var(--ink)}#ctxActs button{min-height:56px;font-size:16px}#ctxTop button.go{background:var(--amber);color:var(--amber-ink);font-weight:600}#ctxTop [data-rm]{grid-column:1/-1}#ctxTop button:disabled{opacity:.6}#ctxRate{margin-top:12px}#ctxRate .rh{font-size:13px;color:var(--ink);margin-bottom:6px}#ctxRate .stars{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}#ctxRate .stars button{min-height:44px;background:var(--chip);border:0;border-radius:10px;padding:0;font:600 17px system-ui;color:var(--ink)}#ctxRate .stars button.on{background:var(--amber);color:var(--amber-ink)}#ctxRate .stars button:disabled{opacity:.45}#ctxNote:empty{display:none}#ctxActs button.go,#ctxActs .plpick,#ctxActs [data-rm]{grid-column:1/-1}#ctxActs button.go{background:var(--amber);color:var(--amber-ink);font-weight:600}#detActs button,#ctxActs button{min-height:48px;padding:10px 12px;border-radius:10px;background:var(--raised);color:var(--ink);border:0;font-size:15px;text-align:center}#detActs button:disabled,#ctxActs button:disabled{opacity:.6}#detActs .plpick{display:flex;flex-wrap:wrap;gap:6px;width:100%}#detActs .plpick button{background:var(--chip)}#vPlaylists{margin-top:12px}#vPlBody .item.now{color:var(--amber)}#vPlBody .item.done{opacity:.55}.plbar{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px}.plbar button{background:var(--track);color:var(--ink);border:0;border-radius:10px;padding:8px 12px;font:14px system-ui}.plbar button.go{background:var(--amber);color:var(--amber-ink)}.plhead{display:flex;align-items:center;gap:10px;margin-top:8px}.plhead b{font-size:16px;color:var(--ink)}#vEpisodes{margin-top:12px}#vEpBody .ssn{font-size:12px;letter-spacing:.08em;color:var(--ink);text-transform:uppercase;margin:8px 6px 4px}#vEpBody .item.now{color:var(--amber)}.lens .qh small{display:block;font-size:11px;letter-spacing:0;text-transform:none;color:var(--dim);margin-top:2px}.svc .item .now{display:block;color:var(--ink);font-size:13px;margin-top:2px}
.quick{display:flex;flex-direction:column;gap:8px}.svc{background:var(--panel);border-radius:12px;overflow:hidden}.svc>button.head{width:100%;display:flex;align-items:center;gap:10px;background:none;color:var(--ink);border:0;padding:14px 12px;font:600 16px system-ui;text-align:left}.svc>button.head .st{margin-left:auto;font-size:13px;font-weight:400;color:var(--amber)}.svc>button.head .chev{font-size:13px;color:var(--dim)}.svc.open>button.head .chev{transform:rotate(90deg)}
.svc > .body{display:none;padding:0 8px 10px}.svc.open > .body{display:block}.svc .grp{font-size:12px;letter-spacing:.08em;color:var(--ink);text-transform:uppercase;margin:8px 6px 4px}.svc .item{display:block;width:100%;background:var(--ground);color:var(--ink);border:0;border-radius:10px;padding:12px;font:15px system-ui;text-align:left;margin-top:6px}.svc .item .pb{display:block;height:4px;background:var(--track);border-radius:2px;margin-top:7px;overflow:hidden}.svc .item .pb i{display:block;height:100%;background:var(--amber)}.svc .item .pb i.unk{background:var(--dim);width:100%;opacity:.35}.svc .item .pt{display:block;color:var(--ink);font-size:12px;margin-top:4px}.svc .item.go{color:var(--amber)}
nav{display:flex;gap:6px;padding:0 14px 10px}nav button{flex:1;background:var(--panel);color:var(--ink);border:0;border-radius:12px;padding:10px;font:inherit}nav button.on{background:var(--amber-on);color:var(--amber)}
main{padding:0 14px 20px}section{display:none}section.on{display:block}
textarea{width:100%;min-height:96px;background:var(--panel);color:var(--ink);border:1px solid var(--chip);border-radius:12px;padding:12px;font:18px system-ui;resize:vertical}
/* the password row is .pwr: .pw is the wordmark's own class, and its styles made this row show all the time (found 2026-10-10) */
.pwr{display:none;gap:8px}.pwr input{flex:1;background:var(--panel);color:var(--ink);border:1px solid var(--chip);border-radius:12px;padding:14px 12px;font:18px system-ui;min-width:0}.pwr button{background:var(--panel);color:var(--ink);border:0;border-radius:12px;padding:0 14px;font:inherit}
.unr{display:none}.unr input{width:100%;background:var(--panel);color:var(--ink);border:1px solid var(--chip);border-radius:12px;padding:14px 12px;font:18px system-ui;min-width:0}#pmNote{display:none}body.pw #pmNote,body.un #pmNote{display:block}body.un textarea{display:none}body.un .unr{display:block}body.pw textarea{display:none}body.pw .pwr{display:flex}
.row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}.row button{flex:1;min-width:92px;background:var(--panel);color:var(--ink);border:0;border-radius:12px;padding:14px 10px;font:inherit}
.row button.go{background:var(--amber);color:var(--amber-ink);font-weight:600}.row button:active{filter:brightness(1.3)}.row button:disabled{opacity:.45}
.pad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}.pad button{background:var(--panel);color:var(--ink);border:0;border-radius:12px;padding:16px;font:20px system-ui}.pad .e{grid-column:2}.pad .e+button{grid-column:1}
.big{width:100%;background:var(--amber);color:var(--amber-ink);border:0;border-radius:14px;padding:18px;font:600 18px system-ui;margin-top:12px}.big.off{background:var(--panel);color:var(--ink)}
p.note{color:var(--ink);font-size:14px;line-height:1.4}
.verr{display:none;margin-top:10px;padding:12px;border-radius:12px;background:var(--panel);color:var(--amber);font-size:15px;line-height:1.4;flex-direction:column;gap:10px}.verr.on{display:flex}.verr button{align-self:flex-start;background:var(--amber);color:var(--amber-ink);border:0;border-radius:12px;padding:12px 18px;font:600 15px system-ui}
.target{display:flex;flex-direction:column;gap:3px;background:var(--panel);border-left:4px solid var(--dim);border-radius:10px;padding:10px 12px;margin-bottom:10px}.target.on{border-left-color:var(--amber)}
.target .tl{font-size:16px;font-weight:600;color:var(--ink)}.target.on .tl{color:var(--amber)}.target .ts{font-size:13px;color:var(--ink)}p.err{color:var(--amber);font-size:14px;min-height:1.4em}
label.vol{display:block;font-size:14px;padding:4px 2px}input[type=range]{width:100%;margin-top:6px}
#vIdle{display:none;margin:4px 0 2px;font-size:15px}body.idle #vIdle{display:block}body.idle #vnp,body.idle #vSeekRow,body.idle .vtr,body.idle .vrow{display:none}.hint{margin:0;font-size:13px;color:var(--ink);opacity:.75}
.moreRows{display:block;margin:16px 0 4px;background:var(--panel);color:var(--ink);border:0;border-radius:12px;padding:12px 18px;font:16px system-ui}
.simple #vCont .card{width:150px}.simple #vCont .card .art,.simple #vCont .card .pend{width:150px;height:225px}.simple #vCont .card .nm{width:150px;top:169px}.simple #vCont .card .ago,.simple #vCont .card .sc{top:199px}.card .pend{position:absolute;left:0;top:0;width:112px;height:168px;border-radius:10px;background:rgba(5,6,9,.74);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px;box-sizing:border-box;color:var(--ink);font:600 12px/1.25 system-ui;text-align:center;white-space:normal}.card .pend svg{width:30px;height:30px;fill:var(--amber)}
</style></head><body>
<header>__WORDMARK__<span id="who">on this PC</span><button id="more" class="more" aria-label="Options">&#8943;</button></header>
<div id="menu" class="menu"><div class="players"><span>Prism on PC</span><button id="plMusic">Music lounge</button><button id="plVideo">Video</button></div><button id="addHome">Add to home screen</button><button id="bwBtn">Cover YouTube TV breaks: on</button><button id="wsBtn">Watch settings</button><button id="modeBtn"></button><label class="vol" id="volRow">Page volume<input id="vol" type="range" min="0" max="100" value="100"></label><p class="note" id="volNote" style="display:none">This phone keeps its volume on its own buttons; a page cannot set it.</p><p class="note give">Prism is free. If you'd like to support Entangled, you can on our site. It's entirely up to you. <a href="https://entangled.world/support" target="_blank" rel="noopener noreferrer">entangled.world/support</a> opens in your phone's browser.</p><button id="closeMenu">Close</button><button id="forget" class="danger">Forget this PC</button><p id="howHome" class="how"></p></div>
<div id="banner" class="banner"><span id="bannerText">Prism on the PC was updated. This page refreshes in 5:00.</span><button id="refreshNow">Refresh now</button></div>
<svg style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs><symbol id="i-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></symbol><symbol id="i-pause" viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></symbol><symbol id="i-start" viewBox="0 0 24 24"><path d="M5 6h2v12H5zm3 6l11-6v12z"/></symbol><symbol id="i-next" viewBox="0 0 24 24"><path d="M17 6h2v12h-2zM5 6l11 6-11 6z"/></symbol><symbol id="i-back10" viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6H4c0 4.4 3.6 8 8 8s8-3.6 8-8-3.6-8-8-8z"/><text x="12" y="15.6" text-anchor="middle" font-size="7" font-weight="700" font-family="system-ui,sans-serif">10</text></symbol><symbol id="i-fwd10" viewBox="0 0 24 24"><path d="M12 5V1l5 5-5 5V7c-3.3 0-6 2.7-6 6s2.7 6 6 6 6-2.7 6-6h2c0 4.4-3.6 8-8 8s-8-3.6-8-8 3.6-8 8-8z"/><text x="12" y="15.6" text-anchor="middle" font-size="7" font-weight="700" font-family="system-ui,sans-serif">10</text></symbol><symbol id="i-skip" viewBox="0 0 24 24"><path d="M4 6l8 6-8 6zm8 0l8 6-8 6z"/></symbol><symbol id="i-cc" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M3 5h18v14H3V5zm2 2v10h14V7H5zm3 2.5h3V11H9v2h2v1.5H8v-5zm6 0h3V11h-2v2h2v1.5h-3v-5z"/></symbol><symbol id="i-mute" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></symbol><symbol id="i-unmute" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zm11 .3l1.4-1.4 2.4 2.4 2.4-2.4 1.4 1.4-2.4 2.4 2.4 2.4-1.4 1.4-2.4-2.4-2.4 2.4-1.4-1.4 2.4-2.4z"/></symbol><symbol id="i-search" viewBox="0 0 24 24"><path d="M10 2a8 8 0 1 0 4.9 14.3l5.4 5.4 1.4-1.4-5.4-5.4A8 8 0 0 0 10 2zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12z"/></symbol><symbol id="i-up" viewBox="0 0 24 24"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></symbol><symbol id="i-down" viewBox="0 0 24 24"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></symbol><symbol id="i-repeat" viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></symbol><symbol id="i-shuffle" viewBox="0 0 24 24"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></symbol><symbol id="i-order" viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></symbol><symbol id="i-reverse" viewBox="0 0 24 24"><path d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3L5 6.99h3V14h2V6.99h3L9 3z"/></symbol></defs></svg>
<nav><button id="tabM" class="on">Music</button><button id="tabV" style="display:none">Video</button><button id="tabK">Keyboard</button><button id="tabL">Private Listening</button></nav>
<main>
<section id="M" class="on">
<div class="restore" id="restoreCard"><b>Restore the previous session?</b><span id="restoreWhat"></span><div class="row"><button id="restoreGo" class="go">Restore</button><button id="restoreNo">Not now</button></div></div>
<div class="np" id="np"><img id="npArt" alt=""><div class="npt"><b id="npTitle">Nothing playing</b><span id="npArtist"></span><span id="npSvc"></span></div></div>
<div class="seek mseek" id="npTimeRow" style="display:none"><div class="bar"><i id="npBar"></i></div><div class="times"><span id="npTime"></span><span id="npLeft"></span></div></div>
<div class="tr mtr"><button data-c="prev" id="trPrev" aria-label="Previous track"><svg class="ic"><use href="#i-start"/></svg></button><button data-c="play" id="trPlay" class="go" aria-label="Play or pause"><svg class="ic"><use href="#i-play"/></svg></button><button data-c="next" id="trNext" aria-label="Next track"><svg class="ic"><use href="#i-next"/></svg></button></div>
<div class="row vrow"><button data-c="thumbup" id="trUp"><svg class="ic"><use href="#i-up"/></svg><span>Like</span></button><button data-c="thumbdown" id="trDown"><svg class="ic"><use href="#i-down"/></svg><span>Dislike</span></button><button data-c="mute" id="trMute"><svg class="ic"><use href="#i-mute"/></svg><span>Mute the PC</span></button></div>
<div class="row vrow order" id="orderRow"><button data-o="normal"><svg class="ic"><use href="#i-order"/></svg><span>In order</span></button><button data-o="true-shuffle"><svg class="ic"><use href="#i-shuffle"/></svg><span>True shuffle</span></button><button data-o="reverse"><svg class="ic"><use href="#i-reverse"/></svg><span>Reverse</span></button><button id="repeatBtn"><svg class="ic"><use href="#i-repeat"/></svg><span>Repeat</span></button></div>
<p class="work" id="mwork"></p><p class="work" id="nextLine"></p>
<div id="pickSheet" class="sheet"><b id="pickWhat"></b><button id="pickNow" class="go">Play now</button><button id="pickNext">Play after this track</button><button id="pickCancel">Cancel</button></div>
<h3 class="qh">Quick play</h3>
<div id="quick" class="quick"><p class="note">Reading your services' lists&hellip;</p></div>
<p class="err" id="merr"></p>
</section>
<section id="V">
<div class="np vnp" id="vnp"><img id="vArt" alt=""><div class="npt"><b id="vTitle">Nothing playing</b><span id="vSub"></span><span id="vSvc"></span></div></div>
<p id="vIdle" class="note">Nothing playing on Prism. Pick something below.</p>
<div id="vwins" class="vwins"><h3 class="qh">Play into</h3><div id="vwinList"></div><p class="note" id="vwinNote"></p></div>
<div id="vErr" class="verr"><span id="vErrText"></span><button id="vRetry">Retry</button></div>
<div class="seek" id="vSeekRow"><input id="vSeek" type="range" min="0" max="1000" value="0"><div class="times"><span id="vPos">0:00</span><span id="vDur"></span></div></div>
<div class="tr vtr"><button data-v="restart" title="Start over (the previous episode in the first 5 seconds)" aria-label="Start over"><svg class="ic"><use href="#i-start"/></svg></button><button data-v="seekbackward" title="Back 10 seconds" aria-label="Back 10 seconds"><svg class="ic"><use href="#i-back10"/></svg></button><button data-v="play" id="vPlay" class="go" aria-label="Play or pause"><svg class="ic"><use href="#i-play"/></svg></button><button data-v="seekforward" title="Forward 10 seconds" aria-label="Forward 10 seconds"><svg class="ic"><use href="#i-fwd10"/></svg></button><button data-v="nextepisode" title="Next episode" aria-label="Next episode"><svg class="ic"><use href="#i-next"/></svg></button></div>
<div class="row vrow"><button data-v="skipintro" id="vSkip"><svg class="ic"><use href="#i-skip"/></svg><span>Skip intro</span></button><button data-v="captions"><svg class="ic"><use href="#i-cc"/></svg><span>Captions</span></button><button data-v="mute" id="vMute"><svg class="ic"><use href="#i-mute"/></svg><span>Mute the PC</span></button></div>
<div class="svc" id="vEpisodes" style="display:none"><button class="head"><span class="chev">&#9654;</span><span id="vEpHead">Episodes</span><span class="st" id="vEpSt"></span></button><div class="body" id="vEpBody"></div></div>
<div class="search"><div class="sbox"><svg class="ic glass"><use href="#i-search"/></svg><input id="vq" type="search" placeholder="Search everywhere" autocomplete="off"><button id="vclear" class="clr" type="button" aria-label="Clear search">&#215;</button></div><button id="vgo" class="go">Search</button></div>
<!-- where a tapped title opens (2026-10-10): on the PC as before, or on this phone in the service's own app, by the title's own address -->
<h3 class="qh">Continue watching</h3><div id="vCont" class="cards"><p class="note">Reading the services' lists&hellip;</p></div><p class="hint">Hold a card for its details, playlists and more.</p>
<h3 class="qh" id="vListHead">My list</h3><div id="vList" class="cards"></div>
<div id="vLenses"></div>
<div class="svc" id="vPlaylists" style="display:none"><button class="head"><span class="chev">&#9654;</span><span>Playlists</span><span class="st" id="vPlSt"></span></button><div class="body" id="vPlBody"></div></div>
<div class="svc" id="vLivePanel"><button class="head"><span class="chev">&#9654;</span><span>Live</span><span class="st" id="vLiveSt"></span></button><div class="body"><input id="vLiveQ" class="lq" type="search" placeholder="Find a channel or a program" autocomplete="off"><div id="vLive" class="quick"></div></div></div>
<div class="svc" id="vServices"><button class="head"><span class="chev">&#9654;</span><span>Services</span><span class="st" id="vSvcSt"></span></button><div class="body"><div class="openOn"><span>A title you tap opens</span><button id="openPc">On the PC</button><button id="openPhone">On this phone</button></div><p class="note" id="openNote"></p><div id="vSvcBody"><p class="note">Every service Prism knows, and whether it is set up and signed in here. A sign-in opens on the PC and you type into it from the Keyboard tab.</p></div></div></div>
<p class="err" id="verr"></p>
</section>
<section id="K">
<div class="target" id="target"><span class="tl">Nothing is focused in Prism</span><span class="ts">Press into a field there, then type here.</span></div>
<textarea id="t" placeholder="Type here" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
<form id="kform" class="kform" autocomplete="on" action="#" novalidate>
<div id="unrow" class="unr"><input id="u" name="username" type="text" inputmode="email" placeholder="Type the email or username here" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
<div id="pwrow" class="pwr"><input id="p" name="password" type="password" placeholder="Type the password here" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false"><button id="peek" type="button">Show</button></div>
<p class="note" id="pmNote">Your password manager can fill this box. Search it for the service by name.</p>
</form>
<div class="row"><button id="send" class="go">Send</button><button id="sendEnter">Send + Enter</button><button id="clear">Clear box</button></div>
<div class="pad"><button data-k="DPAD_UP" class="e">&#9650;</button><button data-k="DPAD_LEFT">&#9664;</button><button data-k="ENTER">Enter</button><button data-k="DPAD_RIGHT">&#9654;</button><button data-k="BACKSPACE">&#9003;</button><button data-k="DPAD_DOWN">&#9660;</button><button data-k="TAB">Tab</button></div>
<p class="err" id="kerr"></p>
</section>
<section id="L">
<p class="note">Prism's sound plays on this phone too, so you can listen with earbuds while the room hears the PC. This phone's buttons set your volume, the PC's set the room's.</p>
<button id="listen" class="big">Listen on this phone</button>
<p class="note" id="modeNote"></p>
<p class="note" id="lvlNote"></p>
<div id="lwin" class="lwin"><p class="note">Listening to</p><div class="row order" id="lwinRow"></div><p class="note" id="lwinNote"></p></div>
<audio id="out" playsinline preload="none"></audio>
<p class="err" id="lerr"></p><p class="work" id="netNote"></p>
<div class="work muteNote" id="muteNote"><span id="muteNoteText"></span><div class="row" id="muteAsk"><button id="muteYes" class="go">Mute the PC</button><button id="muteNo">Keep it playing</button></div></div>
</section>
<div id="install" class="install" role="dialog" aria-label="Add Prism to your Home Screen">
<p>Add Prism to your Home Screen. It opens full-screen and stays signed in.</p>
<ol id="installSteps"></ol>
<div class="row"><button class="go" id="installGo">Add Prism to Home Screen</button><button class="later" id="installLater">Not now</button></div>
<button class="never" id="installNever">Don't show again</button>
</div>
<!-- the Captions sheet sits outside the tab sections: inside the Music section it opened display:none while the Video tab was on (2026-10-05, "Captions on the companion app still doesn't work") -->
<div id="trkSheet" class="sheet"><b>Subtitles and audio</b><div id="trkList" class="trk"></div><button id="trkClose">Close</button></div>
<!-- the search results (2026-10-14, "Search, just like details, should not allow full feed scrolling while it's up"): a full sheet over
     the tab, the page beneath held still; Details, a person or a channel opens over it and closes back to it -->
<div id="srSheet" class="sheet full"><div class="top"><input id="srq" type="search" placeholder="Search everywhere" autocomplete="off" aria-label="Search everywhere"><button id="srClose">Close</button></div><div id="vResults"></div></div>
<div id="chSheet" class="sheet full"><div class="top"><b>Channel</b><button id="chClose">Close</button></div><div class="dh"><img id="chArt" alt=""><div><b id="chName"></b><span id="chFacts"></span></div></div><p class="dv" id="chBio"></p><div class="cards" id="chLatest"></div><p class="note" id="chNote"></p><button id="chOpen" class="go">Open the channel on Prism</button></div>
<div id="perSheet" class="sheet full"><div class="top"><b>Person</b><button id="perClose">Close</button></div><div class="dh"><img id="perArt" alt=""><div><b id="perName"></b><span id="perFacts"></span></div></div><p class="dv" id="perBio"></p><div class="psort"><span>Sort</span><button id="perByDate" class="on">Release date</button><button id="perByName">Name</button></div><div class="cards" id="perCredits"></div><p class="note" id="perNote"></p></div>
<div id="zoom" class="zoom" role="dialog" aria-label="The picture, larger"><img id="zoomImg" alt=""><span>Tap to close</span></div>
<div id="detSheet" class="sheet full"><div class="top"><b>Details</b><button id="detClose">Close</button></div><div class="dh"><img id="detArt" alt=""><div><b id="detTitle"></b><span id="detFacts"></span><span id="detRating"></span></div></div><div class="dbar"><button id="detPlay" class="go">Play on Prism</button><button id="detMore">Actions</button></div><div id="detActs" class="fold"></div><p class="note" id="detNote"></p><p class="dv" id="detOverview"></p><div class="dtags" id="detTags"></div><div class="dchan" id="detChan"></div><div class="dcast" id="detCast"></div><p class="dwhere" id="detWhere"></p></div>
<!-- Watch settings on the phone (2026-10-14): a full sheet, read from the PC and saved a piece at a time -->
<div id="wsSheet" class="sheet full"><div class="top"><b>Watch settings</b><button id="wsClose">Close</button></div><p class="note" id="wsNote"></p><div id="wsBody"></div></div>
<div id="ctxSheet" class="sheet full"><div class="top"><b id="ctxTitle"></b><button id="ctxClose">Close</button></div><div class="dh ctxHead"><img id="ctxArt" alt=""><div><b id="ctxName"></b><span id="ctxSvc"></span></div></div><div id="ctxTop"></div><div id="ctxRate"></div><div id="ctxActs"></div><p id="ctxNote" class="note"></p></div>
<!-- the TMDB guide's last step (2026-10-10): the key is copied on this phone, so this phone sends it; the page opens with #tmdb from the guide's code -->
<div id="keySheet" class="sheet"><b>Send your TMDB key to Prism</b>
<span class="keyNote">On TMDB's API page, copy the long one called API Read Access Token (the shorter API Key works too). Paste it here.</span>
<input id="tkey" type="password" placeholder="Paste the key here" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
<button id="tkeySend" class="go">Send to Prism</button><button id="tkeyClose">Close</button>
<span class="keyNote" id="tkeySaid"></span></div>
</main>
<script>
const token = new URLSearchParams(location.search).get('token') || '';
// every built-in service, from the PC's catalog at serve time (2026-10-11): the Services section says which are set up and signed in
const SERVICES = __SERVICES__;
const q = (s) => document.querySelector(s);
if (!q('#mf').href.includes('token=') || q('#mf').href.includes('__TOKEN__')) q('#mf').href = '/remote/manifest.json?token=' + encodeURIComponent(token);
// the mute buttons' word and icon (2026-10-11): the Video tab's carries an icon, the Music tab's is the word alone
function muteLabel(el, on) { const t = on ? 'Unmute the PC' : 'Mute the PC'; const span = el.querySelector('span'); if (span) span.textContent = t; else el.textContent = t; const use = el.querySelector('use'); if (use) use.setAttribute('href', on ? '#i-unmute' : '#i-mute'); }
// the window the phone's picks play into, kept here on the phone (2026-10-15, "Why can't the phone just use the pc path it takes when I drag a title
// onto any window?"): each pick names it ({into}), as a drag onto a window does on the PC, so nothing on the PC can move it between the tap and
// the pick. 0 the big window, n a small one, 'new' the next empty place. After a pick into a small window or a new one it steps to the next place
let vPlace = 0, vCount = 1, vMax = 5;
const PICK_PATHS = ['/video/play', '/video/tune', '/video/play-result', '/video/browse-play'];
const vPlaceLabel = (pl) => pl === 'new' ? 'Window ' + (vCount + 1) : pl === 0 ? 'the big window' : 'Window ' + (pl + 1);
const api = async (path, body, method) => {
  const isPick = PICK_PATHS.includes(path) && body && typeof body === 'object' && vPlace !== 0;
  if (isPick) body = Object.assign({}, body, { into: vPlace });
  const r = await fetch(path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token), { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
  if (isPick && j && j.ok !== false) vStep();
  return j;
};
function vStep() {
  const at = vPlace === 'new' ? vCount : vPlace, count = vPlace === 'new' ? vCount + 1 : vCount;
  const nx = at + 1;
  vPlace = nx >= vMax ? 0 : nx < count ? nx : 'new';
  vCount = count;
  setTimeout(() => { if (typeof pollScreens === 'function') { vwinSig = ''; pollScreens(true); } }, 1500);
}
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

// Watch settings on the phone (2026-10-14, "Let me edit as many of the watch settings as possible from the companion app"): what core keeps,
// read in one and set a piece at a time through the same calls the PC's Watch settings make; the PC's own (break covering's lists,
// performance) stay on the PC. Every change saves at once and the sheet is read again.
let wsShowLog = false; let wsState = null; const wsOpen = new Set(['TMDB']);   // the panels open on the sheet (the first one at the start)
// focus: the panel to open on (a row's pencil opens its own settings, 2026-10-15)
let wsCatPick = '';
async function openWs(focus, cat) { if (typeof cat === 'string') wsCatPick = cat; if (typeof focus === 'string') { wsOpen.clear(); wsOpen.add(focus); } const sh = q('#wsSheet'); sh.classList.add('on'); sh.scrollTop = 0; sheetLock(); q('#menu').classList.remove('on'); q('#wsNote').textContent = 'Reading\u2026'; await loadWs(); if (typeof focus === 'string') { const box = typeof cat === 'string' ? sh.querySelector('.cat[data-cat="' + cat.replace(/[^A-Za-z0-9_-]/g, '') + '"]') : null; const sec = box || sh.querySelector('.wsSec.open'); if (sec) sec.scrollIntoView({ block: 'start' }); if (box) box.classList.add('here'); } }
async function loadWs() {
  try {
    wsState = await api('/video/settings'); if (!wsState || wsState.ok === false) throw new Error((wsState && wsState.error) || 'Could not read the settings'); q('#wsNote').textContent = ''; drawWs(wsState);
    // the account's state loads on the PC's first ask after a start (core answers 'loading' meanwhile): asked again until it is in (2026-10-14)
    if (wsState.tmdb && wsState.tmdb.loading) for (let i = 0; i < 12; i++) { await new Promise((r) => setTimeout(r, 400)); const t = await api('/video/settings/tmdb-state', {}); if (t && !t.loading) { wsState.tmdb = t; drawWs(wsState); break; } }
  } catch (e) { q('#wsNote').textContent = e.message; }
}
async function setWs(what, body, said) {
  q('#wsNote').textContent = 'Saving\u2026';
  try { const r = await api('/video/settings/' + what, body || {}); if (r && r.ok === false) throw new Error(r.error || 'Could not save'); await loadWs(); q('#wsNote').textContent = said || 'Saved.'; vSig = ''; setTimeout(pollVideo, 800); vLensAt = 0; setTimeout(pollLenses, 1200); }
  catch (e) { q('#wsNote').textContent = e.message; }
}
q('#wsClose').onclick = () => { q('#wsSheet').classList.remove('on'); sheetLock(); };
q('#wsBtn').onclick = openWs;
function drawWs(s) {
  const sh = q('#wsSheet'), box = q('#wsBody'); const keepTop = sh.scrollTop; box.innerHTML = '';
  // one folded panel a subject and a jump bar above them (2026-10-14, "organized and content better segregated so it's quick to navigate"):
  // a chip opens its panel and brings it up; the panels left open stay open through a save
  const jump = document.createElement('div'); jump.className = 'jump'; box.appendChild(jump);
  let cur = box;
  const h = (t) => { const e = document.createElement('h4'); e.textContent = t; cur.appendChild(e); };
  const sub = (t) => { const e = document.createElement('p'); e.className = 'sub'; e.textContent = t; cur.appendChild(e); };
  const chips = (items, onId, go) => { const row = document.createElement('div'); row.className = 'chips'; for (const it of items) { const b = document.createElement('button'); b.textContent = it.label; if (it.id === onId) b.className = 'on'; if (it.hint) b.title = it.hint; b.onclick = () => go(it.id); row.appendChild(b); } cur.appendChild(row); return row; };
  const toggle = (label, on, go) => chips([{ id: true, label: label + ': on' }, { id: false, label: label + ': off' }], on, go);
  const act = (items) => { const row = document.createElement('div'); row.className = 'act'; for (const it of items) { const b = document.createElement('button'); b.textContent = it.label; if (it.go_) b.className = 'go'; b.onclick = () => it.go(b); row.appendChild(b); } cur.appendChild(row); return row; };
  const field = (label, input) => { const f = document.createElement('div'); f.className = 'fld'; const sp = document.createElement('span'); sp.textContent = label; f.appendChild(sp); f.appendChild(input); cur.appendChild(f); return f; };
  const section = (title, fill) => {
    const d = document.createElement('div'); d.className = 'svc wsSec'; if (wsOpen.has(title)) d.classList.add('open');
    const head = document.createElement('button'); head.className = 'head'; const chev = document.createElement('span'); chev.className = 'chev'; chev.textContent = '\u25b6'; head.appendChild(chev); const t = document.createElement('span'); t.textContent = title; head.appendChild(t); d.appendChild(head);
    const body = document.createElement('div'); body.className = 'body'; d.appendChild(body);
    // one panel open at a time (2026-10-14, "make other menus collapse when 1 expands"): opening one folds the rest
    const only = () => { for (const x of box.querySelectorAll('.wsSec.open')) if (x !== d) x.classList.remove('open'); wsOpen.clear(); wsOpen.add(title); d.classList.add('open'); };
    head.onclick = () => { if (d.classList.contains('open')) { d.classList.remove('open'); wsOpen.delete(title); } else only(); };
    const jb = document.createElement('button'); jb.textContent = title; jb.onclick = () => { only(); d.scrollIntoView({ block: 'start', behavior: 'smooth' }); }; jump.appendChild(jb);
    cur = body; fill(); cur = box; box.appendChild(d);
  };
  const rowSec = (title, what, r, body) => { if (!r) return; h(title); chips(r.orders || [], r.order, (id) => setWs(what, Object.assign({ order: id }, body))); chips([{ id: false, label: 'Normal order' }, { id: true, label: 'Reversed' }], !!r.reverse, (v) => setWs(what, Object.assign({ reverse: v }, body))); };
  // TMDB first (2026-10-14, "We'll make it so I can do it from the phone companion app even more easily"): the key pasted here goes to the PC
  // as the guide's sheet sends it; the account link opens TMDB's approval page on this phone, then I approved it finishes it on the PC
  section('TMDB', () => {
    const t = Object.assign({}, s.tmdb || {}); if (s.tmdbKey === true) t.hasKey = true;   // the key's own flag is read at once; the account's state may still be loading
    h('Your TMDB key'); sub(t.hasKey ? 'Set. Ratings, the catalog rows and search are on. Paste a new one to replace it.' : 'Not set. Prism works without one. A free TMDB account gives a key: paste it here.');
    const key = document.createElement('input'); key.type = 'password'; key.placeholder = t.hasKey ? 'Replace the key (optional)' : 'Paste the API Read Access Token or API Key'; key.autocomplete = 'off'; key.autocapitalize = 'off'; key.spellcheck = false; key.style.width = '100%'; key.style.marginTop = '6px'; cur.appendChild(key);
    const acts = [{ label: 'Send the key to Prism', go_: true, go: async () => { const v = key.value.trim(); if (!v) { q('#wsNote').textContent = 'Paste the key first.'; return; } q('#wsNote').textContent = 'Sending\u2026'; try { const r = await api('/tmdb/key', { apiKey: v }); if (r && r.error) throw new Error(r.error); key.value = ''; await loadWs(); q('#wsNote').textContent = 'The key is on the PC. Ratings, the catalog rows and search are on.'; } catch (e) { q('#wsNote').textContent = e.message; } } }];
    if (t.hasKey) acts.push({ label: 'Clear the key', go: (b) => { if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Clear it for sure?'; setTimeout(() => { b.dataset.sure = ''; b.textContent = 'Clear the key'; }, 4000); return; } setWs('tmdb-key-clear', {}, 'The key is cleared.'); } });
    act(acts);
    h('Your TMDB account'); 
    if (t.linked) { sub('Linked as ' + (t.username || 'you') + '. Your stars on a title go to TMDB, and My watchlist is your TMDB watchlist.'); act([{ label: 'Unlink', go: (b) => { if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Unlink for sure?'; setTimeout(() => { b.dataset.sure = ''; b.textContent = 'Unlink'; }, 4000); return; } setWs('tmdb-unlink', {}, 'Unlinked. The ratings stay on your TMDB account.'); } }]); }
    else if (!t.hasKey) sub('Linking needs the key first.');
    else {
      sub(t.url ? 'Approve Prism on TMDB, then press I approved it.' : 'Link it to rate from Prism and to use your TMDB watchlist. TMDB\u2019s approval page opens on this phone.');
      if (!t.url) act([{ label: 'Link my TMDB account', go_: true, go: async (b) => { b.disabled = true; q('#wsNote').textContent = 'Asking TMDB\u2026'; try { await api('/video/settings/tmdb-link-start', {}); let st = null; for (let i = 0; i < 25; i++) { await new Promise((r) => setTimeout(r, 400)); st = await api('/video/settings/tmdb-state', {}); if (st && (st.url || st.error) && !st.busy) break; } if (!st || !st.url) throw new Error((st && st.error) || 'TMDB did not answer'); await loadWs(); q('#wsNote').textContent = ''; } catch (e) { q('#wsNote').textContent = e.message; b.disabled = false; } } }]);
      else {
        const open = document.createElement('a'); open.href = t.url; open.target = '_blank'; open.rel = 'noopener noreferrer'; open.className = 'wsLink'; open.textContent = 'Open TMDB to approve'; cur.appendChild(open);
        act([{ label: 'I approved it', go_: true, go: async (b) => { b.disabled = true; q('#wsNote').textContent = 'Finishing\u2026'; try { await api('/video/settings/tmdb-link-finish', {}); let st = null; for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 400)); st = await api('/video/settings/tmdb-state', {}); if (st && !st.busy && !st.loading) break; } await loadWs(); q('#wsNote').textContent = st && st.linked ? 'Linked as ' + (st.username || 'you') + '.' : (st && st.error) || 'Not linked yet. Approve on TMDB first, then press again.'; } catch (e) { q('#wsNote').textContent = e.message; b.disabled = false; } } }, { label: 'Start over', go: () => setWs('tmdb-unlink', {}, 'Start the link again when you like.') }]);
      }
    }
  });
  const rows = s.rows || {};
  section('Rows', () => {
    sub('The order of each row on the Video tab, as the PC draws it.');
    rowSec('Continue watching', 'rows', rows.continue, { row: 'continue' });
    if (rows.watchlist && rows.watchlist.active) rowSec('My watchlist', 'watchlist-order', rows.watchlist, {});
    rowSec('New episodes, last 10 days', 'fresh-order', rows.freshEpisodes, { row: 'fresh-episodes' });
    rowSec('New movies, last 30 days', 'fresh-order', rows.freshMovies, { row: 'fresh-movies' });
    rowSec(rows.watchlist && rows.watchlist.active ? "My list (the services' own lists)" : 'My list', 'rows', rows.list, { row: 'list' });
  });
  section('Ads', () => {
    h('Video ads'); sub('What a window shows while an ad plays. Prism never blocks or skips an ad.');
    chips([{ id: 'veil', label: 'Veiled and muted', hint: 'The ad is covered with a picture and its sound is off.' }, { id: 'mute', label: 'Muted, picture visible', hint: 'You see the ad with its sound off.' }, { id: 'show', label: 'Show', hint: 'The ad plays as it comes, picture and sound.' }], s.adsLook || 'veil', (id) => setWs('ads', { look: id })); h('Cover pictures'); sub('The pictures on a covered ad. Turn on one or more.'); { const onSet = new Set(String(s.coverSource || 'photos').split(',').filter(Boolean)); const row = document.createElement('div'); row.className = 'chips'; const note = document.createElement('p'); note.className = 'sub'; for (const it of [{ id: 'photos', label: 'Nature photos', hint: 'Prism' + String.fromCharCode(39) + 's hand-picked nature photos, all public domain.' }, { id: 'cosmos', label: 'Cosmos', hint: 'NASA' + String.fromCharCode(39) + 's pictures of space, public domain.' }, { id: 'gallery', label: 'Museum art', hint: 'Paintings and prints from the Art Institute of Chicago and the Met, public domain.' }]) { const b = document.createElement('button'); b.textContent = it.label; b.title = it.hint; if (onSet.has(it.id)) b.className = 'on'; b.onclick = () => { if (onSet.has(it.id)) { if (onSet.size === 1) { note.textContent = 'Keep at least one set of pictures on.'; return; } onSet.delete(it.id); } else onSet.add(it.id); setWs('cover-source', { source: [...onSet].join(',') }); }; row.appendChild(b); } cur.appendChild(row); cur.appendChild(note); }
    h('YouTube TV breaks'); sub('YouTube TV doesn\u2019t say when a channel\u2019s commercials play, so Prism watches the picture and covers them. The never-covered and sure-breaks lists are on the PC.');
    chips([{ id: 'all', label: 'All breaks', hint: 'Every break Prism finds by watching the picture is covered.' }, { id: 'sure', label: 'Sure breaks only', hint: 'Only the ad slots YouTube TV marks itself, and paid programmes. It never covers the show by mistake, and misses the breaks YouTube TV doesn' + '\u2019t mark.' }, { id: 'off', label: 'Off', hint: 'YouTube TV' + '\u2019s channels are never covered.' }], bwMode, (v) => setBw(v));
    sub(bwMode === 'all' ? 'Every break Prism finds by watching the picture is covered.' : bwMode === 'sure' ? 'Only the ad slots YouTube TV marks itself, and paid programmes. It never covers the show by mistake, and misses the breaks YouTube TV doesn'+'\u2019t mark.' : 'YouTube TV'+'\u2019s channels are never covered.');
  });
  section('Updates', () => {
    // this Prism (2026-10-15, "The update menu should let me initialize updates and see the change log"): the version, what the server offers, Check
    // now, Install now, Restart into the new version, and the changelog from the signed manifest (nothing fetched to show it)
    const sw = s.software || {}; const av = sw.available || null, stg = sw.staged || null;
    const trackLabel = sw.channel === 'alpha' ? 'Alpha' : sw.channel === 'beta' ? 'Beta' : 'Full';
    const whenOf = (iso) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'never'; };
    h('This Prism'); const run = document.createElement('p'); run.className = 'ver'; run.textContent = 'Prism ' + (sw.currentVersion || '?') + ' on the ' + trackLabel + ' track'; cur.appendChild(run);
    sub(stg ? 'Prism ' + stg.version + ' is installed and runs at the next start.' : av ? 'Prism ' + av.version + ' is ready to install. Last check ' + whenOf(sw.lastCheck) + '.' : sw.lastResult === 'unreachable' ? 'The update server could not be reached. Last tried ' + whenOf(sw.lastCheck) + '.' : sw.lastResult === 'invalid' ? 'The update server\u2019s answer did not verify, so nothing was taken from it.' : sw.lastCheck ? 'This is the newest version on the ' + trackLabel + ' track. Last check ' + whenOf(sw.lastCheck) + '.' : 'Not checked yet.');
    const verbs = [{ label: 'Check now', go: (b) => { b.disabled = true; setWs('update-check', {}, 'Checked.'); } }];
    if (av && !stg) verbs.push({ label: 'Install ' + av.version, go_: true, go: async (b) => { b.disabled = true; q('#wsNote').textContent = 'Downloading and checking on the PC\u2026 its status line says how far.'; try { await api('/video/settings/update-install', {}); for (let i = 0; i < 300; i++) { await new Promise((r) => setTimeout(r, 3000)); const st = await api('/video/settings'); if (st && st.software && (st.software.staged || (!st.software.available && st.software.lastResult))) { wsState = st; drawWs(st); q('#wsNote').textContent = st.software.staged ? 'Installed. Restart into it when you like.' : 'The install did not finish. The PC\u2019s status line says why.'; return; } } } catch (e) { q('#wsNote').textContent = e.message; b.disabled = false; } } });
    if (stg) verbs.push({ label: 'Restart into ' + stg.version, go_: true, go: (b) => { if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Restart Prism now?'; q('#wsNote').textContent = 'Prism closes on the PC and opens again in the new version. Whatever is playing stops.'; setTimeout(() => { b.dataset.sure = ''; b.textContent = 'Restart into ' + stg.version; }, 6000); return; } setWs('update-restart', {}, 'Prism is restarting on the PC. This page refreshes itself when it is back.'); } });
    act(verbs);
    if (sw.nextCheck) sub('Next check ' + whenOf(sw.nextCheck) + '. The track and the schedule are set on the PC.'); else if (sw.enabled === false) sub('Prism checks only when you press Check now. The schedule is set on the PC.');
    // the changelog: newest first, the ones newer than this Prism marked New, this one Running now
    const src = av || sw.latest || null; let list = (src && src.history) || []; if (!list.length && src && src.notes) list = [{ version: src.version, date: src.date, notes: src.notes }];
    const cmp = (a, b) => { const pa = String(a).split('-')[0].split('.'), pb = String(b).split('-')[0].split('.'); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = parseInt(pa[i] || '0', 10) || 0, y = parseInt(pb[i] || '0', 10) || 0; if (x !== y) return x > y ? 1 : -1; } return 0; };
    const log = document.createElement('div'); log.className = 'chlog'; log.style.display = wsShowLog ? '' : 'none';
    for (const r of list) { const d = document.createElement('div'); d.className = 'rel'; const hd = document.createElement('b'); const c = cmp(r.version, sw.currentVersion || '0'); hd.textContent = 'Prism ' + r.version + (r.date ? ' \u00b7 ' + new Date(r.date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '') + (c > 0 ? ' \u00b7 New' : c === 0 ? ' \u00b7 Running now' : ''); if (c > 0) hd.className = 'new'; d.appendChild(hd); const n = document.createElement('p'); n.textContent = r.notes; d.appendChild(n); log.appendChild(d); }
    if (!list.length) { const n = document.createElement('p'); n.className = 'sub'; n.textContent = 'The update server hasn\u2019t sent a changelog yet. Check now asks it.'; log.appendChild(n); }
    act([{ label: wsShowLog ? 'Hide what\u2019s changed' : 'What\u2019s changed', go: (b) => { wsShowLog = !wsShowLog; log.style.display = wsShowLog ? '' : 'none'; b.textContent = wsShowLog ? 'Hide what\u2019s changed' : 'What\u2019s changed'; } }]);
    cur.appendChild(log);
    h('Scheduled content updates'); sub("Every 20 minutes while the PC is quiet, each service's lists are read again. A pause holds only these."); const p = s.pause || {};
    const from = document.createElement('input'); from.type = 'time'; from.value = p.from || '23:00'; const to = document.createElement('input'); to.type = 'time'; to.value = p.to || '07:00';
    field('Pause from', from); field('until', to);
    chips([{ id: true, label: 'Pause: on' }, { id: false, label: 'Pause: off' }], p.on === true, (v) => setWs('pause', { on: v, from: from.value, to: to.value }));
    act([{ label: 'Save the hours', go: () => setWs('pause', { on: p.on === true, from: from.value, to: to.value }) }, { label: 'Refresh everything now', go: () => setWs('refresh', {}, "The PC is reading the services' lists again.") }]);
  });
  // the services' reads, as the PC's Services tab shows them (2026-10-14, "Ensure everything is present in both")
  section('Services', () => {
    const u = s.updates || {}; const agoAt = (x) => x && typeof x.at === 'number' && x.at > 0 ? agoOf(x.at) : 'not read yet';
    h('Your services'); sub('When each service was last read, and a read again now.');
    for (const sv of u.services || []) {
      const d = document.createElement('div'); d.className = 'hid'; const sp = document.createElement('span');
      const parts = []; if (sv.status !== 'signed-in') parts.push('not signed in'); else { if (sv.lists) parts.push('lists ' + (sv.working ? 'reading now' : agoAt(sv.lists))); if (sv.owned) parts.push('owned ' + agoAt(sv.owned)); if (sv.profiles) parts.push('profiles ' + (sv.profiles.page ? agoAt(sv.profiles) : 'with its lists')); }
      const nm = document.createElement('b'); nm.textContent = sv.name; sp.appendChild(nm); sp.appendChild(document.createElement('br')); sp.appendChild(document.createTextNode(parts.join(' \u00b7 ') || 'nothing to read')); d.appendChild(sp);
      if (sv.status === 'signed-in' && (sv.lists || sv.owned)) { const bt = document.createElement('button'); bt.textContent = 'Refresh'; bt.onclick = () => setWs('refresh-app', { app: sv.app }, 'The PC is reading ' + sv.name + ' again.'); d.appendChild(bt); }
      cur.appendChild(d);
    }
    h('Catalog rows and ratings');
    for (const f of u.feeds || []) { const d = document.createElement('div'); d.className = 'hid'; const sp = document.createElement('span'); sp.textContent = f.name + ' \u00b7 ' + (f.done === false ? 'reading now' : agoAt(f)) + (typeof f.count === 'number' ? ' \u00b7 ' + f.count + ' titles' : ''); d.appendChild(sp); cur.appendChild(d); }
    if (u.ratings) { const d = document.createElement('div'); d.className = 'hid'; const sp = document.createElement('span'); sp.textContent = 'Ratings on cards \u00b7 TMDB, a day per title'; d.appendChild(sp); cur.appendChild(d); }
  });
  section('The Binge', () => {
    const b = s.binge || {}; const t = b.thresholds || b.defaults || {};
    h('Limits'); sub('A series is in The Binge when all of these hold.');
    const num = (label, key, step) => { const inp = document.createElement('input'); inp.type = 'number'; inp.step = step || '1'; inp.inputMode = 'decimal'; inp.value = t[key]; field(label, inp); return inp; };
    const mr = num('Median episode, minutes or shorter', 'maxRuntime'), me = num('Episodes, at least', 'minEpisodes'), rt = num('TMDB rating, at least', 'minRating', '0.1'), vt = num('TMDB votes, at least', 'minVotes'), yr = num('Released in or later (1888 leaves nothing out)', 'minYear');
    act([{ label: 'Save the limits', go_: true, go: () => setWs('binge', { thresholds: { maxRuntime: +mr.value, minEpisodes: +me.value, minRating: +rt.value, minVotes: +vt.value, minYear: +yr.value } }) }, { label: 'Back to the defaults', go: () => setWs('binge', { thresholds: b.defaults || {} }) }]);
    h('Animation'); toggle('Animated series', b.animation !== false, (v) => setWs('binge', { animation: v }));
    const k = b.kids || {}; h('Kids mode'); sub('Only shows rated for the age.');
    chips([{ id: 'off', label: 'Off' }].concat((b.ages || []).map((a) => ({ id: a.id, label: a.label, hint: (a.ratings || []).join(', ') }))), k.on ? k.age : 'off', (id) => setWs('binge', { kids: id === 'off' ? { on: false } : { on: true, age: id } }));
    h('Hidden titles'); const hid = s.hidden || [];
    if (!hid.length) sub('Nothing is hidden. Hide a title from its card\u2019s menu on the PC.');
    for (const it of hid) {
      const d = document.createElement('div'); d.className = 'hid'; const sp = document.createElement('span'); sp.textContent = (it.title || it.id) + (it.service ? ' \u00b7 ' + it.service : '') + (it.why === 'missing' ? ' \u00b7 missing from TMDB\u2019s answer for now' : ''); d.appendChild(sp);
      if (it.why !== 'missing') { const bt = document.createElement('button'); bt.textContent = 'Show again'; bt.onclick = () => setWs('hidden', { id: it.id, on: false, title: it.title }, 'Back on The Binge.'); d.appendChild(bt); }
      cur.appendChild(d);
    }
  });
  section('Categories', () => {
    sub('Rows of titles from your services, tagged with hashtags or words. Each row has an (i) on the Video tab.');
    const rules = s.rules || [], pools = s.poolServices || [];
    const catBox = (c) => {
      const d = document.createElement('div'); d.className = 'cat'; if (c && c.id) d.dataset.cat = c.id;
      const name = document.createElement('input'); name.type = 'text'; name.placeholder = c ? 'Name' : 'New category: its name'; name.value = c ? (c.name || '') : ''; name.autocomplete = 'off'; d.appendChild(name);
      const tags = document.createElement('input'); tags.type = 'text'; tags.placeholder = '#hashtags or words, with spaces between'; tags.value = c ? (c.tags || []).join(' ') : ''; tags.autocomplete = 'off'; tags.autocapitalize = 'off'; d.appendChild(tags);
      let rule = c ? c.rule : (rules[0] ? rules[0].id : 'newest'); const rrow = document.createElement('div'); rrow.className = 'chips'; const rb = [];
      for (const r of rules) { const bt = document.createElement('button'); bt.textContent = r.name; bt.title = r.simple || ''; if (r.id === rule) bt.className = 'on'; bt.onclick = () => { rule = r.id; for (const x of rb) x.className = x === bt ? 'on' : ''; }; rb.push(bt); rrow.appendChild(bt); }
      d.appendChild(rrow);
      let pool = c ? c.pool === true : false; const prow = document.createElement('div'); prow.className = 'chips'; const pb = document.createElement('button');
      const drawPool = () => { pb.textContent = (pools.length ? 'Also from the open pool (' + pools.map((x) => x.name).join(', ') + ')' : 'The open pool needs YouTube or Twitch on the PC') + ': ' + (pool ? 'on' : 'off'); pb.className = pool ? 'on' : ''; };
      pb.onclick = () => { if (!pools.length) return; pool = !pool; drawPool(); }; drawPool(); prow.appendChild(pb); d.appendChild(prow);
      const row = document.createElement('div'); row.className = 'act';
      const save = document.createElement('button'); save.className = 'go'; save.textContent = c ? 'Save' : 'Add this category';
      save.onclick = () => { const tg = tags.value.split(/\s+/).map((x) => x.trim()).filter(Boolean); if (!tg.length) { q('#wsNote').textContent = 'Give it at least one #tag or word.'; return; } setWs('category', { category: { id: c ? c.id : 'c' + Date.now().toString(16), name: name.value.trim(), v: 2, tags: tg, rule, pool } }, c ? 'Saved ' + (name.value.trim() || tg.join(' ')) + '.' : 'Added ' + (name.value.trim() || tg.join(' ')) + '.'); };
      row.appendChild(save);
      if (c) { const del = document.createElement('button'); del.textContent = 'Delete'; del.onclick = () => { if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'Delete for sure?'; setTimeout(() => { del.dataset.sure = ''; del.textContent = 'Delete'; }, 4000); return; } setWs('category', { delete: c.id }, 'Deleted ' + (c.name || '') + '.'); }; row.appendChild(del); }
      d.appendChild(row); cur.appendChild(d);
    };
    // one category at a time, picked from a dropdown, as on the PC's Categories tab (2026-10-16, "Let's conserve space in the categories on the
    // companion app like we do in the main app. With the dropdown ... Drill down is better"): the categories you have, then New category
    const cats = s.categories || [];
    if (wsCatPick !== 'new' && !cats.some((c) => c.id === wsCatPick)) wsCatPick = cats.length ? cats[0].id : 'new';
    const sel = document.createElement('select'); sel.className = 'catPick'; sel.setAttribute('aria-label', 'Category');
    for (const c of cats) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name || (c.tags || []).join(' '); sel.appendChild(o); }
    const on = document.createElement('option'); on.value = 'new'; on.textContent = 'New category\u2026'; sel.appendChild(on);
    sel.value = wsCatPick;
    field('Category', sel).classList.add('catRow');
    const holder = document.createElement('div'); cur.appendChild(holder);
    const show = () => { wsCatPick = sel.value; holder.innerHTML = ''; const keep = cur; cur = holder; catBox(cats.find((c) => c.id === wsCatPick) || null); cur = keep; };
    sel.onchange = show; show();
  });
  sh.scrollTop = keepTop;
}
// the break watch's switch (2026-10-07, "we'll have to make this a feature they can shut down"): the PC's own Watch settings box, from the phone
// three choices since 2026-10-15 ("all ads, only guaranteed ads, or none"): All breaks, Sure breaks only, Off; an older 'on' reads as All breaks
const BW_LABEL = { all: 'All breaks', sure: 'Sure breaks only', off: 'Off' };
let bwMode = (() => { const v = localStorage.getItem('prismBreakWatch'); return v === 'off' ? 'off' : v === 'sure' ? 'sure' : 'all'; })();
function drawBw() { q('#bwBtn').textContent = 'Cover YouTube TV breaks: ' + BW_LABEL[bwMode]; }
drawBw();
// one switch, two places: the options menu and the Ads panel of Watch settings (2026-10-14, "the YouTube tv ad setting can be added in here too")
async function setBw(mode) { const was = bwMode; bwMode = mode; drawBw(); try { localStorage.setItem('prismBreakWatch', bwMode); await api('/video/break-watch', { mode: bwMode }); } catch (e) { bwMode = was; drawBw(); } if (wsState && q('#wsSheet').classList.contains('on')) drawWs(wsState); }
q('#bwBtn').onclick = () => setBw(bwMode === 'all' ? 'sure' : bwMode === 'sure' ? 'off' : 'all');
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
  if (q('#' + id).classList.contains('on')) return;
  if (!confirm('Switch the PC to the ' + (kind === 'music' ? 'Music lounge' : 'Video player') + '? Everyone in the room sees it change.')) return;   // a whole-PC switch from a phone menu asks first (2026-10-17, finding 23)
  try { await api('/ui/route', { route: 'prism://player/' + kind }); q('#menu').classList.remove('on'); setTimeout(pollPlayers, 800); setTimeout(pollPlayers, 2500); } catch (e) { q('#howHome').textContent = e.message; }
};
pollPlayers(); setInterval(pollPlayers, 5000);
// ---- the PC updated: a banner, five minutes to a refresh, or now (2026-10-04). The page's own version is written into it as the PC
// serves it, so the banner never depends on a first check that happened to succeed: a page loaded while the PC was restarting, or one
// whose first check failed, had taken the NEW version as its own and never said so (2026-10-14, "I should see a refresh button on the
// phone but do not"). Checked every twenty seconds and each time the page comes back to the front; Refresh this page is under Options too.
let pageVersion = '__VERSION__', refreshAt = 0;
async function checkVersion() {
  try {
    const r = await fetch('/remote/version', { cache: 'no-store' }); const v = (await r.json()).v;
    if (!pageVersion || pageVersion.indexOf('__') === 0) { pageVersion = v; return; }
    if (v !== pageVersion && !refreshAt) { refreshAt = Date.now() + 5 * 60 * 1000; q('#banner').classList.add('on'); tickBanner(); }
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(); });
function tickBanner() {
  if (!refreshAt) return;
  const left = Math.max(0, Math.round((refreshAt - Date.now()) / 1000));
  q('#bannerText').textContent = 'Prism on the PC was updated. This page refreshes in ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') + '.';
  if (left <= 0) { location.reload(); return; }
  setTimeout(tickBanner, 1000);
}
q('#refreshNow').onclick = () => location.reload();
checkVersion(); setInterval(checkVersion, 20000);
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
    wallMuted = !!n.wallMuted; for (const b of document.querySelectorAll('#trMute, #vMute')) { muteLabel(b, wallMuted); b.classList.toggle('on', wallMuted); }
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
    q('#trPlay').innerHTML = '<svg class="ic"><use href="#i-' + (now && now.playbackState === 'playing' ? 'pause' : 'play') + '"/></svg>';
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
  if (!tile || !col) { for (const x of document.querySelectorAll('#orderRow [data-o]')) x.classList.toggle('on', x.dataset.o === o); say('#merr', 'The next pick plays ' + (b.querySelector('span') || b).textContent.toLowerCase() + '.'); return; }
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
  if (c === 'play') c = npPlaying ? 'pause' : 'play';
  if (c === 'mute') { c = wallMuted ? 'unmute' : 'mute'; wallMuted = !wallMuted; for (const m of document.querySelectorAll('#trMute, #vMute')) { muteLabel(m, wallMuted); m.classList.toggle('on', wallMuted); } }
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
    // nothing playing, nothing starting: the page opens on the rows, and the transport comes when a title starts (2026-10-17, the designer's pass, finding 19)
    document.body.classList.toggle('idle', !vid && !vwork && !(now && (now.pending || now.error || now.gate)));
    if (vwork) { q('#vTitle').textContent = 'Loading' + '\u2026'; q('#vSub').textContent = vwork.name; q('#vSvc').textContent = vwork.service; q('#vArt').removeAttribute('src'); q('#vnp').classList.add('loading'); } else {
    q('#vnp').classList.remove('loading');
    q('#vTitle').textContent = vid && (vid.title || vid.series) ? (vid.series && vid.title && vid.series !== vid.title ? vid.series : vid.title || vid.series) : now && now.pending ? 'Opening ' + now.pending.name + '\u2026' : 'Nothing playing';
    const ep = vid && typeof vid.season === 'number' && typeof vid.episode === 'number' ? 'S' + vid.season + ' E' + vid.episode : '';
    q('#vSub').textContent = vid ? [ep, vid.series && vid.title && vid.series !== vid.title ? vid.title : '', vid.ad ? 'an ad is playing' : ''].filter(Boolean).join(' \u00b7 ') : 'Pick something below';
    q('#vSvc').textContent = svc ? svc.name : '';
    // the page's own error said plainly, with Retry (2026-10-05, Netflix's "Too many people are using your account right now": "make that play
    // through to the companion app. And add the retry option"): Retry presses the page's own Retry, or opens the title again where there is none
    // the service's own gate over the player (2026-10-13, Twitch's content disclaimer): its words, its verb; else the page's error with Retry
    const gate = now && now.gate && now.gate.text ? now.gate : null;
    q('#vErrText').textContent = gate ? gate.text : now && now.error ? now.error : '';
    q('#vRetry').textContent = gate ? (gate.verb || 'Start watching') : 'Retry'; q('#vRetry').dataset.cmd = gate ? 'gate' : 'retry';
    q('#vErr').classList.toggle('on', !!(gate || (now && now.error)));
    const art = now && now.art; if (art) q('#vArt').src = art; else q('#vArt').removeAttribute('src');
    }
    q('#vPlay').innerHTML = '<svg class="ic"><use href="#i-' + (vPlaying ? 'pause' : 'play') + '"/></svg>';
    if (tabNow === 'V' && !window.__npPolled) { api('/now-playing').then((n) => { wallMuted = !!n.wallMuted; for (const m of document.querySelectorAll('#trMute, #vMute')) { muteLabel(m, wallMuted); m.classList.toggle('on', wallMuted); } }).catch(() => {}); }
    const can = now ? now.can : null;
    for (const b of document.querySelectorAll('[data-v]')) b.disabled = !now || (b.dataset.v !== 'mute' && b.dataset.v !== 'play' && b.dataset.v !== 'restart' && can && !can.cmd && !/seek/.test(b.dataset.v));
    // the skip button only while the service offers a skip (2026-10-05, "the skip button should only appear when skip is available")
    q('#vSkip').querySelector('span').textContent = now && now.skip ? now.skip : 'Skip intro'; q('#vSkip').style.display = now && now.skip ? '' : 'none';
    vCanTracks = !!(can && can.tracks);
    const pos = vid && typeof vid.position === 'number' ? vid.position : null, dur = vid && typeof vid.duration === 'number' && vid.duration > 0 ? vid.duration : null;
    q('#vSeekRow').style.visibility = pos !== null ? 'visible' : 'hidden';
    if (pos !== null && !vSeeking) { q('#vPos').textContent = mmss(pos); q('#vDur').textContent = dur ? '-' + mmss(dur - pos) : ''; q('#vSeek').value = dur ? Math.round(pos / dur * 1000) : 0; q('#vSeek').disabled = !(dur && can && can.seek); }
    // the rows only when they changed
    const sig = JSON.stringify([v.continue, v.list, v.watchlist, v.live, !!v.liveReading, !!v.liveCanRead, Math.floor(Date.now() / 60000)]);
    if (sig !== vSig) {
      vSig = sig; drawCards('#vCont', v.continue, 'Nothing to carry on with yet.');
      // My Watchlist in My list's place while a TMDB account is linked, as on the PC (2026-10-14)
      const wl = v.watchlist && v.watchlist.active ? v.watchlist : null;
      q('#vListHead').textContent = wl ? 'My watchlist' + (wl.reading ? ' \u00b7 still reading' : '') : 'My list';
      if (wl) drawCatalog('#vList', wl.cards, wl.reading ? 'Reading your TMDB watchlist\u2026' : 'Nothing on your TMDB watchlist yet.'); else drawCards('#vList', v.list, 'Nothing on your lists yet.');
      drawLive(v.live, v);
    }
    lastVideoServices = v.services || []; drawServices(lastVideoServices);
    pollEpisodes(now); pollLenses();
  } catch (e) { say('#verr', e.message); }
}
setInterval(pollVideo, 2500);
// every window's title, and where the phone's next pick plays (2026-10-15, "Does the mobile app show what's playing in all 5 windows?",
// "Can I set what's playing from the companion app? If not, I need to"): a tap on a window makes it the place this phone's picks play into;
// Add a window opens the next one for the next pick. With only the big window up, Add a window is the way to a second
let vwinSig = '';
async function pollScreens(force) {
  const box = q('#vwins');
  let w = null; try { w = await api('/video/screens'); } catch { return; }
  const wins = (w && w.windows) || [];
  const bigHas = !!(w && w.big && w.big.has);
  if (!w || (!(w.on && wins.length) && !bigHas)) { box.classList.remove('on'); vwinSig = ''; return; }
  box.classList.add('on');
  const rows = wins.length ? wins : [{ tile: 'big', index: 0, label: 'Big window', name: w.big.name, title: w.big.title, playing: w.big.playing }];
  const sig = JSON.stringify([rows.map((x) => [x.tile, x.label, x.name, x.title, x.playing]), vPlace, w.max]);
  if (sig === vwinSig && !force) return; vwinSig = sig;
  const list = q('#vwinList'); list.innerHTML = '';
  vCount = rows.length; vMax = w.max || 5;
  if (typeof vPlace === 'number' && vPlace >= vCount) vPlace = 0;   // a window gone: the big one again
  const note = q('#vwinNote');
  const choose = (pl) => { vPlace = pl; note.textContent = vPlace === 'new' ? 'Your next pick opens ' + vPlaceLabel(vPlace) + '.' : 'Your next pick plays in ' + vPlaceLabel(vPlace) + '.'; vwinSig = ''; pollScreens(true); };
  // as Watch (2026-10-15, "make it just like Watch so it's intuitive, but organize in such a way that is sensible on the phone"): the big window a
  // card across the width, the small ones two to a row, the empty place a + card; the place the next pick plays into in amber. A tap on the
  // chosen screen's Clear clears it as the PC's X does (2026-10-15, "I should be able to tap and clear a screen")
  for (const x of rows) {
    const r = document.createElement('div'); r.setAttribute('role', 'button'); r.className = 'vwin' + (x.index === 0 ? ' big' : '') + (vPlace === x.index ? ' on' : '');
    const lab = document.createElement('span'); lab.className = 'lab'; lab.textContent = x.label + (x.title ? (x.playing ? ' \u00b7 Playing' : ' \u00b7 Paused') : '');
    const what = document.createElement('span'); what.className = 'what'; what.textContent = x.title || 'Nothing playing';
    const svc = document.createElement('span'); svc.className = 'svc2'; svc.textContent = x.name || '';
    r.appendChild(lab); r.appendChild(what); if (x.name) r.appendChild(svc);
    if (vPlace === x.index && (x.title || x.index > 0)) {
      const clr = document.createElement('button'); clr.type = 'button'; clr.className = 'clr'; clr.textContent = 'Clear';
      clr.onclick = async (e) => {
        e.stopPropagation(); clr.disabled = true; note.textContent = 'Clearing ' + x.label + '...';
        try { const res = await api('/video/screens', { clear: x.index }); note.textContent = res && res.ok === false ? (res.error || 'Could not clear it') : x.label + ' cleared.'; } catch (err) { note.textContent = err.message; }
        vPlace = 0; setTimeout(() => { vwinSig = ''; pollScreens(true); }, 1200);
      };
      r.appendChild(clr);
    }
    r.onclick = () => choose(x.index);
    list.appendChild(r);
  }
  if (rows.length < vMax) {
    const add = document.createElement('div'); add.setAttribute('role', 'button'); add.className = 'vwin add' + (vPlace === 'new' ? ' on' : '');
    const what = document.createElement('span'); what.className = 'what'; what.textContent = '+ Window ' + (rows.length + 1);
    const lab = document.createElement('span'); lab.className = 'lab'; lab.textContent = vPlace === 'new' ? 'Your next pick opens it' : 'Add a window';
    add.appendChild(what); add.appendChild(lab);
    add.onclick = () => choose('new');
    list.appendChild(add);
  }
}
setInterval(pollScreens, 4000); pollScreens();
// ---- more of the Watch screen (2026-10-05, "more of the watch screen items added to the companion app interface")
// Search everywhere: TMDB's titles matched to the household's services first, then the services' own search pages; read as it fills
// The view read here is the one the PC's Search draws (core search-view.ts, 2026-10-14, "tied ... so as changes are made they come to
// both"): the household's own titles, the top result, one card per work with every service that carries it, the people, the filter
// chips, and every word on them (the lines, the Play labels, the status, the headings, why there is nothing) as core gives them.
let vqToken = 0, vFilter = { genre: null, app: null, kind: null };
const readSearch = () => (vFilter.genre || vFilter.app || vFilter.kind) ? api('/video/search/view', vFilter) : api('/video/search');
async function runSearch(person) {
  const words = person ? person.name : q('#vq').value.trim(); if (!words) return;
  q('#srq').value = words;   // the sheet's own box shows the words, to change or correct them without closing it (2026-10-14)
  const box = q('#vResults'); box.innerHTML = '<p class="note">Searching for ' + words.replace(/</g, '&lt;') + '\u2026</p>'; showResults();
  const my = ++vqToken; vFilter = { genre: null, app: null, kind: null };
  try {
    await api('/video/search', person ? { person: { id: person.id, name: person.name } } : { q: words });
    for (let i = 0; i < 20 && my === vqToken; i++) {
      await new Promise((r) => setTimeout(r, i ? 1200 : 400));
      const st = await readSearch();
      if (my !== vqToken) return;
      drawResults(st, words);
      if (st.done) break;
    }
  } catch (e) { const p = document.createElement('p'); p.className = 'note'; p.textContent = e.message; box.appendChild(p); }
}
// the results sheet: opened by a search (or a Which service? question from a row), closed by its Close or by a play from it
function showResults() { const sh = q('#srSheet'); sh.scrollTop = 0; if (!sh.classList.contains('on')) { sh.classList.add('on'); sheetLock(); } }
function closeResults() { vqToken++; q('#vResults').innerHTML = ''; q('#srSheet').classList.remove('on'); sheetLock(); }
q('#srClose').onclick = closeResults;
q('#srq').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); q('#srq').blur(); const w = q('#srq').value.trim(); if (!w) return; q('#vq').value = w; q('#vq').parentElement.classList.add('has'); runSearch(); } };
// a filter chip: the same search read under the filter (the state itself untouched), as the PC's chips do
async function refilter(genre, app, kind) {
  vFilter = { genre, app, kind: kind === undefined ? vFilter.kind : kind }; const my = vqToken;
  try { const st = await readSearch(); if (my === vqToken) drawResults(st, (st && st.q) || q('#vq').value.trim()); } catch (e) { say('#verr', e.message); }
}
q('#vgo').onclick = () => runSearch();   // not the click event itself: runSearch reads its argument as a person (2026-10-14, "Tried to search from the companion app but nothing happens")
q('#vq').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); q('#vq').blur(); runSearch(); } };
// the search cleared (2026-10-06, "I need a way to clear the search on the companion app"): the words and the results go, the box keeps the focus for new words
q('#vq').oninput = () => { q('#vq').parentElement.classList.toggle('has', q('#vq').value.length > 0); if (!q('#vq').value) q('#vResults').innerHTML = ''; };
q('#vclear').onclick = () => { q('#vq').value = ''; q('#vq').parentElement.classList.remove('has'); q('#vResults').innerHTML = ''; q('#vq').focus(); };
function drawResults(st, words) {
  const box = q('#vResults'); box.innerHTML = '';
  if (!st || st.none) return;
  const L = st.layout || {}, lib = st.library || [], works = st.works || [], people = st.people || [];
  const head = (text) => { const d = document.createElement('div'); d.className = 'shead'; d.textContent = text; box.appendChild(d); };
  const note = (text) => { const p = document.createElement('p'); p.className = 'note'; p.textContent = text; box.appendChild(p); };
  head((L.heading || (st.done ? 'Results for' : 'Searching for')) + ' \u201c' + (st.q || words) + '\u201d');
  if (L.status) note(L.status);
  // the filter chips: every genre and service the results offer (from the unfiltered rows, so a press never empties the other group)
  const genres = st.genres || [], fs = st.filterServices || [], kinds = st.kinds || [];
  if (genres.length || fs.length > 1 || kinds.length > 1) {
    const row = document.createElement('div'); row.className = 'fchips';
    const chip = (label, on, go) => { const b = document.createElement('button'); b.textContent = label; if (on) b.className = 'on'; b.onclick = go; row.appendChild(b); };
    // movies or TV shows (2026-10-14, "Should also let me specify movies or TV shows in the search filters"), offered when the results hold both
    if (kinds.length > 1) { chip('Movies', vFilter.kind === 'movie', () => refilter(vFilter.genre, vFilter.app, vFilter.kind === 'movie' ? null : 'movie')); chip('TV shows', vFilter.kind === 'series', () => refilter(vFilter.genre, vFilter.app, vFilter.kind === 'series' ? null : 'series')); }
    if (genres.length) { chip('All genres', !vFilter.genre, () => refilter(null, vFilter.app)); for (const g of genres.slice(0, 12)) chip(g, vFilter.genre === g, () => refilter(vFilter.genre === g ? null : g, vFilter.app)); }
    if (fs.length > 1) { chip('All services', !vFilter.app, () => refilter(vFilter.genre, null)); for (const s of fs) chip(s.name, vFilter.app === s.app, () => refilter(vFilter.genre, vFilter.app === s.app ? null : s.app)); }
    box.appendChild(row);
  }
  // the people the words named: their work on the household's services is one press away
  const drawPeople = () => {
    if (!people.length) return;
    head('People');
    const row = document.createElement('div'); row.className = 'people';
    for (const p of people) {
      const b = document.createElement('button');
      if (p.photo) { const im = document.createElement('img'); im.alt = ''; im.src = p.photo; b.appendChild(im); }
      else { const m = document.createElement('div'); m.className = 'mono'; m.textContent = (p.name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(); b.appendChild(m); }
      const nm = document.createElement('span'); nm.textContent = p.name; b.appendChild(nm);
      if (p.known) { const k = document.createElement('span'); k.textContent = p.known; b.appendChild(k); }
      b.onclick = () => runSearch({ id: p.id, name: p.name });
      row.appendChild(b);
    }
    box.appendChild(row);
  };
  if (L.personFirst) drawPeople();
  // the top result first (2026-10-14, "let's put the top result at the actual top of the results"), then the household's own titles, then the rest
  const workPlays = (w) => (w.services || []).map((sv, i) => ({ label: ((w.card || {}).plays || [])[i] || ('Play on ' + sv.name), go: () => { closeResults(); playResult(sv.app, sv.candidate, sv.name); } }));
  const workDetails = (w) => () => { const sv0 = (w.services || [])[0]; const c = (sv0 && sv0.candidate) || {}; openDetails({ catalog: true, title: w.title, kind: w.kind || '', artwork: w.poster || w.backdrop || null, id: c.id, app: sv0 ? sv0.app : '' }); };
  const top = L.top ? works.find((w) => w.key === L.top) : null;
  if (top) box.appendChild(topCard(top, workPlays(top), workDetails(top)));
  // the household's own titles, as they type - no service asked
  if (lib.length) {
    head(L.libraryHeading || 'In your lists');
    for (const h of lib.slice(0, 16)) box.appendChild(hitCard(h.title, h.artwork, h.line || '', false, (h.services || []).map((sv, i) => ({ label: (h.plays || [])[i] || ('Play on ' + sv.name), go: () => { closeResults(); playCard(sv.facet, sv.item, sv.name); } })),
      () => { const sv0 = (h.services || [])[0]; openDetails(sv0 && sv0.item ? { item: sv0.item, service: sv0.name, facet: sv0.facet, app: sv0.app || '' } : { catalog: true, title: h.title, kind: h.kind || '', artwork: h.artwork }); }));   // the title's details from the search too (2026-10-11)
  }
  // one card per work, each service's Play with its offer
  if (!works.length) { if (L.empty) note(L.empty); }
  else {
    const rest = top ? works.filter((w) => w !== top) : works;
    if (rest.length) { head(L.restHeading || 'On your services'); for (const w of rest.slice(0, 40)) { const c = w.card || {}; box.appendChild(hitCard(w.title, w.poster || w.backdrop || null, [w.rating, c.line].filter(Boolean).join(' \u00b7 '), !!c.amber, workPlays(w), workDetails(w))); } }
  }
  if (!L.personFirst) drawPeople();
}
// the top result: the backdrop large, the facts, the rating, the overview, every service's Play, and Details
function topCard(w, plays, details) {
  const c = w.card || {};
  const el = document.createElement('div'); el.className = 'topr';
  const art = w.backdrop || w.poster; if (art) { const img = document.createElement('img'); img.alt = ''; img.src = art; if (!w.backdrop) img.className = 'poster'; el.appendChild(img); }   // a 16:9 band shows the backdrop whole; a poster standing in is contained, not cut (2026-10-14)
  const tb = document.createElement('div'); tb.className = 'tb';
  const sm = document.createElement('small'); sm.textContent = 'Top result'; tb.appendChild(sm);
  const b = document.createElement('b'); b.textContent = w.title; tb.appendChild(b);
  if (c.facts) { const f = document.createElement('div'); f.className = 'f'; f.textContent = c.facts; tb.appendChild(f); }
  if (w.rating) { const r = document.createElement('div'); r.className = 'f'; r.textContent = w.rating; tb.appendChild(r); }
  if (w.overview) { const o = document.createElement('div'); o.className = 'o'; o.textContent = w.overview; tb.appendChild(o); }
  const on = document.createElement('div'); on.className = 'on';
  for (const pl of plays) { const btn = document.createElement('button'); btn.textContent = pl.label; btn.onclick = pl.go; on.appendChild(btn); }
  const d = document.createElement('button'); d.className = 'd'; d.textContent = 'Details'; d.onclick = details; on.appendChild(d);
  tb.appendChild(on); el.appendChild(tb);
  return el;
}
function hitCard(title, art, sub, amber, plays, details) {
  const el = document.createElement('div'); el.className = 'hit';
  const img = document.createElement('img'); img.alt = ''; if (art) img.src = art; el.appendChild(img);
  const t = document.createElement('div'); t.className = 't';
  const b = document.createElement('b'); b.textContent = title; t.appendChild(b);
  if (sub) { const sp = document.createElement('span'); sp.textContent = sub; if (amber) sp.className = 'amber'; t.appendChild(sp); }
  const on = document.createElement('div'); on.className = 'on';
  if (details) { const d = document.createElement('button'); d.textContent = 'Details'; d.onclick = details; on.appendChild(d); }
  for (const pl of plays) { const btn = document.createElement('button'); btn.textContent = pl.label; btn.onclick = pl.go; on.appendChild(btn); }
  t.appendChild(on); el.appendChild(t);
  return el;
}
// Where a tapped title opens. On this phone: the title's own address on its service, opened as a link, which the phone hands to the
// service's app when it is installed (its browser otherwise). Prism plays nothing and passes no sign-in, and the link carries no
// referrer, so the service is not told the address of this page. A title Prism holds no address for can only play on the PC.
let openOn = 'pc';
try { openOn = localStorage.getItem('prism.videoOpen') === 'phone' ? 'phone' : 'pc'; } catch {}
function drawOpenOn() {
  q('#openPc').classList.toggle('on', openOn === 'pc'); q('#openPhone').classList.toggle('on', openOn === 'phone');
  q('#openNote').textContent = openOn === 'phone' ? "It opens in the service's own app on this phone, signed in as you are there. Nothing changes on the PC." : '';
}
q('#openPc').onclick = () => { openOn = 'pc'; try { localStorage.setItem('prism.videoOpen', 'pc'); } catch {} drawOpenOn(); };
q('#openPhone').onclick = () => { openOn = 'phone'; try { localStorage.setItem('prism.videoOpen', 'phone'); } catch {} drawOpenOn(); };
drawOpenOn();
function onPhone(url, title, service) {
  if (openOn !== 'phone') return false;
  if (typeof url !== 'string' || url.indexOf('https://') !== 0) { say('#verr', 'Prism has no address for ' + (title || 'this one') + (service ? ' on ' + service : '') + ', so it can only play on the PC.'); return true; }
  const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noreferrer noopener';
  document.body.appendChild(a); a.click(); a.remove();
  return true;
}
async function playCard(facet, it, service) {
  if (onPhone(it.url, it.title, service)) return;
  startVWork(it.title, service);
  try { const r = await api('/video/play', { facet, kind: it.kind || 'title', id: it.id || it.url || it.title, url: it.url, name: it.title }); if (r && r.ok === false) endVWork(r.error || 'Could not play it', false); setTimeout(pollVideo, 1500); } catch (e) { endVWork(e.message, false); }
}
async function playResult(app, candidate, service) {
  if (onPhone(candidate.url, candidate.title, service)) return;
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
// ---- playlists (2026-10-12, "Make sure I can manage playlists through the companion app"): the PC's playlists, read and changed through
// the verbs the PC's own Playlists tab uses. The list open here is the one open on the PC (one brain): a tap on a playlist opens it there too.
let plSig = '', plAt = 0, plShow = false, plPick = null;
async function pollPlaylists(gap) {
  if (gap && Date.now() - plAt < gap) return; plAt = Date.now();
  let v; try { v = await api('/playlists'); } catch (e) { say('#verr', e.message); return; }
  if (!v || v.error) { q('#vPlSt').textContent = ''; return; }
  // the section stands when the PC's Playlists tab does: a TMDB account with lists, or lists already here; the first ask after a start
  // can come back before the account's session has loaded, so it is asked again in a few seconds
  const g = v.gate || {};
  const stands = !!(g.active || g.linked || v.total);
  q('#vPlaylists').style.display = stands ? '' : 'none';
  if (!stands) { plAt = Date.now() - 26000; return; }
  q('#vPlSt').textContent = v.run ? 'Playing ' + v.run.name : v.total ? v.total + (v.total === 1 ? ' playlist' : ' playlists') : 'none yet';
  const sig = JSON.stringify([v.lists, v.open, v.run, v.undo, plShow, plPick]);
  if (sig === plSig) return; plSig = sig;
  drawPlaylists(v);
}
async function plAct(path, body) {
  let r = null; try { r = await api(path, body || {}); } catch (e) { say('#verr', e.message); }
  if (r && r.ok === false && r.error) say('#verr', r.error);
  plSig = ''; await pollPlaylists(0); return r;
}
function plBtn(label, go, cls) { const b = document.createElement('button'); b.textContent = label; b.onclick = go; if (cls) b.className = cls; return b; }
function plName(x) { return x.show ? x.show + ' S' + x.season + ' E' + x.episode : x.title; }
function drawPlaylists(v) {
  const body = q('#vPlBody'); body.innerHTML = '';
  const bar = document.createElement('div'); bar.className = 'plbar';
  if (v.undo) bar.appendChild(plBtn((v.undo.label || 'Changed') + ' \u00b7 Undo', () => plAct('/playlists/undo')));
  if (v.run) {
    const r = v.run; const n = document.createElement('p'); n.className = 'note';
    n.textContent = 'Playing ' + r.name + ': ' + (r.index || 0) + ' of ' + r.total + (r.current ? ' \u00b7 ' + plName(r.current) + (r.current.service ? ' on ' + r.current.service : '') : '');
    body.appendChild(n);
    if (r.hasPrevious) bar.appendChild(plBtn('Previous', () => plAct('/playlists/move', { dir: 'previous' })));
    if (r.hasNext) bar.appendChild(plBtn('Next', () => plAct('/playlists/move', { dir: 'next' })));
    bar.appendChild(plBtn('Stop after this', () => plAct('/playlists/stop', { mode: 'after' })));
    bar.appendChild(plBtn('Stop now', () => plAct('/playlists/stop', { mode: 'now' })));
  }
  const open = plShow && v.open;
  // linked, but the link cannot reach lists (the PC's tab says the same, 2026-10-09): the reason, and nothing to press here
  if (!open && v.gate && v.gate.linked && !v.gate.active && !v.total) {
    const n = document.createElement('p'); n.className = 'note';
    n.textContent = 'Playlists live on your TMDB account. Your TMDB key is the older v3 kind, and lists need the API read access token from the same TMDB page. Put it in Watch settings on the PC and link your account again.';
    body.appendChild(n); return;
  }
  if (!open) {
    bar.appendChild(plBtn('New playlist', async () => { const name = prompt('Name the new playlist'); if (name && name.trim()) await plAct('/playlists', { name: name.trim() }); }));
    body.appendChild(bar);
    if (!v.lists || !v.lists.length) { const n = document.createElement('p'); n.className = 'note'; n.textContent = 'No playlists yet. Make one here, or on the PC from a title\u2019s Details card.'; body.appendChild(n); return; }
    for (const l of v.lists) {
      const b = document.createElement('button'); b.className = 'item' + (v.run && v.run.listId === l.id ? ' now' : '');
      b.appendChild(document.createTextNode(l.name));
      const p = l.progress || { done: 0, total: 0 };
      const pt = document.createElement('span'); pt.className = 'pt';
      pt.textContent = !l.count ? 'Empty' : p.done + ' of ' + p.total + ' completed' + (l.resume ? ' \u00b7 next: ' + plName(l.resume) : ''); b.appendChild(pt);
      const pb = document.createElement('span'); pb.className = 'pb'; const i = document.createElement('i'); i.style.width = (p.total ? Math.round(100 * p.done / p.total) : 0) + '%'; pb.appendChild(i); b.appendChild(pb);
      b.onclick = async () => { plShow = true; plPick = null; await plAct('/playlists/open', { id: l.id }); };
      body.appendChild(b);
    }
    return;
  }
  // one playlist: its name, Play, Rename, Delete, then its items in the PC's order; a tap on an item offers what the PC's tab offers
  const head = document.createElement('div'); head.className = 'plhead';
  head.appendChild(plBtn('\u2039 Playlists', () => { plShow = false; plPick = null; plSig = ''; pollPlaylists(0); }));
  const nm = document.createElement('b'); nm.textContent = open.name; head.appendChild(nm);
  body.appendChild(head);
  const playing = v.run && v.run.listId === open.id;
  bar.appendChild(plBtn(playing ? 'Playing' : 'Play', () => plAct('/playlists/play', { id: open.id }), playing ? '' : 'go'));
  bar.appendChild(plBtn('Rename', async () => { const name = prompt('Rename ' + open.name, open.name); if (name && name.trim() && name.trim() !== open.name) await plAct('/playlists/rename', { id: open.id, name: name.trim() }); }));
  bar.appendChild(plBtn('Delete', async () => { if (confirm('Delete ' + open.name + '? Undo is offered for a minute.')) { plShow = false; plPick = null; await plAct('/playlists/delete', { id: open.id }); } }));
  body.appendChild(bar);
  const groups = open.groups || [];
  if (!groups.some((g) => (g.items || []).length)) { const n = document.createElement('p'); n.className = 'note'; n.textContent = 'Nothing in it yet. Add titles from the PC\u2019s Details cards.'; body.appendChild(n); return; }
  for (const g of groups) {
    if (g.name && groups.length > 1) { const h = document.createElement('div'); h.className = 'grp'; h.textContent = g.name; body.appendChild(h); }
    for (const it of g.items || []) {
      const b = document.createElement('button'); b.className = 'item' + (v.run && v.run.key === it.key ? ' now' : '') + (it.completed ? ' done' : '');
      b.appendChild(document.createTextNode(it.pos + '. ' + plName(it) + (it.show && it.title ? ' \u00b7 ' + it.title : '')));
      const pt = document.createElement('span'); pt.className = 'pt';
      pt.textContent = (it.completed ? 'Completed' : it.playsOn ? 'Plays on ' + it.playsOn.name : 'No signed-in service has it') + (it.excluded ? ' \u00b7 skipped' : ''); b.appendChild(pt);
      b.onclick = () => { plPick = plPick === it.key ? null : it.key; plSig = ''; drawPlaylists(v); };
      body.appendChild(b);
      if (plPick === it.key) {
        const acts = document.createElement('div'); acts.className = 'plbar';
        const ed = (op) => plAct('/playlists/edit', { id: open.id, op: Object.assign({ keys: [it.key] }, op) });
        acts.appendChild(plBtn('Play from here', () => plAct('/playlists/play', { id: open.id, key: it.key }), 'go'));
        acts.appendChild(plBtn(it.completed ? 'Mark not watched' : 'Mark watched', () => ed({ op: 'mark', done: !it.completed, keep: true })));
        if (open.manual) { acts.appendChild(plBtn('Up', () => ed({ op: 'moveBy', how: 'up' }))); acts.appendChild(plBtn('Down', () => ed({ op: 'moveBy', how: 'down' }))); acts.appendChild(plBtn('To top', () => ed({ op: 'moveBy', how: 'top' }))); }
        acts.appendChild(plBtn('Remove', () => { plPick = null; return ed({ op: 'remove' }); }));
        body.appendChild(acts);
      }
    }
  }
}
q('#vPlaylists .head').onclick = () => { q('#vPlaylists').classList.toggle('open'); if (q('#vPlaylists').classList.contains('open')) { plSig = ''; pollPlaylists(0); } };
setInterval(() => { if (tabNow === 'V') pollPlaylists(q('#vPlaylists').classList.contains('open') ? 4000 : 30000); }, 2000);
q('#vLivePanel .head').onclick = () => { q('#vLivePanel').classList.toggle('open'); if (q('#vLivePanel').classList.contains('open') && liveLast) drawLive(liveLast, liveV); };
// the lens rows (New episodes this week, Released this month, Most read on Wikipedia, The Binge ...): the Watch screen's own rows, as posters
let vLensSig = '', vLensAt = 0;
// Simple Watch on the phone (2026-10-16, "The same switch should give the phone three rows and a More button"): the PC's switch, said by core with the
// rows - Continue watching (larger), My list and The Binge; every other row behind More to watch, its state kept while the page stays open
let vMoreOpen = false;
// The Binge by genre (2026-10-16, "Maybe we should add a genre breakdown for binge? So people can drill into it"): a dropdown under its heading, All
// genres the day's row, a genre every series in it; the choice kept while the rows redraw, the genres read once a minute at most
let bingeGenre = '', bgCache = null, bgAt = 0;
async function bingeGenresGet() { if (bgCache && Date.now() - bgAt < 60000) return bgCache; bgCache = await api('/video/binge-genres'); bgAt = Date.now(); return bgCache; }
async function pollLenses() {
  if (Date.now() - vLensAt < 60000) return; vLensAt = Date.now();
  try {
    const r = await api('/video/lenses');
    const sig = JSON.stringify([!!r.simpleWatch, (r.rows || []).map((x) => [x.id, x.cards.length, x.reading])]);
    if (sig === vLensSig) return; vLensSig = sig;
    const box = q('#vLenses'); box.innerHTML = '';
    const simple = !!r.simpleWatch;
    if (document.body.classList.contains('simple') !== simple) vSig = '';   // the rows draw their marks by the mode: drawn before it was known, they are drawn again (2026-10-17)
    document.body.classList.toggle('simple', simple);
    const more = document.createElement('div'); more.style.display = vMoreOpen ? '' : 'none';
    for (const row of r.rows || []) {
      const wrap = document.createElement('div'); wrap.className = 'lens';
      const h = document.createElement('h3'); h.className = 'qh'; h.textContent = row.name + (row.reading ? ' \u00b7 still reading' : '');
      const info = document.createElement('button'); info.className = 'info'; info.textContent = 'i'; info.setAttribute('aria-label', 'About this row');
      const about = document.createElement('p'); about.className = 'about';
      // the same two sections as the PC's (i) (2026-10-14, "I'm on the companion app. Which should match"): How it's picked, then Source; a row without the plain words keeps the old line
      if (row.simple) { const part = (label, text) => { const b = document.createElement('b'); b.textContent = label; about.appendChild(b); about.appendChild(document.createTextNode(text)); }; part("How it's picked", row.simple); part('Source', (row.sourceShort || row.source || '') + (row.dataDate ? ' \u00b7 data as of ' + row.dataDate : '')); if (row.editIn) part('Where to change it', row.editIn); }
      else about.textContent = [row.counted, row.who, row.source ? 'Source: ' + row.source : '', row.dataDate ? 'As of ' + row.dataDate : ''].filter(Boolean).map((t) => t.replace(/[.]$/, '')).join('. ') + '.';
      info.onclick = () => { about.classList.toggle('on'); info.classList.toggle('on'); };
      h.appendChild(info);
      // The Binge's pencil, as on the PC's row (2026-10-15, "I see the binge on the companion app but no pencil to go to it's settings"): its limits,
      // animation, kids mode and hidden titles in the settings sheet
      if (row.id === 'the-binge') { const pen = document.createElement('button'); pen.className = 'info pen'; pen.textContent = '\u270e'; pen.setAttribute('aria-label', 'The Binge settings'); pen.onclick = () => openWs('The Binge'); h.appendChild(pen); }
      // a category's pencil (2026-10-15, "The content creator feeds in the companion app don't let me go from the feed straight to its watch settings"):
      // the settings sheet on Categories, at this one's box
      else if (String(row.id).indexOf('cat:') === 0) { const pen = document.createElement('button'); pen.className = 'info pen'; pen.textContent = '\u270e'; pen.setAttribute('aria-label', 'Edit this category'); pen.onclick = () => openWs('Categories', String(row.id).slice(4)); h.appendChild(pen); }
      wrap.appendChild(h); wrap.appendChild(about);
      const cards = document.createElement('div'); cards.className = 'cards';
      const fill = (list) => { cards.innerHTML = ''; for (const c of list) { c.lensId = row.id; cards.appendChild(lensCard(c)); } };   // the card's menu knows The Binge's cards (2026-10-15)
      fill(row.cards);
      if (row.id === 'the-binge') {
        const sel = document.createElement('select'); sel.className = 'gpick'; sel.setAttribute('aria-label', 'Genre');
        const all = document.createElement('option'); all.value = ''; all.textContent = 'All genres' + (row.total > row.cards.length ? ' (' + row.cards.length + ' of ' + row.total + ' today)' : ''); sel.appendChild(all);
        const pick = async () => {
          bingeGenre = sel.value;
          if (!bingeGenre) { fill(row.cards); return; }
          try { const g = await bingeGenresGet(); const hit = (g.genres || []).find((x) => x.genre === bingeGenre); fill(hit ? hit.cards : []); } catch (e) { say('#verr', e.message); }
        };
        sel.onchange = pick;
        bingeGenresGet().then((g) => {
          for (const x of g.genres || []) { const o = document.createElement('option'); o.value = x.genre; o.textContent = x.genre + ' (' + x.cards.length + ')'; sel.appendChild(o); }
          sel.value = bingeGenre; if (sel.value !== bingeGenre) bingeGenre = '';
          if (bingeGenre) pick();
        }).catch(() => {});
        wrap.appendChild(sel);
      }
      wrap.appendChild(cards); (simple && row.id !== 'the-binge' ? more : box).appendChild(wrap);
    }
    if (simple && more.childElementCount) {
      const t = document.createElement('button'); t.className = 'moreRows';
      const label = () => { t.textContent = vMoreOpen ? 'Fewer rows \u25b4' : 'More to watch \u25be'; };
      label();
      t.onclick = () => { vMoreOpen = !vMoreOpen; more.style.display = vMoreOpen ? '' : 'none'; label(); };
      box.appendChild(t); box.appendChild(more);
    }
  } catch (e) { say('#verr', e.message); }
}
// a lens row's card, a catalog title (TMDB's, with the services that carry it) or a service's own item; My Watchlist draws the same (2026-10-14)
function lensCard(c) {
        const b = document.createElement('button'); b.className = 'card';
        const img = document.createElement('img'); img.className = 'art'; img.alt = ''; const art = c.catalog ? c.artwork : (c.item && (c.item.poster || c.item.artwork));
        if (art) img.src = art; img.onload = () => { if (img.naturalWidth > img.naturalHeight * 1.2) img.classList.add('wide'); }; b.appendChild(img);
        if (!art) { const t = document.createElement('b'); t.textContent = c.catalog ? c.title : c.item.title; b.appendChild(t); }
        const sv0 = c.catalog ? (c.services || [])[0] : null; b.appendChild(markOf(c.catalog ? (sv0 ? sv0.app : '') : c.app, c.catalog ? (sv0 ? sv0.name : '') : c.service));
        if (!document.body.classList.contains('simple')) addScore(b, c);   // the score in the busy page only, no i button (2026-10-17, finding 20)
        if (c.catalog) {
          const svcs = c.services || [];
          b.onclick = () => { if (!svcs.length) { say('#verr', 'None of your services carries ' + c.title + '.'); return; } if (svcs.length === 1) browsePlay(svcs[0].app, c.id, c.title, svcs[0].name); else { const el = hitCard(c.title + (c.year ? ' (' + c.year + ')' : ''), art, 'Which service?', svcs.map((x) => ({ label: 'Play on ' + x.name + (x.offer ? ' \u00b7 ' + x.offer : ''), go: () => { closeResults(); browsePlay(x.app, c.id, c.title, x.name); } }))); q('#vResults').innerHTML = ''; q('#vResults').appendChild(el); showResults(); } };
        } else b.onclick = () => playCard(c.facet, c.item, c.service);
        longPress(b, c);
        return b;
}
function drawCatalog(sel, cards, empty) {
  const box = q(sel); box.innerHTML = '';
  if (!cards || !cards.length) { const n = document.createElement('p'); n.className = 'note'; n.textContent = empty; box.appendChild(n); return; }
  for (const c of cards) box.appendChild(lensCard(c));
}
async function browsePlay(app, cardId, title, service) {
  if (onPhone(null, title, service)) return;   // a catalog title is found through the service's own search on the PC: no address to open
  startVWork(title, service);
  try { const r = await api('/video/browse-play', { app, card: cardId }); if (r && r.ok === false) endVWork(r.error || 'Could not play it', false); setTimeout(pollVideo, 1500); } catch (e) { endVWork(e.message, false); }
}
// the Details sheet (2026-10-11): core's titleDetails, asked again every 1.5 s while it is working (the first read of a title fetches TMDB)
let detRun = 0;
// Send to playlist and the list, on the Details sheet (2026-10-13, "Let's add the functionality to the phone ... Need to be able to add to my
// watch list too"): the PC's own send job (a list, or New playlist), followed with its question before a large add; the TMDB watchlist while
// an account is linked, else the service's own list
// With `actions` (core's block on the details, runtime.ts withPlay, 2026-10-14, "tied ... so as changes are made they come to both"), the
// sheet draws what the PC's Details card draws: Watch on each service that carries it (the same candidate), the trailer, the list the PC
// offers (the TMDB watchlist while an account is linked, else the services' own), Send to playlist with the source the PC sends. Before
// the details arrive (or for a title TMDB has no page for) the sheet falls back to the card's own words.
async function renderDetActs(c, it, run, actions, host) {
  const acts = (host && host.acts) || q('#detActs'); acts.innerHTML = '';
  const note = (m) => { if (run === detRun) ((host && host.note) || q('#detNote')).textContent = m || ''; };
  const A = actions || null;
  const kind = it.kind || c.kind || ''; const title = it.title; const app = c.app || null;
  const sh = (host && host.sheet) || q('#detSheet');
  if (A) {
    let ons = A.watchOn || [];
    if (!host && c.catalog && ons.length) { const sv = ons[0]; const pb = q('#detPlay'); pb.textContent = 'Play on ' + sv.name; pb.style.display = ''; pb.onclick = () => { sh.classList.remove('on'); sheetLock(); playResult(sv.app, A.candidate, sv.name); }; ons = ons.slice(1); }   // the bar's Play (2026-10-15)
    for (const sv of ons) { const b = document.createElement('button'); b.textContent = 'Play on ' + sv.name; b.onclick = () => { sh.classList.remove('on'); sheetLock(); playResult(sv.app, A.candidate, sv.name); }; acts.appendChild(b); }
    if (A.trailer && A.trailer.url) { const t = document.createElement('button'); t.textContent = 'Trailer'; t.onclick = () => { const a = document.createElement('a'); a.href = A.trailer.url; a.target = '_blank'; a.rel = 'noreferrer noopener'; document.body.appendChild(a); a.click(); a.remove(); }; acts.appendChild(t); }
  }
  const sourceOf = () => { if (A && A.playlist && A.playlist.source) return A.playlist.source;
    const poster = it.poster || it.artwork || null; if (kind === 'movie') return { type: 'movie', title, tmdb: null, poster, services: app ? [{ app }] : [], year: null };
    return { type: 'series', show: title, app, services: app ? [app] : [], scope: 'all', tmdb: null, poster, year: null, orMovie: !['series', 'tv', 'episode', 'show'].includes(kind) }; };
  const send = document.createElement('button'); send.textContent = 'Send to playlist'; if (!A || (A.playlist && A.playlist.can)) acts.appendChild(send);
  const pick = document.createElement('div'); pick.className = 'plpick'; pick.style.display = 'none'; acts.appendChild(pick);
  const follow = async (job) => {
    for (let i = 0; i < 150 && run === detRun; i++) {
      let j; try { j = await api('/playlists/job', { id: job }); } catch (e) { note(e.message); return; }
      if (!j || j.error && !j.status) { note(j && j.error || 'The PC did not answer.'); return; }
      if (j.status === 'reading') { note((j.message || 'Reading') + '\u2026'); await new Promise((r) => setTimeout(r, 800)); continue; }
      if (j.status === 'confirm') { const yes = confirm(j.message || 'Add them all?'); await api('/playlists/confirm', { id: job, yes }); if (!yes) { note('Nothing added.'); return; } continue; }
      note(j.message || (j.status === 'error' ? 'That could not be added.' : 'Done.')); return;
    }
  };
  const sendTo = async (target) => { pick.style.display = 'none'; send.disabled = true; let r; try { r = await api('/playlists/send', { target, source: sourceOf() }); } catch (e) { note(e.message); send.disabled = false; return; }
    if (!r || !r.job) { note(r && r.error || 'That could not be sent to a playlist.'); send.disabled = false; return; } await follow(r.job); send.disabled = false; };
  send.onclick = async () => {
    if (pick.style.display !== 'none') { pick.style.display = 'none'; return; }
    pick.innerHTML = ''; let v; try { v = await api('/playlists'); } catch (e) { note(e.message); return; }
    if (!v || v.error) { note(v && v.error || 'Playlists are off on the PC.'); return; }
    for (const l of (v.lists || [])) { const b = document.createElement('button'); b.textContent = l.name; b.onclick = () => sendTo({ id: l.id }); pick.appendChild(b); }
    const nb = document.createElement('button'); nb.textContent = 'New playlist\u2026'; nb.onclick = () => { const name = prompt('Name the new playlist'); if (name && name.trim()) sendTo({ newName: name.trim() }); }; pick.appendChild(nb);
    pick.style.display = '';
  };
  // the list: the TMDB watchlist while linked, else the service's own - core's call when the details carry it
  const wl = document.createElement('button'); wl.style.display = 'none'; acts.appendChild(wl);
  let st = null;
  if (A && A.list) st = A.list.mode === 'watchlist' ? { active: true, on: A.list.on } : { active: false, services: A.list.services || [] };
  else if (!A) { try { st = await api('/video/watchlist', { title, kind }); } catch (e) { st = null; } }
  if (run !== detRun) return;
  if (st && st.active) {
    let on = !!st.on; const draw = () => { wl.textContent = on ? 'On my watchlist \u2713' : 'Add to my watchlist'; }; draw(); wl.style.display = '';
    // the PC places the title and writes to TMDB after it answers: asked again while it says so (up to twelve seconds), then the word is
    // its answer, not the time (2026-10-14: one read 1.5 s after the press had said "Taken off" of a title that was being added)
    wl.onclick = async () => {
      wl.disabled = true; const want = !on; wl.textContent = want ? 'Adding\u2026' : 'Taking off\u2026';
      try {
        let r2 = await api('/video/watchlist', { title, kind, on: want });
        for (let i = 0; i < 16 && r2.working; i++) { await new Promise((r) => setTimeout(r, 750)); r2 = await api('/video/watchlist', { title, kind }); }
        if (r2.on === null && !r2.error) { draw(); note('TMDB could not place ' + title + '.'); }
        else { on = !!r2.on; draw(); const fs = (r2.follow && r2.follow.services) || [];   // the services' own lists follow My Watchlist (2026-10-15)
          note(r2.error || ((on ? 'On your TMDB watchlist.' : 'Taken off your TMDB watchlist.') + (fs.length ? ' Also ' + (on ? 'adding it to ' : 'taking it off ') + fs.map((x) => x.name + '\u2019s ' + x.list).join(' and ') + '\u2026' : ''))); }
      } catch (e) { draw(); note(e.message); }
      wl.disabled = false;
      setTimeout(pollVideo, 1500); setTimeout(pollVideo, 6000);   // the row behind the sheet follows (the PC rebuilds its cards after the write, 2026-10-14)
    };
  } else if (st && st.services) {
    // the services' own lists, one button each (the PC offers the same services): the candidate is resolved to the service's copy on the PC
    for (const s of st.services) {
      if (!s.can) continue;
      const b = document.createElement('button'); b.textContent = 'Add to ' + s.name + '\u2019s ' + (s.listName || 'My List'); acts.appendChild(b);
      b.onclick = async () => { b.disabled = true; try { const r = await api('/video/list', { app: s.app, want: 'add', id: A.candidate.id, title, kind: A.candidate.kind }); note(r && r.error ? r.error : 'Adding on ' + s.name + '\u2026 it shows in My list once the service lists it.'); } catch (e) { note(e.message); b.disabled = false; } };
    }
  } else if (app && !c.catalog) {
    let li = null; try { li = await api('/video/listinfo', { app }); } catch (e) { li = null; }
    if (run !== detRun || !li || !li.can) return;
    wl.textContent = 'Add to ' + (c.service || 'the service') + '\u2019s ' + (li.name || 'My List'); wl.style.display = '';
    wl.onclick = async () => { wl.disabled = true; try { const r = await api('/video/list', { app, want: 'add', id: it.id || '', title, url: it.url || null, kind }); note(r && r.error ? r.error : 'Adding on ' + (c.service || 'the service') + '\u2026 it shows in My list once the service lists it.'); } catch (e) { note(e.message); wl.disabled = false; } };
  }
}
// a long-press (or a right-click) on a card: the PC's right-click menu on the phone (2026-10-14, "I should be able to long-press any item on watch
// on the phone companion app and get the right-click context menu from Prism"): Play, Details, and the verbs the Details sheet carries - Play on
// each service, the trailer, Send to playlist, the list - from the same actions block core gives the PC's menu. A video that is a service's
// own (not TMDB's) gets Play and Details only.
async function openCtx(c) {
  const it = c.item || { title: c.title, kind: c.kind, artwork: c.artwork, id: c.id, url: null }; const run = ++detRun;
  const sh = q('#ctxSheet'); q('#ctxTitle').textContent = 'Actions'; q('#ctxNote').textContent = ''; sh.scrollTop = 0; sh.classList.add('on');
  q('#ctxName').textContent = it.title || ''; q('#ctxSvc').textContent = c.service || ((c.services || [])[0] || {}).name || '';
  const ca = q('#ctxArt'); const art = it.poster || it.artwork || c.artwork || null; if (art) { ca.src = art; ca.style.display = ''; } else { ca.removeAttribute('src'); ca.style.display = 'none'; }
  const host = { acts: q('#ctxActs'), note: q('#ctxNote'), sheet: sh };
  // what the service allows for a Continue watching card, read first; the verb is drawn by head() after every render of the actions (which clears them)
  const wantRm = c.row === 'continue' && !c.catalog && !!c.app && !!it.id;
  q('#ctxTop').innerHTML = ''; q('#ctxTop').dataset.run = ''; q('#ctxActs').innerHTML = '';
  const stars = it.kind === 'video' && !c.catalog ? (q('#ctxRate').style.display = 'none', null) : drawRate(c, run, tmdbRefOf(c));   // a YouTube or Twitch video has no TMDB title
  let rmInfo = null; const infoP = wantRm ? api('/video/remove-info', { app: c.app }).catch(() => null) : Promise.resolve(null);
  const head = () => {
    if (run !== detRun) return;
    // the top group in a fixed order, every render: Play, Details, Remove; the verbs the Details bring land below them, so nothing shifts
    const top = [];
    if (!c.catalog) { const play = document.createElement('button'); play.className = 'go'; play.dataset.top = '1'; play.textContent = 'Play'; play.onclick = () => { sh.classList.remove('on'); detRun++; playCard(c.facet, it, c.service); }; top.push(play); }
    const det = document.createElement('button'); det.dataset.top = '1'; det.textContent = 'Details\u2026'; det.onclick = () => { sh.classList.remove('on'); openDetails(c); }; top.push(det);
    if (c.lensId === 'the-binge') { const hb = bingeHideButton(c, () => { sh.classList.remove('on'); detRun++; }); hb.dataset.top = '1'; top.push(hb); }
    if (wantRm) { const rm = document.createElement('button'); rm.dataset.rm = '1'; rm.dataset.top = '1'; if (rmInfo) rmFill(rm, rmInfo); else { rm.disabled = true; rm.textContent = 'Remove' + '\u2026'; } rmEl = rm; top.push(rm); }
    const tb = q('#ctxTop'); if (tb.dataset.run === String(run)) return; tb.dataset.run = String(run); tb.innerHTML = ''; const halves = top.filter((b) => !b.dataset.rm); if (halves.length === 1) halves[0].style.gridColumn = '1/-1'; for (const b of top) tb.appendChild(b);   // Play and Details side by side, Remove across; drawn once a menu, above the verbs that come later
  };
  // Remove from Continue Watching (2026-10-15, "I can't remove from continue watching from companion"): the PC's card menu's verb - the service's own
  // removal where its site allows one, asked once more first; hidden on the PC alone where it does not (Fandango's site cannot; its app can)
  // one press (2026-10-15, "It asks for way too many confirmations ... it knows we're removing it from the source service"): the long press that
  // opened this menu is the deliberate step, as the PC's right-click is; the service's warning, when it has one, is on the note before the press
  let rmEl = null;
  const rmFill = (rm, info) => removeFill(rm, c, it, info, () => { sh.classList.remove('on'); detRun++; }, q('#ctxNote'));
  await renderDetActs(c, it, run, null, host); head();
  rmInfo = await infoP; if (rmInfo && run === detRun && rmEl) rmFill(rmEl, rmInfo);   // the placeholder becomes the verb in its place
  if (it.kind === 'video' && !c.catalog) return;
  for (let i = 0; i < 20 && run === detRun; i++) {
    let r; try { r = await api('/video/details', { title: it.title, kind: it.kind || '', app: c.app || '' }); } catch (e) { return; }
    if (run !== detRun) return;
    if (r.status === 'working') { await new Promise((res) => setTimeout(res, 1500)); continue; }
    if (r.status === 'ready' && r.details && r.details.actions) { await renderDetActs(c, it, run, r.details.actions, host); head(); if (stars) { const m = /^tmdb:(movie|tv):(\d+)$/.exec(String((r.details.actions.candidate || {}).id || '')); if (m && +m[2] > 0) stars.set({ kind: m[1], id: +m[2] }); else stars.none(); } }
    else if (stars) stars.none();
    return;
  }
}
q('#ctxClose').onclick = () => { q('#ctxSheet').classList.remove('on'); detRun++; };
function longPress(b, c) {
  let t = null, fired = false, x0 = 0, y0 = 0;
  const off = () => { clearTimeout(t); t = null; };
  b.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; fired = false; x0 = e.clientX; y0 = e.clientY; off(); t = setTimeout(() => { t = null; fired = true; try { if (navigator.vibrate) navigator.vibrate(15); } catch (x) {} openCtx(c); }, 520); });
  b.addEventListener('pointermove', (e) => { if (t && (Math.abs(e.clientX - x0) > 8 || Math.abs(e.clientY - y0) > 8)) off(); });   // a scroll is not a press
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, off);
  b.addEventListener('click', (e) => { if (fired) { fired = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);   // the press that opened the menu does not also play
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); off(); openCtx(c); });
}
async function openDetails(c) {
  const it = c.item || { title: c.title, kind: c.kind, artwork: c.artwork, id: c.id, url: null }; const run = ++detRun; const sh = q('#detSheet'); q('#perSheet').classList.remove('on'); q('#chSheet').classList.remove('on'); sh.classList.add('on'); sh.scrollTop = 0; sheetLock();
  q('#detPlay').style.display = c.catalog ? 'none' : ''; q('#detPlay').textContent = 'Play on Prism'; q('#detActs').classList.remove('on'); q('#detMore').textContent = 'Actions'; q('#detNote').textContent = '';
  q('#detTitle').textContent = it.title; q('#detFacts').textContent = [c.service, it.subtitle].filter(Boolean).join(' \u00b7 '); q('#detRating').textContent = ''; q('#detOverview').textContent = ''; q('#detCast').innerHTML = ''; q('#detWhere').textContent = ''; q('#detChan').innerHTML = ''; q('#detTags').innerHTML = '';
  // a YouTube video's own description (2026-10-11): the channel, the length, the date, the words and the creator's tags, from its public page
  const ab = it.about;
  if (ab) {
    const mins = ab.length ? Math.round(ab.length / 60) + ' min' : ''; q('#detFacts').textContent = [c.service, ab.channel, mins, ab.published].filter(Boolean).join(' \u00b7 ');
    q('#detOverview').textContent = ab.description || '';
    // the creator's tags: each opens that tag's page on the service, the related videos by the creator's own word
    const tb = q('#detTags');
    (ab.tags || []).slice(0, 16).forEach((t, i) => { const u = ab.tagUrls && ab.tagUrls[i]; const bt = document.createElement('button'); bt.textContent = '#' + t; if (u) bt.onclick = () => { sh.classList.remove('on'); detRun++; sheetLock(); startVWork('#' + t, c.service); api('/video/play', { facet: c.facet || '', kind: 'video', id: u, url: u, name: '#' + t + ' on ' + c.service }).then((r) => { if (r && r.ok === false) endVWork(r.error || 'Could not open'); }).catch((e) => endVWork(e.message)); }; else bt.disabled = true; tb.appendChild(bt); });
    if (ab.channel) fillChannelBlock(c, ab, run);
  }
  // a plain video is the service's own, never TMDB's: no read, a film of the same name was standing in (2026-10-11)
  if (it.kind === 'video' && !c.catalog) { q('#detNote').textContent = ab ? '' : 'A video on ' + (c.service || 'its service') + '. Its channel and words arrive once its page is read.'; return; }
  q('#detNote').textContent = 'Reading the details\u2026'; const art = q('#detArt'); art.removeAttribute('src'); if (it.poster || it.artwork) art.src = it.poster || it.artwork;
  renderDetActs(c, it, run).then(() => detRemove(c, it, run));
  q('#detPlay').onclick = () => { sh.classList.remove('on'); sheetLock(); startVWork(it.title, c.service); api('/video/play', { facet: c.facet, kind: it.kind || 'title', id: it.id || it.url || it.title, url: it.url, name: it.title }).then((r) => { if (r && r.ok === false) endVWork(r.error || 'Could not play'); }).catch((e) => endVWork(e.message)); };
  for (let i = 0; i < 20 && run === detRun; i++) {
    let r; try { r = await api('/video/details', { title: it.title, kind: it.kind || '', app: c.app || '' }); } catch (e) { q('#detNote').textContent = e.message; return; }
    if (run !== detRun) return;
    if (r.status === 'working') { await new Promise((res) => setTimeout(res, 1500)); continue; }
    if (r.status !== 'ready' || !r.details) { q('#detNote').textContent = ab ? '' : (it.kind === 'video' ? 'A video on ' + (c.service || 'its service') + ', not a film or a series: TMDB has no page for it.' + (it.subtitle ? '' : '') : (r.why || 'No details for this title. It may not be on TMDB, or Prism has no TMDB key yet.')); return; }
    const d = r.details; q('#detNote').textContent = '';
    q('#detTitle').textContent = (d.title || it.title) + (d.year ? ' (' + d.year + ')' : '');
    renderDetActs(c, it, run, d.actions || null).then(() => detRemove(c, it, run));   // the PC's own verbs for this title, from core
    const A = d.actions || {}; const factsLine = [].concat(A.facts || []).concat((d.genres || []).slice(0, 3).join(', ') || []).join(' \u00b7 ');   // the PC's facts line, core's words
    q('#detFacts').textContent = factsLine; q('#detRating').textContent = A.ratingLine || '';
    if (d.poster) art.src = d.poster;
    q('#detOverview').textContent = (d.tagline ? d.tagline + ' \u2014 ' : '') + (d.overview || '');
    const cast = q('#detCast'); cast.innerHTML = '';
    for (const p of (d.cast || []).slice(0, 12)) { const cell = document.createElement('button'); const im = document.createElement('img'); im.alt = ''; if (p.photo) im.src = p.photo; cell.appendChild(im); const nm = document.createElement('span'); nm.textContent = p.name; cell.appendChild(nm); if (p.id) { cell.onclick = () => openPerson(p.id, p.name, p.photo, d.title || it.title); if (p.id === lastPersonId) cell.classList.add('here'); } cast.appendChild(cell); }
    const pv = d.providers || {}; const names = (k) => (pv[k] || []).map((o) => o.play ? o.play.name || o.name : o.name).filter(Boolean);
    const where = [];
    if (names('stream').length) where.push('Stream: ' + [...new Set(names('stream'))].join(', '));
    if (names('free').length) where.push('Free: ' + [...new Set(names('free'))].join(', '));
    if (names('rent').length || names('buy').length) where.push('Rent or buy: ' + [...new Set([...names('rent'), ...names('buy')])].join(', '));
    q('#detWhere').textContent = where.join('  \u00b7  ') + (where.length ? '  (US, as TMDB lists them)' : '');
    // Rent or buy on this phone (2026-10-14, "am I able to click a link to work on that transaction"): each store's own page for the title,
    // opened here as a link the phone hands to the store's app when it is installed, signed in as you are there. No referrer, no sign-in
    // passed, and Prism takes no part in the purchase (the PC's card shows the same address as a code for the phone to scan).
    const stores = new Map();
    for (const k of ['rent', 'buy']) for (const o of (pv[k] || [])) if (o.buy && o.buy.url && !stores.has(o.buy.url)) stores.set(o.buy.url, o);
    for (const [url, o] of stores) {
      const b = document.createElement('button'); b.textContent = 'Rent or buy on ' + ((o.play && o.play.name) || o.name);
      b.onclick = () => { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noreferrer noopener'; document.body.appendChild(a); a.click(); a.remove(); if (o.buy.note) q('#detNote').textContent = o.buy.note; };
      q('#detActs').appendChild(b);
    }
    evenGrid(q('#detActs'));
    return;
  }
  if (run === detRun) q('#detNote').textContent = 'Still reading. Try again in a moment.';
}
// the page beneath a full sheet (2026-10-14, "I'd rather this window be in the foreground, no access to scrolling behind until it is
// closed"): the body is pinned where it was scrolled and put back there on close, everything beside the open sheet is inert (no taps, no
// focus), and a touch drag outside the sheet, or on a sheet with nothing to scroll, moves nothing. On an iPhone the 2026-10-11 lock
// (body overflow hidden alone) still let the list beneath scroll.
let lockY = 0;
function sheetLock() {
  const opens = document.querySelectorAll('.sheet.full.on'), open = opens[opens.length - 1], was = document.body.classList.contains('locked');
  if (open && !was) { lockY = window.scrollY; document.body.style.top = -lockY + 'px'; document.body.classList.add('locked'); }
  else if (!open && was) { document.body.classList.remove('locked'); document.body.style.top = ''; window.scrollTo(0, lockY); }
  for (const el of [...document.body.children, ...q('main').children]) el.inert = !!open && el !== open && !el.contains(open);
}
let tx0 = 0, ty0 = 0;
document.addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t) { tx0 = t.clientX; ty0 = t.clientY; } }, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!document.body.classList.contains('locked') || !e.cancelable) return;
  const sh = e.target && e.target.closest ? e.target.closest('.sheet.full.on') : null;
  if (!sh) { e.preventDefault(); return; }
  const t = e.touches[0]; if (t && Math.abs(t.clientX - tx0) > Math.abs(t.clientY - ty0)) return;   // a sideways drag on a rail of cards is the rail's own
  if (sh.scrollHeight <= sh.clientHeight + 1) e.preventDefault();
}, { passive: false });
// two even columns: an odd one out at the end spans the row (2026-10-15, symmetry)
function evenGrid(box) { const vis = [...box.children].filter((e) => e.tagName === 'BUTTON' && e.style.display !== 'none' && !e.dataset.rm); for (const e of vis) e.style.gridColumn = ''; if (vis.length % 2) vis[vis.length - 1].style.gridColumn = '1/-1'; }
q('#detMore').onclick = () => { evenGrid(q('#detActs')); const on = q('#detActs').classList.toggle('on'); q('#detMore').textContent = on ? 'Hide actions' : 'Actions'; };
q('#detClose').onclick = () => { detRun++; q('#detSheet').classList.remove('on'); sheetLock(); };
// a person's page (2026-10-11): their films and series from TMDB, newest first, each opening its own details
let perRun = 0, perSort = 'date', perLast = null, lastPersonId = null;
function drawCredits(p, fromTitle) {
  const box = q('#perCredits'); box.innerHTML = '';
  const credits = (p.credits || []).slice().sort((a, b) => perSort === 'name' ? (a.title || '').localeCompare(b.title || '') : (b.date || '').localeCompare(a.date || ''));
  q('#perByDate').classList.toggle('on', perSort === 'date'); q('#perByName').classList.toggle('on', perSort === 'name');
  let here = null;
  for (const c of credits.slice(0, 80)) {
    const b = document.createElement('button'); b.className = 'card' + (fromTitle && c.title === fromTitle ? ' here' : '');
    const img = document.createElement('img'); img.className = 'art'; img.alt = ''; if (c.poster) img.src = c.poster; b.appendChild(img);
    const t = document.createElement('b'); t.textContent = c.title; b.appendChild(t);
    const s = document.createElement('span'); s.textContent = [c.year, c.kind === 'tv' ? 'Series' : 'Film', c.role].filter(Boolean).join(' \u00b7 '); b.appendChild(s);
    b.onclick = () => { q('#perSheet').classList.remove('on'); perRun++; sheetLock(); openDetails({ catalog: true, title: c.title, kind: c.kind === 'tv' ? 'series' : 'movie', artwork: c.poster, id: c.id }); };
    box.appendChild(b); if (b.className.includes('here')) here = b;
  }
  if (here) setTimeout(() => here.scrollIntoView({ block: 'center' }), 50);
  if (!credits.length) q('#perNote').textContent = 'TMDB lists no films or series for ' + p.name + '.';
}
q('#perByDate').onclick = () => { perSort = 'date'; try { localStorage.setItem('prism.personSort', 'date'); } catch {} if (perLast) drawCredits(perLast.p, perLast.from); };
q('#perByName').onclick = () => { perSort = 'name'; try { localStorage.setItem('prism.personSort', 'name'); } catch {} if (perLast) drawCredits(perLast.p, perLast.from); };
try { perSort = localStorage.getItem('prism.personSort') === 'name' ? 'name' : 'date'; } catch {}
async function openPerson(id, name, photo, fromTitle) {
  lastPersonId = id; const run = ++perRun; const sh = q('#perSheet'); sh.classList.add('on'); sh.scrollTop = 0; q('#detSheet').classList.remove('on'); detRun++; sheetLock();
  q('#perName').textContent = name || ''; q('#perFacts').textContent = ''; q('#perBio').textContent = ''; q('#perCredits').innerHTML = ''; q('#perNote').textContent = 'Reading\u2026';
  const art = q('#perArt'); art.removeAttribute('src'); if (photo) art.src = photo;
  for (let i = 0; i < 20 && run === perRun; i++) {
    let r; try { r = await api('/video/person', { id }); } catch (e) { q('#perNote').textContent = e.message; return; }
    if (run !== perRun) return;
    if (r.status === 'working') { await new Promise((res) => setTimeout(res, 1500)); continue; }
    if (r.status !== 'ready' || !r.person) { q('#perNote').textContent = r.why || 'No page for this person.'; return; }
    const p = r.person; q('#perNote').textContent = '';
    q('#perName').textContent = p.name; q('#perFacts').textContent = [p.known, p.born ? 'born ' + p.born : ''].filter(Boolean).join(' \u00b7 '); if (p.photo) art.src = p.photo;
    q('#perBio').textContent = p.bio || '';
    perLast = { p, from: fromTitle || null }; drawCredits(p, fromTitle || null);
    return;
  }
  if (run === perRun) q('#perNote').textContent = 'Still reading. Try again in a moment.';
}
q('#perClose').onclick = () => { perRun++; q('#perSheet').classList.remove('on'); sheetLock(); };
// the channel on the Details page itself (2026-10-11): its picture, name, facts, description and latest videos, read as the sheet opens
async function fillChannelBlock(c, ab, run) {
  const row = q('#detChan'); row.innerHTML = '';
  const h = document.createElement('div'); h.className = 'ch1'; const im = document.createElement('img'); im.alt = ''; h.appendChild(im);
  const w = document.createElement('div'); const nm = document.createElement('b'); nm.textContent = ab.channel; w.appendChild(nm); const fx = document.createElement('span'); fx.textContent = ab.channelUrl ? 'Reading the channel\u2026' : c.service; w.appendChild(fx); h.appendChild(w); row.appendChild(h);
  const bb = document.createElement('div'); bb.className = 'chb';
  if (ab.channelUrl) { const op = document.createElement('button'); op.textContent = 'Open the channel on Prism'; op.onclick = () => { q('#detSheet').classList.remove('on'); detRun++; sheetLock(); startVWork(ab.channel, c.service); api('/video/play', { facet: c.facet || '', kind: 'channel', id: ab.channelUrl, url: ab.channelUrl, name: ab.channel }).then((r) => { if (r && r.ok === false) endVWork(r.error || 'Could not open'); }).catch((e) => endVWork(e.message)); }; bb.appendChild(op); }
  row.appendChild(bb);
  if (!ab.channelUrl) return;
  let r; try { r = await api('/video/channel', { app: c.app, url: ab.channelUrl }); } catch (e) { fx.textContent = c.service; return; }
  if (run !== detRun) return;
  const ch = r && r.channel; if (!ch) { fx.textContent = c.service + ' \u00b7 the channel\u2019s page could not be read just now'; return; }
  if (ch.name) nm.textContent = ch.name; fx.textContent = [c.service, ch.handle, ch.subscribers, ch.videos].filter(Boolean).join(' \u00b7 '); if (ch.avatar) im.src = ch.avatar;
  if (ch.description) { const dd = document.createElement('div'); dd.className = 'chd'; dd.textContent = ch.description; row.insertBefore(dd, bb); }
  const latest = (ch.latest || []).filter((v) => v.url !== (c.item && c.item.url));
  if (latest.length) {
    const lbl = document.createElement('div'); lbl.className = 'chl'; lbl.textContent = 'Latest from ' + (ch.name || ab.channel); row.insertBefore(lbl, bb);
    const cards = document.createElement('div'); cards.className = 'cards';
    for (const v of latest.slice(0, 12)) {
      const b = document.createElement('button'); b.className = 'card';
      const img = document.createElement('img'); img.className = 'art'; img.alt = ''; if (v.artwork) img.src = v.artwork; img.onload = () => { if (img.naturalWidth > img.naturalHeight * 1.2) img.classList.add('wide'); }; b.appendChild(img);
      const t = document.createElement('b'); t.textContent = v.title; b.appendChild(t); if (v.subtitle) { const sp = document.createElement('span'); sp.textContent = v.subtitle; b.appendChild(sp); }
      b.onclick = () => { q('#detSheet').classList.remove('on'); detRun++; sheetLock(); startVWork(v.title, c.service); api('/video/play', { facet: c.facet || '', kind: 'video', id: v.id || v.url, url: v.url, name: v.title }).then((r2) => { if (r2 && r2.ok === false) endVWork(r2.error || 'Could not play'); }).catch((e) => endVWork(e.message)); };
      cards.appendChild(b);
    }
    row.insertBefore(cards, bb);
  }
}
// a channel's own page (2026-10-11): name, handle, counts, description, latest videos; Open the channel plays its page on Prism
let chRun = 0;
async function openChannel(app, service, name, url, facet) {
  const run = ++chRun; const sh = q('#chSheet'); sh.classList.add('on'); sh.scrollTop = 0; q('#detSheet').classList.remove('on'); detRun++; sheetLock();
  q('#chName').textContent = name || ''; q('#chFacts').textContent = service || ''; q('#chBio').textContent = ''; q('#chLatest').innerHTML = ''; q('#chNote').textContent = "Reading the channel's page\u2026"; q('#chArt').removeAttribute('src');
  q('#chOpen').onclick = () => { sh.classList.remove('on'); sheetLock(); startVWork(name, service); api('/video/play', { facet: facet || '', kind: 'channel', id: url, url, name }).then((r) => { if (r && r.ok === false) endVWork(r.error || 'Could not open'); }).catch((e) => endVWork(e.message)); };
  let r; try { r = await api('/video/channel', { app, url }); } catch (e) { q('#chNote').textContent = e.message; return; }
  if (run !== chRun) return;
  const ch = r && r.channel; if (!ch) { q('#chNote').textContent = "The channel's page could not be read just now."; return; }
  q('#chNote').textContent = ''; q('#chName').textContent = ch.name || name; q('#chFacts').textContent = [service, ch.handle, ch.subscribers, ch.videos].filter(Boolean).join(' \u00b7 '); q('#chBio').textContent = ch.description || ''; if (ch.avatar) q('#chArt').src = ch.avatar;
  const box = q('#chLatest');
  for (const v of (ch.latest || []).slice(0, 12)) {
    const b = document.createElement('button'); b.className = 'card';
    const img = document.createElement('img'); img.className = 'art'; img.alt = ''; if (v.artwork) img.src = v.artwork; img.onload = () => { if (img.naturalWidth > img.naturalHeight * 1.2) img.classList.add('wide'); }; b.appendChild(img);
    const t = document.createElement('b'); t.textContent = v.title; b.appendChild(t); if (v.subtitle) { const s = document.createElement('span'); s.textContent = v.subtitle; b.appendChild(s); }
    b.onclick = () => { sh.classList.remove('on'); sheetLock(); startVWork(v.title, service); api('/video/play', { facet: facet || '', kind: 'video', id: v.id || v.url, url: v.url, name: v.title }).then((r2) => { if (r2 && r2.ok === false) endVWork(r2.error || 'Could not play'); }).catch((e) => endVWork(e.message)); };
    box.appendChild(b);
  }
}
q('#chClose').onclick = () => { chRun++; q('#chSheet').classList.remove('on'); sheetLock(); };
// the Services section (2026-10-11): the catalog's services with their state here; Sign in / Set up opens the sign-in on the PC
let svcMusic = null, svcMusicAt = 0, svcSig = '';
async function drawServices(videoServices) {
  if (!q('#vServices').classList.contains('open')) return;
  if (Date.now() - svcMusicAt > 60000) { svcMusicAt = Date.now(); try { const m = await api('/music/quick'); svcMusic = m.sources || []; } catch { svcMusic = svcMusic || []; } }
  const rows = SERVICES.map((s) => {
    const v = (videoServices || []).find((x) => x.app === s.id); const m = (svcMusic || []).find((x) => x.app === s.id);
    const state = v ? (v.status === 'signed-in' ? 'signed in' : v.status === 'signed-out' ? 'signed out' : 'set up') : m ? (m.session === 'signed-out' ? 'signed out' : 'signed in') : 'not set up';
    return { id: s.id, name: s.name, kind: s.kind, state };
  });
  const sig = JSON.stringify(rows); if (sig === svcSig) return; svcSig = sig;
  const box = q('#vSvcBody'); box.innerHTML = '';
  const n = document.createElement('p'); n.className = 'note'; n.textContent = 'Every service Prism knows, and whether it is set up and signed in here. A sign-in opens on the PC and you type into it from the Keyboard tab.'; box.appendChild(n);
  for (const r of rows) {
    const row = document.createElement('div'); row.className = 'srow';
    const b = document.createElement('b'); b.textContent = r.name; row.appendChild(b);
    const st = document.createElement('span'); st.textContent = r.state + (r.kind ? ' \u00b7 ' + r.kind : ''); if (r.state === 'signed out') st.className = 'amber'; row.appendChild(st);
    if (r.state !== 'signed in') {
      const go = document.createElement('button'); go.textContent = r.state === 'not set up' ? 'Set up on the PC' : 'Sign in on the PC';
      go.onclick = async () => { try { await api('/ui/route', { route: 'prism://app/' + encodeURIComponent(r.id) + '/setup?signin=1' }); say('#verr', r.name + "'s sign-in is opening on the PC. Type into its fields from the Keyboard tab."); showTab('K'); } catch (e) { say('#verr', e.message); } };
      row.appendChild(go);
    }
    box.appendChild(row);
  }
}
q('#vServices .head').onclick = () => { q('#vServices').classList.toggle('open'); svcSig = ''; drawServices(lastVideoServices); };
let lastVideoServices = [];
// the service's mark on a card (2026-10-14): the PC's own cached mark, served by it; the service's monogram until it loads, or when there is none
function markOf(app, name) {
  const m = document.createElement('span'); m.className = 'mk'; if (!app) { m.style.display = 'none'; return m; }
  const words = (name || app).replace('+', ' +').split(' ').filter((w) => w && !/^(at|home)$/i.test(w));
  m.textContent = words.filter((w) => w !== '+').slice(0, 2).map((w) => w[0].toUpperCase()).join('') + (words.includes('+') ? '+' : '');
  const img = document.createElement('img'); img.alt = name || ''; img.onload = () => { m.textContent = ''; m.appendChild(img); }; img.src = '/remote/mark?app=' + encodeURIComponent(app);
  return m;
}
// '3 days ago' for a card, from a real time only (core's agoLabel, the same words)
function agoOf(at) { const s = Math.max(0, Math.round((Date.now() - at) / 1000)); if (s < 90) return 'just now'; const m = Math.round(s / 60); if (m < 90) return m + ' min ago'; const h = Math.round(m / 60); if (h < 36) return h + (h === 1 ? ' hour ago' : ' hours ago'); const d = Math.round(h / 24); if (d < 14) return d + (d === 1 ? ' day ago' : ' days ago'); const w = Math.round(d / 7); if (w < 9) return w + (w === 1 ? ' week ago' : ' weeks ago'); const mo = Math.round(d / 30); return mo + (mo === 1 ? ' month ago' : ' months ago'); }
// the TMDB score bottom right of a card, as on the PC (2026-10-15, "show the TMDB in the bottom right corner where available, just like in Prism"):
// the card's own label (star, mean, TMDB, votes) read for its mean; the star amber where the person has rated the title
function scoreOf(c) { const m = typeof c.rating === 'string' ? /\u2605\s*([0-9.]+)/.exec(c.rating) : null; return m ? m[1] : (typeof c.mean === 'number' && c.mean > 0 ? c.mean.toFixed(1) : null); }
function addScore(b, c) { const v = scoreOf(c); if (!v) return; const e = document.createElement('span'); e.className = 'sc' + (typeof c.mine === 'number' ? ' mine' : ''); e.textContent = '\u2605 ' + v; if (typeof c.rating === 'string') e.title = c.rating + (typeof c.mine === 'number' ? ' \u00b7 yours ' + c.mine : ''); b.appendChild(e); }
// a card's TMDB title, for the menu's stars: the menu rows' own match, or a catalog card's id
function tmdbRefOf(c) { if (c.tmdb && c.tmdb.id) return { kind: c.tmdb.kind === 'tv' ? 'tv' : 'movie', id: c.tmdb.id }; const m = /^tmdb:(movie|tv):(\d+)$/.exec(String(c.id || '')); return m ? { kind: m[1], id: +m[2] } : null; }
// the stars under the menu's top buttons: ten, the lit ones the person's rating; a press on the lit one takes it back (the PC's control). The row is
// drawn at once (dim until the title is known), so nothing below it moves when it fills in
function drawRate(c, run, ref) {
  const box = q('#ctxRate'); box.innerHTML = ''; box.style.display = '';
  const head = document.createElement('div'); head.className = 'rh'; box.appendChild(head);
  const row = document.createElement('div'); row.className = 'stars'; box.appendChild(row);
  let cur = typeof c.mine === 'number' ? c.mine : null, busy = !!ref;
  const btns = [];
  const draw = () => { head.textContent = !ref ? 'Your rating' : busy ? 'Your rating\u2026' : cur ? 'Your rating \u00b7 ' + cur + ' / 10' : 'Rate it on TMDB'; btns.forEach((b, i) => { b.className = cur && i < Math.round(cur) ? 'on' : ''; b.disabled = !ref || busy; }); };
  const read = async () => { for (let i = 0; i < 25 && run === detRun; i++) { let r; try { r = await api('/video/rated', ref); } catch (e) { break; } if (r && !r.working) { cur = typeof r.value === 'number' && r.value > 0 ? r.value : null; break; } await new Promise((res) => setTimeout(res, 500)); } busy = false; if (run === detRun) draw(); };
  for (let n = 1; n <= 10; n++) {
    const b = document.createElement('button'); b.textContent = String(n); b.setAttribute('aria-label', n + ' of 10');   // a number on a chip a fingertip wide, not a 16 px star (2026-10-17, the designer's pass, finding 22)
    b.onclick = async () => {
      const take = cur && Math.round(cur) === n; const want = take ? null : n; busy = true; draw();
      try { await api('/video/rate', Object.assign({ value: want }, ref)); await read(); q('#ctxNote').textContent = (want === null ? cur === null : cur === want) ? (want === null ? 'Your rating is taken back on TMDB.' : 'Rated ' + n + ' of 10 on TMDB.') : 'TMDB did not take it. Your TMDB account is linked in Watch settings.'; }
      catch (e) { busy = false; draw(); q('#ctxNote').textContent = e.message; }
    };
    btns.push(b); row.appendChild(b);
  }
  draw(); if (ref) read();
  return { set: (r) => { if (ref || !r) return; ref = r; busy = true; draw(); read(); }, none: () => { if (!ref) head.textContent = 'No TMDB match to rate.'; } };
}
// Remove from Continue Watching, sent and followed in the status line: the long-press menu's and the Details sheet's Actions (2026-10-15)
function removeFill(rm, c, it, info, close, noteEl) {
      const key = c.app + '|' + it.id;
      // marked for removal, waiting on its live broadcast's end (2026-10-16, "allow the user to undo the removal since it will still be sitting there")
      if (it.removing) {
        rm.disabled = false; rm.textContent = 'Undo removal'; rm.title = 'Keeps it in Continue Watching on ' + c.service + '.';
        rm.onclick = async () => { close(); try { await api('/video/undo-remove', { app: c.app, id: it.id }); vSig = ''; pollVideo(); endVWork(it.title + ' stays in Continue Watching.', true); } catch (e) { endVWork(e.message, false); } };
        if (noteEl && !noteEl.textContent) noteEl.textContent = "Marked for removal. Can't finish until the live broadcast ends.";
        return;
      }
      const go = async (hide) => {
        removing.add(key); close(); vSig = ''; pollVideo();
        const w = q('#verr'); w.className = 'err work on'; w.innerHTML = '<i></i>'; w.appendChild(document.createTextNode((hide ? 'Hiding ' : 'Removing ') + it.title + (hide ? ' on the PC' : ' from ' + c.service) + '\u2026'));
        try {
          if (hide) { await api('/video/hide-continue', { app: c.app, id: it.id }); endVWork(it.title + ' is hidden on the PC. ' + c.service + ' still lists it.', true); return; }
          let r = null; const t0 = Date.now();
          // followed while the PC says it is working, a queued one with the count ahead of it (2026-10-15, "It doesn't seem to be able to handle
          // multiple removals in a queue": a fixed 200 s gave up on the eighth Twitch removal while the PC was still on its way to it)
          const line = w.lastChild;
          while (Date.now() - t0 < 1800000) {
            r = await api('/video/remove-continue', { app: c.app, id: it.id, title: it.title }); if (r && (r.status === 'done' || r.status === 'failed' || r.status === 'queued')) break;
            if (line) line.textContent = 'Removing ' + it.title + ' from ' + c.service + (r && r.ahead ? ' (' + r.ahead + ' ahead of it)' : '') + '\u2026';
            await new Promise((res) => setTimeout(res, 1500));
          }
          // still live: marked for removal, back in the row at its end, finished once the broadcast ends (2026-10-16)
          if (r && r.status === 'queued') { removing.delete(key); vSig = ''; pollVideo(); endVWork(it.title + ' will be removed from ' + c.service + ' when the live broadcast ends.', true); return; }
          if (r && r.status === 'done') { endVWork('Removed ' + it.title + ' from ' + c.service + "'s Continue Watching.", true); setTimeout(() => removing.delete(key), 180000); }
          else { removing.delete(key); vSig = ''; pollVideo(); endVWork((r && r.error) || 'Could not remove ' + it.title + ' on ' + c.service + '.', false); }
        } catch (e) { removing.delete(key); vSig = ''; pollVideo(); endVWork(e.message, false); }
      };
      rm.disabled = false;
      if (info.can) { rm.textContent = 'Remove from ' + c.service; rm.title = 'Removes it on ' + c.service + ' itself, not only on the PC.'; rm.onclick = () => go(false); if (info.warning && !noteEl.textContent) noteEl.textContent = info.warning; }
      else { rm.textContent = 'Hide on the PC'; rm.title = c.service + "'s site cannot remove it; its own app can. Hidden here only."; rm.onclick = () => go(true); }
}
// the Details sheet's Remove (2026-10-15, "Where is remove from continue watching on the actions menu? I was looking at invasion on Apple"): first
// in its Actions, across the row, on a card opened from Continue watching; added again after each render of the actions (which clears them)
// Hide from The Binge (2026-10-15, "Don't Binge titles have a hide or ignore option in prism? It's not on the companion app"): the PC's right-click
// verb, kept on the PC; the row is read again without it, and Watch settings' Hidden titles brings it back
function bingeHideButton(c, close) {
  const b = document.createElement('button'); b.dataset.rm = '1'; b.textContent = 'Hide from The Binge'; b.title = 'Not shown in The Binge again. Show it again from Watch settings, The Binge.';
  b.onclick = async () => {
    close(); const w = q('#verr'); w.className = 'err work on'; w.innerHTML = '<i></i>'; w.appendChild(document.createTextNode('Hiding ' + c.title + '\u2026'));
    try { const r = await api('/video/settings/hidden', { id: c.id, on: true, title: c.title }); if (r && r.ok === false) throw new Error(r.error || 'Could not hide it'); endVWork(c.title + ' is hidden from The Binge.', true); vLensAt = 0; vLensSig = ''; pollLenses(); }
    catch (e) { endVWork(e.message, false); }
  };
  return b;
}
let detRmInfo = null;
async function detRemove(c, it, run) {
  if (c.lensId === 'the-binge' && run === detRun) { const box = q('#detActs'); if (!box.querySelector('[data-rm]')) { box.insertBefore(bingeHideButton(c, () => { q('#detSheet').classList.remove('on'); detRun++; sheetLock(); }), box.firstChild); evenGrid(box); } return; }
  if (c.row !== 'continue' || c.catalog || !c.app || !it.id || run !== detRun) return;
  if (!detRmInfo || detRmInfo.run !== run) detRmInfo = { run, p: api('/video/remove-info', { app: c.app }).catch(() => null) };
  const info = await detRmInfo.p; const box = q('#detActs');
  if (!info || run !== detRun || box.querySelector('[data-rm]')) return;
  const rm = document.createElement('button'); rm.dataset.rm = '1';
  removeFill(rm, c, it, info, () => { q('#detSheet').classList.remove('on'); detRun++; sheetLock(); }, q('#detNote'));
  box.insertBefore(rm, box.firstChild); evenGrid(box);
}
// the Details poster, larger (2026-10-15, "From the details screen on the phone, let the user tap the poster image for a zoomed in / larger view"):
// TMDB's 780-wide picture when the poster is TMDB's (the card's is 342 wide), the picture as it is otherwise; a tap anywhere closes it
q('#detArt').onclick = () => {
  const src = q('#detArt').getAttribute('src'); if (!src) return;
  const z = q('#zoomImg'); z.src = src.replace(/image[.]tmdb[.]org[/]t[/]p[/]w[0-9]+[/]/, 'image.tmdb.org/t/p/w780/'); z.onerror = () => { z.onerror = null; z.src = src; };
  q('#zoom').classList.add('on');
};
q('#zoom').onclick = () => { q('#zoom').classList.remove('on'); q('#zoomImg').removeAttribute('src'); };
const removing = new Set();   // app|id of the cards sent for removal, kept out of the row while the PC works (2026-10-15)
function drawCards(sel, cards, empty) {
  const box = q(sel); box.innerHTML = '';
  if (!cards || !cards.length) { const n = document.createElement('p'); n.className = 'note'; n.textContent = empty; box.appendChild(n); return; }
  for (const c of cards) {
    if (removing.has(c.app + '|' + (c.item && c.item.id))) continue;
    c.row = sel === '#vCont' ? 'continue' : 'list';   // the card's menu offers Remove from Continue Watching on that row alone (2026-10-15)
    const it = c.item;
    const b = document.createElement('button'); b.className = 'card';
    // marked for removal while its broadcast is still live (2026-10-16): faded at the row's end, its menu offers Undo removal
    if (it.removing) b.title = "Marked for removal. Can't finish until the live broadcast ends.";
    // TMDB's poster first, the service's own picture when there is none (2026-10-11, "a mix of formats")
    const img = document.createElement('img'); img.className = 'art'; img.alt = ''; if (it.poster || it.artwork) img.src = it.poster || it.artwork;
    // a wide picture (a service's still) fills the same tall frame as the posters, its middle, and carries the title's name over it, since a still
    // has none (2026-10-15, "2 wide format images in continue watching on the phone, should match the tall images all the others show")
    img.onload = () => { if (img.naturalWidth > img.naturalHeight * 1.2 && !b.querySelector('.nm')) { img.classList.add('still'); const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = it.title; img.after(nm); } };
    b.appendChild(img);
    // ... drawn over its picture: a trash mark and when it goes (2026-10-16, "I don't see any indication that it's scheduled to be removed")
    if (it.removing) { const pend = document.createElement('span'); pend.className = 'pend'; pend.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4zM6 8h12l-1 13H7z"/></svg>Removing when the stream ends'; b.appendChild(pend); }
    if (typeof it.progress === 'number' && it.progress > 0) { const bar = document.createElement('div'); bar.className = 'bar'; const i = document.createElement('i'); i.style.width = Math.round(Math.min(1, it.progress) * 100) + '%'; bar.appendChild(i); b.appendChild(bar); }
    // the picture carries the name (2026-10-14, "the show/movie titles show underneath as well, we dont need to do that ... show the service icon overlaid
    // on the poster image, and get rid of the service name in orange down below"): a card with no picture keeps its name; the service as its mark, top left
    if (!(it.poster || it.artwork)) { const t = document.createElement('b'); t.textContent = it.title; b.appendChild(t); }
    b.appendChild(markOf(c.app, c.service));
    // fewer marks on a 112 px card (2026-10-17, the designer's pass, finding 20): the score in the busy page only, the "ago" on Continue watching only, and no
    // i button - the long press holds Details (openDetails) with the rest
    if (!document.body.classList.contains('simple')) addScore(b, c);
    if (sel === '#vCont' && typeof c.lastWatched === 'number') { const a = document.createElement('span'); a.className = 'ago'; a.textContent = agoOf(c.lastWatched); b.appendChild(a); }   // the one time a card ever shows: Prism's own log (2026-10-14, the Last watched order)
    b.onclick = async () => { startVWork(it.title, c.service); try { const r = await api('/video/play', { facet: c.facet, kind: it.kind || 'title', id: it.id || it.url || it.title, url: it.url, name: it.title }); if (r && r.ok === false) endVWork(r.error || 'Could not play it', false); setTimeout(pollVideo, 1500); setTimeout(pollPlayers, 1500); } catch (e) { endVWork(e.message, false); } };
    longPress(b, c);
    box.appendChild(b);
  }
}
// the bar under a channel's program (2026-10-05, "a data bar in each live channel ... how much runtime and how close to complete each current show is"):
// elapsed of the program's runtime from the guide; a service that says only when it ends gets the time left and a grey bar; redrawn each poll
function liveBarSet(b, ch) {
  // the bar under a channel's program, made once and moved in place (2026-10-05, "a data bar in each live channel ... how much runtime and
  // how close to complete each current show is"): elapsed of the program's runtime from the guide; a service that says only when it ends
  // gets the time left and a grey bar
  let bar = b.querySelector('.pb'), line = b.querySelector('.pt');
  if (!ch.end) { if (bar) { bar.remove(); line.remove(); } return; }
  if (!bar) { bar = document.createElement('span'); bar.className = 'pb'; bar.appendChild(document.createElement('i')); line = document.createElement('span'); line.className = 'pt'; b.appendChild(bar); b.appendChild(line); }
  const fill = bar.firstChild, now = Date.now(), mins = (ms) => Math.max(0, Math.round(ms / 60000));
  let width = '', text = '', unk = false;
  if (ch.start && ch.end > ch.start) { const total = ch.end - ch.start, done = Math.min(total, Math.max(0, now - ch.start)); width = Math.round(100 * done / total) + '%'; text = mins(done) + ' of ' + mins(total) + ' min \u00b7 ' + mins(ch.end - now) + ' left'; }
  else { unk = true; text = mins(ch.end - now) + ' min left'; }
  if (fill.style.width !== width) fill.style.width = width;
  if (fill.className !== (unk ? 'unk' : '')) fill.className = unk ? 'unk' : '';
  if (line.textContent !== text) line.textContent = text;
}
let liveLast = null, liveV = null, liveQuery = '';
const liveNodes = new Map();   // "app|channel id" -> the channel's button, kept across redraws
function liveMatches(ch, s) {
  if (!liveQuery) return true;
  const hay = ((ch.series ? ch.series + ' ' : '') + ch.name + ' ' + (ch.now || '') + ' ' + s.name).toLowerCase();
  return hay.includes(liveQuery);
}
function liveGroupOf(ch) {
  if (ch.favorite) return { key: 'fav', label: 'Favorites' };
  if (ch.category) return { key: 'cat:' + ch.category, label: ch.category };
  const c = (ch.name || '').replace(/^(the|a|an)\s+/i, '').charAt(0).toUpperCase();
  return { key: 'az:' + (/[A-Z]/.test(c) ? c : '#'), label: /[A-Z]/.test(c) ? c : '#' };
}
function liveFill(d, s) {
  // a service's channels, made the first time its panel opens and reconciled after: the words and the bar of each move in place; the
  // groups are the service's own words (its favourites, its categories), else the first letter, and a heading is made once per group
  const body = d.querySelector('.body'); const seen = new Set();
  const groups = new Map();
  for (const ch of s.channels) { const g = liveGroupOf(ch); if (!groups.has(g.key)) groups.set(g.key, { label: g.label, items: [] }); groups.get(g.key).items.push(ch); }
  const order = [...groups.keys()].sort((a, b) => (a === 'fav' ? -1 : b === 'fav' ? 1 : a.startsWith('cat:') !== b.startsWith('cat:') ? (a.startsWith('cat:') ? -1 : 1) : a.localeCompare(b)));
  const hasFav = groups.has('fav'), hasCat = order.some((k) => k.startsWith('cat:')), lettersOnly = !hasCat && order.filter((k) => k !== 'fav').length <= 3;
  let prev = null;
  const place = (node) => { const want = prev ? prev.nextSibling : body.firstChild; if (want !== node) body.insertBefore(node, want); prev = node; };
  // the jump bar: one button per group, kept at the top of the list while it scrolls (2026-10-11, "available at any point")
  const jkey = s.app + '|#jump'; seen.add(jkey);
  let jump = liveNodes.get(jkey);
  if (!jump) { jump = document.createElement('div'); jump.className = 'jump'; liveNodes.set(jkey, jump); }
  const jsig = order.map((k) => k + ':' + (groups.get(k).items.filter((ch) => liveMatches(ch, s)).length > 0)).join(',');
  if (jump.dataset.sig !== jsig) {
    jump.dataset.sig = jsig; jump.innerHTML = '';
    for (const key of order) {
      if (!groups.get(key).items.some((ch) => liveMatches(ch, s))) continue;
      const jb = document.createElement('button'); jb.textContent = key === 'fav' ? '\u2605' : groups.get(key).label;
      jb.onclick = () => { const h = liveNodes.get(s.app + '|#' + key); if (!h) return; const y = h.getBoundingClientRect().top + window.scrollY - jump.getBoundingClientRect().height - 8; window.scrollTo({ top: y, behavior: 'smooth' }); };
      jump.appendChild(jb);
    }
  }
  jump.classList.toggle('hidden', order.filter((k) => groups.get(k).items.some((ch) => liveMatches(ch, s))).length < 2);
  place(jump);
  for (const key of order) {
    const g = groups.get(key);
    const hkey = s.app + '|#' + key; seen.add(hkey);
    let h = liveNodes.get(hkey);
    if (!h) { h = document.createElement('div'); h.className = 'grp'; liveNodes.set(hkey, h); }
    const label = key === 'fav' ? 'Favorites, as marked on ' + s.name : key.startsWith('cat:') ? g.label + ', as ' + s.name + ' files it' : g.label;
    if (h.textContent !== label) h.textContent = label;
    const shown = g.items.filter((ch) => liveMatches(ch, s)).length;
    h.classList.toggle('hidden', shown === 0 || (lettersOnly && !hasFav && key.startsWith('az:') && order.length < 2));
    place(h);
    for (const ch of g.items) {
      const ckey = s.app + '|' + ch.id; seen.add(ckey);
      let b = liveNodes.get(ckey);
      if (!b) {
        b = document.createElement('button'); b.className = 'item ch';
        const l1 = document.createElement('div'); l1.className = 'l1';
        const nm = document.createElement('span'); l1.appendChild(nm);
        const nw = document.createElement('span'); nw.className = 'now'; l1.appendChild(nw);
        b.appendChild(l1);
        b.onclick = async () => { if (onPhone(ch.url, ch.name, s.name)) return; startVWork(ch.name, s.name); try { const r = await api('/video/tune', { facet: s.facet, channel: ch.id, url: ch.url, name: ch.name }); if (r && r.ok === false) endVWork(r.error || 'Could not tune it', false); setTimeout(pollVideo, 1500); setTimeout(pollVideo, 5000); } catch (e) { endVWork(e.message, false); } };
        liveNodes.set(ckey, b);
      }
      const name = (ch.event && ch.series ? ch.series + ' \u00b7 ' : '') + ch.name;
      const l1 = b.firstChild;
      if (l1.children[0].textContent !== name) l1.children[0].textContent = name;
      if (l1.children[1].textContent !== (ch.now || '')) l1.children[1].textContent = ch.now || '';
      const tip = ch.now && ch.end ? ch.now + ' \u00b7 ' + Math.max(0, Math.round((ch.end - Date.now()) / 60000)) + ' min left' : (ch.now || '');
      if (b.title !== tip) b.title = tip;
      liveBarSet(b, ch.now ? ch : {});
      b.classList.toggle('hidden', !liveMatches(ch, s));
      place(b);
    }
  }
  for (const [key, node] of [...liveNodes]) if (key.startsWith(s.app + '|') && !seen.has(key)) { node.remove(); liveNodes.delete(key); }
}
function drawLive(live, v) {
  liveLast = live; liveV = v;
  const panel = q('#vLivePanel'); if (!panel.classList.contains('open')) return;   // nothing drawn while the panel is closed
  const box = q('#vLive');
  const note = box.querySelector('p.note'); if (note) note.remove();
  if (!live || !live.length) { for (const d of [...box.querySelectorAll('.svc')]) d.remove(); liveNodes.clear(); const n = document.createElement('p'); n.className = 'note'; n.textContent = v && v.liveReading ? 'Reading your services\' live guides\u2026' : v && v.liveCanRead ? 'No live channels read yet. They are read while this section is open; give it a moment.' : 'No live channels on your services.'; box.appendChild(n); return; }
  const keep = new Set();
  let prev = null;
  for (const s of live) {
    keep.add(s.app);
    let d = box.querySelector('.svc[data-app="' + s.app + '"]');
    if (!d) {
      d = document.createElement('div'); d.className = 'svc'; d.dataset.app = s.app;
      const head = document.createElement('button'); head.className = 'head';
      head.innerHTML = '<span class="chev">&#9654;</span><span></span><span class="st"></span>';
      head.onclick = () => { d.classList.toggle('open'); if (d.classList.contains('open') && liveLast) { const s2 = liveLast.find((x) => x.app === s.app); if (s2) liveFill(d, s2); } };
      d.appendChild(head);
      const body = document.createElement('div'); body.className = 'body'; d.appendChild(body);
    }
    const head = d.firstChild;
    if (head.children[1].textContent !== s.name) head.children[1].textContent = s.name;
    const shown = liveQuery ? s.channels.filter((ch) => liveMatches(ch, s)).length : s.channels.length;
    const st = liveQuery ? shown + ' of ' + s.channels.length : s.channels.length + (s.channels.length === 1 ? ' channel' : ' channels');
    if (head.children[2].textContent !== st) head.children[2].textContent = st;
    if (liveQuery && shown > 0 && !d.classList.contains('open')) { d.classList.add('open'); d.dataset.autoOpen = '1'; }
    if (!liveQuery && d.dataset.autoOpen) { delete d.dataset.autoOpen; d.classList.remove('open'); }
    if (d.classList.contains('open')) liveFill(d, s);
    d.style.display = liveQuery && shown === 0 ? 'none' : '';
    const want = prev ? prev.nextSibling : box.firstChild;
    if (want !== d) box.insertBefore(d, want);
    prev = d;
  }
  for (const d of [...box.querySelectorAll('.svc')]) if (!keep.has(d.dataset.app)) { for (const key of [...liveNodes.keys()]) if (key.startsWith(d.dataset.app + '|')) liveNodes.delete(key); d.remove(); }
}
q('#vLiveQ').oninput = () => { liveQuery = q('#vLiveQ').value.trim().toLowerCase(); if (liveLast) drawLive(liveLast, liveV); };
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
q('#vRetry').onclick = async () => { if (!vTile) return; q('#vRetry').disabled = true; try { await api('/tiles/' + encodeURIComponent(vTile) + '/command', { cmd: q('#vRetry').dataset.cmd || 'retry' }); } catch (e) { say('#verr', e.message); } setTimeout(() => { q('#vRetry').disabled = false; pollVideo(); }, 1500); };
q('#trkClose').onclick = () => { q('#trkSheet').classList.remove('on'); if (vTile) api('/video/tracks-done', { tile: vTile }).catch(() => {}); };
// the TMDB key, sent from the phone it was copied on (the guide's code opens this page with #tmdb). The box is emptied as soon as it is
// sent, and the key is kept nowhere on the phone
if (location.hash === '#tmdb') q('#keySheet').classList.add('on');
if (location.hash === '#settings') setTimeout(openWs, 300);   // the Watch settings sheet by address (2026-10-14)
q('#tkeyClose').onclick = () => q('#keySheet').classList.remove('on');
q('#tkeySend').onclick = async () => {
  const said = q('#tkeySaid'), v = q('#tkey').value.trim();
  said.classList.remove('bad');
  if (!v) { said.classList.add('bad'); said.textContent = 'Paste the key first.'; return; }
  q('#tkeySend').disabled = true; said.textContent = 'Sending...';
  try { await api('/tmdb/key', { apiKey: v }); q('#tkey').value = ''; said.textContent = 'Sent. Look at Prism on the PC for the next step.'; }
  catch (e) { said.classList.add('bad'); said.textContent = String((e && e.message) || e); }
  q('#tkeySend').disabled = false;
};
for (const b of document.querySelectorAll('[data-v]')) b.onclick = async () => {
  if (!vTile) { say('#verr', 'Nothing is playing in Prism'); return; }
  let c = b.dataset.v;
  if (c === 'captions' && vCanTracks) { openTracks(); return; }
  if (c === 'play') c = vPlaying ? 'pause' : 'play';
  if (c === 'mute') { c = wallMuted ? 'unmute' : 'mute'; wallMuted = !wallMuted; for (const m of document.querySelectorAll('#trMute, #vMute')) { muteLabel(m, wallMuted); m.classList.toggle('on', wallMuted); } }
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
      // a password on the wall is typed into a masked box here, so this phone's keyboard neither learns nor suggests it; a username or a
      // password goes into a sign-in form's own boxes (autocomplete username / current-password), so the phone's password manager - Bitwarden,
      // 1Password, the phone's own - offers to fill it (2026-10-15, "How do we make the keyboard allow entries from password managers like
      // Bitwarden?"). The manager fills the phone; the person presses Send, as for anything typed. A manager that fills both boxes at once
      // leaves the password waiting in its box for the wall's password field
      document.body.classList.toggle('pw', f.role === 'password');
      document.body.classList.toggle('un', f.role === 'username');
    } else {
      document.body.classList.remove('pw'); document.body.classList.remove('un');
      el.querySelector('.tl').textContent = 'Nothing is focused in Prism';
      el.querySelector('.ts').textContent = (f && f.page ? f.page + ' \u00b7 ' : '') + 'Press into a field there, then type here.';
    }
    q('#send').disabled = q('#sendEnter').disabled = !targetOn;
  } catch (e) { /* the next poll says */ }
}
pollTarget(); setInterval(pollTarget, 1500);
const box = () => document.body.classList.contains('pw') ? q('#p') : document.body.classList.contains('un') ? q('#u') : q('#t');
// Go on the phone's keyboard (the form's submit) is Send + Enter; the page never leaves
q('#kform').addEventListener('submit', (e) => { e.preventDefault(); if (targetOn) send(true); });
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
  q('#modeNote').textContent = mode === 'background' ? 'Keeps playing when you put the phone away, a few seconds behind the PC. Low delay, under the options, follows a video closely.' : 'Follows the PC closely and stops when this page is put away. Background, under the options, keeps playing with a few seconds of delay.';   // plain words, nothing about which player chose it (2026-10-17, finding 24)
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
// Prism on the PC muted while this phone listens: asked each time listening starts (2026-10-23, "make private listening automatically ask
// the user in the companion app when enabling if they would like to mute the external volume on the Prism device at the same time"; it
// had muted by itself since 2026-10-05, with a checkbox to turn that off). The sound starts first, so the tap that opens the audio is
// untouched; the question waits under the button until answered, and the PC plays on meanwhile. A mute the phone asked for goes back
// when the listen ends.
let mutedByMe = false;
function muteSay(text, hideAfterMs) {
  q('#muteNoteText').textContent = text; q('#muteAsk').style.display = 'none';
  clearTimeout(muteSay.t); if (hideAfterMs) muteSay.t = setTimeout(() => { q('#muteNote').className = 'work muteNote'; }, hideAfterMs);
}
q('#muteYes').onclick = async () => {
  if (!listening) { q('#muteNote').className = 'work muteNote'; return; }
  try { await api('/audio/private-mute', { on: true }); mutedByMe = true; muteSay('Prism on the PC is muted while this phone listens. It comes back when you stop.', 8000); }
  catch { muteSay('Could not mute Prism on the PC. Use its mute button instead.', 8000); }
};
q('#muteNo').onclick = () => { muteSay('Prism on the PC keeps playing.', 5000); };
async function muteForListen() {
  if (mutedByMe) return;   // already muted for this listen (a mode switch starts again)
  clearTimeout(muteSay.t);
  q('#muteNoteText').textContent = 'Mute Prism on the PC while this phone listens?';
  q('#muteAsk').style.display = 'flex';
  q('#muteNote').className = 'work muteNote on';
}
async function unmuteAfterListen() {
  clearTimeout(muteSay.t); q('#muteNote').className = 'work muteNote';
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
