<template>
  <BaseDialog
    :show="show"
    :title="t('admin.accounts.dataImportTitle')"
    width="normal"
    close-on-click-outside
    @close="handleClose"
  >
    <form id="import-data-form" class="space-y-4" @submit.prevent="handleImport">
      <div class="text-sm text-gray-600 dark:text-dark-300">
        {{ t('admin.accounts.dataImportHint') }}
      </div>
      <div
        class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-600 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400"
      >
        {{ t('admin.accounts.dataImportWarning') }}
      </div>

      <div
        class="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-700 dark:bg-blue-900/20"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-blue-900 dark:text-blue-200">
              {{ t('admin.accounts.dataImportLocalExportTitle') }}
            </div>
            <div class="mt-1 text-xs text-blue-700 dark:text-blue-300">
              {{ t('admin.accounts.dataImportLocalExportHint') }}
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                class="rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
                :class="
                  localExportSource === 'antigravity'
                    ? 'border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-500'
                    : 'border-blue-200 bg-white text-blue-800 dark:border-blue-700 dark:bg-dark-800 dark:text-blue-200'
                "
                data-testid="local-export-antigravity-button"
                @click="localExportSource = 'antigravity'"
              >
                {{ t('admin.accounts.dataImportLocalExportSourceAntigravity') }}
              </button>
              <button
                type="button"
                class="rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
                :class="
                  localExportSource === 'claude'
                    ? 'border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-500'
                    : 'border-blue-200 bg-white text-blue-800 dark:border-blue-700 dark:bg-dark-800 dark:text-blue-200'
                "
                data-testid="local-export-claude-button"
                @click="localExportSource = 'claude'"
              >
                {{ t('admin.accounts.dataImportLocalExportSourceClaude') }}
              </button>
              <button
                type="button"
                class="rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
                :class="
                  localExportSource === 'gemini'
                    ? 'border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-500'
                    : 'border-blue-200 bg-white text-blue-800 dark:border-blue-700 dark:bg-dark-800 dark:text-blue-200'
                "
                data-testid="local-export-gemini-button"
                @click="localExportSource = 'gemini'"
              >
                {{ t('admin.accounts.dataImportLocalExportSourceGemini') }}
              </button>
            </div>
          </div>
          <button
            type="button"
            class="btn btn-secondary shrink-0 px-3 py-1.5 text-xs"
            @click="handleCopyLocalExportCommand"
          >
            {{ t('admin.accounts.dataImportLocalExportCopy') }}
          </button>
        </div>
        <pre
          class="mt-3 overflow-x-auto rounded-lg border border-blue-100 bg-white/80 p-3 text-xs text-gray-800 dark:border-blue-800 dark:bg-dark-800 dark:text-dark-100"
        ><code>{{ localExportCommand }}</code></pre>
        <div class="mt-2 text-xs text-blue-700 dark:text-blue-300">
          {{ t('admin.accounts.dataImportLocalExportNote') }}
        </div>
        <div class="mt-2 text-xs text-blue-700 dark:text-blue-300">
          {{ localExportSourceNote }}
        </div>

        <div
          class="mt-4 rounded-lg border border-sky-200 bg-white/70 p-4 dark:border-sky-700 dark:bg-dark-800/80"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-sky-900 dark:text-sky-200">
                {{ localSyncTitle }}
              </div>
              <div class="mt-1 text-xs text-sky-700 dark:text-sky-300">
                {{ localSyncHint }}
              </div>
            </div>
            <button
              type="button"
              class="btn btn-secondary shrink-0 px-3 py-1.5 text-xs"
              data-testid="local-sync-copy-button"
              @click="handleCopyLocalSyncCommand"
            >
              {{ t('admin.accounts.dataImportLocalSyncCopy') }}
            </button>
          </div>
          <div class="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <label class="text-xs font-medium text-sky-800 dark:text-sky-200">
                {{ t('admin.accounts.dataImportLocalSyncBaseUrlLabel') }}
              </label>
              <input
                v-model="localSyncBaseUrl"
                type="text"
                class="mt-1 w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-sky-500 dark:border-sky-700 dark:bg-dark-900 dark:text-dark-100"
                :placeholder="t('admin.accounts.dataImportLocalSyncBaseUrlPlaceholder')"
                data-testid="local-sync-base-url-input"
              />
            </div>
            <div>
              <div class="text-xs font-medium text-sky-800 dark:text-sky-200">
                {{ t('admin.accounts.dataImportLocalSyncAuthModeLabel') }}
              </div>
              <div class="mt-1 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded-md border px-3 py-2 text-xs font-medium transition-colors"
                  :class="
                    localSyncAuthMode === 'api-key'
                      ? 'border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-500'
                      : 'border-sky-200 bg-white text-sky-800 dark:border-sky-700 dark:bg-dark-900 dark:text-sky-200'
                  "
                  data-testid="local-sync-auth-api-key-button"
                  @click="setLocalSyncAuthMode('api-key')"
                >
                  {{ t('admin.accounts.dataImportLocalSyncAuthModeApiKey') }}
                </button>
                <button
                  type="button"
                  class="rounded-md border px-3 py-2 text-xs font-medium transition-colors"
                  :class="
                    localSyncAuthMode === 'token'
                      ? 'border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-500'
                      : 'border-sky-200 bg-white text-sky-800 dark:border-sky-700 dark:bg-dark-900 dark:text-sky-200'
                  "
                  data-testid="local-sync-auth-token-button"
                  @click="setLocalSyncAuthMode('token')"
                >
                  {{ t('admin.accounts.dataImportLocalSyncAuthModeToken') }}
                </button>
              </div>
            </div>
          </div>
          <div class="mt-3">
            <label class="text-xs font-medium text-sky-800 dark:text-sky-200">
              {{ localSyncCredentialLabel }}
            </label>
            <input
              v-model="localSyncCredentialValue"
              type="text"
              class="mt-1 w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-sky-500 dark:border-sky-700 dark:bg-dark-900 dark:text-dark-100"
              :placeholder="localSyncCredentialPlaceholder"
              data-testid="local-sync-credential-input"
            />
          </div>
          <pre
            class="mt-3 overflow-x-auto rounded-lg border border-sky-100 bg-white/90 p-3 text-xs text-gray-800 dark:border-sky-800 dark:bg-dark-900 dark:text-dark-100"
          ><code>{{ localSyncCommand }}</code></pre>
          <div class="mt-2 text-xs text-sky-700 dark:text-sky-300">
            {{ localSyncNote }}
          </div>
        </div>

        <div
          class="mt-4 rounded-lg border border-violet-200 bg-white/70 p-4 dark:border-violet-700 dark:bg-dark-800/80"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-violet-900 dark:text-violet-200">
                {{ t('admin.accounts.dataImportDesktopHelperTitle') }}
              </div>
              <div class="mt-1 text-xs text-violet-700 dark:text-violet-300">
                {{ t('admin.accounts.dataImportDesktopHelperHint') }}
              </div>
              <div class="mt-2 text-xs text-violet-700 dark:text-violet-300">
                {{ desktopHelperSourceNote }}
              </div>
            </div>
            <button
              type="button"
              class="btn btn-secondary shrink-0 px-3 py-1.5 text-xs"
              data-testid="desktop-helper-copy-command-button"
              @click="handleCopyDesktopHelperCommand"
            >
              {{ t('admin.accounts.dataImportDesktopHelperCopyStartCommand') }}
            </button>
          </div>
          <pre
            class="mt-3 overflow-x-auto rounded-lg border border-violet-100 bg-white/90 p-3 text-xs text-gray-800 dark:border-violet-800 dark:bg-dark-900 dark:text-dark-100"
          ><code>{{ desktopHelperStartCommand }}</code></pre>
          <div class="mt-2 text-xs text-violet-700 dark:text-violet-300">
            {{ t('admin.accounts.dataImportDesktopHelperStartCommandNote') }}
          </div>
          <div class="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="desktopHelperBusy"
              data-testid="desktop-helper-download-button"
              @click="handleDownloadDesktopHelperExport"
            >
              {{
                desktopHelperBusy
                  ? t('admin.accounts.dataImportDesktopHelperProcessing')
                  : t('admin.accounts.dataImportDesktopHelperDownload')
              }}
            </button>
            <button
              type="button"
              class="btn btn-primary"
              :disabled="desktopHelperBusy"
              data-testid="desktop-helper-import-button"
              @click="handleImportDesktopHelper"
            >
              {{
                desktopHelperBusy
                  ? t('admin.accounts.dataImportDesktopHelperProcessing')
                  : t('admin.accounts.dataImportDesktopHelperImport')
              }}
            </button>
          </div>
        </div>
      </div>

      <div
        class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-700 dark:bg-emerald-900/20"
      >
        <div class="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
          {{ t('admin.accounts.dataImportLocalCacheTitle') }}
        </div>
        <div class="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
          {{ t('admin.accounts.dataImportLocalCacheHint') }}
        </div>

        <label
          class="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-white/80 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-dark-800 dark:text-emerald-200"
        >
          <input
            v-model="localCacheEnableMixedScheduling"
            type="checkbox"
            class="h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500 dark:border-emerald-700"
            data-testid="local-cache-mixed-scheduling-checkbox"
          />
          <span>{{ t('admin.accounts.dataImportLocalCacheMixedScheduling') }}</span>
        </label>
        <div class="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
          {{ t('admin.accounts.dataImportLocalCacheMixedSchedulingHint') }}
        </div>
        <div class="mt-3">
          <label class="text-xs font-medium text-emerald-800 dark:text-emerald-200">
            {{ t('admin.accounts.dataImportLocalCacheGeminiGroupLabel') }}
          </label>
          <select
            v-model="localCacheTargetGeminiGroupId"
            class="mt-1 w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-emerald-500 dark:border-emerald-700 dark:bg-dark-900 dark:text-dark-100"
            data-testid="local-cache-gemini-group-select"
          >
            <option :value="null">{{ t('admin.accounts.dataImportLocalCacheGeminiGroupNone') }}</option>
            <option
              v-for="group in geminiGroupOptions"
              :key="group.id"
              :value="group.id"
            >
              {{ group.name }}
            </option>
          </select>
          <div class="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
            {{
              localCacheTargetGeminiGroupId == null
                ? t('admin.accounts.dataImportLocalCacheGeminiGroupHint')
                : t('admin.accounts.dataImportLocalCacheGeminiGroupSelected', {
                    group: localCacheTargetGeminiGroupOptionLabel
                  })
            }}
          </div>
        </div>

        <div
          class="mt-3 flex items-center justify-between gap-3 rounded-lg border border-dashed border-emerald-300 bg-white/80 px-4 py-3 dark:border-emerald-700 dark:bg-dark-800"
        >
          <div class="min-w-0">
            <div class="truncate text-sm text-gray-700 dark:text-dark-200">
              {{ localCacheFileLabel }}
            </div>
            <div class="text-xs text-gray-500 dark:text-dark-400">JSON (.json)</div>
          </div>
          <button
            type="button"
            class="btn btn-secondary shrink-0"
            :disabled="localCacheBusy"
            data-testid="local-cache-pick-button"
            @click="openLocalCacheFilePicker"
          >
            {{ t('admin.accounts.dataImportLocalCachePickFiles') }}
          </button>
        </div>
        <input
          ref="localCacheFileInput"
          type="file"
          class="hidden"
          accept="application/json,.json"
          multiple
          data-testid="local-cache-file-input"
          @change="handleLocalCacheFileChange"
        />

        <div class="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="localCacheBusy || localCacheFiles.length === 0"
            data-testid="local-cache-download-button"
            @click="handleDownloadLocalCacheExport"
          >
            {{ t('admin.accounts.dataImportLocalCacheDownload') }}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="localCacheBusy || localCacheFiles.length === 0"
            data-testid="local-cache-import-button"
            @click="handleImportLocalCache"
          >
            {{
              localCacheBusy
                ? t('admin.accounts.dataImportLocalCacheProcessing')
                : t('admin.accounts.dataImportLocalCacheImport')
            }}
          </button>
        </div>

        <div class="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
          {{ t('admin.accounts.dataImportLocalCacheNote') }}
        </div>
      </div>

      <div>
        <label class="input-label">{{ t('admin.accounts.dataImportFile') }}</label>
        <div
          class="flex items-center justify-between gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 dark:border-dark-600 dark:bg-dark-800"
        >
          <div class="min-w-0">
            <div class="truncate text-sm text-gray-700 dark:text-dark-200">
              {{ fileName || t('admin.accounts.dataImportSelectFile') }}
            </div>
            <div class="text-xs text-gray-500 dark:text-dark-400">JSON (.json)</div>
          </div>
          <button type="button" class="btn btn-secondary shrink-0" @click="openFilePicker">
            {{ t('common.chooseFile') }}
          </button>
        </div>
        <input
          ref="fileInput"
          type="file"
          class="hidden"
          accept="application/json,.json"
          data-testid="import-data-file-input"
          @change="handleFileChange"
        />
      </div>

      <div
        v-if="result"
        class="space-y-2 rounded-xl border border-gray-200 p-4 dark:border-dark-700"
      >
        <div class="text-sm font-medium text-gray-900 dark:text-white">
          {{ t('admin.accounts.dataImportResult') }}
        </div>
        <div class="text-sm text-gray-700 dark:text-dark-300">
          {{ t('admin.accounts.dataImportResultSummary', result) }}
        </div>

        <div v-if="errorItems.length" class="mt-2">
          <div class="text-sm font-medium text-red-600 dark:text-red-400">
            {{ t('admin.accounts.dataImportErrors') }}
          </div>
          <div
            class="mt-2 max-h-48 overflow-auto rounded-lg bg-gray-50 p-3 font-mono text-xs dark:bg-dark-800"
          >
            <div v-for="(item, idx) in errorItems" :key="idx" class="whitespace-pre-wrap">
              {{ item.kind }} {{ item.name || item.proxy_key || '-' }} — {{ item.message }}
            </div>
          </div>
        </div>
      </div>
    </form>

    <template #footer>
      <div class="flex justify-end gap-3">
        <button class="btn btn-secondary" type="button" :disabled="importing || localCacheBusy || desktopHelperBusy" @click="handleClose">
          {{ t('common.cancel') }}
        </button>
        <button
          class="btn btn-primary"
          type="submit"
          form="import-data-form"
          :disabled="importing || localCacheBusy || desktopHelperBusy"
        >
          {{ importing ? t('admin.accounts.dataImporting') : t('admin.accounts.dataImportButton') }}
        </button>
      </div>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/common/BaseDialog.vue'
