/**
 * Admin Channels API endpoints
 * Handles channel management for administrators
 */

import { apiClient } from '../client'
import type { BillingMode, ChannelStatus, BillingModelSource } from '@/constants/channel'

export type { BillingMode } from '@/constants/channel'

export interface PricingInterval {
  id?: number
  min_tokens: number
  max_tokens: number | null
  tier_label: string
  input_price: number | null
  output_price: number | null
  cache_write_price: number | null
  cache_read_price: number | null
  per_request_price: number | null
  sort_order: number
}

export interface ChannelModelPricing {
  id?: number
  platform: string
  models: string[]
  billing_mode: BillingMode
  input_price: number | null
  output_price: number | null
  cache_write_price: number | null
  cache_read_price: number | null
  image_input_price: number | null
  image_output_price: number | null
  per_request_price: number | null
  /** Official/reference price metadata captured from the upstream catalog. */
  upstream_cost_multiplier?: number | null
  upstream_pricing_group?: string
  upstream_pricing_version?: string
  intervals: PricingInterval[]
}

export interface AccountStatsPricingRule {
  id?: number
  name: string
  group_ids: number[]
  account_ids: number[]
  pricing: ChannelModelPricing[]
}

export interface Channel {
  id: number
  name: string
  description: string
  status: ChannelStatus
  billing_model_source: BillingModelSource
  restrict_models: boolean
  features_config?: Record<string, unknown>
  upstream_pricing_source?: {
    type: string
    endpoint: string
  }
  group_ids: number[]
  model_pricing: ChannelModelPricing[]
  model_mapping: Record<string, Record<string, string>> // platform → {src→dst}
  apply_pricing_to_account_stats: boolean
  account_stats_pricing_rules: AccountStatsPricingRule[]
  created_at: string
  updated_at: string
}

export interface CreateChannelRequest {
  name: string
  description?: string
  group_ids?: number[]
  model_pricing?: ChannelModelPricing[]
  model_mapping?: Record<string, Record<string, string>>
  billing_model_source?: string
  restrict_models?: boolean
  features_config?: Record<string, unknown>
  apply_pricing_to_account_stats?: boolean
  account_stats_pricing_rules?: AccountStatsPricingRule[]
}

export interface UpdateChannelRequest {
  name?: string
  description?: string
  status?: string
  group_ids?: number[]
  model_pricing?: ChannelModelPricing[]
  model_mapping?: Record<string, Record<string, string>>
  billing_model_source?: string
  restrict_models?: boolean
  features_config?: Record<string, unknown>
  apply_pricing_to_account_stats?: boolean
  account_stats_pricing_rules?: AccountStatsPricingRule[]
}

interface PaginatedResponse<T> {
  items: T[]
  total: number
}

/**
 * List channels with pagination
 */
export async function list(
  page: number = 1,
  pageSize: number = 20,
  filters?: {
    status?: string
    search?: string
    sort_by?: string
    sort_order?: 'asc' | 'desc'
  },
  options?: { signal?: AbortSignal }
): Promise<PaginatedResponse<Channel>> {
  const { data } = await apiClient.get<PaginatedResponse<Channel>>('/admin/channels', {
    params: {
      page,
      page_size: pageSize,
      ...filters
    },
    signal: options?.signal
  })
  return data
}

/**
 * Get channel by ID
 */
export async function getById(id: number): Promise<Channel> {
  const { data } = await apiClient.get<Channel>(`/admin/channels/${id}`)
  return data
}

/**
 * Create a new channel
 */
export async function create(req: CreateChannelRequest): Promise<Channel> {
  const { data } = await apiClient.post<Channel>('/admin/channels', req)
  return data
}

/**
 * Update a channel
 */
export async function update(id: number, req: UpdateChannelRequest): Promise<Channel> {
  const { data } = await apiClient.put<Channel>(`/admin/channels/${id}`, req)
  return data
}

/**
 * Delete a channel
 */
export async function remove(id: number): Promise<void> {
  await apiClient.delete(`/admin/channels/${id}`)
}

export interface ModelDefaultPricing {
  found: boolean
  input_price?: number    // per-token price
  output_price?: number
  cache_write_price?: number
  cache_read_price?: number
  image_input_price?: number
  image_output_price?: number
}

export async function getModelDefaultPricing(model: string): Promise<ModelDefaultPricing> {
  const { data } = await apiClient.get<ModelDefaultPricing>('/admin/channels/model-pricing', {
    params: { model }
  })
  return data
}

export interface GlobalPricingStatus {
  model_count: number
  last_updated?: string
  last_update_attempt?: string
  last_update_error?: string
  local_hash?: string
  update_interval_hours: number
  source?: string
}

export async function getGlobalPricingStatus(): Promise<GlobalPricingStatus> {
  const { data } = await apiClient.get<GlobalPricingStatus>('/admin/channels/pricing/global')
  return data
}

export async function updateGlobalPricing(): Promise<GlobalPricingStatus> {
  const { data } = await apiClient.post<GlobalPricingStatus>('/admin/channels/pricing/global/update')
  return data
}

export interface SyncPricingModelsResult {
  models: string[]
}

export interface SyncUpstreamPricingRequest {
  platform: string
  group?: string
  models?: string[]
  endpoint?: string
}

export interface UpstreamPricingGroupOption {
  name: string
  ratio: number
}

export interface UpstreamPricingGroupsResult {
  groups: UpstreamPricingGroupOption[]
  pricing_version: string
}

export interface SyncUpstreamPricingResult {
  channel: Channel
  platform: string
  pricing_version: string
  added: number
  updated: number
  unchanged: number
  missing: number
  skipped: number
  groups: Record<string, number>
  warnings: string[]
  details: Array<{
    model: string
    status: 'updated' | 'unchanged' | 'missing' | 'skipped'
    group?: string
    group_ratio?: number
    reason?: string
  }>
}

/**
 * Fetch the latest model names from the LiteLLM pricing catalog for the given platform
 */
export async function syncPricingModels(platform: string): Promise<SyncPricingModelsResult> {
  const { data } = await apiClient.get<SyncPricingModelsResult>('/admin/channels/pricing/sync-models', {
    params: { platform }
  })
  return data
}

/**
 * Synchronize the selected channel's upstream model-plaza pricing.
 * The channel's own group rate multipliers are left untouched by this call.
 */
export async function syncUpstreamPricing(
  id: number,
  req: SyncUpstreamPricingRequest,
): Promise<SyncUpstreamPricingResult> {
  const { data } = await apiClient.post<SyncUpstreamPricingResult>(
    `/admin/channels/${id}/pricing/sync-upstream`,
    req,
  )
  return data
}

export async function listUpstreamPricingGroups(endpoint?: string): Promise<UpstreamPricingGroupsResult> {
  const { data } = await apiClient.get<UpstreamPricingGroupsResult>(
    '/admin/channels/pricing/upstream-groups',
    { params: endpoint ? { endpoint } : undefined },
  )
  return data
}

const channelsAPI = {
  list,
  getById,
  create,
  update,
  remove,
  getModelDefaultPricing,
  getGlobalPricingStatus,
  updateGlobalPricing,
  syncPricingModels,
  syncUpstreamPricing,
  listUpstreamPricingGroups,
}
export default channelsAPI
