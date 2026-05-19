import { afterEach, describe, expect, it, vi } from "vitest";
import { pollOAuthDeviceCodeFlow } from "../src/utils/oauth/device-code.js";

describe("OAuth device-code polling", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("waits before the first poll and returns the completed value", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-09T00:00:00Z"));

		const pollTimes: number[] = [];
		const poll = vi.fn(async () => {
			pollTimes.push(Date.now());
			return pollTimes.length === 1
				? { status: "pending" as const }
				: { status: "complete" as const, value: "token" };
		});

		const resultPromise = pollOAuthDeviceCodeFlow({
			authorization: {
				userCode: "ABCD-EFGH",
				verificationUri: "https://example.com/device",
				intervalSeconds: 2,
				expiresInSeconds: 30,
			},
			poll,
			initialIntervalMultiplier: 1.5,
		});

		await vi.advanceTimersByTimeAsync(2999);
		expect(pollTimes).toEqual([]);

		await vi.advanceTimersByTimeAsync(1);
		expect(pollTimes).toEqual([new Date("2026-03-09T00:00:03Z").getTime()]);

		await vi.advanceTimersByTimeAsync(3000);
		await expect(resultPromise).resolves.toBe("token");
		expect(pollTimes).toEqual([
			new Date("2026-03-09T00:00:03Z").getTime(),
			new Date("2026-03-09T00:00:06Z").getTime(),
		]);
	});

	it("cancels an in-flight wait", async () => {
		vi.useFakeTimers();
		const controller = new AbortController();

		const resultPromise = pollOAuthDeviceCodeFlow({
			authorization: {
				userCode: "ABCD-EFGH",
				verificationUri: "https://example.com/device",
				intervalSeconds: 5,
				expiresInSeconds: 30,
			},
			poll: async () => ({ status: "pending" }),
			signal: controller.signal,
		});

		controller.abort();
		await expect(resultPromise).rejects.toThrow("Login cancelled");
	});
});