import { useClipboard } from '@/composables/useClipboard'
import { adminAPI } from '@/api/admin'
import { useAppStore } from '@/stores/app'
import type { AdminDataAccount, AdminDataImportResult, AdminDataPayload, AdminGroup } from '@/types'

interface Props {
  show: boolean
  groups?: AdminGroup[]
}

interface ImportedEventMeta {
  targetGroupId?: number
  targetGroupName?: string
  targetGroupPlatform?: 'gemini'
}

interface Emits {
  (e: 'close'): void
  (e: 'imported', payload?: ImportedEventMeta): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { t } = useI18n()
const appStore = useAppStore()
const { copyToClipboard } = useClipboard()

const importing = ref(false)
const localCacheBusy = ref(false)
const desktopHelperBusy = ref(false)
const file = ref<File | null>(null)
const localCacheFiles = ref<File[]>([])
const localCacheEnableMixedScheduling = ref(true)
const localCacheTargetGeminiGroupId = ref<number | null>(null)
const result = ref<AdminDataImportResult | null>(null)

const fileInput = ref<HTMLInputElement | null>(null)
const localCacheFileInput = ref<HTMLInputElement | null>(null)
const fileName = computed(() => file.value?.name || '')
type LocalExportSource = 'antigravity' | 'claude' | 'gemini'
type LocalSyncAuthMode = 'api-key' | 'token'

const DEFAULT_SYNC_BASE_URL = 'https://your-sub2api.example.com'
const DESKTOP_HELPER_BASE_URL = 'http://127.0.0.1:32191'
const defaultLocalSyncCredentialValue = (mode: LocalSyncAuthMode) =>
  mode === 'token' ? 'YOUR_ADMIN_JWT' : 'YOUR_ADMIN_API_KEY'
const shellQuote = (value: string) => `'${value.replace(/'/g, `'\"'\"'`)}'`

const localExportSource = ref<LocalExportSource>('antigravity')
const localSyncBaseUrl = ref(DEFAULT_SYNC_BASE_URL)
const localSyncAuthMode = ref<LocalSyncAuthMode>('api-key')
const localSyncCredentialValue = ref(defaultLocalSyncCredentialValue('api-key'))
const localExportCommands: Record<LocalExportSource, string[]> = {
  antigravity: [
    'cd /path/to/sub2api',
    'python3 tools/export_antigravity_accounts.py --dry-run',
    'python3 tools/export_antigravity_accounts.py'
  ],
  claude: [
    'cd /path/to/sub2api',
    'python3 tools/export_claude_accounts.py --dry-run',
    'python3 tools/export_claude_accounts.py --out ./claude-sub2api-export.json'
  ],
  gemini: [
    'cd /path/to/sub2api',
    'python3 tools/export_gemini_accounts.py --dry-run',
    'python3 tools/export_gemini_accounts.py --out ./gemini-sub2api-export.json'
  ]
}
const desktopHelperStartCommand = ['cd /path/to/sub2api', 'python3 tools/desktop_cli_bridge.py'].join('\n')
const geminiGroupOptions = computed(() =>
  (props.groups || []).filter((group) => group.platform === 'gemini' && group.status !== 'inactive')
)
const localCacheTargetGeminiGroupOptionLabel = computed(() => {
  if (localCacheTargetGeminiGroupId.value == null) {
    return t('admin.accounts.dataImportLocalCacheGeminiGroupNone')
  }
  const matched = geminiGroupOptions.value.find((group) => group.id === localCacheTargetGeminiGroupId.value)
  return matched?.name || t('admin.accounts.dataImportLocalCacheGeminiGroupNone')
})
const sourceSupportsGeminiGroupBinding = computed(() =>
  localExportSource.value === 'antigravity' || localExportSource.value === 'gemini'
)
const localTargetGroupCommandLines = computed(() => {
  if (!sourceSupportsGeminiGroupBinding.value || localCacheTargetGeminiGroupId.value == null) {
    return []
  }
  return [`--group-id ${localCacheTargetGeminiGroupId.value}`]
})
const localExportTailArgs = computed(() => {
  if (localExportSource.value === 'claude') {
    return []
  }

  const tail =
    localExportSource.value === 'gemini'
      ? ['--out ./gemini-sub2api-export.json']
      : ['--out ./antigravity-sub2api-export.json']

  if (localCacheTargetGeminiGroupId.value != null) {
    tail.push(`--group-id ${localCacheTargetGeminiGroupId.value}`)
  }
  return tail
})
const localSyncCommand = computed(() =>
  (
    localExportSource.value === 'claude'
      ? [
          'cd /path/to/sub2api',
          'python3 tools/sync_claude_accounts.py \\',
          `  --admin-base-url ${shellQuote(localSyncBaseUrl.value.trim() || DEFAULT_SYNC_BASE_URL)} \\`,
          `  ${localSyncAuthMode.value === 'token' ? '--admin-token' : '--admin-api-key'} ${shellQuote(localSyncCredentialValue.value.trim() || defaultLocalSyncCredentialValue(localSyncAuthMode.value))}`
        ]
      : localExportSource.value === 'gemini'
        ? [
            'cd /path/to/sub2api',
            'python3 tools/sync_gemini_accounts.py \\',
            `  --admin-base-url ${shellQuote(localSyncBaseUrl.value.trim() || DEFAULT_SYNC_BASE_URL)} \\`,
            `  ${localSyncAuthMode.value === 'token' ? '--admin-token' : '--admin-api-key'} ${shellQuote(localSyncCredentialValue.value.trim() || defaultLocalSyncCredentialValue(localSyncAuthMode.value))}${localTargetGroupCommandLines.value.length > 0 ? ' \\' : ''}`,
            ...localTargetGroupCommandLines.value.map((line) => `  ${line}`)
          ]
      : [
          'cd /path/to/sub2api',
          'python3 tools/sync_antigravity_accounts.py \\',
          `  --admin-base-url ${shellQuote(localSyncBaseUrl.value.trim() || DEFAULT_SYNC_BASE_URL)} \\`,
          `  ${localSyncAuthMode.value === 'token' ? '--admin-token' : '--admin-api-key'} ${shellQuote(localSyncCredentialValue.value.trim() || defaultLocalSyncCredentialValue(localSyncAuthMode.value))}${localTargetGroupCommandLines.value.length > 0 ? ' \\' : ''}`,
          ...localTargetGroupCommandLines.value.map((line) => `  ${line}`)
        ]
  ).join('\n')
)
const localExportCommand = computed(() =>
  (
    localExportSource.value === 'antigravity' || localExportSource.value === 'gemini'
      ? [
          localExportCommands[localExportSource.value][0],
          localExportCommands[localExportSource.value][1],
          `${localExportCommands[localExportSource.value][2]} \\`,
          ...localExportTailArgs.value.map((arg, index) =>
            index < localExportTailArgs.value.length - 1 ? `  ${arg} \\` : `  ${arg}`
          )
        ]
      : localExportCommands[localExportSource.value]
  ).join('\n')
)
const localExportSourceNote = computed(() =>
  localExportSource.value === 'claude'
    ? t('admin.accounts.dataImportLocalExportSourceClaudeNote')
    : localExportSource.value === 'gemini'
      ? t('admin.accounts.dataImportLocalExportSourceGeminiNote')
      : t('admin.accounts.dataImportLocalExportSourceAntigravityNote')
)
const localSyncTitle = computed(() =>
  localExportSource.value === 'claude'
    ? t('admin.accounts.dataImportLocalSyncTitleClaude')
    : localExportSource.value === 'gemini'
      ? t('admin.accounts.dataImportLocalSyncTitleGemini')
      : t('admin.accounts.dataImportLocalSyncTitleAntigravity')
)
const localSyncHint = computed(() =>
  localExportSource.value === 'claude'
    ? t('admin.accounts.dataImportLocalSyncHintClaude')
    : localExportSource.value === 'gemini'
      ? t('admin.accounts.dataImportLocalSyncHintGemini')
      : t('admin.accounts.dataImportLocalSyncHintAntigravity')
)
const localSyncNote = computed(() =>
  localExportSource.value === 'claude'
    ? t('admin.accounts.dataImportLocalSyncNoteClaude')
    : localExportSource.value === 'gemini'
      ? t('admin.accounts.dataImportLocalSyncNoteGemini')
      : t('admin.accounts.dataImportLocalSyncNoteAntigravity')
)
const localSyncCredentialLabel = computed(() =>
  localSyncAuthMode.value === 'token'
    ? t('admin.accounts.dataImportLocalSyncCredentialLabelToken')
    : t('admin.accounts.dataImportLocalSyncCredentialLabelApiKey')
)
const localSyncCredentialPlaceholder = computed(() =>
  localSyncAuthMode.value === 'token'
    ? t('admin.accounts.dataImportLocalSyncCredentialPlaceholderToken')
    : t('admin.accounts.dataImportLocalSyncCredentialPlaceholderApiKey')
)
const desktopHelperSourceNote = computed(() =>
  localExportSource.value === 'claude'
    ? t('admin.accounts.dataImportDesktopHelperSourceClaudeNote')
    : localExportSource.value === 'gemini'
      ? t('admin.accounts.dataImportDesktopHelperSourceGeminiNote')
      : t('admin.accounts.dataImportDesktopHelperSourceAntigravityNote')
)
const desktopHelperFilename = computed(() =>
  localExportSource.value === 'claude'
    ? 'claude-sub2api-export.json'
    : localExportSource.value === 'gemini'
      ? 'gemini-sub2api-export.json'
      : 'antigravity-sub2api-export.json'
)
const localCacheFileLabel = computed(() => {
  if (localCacheFiles.value.length === 0) {
    return t('admin.accounts.dataImportLocalCacheSelectFile')
  }
  if (localCacheFiles.value.length === 1) {
    return localCacheFiles.value[0].name
  }
  return t('admin.accounts.dataImportLocalCacheSelected', { count: localCacheFiles.value.length })
})

const errorItems = computed(() => result.value?.errors || [])

watch(
  () => props.show,
  (open) => {
    if (open) {
      file.value = null
      localExportSource.value = 'antigravity'
      localSyncBaseUrl.value = DEFAULT_SYNC_BASE_URL
      localSyncAuthMode.value = 'api-key'
      localSyncCredentialValue.value = defaultLocalSyncCredentialValue('api-key')
      localCacheFiles.value = []
      localCacheEnableMixedScheduling.value = true
      localCacheTargetGeminiGroupId.value = null
      result.value = null
      if (fileInput.value) {
        fileInput.value.value = ''
      }
      if (localCacheFileInput.value) {
        localCacheFileInput.value.value = ''
      }
    }
  }
)

const openFilePicker = () => {
  fileInput.value?.click()
}

const openLocalCacheFilePicker = () => {
  localCacheFileInput.value?.click()
}

const handleCopyLocalExportCommand = async () => {
  await copyToClipboard(
    localExportCommand.value,
    t('admin.accounts.dataImportLocalExportCopied')
  )
}

const handleCopyLocalSyncCommand = async () => {
  await copyToClipboard(
    localSyncCommand.value,
    t('admin.accounts.dataImportLocalSyncCopied')
  )
}

const handleCopyDesktopHelperCommand = async () => {
  await copyToClipboard(
    desktopHelperStartCommand,
    t('admin.accounts.dataImportDesktopHelperStartCommandCopied')
  )
}

const setLocalSyncAuthMode = (mode: LocalSyncAuthMode) => {
  if (localSyncAuthMode.value === mode) return
  localSyncAuthMode.value = mode
  localSyncCredentialValue.value = defaultLocalSyncCredentialValue(mode)
}

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  file.value = target.files?.[0] || null
}

const handleLocalCacheFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  localCacheFiles.value = Array.from(target.files || [])
}

const handleClose = () => {
  if (importing.value || localCacheBusy.value || desktopHelperBusy.value) return
  emit('close')
}

const readFileAsText = async (sourceFile: File): Promise<string> => {
  if (typeof sourceFile.text === 'function') {
    return sourceFile.text()
  }

  if (typeof sourceFile.arrayBuffer === 'function') {
    const buffer = await sourceFile.arrayBuffer()
    return new TextDecoder().decode(buffer)
  }

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.readAsText(sourceFile)
  })
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const normalizeExpiresAt = (record: Record<string, unknown>): string | undefined => {
  const expired = normalizeString(record.expired)
  if (expired) {
    const normalized = expired.replace('Z', '+00:00')
    const timestamp = Date.parse(normalized)
    if (!Number.isNaN(timestamp)) {
      return String(Math.floor(timestamp / 1000))
    }
  }

  const rawTimestamp = record.timestamp
  const rawExpiresIn = record.expires_in
  const timestamp =
    typeof rawTimestamp === 'number'
      ? rawTimestamp
      : typeof rawTimestamp === 'string'
        ? Number(rawTimestamp)
        : NaN
  const expiresIn =
    typeof rawExpiresIn === 'number'
      ? rawExpiresIn
      : typeof rawExpiresIn === 'string'
        ? Number(rawExpiresIn)
        : NaN

  if (Number.isNaN(timestamp) || Number.isNaN(expiresIn)) return undefined
  const normalizedTimestamp = timestamp > 1_000_000_000_000 ? timestamp / 1000 : timestamp
  return String(Math.floor(normalizedTimestamp + expiresIn))
}

