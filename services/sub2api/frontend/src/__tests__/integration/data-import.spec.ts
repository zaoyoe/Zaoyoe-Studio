import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ImportDataModal from '@/components/admin/account/ImportDataModal.vue'

const fetchMock = vi.hoisted(() => vi.fn())
const { showError, showSuccess, showWarning, copyToClipboard, importData } = vi.hoisted(() => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
  copyToClipboard: vi.fn().mockResolvedValue(true),
  importData: vi.fn()
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    showError,
    showSuccess,
    showWarning
  })
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      importData
    }
  }
}))

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({
    copied: { value: false },
    copyToClipboard
  })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

describe('ImportDataModal', () => {
  beforeEach(() => {
    showError.mockReset()
    showSuccess.mockReset()
    showWarning.mockReset()
    copyToClipboard.mockClear()
    importData.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('未选择文件时提示错误', async () => {
    const wrapper = mount(ImportDataModal, {
      props: { show: true },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    await wrapper.find('form').trigger('submit')
    expect(showError).toHaveBeenCalledWith('admin.accounts.dataImportSelectFile')
  })

  it('无效 JSON 时提示解析失败', async () => {
    const wrapper = mount(ImportDataModal, {
      props: { show: true },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    const input = wrapper.get('[data-testid="import-data-file-input"]')
    const file = new File(['invalid json'], 'data.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', {
      value: () => Promise.resolve('invalid json')
    })
    Object.defineProperty(input.element, 'files', {
      value: [file]
    })

    await input.trigger('change')
    await wrapper.find('form').trigger('submit')
    await Promise.resolve()

    expect(showError).toHaveBeenCalledWith('admin.accounts.dataImportParseFailed')
  })

  it('显示本地导出命令提示', () => {
    const wrapper = mount(ImportDataModal, {
      props: { show: true, groups: [] },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    expect(wrapper.text()).toContain('admin.accounts.dataImportLocalExportTitle')
    expect(wrapper.text()).toContain('admin.accounts.dataImportLocalExportSourceAntigravity')
    expect(wrapper.text()).toContain('admin.accounts.dataImportLocalExportSourceClaude')
    expect(wrapper.text()).toContain('admin.accounts.dataImportLocalExportSourceGemini')
    expect(wrapper.text()).toContain('python3 tools/export_antigravity_accounts.py --dry-run')
    expect(wrapper.text()).toContain('python3 tools/export_antigravity_accounts.py \\')
    expect(wrapper.text()).toContain('--out ./antigravity-sub2api-export.json')
    expect(wrapper.text()).toContain('admin.accounts.dataImportLocalSyncTitleAntigravity')
    expect(wrapper.text()).toContain('python3 tools/sync_antigravity_accounts.py \\')
    expect(wrapper.text()).toContain("'https://your-sub2api.example.com'")
  })

  it('切换到 Claude 导出命令后显示对应提示', async () => {
    const wrapper = mount(ImportDataModal, {
      props: { show: true, groups: [] },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    await wrapper.get('[data-testid="local-export-claude-button"]').trigger('click')

    expect(wrapper.text()).toContain('python3 tools/export_claude_accounts.py --dry-run')
    expect(wrapper.text()).toContain('python3 tools/export_claude_accounts.py --out ./claude-sub2api-export.json')
    expect(wrapper.text()).toContain('admin.accounts.dataImportLocalExportSourceClaudeNote')
    expect(wrapper.text()).toContain('admin.accounts.dataImportLocalSyncTitleClaude')
    expect(wrapper.text()).toContain('python3 tools/sync_claude_accounts.py \\')
  })

  it('切换到 Gemini 导出命令后显示对应提示', async () => {
    const wrapper = mount(ImportDataModal, {
      props: { show: true, groups: [] },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    await wrapper.get('[data-testid="local-export-gemini-button"]').trigger('click')

    expect(wrapper.text()).toContain('python3 tools/export_gemini_accounts.py --dry-run')
    expect(wrapper.text()).toContain('python3 tools/export_gemini_accounts.py --out ./gemini-sub2api-export.json')
    expect(wrapper.text()).toContain('admin.accounts.dataImportLocalExportSourceGeminiNote')
    expect(wrapper.text()).toContain('admin.accounts.dataImportLocalSyncTitleGemini')
    expect(wrapper.text()).toContain('python3 tools/sync_gemini_accounts.py \\')
  })

  it('点击复制命令按钮时写入当前选中的命令', async () => {
    const wrapper = mount(ImportDataModal, {
      props: { show: true, groups: [] },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    const buttons = wrapper.findAll('button')
    const copyButton = buttons.find((button) =>
      button.text().includes('admin.accounts.dataImportLocalExportCopy')
    )

    expect(copyButton).toBeTruthy()
    await wrapper.get('[data-testid="local-export-claude-button"]').trigger('click')
    await copyButton!.trigger('click')

    expect(copyToClipboard).toHaveBeenCalledWith(
      [
        'cd /path/to/sub2api',
        'python3 tools/export_claude_accounts.py --dry-run',
        'python3 tools/export_claude_accounts.py --out ./claude-sub2api-export.json'
      ].join('\n'),
      'admin.accounts.dataImportLocalExportCopied'
    )
  })

  it('点击复制同步命令按钮时默认写入 Antigravity 一键同步命令', async () => {
    const wrapper = mount(ImportDataModal, {
      props: { show: true, groups: [] },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    await wrapper.get('[data-testid="local-sync-copy-button"]').trigger('click')

    expect(copyToClipboard).toHaveBeenCalledWith(
      [
        'cd /path/to/sub2api',
        'python3 tools/sync_antigravity_accounts.py \\',
        "  --admin-base-url 'https://your-sub2api.example.com' \\",
        "  --admin-api-key 'YOUR_ADMIN_API_KEY'"
      ].join('\n'),
      'admin.accounts.dataImportLocalSyncCopied'
    )
  })

  it('点击复制同步命令按钮时切换后写入 Claude 一键同步命令', async () => {
    const wrapper = mount(ImportDataModal, {
      props: { show: true, groups: [] },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    await wrapper.get('[data-testid="local-export-claude-button"]').trigger('click')
    await wrapper.get('[data-testid="local-sync-copy-button"]').trigger('click')

    expect(copyToClipboard).toHaveBeenCalledWith(
      [
        'cd /path/to/sub2api',
        'python3 tools/sync_claude_accounts.py \\',
        "  --admin-base-url 'https://your-sub2api.example.com' \\",
        "  --admin-api-key 'YOUR_ADMIN_API_KEY'"
      ].join('\n'),
      'admin.accounts.dataImportLocalSyncCopied'
    )
  })

  it('点击复制同步命令按钮时切换后写入 Gemini 一键同步命令', async () => {
    const wrapper = mount(ImportDataModal, {
      props: { show: true, groups: [] },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    await wrapper.get('[data-testid="local-export-gemini-button"]').trigger('click')
    await wrapper.get('[data-testid="local-sync-copy-button"]').trigger('click')

    expect(copyToClipboard).toHaveBeenCalledWith(
      [
        'cd /path/to/sub2api',
        'python3 tools/sync_gemini_accounts.py \\',
        "  --admin-base-url 'https://your-sub2api.example.com' \\",
        "  --admin-api-key 'YOUR_ADMIN_API_KEY'"
      ].join('\n'),
      'admin.accounts.dataImportLocalSyncCopied'
    )
  })

  it('修改后台地址和认证方式后同步命令会实时更新', async () => {
    const wrapper = mount(ImportDataModal, {
      props: { show: true, groups: [] },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    await wrapper.get('[data-testid="local-export-claude-button"]').trigger('click')
    await wrapper.get('[data-testid="local-sync-auth-token-button"]').trigger('click')
    await wrapper.get('[data-testid="local-sync-base-url-input"]').setValue('https://sub2api.example.com/admin')
    await wrapper.get('[data-testid="local-sync-credential-input"]').setValue('jwt-token-123')
    await wrapper.get('[data-testid="local-sync-copy-button"]').trigger('click')

    expect(copyToClipboard).toHaveBeenCalledWith(
      [
        'cd /path/to/sub2api',
        'python3 tools/sync_claude_accounts.py \\',
        "  --admin-base-url 'https://sub2api.example.com/admin' \\",
        "  --admin-token 'jwt-token-123'"
      ].join('\n'),
      'admin.accounts.dataImportLocalSyncCopied'
    )
  })

  it('点击复制桌面助手按钮时写入启动命令', async () => {
    const wrapper = mount(ImportDataModal, {
      props: { show: true, groups: [] },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    await wrapper.get('[data-testid="desktop-helper-copy-command-button"]').trigger('click')

    expect(copyToClipboard).toHaveBeenCalledWith(
      ['cd /path/to/sub2api', 'python3 tools/desktop_cli_bridge.py'].join('\n'),
      'admin.accounts.dataImportDesktopHelperStartCommandCopied'
    )
  })

  it('可以通过桌面助手一键扫描并直接导入', async () => {
    const helperPayload = {
      type: 'sub2api-data',
      version: 1,
      exported_at: '2026-04-17T00:00:00Z',
      proxies: [],
      accounts: [
        {
          name: 'antigravity helper@example.com',
          platform: 'antigravity',
          type: 'oauth',
          credentials: {
            refresh_token: 'rt-helper'
          },
          extra: {
            mixed_scheduling: true
          },
          group_ids: [88],
          concurrency: 10,
          priority: 1,
          rate_multiplier: 1
        }
      ]
    }

    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          payload: helperPayload,
          meta: {
            source: 'antigravity',
            exported: 1,
            skipped: 0
          }
        })
    })
    importData.mockResolvedValue({
      proxy_created: 0,
      proxy_reused: 0,
      proxy_failed: 0,
      account_created: 1,
      account_failed: 0,
      errors: []
    })

    const wrapper = mount(ImportDataModal, {
      props: {
        show: true,
        groups: [
          {
            id: 88,
            name: 'Gemini Pool',
            description: null,
            platform: 'gemini',
            rate_multiplier: 1,
            subscription_type: 'standard',
            is_exclusive: false,
            status: 'active',
            daily_limit_usd: null,
            weekly_limit_usd: null,
            monthly_limit_usd: null,
            image_price_1k: null,
            image_price_2k: null,
            image_price_4k: null,
            claude_code_only: false,
            fallback_group_id: null,
            fallback_group_id_on_invalid_request: null,
            require_oauth_only: false,
            require_privacy_set: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            model_routing: null,
            model_routing_enabled: false,
            mcp_xml_inject: false,
            simulate_claude_max_enabled: false
          }
        ]
      },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    await wrapper.get('[data-testid="local-cache-gemini-group-select"]').setValue('88')
    await wrapper.get('[data-testid="desktop-helper-import-button"]').trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32191/api/v1/local-cli/export',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source: 'antigravity',
          mixed_scheduling: true,
          group_ids: [88]
        })
      })
    )
    expect(importData).toHaveBeenCalledWith({
      data: helperPayload,
      skip_default_group_bind: true
    })
    expect(wrapper.emitted('imported')).toEqual([
      [
        {
          targetGroupId: 88,
          targetGroupName: 'Gemini Pool',
          targetGroupPlatform: 'gemini'
        }
      ]
    ])
  })

  it('Gemini 来源下可以通过桌面助手一键扫描并直接导入', async () => {
    const helperPayload = {
      type: 'sub2api-data',
      version: 1,
      exported_at: '2026-04-17T00:00:00Z',
      proxies: [],
      accounts: [
        {
          name: 'gemini helper@example.com',
          platform: 'gemini',
          type: 'oauth',
          credentials: {
            access_token: 'at-helper',
            refresh_token: 'rt-helper',
            oauth_type: 'google_one'
          },
          extra: {
            email_address: 'helper@example.com'
          },
          group_ids: [88],
          concurrency: 10,
          priority: 1,
          rate_multiplier: 1
        }
      ]
    }

    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          payload: helperPayload,
          meta: {
            source: 'gemini',
            exported: 1,
            skipped: 0
          }
        })
    })
    importData.mockResolvedValue({
      proxy_created: 0,
      proxy_reused: 0,
      proxy_failed: 0,
      account_created: 1,
      account_failed: 0,
      errors: []
    })

    const wrapper = mount(ImportDataModal, {
      props: {
        show: true,
        groups: [
          {
            id: 88,
            name: 'Gemini Pool',
            description: null,
            platform: 'gemini',
            rate_multiplier: 1,
            subscription_type: 'standard',
            is_exclusive: false,
            status: 'active',
            daily_limit_usd: null,
            weekly_limit_usd: null,
            monthly_limit_usd: null,
            image_price_1k: null,
            image_price_2k: null,
            image_price_4k: null,
            claude_code_only: false,
            fallback_group_id: null,
            fallback_group_id_on_invalid_request: null,
            require_oauth_only: false,
            require_privacy_set: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            model_routing: null,
            model_routing_enabled: false,
            mcp_xml_inject: false,
            simulate_claude_max_enabled: false
          }
        ]
      },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    await wrapper.get('[data-testid="local-export-gemini-button"]').trigger('click')
    await wrapper.get('[data-testid="local-cache-gemini-group-select"]').setValue('88')
    await wrapper.get('[data-testid="desktop-helper-import-button"]').trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32191/api/v1/local-cli/export',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source: 'gemini',
          group_ids: [88]
        })
      })
    )
    expect(importData).toHaveBeenCalledWith({
      data: helperPayload,
      skip_default_group_bind: true
    })
    expect(wrapper.emitted('imported')).toEqual([
      [
        {
          targetGroupId: 88,
          targetGroupName: 'Gemini Pool',
          targetGroupPlatform: 'gemini'
        }
      ]
    ])
  })

  it('可以直接从本地缓存文件导入', async () => {
    importData.mockResolvedValue({
      proxy_created: 0,
      proxy_reused: 0,
      proxy_failed: 0,
      account_created: 1,
      account_failed: 0,
      errors: []
    })

    const wrapper = mount(ImportDataModal, {
      props: { show: true, groups: [] },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    const input = wrapper.get('[data-testid="local-cache-file-input"]')
    const file = new File(
      [
        JSON.stringify({
          access_token: 'at-1',
          refresh_token: 'rt-1',
          email: 'foo@example.com',
          project_id: 'proj-1',
          expires_in: 3600,
          timestamp: 1_700_000_000
        })
      ],
      'antigravity-foo@example.com.json',
      { type: 'application/json' }
    )
    Object.defineProperty(file, 'text', {
      value: () =>
        Promise.resolve(
          JSON.stringify({
            access_token: 'at-1',
            refresh_token: 'rt-1',
            email: 'foo@example.com',
            project_id: 'proj-1',
            expires_in: 3600,
            timestamp: 1_700_000_000
          })
        )
    })
    Object.defineProperty(input.element, 'files', {
      value: [file]
    })

    await input.trigger('change')
    await wrapper.get('[data-testid="local-cache-import-button"]').trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(importData).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'sub2api-data',
        version: 1,
        proxies: [],
        accounts: [
          expect.objectContaining({
            name: 'antigravity foo@example.com',
            platform: 'antigravity',
            type: 'oauth',
            credentials: expect.objectContaining({
              access_token: 'at-1',
              refresh_token: 'rt-1',
              email: 'foo@example.com',
              project_id: 'proj-1',
              token_type: 'Bearer'
            }),
            extra: {
              mixed_scheduling: true
            }
          })
        ]
      }),
      skip_default_group_bind: true
    })
  })

  it('关闭混合调度后导入的本地缓存账号不写 mixed_scheduling', async () => {
    importData.mockResolvedValue({
      proxy_created: 0,
      proxy_reused: 0,
      proxy_failed: 0,
      account_created: 1,
      account_failed: 0,
      errors: []
    })

    const wrapper = mount(ImportDataModal, {
      props: { show: true, groups: [] },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    await wrapper.get('[data-testid="local-cache-mixed-scheduling-checkbox"]').setValue(false)

    const input = wrapper.get('[data-testid="local-cache-file-input"]')
    const file = new File(
      [
        JSON.stringify({
          access_token: 'at-2',
          refresh_token: 'rt-2',
          email: 'bar@example.com'
        })
      ],
      'antigravity-bar@example.com.json',
      { type: 'application/json' }
    )
    Object.defineProperty(file, 'text', {
      value: () =>
        Promise.resolve(
          JSON.stringify({
            access_token: 'at-2',
            refresh_token: 'rt-2',
            email: 'bar@example.com'
          })
        )
    })
    Object.defineProperty(input.element, 'files', {
      value: [file]
    })

    await input.trigger('change')
    await wrapper.get('[data-testid="local-cache-import-button"]').trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(importData).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accounts: [
          expect.objectContaining({
            name: 'antigravity bar@example.com',
            extra: {}
          })
        ]
      }),
      skip_default_group_bind: true
    })
  })

  it('选择 Gemini 分组后导入和命令会带上 group_id', async () => {
    importData.mockResolvedValue({
      proxy_created: 0,
      proxy_reused: 0,
      proxy_failed: 0,
      account_created: 1,
      account_failed: 0,
      errors: []
    })

    const wrapper = mount(ImportDataModal, {
      props: {
        show: true,
        groups: [
          {
            id: 88,
            name: 'Gemini Pool',
            description: null,
            platform: 'gemini',
            rate_multiplier: 1,
            subscription_type: 'standard',
            is_exclusive: false,
            status: 'active',
            daily_limit_usd: null,
            weekly_limit_usd: null,
            monthly_limit_usd: null,
            image_price_1k: null,
            image_price_2k: null,
            image_price_4k: null,
            claude_code_only: false,
            fallback_group_id: null,
            fallback_group_id_on_invalid_request: null,
            require_oauth_only: false,
            require_privacy_set: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            model_routing: null,
            model_routing_enabled: false,
            mcp_xml_inject: false,
            simulate_claude_max_enabled: false
          }
        ]
      },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    await wrapper.get('[data-testid="local-cache-gemini-group-select"]').setValue('88')
    await wrapper.get('[data-testid="local-sync-copy-button"]').trigger('click')

    expect(copyToClipboard).toHaveBeenCalledWith(
      [
        'cd /path/to/sub2api',
        'python3 tools/sync_antigravity_accounts.py \\',
        "  --admin-base-url 'https://your-sub2api.example.com' \\",
        "  --admin-api-key 'YOUR_ADMIN_API_KEY' \\",
        '  --group-id 88'
      ].join('\n'),
      'admin.accounts.dataImportLocalSyncCopied'
    )

    const input = wrapper.get('[data-testid="local-cache-file-input"]')
    const file = new File(
      [JSON.stringify({ refresh_token: 'rt-3', email: 'baz@example.com' })],
      'antigravity-baz@example.com.json',
      { type: 'application/json' }
    )
    Object.defineProperty(file, 'text', {
      value: () => Promise.resolve(JSON.stringify({ refresh_token: 'rt-3', email: 'baz@example.com' }))
    })
    Object.defineProperty(input.element, 'files', {
      value: [file]
    })

    await input.trigger('change')
    await wrapper.get('[data-testid="local-cache-import-button"]').trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(importData).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accounts: [
          expect.objectContaining({
            name: 'antigravity baz@example.com',
            group_ids: [88]
          })
        ]
      }),
      skip_default_group_bind: true
    })

    expect(wrapper.emitted('imported')).toEqual([
      [
        {
          targetGroupId: 88,
          targetGroupName: 'Gemini Pool',
          targetGroupPlatform: 'gemini'
        }
      ]
    ])
  })
})
