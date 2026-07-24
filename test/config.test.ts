import { describe, expect, test } from "bun:test";

import { getIdealityHome, parseConfig } from "../src/core/config-store.js";

describe("parseConfig", () => {
  test("rejects a default identity that is not defined", () => {
    expect(() =>
      parseConfig(`{
        "version": 1,
        "defaultIdentity": "missing",
        "identities": {
          "personal": { "label": "Personal", "roots": ["~/code/personal"], "tools": {} }
        },
        "tools": {}
      }`),
    ).toThrow("Default identity 'missing' does not exist");
  });

  test("rejects identity IDs that could escape managed profile paths", () => {
    expect(() =>
      parseConfig(`{
        "version": 1,
        "defaultIdentity": "../outside",
        "identities": {
          "../outside": { "label": "Unsafe", "roots": ["/tmp/work"], "tools": {} }
        },
        "tools": {}
      }`),
    ).toThrow("Invalid identity ID '../outside'");
  });

  test("rejects logical secrets that would be exported into a shell", () => {
    expect(() =>
      parseConfig(`{
        "version": 1,
        "defaultIdentity": "sample",
        "identities": {
          "sample": {
            "label": "Sample",
            "roots": ["/workspace"],
            "tools": {
              "demo": {
                "isolation": "shell",
                "env": { "DEMO_TOKEN": { "from": "secret", "key": "sample/demo" } }
              }
            }
          }
        },
        "tools": { "demo": { "executable": "demo", "isolation": "shell" } }
      }`),
    ).toThrow("Logical secrets require process isolation");
  });

  test("accepts Bitwarden and Dashlane secret backend settings", () => {
    const base = {
      version: 1,
      defaultIdentity: "sample",
      identities: {
        sample: { label: "Sample", roots: ["/workspace"], tools: {} },
      },
      tools: {},
    };
    expect(
      parseConfig(
        JSON.stringify({
          ...base,
          secretBackend: {
            type: "bitwarden",
            appDataDirectory: "~/.config/bitwarden-sample",
          },
        }),
      ).secretBackend,
    ).toEqual({
      type: "bitwarden",
      appDataDirectory: "~/.config/bitwarden-sample",
    });
    expect(
      parseConfig(
        JSON.stringify({
          ...base,
          secretBackend: { type: "dashlane" },
        }),
      ).secretBackend,
    ).toEqual({ type: "dashlane" });
  });

  test("accepts complete network and VM execution profiles", () => {
    const parsed = parseConfig(
      JSON.stringify({
        version: 1,
        defaultIdentity: "sample",
        secretBackend: { type: "keychain" },
        networks: {
          private_eu: {
            driver: "wireguard",
            config: {
              from: "secret",
              key: "sample/wireguard/private-eu",
            },
            killSwitch: "required",
            dns: { servers: ["10.64.0.1"] },
            ipv6: "block",
            lan: "deny",
          },
          mullvad: {
            driver: "mullvad",
            killSwitch: "provider",
            location: { country: "se", city: "sto" },
          },
        },
        vms: {
          workspace: {
            driver: "lima",
            cpus: 4,
            memoryMiB: 8192,
            diskGiB: 80,
            vmType: "vz",
            mountType: "virtiofs",
            mounts: [
              {
                source: "{{root}}",
                target: "/workspace",
                writable: true,
              },
            ],
            network: "private_eu",
          },
        },
        identities: {
          sample: {
            label: "Sample",
            roots: ["/workspace"],
            execution: {
              target: "vm",
              vm: "workspace",
              network: "private_eu",
            },
            tools: {
              discord: {
                execution: {
                  target: "host",
                  network: "mullvad",
                },
              },
            },
          },
        },
        tools: {
          discord: { executable: "discord", isolation: "process" },
        },
      }),
    );

    expect(parsed.identities.sample?.execution).toEqual({
      target: "vm",
      vm: "workspace",
      network: "private_eu",
    });
    expect(parsed.vms?.workspace?.driver).toBe("lima");
    expect(parsed.networks?.private_eu?.driver).toBe("wireguard");
  });

  test("rejects missing network and VM execution references", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          version: 1,
          defaultIdentity: "sample",
          identities: {
            sample: {
              label: "Sample",
              roots: ["/workspace"],
              execution: {
                target: "vm",
                vm: "missing-vm",
                network: "missing-network",
              },
              tools: {},
            },
          },
          tools: {},
        }),
      ),
    ).toThrow("Network profile 'missing-network' does not exist");
  });

  test("requires custom strict networks to attest their kill switch", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          version: 1,
          defaultIdentity: "sample",
          networks: {
            custom: {
              driver: "custom",
              connect: ["vpn", "up"],
              disconnect: ["vpn", "down"],
              status: ["vpn", "status"],
              killSwitch: "required",
            },
          },
          identities: {
            sample: {
              label: "Sample",
              roots: ["/workspace"],
              tools: {},
            },
          },
          tools: {},
        }),
      ),
    ).toThrow(
      "Custom networks with a required kill switch must declare verifiedKillSwitch",
    );
  });
});

describe("getIdealityHome", () => {
  test("uses a single hidden directory under HOME by default", () => {
    expect(getIdealityHome({ HOME: "/home/dev" })).toBe("/home/dev/.ideality");
    expect(
      getIdealityHome({
        HOME: "/home/dev",
        XDG_CONFIG_HOME: "/home/dev/.config",
      }),
    ).toBe("/home/dev/.ideality");
    expect(
      getIdealityHome({
        HOME: "/home/dev",
        IDEALITY_HOME: "/secure/ideality",
      }),
    ).toBe("/secure/ideality");
  });
});
