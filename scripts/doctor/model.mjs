/*
  The doctor's one way of asking a model (scripts/doctor, 2026-11-03): the developer's key from the environment or ~/.prism/claude.env,
  one streamed call with adaptive thinking and a JSON schema for the answer, the prompt written beside the answer as the record of what
  was sent, the usage written as the record of what it cost, and the typed errors named. ask.mjs and triage.mjs call this; nothing in
  a shipped build does (docs/network.md, "Dev tooling is not Prism").
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function loadKey() {
  if (process.env.ANTHROPIC_API_KEY) return true;
  const envFile = join(homedir(), ".prism", "claude.env");
  if (existsSync(envFile)) for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
  return !!process.env.ANTHROPIC_API_KEY;
}

/** Characters per input token, measured on the first MSN ask (2026-11-03): 471 KB sent came to 219K tokens; JSON tokenizes short. */
export const CHARS_PER_TOKEN = 2.15;

/**
 * One call. `system` is the fixed instruction, `context` the stable material cached between calls (rules, an adapter, a guide),
 * `userParts` the text blocks of this call. Writes prompt.txt and, after the call, usage.json into outDir. Returns the parsed JSON
 * answer; exits the process with a named reason on a refused key, a rate limit, a bad request, a refusal, a cut answer or non-JSON.
 */
export async function callModel({ system, context, userParts, schema, model = "claude-opus-5-5", effort = "high", maxTokens = 32000, outDir, log = console.log, dry = false, label = "ask" }) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "prompt.txt"), "SYSTEM\n" + system + "\n\nCONTEXT\n" + context + "\n\nUSER\n" + userParts.map((p) => p.text).join("\n\n"));
  if (dry) { log("dry run: the prompt is in " + join(outDir, "prompt.txt") + ", nothing sent"); process.exit(0); }
  if (!loadKey()) { log("no key: set ANTHROPIC_API_KEY or write ~/.prism/claude.env with ANTHROPIC_API_KEY=..."); process.exit(1); }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const started = Date.now();
  let message;
  try {
    const stream = client.messages.stream({
      model, max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort, format: { type: "json_schema", schema } },
      system: [
        { type: "text", text: system },
        { type: "text", text: context, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userParts }],
    });
    stream.on("text", () => process.stdout.write("."));
    message = await stream.finalMessage();
    process.stdout.write("\n");
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) log("the key was refused (401)");
    else if (e instanceof Anthropic.RateLimitError) log("rate limited (429): try again in a minute");
    else if (e instanceof Anthropic.BadRequestError) log("bad request (400): " + e.message);
    else if (e instanceof Anthropic.APIError) log("API error " + e.status + ": " + e.message);
    else log("failed: " + (e?.message ?? e));
    process.exit(1);
  }
  const u = message.usage;
  log(`${label} answered in ${((Date.now() - started) / 1000).toFixed(0)} s: ${u.input_tokens} in (${u.cache_read_input_tokens ?? 0} from cache, ${u.cache_creation_input_tokens ?? 0} written), ${u.output_tokens} out, stop ${message.stop_reason}`);
  writeFileSync(join(outDir, "usage.json"), JSON.stringify({ model, effort, at: new Date().toISOString(), usage: u, stop_reason: message.stop_reason, stop_details: message.stop_details ?? null }, null, 2));
  if (message.stop_reason === "refusal") { log("the model declined: " + JSON.stringify(message.stop_details)); process.exit(1); }
  if (message.stop_reason === "max_tokens") { log("the answer was cut at max_tokens; nothing written"); process.exit(1); }
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try { return JSON.parse(text); } catch { writeFileSync(join(outDir, "answer.txt"), text); log("the answer was not JSON; written to answer.txt"); process.exit(1); }
}
