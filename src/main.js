const Apify = require('apify');

const { log } = Apify.utils;
const {
    sumDatasets,
    awaitRuns,
} = require('./functions');

Apify.main(async () => {
    const input = await Apify.getInput();

    const { defaultDatasetId } = Apify.getEnv();

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
    } = input;

    if (!inputUrlsDatasetId) {
        throw new Error('Missing "inputDatasetId"');
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

    if (workerCount < 2) {
        throw new Error('Parameter "workerCount" must be 2 or higher');
    }

    const dataset = await Apify.openDataset(inputUrlsDatasetId, { forceCloud: true });
    const { cleanItemCount: urlsCount } = await dataset.getInfo();
    const usingOtherSource = urlsCount.length === 0;
    let batchSize = 0;
    let offset = 0;
    let id = '';

    if (!usingOtherSource) {
        log.warning(`The provided dataset "${inputUrlsDatasetId}" doesn't have any items`);
    } else {
        log.info(`Total URLs size in dataset: ${urlsCount}`);

        const outputDataset = await Apify.openDataset(outputDatasetId || defaultDatasetId, { forceCloud: true });
        const { id: datasetId, cleanItemCount } = await outputDataset.getInfo();

        id = datasetId;

        log.info('Output', { id, cleanItemCount });

        batchSize = Math.ceil(urlsCount / workerCount);
    }

    /**
     * @type {any[]}
     */
    const workers = (await Apify.getValue('WORKERS')) || [];

    if (workers.length === 0) {
        for (let i = 1; i <= workerCount; i++) {
            const payload = {
                ...(workerInput || {}),
                parentRunId,
                offset,
                limit: batchSize,
                inputDatasetId: inputUrlsDatasetId,
                outputDatasetId: id,
                workerId: i,
                usingOtherSource,
            };

            offset += batchSize;

            log.debug('Start ', { payload, offset });

            const worker = await Apify[workerActorId ? 'call' : 'callTask'](
                workerActorId || workerTaskId,
                payload,
                { ...(workerOptions || {}), waitSecs: 0 },
            );

            workers.push(worker);

            await Apify.setValue('WORKERS', workers);

            await Apify.utils.sleep(1000 * workerCount);
        }
    }

    log.info('Awaiting workers', { workers });

    const statuses = await awaitRuns(workers.map((run) => run.id), workerActorId);
    const datasetsItemsCount = await sumDatasets(statuses.map((s) => s.defaultDatasetId));

    await Apify.setValue('OUTPUT', {
        workers: workers.map((s) => {
            const lateStatus = statuses.find((status) => status.runId === s.id);

            return {
                ...s,
                finishedAt: lateStatus.finishedAt,
                status: lateStatus.status,
            };
        }),
        datasetsItemsCount,
        outputDatasetId: id,
    });

    log.info('Done');
});
