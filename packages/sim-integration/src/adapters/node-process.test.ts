import { PassThrough, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createNodeProcessIoAdapter } from './node-process.ts';

class RecordingWritable extends Writable {
  readonly writes: string[] = [];

  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.writes.push(chunk.toString());
    callback();
  }
}

describe('createNodeProcessIoAdapter', () => {
  it('writes stdin messages directly to the provided writable stream', () => {
    const stdin = new RecordingWritable();
    const stdout = new PassThrough();
    const adapter = createNodeProcessIoAdapter({ stdin, stdout });

    adapter.writeStdin('SugarShare\n');

    expect(stdin.writes).toEqual(['SugarShare\n']);
  });

  it('throws when stdin is not writable', () => {
    const adapter = createNodeProcessIoAdapter({
      stdin: {
        writable: false,
        write: () => true,
      } as unknown as Writable,
      stdout: new PassThrough(),
    });

    expect(() => adapter.writeStdin('SugarQuit\n')).toThrowError(
      new Error('process stdin is not writable'),
    );
  });

  it('subscribes stdout line reads and calls close hook on EOF', async () => {
    const stdin = new RecordingWritable();
    const stdout = new PassThrough();
    const adapter = createNodeProcessIoAdapter({ stdin, stdout });

    const lines: string[] = [];
    const closeSignals: string[] = [];

    const closed = new Promise<void>((resolve) => {
      adapter.subscribeStdoutLines({
        onLine(line) {
          lines.push(line);
        },
        onClose() {
          closeSignals.push('closed');
          resolve();
        },
      });
    });

    stdout.write('PlaySound Bulldozer\nPlaySound   Siren\n');
    stdout.end();
    await closed;

    expect(lines).toEqual(['PlaySound Bulldozer', 'PlaySound   Siren']);
    expect(closeSignals).toEqual(['closed']);
  });

  it('stops delivering lines after subscription close and allows idempotent close', async () => {
    const stdout = new PassThrough();
    const adapter = createNodeProcessIoAdapter({
      stdin: new RecordingWritable(),
      stdout,
    });

    const lines: string[] = [];
    const closes: string[] = [];
    const subscription = adapter.subscribeStdoutLines({
      onLine(line) {
        lines.push(line);
      },
      onClose() {
        closes.push('close');
      },
    });

    subscription.close();
    subscription.close();

    stdout.write('PlaySound Ignored\n');
    stdout.end();
    await flushEvents();

    expect(lines).toEqual([]);
    expect(closes).toEqual([]);
  });
});

async function flushEvents(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
