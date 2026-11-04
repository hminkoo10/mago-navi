import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./preload.js', import.meta.url), 'utf8');
it('고정 IPC만 노출하고 이벤트 인수는 숨기며 구독을 해제한다', async () => {
  const contextBridge = { exposeInMainWorld: vi.fn() };
  const ipcRenderer = { invoke: vi.fn(async () => null), on: vi.fn(), removeListener: vi.fn() };
  runInNewContext(source, { require: () => ({ contextBridge, ipcRenderer }), process: { isMainFrame: true } });
  const [name, api] = contextBridge.exposeInMainWorld.mock.calls[0];
  expect(name).toBe('magoNaviRoster');
  expect(Object.keys(api)).toEqual(['get', 'onChanged']);
  await api.get('/private/path');
  expect(ipcRenderer.invoke).toHaveBeenCalledWith('academy-roster:get');
  const cb = vi.fn();
  const stop = api.onChanged(cb);
  const [channel, listener] = ipcRenderer.on.mock.calls[0];
  listener({ sender: 'privileged' }, { secret: true });
  expect(cb).toHaveBeenCalledWith();
  stop();
  expect(ipcRenderer.removeListener).toHaveBeenCalledWith(channel, listener);
});

it('iframe에서는 bridge를 노출하지 않는다', () => {
  const exposeInMainWorld = vi.fn();
  runInNewContext(source, { require: () => ({ contextBridge: { exposeInMainWorld }, ipcRenderer: {} }), process: { isMainFrame: false } });
  expect(exposeInMainWorld).not.toHaveBeenCalled();
});
