const Apify = require('apify');

const { log, sleep } = Apify.utils;

Apify.main(async () => {
    /** @type {any} */
    const input = await Apify.getInput();

    const {
        // Same requestQueue.addRequest format
        inputUrlsDatasetId,
        // Optionally output to one dataset
        outputDatasetId,
        // Actor id to launch in parallel
        workerActorId,
        // Task id to launch in parallel
        workerTaskId,
        // Input to pass down to workers
        workerInput = {},
        // Workers additional options
        workerOptions = {},
        // How many to launch
        workerCount = 2,
        parentRunId = null,
        abortOthers = true,
        fireAndForget = false,
        token,
    } = input;

    if (!inputUrlsDatasetId) {
        throw new Error('Missing "inputUrlsDatasetId"');
    }

    if (fireAndForget && abortOthers) {
        throw new Error('Can\'t set "fireAndForget" and "abortOthers" at the same time');
    }

    if (!workerActorId && !workerTaskId) {
        throw new Error('Missing "workerActorId" and "workerTaskId" parameters');
    }

    if (workerActorId && workerTaskId) {
        throw new Error('You need to provide either "workerActorId" or "workerTaskId", but not both');
    }

    if (typeof workerInput !== 'object' || !workerInput) {
        throw new Error('Parameter "workerInput" must be an object');
    }

    if (typeof workerOptions !== 'object' || !workerOptions) {
        throw new Error('Parameter "workerOptions" must be an object');
    }

    if (!+workerCount || +workerCount < 2) {
        throw new Error('Parameter "workerCount" must be 2 or higher');
    }

    const client = Apify.newClient({
        token,
    });

    const actorId = await (workerTaskId ? client.task(workerTaskId) : client.actor(workerActorId)).get().then((s) => s.id);

    if (!actorId) {
        throw new Error(`${workerTaskId ? `Task ${workerTaskId}` : `Actor ${workerActorId}`} was not found`);
    }

    const dataset = await client.datasets().getOrCreate(inputUrlsDatasetId);
    const { id: inputDatasetId, cleanItemCount: urlsCount } = await client.dataset(dataset.id).get();
    const emptyDataset = urlsCount.length === 0;

    const outputDataset = await client.datasets().getOrCreate(outputDatasetId || Apify.getEnv().defaultDatasetId);
    const { id: newOutputDatasetId } = await client.dataset(outputDataset.id).get();
    const batchSize = !emptyDataset ? Math.ceil(urlsCount / workerCount) : 1;

    if (emptyDataset) {
        log.warning(`The provided dataset "${inputUrlsDatasetId}" doesn't have any items`);
    } else {
        log.info(`Total URLs size in dataset: ${urlsCount}`);
    }

    /**
     * @type {Map<number, Apify.ActorRun>}
     */
    const workers = new Map((await Apify.getValue('OUTPUT')) || []);

    const persistState = async () => {
        await Apify.setValue('OUTPUT', [...workers.entries()]);
    };

    if (workers.size < workerCount) {
        for (let i = workers.size; i < workerCount; i++) {
            const offset = i * batchSize;
            const payload = {
                ...(workerInput || {}),
                parentRunId,
                offset,
                limit: batchSize,
                inputDatasetId,
                outputDatasetId: newOutputDatasetId,
                workerId: i + 1,
                emptyDataset,
                isWorker: true,
            };

            log.debug('Start ', { payload, offset });

            const worker = await Apify[workerActorId ? 'call' : 'callTask'](
                workerActorId || workerTaskId,
                payload,
                { ...(workerOptions || {}), waitSecs: 1 },
            );

            workers.set(i, worker);

            await persistState();
            await sleep(400 * workerCount);
        }
    }

    await persistState();

    try {
        if (!fireAndForget) {
            log.info('Awaiting workers', { workers: [...workers.values()] });

            await Promise.all(
                [...workers.values()].map(async (run) => {
                    const { status } = await client.run(run.id).waitForFinish();
                    if (status !== 'SUCCEEDED') {
                        const newError = new Error(status);
                        newError.run = run;
                        throw newError;
                    }
                }),
            );
        }
    } catch (e) {
        log.exception(e, `${e.run ? `Run ${e.run.id} failed` : 'A run failed'}`);

        if (abortOthers) {
            log.warning('Aborting other workers...');

            for (const worker of workers.values()) {
                try {
                    const { status } = await client.run(worker.id).abort();
                    if (status.startsWith('ABORT')) {
                        log.warning(`Aborted ${worker.id}`);
                    }
                } catch (ee) {
                    log.exception(ee, 'Failed aborting worker', { worker });
                }
            }
        }

        process.exit(1);
    }

    log.info('Done');
});
