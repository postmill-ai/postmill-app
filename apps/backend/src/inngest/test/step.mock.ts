import { vi } from 'vitest';

export const createMockStep = () => ({
  run: vi.fn().mockImplementation(async (_name: string, fn: () => any) => fn()),
  sleep: vi.fn().mockResolvedValue(undefined),
  sendEvent: vi.fn().mockResolvedValue(undefined),
  waitForEvent: vi.fn().mockResolvedValue(undefined),
});

export const captureFunctionHandler = (createFunctionMock: ReturnType<typeof vi.fn>) => {
  let handler: any;
  createFunctionMock.mockImplementation((_opts: any, _trigger: any, fn: any) => {
    handler = fn;
    return { id: 'mock' } as any;
  });
  return () => handler;
};
