import { expect } from 'chai';
import { default as IORedis } from 'ioredis';
import { after } from 'lodash';
import { FlowProducer, Job, Queue, QueueEvents, Worker } from '../src/classes';
import { beforeEach } from 'mocha';
import { v4 } from 'uuid';
import { delay, removeAllQueueData } from '../src/utils';
import { Child } from '../src/classes/child';
const { stdout, stderr } = require('test-console');

describe('Sandboxed process using child processes', () => {
  sandboxProcessTests();
});

describe('Sandboxed process using worker threads', () => {
  sandboxProcessTests({ useWorkerThreads: true });
});

function sandboxProcessTests(
  { useWorkerThreads } = { useWorkerThreads: false },
) {
  describe('sandboxed process', () => {
    let queue: Queue;
    let queueEvents: QueueEvents;
    let queueName: string;

    const connection = { host: 'localhost' };

    beforeEach(async function () {
      queueName = `test-${v4()}`;
      queue = new Queue(queueName, { connection });
      queueEvents = new QueueEvents(queueName, { connection });
      await queueEvents.waitUntilReady();
    });

    afterEach(async function () {
      await queue.close();
      await queueEvents.close();
      await removeAllQueueData(new IORedis(), queueName);
    });

    it('should process and complete', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        drainDelay: 1,
        useWorkerThreads,
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql(42);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
            await worker.close();
            resolve();
          } catch (err) {
            await worker.close();
            reject(err);
          }
        });
      });

      await queue.add('test', { foo: 'bar' });

      await completing;

      await worker.close();
    });

    describe('when processor has more than 2 params', () => {
      it('should ignore extra params, process and complete', async () => {
        const processFile =
          __dirname + '/fixtures/fixture_processor_with_extra_param.js';

        const worker = new Worker(queueName, processFile, {
          connection,
          drainDelay: 1,
          useWorkerThreads,
        });

        const completing = new Promise<void>((resolve, reject) => {
          worker.on('completed', async (job: Job, value: any) => {
            try {
              expect(job.data).to.be.eql({ foo: 'bar' });
              expect(value).to.be.eql(42);
              expect(
                Object.keys(worker['childPool'].retained),
              ).to.have.lengthOf(0);
              expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
              await worker.close();
              resolve();
            } catch (err) {
              await worker.close();
              reject(err);
            }
          });
        });

        await queue.add('test', { foo: 'bar' });

        await completing;

        await worker.close();
      });
    });

    describe('when processor file is .cjs (CommonJS)', () => {
      it('processes and completes', async () => {
        const processFile = __dirname + '/fixtures/fixture_processor.cjs';
        const worker = new Worker(queueName, processFile, {
          autorun: false,
          connection,
          drainDelay: 1,
          useWorkerThreads,
        });

        const completing = new Promise<void>((resolve, reject) => {
          worker.on('completed', async (job: Job, value: any) => {
            try {
              expect(job.data).to.be.eql({ foo: 'bar' });
              expect(value).to.be.eql(42);
              expect(
                Object.keys(worker['childPool'].retained),
              ).to.have.lengthOf(0);
              expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
              await worker.close();
              resolve();
            } catch (err) {
              await worker.close();
              reject(err);
            }
          });
        });

        worker.run();

        await queue.add('foobar', { foo: 'bar' });

        await completing;
      });
    });

    describe('when there is an output from stdout', () => {
      it('uses the parent stdout', async () => {
        const processFile = __dirname + '/fixtures/fixture_processor_stdout.js';

        const worker = new Worker(queueName, processFile, {
          connection,
          drainDelay: 1,
          useWorkerThreads,
        });

        const completing = new Promise<void>(resolve => {
          worker.on('completed', async (job: Job, value: any) => {
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql(1);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
            resolve();
          });
        });
        const inspect = stdout.inspect();

        await queue.add('test', { foo: 'bar' });

        let output = '';
        inspect.on('data', (chunk: string) => {
          output += chunk;
        });

        await completing;
        inspect.restore();

        expect(output).to.be.equal('message\n');

        await worker.close();
      });
    });

    describe('when there is an output from stderr', () => {
      it('uses the parent stderr', async () => {
        const processFile = __dirname + '/fixtures/fixture_processor_stderr.js';

        const worker = new Worker(queueName, processFile, {
          connection,
          drainDelay: 1,
          useWorkerThreads,
        });

        const completing = new Promise<void>(resolve => {
          worker.on('completed', async (job: Job, value: any) => {
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql(1);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
            resolve();
          });
        });
        const inspect = stderr.inspect();

        await queue.add('test', { foo: 'bar' });

        let output = '';
        inspect.on('data', (chunk: string) => {
          output += chunk;
        });

        await completing;
        inspect.restore();

        expect(output).to.be.equal('error message\n');

        await worker.close();
      });
    });

    describe('when processor throws UnrecoverableError', () => {
      it('moves job to failed', async function () {
        this.timeout(6000);

        const processFile =
          __dirname + '/fixtures/fixture_processor_unrecoverable.js';

        const worker = new Worker(queueName, processFile, {
          connection,
          drainDelay: 1,
          useWorkerThreads,
        });

        await worker.waitUntilReady();

        const start = Date.now();
        const job = await queue.add(
          'test',
          { foo: 'bar' },
          {
            attempts: 3,
            backoff: 1000,
          },
        );

        await new Promise<void>(resolve => {
          worker.on(
            'failed',
            after(2, (job: Job, error) => {
              const elapse = Date.now() - start;
              expect(error.name).to.be.eql('UnrecoverableError');
              expect(error.message).to.be.eql('Unrecoverable');
              expect(elapse).to.be.greaterThan(1000);
              expect(job.attemptsMade).to.be.eql(2);
              resolve();
            }),
          );
        });

        const state = await job.getState();

        expect(state).to.be.equal('failed');

        await worker.close();
      });
    });

    it('should process with named processor', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor.js';
      const worker = new Worker(queueName, processFile, {
        connection,
        drainDelay: 1,
        useWorkerThreads,
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql(42);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
            await worker.close();
            resolve();
          } catch (err) {
            await worker.close();
            reject(err);
          }
        });
      });

      await queue.add('foobar', { foo: 'bar' });

      await completing;
    });

    it('should process with concurrent processors', async function () {
      this.timeout(10000);

      await Promise.all([
        queue.add('test', { foo: 'bar1' }),
        queue.add('test', { foo: 'bar2' }),
        queue.add('test', { foo: 'bar3' }),
        queue.add('test', { foo: 'bar4' }),
      ]);

      const processFile = __dirname + '/fixtures/fixture_processor_slow.js';
      const worker = new Worker(queueName, processFile, {
        connection,
        concurrency: 4,
        drainDelay: 1,
        useWorkerThreads,
      });

      const completing = new Promise<void>((resolve, reject) => {
        const after4 = after(4, () => {
          expect(worker['childPool'].getAllFree().length).to.eql(4);
          resolve();
        });

        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(value).to.be.eql(42);
            expect(
              Object.keys(worker['childPool'].retained).length +
                worker['childPool'].getAllFree().length,
            ).to.eql(4);
            after4();
          } catch (err) {
            await worker.close();
            reject(err);
          }
        });
      });

      await completing;
      await worker.close();
    });

    it('should reuse process with single processors', async function () {
      this.timeout(30000);

      const processFile = __dirname + '/fixtures/fixture_processor_slow.js';
      const worker = new Worker(queueName, processFile, {
        connection,
        concurrency: 1,
        drainDelay: 1,
        useWorkerThreads,
      });

      await Promise.all([
        queue.add('1', { foo: 'bar1' }),
        queue.add('2', { foo: 'bar2' }),
        queue.add('3', { foo: 'bar3' }),
        queue.add('4', { foo: 'bar4' }),
      ]);

      const completing = new Promise<void>((resolve, reject) => {
        const after4 = after(4, async () => {
          expect(worker['childPool'].getAllFree().length).to.eql(1);
          await worker.close();
          resolve();
        });

        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(value).to.be.eql(42);
            expect(
              Object.keys(worker['childPool'].retained).length +
                worker['childPool'].getAllFree().length,
            ).to.eql(1);
            await after4();
          } catch (err) {
            await worker.close();
            reject(err);
          }
        });
      });

      await completing;
    });

    it('should process and update progress', async () => {
      const processFile =
        __dirname + '/fixtures/fixture_processor_update_progress.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        drainDelay: 1,
        useWorkerThreads,
      });

      const progresses: any[] = [];

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql(37);
            expect(job.progress).to.be.eql(100);
            expect(progresses).to.be.eql([10, 27, 78, 100]);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].getAllFree()).to.have.lengthOf(1);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.on('progress', (job, progress) => {
        progresses.push(progress);
      });

      await queue.add('test', { foo: 'bar' });

      await completing;
      await worker.close();
    });

    it('should process and update data', async () => {
      const processFile =
        __dirname + '/fixtures/fixture_processor_update_data.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        drainDelay: 1,
        useWorkerThreads,
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(job.data).to.be.eql({ foo: 'baz' });
            expect(value).to.be.eql('result');
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].getAllFree()).to.have.lengthOf(1);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue.add('test', { bar: 'foo' });

      await completing;
      await worker.close();
    });

    it('should process and move to delayed', async () => {
      const processFile =
        __dirname + '/fixtures/fixture_processor_move_to_delayed.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        drainDelay: 1,
        useWorkerThreads,
      });

      const delaying = new Promise<void>((resolve, reject) => {
        queueEvents.on('delayed', async ({ delay }) => {
          try {
            expect(Number(delay)).to.be.greaterThanOrEqual(2500);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              1,
            );
            expect(worker['childPool'].getAllFree()).to.have.lengthOf(0);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job) => {
          expect(job.data.bar).to.be.equal('foo');
          resolve();
        });
      });

      const job = await queue.add('test', { bar: 'foo' });

      await delaying;

      const state = await queue.getJobState(job.id!);

      expect(state).to.be.equal('delayed');

      await completing;
      await worker.close();
    });

    describe('when env variables are provided', () => {
      it('shares env variables', async () => {
        const processFile = __dirname + '/fixtures/fixture_processor_env.js';

        const worker = new Worker(queueName, processFile, {
          connection,
          drainDelay: 1,
          useWorkerThreads,
        });

        process.env.variable = 'variable';

        const completing = new Promise<void>((resolve, reject) => {
          worker.on('completed', async (job: Job, value: any) => {
            try {
              expect(job.data).to.be.eql({ foo: 'bar' });
              expect(value).to.be.eql('variable');
              expect(
                Object.keys(worker['childPool'].retained),
              ).to.have.lengthOf(0);
              expect(worker['childPool'].getAllFree()).to.have.lengthOf(1);
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });

        await queue.add('test', { foo: 'bar' });

        await completing;
        process.env.variable = undefined;
        await worker.close();
      });
    });

    it('includes queueName', async () => {
      const processFile =
        __dirname + '/fixtures/fixture_processor_queueName.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        drainDelay: 1,
        useWorkerThreads,
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql(queueName);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
            await worker.close();
            resolve();
          } catch (err) {
            await worker.close();
            reject(err);
          }
        });
      });

      await queue.add('test', { foo: 'bar' });

      await completing;

      await worker.close();
    });

    it('includes parent', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor_parent.js';
      const parentQueueName = `parent-queue-${v4()}`;

      const worker = new Worker(queueName, processFile, {
        connection,
        drainDelay: 1,
        useWorkerThreads,
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql({
              id: 'job-id',
              queueKey: `bull:${parentQueueName}`,
            });
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
            await worker.close();
            resolve();
          } catch (err) {
            await worker.close();
            reject(err);
          }
        });
      });

      const flow = new FlowProducer({ connection });
      await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        opts: { jobId: 'job-id' },
        children: [{ name: 'child-job', data: { foo: 'bar' }, queueName }],
      });

      await completing;

      await worker.close();
      await flow.close();
    });

    it('should process and fail', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor_fail.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        drainDelay: 1,
        useWorkerThreads,
      });

      const failing = new Promise<void>((resolve, reject) => {
        worker.on('failed', async (job, err) => {
          try {
            expect(job.data).eql({ foo: 'bar' });
            expect(job.failedReason).eql('Manually failed processor');
            expect(err.message).eql('Manually failed processor');
            expect(err.stack).include('fixture_processor_fail.js');
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].getAllFree()).to.have.lengthOf(1);

            resolve();
          } catch (err) {
            await worker.close();
            reject(err);
          }
        });
      });

      await queue.add('test', { foo: 'bar' });

      await failing;

      await worker.close();
    });

    it('should error if processor file is missing', async () => {
      let worker;
      let didThrow = false;
      try {
        const missingProcessFile = __dirname + '/fixtures/missing_processor.js';
        worker = new Worker(queueName, missingProcessFile, {
          connection,
          useWorkerThreads,
        });
      } catch (err) {
        didThrow = true;
      }

      worker && (await worker.close());

      if (!didThrow) {
        throw new Error('did not throw error');
      }
    });

    it('should fail if the process crashes', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor_crash.js';

      new Worker(queueName, processFile, {
        connection,
        drainDelay: 1,
        useWorkerThreads,
      });

      const job = await queue.add('test', {});

      await expect(job.waitUntilFinished(queueEvents)).to.be.rejectedWith(
        'boom!',
      );
    });

    it('should fail if the process exits 0', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor_crash.js';

      new Worker(queueName, processFile, {
        connection,
        drainDelay: 1,
        useWorkerThreads,
      });

      const job = await queue.add('test', { exitCode: 0 });

      await expect(job.waitUntilFinished(queueEvents)).to.be.rejectedWith(
        'Unexpected exit code: 0 signal: null',
      );
    });

    it('should fail if the process exits non-0', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor_crash.js';

      new Worker(queueName, processFile, {
        connection,
        drainDelay: 1,
        useWorkerThreads,
      });

      const job = await queue.add('test', { exitCode: 1 });

      await expect(job.waitUntilFinished(queueEvents)).to.be.rejectedWith(
        'Unexpected exit code: 1 signal: null',
      );
    });

    it('should fail if the process file is broken', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor_broken.js';

      new Worker(queueName, processFile, {
        connection,
        drainDelay: 1,
        useWorkerThreads,
      });

      const job = await queue.add('test', { exitCode: 1 });

      await expect(job.waitUntilFinished(queueEvents)).to.be.rejectedWith(
        'Broken file processor',
      );
    });

    describe('when function is not exported', () => {
      it('throws an error', async () => {
        const processFile =
          __dirname + '/fixtures/fixture_processor_missing_function.js';

        new Worker(queueName, processFile, {
          connection,
          drainDelay: 1,
          useWorkerThreads,
        });

        const job = await queue.add('test', {});

        await expect(job.waitUntilFinished(queueEvents)).to.be.rejectedWith(
          'No function is exported in processor file',
        );
      });
    });

    it('should remove exited process', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor_exit.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        drainDelay: 1,
        useWorkerThreads,
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async () => {
          try {
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].getAllFree()).to.have.lengthOf(1);
            await delay(500);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].getAllFree()).to.have.lengthOf(0);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue.add('test', { foo: 'bar' });

      await completing;

      await worker.close();
    });

    it('should allow the job to complete and then exit on worker close', async function () {
      this.timeout(1500000);
      const processFile = __dirname + '/fixtures/fixture_processor_slow.js';
      const worker = new Worker(queueName, processFile, {
        connection,
        useWorkerThreads,
      });

      // acquire and release a child here so we know it has it's full termination handler setup
      const initializedChild = await worker['childPool'].retain(processFile);
      await worker['childPool'].release(initializedChild);

      // await this After we've added the job
      const onJobActive = new Promise<void>(resolve => {
        worker.on('active', (job, prev) => {
          expect(prev).to.be.equal('waiting');
          resolve();
        });
      });

      const jobAdd = queue.add('foo', {});
      await onJobActive;

      expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(1);
      expect(worker['childPool'].getAllFree()).to.have.lengthOf(0);
      const child = Object.values(worker['childPool'].retained)[0] as Child;

      expect(child).to.equal(initializedChild);
      expect(child.exitCode).to.equal(null);
      expect(child.killed).to.equal(false);

      // at this point the job should be active and running on the child
      // trigger a close while we know it's doing work
      await worker.close();

      // ensure the child did get cleaned up
      expect(!!child.killed).to.eql(true);
      expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(0);
      expect(worker['childPool'].getAllFree()).to.have.lengthOf(0);

      const job = await jobAdd;
      // check that the job did finish successfully
      const jobResult = await job.waitUntilFinished(queueEvents);
      expect(jobResult).to.equal(42);
    });
  });
}
