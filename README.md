# Spawn workers

This actor lets you spawn tasks or other actors in parallel on the Apify platform that shares a common output dataset, splitting a RequestQueue-like dataset containing request URLs

## Usage

```js
const Apify = require("apify");

Apify.main(async () => {
    const input = await Apify.getInput();

    const {
        limit, // every worker receives a "batch"
        offset, // that changes depending on how many were spawned
        inputDatasetId,
        outputDatasetId,
        parentRunId,
        isWorker,
        emptyDataset, // means the inputDatasetId is empty, and you should use another source, like the Key Value store
        ...rest // any other configuration you passed through workerInput
    } = input;

    // don't mix requestList with requestQueue
    // when in worker mode
    const requestList = new Apify.RequestList({
        persistRequestsKey: 'START-URLS',
        sourcesFunction: async () => {
            if (!isWorker) {
                return [
                    {
                        "url": "https://start-url..."
                    }
                ]
            }

            const requestDataset = await Apify.openDataset(inputDatasetId);

            const { items } = await requestDataset.getData({
                offset,
                limit,
            });

            return items;
        }
    });

    await requestList.initialize();

    const requestQueue = isWorker ? undefined : await Apify.openRequestQueue();
    const outputDataset = isWorker ? await Apify.openDataset(outputDatasetId) : undefined;

    const crawler = new Apify.CheerioCrawler({
        requestList,
        requestQueue,
        handlePageFunction: async ({ $, request }) => {
            if (isWorker) {
                // scrape details here
                await outputDataset.pushData({ ...data });
            } else {
                // instead of requestQueue.addRequest, you push the URLs to the dataset
                await Apify.pushData({
                    url: $("select stuff").attr("href"),
                    userData: {
                        label: $("select other stuff").data("rest"),
                    },
                });
            }
        },
    });

    await crawler.run();

    if (!isWorker) {
        const { output } = await Apify.call("pocesar/spawn-workers", {
            // if you omit this, the default dataset on the spawn-workers actor will hold all items
            outputDatasetId: "some-named-dataset",
            // use this actor default dataset as input for the workers requests, usually should be this own dataset ID
            inputUrlsDatasetId: Apify.getEnv().defaultDatasetId,
            // the name or ID of your worker actor (the one below)
            workerActorId: Apify.getEnv().actorId,
            // you can use a task instead
            workerTaskId: Apify.getEnv().actorTaskId,
            // Optionally pass input to the actors / tasks
            workerInput: {
                maxConcurrency: 20,
                mode: 1,
                some: "config",
            },
            // Optional worker options
            workerOptions: {
                memoryMbytes: 256,
            },
            // Number of workers
            workerCount: 2,
            // Parent run ID, so you can persist things related to this actor call in a centralized manner
            parentRunId: Apify.getEnv().actorRunId,
        });
    }
});
```

## Motivation

RequestQueue is the best way to process requests cross actors, but it doesn't offer a way to limit or get offsets from it, you can just iterate over its contents or add new requests.

By using the dataset, you have the same functionality (sans the ability to deduplicate the URLs) that can be safely shared and partitioned to many actors at once. Each worker will be dealing with their own subset of URLs, with no overlapping.

## Limitations

Don't use the following keys for `workerInput` as they will be overwritten:

-   offset: number
-   limit: number
-   inputDatasetId: string
-   outputDatasetId: string
-   workerId: number
-   parentRunId: string
-   isWorker: boolean
-   emptyDataset: boolean

## License

Apache 2.0
