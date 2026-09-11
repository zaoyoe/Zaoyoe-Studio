/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

export type SupportMessageAuthor = 'user' | 'agent' | 'system'
export type SupportMessageKind = 'text' | 'image'

export type SupportMessage = {
  id: string
  text: string
  author: SupportMessageAuthor
  kind: SupportMessageKind
  createdAt: string
  clientMessageId?: string
}

export type SupportPageContext = {
  path: string
  title?: string
  section?: string
  requestId?: string
}

export type SupportConversation = {
  id?: string
  status?: string
}

export type SupportContext = {
  conversation?: SupportConversation
  messages?: SupportMessage[]
  unreadCount?: number
}

export type SupportMessagesPage = {
  messages: SupportMessage[]
  nextCursor?: string
}

export type SendSupportMessageInput = {
  text?: string
  kind?: SupportMessageKind
  imageData?: string
  clientMessageId: string
  page: SupportPageContext
}