const buildLocalCacheAccount = (
  record: Record<string, unknown>,
  sourceFileName: string,
  index: number
): AdminDataAccount | null => {
  if (record.disabled === true) return null

  const refreshToken = normalizeString(record.refresh_token)
  if (!refreshToken) return null

  const email = normalizeString(record.email)
  const accessToken = normalizeString(record.access_token)
  const tokenType = normalizeString(record.token_type) || (accessToken ? 'Bearer' : '')
  const projectID = normalizeString(record.project_id)
  const expiresAt = normalizeExpiresAt(record)

  const credentials: Record<string, unknown> = {
    refresh_token: refreshToken
  }
  if (accessToken) credentials.access_token = accessToken
  if (tokenType) credentials.token_type = tokenType
  if (email) credentials.email = email
  if (projectID) credentials.project_id = projectID
  if (expiresAt) credentials.expires_at = expiresAt

  return {
    name: `antigravity ${email || `account-${index}`}`.trim(),
    notes: `Imported from local Antigravity cache; source=${sourceFileName}`,
    platform: 'antigravity',
    type: 'oauth',
    credentials,
    extra: localCacheEnableMixedScheduling.value ? { mixed_scheduling: true } : {},
    group_ids: localCacheTargetGeminiGroupId.value != null ? [localCacheTargetGeminiGroupId.value] : [],
    concurrency: 10,
    priority: 1,
    rate_multiplier: 1
  }
}

