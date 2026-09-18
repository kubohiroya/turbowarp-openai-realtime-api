# TurboWarp-OpenAI-Realtime-API

[English](README.md) | [日本語](README.ja.md)

A TurboWarp extension for talking with the OpenAI Realtime API by voice or text, and for letting the model call functions written in blocks. The OpenAI API key stays in a localhost relay; the browser only receives short-lived ephemeral keys.

**User guide:** [English](https://kubohiroya.github.io/turbowarp-openai-realtime-api/)

## What it does

- Connects a TurboWarp project to the OpenAI Realtime API over WebRTC, with or without the microphone.
- Sends text messages and reports the assistant's text or spoken transcript.
- Turns `define function ... export as tool` scripts into tools the model can call, and returns each script's `return` value to the model.
- Keeps the OpenAI API key in [`@kubohiroya/capability-proxy`](https://github.com/kubohiroya/capability-proxy) on localhost. The extension pairs with the relay using a one-time code and asks it for an ephemeral key per connection.

## Requirements and safety

- TurboWarp Desktop or TurboWarp Web with custom extensions enabled.
- [`@kubohiroya/capability-proxy`](https://github.com/kubohiroya/capability-proxy) running on `127.0.0.1` with the `openai` provider configured.
- A browser with WebRTC and microphone access. Output audio plays through the page.

> [!IMPORTANT]
> This extension must run unsandboxed. It needs microphone access, WebRTC, access to the localhost relay, and the VM runtime to start function scripts.
> Load extensions only from sources you trust.

- The relay endpoint must be a loopback origin such as `http://127.0.0.1:8787`. The extension refuses other hosts so the relay token never leaves the machine.
- The relay token and ephemeral keys are kept only in memory. They are never written into blocks or the `.sb3` project.
- Functions exported as tools can be called by the model with arguments it chooses. Treat every argument as untrusted input.

## Installation

### Built JavaScript

1. Download [`dist/turbowarp-openai-realtime-api.js`](dist/turbowarp-openai-realtime-api.js?raw=1).
2. Open **Extensions** in TurboWarp.
3. Choose **Custom Extension** and load the file.
4. Enable **Run without sandbox**.

The reviewed JavaScript build is committed to this repository, so users do not need Node.js or a build environment.

### npm package

Install an exact version that you have reviewed:

```bash
pnpm add --save-exact @kubohiroya/turbowarp-openai-realtime-api@0.1.0
```

Standalone bundle:

```text
node_modules/@kubohiroya/turbowarp-openai-realtime-api/dist/turbowarp-openai-realtime-api.js
```

## Quick start

1. Start `capability-proxy` with the `openai` provider (see its README) and note the eight-digit pairing code it prints.
2. Load this extension unsandboxed.
3. Run the blocks below. Say something to the microphone, or use `send text`.

```text
configure local relay [http://127.0.0.1:8787]
pair local relay with one-time code [12345678]
set instructions to [You are a friendly assistant. Answer briefly.]
connect to Realtime with microphone [on]
send text [Hello!]

when assistant finishes responding
say (last assistant response)

define function [get_score] description [Returns the player's score.] args schema [{"type":"object","properties":{}}] export as [tool]
return (join [{"score":] (join (score) [}]))
```

## Block reference

The block reference is generated from
[`src/block-definitions.json`](src/block-definitions.json). Do not edit the
generated section manually.

<!-- BEGIN GENERATED BLOCKS -->

### `configure local relay [ENDPOINT]`

Sets the loopback origin of the local capability-proxy relay. Clears any previous pairing.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `configureRelay` |
| `ENDPOINT` | String, default: `http://127.0.0.1:8787` |

### `pair local relay with one-time code [CODE]`

Exchanges the eight-digit code printed by the relay for a session token kept only in memory.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `pairRelay` |
| `CODE` | String, default: `00000000` |

### `local relay paired?`

Reports whether an unexpired relay session token is held in memory.

| Property | Value |
|---|---|
| Type | Boolean |
| Opcode | `isRelayPaired` |

### `set instructions to [TEXT]`

Sets the system instructions used by the next connection.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `setInstructions` |
| `TEXT` | String, default: `You are a friendly assistant. Answer briefly.` |

### `set voice to [VOICE]`

Sets the output voice used by the next connection.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `setVoice` |
| `VOICE` | String, default: `marin`, choices: `alloy`, `ash`, `ballad`, `cedar`, `coral`, `echo`, `marin`, `sage`, `shimmer`, `verse` |

### `set output to [MODE]`

Chooses spoken audio or text-only responses for the next connection.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `setOutputMode` |
| `MODE` | String, default: `audio`, choices: `audio`, `text` |

### `connect to Realtime with microphone [MICROPHONE]`

Mints an ephemeral key through the relay and opens a WebRTC session. Exported functions become tools.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `connect` |
| `MICROPHONE` | String, default: `on`, choices: `on`, `off` |

### `disconnect from Realtime`

Closes the WebRTC session, stops the microphone, and fails pending function calls.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `disconnect` |

### `connected to Realtime?`

Reports whether the Realtime session is open.

| Property | Value |
|---|---|
| Type | Boolean |
| Opcode | `isConnected` |

### `Realtime connection state`

Reports disconnected, connecting, connected, or failed.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `connectionState` |

### `send text [TEXT]`

Adds a user text message to the conversation and asks for a response.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `sendText` |
| `TEXT` | String, default: `Hello!` |

### `when assistant finishes responding`

Starts when a response that contains assistant text or transcript completes.

| Property | Value |
|---|---|
| Type | Hat |
| Opcode | `whenResponseDone` |

### `last assistant response`

Reports the text or audio transcript of the most recent completed assistant response.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `lastResponseText` |

### `define function [NAME] description [DESCRIPTION] args schema [SCHEMA] export as [EXPORT]`

Defines a function value. With export as tool, the model can call it; NAME, DESCRIPTION, and SCHEMA must be literal text.

| Property | Value |
|---|---|
| Type | Hat |
| Opcode | `defineFunction` |
| `NAME` | String, default: `get_score` |
| `DESCRIPTION` | String, default: `Returns the player's current score.` |
| `SCHEMA` | String, default: `{"type":"object","properties":{}}` |
| `EXPORT` | String, default: `tool`, choices: `tool`, `none` |

### `function argument [PATH]`

Inside a function, reports the argument at a dotted path such as city or items.0.name.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `functionArgument` |
| `PATH` | String, default: `city` |

### `function arguments JSON`

Inside a function, reports all arguments as JSON text.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `functionArgumentsJson` |

### `return [VALUE]`

Inside a function, returns a value and ends the script. JSON text is returned as JSON; other text is returned as a string.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `returnValue` |
| `VALUE` | String, default: `{"score":10}` |

### `last Realtime error`

Reports the most recent relay, connection, or API error, or an empty string.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `lastError` |

<!-- END GENERATED BLOCKS -->

## Important behavior

| Situation | Behavior |
|---|---|
| Relay endpoint is not a loopback origin | The block records an error in `last Realtime error`; the previous endpoint is kept. |
| Connecting before pairing, or after the relay session expired | `connect` records an error and does not contact OpenAI. |
| Invalid `define function` hats (non-literal NAME/DESCRIPTION/SCHEMA, invalid JSON schema, duplicate names, a tool without description) | `connect` records all problems and does not connect. |
| Settings changed while connected | Instructions, voice, output, and tools apply to the next connection. |
| The model calls a function | Every `define function` hat is started; only the one with the matching NAME runs. Its `return` value is sent back as JSON, then a new response is requested. |
| A function script ends without `return` | The result is `null`. |
| A function takes longer than 30 seconds | The model receives `{"error": "Function ... timed out."}`. |
| Several calls to the same function | They run one at a time in order. Different functions run concurrently. |
| The model calls a function that is not exported as a tool | The call is refused and the model receives an error. |
| Project stop | Pending function calls fail; the Realtime session stays open until `disconnect`. |
| Disconnect or connection loss | The microphone is released, audio stops, and pending function calls fail. |

## Compatibility

| Identifier | Value | Stability |
|---|---|---|
| Product name | `TurboWarp-OpenAI-Realtime-API` | Human-facing |
| Repository | `kubohiroya/turbowarp-openai-realtime-api` | Current source location |
| npm package | `@kubohiroya/turbowarp-openai-realtime-api` | Public package contract |
| Extension ID | `kubohiroyaopenairealtime` | Stored in SB3; migration required to change |
| Relay route | `POST /v1/openai/realtime/client-secrets` | Contract with `capability-proxy` |

## Development

Use Node.js 22.18.0 or newer and the pnpm version declared by `packageManager`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

To also run the integration test on a real headless TurboWarp VM, point `SCRATCH_VM_PATH` at a TurboWarp `scratch-vm` checkout:

```bash
SCRATCH_VM_PATH=/path/to/TurboWarp/scratch-vm pnpm test
```

## License

[Mozilla Public License 2.0](LICENSE) (SPDX: `MPL-2.0`).
