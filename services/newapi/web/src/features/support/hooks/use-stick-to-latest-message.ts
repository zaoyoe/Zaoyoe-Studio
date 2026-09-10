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
import {
  type UIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

type UseStickToLatestMessageOptions = {
  latestMessageID?: string
  loading: boolean
  loadingOlderMessages: boolean
  messagesLength: number
}

const NEAR_BOTTOM_PX = 48

function isNearBottom(list: HTMLDivElement): boolean {
  return list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX
}

export function useStickToLatestMessage({
  latestMessageID,
  loading,
  loadingOlderMessages,
  messagesLength,
}: UseStickToLatestMessageOptions) {
  const messageListRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const didScrollInitialMessagesRef = useRef(false)
  const shouldStickToBottomRef = useRef(true)
  const olderMessagesScrollHeightRef = useRef<number | null>(null)
  const [hasNewMessages, setHasNewMessages] = useState(false)

  const scrollListToEnd = useCallback(() => {
    const list = messageListRef.current
    if (list) {
      list.scrollTop = list.scrollHeight
      return
    }
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [])

  const scrollToLatest = useCallback(() => {
    scrollListToEnd()
    shouldStickToBottomRef.current = true
    setHasNewMessages(false)
  }, [scrollListToEnd])

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const list = event.currentTarget
    if (!list) return
    const nearBottom = isNearBottom(list)
    shouldStickToBottomRef.current = nearBottom
    if (nearBottom) setHasNewMessages(false)
  }, [])

  const captureOlderMessagesScrollHeight = useCallback(() => {
    olderMessagesScrollHeightRef.current =
      messageListRef.current?.scrollHeight ?? null
  }, [])

  useLayoutEffect(() => {
    const list = messageListRef.current
    const previousHeight = olderMessagesScrollHeightRef.current
    if (!list || previousHeight === null || loadingOlderMessages) return

    list.scrollTop += Math.max(0, list.scrollHeight - previousHeight)
    olderMessagesScrollHeightRef.current = null
  }, [loadingOlderMessages, messagesLength])

  useLayoutEffect(() => {
    if (!latestMessageID || loading) {
      if (!latestMessageID) {
        didScrollInitialMessagesRef.current = false
      }
      return
    }

    if (
      !didScrollInitialMessagesRef.current ||
      shouldStickToBottomRef.current
    ) {
      scrollListToEnd()
      shouldStickToBottomRef.current = true
      didScrollInitialMessagesRef.current = true
    }
  }, [latestMessageID, loading, scrollListToEnd])

  useEffect(() => {
    const frame = globalThis.requestAnimationFrame(() => {
      if (!latestMessageID) {
        setHasNewMessages(false)
        return
      }
      if (loading) return
      setHasNewMessages(
        didScrollInitialMessagesRef.current && !shouldStickToBottomRef.current
      )
    })
    return () => globalThis.cancelAnimationFrame(frame)
  }, [latestMessageID, loading])

  return {
    messageListRef,
    endRef,
    hasNewMessages,
    scrollToLatest,
    handleScroll,
    captureOlderMessagesScrollHeight,
  }
}
