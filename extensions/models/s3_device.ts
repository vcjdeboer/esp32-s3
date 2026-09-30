/**
 * `@vcjdeboer/s3-device` — a plain ESP32-S3 driven from swamp over USB serial.
 *
 * The board owns its own logic and answers a JSON line protocol: one command
 * line in, one JSON object out. This model type knows nothing about what the
 * board is attached to, which is the point — it works for a bare S3, one with
 * sensors, or one with a screen. Every exchange lands in the datastore with an
 * explicit outcome, so a run is auditable after the fact.
 *
 * Methods: `detect`, `ping`, `status`, `send`, `write`, `read`, `hold`,
 * `release`, `flash`, `wifi`, `configure`, `forget`. Firmware-specific
 * commands go through `send`; a model type that
 * wants first-class methods for them should build on `_lib/s3_base.ts` the way
 * `@vcjdeboer/s3-panel` does for its screen.
 *
 * Turn `holder` on for anything interactive. Without it each method opens and
 * closes the port, so a reply that lands after the close is lost.
 *
 * Verified 2026-09-26 against a Guition JC3248W535 (ESP32-S3 N16R8) running the
 * `s3panel` firmware, over its native USB-Serial/JTAG port.
 *
 * @module
 */

import {
  baseMethods,
  baseResources,
  GlobalArgsSchema,
} from "./_lib/s3_base.ts";

/** Model definition for an ESP32-S3 speaking a JSON line protocol. */
export const model = {
  type: "@vcjdeboer/s3-device",
  version: "2026.09.30.1",
  globalArguments: GlobalArgsSchema,
  upgrades: [
    {
      toVersion: "2026.09.29.1",
      description:
        "Shared base synced with @vcjdeboer/s3-panel (holder event buffer, drain-events); global arguments unchanged",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.09.30.1",
      description:
        "Adds wifi, configure and forget; send refuses Wi-Fi credentials; global arguments unchanged",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
  ],
  resources: baseResources(),
  methods: baseMethods(),
};
