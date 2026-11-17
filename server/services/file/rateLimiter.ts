import { defaultRateLimitStore } from './rateLimitStores'

export interface RateLimitResult {
  allowed: boolean
  /**
   * Count in the current window after this call: including the reserved
   * amount when allowed, excluding it when refused.
   */
  currentCount: number
}

/**
 * Backend of the rate limiter. Each implementation must make `reserve`
 * atomic for one key: either add `amount` and allow, or refuse without
 * consuming anything.
 */
export interface RateLimitStore {
  /**
   * Adds `amount` to the counter at `key` unless the result would exceed
   * `max`. The first write of a key sets its expiry to `ttlMs`; later
   * writes keep that absolute expiry instead of extending it.
   */
  reserve: (key: string, amount: number, max: number, ttlMs: number) => Promise<RateLimitResult>
  /** Current counter at `key`, 0 when absent. */
  read: (key: string) => Promise<number>
}

/**
 * Fixed window bucket containing `nowMs`: its key suffix and the time left
 * until it ends, so every write can pin the expiry to the bucket end.
 */
export const fixedWindowBucket = (nowMs: number, windowMs: number) => {
  const bucket = Math.floor(nowMs / windowMs)
  return { bucket, remainingMs: (bucket + 1) * windowMs - nowMs }
}

/**
 * Per-user fixed-window upload limiter. A window starts at a multiple of
 * the window size; its counter expires when the window ends.
 */
export class UploadRateLimiter {
  private readonly windowMs: number

  constructor(
    windowSizeMinutes: number,
    private readonly maxUploadsPerWindow: number,
    private readonly store: RateLimitStore = defaultRateLimitStore(),
    private readonly now: () => number = Date.now
  ) {
    this.windowMs = windowSizeMinutes * 60 * 1000
  }

  private currentBucket(userId: string) {
    const { bucket, remainingMs } = fixedWindowBucket(this.now(), this.windowMs)
    return { key: `upload_rate_limit:${userId}:${bucket}`, remainingMs }
  }

  /**
   * Reserves `incrementBy` uploads for `userId` in the current window, or
   * refuses without consuming any. Fails closed: a store error refuses.
   *
   * @throws {RangeError} when `incrementBy` is not a positive integer.
   */
  async checkAndIncrement(userId: string, incrementBy: number = 1): Promise<RateLimitResult> {
    if (!Number.isSafeInteger(incrementBy) || incrementBy <= 0) {
      throw new RangeError('incrementBy must be a positive integer')
    }
    const { key, remainingMs } = this.currentBucket(userId)

    try {
      return await this.store.reserve(key, incrementBy, this.maxUploadsPerWindow, remainingMs)
    } catch (error) {
      console.error('Rate limiter error:', error)
      return { allowed: false, currentCount: 0 }
    }
  }

  /**
   * Count of uploads reserved by `userId` in the current window.
   *
   * Store errors propagate instead of reading as 0: a caller that used a
   * silent 0 to allow an action would fail open.
   */
  async getCurrentCount(userId: string): Promise<number> {
    return this.store.read(this.currentBucket(userId).key)
  }
}