interface LocalCacheBuildStats {
  exported: number
  skippedDisabled: number
  skippedMissingRefreshToken: number
  skippedInvalid: number
}

interface DesktopHelperResponse {
  payload: AdminDataPayload
  meta?: {
    source?: LocalExportSource
    exported?: number
    skipped?: number
  }
}

const buildPayloadFromLocalCacheFiles = async (): Promise<{
  payload: AdminDataPayload
  stats: LocalCacheBuildStats
}> => {
  const stats: LocalCacheBuildStats = {
    exported: 0,
    skippedDisabled: 0,
    skippedMissingRefreshToken: 0,
    skippedInvalid: 0
  }
  const accounts: AdminDataAccount[] = []

  for (let index = 0; index < localCacheFiles.value.length; index++) {
    const sourceFile = localCacheFiles.value[index]
    try {
      const text = await readFileAsText(sourceFile)
      const parsed = JSON.parse(text)
      if (!isObjectRecord(parsed)) {
        stats.skippedInvalid++
        continue
      }
      if (parsed.disabled === true) {
        stats.skippedDisabled++
        continue
      }
      if (!normalizeString(parsed.refresh_token)) {
        stats.skippedMissingRefreshToken++
        continue
      }

      const account = buildLocalCacheAccount(parsed, sourceFile.name, index + 1)
      if (!account) {
        stats.skippedInvalid++
        continue
      }
      accounts.push(account)
      stats.exported++
    } catch {
      stats.skippedInvalid++
    }
  }

  return {
    payload: {
      type: 'sub2api-data',
      version: 1,
      exported_at: new Date().toISOString(),
      proxies: [],
      accounts
    },
    stats
  }
}

