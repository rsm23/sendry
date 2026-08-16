import { describe, expect, it } from 'vitest'
import { MemoryKnowledgeVectorStore } from '../server/knowledge/vector-store'

describe('knowledge vector isolation', () => {
  it('requires both brand and widget filters for every query and cleanup', async () => {
    const store = new MemoryKnowledgeVectorStore()
    await store.upsert('profile-a', [
      { chunkId: 'a', documentId: 'doc-a', brandId: 'brand-a', widgetId: 'widget-a', vector: [1, 0] },
      { chunkId: 'b', documentId: 'doc-b', brandId: 'brand-a', widgetId: 'widget-b', vector: [1, 0] },
      { chunkId: 'c', documentId: 'doc-c', brandId: 'brand-b', widgetId: 'widget-a', vector: [1, 0] },
    ])
    await expect(store.query('profile-a', 'brand-a', 'widget-a', [1, 0], 20)).resolves.toEqual([{ chunkId: 'a', score: 1 }])
    await store.removeDocument('profile-a', 'brand-a', 'widget-a', 'doc-a')
    await expect(store.query('profile-a', 'brand-a', 'widget-a', [1, 0], 20)).resolves.toEqual([])
    await expect(store.query('profile-a', 'brand-a', 'widget-b', [1, 0], 20)).resolves.toEqual([{ chunkId: 'b', score: 1 }])
  })
})
