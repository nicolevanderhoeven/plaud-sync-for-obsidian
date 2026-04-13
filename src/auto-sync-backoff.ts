export const MAX_CONSECUTIVE_AUTO_SYNC_FAILURES = 3;

export interface AutoSyncBackoff {
	recordFailure(): boolean;
	recordSuccess(): void;
	reset(): void;
	readonly consecutiveFailures: number;
	readonly paused: boolean;
}

export function createAutoSyncBackoff(maxFailures: number = MAX_CONSECUTIVE_AUTO_SYNC_FAILURES): AutoSyncBackoff {
	let failures = 0;

	return {
		recordFailure: () => {
			failures += 1;
			return failures >= maxFailures;
		},
		recordSuccess: () => {
			failures = 0;
		},
		reset: () => {
			failures = 0;
		},
		get consecutiveFailures() {
			return failures;
		},
		get paused() {
			return failures >= maxFailures;
		}
	};
}
