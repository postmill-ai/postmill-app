import { ioRedis } from './redis.service';

// Single-shot distributed lock for `@Cron` jobs that must run once per cluster (not once
// per replica). `SET key val NX EX ttl` is atomic: only the first replica to write the key
// gets 'OK'; everyone else gets null until the TTL elapses. No renewal — sized for a single
// sweep, so pick a TTL longer than the job's worst-case runtime.
//
// On MockRedis / no real Redis (no `REDIS_URL`) we are single-instance dev, so always grant
// the lock — the MockRedis stub ignores the NX/EX args anyway.
export async function acquireLock(key: string, ttlSec: number): Promise<boolean> {
  if (!process.env.REDIS_URL) {
    return true;
  }

  const result = await ioRedis.set(key, '1', 'EX', ttlSec, 'NX');
  return result === 'OK';
}
