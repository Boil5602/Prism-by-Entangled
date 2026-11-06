/* Prism — "report an ad that slipped through" (console fallback for the
   built-in chip). Paste this whole thing into the browser DevTools Console
   (F12 -> Console) on the page with the ad, press Enter. A small "⚑ Report ad"
   chip appears bottom-left: click it, then click the ad. A JSON report is
   printed and copied to your clipboard — paste it back to Claude. No keyboard
   shortcut (Windows/Snagit/Copilot have claimed every usable chord); pure
   mouse. A full-viewport catcher reads the element under your click even when
   the ad is a cross-origin iframe. The extension has this chip built in. */
(() => {
  const inV = n => { while (n) { if (n.hasAttribute && n.hasAttribute('data-prism-veil')) return true; n = n.parentElement; } return false; };
  const host = n => { try { return n.tagName === 'IFRAME' && n.src ? new URL(n.src).host : ''; } catch (e) { return ''; } };
  const d = n => { const r = n.getBoundingClientRect(); const a = []; try { for (const x of n.attributes) if (/^(data-ad|data-google|data-slot|data-adunit|aria-label|name)$/i.test(x.name)) a.push(x.name + '=' + ('' + x.value).slice(0, 48)); } catch (e) {} return { tag: n.tagName, id: (n.id || '').slice(0, 48), cls: (n.className && n.className.toString ? n.className.toString() : '').slice(0, 90), w: Math.round(r.width), h: Math.round(r.height), iframeHost: host(n), attrs: a }; };
  const P = el => { const chain = []; let n = el, i = 0; while (n && n !== document.body && i < 9) { chain.push(d(n)); n = n.parentElement; i++; } let label = null, p = el, k = 0; while (p && k < 6) { const h = [...p.querySelectorAll('*')].find(x => { const t = (x.firstChild && x.firstChild.nodeType === 3) ? (x.textContent || '').trim() : ''; return t.length < 30 && /^(ad|advertisement|sponsored|ad\s*\d+\s*of\s*\d+|paid partner content|paid content|promoted stories|sponsored stories)$/i.test(t); }); if (h) { label = (h.textContent || '').trim().slice(0, 30); break; } p = p.parentElement; k++; } return { site: location.hostname, url: location.href.slice(0, 120), coveredByPrism: inV(el), nearbyAdLabel: label, target: d(el), chain }; };
  let pick = null;
  const toast = (m, c) => { const t = document.createElement('div'); t.setAttribute('data-prism-veil', '1'); t.textContent = m; t.style.cssText = 'position:fixed;left:12px;bottom:46px;z-index:2147483647;background:#12131aee;color:' + (c || '#F0A83C') + ';font:600 12px/1.45 system-ui,sans-serif;padding:8px 12px;border-radius:8px;border:1px solid #ffffff22;max-width:62vw;pointer-events:none'; document.documentElement.appendChild(t); setTimeout(() => t.remove(), 4600); };
  const report = el => { const j = JSON.stringify(P(el), null, 2); console.log('%cPRISM AD REPORT — copy this to Claude:', 'color:#F0A83C;font-weight:bold;font-size:13px'); console.log(j); navigator.clipboard && navigator.clipboard.writeText(j).then(() => {}, () => {}); const r = P(el); toast('✓ Ad captured' + (r.nearbyAdLabel ? ' “' + r.nearbyAdLabel + '”' : '') + ' — copied. Paste it to Claude.', '#7fd08a'); };
  const exit = () => { if (pick) { pick.remove(); pick = null; } chip.textContent = '⚑ Report ad'; };
  const enter = () => { if (pick) { exit(); return; } const c = document.createElement('div'); c.setAttribute('data-prism-veil', '1'); c.style.cssText = 'position:fixed;inset:0;z-index:2147483646;cursor:crosshair;background:#0b0c1410'; c.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); const x = e.clientX, y = e.clientY; c.style.pointerEvents = 'none'; const el = document.elementFromPoint(x, y); c.style.pointerEvents = ''; exit(); if (el) report(el); else toast("Couldn't read that spot — try again"); }, true); document.documentElement.appendChild(c); pick = c; chip.textContent = '✕ Cancel'; toast('Click the ad to report it · Esc to cancel'); };
  addEventListener('keydown', e => { if (e.key === 'Escape' && pick) exit(); }, true);
  const chip = document.createElement('button'); chip.setAttribute('data-prism-veil', '1'); chip.textContent = '⚑ Report ad';
  chip.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147483647;background:#12131abb;color:#c9cbd6;font:600 11px/1 system-ui,sans-serif;padding:7px 10px;border:1px solid #ffffff22;border-radius:8px;cursor:pointer;opacity:.55';
  chip.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); enter(); }, true);
  document.documentElement.appendChild(chip);
  console.log('%cPRISM: click the ⚑ chip (bottom-left), then click the ad.', 'color:#F0A83C;font-weight:bold;font-size:13px');
})();
