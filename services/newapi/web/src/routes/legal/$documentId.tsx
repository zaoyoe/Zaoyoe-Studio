import { createFileRoute } from '@tanstack/react-router'

import { LegalDocumentPage } from '@/features/legal'

export const Route = createFileRoute('/legal/$documentId')({
  component: LegalDocumentRoute,
})

function LegalDocumentRoute() {
  const { documentId } = Route.useParams()
  return <LegalDocumentPage documentId={documentId} />
}
