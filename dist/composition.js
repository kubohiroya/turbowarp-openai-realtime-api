import { createNamedFunctions } from "@kubohiroya/turbowarp-named-functions/composition";
//#region src/realtime-session.ts
/**
* Conversation logic over a transport: sending user text, collecting assistant output, and
* answering function calls with `function_call_output` followed by one `response.create`.
*/
var RealtimeSession = class {
	constructor(hooks) {
		this.hooks = hooks;
		this.stateValue = "disconnected";
		this.transport = null;
		this.generation = 0;
	}
	get state() {
		return this.stateValue;
	}
	async open(transport, clientSecret, microphone) {
		this.close();
		const generation = ++this.generation;
		this.transport = transport;
		this.setState("connecting");
		try {
			await transport.connect({
				clientSecret,
				microphone,
				onEvent: (event) => {
					if (generation === this.generation) this.handleEvent(event);
				},
				onClose: (reason) => {
					if (generation !== this.generation) return;
					this.transport = null;
					this.hooks.onError(reason);
					this.setState("failed");
				}
			});
		} catch (error) {
			if (generation === this.generation) {
				this.transport = null;
				this.setState("failed");
			}
			throw error;
		}
		if (generation === this.generation) this.setState("connected");
	}
	close() {
		this.generation += 1;
		const transport = this.transport;
		this.transport = null;
		transport?.close();
		if (this.stateValue !== "disconnected") this.setState("disconnected");
	}
	sendText(text) {
		this.send({
			type: "conversation.item.create",
			item: {
				type: "message",
				role: "user",
				content: [{
					type: "input_text",
					text
				}]
			}
		});
		this.send({ type: "response.create" });
	}
	send(event) {
		if (!this.transport || this.stateValue !== "connected") throw new Error("Not connected to Realtime.");
		this.transport.send(event);
	}
	async handleEvent(event) {
		if (event.type === "error") {
			this.hooks.onError(describeApiError(event));
			return;
		}
		if (event.type !== "response.done") return;
		const response = event.response;
		if (typeof response === "object" && response !== null && "usage" in response) this.hooks.onUsage?.(response.usage);
		const output = readResponseOutput(event);
		if (output.text.length > 0) this.hooks.onResponseText(output.text);
		if (output.calls.length === 0) return;
		const generation = this.generation;
		const results = await Promise.all(output.calls.map((call) => this.runCall(call)));
		if (generation !== this.generation || !this.transport) return;
		for (const result of results) this.transport.send({
			type: "conversation.item.create",
			item: {
				type: "function_call_output",
				call_id: result.callId,
				output: result.output
			}
		});
		this.transport.send({ type: "response.create" });
	}
	async runCall(call) {
		let args;
		try {
			args = call.argumentsJson.trim().length === 0 ? {} : JSON.parse(call.argumentsJson);
		} catch {
			return {
				callId: call.callId,
				output: JSON.stringify({ error: "Arguments were not valid JSON." })
			};
		}
		try {
			const value = await this.hooks.callFunction(call.name, args);
			return {
				callId: call.callId,
				output: JSON.stringify(value ?? null)
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.hooks.onError(message);
			return {
				callId: call.callId,
				output: JSON.stringify({ error: message })
			};
		}
	}
	setState(state) {
		this.stateValue = state;
		this.hooks.onStateChange?.(state);
	}
};
function readResponseOutput(event) {
	const response = asRecord$1(event.response);
	const items = Array.isArray(response?.output) ? response.output : [];
	const texts = [];
	const calls = [];
	for (const rawItem of items) {
		const item = asRecord$1(rawItem);
		if (!item) continue;
		if (item.type === "function_call" && typeof item.name === "string" && typeof item.call_id === "string") calls.push({
			callId: item.call_id,
			name: item.name,
			argumentsJson: typeof item.arguments === "string" ? item.arguments : ""
		});
		else if (item.type === "message" && Array.isArray(item.content)) for (const rawPart of item.content) {
			const part = asRecord$1(rawPart);
			if (typeof part?.text === "string") texts.push(part.text);
			else if (typeof part?.transcript === "string") texts.push(part.transcript);
		}
	}
	return {
		text: texts.join(""),
		calls
	};
}
function describeApiError(event) {
	const error = asRecord$1(event.error);
	return `${typeof error?.message === "string" ? error.message : "Unknown Realtime API error."}${typeof error?.code === "string" ? ` (${error.code})` : ""}`;
}
function asRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
//#endregion
//#region src/relay-client.ts
var LOOPBACK_HOSTNAMES = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"localhost",
	"[::1]"
]);
var TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,}$/u;
var CLIENT_SECRET_PATTERN = /^ek_[A-Za-z0-9_-]+$/u;
/** Accepts only a plain loopback HTTP origin so the relay token can never leave this machine. */
function normalizeRelayEndpoint(endpoint) {
	let url;
	try {
		url = new URL(endpoint.trim());
	} catch {
		throw new TypeError("Relay endpoint must be a valid URL.");
	}
	if (url.protocol !== "http:" || !LOOPBACK_HOSTNAMES.has(url.hostname)) throw new TypeError("Relay endpoint must use HTTP on a loopback hostname.");
	if (url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0 || url.pathname !== "/" && url.pathname !== "") throw new TypeError("Relay endpoint must contain only its loopback origin.");
	return url.origin;
}
async function pairWithRelay(endpoint, code, fetcher = fetch, now = Date.now) {
	const origin = normalizeRelayEndpoint(endpoint);
	const trimmed = code.trim();
	if (!/^\d{8}$/u.test(trimmed)) throw new TypeError("Relay pairing code must contain exactly eight digits.");
	const record = requireRecord(await requestJson(fetcher, `${origin}/v1/pair`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ code: trimmed }),
		redirect: "error"
	}), "Relay returned an invalid pairing response.");
	const token = String(record.token ?? "");
	if (!TOKEN_PATTERN.test(token)) throw new Error("Relay returned an invalid pairing token.");
	if (typeof record.expiresAt !== "number" || !Number.isFinite(record.expiresAt) || record.expiresAt <= now()) throw new Error("Relay returned an invalid session expiration.");
	return {
		endpoint: origin,
		token,
		expiresAt: record.expiresAt
	};
}
async function requestClientSecret(session, request, fetcher = fetch, now = Date.now) {
	if (session.expiresAt <= now()) throw new Error("Relay session has expired. Pair with the local relay again.");
	const data = requireRecord(requireRecord(await requestJson(fetcher, `${session.endpoint}/v1/openai/realtime/client-secrets`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${session.token}`
		},
		body: JSON.stringify({ session: request }),
		redirect: "error"
	}), "Relay returned an invalid client secret response.").data, "Relay returned an invalid client secret response.");
	const value = String(data.value ?? "");
	if (!CLIENT_SECRET_PATTERN.test(value)) throw new Error("Relay returned an invalid client secret.");
	if (typeof data.expiresAt !== "number" || !Number.isFinite(data.expiresAt) || data.expiresAt <= now()) throw new Error("Relay returned an expired client secret.");
	return {
		value,
		expiresAt: data.expiresAt,
		model: String(data.model ?? "")
	};
}
async function requestJson(fetcher, url, init) {
	const response = await fetcher(url, init);
	const text = await response.text();
	let result = null;
	if (text.length > 0) try {
		result = JSON.parse(text);
	} catch {
		throw new Error(`Relay returned a non-JSON response (${response.status}).`);
	}
	if (!response.ok) throw new Error(`Relay request failed (${response.status}): ${errorDetail(result)}`);
	return result;
}
function requireRecord(value, message) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
	return value;
}
function errorDetail(value) {
	if (typeof value === "object" && value !== null) {
		const error = value.error;
		if (typeof error === "object" && error !== null) {
			const message = error.message;
			if (typeof message === "string") return message;
		}
	}
	return "unknown error";
}
//#endregion
//#region src/session-config.ts
var MAX_INSTRUCTIONS_LENGTH = 16384;
var VOICE_PATTERN = /^[a-z0-9_-]{1,32}$/u;
var MODEL_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
var SUPPORTED_MODELS = ["gpt-realtime-2.1-mini", "gpt-realtime-2.1"];
function defaultSessionSettings() {
	return {
		model: "",
		instructions: "",
		voice: "marin",
		outputMode: "audio"
	};
}
/** Accepts an empty string (relay default) or a model identifier; the relay decides what is allowed. */
function normalizeModel(value) {
	const model = value.trim();
	if (model.length > 0 && !MODEL_PATTERN.test(model)) throw new TypeError("Model must be a model identifier.");
	return model;
}
function normalizeVoice(value) {
	const voice = value.trim().toLowerCase();
	if (!VOICE_PATTERN.test(voice)) throw new TypeError("Voice must be a lowercase identifier.");
	return voice;
}
function normalizeInstructions(value) {
	if (value.length > 16384) throw new TypeError(`Instructions must be at most ${MAX_INSTRUCTIONS_LENGTH} characters.`);
	return value;
}
function normalizeOutputMode(value) {
	if (value === "audio" || value === "text") return value;
	throw new TypeError("Output must be audio or text.");
}
function buildSessionRequest(settings, tools) {
	if (tools.length > 32) throw new TypeError(`At most 32 functions can be exported as tools.`);
	const request = {
		voice: settings.voice,
		outputModalities: [settings.outputMode]
	};
	if (settings.model.length > 0) request.model = settings.model;
	if (settings.instructions.length > 0) request.instructions = settings.instructions;
	if (tools.length > 0) request.tools = tools.map((tool) => ({ ...tool }));
	return request;
}
//#endregion
//#region src/usage.ts
var MODEL_PRICES = {
	"gpt-realtime-2.1": {
		textInput: 4,
		cachedTextInput: .4,
		textOutput: 24,
		audioInput: 32,
		cachedAudioInput: .4,
		audioOutput: 64
	},
	"gpt-realtime-2.1-mini": {
		textInput: .6,
		cachedTextInput: .06,
		textOutput: 2.4,
		audioInput: 10,
		cachedAudioInput: .3,
		audioOutput: 20
	}
};
var PRICES_AS_OF = "2026-09-18";
function emptyUsage() {
	return {
		responses: 0,
		inputTokens: 0,
		outputTokens: 0,
		cachedInputTokens: 0,
		textInputTokens: 0,
		audioInputTokens: 0,
		cachedTextInputTokens: 0,
		cachedAudioInputTokens: 0,
		textOutputTokens: 0,
		audioOutputTokens: 0,
		estimatedCostUsd: 0,
		unpricedResponses: 0
	};
}
/** Adds one `response.usage` object to the totals. Unknown or malformed usage counts as zero tokens. */
function addUsage(totals, usage, model) {
	const root = asRecord(usage);
	if (!root) return totals;
	const input = asRecord(root.input_token_details);
	const output = asRecord(root.output_token_details);
	const cachedDetails = asRecord(input?.cached_tokens_details);
	const textInput = count(input?.text_tokens);
	const audioInput = count(input?.audio_tokens);
	const cached = count(input?.cached_tokens);
	const cachedText = cachedDetails ? count(cachedDetails.text_tokens) : Math.min(cached, textInput);
	const cachedAudio = cachedDetails ? count(cachedDetails.audio_tokens) : Math.max(0, cached - cachedText);
	const textOutput = count(output?.text_tokens);
	const audioOutput = count(output?.audio_tokens);
	const next = {
		responses: totals.responses + 1,
		inputTokens: totals.inputTokens + count(root.input_tokens),
		outputTokens: totals.outputTokens + count(root.output_tokens),
		cachedInputTokens: totals.cachedInputTokens + cached,
		textInputTokens: totals.textInputTokens + textInput,
		audioInputTokens: totals.audioInputTokens + audioInput,
		cachedTextInputTokens: totals.cachedTextInputTokens + cachedText,
		cachedAudioInputTokens: totals.cachedAudioInputTokens + cachedAudio,
		textOutputTokens: totals.textOutputTokens + textOutput,
		audioOutputTokens: totals.audioOutputTokens + audioOutput,
		estimatedCostUsd: totals.estimatedCostUsd,
		unpricedResponses: totals.unpricedResponses
	};
	const price = MODEL_PRICES[model];
	if (!price) {
		next.unpricedResponses += 1;
		return next;
	}
	next.estimatedCostUsd += (Math.max(0, textInput - cachedText) * price.textInput + cachedText * price.cachedTextInput + Math.max(0, audioInput - cachedAudio) * price.audioInput + cachedAudio * price.cachedAudioInput + textOutput * price.textOutput + audioOutput * price.audioOutput) / 1e6;
	return next;
}
function count(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
function asRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
//#endregion
//#region src/webrtc-transport.ts
var REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
var EVENTS_CHANNEL = "oai-events";
function browserWebRtcDependencies() {
	return {
		createPeerConnection: () => new RTCPeerConnection(),
		getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
		createAudioElement: () => {
			const element = document.createElement("audio");
			element.autoplay = true;
			return element;
		},
		fetch: (input, init) => fetch(input, init)
	};
}
/** Browser-to-OpenAI WebRTC session authenticated with an ephemeral client secret. */
var WebRtcTransport = class {
	constructor(deps = browserWebRtcDependencies()) {
		this.deps = deps;
		this.peer = null;
		this.channel = null;
		this.microphone = null;
		this.audio = null;
		this.closed = false;
	}
	async connect(options) {
		this.closed = false;
		try {
			const peer = this.deps.createPeerConnection();
			this.peer = peer;
			const audio = this.deps.createAudioElement();
			this.audio = audio;
			peer.ontrack = (event) => {
				audio.srcObject = event.streams[0] ?? null;
			};
			if (options.microphone) {
				const stream = await this.deps.getUserMedia({ audio: true });
				this.microphone = stream;
				for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
			} else peer.addTransceiver("audio", { direction: "recvonly" });
			const channel = peer.createDataChannel(EVENTS_CHANNEL);
			this.channel = channel;
			channel.onmessage = (message) => {
				const event = parseEvent(message.data);
				if (event) options.onEvent(event);
			};
			channel.onclose = () => this.handleClose(options, "The Realtime data channel closed.");
			peer.onconnectionstatechange = () => {
				if (peer.connectionState === "failed" || peer.connectionState === "closed") this.handleClose(options, `The Realtime connection ${peer.connectionState}.`);
			};
			const opened = waitForOpen(channel, this.deps.channelOpenTimeoutMs ?? 15e3);
			opened.catch(() => void 0);
			const offer = await peer.createOffer();
			await peer.setLocalDescription(offer);
			const response = await this.deps.fetch(REALTIME_CALLS_URL, {
				method: "POST",
				body: offer.sdp ?? "",
				headers: {
					authorization: `Bearer ${options.clientSecret}`,
					"content-type": "application/sdp"
				},
				redirect: "error"
			});
			const answer = await response.text();
			if (!response.ok) throw new Error(`Realtime call setup failed (${response.status}).`);
			await peer.setRemoteDescription({
				type: "answer",
				sdp: answer
			});
			await opened;
		} catch (error) {
			this.close();
			throw error;
		}
	}
	send(event) {
		if (!this.channel || this.channel.readyState !== "open") throw new Error("Not connected to Realtime.");
		this.channel.send(JSON.stringify(event));
	}
	close() {
		this.closed = true;
		const channel = this.channel;
		const peer = this.peer;
		this.channel = null;
		this.peer = null;
		if (channel) {
			channel.onmessage = null;
			channel.onclose = null;
			channel.close();
		}
		if (peer) {
			peer.onconnectionstatechange = null;
			peer.ontrack = null;
			peer.close();
		}
		for (const track of this.microphone?.getTracks() ?? []) track.stop();
		this.microphone = null;
		if (this.audio) {
			this.audio.srcObject = null;
			this.audio = null;
		}
	}
	handleClose(options, reason) {
		if (this.closed) return;
		this.close();
		options.onClose(reason);
	}
};
function parseEvent(data) {
	if (typeof data !== "string") return null;
	try {
		const value = JSON.parse(data);
		if (typeof value === "object" && value !== null && typeof value.type === "string") return value;
	} catch {}
	return null;
}
function waitForOpen(channel, timeoutMs) {
	if (channel.readyState === "open") return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(/* @__PURE__ */ new Error("Timed out opening the Realtime data channel.")), timeoutMs);
		channel.addEventListener("open", () => {
			clearTimeout(timer);
			resolve();
		}, { once: true });
	});
}
//#endregion
//#region src/composition.ts
/**
* Composition API: the OpenAI Realtime capability without TurboWarp block definitions.
*
* A downstream extension (for example `@kubohiroya/turbowarp-voice-chat`) owns its own blocks and
* hats, and passes its own `define function` hat opcode. Importing this module does not register
* any TurboWarp extension and does not touch the `Scratch` global.
*/
var DEFAULT_RELAY_ENDPOINT = "http://127.0.0.1:8787";
function createRealtimeComposition(options) {
	return new Composition(options);
}
var Composition = class {
	constructor(options) {
		this.options = options;
		this.relayEndpoint = DEFAULT_RELAY_ENDPOINT;
		this.relaySession = null;
		this.settingsValue = defaultSessionSettings();
		this.timeLimitSeconds = 0;
		this.connectedAt = null;
		this.timeLimitTimer = null;
		this.activeModelValue = "";
		this.lastResponse = "";
		this.usageTotals = emptyUsage();
		this.listeners = /* @__PURE__ */ new Set();
		this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
		this.createTransport = options.createTransport ?? (() => new WebRtcTransport());
		this.now = options.now ?? Date.now;
		this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
		this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
		this.ownsFunctions = options.functions === void 0;
		this.namedFunctions = options.functions ?? createNamedFunctions({
			runtime: options.runtime,
			functionHatOpcode: options.functionHatOpcode
		});
		this.session = new RealtimeSession({
			callFunction: (name, args) => this.namedFunctions.call(name, args, { exportedOnly: true }),
			onResponseText: (text) => {
				this.lastResponse = text;
				this.emit({
					type: "response",
					text
				});
			},
			onError: (message) => this.emit({
				type: "error",
				message
			}),
			onStateChange: (state) => this.handleState(state),
			onUsage: (usage) => {
				this.usageTotals = addUsage(this.usageTotals, usage, this.activeModelValue);
				this.emit({
					type: "usage",
					usage: this.usage()
				});
			}
		});
	}
	configureRelay(endpoint) {
		this.relayEndpoint = normalizeRelayEndpoint(endpoint);
		this.relaySession = null;
	}
	async pairRelay(code) {
		this.relaySession = await pairWithRelay(this.relayEndpoint, code, this.fetcher, this.now);
	}
	isRelayPaired() {
		return this.relaySession !== null && this.relaySession.expiresAt > this.now();
	}
	setModel(model) {
		this.settingsValue = {
			...this.settingsValue,
			model: normalizeModel(model)
		};
	}
	setInstructions(text) {
		this.settingsValue = {
			...this.settingsValue,
			instructions: normalizeInstructions(text)
		};
	}
	setVoice(voice) {
		this.settingsValue = {
			...this.settingsValue,
			voice: normalizeVoice(voice)
		};
	}
	setOutputMode(mode) {
		this.settingsValue = {
			...this.settingsValue,
			outputMode: normalizeOutputMode(mode)
		};
	}
	setSessionTimeLimit(seconds) {
		if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError("Session time limit must be zero or a positive number of seconds.");
		this.timeLimitSeconds = seconds;
	}
	get settings() {
		return { ...this.settingsValue };
	}
	get sessionTimeLimitSeconds() {
		return this.timeLimitSeconds;
	}
	scanFunctions() {
		return this.namedFunctions.scan();
	}
	get functions() {
		return this.namedFunctions;
	}
	async connect(options) {
		if (!this.relaySession || !this.isRelayPaired()) throw new Error("Pair with the local relay first.");
		const request = buildSessionRequest(this.settingsValue, this.namedFunctions.tools());
		const secret = await requestClientSecret(this.relaySession, request, this.fetcher, this.now);
		this.activeModelValue = secret.model || this.settingsValue.model;
		await this.session.open(this.createTransport(), secret.value, options.microphone);
	}
	disconnect() {
		this.session.close();
	}
	get state() {
		return this.session.state;
	}
	get activeModel() {
		return this.activeModelValue;
	}
	sessionElapsedSeconds() {
		return this.connectedAt === null ? 0 : Math.max(0, (this.now() - this.connectedAt) / 1e3);
	}
	sendText(text) {
		this.session.sendText(text);
	}
	get lastResponseText() {
		return this.lastResponse;
	}
	matchFunctionHat(name, thread) {
		return this.namedFunctions.matchHat(name, thread);
	}
	functionArguments(thread) {
		return this.namedFunctions.argumentsFor(thread);
	}
	returnFromFunction(thread, value) {
		this.namedFunctions.returnFrom(thread, value);
	}
	usage() {
		return { ...this.usageTotals };
	}
	resetUsage() {
		this.usageTotals = emptyUsage();
		this.emit({
			type: "usage",
			usage: this.usage()
		});
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	release() {
		this.disconnect();
		this.listeners.clear();
		if (this.ownsFunctions) this.namedFunctions.release();
	}
	handleState(state) {
		if (state === "connected") {
			this.connectedAt = this.now();
			if (this.timeLimitSeconds > 0) this.timeLimitTimer = this.setTimer(() => this.reachTimeLimit(), this.timeLimitSeconds * 1e3);
		} else if (state !== "connecting") {
			this.connectedAt = null;
			this.cancelTimeLimit();
			this.namedFunctions.cancelAll("The Realtime session ended.");
		}
		this.emit({
			type: "state",
			state
		});
	}
	reachTimeLimit() {
		this.timeLimitTimer = null;
		if (this.session.state !== "connected") return;
		this.session.close();
		this.emit({ type: "sessionTimeLimitReached" });
	}
	cancelTimeLimit() {
		if (this.timeLimitTimer !== null) this.clearTimer(this.timeLimitTimer);
		this.timeLimitTimer = null;
	}
	emit(event) {
		for (const listener of [...this.listeners]) listener(event);
	}
};
//#endregion
export { DEFAULT_RELAY_ENDPOINT, MODEL_PRICES, PRICES_AS_OF, SUPPORTED_MODELS, createRealtimeComposition };
