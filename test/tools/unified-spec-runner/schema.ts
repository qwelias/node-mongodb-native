import { ServerApiVersion } from '../../../src';
import type { Document, ObjectId } from '../../../src/bson';
import type { ReadConcernLevel } from '../../../src/read_concern';
import type { ReadPreferenceMode } from '../../../src/read_preference';
import type { TagSet } from '../../../src/sdam/server_description';
import type { W } from '../../../src/write_concern';

export const SupportedVersion = '^1.0';

export const OperationNames = [
  'abortTransaction',
  'aggregate',
  'assertCollectionExists',
  'assertCollectionNotExists',
  'assertIndexExists',
  'assertIndexNotExists',
  'assertDifferentLsidOnLastTwoCommands',
  'assertSameLsidOnLastTwoCommands',
  'assertSessionDirty',
  'assertSessionNotDirty',
  'assertSessionPinned',
  'assertSessionUnpinned',
  'assertSessionTransactionState',
  'assertNumberConnectionsCheckedOut',
  'bulkWrite',
  'close',
  'commitTransaction',
  'createChangeStream',
  'createCollection',
  'createFindCursor',
  'createIndex',
  'deleteOne',
  'dropCollection',
  'endSession',
  'find',
  'findOneAndReplace',
  'findOneAndUpdate',
  'findOneAndDelete',
  'failPoint',
  'insertOne',
  'insertMany',
  'iterateUntilDocumentOrError',
  'listCollections',
  'listDatabases',
  'listIndexes',
  'replaceOne',
  'startTransaction',
  'targetedFailPoint',
  'delete',
  'download',
  'upload',
  'withTransaction',
  'countDocuments',
  'deleteMany',
  'distinct',
  'estimatedDocumentCount',
  'runCommand',
  'updateMany',
  'updateOne',
  'rename'
] as const;
export type OperationName = typeof OperationNames[number];

export interface OperationDescription {
  name: OperationName;
  object: string;
  arguments?: Document;
  expectError?: ExpectedError;
  expectResult?: unknown;
  saveResultAsEntity?: string;
  ignoreResultAndError?: boolean;
}
export interface UnifiedSuite {
  description: string;
  schemaVersion: string;
  runOnRequirements?: RunOnRequirement[];
  createEntities?: EntityDescription[];
  /** Data inserted before **all tests */
  initialData?: CollectionData[];
  tests: Test[];
  _yamlAnchors?: Document;
}
export const TopologyType = Object.freeze({
  single: 'single',
  replicaset: 'replicaset',
  sharded: 'sharded',
  shardedReplicaset: 'sharded-replicaset',
  loadBalanced: 'load-balanced'
} as const);
export type TopologyId = typeof TopologyType[keyof typeof TopologyType];
export interface RunOnRequirement {
  serverless?: 'forbid' | 'allow' | 'require';
  auth?: boolean;
  maxServerVersion?: string;
  minServerVersion?: string;
  topologies?: TopologyId[];
  serverParameters?: Document;
}
export type ObservableCommandEventId =
  | 'commandStartedEvent'
  | 'commandSucceededEvent'
  | 'commandFailedEvent';
export type ObservableCmapEventId =
  | 'connectionPoolCreatedEvent'
  | 'connectionPoolClosedEvent'
  | 'connectionPoolClearedEvent'
  | 'connectionCreatedEvent'
  | 'connectionReadyEvent'
  | 'connectionClosedEvent'
  | 'connectionCheckOutStartedEvent'
  | 'connectionCheckOutFailedEvent'
  | 'connectionCheckedOutEvent'
  | 'connectionCheckedInEvent';

export interface ClientEntity {
  id: string;
  uriOptions?: Document;
  useMultipleMongoses?: boolean;
  observeEvents?: (ObservableCommandEventId | ObservableCmapEventId)[];
  ignoreCommandMonitoringEvents?: string[];
  serverApi?: ServerApi;
}
export interface DatabaseEntity {
  id: string;
  client: string;
  databaseName: string;
  databaseOptions?: CollectionOrDatabaseOptions;
}
export interface CollectionEntity {
  id: string;
  database: string;
  collectionName: string;
  collectionOptions?: CollectionOrDatabaseOptions;
}
export interface SessionEntity {
  id: string;
  client: string;
  sessionOptions?: Document;
}
export interface BucketEntity {
  id: string;
  database: string;
  bucketOptions?: Document;
}
export interface StreamEntity {
  id: string;
  hexBytes: string;
}
export type EntityDescription =
  | { client: ClientEntity }
  | { database: DatabaseEntity }
  | { collection: CollectionEntity }
  | { bucket: BucketEntity }
  | { stream: StreamEntity }
  | { session: SessionEntity };
export interface ServerApi {
  version: ServerApiVersion;
  strict?: boolean;
  deprecationErrors?: boolean;
}
export interface CollectionOrDatabaseOptions {
  readConcern?: {
    level: ReadConcernLevel;
  };
  readPreference?: {
    mode: ReadPreferenceMode;
    maxStalenessSeconds: number;
    tags: TagSet[];
    hedge: { enabled: boolean };
  };
  writeConcern?: {
    w: W;
    wtimeoutMS: number;
    journal: boolean;
  };
}
export interface CollectionData {
  collectionName: string;
  databaseName: string;
  documents: Document[];
}
export interface Test {
  description: string;
  runOnRequirements?: RunOnRequirement[];
  skipReason?: string;
  operations: OperationDescription[];
  expectEvents?: ExpectedEventsForClient[];
  outcome?: CollectionData[];
}
export interface ExpectedEventsForClient {
  client: string;
  eventType?: string;
  events: (ExpectedCommandEvent | ExpectedCmapEvent)[];
  ignoreExtraEvents?: boolean;
}
export interface ExpectedCommandEvent {
  commandStartedEvent?: {
    command?: Document;
    commandName?: string;
    databaseName?: string;
  };
  commandSucceededEvent?: {
    reply?: Document;
    commandName?: string;
  };
  commandFailedEvent?: {
    commandName?: string;
  };
}
export interface ExpectedCmapEvent {
  poolCreatedEvent?: Record<string, never>;
  poolReadyEvent?: Record<string, never>;
  poolClearedEvent?: {
    serviceId?: ObjectId;
    hasServiceId?: boolean;
  };
  poolClosedEvent?: Record<string, never>;
  connectionCreatedEvent?: Record<string, never>;
  connectionReadyEvent?: Record<string, never>;
  connectionClosedEvent?: {
    reason?: string;
    hasServiceId?: boolean;
  };
  connectionCheckOutStartedEvent?: Record<string, never>;
  connectionCheckOutFailedEvent?: Record<string, never>;
  connectionCheckedOutEvent?: Record<string, never>;
  connectionCheckedInEvent?: Record<string, never>;
}
export interface ExpectedError {
  isError?: true;
  isClientError?: boolean;
  errorContains?: string;
  errorCode?: number;
  errorCodeName?: string;
  errorLabelsContain?: string[];
  errorLabelsOmit?: string[];
  expectResult?: unknown;
}
