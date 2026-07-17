import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Tool } from './tool.decorator';

describe('@Tool decorator', () => {
  it('stores metadata on the target prototype', () => {
    class TestClass {
      @Tool({ description: 'Do something', dataSchema: [{ key: 'arg1', type: 'string', description: 'First arg' }] })
      myMethod() {}
    }

    const metadata = Reflect.getMetadata('custom:tool', TestClass.prototype);
    expect(metadata).toHaveLength(1);
    expect(metadata[0]).toMatchObject({
      methodName: 'myMethod',
      description: 'Do something',
      dataSchema: [{ key: 'arg1', type: 'string', description: 'First arg' }],
    });
  });

  it('accumulates multiple @Tool decorators on different methods', () => {
    class TestClass {
      @Tool({ description: 'First tool', dataSchema: [] })
      methodOne() {}

      @Tool({ description: 'Second tool', dataSchema: [{ key: 'x', type: 'number', description: 'Value' }] })
      methodTwo() {}
    }

    const metadata = Reflect.getMetadata('custom:tool', TestClass.prototype);
    expect(metadata).toHaveLength(2);
    expect(metadata[0].methodName).toBe('methodOne');
    expect(metadata[1].methodName).toBe('methodTwo');
  });

  it('works on methods with no existing metadata (initializes empty array)', () => {
    class TestClass {
      @Tool({ description: 'Only tool', dataSchema: [] })
      singleMethod() {}
    }

    const metadata = Reflect.getMetadata('custom:tool', TestClass.prototype);
    expect(metadata).toHaveLength(1);
    expect(metadata[0].methodName).toBe('singleMethod');
  });
});
