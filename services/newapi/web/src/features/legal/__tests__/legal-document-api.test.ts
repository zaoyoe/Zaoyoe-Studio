import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { api } from '@/lib/api'

import { getLegalDocument } from '../api'
import type { LegalDocumentId } from '../types'

const originalGet = api.get

afterEach(() => {
  api.get = originalGet
})

test('each legal document loads from its own fixed public endpoint', async () => {
  const requestedEndpoints: string[] = []
  api.get = (async (url: string) => {
    requestedEndpoints.push(url)
    return {
      data: {
        success: true,
        data: url,
      },
    }
  }) as typeof api.get

  const documents: ReadonlyArray<[LegalDocumentId, string]> = [
    ['terms', '/api/user-agreement'],
    ['privacy', '/api/privacy-policy'],
    ['acceptable-use', '/api/acceptable-use'],
    ['refund', '/api/refund-policy'],
    ['restricted-regions', '/api/restricted-regions'],
  ]

  for (const [documentId, endpoint] of documents) {
    const response = await getLegalDocument(documentId)
    assert.equal(response.data, endpoint)
  }

  assert.deepEqual(
    requestedEndpoints,
    documents.map(([, endpoint]) => endpoint)
  )
})
