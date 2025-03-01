import { expect } from 'chai';
import { gte as semverGte, satisfies as semverSatisfies } from 'semver';

import { MONGODB_ERROR_CODES } from '../../../src/error';
import type { MongoClient } from '../../../src/mongo_client';
import { ReadPreference } from '../../../src/read_preference';
import { TopologyType } from '../../../src/sdam/common';
import { ns } from '../../../src/utils';
import { ejson } from '../utils';
import { CmapEvent, CommandEvent, EntitiesMap } from './entities';
import { matchesEvents } from './match';
import { executeOperationAndCheck } from './operations';
import * as uni from './schema';
import { isAnyRequirementSatisfied, patchVersion, zip } from './unified-utils';

export function trace(message: string): void {
  if (process.env.UTR_TRACE) {
    console.error(` > ${message}`);
  }
}

async function terminateOpenTransactions(client: MongoClient) {
  // Note: killAllSession is not supported on serverless, see CLOUDP-84298
  if (process.env.SERVERLESS) {
    return;
  }
  // TODO(NODE-3491): on sharded clusters this has to be run on each mongos
  try {
    await client.db().admin().command({ killAllSessions: [] });
  } catch (err) {
    if (err.code === 11601 || err.code === 13 || err.code === 59) {
      return;
    }

    throw err;
  }
}

