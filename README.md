# @vcjdeboer/esp32-s3

Drive an ESP32-S3 from [swamp](https://github.com/swamp-club/swamp) over USB
serial, and keep every exchange as versioned data.

One model type, `@vcjdeboer/s3-device`. It assumes only a **JSON line
protocol**: the host writes one command line, the board answers with exactly one
JSON object on one line. Nothing about sensors, screens or radios is baked in,
so the same type serves a bare S3 and a loaded one. Firmware-specific commands
go through `send`; a model type that wants first-class methods for them builds
on the same shared base, as `@vcjdeboer/s3-panel` does for its screen.

## Why a model instead of a shell script

The board is a resource with state worth keeping. Every method writes a record
carrying `outcome` (`ok`, `error`, `timeout`), `observedAt` and `elapsedMs`, so a
failed run leaves evidence rather than a lost terminal buffer. A timeout is data,
not just an exception: the partial bytes are recorded before the error is thrown.

## Install

```bash
swamp extension pull @vcjdeboer/esp32-s3
swamp model create @vcjdeboer/s3-device s3
```

## Configure

All global arguments are optional. The defaults suit a board on native USB-CDC.

| Argument | Default | Purpose |
| --- | --- | --- |
| `device` | auto-detect | `/dev/cu.usbmodemXXXX` on macOS, `/dev/ttyACM0` on Linux. Pin it when more than one board is attached. |
| `baud` | `115200` | Ignored by native USB-CDC; matters for UART bridges. |
| `timeoutMs` | `3000` | Hard cap on waiting for a reply. |
| `idleMs` | `200` | End a reply once bytes arrived and the line went quiet. |
| `settleMs` | `100` | Discard stale bytes just after opening the port. |
| `holder` | `false` | Keep the port open between calls. **Turn this on.** |
| `holderIdleTimeoutMs` | `900000` | The holder exits after this long idle. |
| `denoPath` | bundled | Deno used to run the serial worker. |

Leave `holder` on for anything interactive. Without it every method opens and
closes the port, so a reply that arrives after the close is lost — which makes a
separate `write` then `read` pair useless.

## Methods

| Method | What it does | Record |
| --- | --- | --- |
| `detect` | List serial nodes without opening any, and say which one this instance would use | `devices-host` |
| `ping` | Ask the board to identify itself | `state-latest` |
| `status` | Read the board's self-reported status | `state-latest` |
| `send` | Send any command line, record the single JSON reply | `exchange-latest` |
| `write` | Write bytes, await nothing | `sent-latest` |
| `read` | Listen for a window and record what the board printed | `capture-latest` |
| `hold` | Start the detached worker that holds the port open | `holder-current` |
| `release` | Close the port and let the worker exit | `holder-current` |
| `wifi` | Read the board's Wi-Fi link (`wifi status`): state, connected, ip, rssi, mac | `wifi-latest` |
| `configure` | Store Wi-Fi credentials (`config set`); the board joins before saving. The password is sensitive: pass it from a vault expression | `config-latest` (key names only) |
| `forget` | Factory-reset the board's stored settings (`config forget`); needs `confirm=true` | `config-latest` |

`write` sends its `data` **verbatim** — escape sequences are not decoded, so pass
a real newline rather than a backslash followed by `n`.

Release the holder before flashing the board: a held port blocks the upload.

## Use

```bash
swamp model method run s3 hold
swamp model method run s3 ping
swamp model method run s3 send --input line=status
swamp data get s3 exchange-latest --json | jq .content
swamp model method run s3 release
```

## Firmware contract

Answer one JSON object per command line, and include `ok`:

```json
{"ok":true,"fw":"my-firmware 0.1"}
```

A reply with `"ok":false` is recorded as `outcome=error` while the exchange
itself still counts as having happened. `ping` and `status` are the two commands
this type expects by name; everything else is yours. Firmware with Wi-Fi also
answers `wifi status`, `config set <json>` (`ssid`, `pass`; validate before
saving, reply with the names stored, never the values) and `config forget` for
the three Wi-Fi methods; firmware without them answers `unknown command`, which
these methods report as an error.

A reference firmware lives in the `esp32` repo under `firmware-s3/`.

## Licence

MIT.
