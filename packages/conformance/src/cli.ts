#!/usr/bin/env node
/**
 * prism-conformance <baseUrl> <token> <bundle.json>
 *
 * Drives a live shell through the remote API (§6) and reports whether it
 * meets the observable contracts (§23). The bundle file is the dashboard
 * document (or bundle) the device was loaded with — the kit computes
 * reference layouts from it with the same prism-core the shells embed.
 */

import { readFileSync } from "node:fs";
import type { DashboardBundle, DashboardDocument } from "prism-core";
import { formatReport, runConformance, type Transport } from "./checks.js";

const [baseUrl, token, bundlePath] = process.argv.slice(2);
if (!baseUrl || !token || !bundlePath) {
  console.error("usage: prism-conformance <baseUrl> <token> <bundle.json>");
  process.exit(2);
}

const parsed = JSON.parse(readFileSync(bundlePath, "utf8")) as
  | DashboardDocument
  | DashboardBundle;
const bundle: DashboardBundle =
  "dashboards" in parsed ? parsed : { dashboards: [parsed] };

const base = baseUrl.replace(/\/$/, "");
const transport: Transport = async (method, path, body, tok) => {
  const res = await fetch(base + path, {
    method,
    headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    ...(body !== null ? { body } : {}),
  });
  return { status: res.status, body: await res.text() };
};

const results = await runConformance(transport, token, bundle);
console.log(formatReport(results));
process.exit(results.every((r) => r.pass) ? 0 : 1);