export async function runUnifiedTest(
  ctx: Mocha.Context,
  unifiedSuite: uni.UnifiedSuite,
  test: uni.Test,
  testsToSkip?: string[]
): Promise<void> {
  // Some basic expectations we can catch early
  expect(test).to.exist;
  expect(unifiedSuite).to.exist;
  expect(ctx).to.exist;
  expect(ctx.configuration).to.exist;

  const schemaVersion = patchVersion(unifiedSuite.schemaVersion);
  expect(semverSatisfies(schemaVersion, uni.SupportedVersion)).to.be.true;

  // If test.skipReason is specified, the test runner MUST skip this
  // test and MAY use the string value to log a message.
  if (test.skipReason) {
    ctx.skipReason = test.skipReason;
    ctx.skip();
  }

  if (testsToSkip?.includes(test.description)) {
    ctx.skip();
  }

  let utilClient;
  if (ctx.configuration.isLoadBalanced) {
    // The util client can always point at the single mongos LB frontend.
    utilClient = ctx.configuration.newClient(ctx.configuration.singleMongosLoadBalancerUri);
  } else {
    utilClient = ctx.configuration.newClient();
  }

  let entities: EntitiesMap;
  try {
    trace('\n starting test:');
    try {
      await utilClient.connect();
    } catch (error) {
      console.error(
        ejson`failed to connect utilClient ${utilClient.s.url} - ${utilClient.options}`
      );
      throw error;
    }

    // terminate all sessions before each test suite
    await terminateOpenTransactions(utilClient);

    // Must fetch parameters before checking runOnRequirements
    ctx.configuration.parameters = await utilClient.db().admin().command({ getParameter: '*' });

    // If test.runOnRequirements is specified, the test runner MUST skip the test unless one or more
    // runOnRequirement objects are satisfied.
    const suiteRequirements = unifiedSuite.runOnRequirements ?? [];
    const testRequirements = test.runOnRequirements ?? [];

    trace('satisfiesRequirements');
    const isSomeSuiteRequirementMet =
      !suiteRequirements.length ||
      (await isAnyRequirementSatisfied(ctx, suiteRequirements, utilClient));
    const isSomeTestRequirementMet =
      isSomeSuiteRequirementMet &&
      (!testRequirements.length ||
        (await isAnyRequirementSatisfied(ctx, testRequirements, utilClient)));

    if (!isSomeTestRequirementMet) {
      return ctx.skip();
    }

    // If initialData is specified, for each collectionData therein the test runner MUST drop the
    // collection and insert the specified documents (if any) using a "majority" write concern. If no
    // documents are specified, the test runner MUST create the collection with a "majority" write concern.
    // The test runner MUST use the internal MongoClient for these operations.
    if (unifiedSuite.initialData) {
      trace('initialData');
      for (const collData of unifiedSuite.initialData) {
        const db = utilClient.db(collData.databaseName);
        const collection = db.collection(collData.collectionName, {
          writeConcern: { w: 'majority' }
        });

        trace('listCollections');
        const collectionList = await db
          .listCollections({ name: collData.collectionName })
          .toArray();
        if (collectionList.length !== 0) {
          trace('drop');
          expect(await collection.drop()).to.be.true;
        }
      }

      for (const collData of unifiedSuite.initialData) {
        const db = utilClient.db(collData.databaseName);
        const collection = db.collection(collData.collectionName, {
          writeConcern: { w: 'majority' }
        });

        if (!collData.documents?.length) {
          trace('createCollection');
          await db.createCollection(collData.collectionName, {
            writeConcern: { w: 'majority' }
          });
          continue;
        }

        trace('insertMany');
        await collection.insertMany(collData.documents);
      }
    }

    trace('createEntities');
    entities = await EntitiesMap.createEntities(ctx.configuration, unifiedSuite.createEntities);

    // Workaround for SERVER-39704:
    // test runners MUST execute a non-transactional distinct command on
    // each mongos server before running any test that might execute distinct within a transaction.
    // To ease the implementation, test runners MAY execute distinct before every test.
    const topologyType = ctx.configuration.topologyType;
    if (topologyType === TopologyType.Sharded || topologyType === TopologyType.LoadBalanced) {
      for (const [, collection] of entities.mapOf('collection')) {
        try {
          // TODO(NODE-4238): create / cleanup entities for each test suite
          await utilClient.db(ns(collection.namespace).db).command({
            distinct: collection.collectionName,
            key: '_id'
          });
        } catch (err) {
          // https://jira.mongodb.org/browse/SERVER-60533
          // distinct throws namespace not found errors on servers 5.2.2 and under.
          // For now, we skip these errors to be addressed in NODE-4238.
          if (err.code !== MONGODB_ERROR_CODES.NamespaceNotFound) {
            throw err;
          }
          const serverVersion = ctx.configuration.version;
          if (semverGte(serverVersion, '5.2.2')) {
            throw err;
          }
        }
      }
    }

    for (const operation of test.operations) {
      trace(operation.name);
      try {
        await executeOperationAndCheck(operation, entities, utilClient);
      } catch (e) {
        // clean up all sessions on failed test, and rethrow
        await terminateOpenTransactions(utilClient);
        throw e;
      }
    }

    const clientCommandEvents = new Map<string, CommandEvent[]>();
    const clientCmapEvents = new Map<string, CmapEvent[]>();
    // If any event listeners were enabled on any client entities,
    // the test runner MUST now disable those event listeners.
    for (const [id, client] of entities.mapOf('client')) {
      clientCommandEvents.set(id, client.stopCapturingCommandEvents());
      clientCmapEvents.set(id, client.stopCapturingCmapEvents());
    }

    if (test.expectEvents) {
      for (const expectedEventsForClient of test.expectEvents) {
        const clientId = expectedEventsForClient.client;
        const eventType = expectedEventsForClient.eventType;
        // If no event type is provided it defaults to 'command', so just
        // check for 'cmap' here for now.
        const actualEvents =
          eventType === 'cmap' ? clientCmapEvents.get(clientId) : clientCommandEvents.get(clientId);

        expect(actualEvents, `No client entity found with id ${clientId}`).to.exist;
        matchesEvents(expectedEventsForClient, actualEvents, entities);
      }
    }

    if (test.outcome) {
      for (const collectionData of test.outcome) {
        const collection = utilClient
          .db(collectionData.databaseName)
          .collection(collectionData.collectionName);
        const findOpts = {
          readConcern: 'local' as const,
          readPreference: ReadPreference.primary,
          sort: { _id: 'asc' as const }
        };
        const documents = await collection.find({}, findOpts).toArray();

        expect(documents).to.have.lengthOf(collectionData.documents.length);
        for (const [expected, actual] of zip(collectionData.documents, documents)) {
          expect(actual).to.deep.include(expected);
        }
      }
    }
  } finally {
    await utilClient.close();
    await entities?.cleanup();
  }
}

export function runUnifiedSuite(specTests: uni.UnifiedSuite[], testsToSkip?: string[]): void {
  for (const unifiedSuite of specTests) {
    context(String(unifiedSuite.description), function () {
      for (const test of unifiedSuite.tests) {
        it(String(test.description), async function () {
          await runUnifiedTest(this, unifiedSuite, test, testsToSkip);
        });
      }
    });
  }
}
