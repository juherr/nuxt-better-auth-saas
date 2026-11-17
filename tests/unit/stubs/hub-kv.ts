// Stand-in for NuxtHub's generated `hub:kv` module in unit tests.
const store = new Map<string, unknown>()

// Options passed to each `set`, in call order, so tests can assert TTLs.
export const kvSetCalls: Array<{ key: string, value: unknown, options: unknown }> = []

export const kv = {
  get: async (key: string) => store.get(key) ?? null,
  set: async (key: string, value: unknown, options?: unknown) => {
    kvSetCalls.push({ key, value, options })
    store.set(key, value)
  },
  del: async (key: string) => {
    store.delete(key)
  }
}

export const resetKvStub = () => {
  store.clear()
  kvSetCalls.length = 0
}
