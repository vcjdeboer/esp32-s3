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

import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { model } from "./s3_device.ts";
import { GlobalArgsSchema, replyFailed } from "./_lib/s3_base.ts";

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
    "detect",
    "flash",
    "hold",
    "ping",
    "read",
    "release",
    "send",
    "status",
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
