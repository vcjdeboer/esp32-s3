/**
 * Structural tests for `@vcjdeboer/s3-device` and the shared S3 base.
 *
 * These need no board and no swamp: they check the invariants that break
 * silently in production — a method writing a spec that does not exist, a record
 * name that does not match its spec, a global argument the transport glue needs
 * going missing.
 *
 * Run: `~/.swamp/deno/deno test -A extensions/models/s3_device_test.ts`
 *
 * @module
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert@1";
import { model } from "./s3_device.ts";
import {
  configFields,
  configureLine,
  GlobalArgsSchema,
  maskSecrets,
  replyFailed,
  SendLineSchema,
  wifiFields,
  WifiPasswordSchema,
  WifiSsidSchema,
  WriteDataSchema,
} from "./_lib/s3_base.ts";

Deno.test("the model type and version are well formed", () => {
  assertEquals(model.type, "@vcjdeboer/s3-device");
  // swamp validates the version as CalVer, not semver.
  assert(
    /^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(model.version),
    `version ${model.version} is not CalVer YYYY.MM.DD.MICRO`,
  );
});

Deno.test("every base method is present", () => {
  assertEquals(Object.keys(model.methods).sort(), [
    "configure",
    "detect",
    "flash",
    "forget",
    "hold",
    "ping",
    "read",
    "release",
    "send",
    "status",
    "wifi",
    "write",
  ]);
});

Deno.test("every write targets an existing spec with a spec-prefixed record name", () => {
  const specs = Object.keys(model.resources);
  // The writes live in the shared base, which is where the methods are built.
  const src = Deno.readTextFileSync(
    new URL("./_lib/s3_base.ts", import.meta.url),
  );
  const writes = [...src.matchAll(/writeResource\(\s*"(\w+)",\s*"([\w-]+)"/g)];
  // Not one site per method: `ping` and `status` are both built by the
  // `stateMethod` factory and share its single write.
  assert(writes.length > 0, "no writeResource calls found — regex stale?");
  assert(
    writes.length <= Object.keys(model.methods).length,
    "more write sites than methods",
  );
  for (const [, spec, instance] of writes) {
    assert(specs.includes(spec), `unknown spec ${spec}`);
    assert(
      instance.startsWith(spec + "-"),
      `record ${instance} is not prefixed by its spec ${spec}`,
    );
  }
  // No declared spec is dead: every one is actually written somewhere.
  const written = new Set(writes.map(([, spec]) => spec));
  for (const spec of specs) {
    assert(written.has(spec), `spec ${spec} is declared but never written`);
  }
});

Deno.test("every resource spec declares retention and a schema", () => {
  for (const [name, spec] of Object.entries(model.resources)) {
    const s = spec as Record<string, unknown>;
    assert(s.schema, `${name} has no schema`);
    assert(s.lifetime, `${name} has no lifetime`);
    assert(
      typeof s.garbageCollection === "number",
      `${name} has no garbageCollection`,
    );
  }
});

Deno.test("global argument defaults match what the transport glue needs", () => {
  const g = GlobalArgsSchema.parse({});
  assertEquals(g.baud, 115200);
  assertEquals(g.timeoutMs, 3000);
  assertEquals(g.idleMs, 200);
  assertEquals(g.settleMs, 100);
  assertEquals(g.holder, false);
  assert(g.holderIdleTimeoutMs > 0);
  // device and denoPath are deliberately optional: auto-detect, bundled deno.
  assertEquals(g.device, undefined);
  assertEquals(g.denoPath, undefined);
});

Deno.test("a non-positive timeout is rejected rather than silently clamped", () => {
  assertThrows(() => GlobalArgsSchema.parse({ timeoutMs: 0 }));
  assertThrows(() => GlobalArgsSchema.parse({ baud: -1 }));
});

Deno.test("replyFailed reads the firmware's own ok flag", () => {
  assertEquals(replyFailed({ ok: true }), false);
  assertEquals(replyFailed({ ok: false, error: "unknown command" }), true);
  // No reply at all is a timeout, judged separately, not a failure reply.
  assertEquals(replyFailed(null), false);
  // A reply with no ok field is not a failure: some commands just report state.
  assertEquals(replyFailed({ fw: "x" }), false);
});

Deno.test("configureLine keeps any password on one line and intact", () => {
  const passwords = [
    "",
    "hunter2hunter2",
    "with space",
    'quote"and\\slash',
    "semi;colon,comma:colon",
    "line\nbreak\r",
    "ümlaut-ß-密码",
    "pipe|pipe",
  ];
  for (const pass of passwords) {
    const line = configureLine("My Net", pass);
    assert(!/[\r\n]/.test(line), `raw line break for ${JSON.stringify(pass)}`);
    assert(line.startsWith("config set {"));
    assertEquals(JSON.parse(line.slice("config set ".length)), {
      ssid: "My Net",
      pass,
    });
  }
});

Deno.test("a Wi-Fi password is empty or 8 to 63 characters, and sensitive", () => {
  assert(WifiPasswordSchema.safeParse("").success);
  assert(WifiPasswordSchema.safeParse("12345678").success);
  assert(!WifiPasswordSchema.safeParse("1234567").success);
  assert(WifiPasswordSchema.safeParse("x".repeat(63)).success);
  assert(!WifiPasswordSchema.safeParse("x".repeat(64)).success);
  // The board counts bytes: 32 two-byte letters are 64 bytes, too long;
  // four of them are 8 bytes, long enough.
  assert(!WifiPasswordSchema.safeParse("é".repeat(32)).success);
  assert(WifiPasswordSchema.safeParse("é".repeat(4)).success);
  assert(!WifiPasswordSchema.safeParse("é".repeat(3)).success);
  assertEquals(WifiPasswordSchema.meta()?.sensitive, true);
  const configure = model.methods.configure as {
    arguments: { shape: Record<string, unknown> };
  };
  assert(
    configure.arguments.shape.password === WifiPasswordSchema,
    "configure must use the sensitive password schema",
  );
});

Deno.test("an SSID is 1 to 32 characters, and sensitive", () => {
  assert(WifiSsidSchema.safeParse("x").success);
  assert(!WifiSsidSchema.safeParse("").success);
  assert(!WifiSsidSchema.safeParse("x".repeat(33)).success);
  assert(WifiSsidSchema.safeParse("é".repeat(16)).success);
  assert(!WifiSsidSchema.safeParse("é".repeat(17)).success);
  assertEquals(WifiSsidSchema.meta()?.sensitive, true);
  const configure = model.methods.configure as {
    arguments: { shape: Record<string, unknown> };
  };
  assert(
    configure.arguments.shape.ssid === WifiSsidSchema,
    "configure must use the sensitive SSID schema",
  );
});

Deno.test("send refuses config set with Wi-Fi credentials", () => {
  for (
    const line of [
      'config set {"ssid":"x","pass":"hunter2hunter2"}',
      'config set {"pass":"hunter2hunter2"}',
      '  CONFIG   SET {"\\u0073sid":"x"}',
      'config\tset {"ssid":"x"}',
      "config set",
      "config set hunter2hunter2",
      "config set [1]",
      // The board runs each line on its own, so a second line would slip by.
      'ping\nconfig set {"ssid":"x","pass":"hunter2hunter2"}',
      'status\r\nconfig set {"pass":"hunter2hunter2"}',
      "ping\nstatus",
    ]
  ) {
    assert(!SendLineSchema.safeParse(line).success, `accepted: ${line}`);
  }
  for (
    const line of [
      'config set {"profile":"example"}',
      'config set {"api":"https://example.com"}',
      "config show",
      "config forget",
      "configset",
      "ping",
      "",
    ]
  ) {
    assert(SendLineSchema.safeParse(line).success, `refused: ${line}`);
  }
  const send = model.methods.send as {
    arguments: { shape: Record<string, unknown> };
  };
  assert(
    send.arguments.shape.line === SendLineSchema,
    "send must validate its line with SendLineSchema",
  );
});

Deno.test("write refuses Wi-Fi credentials on any line", () => {
  for (
    const data of [
      'config set {"ssid":"x","pass":"hunter2hunter2"}\n',
      'ping\nconfig set {"pass":"hunter2hunter2"}\n',
      "config set\r\n",
      // s3panel drops \r before splitting, so these arrive as `config set`.
      'config\r set {"ssid":"x","pass":"hunter2hunter2"}\n',
      'con\rfig set {"pass":"hunter2hunter2"}\n',
      'config s\ret {"ssid":"x"}\n',
    ]
  ) {
    assert(!WriteDataSchema.safeParse(data).success, `accepted: ${data}`);
  }
  for (
    const data of ["ping\n", 'config set {"profile":"example"}\n', "", "\n\n"]
  ) {
    assert(WriteDataSchema.safeParse(data).success, `refused: ${data}`);
  }
  const write = model.methods.write as {
    arguments: { shape: Record<string, unknown> };
  };
  assert(
    write.arguments.shape.data === WriteDataSchema,
    "write must validate its data with WriteDataSchema",
  );
});

Deno.test("a board's refusal is recorded with the credentials masked", () => {
  assertEquals(
    maskSecrets("bad pass hunter2hunter2 for My Net", [
      "My Net",
      "hunter2hunter2",
    ]),
    "bad pass *** for ***",
  );
  assertEquals(
    maskSecrets("join: wrong password", ["x y", ""]),
    "join: wrong password",
  );
  assertEquals(maskSecrets(null, ["a"]), null);
  // Echoed inside JSON, escaped.
  assertEquals(
    maskSecrets('got {"pass":"pa\\"ss\\\\word1"}', ["x", 'pa"ss\\word1']),
    'got {"pass":"***"}',
  );
  // The SSID inside the password must not leave the rest of it showing.
  assertEquals(
    maskSecrets("pass HomeNet2024!", ["HomeNet", "HomeNet2024!"]),
    "pass ***",
  );
});

Deno.test("configure waits at least as long as the board tries to join", () => {
  const configure = model.methods.configure as {
    arguments: {
      shape: Record<string, { safeParse(v: unknown): { success: boolean } }>;
    };
  };
  assert(!configure.arguments.shape.joinMs.safeParse(5_000).success);
  assert(configure.arguments.shape.joinMs.safeParse(25_000).success);
});

Deno.test("config records name stored keys only, never values", () => {
  const f = configFields({
    ok: true,
    stored: ["ssid", "pass", "hunter2hunter2", 7],
    joined: true,
    pass: "hunter2hunter2",
  });
  assertEquals(f.stored, ["ssid", "pass"]);
  assertEquals(f.joined, true);
  assert(!JSON.stringify(f).includes("hunter2"));
  assertEquals(configFields(null), {
    stored: [],
    joined: null,
    forgotten: false,
    error: null,
  });
  assertEquals(configFields({ ok: false, error: "join" }).error, "join");
  assertEquals(configFields({ ok: true, forgotten: true }).forgotten, true);
});

Deno.test("wifiFields reads the board's report and defaults the rest", () => {
  assertEquals(
    wifiFields({
      ok: true,
      state: "badge",
      connected: true,
      ip: "10.0.0.7",
      rssi: -58,
      mac: "aa:bb:cc:dd:ee:ff",
    }),
    {
      state: "badge",
      connected: true,
      ip: "10.0.0.7",
      rssi: -58,
      mac: "aa:bb:cc:dd:ee:ff",
    },
  );
  assertEquals(wifiFields(null), {
    state: "",
    connected: false,
    ip: "",
    rssi: 0,
    mac: "",
  });
});

Deno.test("forget refuses without confirm, before touching the board", async () => {
  const forget = model.methods.forget as {
    execute: (a: unknown, c: unknown) => Promise<unknown>;
  };
  // An empty context: any attempt to reach the board would throw a TypeError.
  await assertRejects(
    () => forget.execute({ confirm: false }, {}),
    Error,
    "confirm=true",
  );
});
