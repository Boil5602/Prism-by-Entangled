import { describe, expect, it } from "vitest";
import { VPN_NOTES, VpnManager, parseWireGuardConf } from "../src/vpn.js";
import { Orchestrator } from "../src/orchestrator.js";
import { RemoteApi } from "../src/remote.js";
import type { Drivers } from "../src/drivers.js";

const KEY_A = "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=";
const KEY_B = "xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=";
const CONF = `
[Interface]
PrivateKey = ${KEY_A}
Address = 10.64.0.2/32   # assigned by the provider
DNS = 10.64.0.1

[Peer]
PublicKey = ${KEY_B}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = vpn.example.net:51820
`;

describe("parseWireGuardConf (§21)", () => {
  it("accepts a standard provider export and refuses garbage", () => {
    expect(parseWireGuardConf(CONF)).toEqual({
      privateKey: KEY_A,
      address: "10.64.0.2/32",
      peerPublicKey: KEY_B,
      endpoint: "vpn.example.net:51820",
      allowedIps: "0.0.0.0/0, ::/0",
    });
    expect(parseWireGuardConf("[Interface]\nPrivateKey = short\n[Peer]\nPublicKey = x")).toBeNull();
    expect(parseWireGuardConf("[Peer]\nPublicKey = " + KEY_B)).toBeNull(); // no interface
    expect(parseWireGuardConf("hello")).toBeNull();
    expect(parseWireGuardConf(`[Interface]\nPrivateKey=${KEY_A}\n[Other]\nX=1`)).toBeNull();
  });
});

function rig(opts: { driver?: boolean; status?: "up" | "down" } = { driver: true }) {
  const kv = new Map<string, string>();
  const log: string[] = [];
  const net = opts.driver
    ? {
        configureVpn: (c: string) => void log.push(`configure:${c.length}`),
        clearVpn: () => void log.push("clear"),
        vpnStatus: () => opts.status ?? ("up" as const),
      }
    : undefined;
  const store = { get: (k: string) => kv.get(k) ?? null, set: (k: string, v: string) => void kv.set(k, v) };
  const hooks = net
    ? { configure: net.configureVpn, clear: net.clearVpn, status: net.vpnStatus }
    : {};
  const make = () => new VpnManager(hooks, store);
  return { make, kv, log, store, net };
}

describe("VpnManager", () => {
  it("configures, reports with honest notes, restores after reboot, clears", async () => {
    const { make, log, kv } = rig();
    const v = make();
    expect(await v.status()).toMatchObject({ supported: true, configured: false, state: "unconfigured", lanExempt: true });
    expect(await v.configure("garbage")).toBe("invalid");
    expect(await v.configure(CONF)).toBe("ok");
    expect(log).toEqual([`configure:${CONF.length}`]);
    const s = await v.status();
    expect(s).toMatchObject({ configured: true, state: "up", endpoint: "vpn.example.net:51820" });
    expect(s.notes).toBe(VPN_NOTES);

    // Reboot: same store, the tunnel comes back before any tile loads.
    const again = make();
    await again.restore();
    expect(log).toEqual([`configure:${CONF.length}`, `configure:${CONF.length}`]);
    expect((await again.status()).endpoint).toBe("vpn.example.net:51820");

    await again.clear();
    expect(log.at(-1)).toBe("clear");
    expect(kv.get("vpn:conf")).toBe("");
    expect(await again.status()).toMatchObject({ configured: false, state: "unconfigured", endpoint: null });
  });

  it("is honest about a shell without a VPN driver", async () => {
    const { make } = rig({ driver: false });
    const v = make();
    expect(await v.configure(CONF)).toBe("unsupported");
    expect(await v.status()).toMatchObject({ supported: false, configured: false });
  });
});

describe("VPN via the remote API", () => {
  it("PUT/GET/DELETE /vpn", async () => {
    const { store, net } = rig();
    const drivers: Drivers = {
      surface: {
        create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
        navigate: () => {}, inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {},
        resume: () => {}, setMuted: () => {},
      },
      net,
      store,
    };
    const o = new Orchestrator(drivers);
    const api = new RemoteApi(o, store);
    const { token } = await api.mintPairing("http://frame");

    expect((await api.handle({ method: "PUT", path: "/vpn", body: '{"conf":"nope"}', token })).status).toBe(400);
    const put = await api.handle({ method: "PUT", path: "/vpn", body: JSON.stringify({ conf: CONF }), token });
    expect(put.status).toBe(200);
    expect(JSON.parse(put.body)).toMatchObject({ configured: true, state: "up" });
    const del = await api.handle({ method: "DELETE", path: "/vpn", body: null, token });
    expect(JSON.parse(del.body)).toMatchObject({ configured: false });
    const get = await api.handle({ method: "GET", path: "/vpn", body: null, token });
    expect(JSON.parse(get.body).notes).toHaveLength(VPN_NOTES.length);
  });
});
