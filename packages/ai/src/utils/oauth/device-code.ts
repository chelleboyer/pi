export type OAuthDeviceCodeAuthorization = {
	userCode: string;
	verificationUri: string;
	intervalSeconds: number;
	expiresInSeconds?: number;
};

export type OAuthDeviceCodePollResult<T> =
	| { status: "pending" }
	| { status: "slow_down"; intervalSeconds?: number }
	| { status: "complete"; value: T }
	| { status: "failed"; message: string };

export type OAuthDeviceCodePollOptions<T> = {
	authorization: OAuthDeviceCodeAuthorization;
	poll: () => Promise<OAuthDeviceCodePollResult<T>>;
	signal?: AbortSignal;
	cancelMessage?: string;
	timeoutMessage?: string;
	slowDownTimeoutMessage?: string;
	initialIntervalMultiplier?: number;
	slowDownIntervalMultiplier?: number;
	slowDownIntervalIncrementSeconds?: number;
	minimumIntervalMs?: number;
};

function abortableSleep(ms: number, signal: AbortSignal | undefined, cancelMessage: string): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error(cancelMessage));
			return;
		}

		const onAbort = () => {
			clearTimeout(timeout);
			reject(new Error(cancelMessage));
		};
		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);

		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export async function pollOAuthDeviceCodeFlow<T>(options: OAuthDeviceCodePollOptions<T>): Promise<T> {
	const cancelMessage = options.cancelMessage ?? "Login cancelled";
	const minimumIntervalMs = options.minimumIntervalMs ?? 1000;
	const slowDownIntervalIncrementSeconds = options.slowDownIntervalIncrementSeconds ?? 5;
	const initialIntervalMultiplier = options.initialIntervalMultiplier ?? 1;
	const slowDownIntervalMultiplier = options.slowDownIntervalMultiplier ?? initialIntervalMultiplier;
	const timeoutMessage = options.timeoutMessage ?? "Device flow timed out";

	const deadline =
		typeof options.authorization.expiresInSeconds === "number"
			? Date.now() + options.authorization.expiresInSeconds * 1000
			: Number.POSITIVE_INFINITY;
	let intervalMs = Math.max(minimumIntervalMs, Math.floor(options.authorization.intervalSeconds * 1000));
	let intervalMultiplier = initialIntervalMultiplier;
	let slowDownResponses = 0;

	while (Date.now() < deadline) {
		if (options.signal?.aborted) {
			throw new Error(cancelMessage);
		}

		const remainingMs = deadline - Date.now();
		const waitMs = Math.min(Math.ceil(intervalMs * intervalMultiplier), remainingMs);
		await abortableSleep(waitMs, options.signal, cancelMessage);

		const result = await options.poll();
		if (result.status === "complete") {
			return result.value;
		}
		if (result.status === "pending") {
			continue;
		}
		if (result.status === "slow_down") {
			slowDownResponses += 1;
			intervalMs =
				typeof result.intervalSeconds === "number" && result.intervalSeconds > 0
					? result.intervalSeconds * 1000
					: Math.max(minimumIntervalMs, intervalMs + slowDownIntervalIncrementSeconds * 1000);
			intervalMultiplier = slowDownIntervalMultiplier;
			continue;
		}
		throw new Error(result.message);
	}

	if (slowDownResponses > 0 && options.slowDownTimeoutMessage) {
		throw new Error(options.slowDownTimeoutMessage);
	}

	throw new Error(timeoutMessage);
}
