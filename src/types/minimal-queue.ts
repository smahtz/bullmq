import { QueueBase } from '../classes/queue-base';

export type MinimalQueue = Pick<
  QueueBase,
  | 'name'
  | 'client'
  | 'toKey'
  | 'keys'
  | 'opts'
  | 'qualifiedName'
  | 'closing'
  | 'waitUntilReady'
  | 'removeListener'
  | 'parse'
  | 'stringify'
  | 'emit'
  | 'on'
  | 'redisVersion'
>;
