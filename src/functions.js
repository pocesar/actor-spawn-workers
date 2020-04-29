const Apify = require('apify');
const { log } = Apify.utils;

/**
 * Asynchronously wait for a run to finish, polling every 10s
 *
 * @param {string} runId The unique ID of the run
 * @param {string} actId The unique ID of the actor
 */
const awaitRun = (runId, actId) => {
  return new Promise((resolve) => {
      const timeout = async () => {
          const { status, defaultDatasetId } = await Apify.client.acts.getRun({ actId, runId });

          if (!['RUNNING', 'READY'].includes(status)) {
              resolve({ status, runId, actId, defaultDatasetId });
          } else {
              setTimeout(timeout, 10000);
          }
      }

      timeout();
  });
}

exports.awaitRun = awaitRun;

/**
* Get the sum count from all provided datasets
*
* @param {string[]} ids
*/
const sumDatasets = async (ids) => {
  return (await Promise.all(
      ids.map(datasetId => Apify.client.datasets.getDataset({ datasetId }).then(s => s.cleanItemCount))
  )).reduce((o, i) => (o + i), 0);
}

exports.sumDatasets = sumDatasets;

/**
 * Await for all runs in the array
 *
 * @param {string[]} runIds
 * @param {string} actId
 */
const awaitRuns = async (runIds, actId) => {
    log.info(`Waiting for runs to finish`, { runIds, actId });
    const statuses = await Promise.all(runIds.map(runId => awaitRun(runId, actId)));
    log.info('Runs finished', { statuses });

    for (const s of statuses) {
        if (s.status !== 'SUCCEEDED') {
            throw new Error(`Worker returned fail status ${s.status}. runId: ${s.runId} actId: ${s.actId}`); // crash to avoid inconsistencies
        }
    }

    return statuses;
};

exports.awaitRuns = awaitRuns;