const buildLocalCacheSummary = (stats: LocalCacheBuildStats) => {
  const skipped = stats.skippedDisabled + stats.skippedMissingRefreshToken + stats.skippedInvalid
  return { skipped }
}

const notifyLocalCacheSummary = (stats: LocalCacheBuildStats) => {
  const { skipped } = buildLocalCacheSummary(stats)
  if (skipped > 0) {
    appStore.showWarning(
      t('admin.accounts.dataImportLocalCacheSummary', {
        exported: stats.exported,
        skipped
      })
    )
  } else {
    appStore.showSuccess(
      t('admin.accounts.dataImportLocalCacheReady', { count: stats.exported })
    )
  }
}

const downloadJSON = (payload: AdminDataPayload, filename: string) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const requestDesktopHelperPayload = async (): Promise<DesktopHelperResponse> => {
  let response: Response
  try {
    response = await fetch(`${DESKTOP_HELPER_BASE_URL}/api/v1/local-cli/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: localExportSource.value,
        mixed_scheduling:
          localExportSource.value === 'antigravity' ? localCacheEnableMixedScheduling.value : undefined,
        group_ids:
          sourceSupportsGeminiGroupBinding.value && localCacheTargetGeminiGroupId.value != null
            ? [localCacheTargetGeminiGroupId.value]
            : []
      })
    })
  } catch {
    throw new Error(t('admin.accounts.dataImportDesktopHelperUnavailable'))
  }

  let responseData: any
  try {
    responseData = await response.json()
  } catch {
    throw new Error(t('admin.accounts.dataImportDesktopHelperInvalidResponse'))
  }

  if (!response.ok) {
    throw new Error(
      responseData?.error ||
      responseData?.message ||
      t('admin.accounts.dataImportDesktopHelperUnavailable')
    )
  }

  if (!responseData?.payload || typeof responseData.payload !== 'object') {
    throw new Error(t('admin.accounts.dataImportDesktopHelperInvalidResponse'))
  }

  return responseData as DesktopHelperResponse
}

const notifyDesktopHelperSummary = (
  meta?: DesktopHelperResponse['meta'],
  options: { showReadyToast?: boolean } = {}
) => {
  const exported = Number(meta?.exported || 0)
  const skipped = Number(meta?.skipped || 0)
  if (exported <= 0) return

  if (skipped > 0) {
    appStore.showWarning(
      t('admin.accounts.dataImportDesktopHelperSummary', {
        exported,
        skipped
      })
    )
  } else if (options.showReadyToast !== false) {
    appStore.showSuccess(
      t('admin.accounts.dataImportDesktopHelperReady', { count: exported })
    )
  }
}

const applyImportResult = (res: AdminDataImportResult, importedMeta?: ImportedEventMeta) => {
  result.value = res

  const msgParams: Record<string, unknown> = {
    account_created: res.account_created,
    account_failed: res.account_failed,
    proxy_created: res.proxy_created,
    proxy_reused: res.proxy_reused,
    proxy_failed: res.proxy_failed,
  }
  if (res.account_failed > 0 || res.proxy_failed > 0) {
    appStore.showError(t('admin.accounts.dataImportCompletedWithErrors', msgParams))
  } else {
    appStore.showSuccess(t('admin.accounts.dataImportSuccess', msgParams))
    emit('imported', importedMeta)
  }
}

const handleDownloadLocalCacheExport = async () => {
  if (localCacheFiles.value.length === 0) {
    appStore.showError(t('admin.accounts.dataImportLocalCacheNoFiles'))
    return
  }

  localCacheBusy.value = true
  try {
    const { payload, stats } = await buildPayloadFromLocalCacheFiles()
    if (stats.exported === 0) {
      appStore.showError(t('admin.accounts.dataImportLocalCacheNoAccounts'))
      return
    }
    downloadJSON(payload, 'antigravity-sub2api-export.json')
    notifyLocalCacheSummary(stats)
  } finally {
    localCacheBusy.value = false
  }
}

const handleDownloadDesktopHelperExport = async () => {
  desktopHelperBusy.value = true
  try {
    const response = await requestDesktopHelperPayload()
    downloadJSON(response.payload, desktopHelperFilename.value)
    notifyDesktopHelperSummary(response.meta)
  } catch (error: any) {
    appStore.showError(error?.message || t('admin.accounts.dataImportDesktopHelperUnavailable'))
  } finally {
    desktopHelperBusy.value = false
  }
}

const handleImportLocalCache = async () => {
  if (localCacheFiles.value.length === 0) {
    appStore.showError(t('admin.accounts.dataImportLocalCacheNoFiles'))
    return
  }

  localCacheBusy.value = true
  try {
    const { payload, stats } = await buildPayloadFromLocalCacheFiles()
    if (stats.exported === 0) {
      appStore.showError(t('admin.accounts.dataImportLocalCacheNoAccounts'))
      return
    }

    const res = await adminAPI.accounts.importData({
      data: payload,
      skip_default_group_bind: true
    })

    applyImportResult(
      res,
      localCacheTargetGeminiGroupId.value != null
        ? {
            targetGroupId: localCacheTargetGeminiGroupId.value,
            targetGroupName: localCacheTargetGeminiGroupOptionLabel.value,
            targetGroupPlatform: 'gemini'
          }
        : undefined
    )

    const { skipped } = buildLocalCacheSummary(stats)
    if (skipped > 0) {
      appStore.showWarning(
        t('admin.accounts.dataImportLocalCacheSummary', {
          exported: stats.exported,
          skipped
        })
      )
    }
  } catch (error: any) {
    appStore.showError(error?.message || t('admin.accounts.dataImportFailed'))
  } finally {
    localCacheBusy.value = false
  }
}

const handleImportDesktopHelper = async () => {
  desktopHelperBusy.value = true
  try {
    const response = await requestDesktopHelperPayload()
    const res = await adminAPI.accounts.importData({
      data: response.payload,
      skip_default_group_bind: true
    })

    applyImportResult(
      res,
      sourceSupportsGeminiGroupBinding.value && localCacheTargetGeminiGroupId.value != null
        ? {
            targetGroupId: localCacheTargetGeminiGroupId.value,
            targetGroupName: localCacheTargetGeminiGroupOptionLabel.value,
            targetGroupPlatform: 'gemini'
          }
        : undefined
    )
    notifyDesktopHelperSummary(response.meta, { showReadyToast: false })
  } catch (error: any) {
    appStore.showError(error?.message || t('admin.accounts.dataImportDesktopHelperUnavailable'))
  } finally {
    desktopHelperBusy.value = false
  }
}

const handleImport = async () => {
  if (!file.value) {
    appStore.showError(t('admin.accounts.dataImportSelectFile'))
    return
  }

  importing.value = true
  try {
    const text = await readFileAsText(file.value)
    const dataPayload = JSON.parse(text)

    const res = await adminAPI.accounts.importData({
      data: dataPayload,
      skip_default_group_bind: true
    })
    applyImportResult(res)
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      appStore.showError(t('admin.accounts.dataImportParseFailed'))
    } else {
      appStore.showError(error?.message || t('admin.accounts.dataImportFailed'))
    }
  } finally {
    importing.value = false
  }
}
</script>
