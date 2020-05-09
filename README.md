# Spawn workers

This actor lets you spawn tasks or other actors in parallel on the Apify platform that shares a common output dataset, splitting a RequestQueue-like dataset containing request URLs

## Usage

```js
// Request dataset actor
const Apify = require('apify');

Apify.main(async () => {
  const requestList = await Apify.openRequestList('start-urls', [
    //... your requests here
  ]);

  const crawler = new Apify.CheerioCrawler({
    requestList,
    handlePageFunction: async ({ $, request }) => {

      // instead of requestQueue.addRequest, you push the URLs to the dataset
      await Apify.pushData({
        url: $('select stuff').attr('href'),
        userData: {
          label: $('select other stuff').data('rest')
        }
      });

    },
  });

  await crawler.run();

  const { defaultDatasetId } = Apify.getEnv();

  const { output } = await Apify.call('pocesar/spawn-workers', {
    // if you omit this, the default dataset on the spawn-workers actor will hold all items
    outputDatasetId: 'some-named-dataset',
    // use this actor default dataset as input for the workers requests
    inputUrlsDatasetId: defaultDatasetId,
    // the name or ID of your worker actor (the one below)
    workerActorId: 'youracount/actor-worker',
    // you can use a task instead
    workerTaskId: 'acc/task',
    // Optionally pass input to the actors / tasks
    workerInput: {
      maxConcurrency: 20,
      mode: 1,
      myConfig: {
        some: 'config'
      }
    },
    // Optional worker options
    workerOptions: {
      memoryMbytes: 256
    },
    // Number of workers
    workerCount: 2,
    // Parent run ID, so you can persist things related to this actor call
    parentRunId: Apify.getEnv().actorRunId
  });

  const {
    // contains all workers "ActorRuns"
    workers,
    // access to the outputDataset
    outputDatasetId,
    // sum of all default datasets on each worker
    datasetsItemsCount
  } = output.body;
});
```

```js
// Worker code
const Apify = require('apify');

Apify.main(async () => {
  const {
    limit,  // every worker receives a "batch"
    offset, // that changes depending on how many were spawned
    inputDatasetId,
    outputDatasetId,
    parentRunId,
    ...myConfig // any other configuration you passed through workerInput
  } = await Apify.getInput();

  const requestDataset = await Apify.openDataset(inputDatasetId);
  const { items } = await requestDataset.getData({
      offset, limit,
  });

  const aNamedDataset = await Apify.openDataset(`MY-NAMED-DATASET-${parentRunId}`);
  const outputDataset = await Apify.openDataset(outputDatasetId);
  const requestList = await Apify.openRequestList('URLS', items); // load all the urls at once in memory

  const crawler = new Apify.CheerioCrawler({
    requestList,
    handlePageFunction: async ({ $, request }) => {

      // or you can use Apify.pushData() to push to the default dataset
      await outputDataset.pushData({
        url: request.url,
        data: $('script[type="application/ld+json"]').html()
      });

    },
    /*...*/
  });

  //...
});
```

## Motivation

RequestQueue is the best way to process requests cross actors, but it doesn't offer a way to limit or get offsets from it, you can just iterate over its contents or add new requests.

By using the dataset, you have the same functionality (sans the ability to deduplicate the URLs) that can be safely shared and partitioned to many actors at once. Each worker will be dealing with their own subset of URLs, with no overlapping.

## Limitations

Don't use the following keys for `workerInput` as they will be overwritten:

* offset
* limit
* inputDatasetId
* outputDatasetId
* workerId
* parentRunId

## License

Apache 2.0


