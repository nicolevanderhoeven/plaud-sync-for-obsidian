export type SyncTrigger = 'manual' | 'startup' | 'auto';

export interface PlaudSyncRuntimeOptions {
	isStartupEnabled: () => boolean;
	runSync: (trigger: SyncTrigger) => Promise<void>;
	onLocked: (message: string) => void;
}

const LOCKED_MESSAGE = 'Plaud sync already running. Please wait for current run to finish.';

export interface PlaudSyncRuntime {
	runManualSync(): Promise<boolean>;
	runStartupSync(): Promise<boolean>;
	runAutoSync(): Promise<boolean>;
}

export function createPlaudSyncRuntime(options: PlaudSyncRuntimeOptions): PlaudSyncRuntime {
	let inFlight: Promise<void> | null = null;

	const acquireAndRun = async (trigger: SyncTrigger): Promise<boolean> => {
		const runPromise = options.runSync(trigger);
		inFlight = runPromise;

		try {
			await runPromise;
			return true;
		} finally {
			if (inFlight === runPromise) {
				inFlight = null;
			}
		}
	};

	const runWithLock = async (trigger: SyncTrigger): Promise<boolean> => {
		if (inFlight) {
			options.onLocked(LOCKED_MESSAGE);
			return false;
		}

		return acquireAndRun(trigger);
	};

	return {
		runManualSync: () => runWithLock('manual'),
		runStartupSync: () => {
			if (!options.isStartupEnabled()) {
				return Promise.resolve(false);
			}

			return runWithLock('startup');
		},
		runAutoSync: () => {
			if (inFlight) {
				return Promise.resolve(false);
			}

			return acquireAndRun('auto');
		}
	};
}
