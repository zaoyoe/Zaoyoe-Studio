import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = __dirname
const viewSource = readFileSync(resolve(here, '../ChannelsView.vue'), 'utf8')
const apiSource = readFileSync(resolve(here, '../../../api/admin/channels.ts'), 'utf8')

describe('channel upstream pricing sync surface', () => {
  it('places the action in the saved channel pricing section', () => {
    expect(viewSource).toContain("t('admin.channels.form.syncUpstreamPricing')")
    expect(viewSource).toContain('@click="syncUpstreamPricing(sIdx)"')
    expect(viewSource).toContain(':disabled="!editingChannel || syncingPricingPlatform === section.platform"')
    expect(viewSource).toContain('v-model="selectedUpstreamPricingGroup[section.platform]"')
    expect(viewSource).toContain('group: selectedUpstreamPricingGroup.value[section.platform] || undefined')
  })

  it('calls the channel-scoped backend endpoint and refreshes only pricing', () => {
    expect(apiSource).toContain('`/admin/channels/${id}/pricing/sync-upstream`')
    expect(apiSource).toContain("'/admin/channels/pricing/upstream-groups'")
    expect(viewSource).toContain('section.model_pricing = syncedSection.model_pricing')
    expect(viewSource).not.toContain('form.platforms = apiToForm(result.channel)')
  })
})
