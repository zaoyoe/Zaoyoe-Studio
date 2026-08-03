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
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import {
  SettingsControlGroup,
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const countryCodesSchema = z.string().refine((value) => {
  const codes = value
    .split(/[\s,]+/)
    .map((code) => code.trim())
    .filter(Boolean)
  return codes.every((code) => /^[a-z]{2}$/i.test(code))
}, 'Use two-letter country codes separated by commas or spaces')

const regionalRestrictionSchema = z.object({
  regional_restriction: z.object({
    enabled: z.boolean(),
    registration_enabled: z.boolean(),
    oauth_signup_enabled: z.boolean(),
    api_key_page_confirmation_enabled: z.boolean(),
    api_key_create_enabled: z.boolean(),
    blocked_country_codes: countryCodesSchema,
    unknown_region_policy: z.enum(['allow', 'deny']),
    confirmation_revision: z.string().trim().min(1, 'Revision is required'),
    confirmation_frequency: z.enum(['once_per_revision', 'always', 'interval']),
    confirmation_interval_hours: z.number().int().min(1).max(8760),
  }),
})

type RegionalRestrictionFormValues = z.output<typeof regionalRestrictionSchema>
type RegionalRestrictionFormInput = z.input<typeof regionalRestrictionSchema>

export type NormalizedRegionalRestrictionValues = {
  'regional_restriction.enabled': boolean
  'regional_restriction.registration_enabled': boolean
  'regional_restriction.oauth_signup_enabled': boolean
  'regional_restriction.api_key_page_confirmation_enabled': boolean
  'regional_restriction.api_key_create_enabled': boolean
  'regional_restriction.blocked_country_codes': string[]
  'regional_restriction.unknown_region_policy': 'allow' | 'deny'
  'regional_restriction.confirmation_revision': string
  'regional_restriction.confirmation_frequency':
    | 'once_per_revision'
    | 'always'
    | 'interval'
  'regional_restriction.confirmation_interval_hours': number
}

type RegionalRestrictionSectionProps = {
  defaultValues: NormalizedRegionalRestrictionValues
}

function normalizeCountryCodes(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,]+/)
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean)
    ),
  ]
}

function buildFormDefaults(
  defaults: NormalizedRegionalRestrictionValues
): RegionalRestrictionFormInput {
  return {
    regional_restriction: {
      enabled: defaults['regional_restriction.enabled'],
      registration_enabled:
        defaults['regional_restriction.registration_enabled'],
      oauth_signup_enabled:
        defaults['regional_restriction.oauth_signup_enabled'],
      api_key_page_confirmation_enabled:
        defaults['regional_restriction.api_key_page_confirmation_enabled'],
      api_key_create_enabled:
        defaults['regional_restriction.api_key_create_enabled'],
      blocked_country_codes:
        defaults['regional_restriction.blocked_country_codes'].join(', '),
      unknown_region_policy:
        defaults['regional_restriction.unknown_region_policy'],
      confirmation_revision:
        defaults['regional_restriction.confirmation_revision'],
      confirmation_frequency:
        defaults['regional_restriction.confirmation_frequency'],
      confirmation_interval_hours:
        defaults['regional_restriction.confirmation_interval_hours'],
    },
  }
}

function normalizeFormValues(
  values: RegionalRestrictionFormValues
): NormalizedRegionalRestrictionValues {
  return {
    'regional_restriction.enabled': values.regional_restriction.enabled,
    'regional_restriction.registration_enabled':
      values.regional_restriction.registration_enabled,
    'regional_restriction.oauth_signup_enabled':
      values.regional_restriction.oauth_signup_enabled,
    'regional_restriction.api_key_page_confirmation_enabled':
      values.regional_restriction.api_key_page_confirmation_enabled,
    'regional_restriction.api_key_create_enabled':
      values.regional_restriction.api_key_create_enabled,
    'regional_restriction.blocked_country_codes': normalizeCountryCodes(
      values.regional_restriction.blocked_country_codes
    ),
    'regional_restriction.unknown_region_policy':
      values.regional_restriction.unknown_region_policy,
    'regional_restriction.confirmation_revision':
      values.regional_restriction.confirmation_revision.trim(),
    'regional_restriction.confirmation_frequency':
      values.regional_restriction.confirmation_frequency,
    'regional_restriction.confirmation_interval_hours':
      values.regional_restriction.confirmation_interval_hours,
  }
}

function optionValuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right)
  }
  return left === right
}

export function RegionalRestrictionSection(
  props: RegionalRestrictionSectionProps
) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const baselineRef = useRef<NormalizedRegionalRestrictionValues>(
    props.defaultValues
  )
  const formDefaults = useMemo(
    () => buildFormDefaults(props.defaultValues),
    [props.defaultValues]
  )
  const form = useForm<
    RegionalRestrictionFormInput,
    unknown,
    RegionalRestrictionFormValues
  >({
    resolver: zodResolver(regionalRestrictionSchema),
    defaultValues: formDefaults,
  })

  useEffect(() => {
    baselineRef.current = props.defaultValues
    form.reset(buildFormDefaults(props.defaultValues))
  }, [form, props.defaultValues])

  const onSubmit = async (values: RegionalRestrictionFormValues) => {
    const normalized = normalizeFormValues(values)
    const changedKeys = (
      Object.keys(normalized) as Array<
        keyof NormalizedRegionalRestrictionValues
      >
    ).filter(
      (key) => !optionValuesEqual(normalized[key], baselineRef.current[key])
    )

    if (changedKeys.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    try {
      for (const key of changedKeys) {
        const value = normalized[key]
        await updateOption.mutateAsync({
          key,
          value: Array.isArray(value) ? JSON.stringify(value) : value,
        })
      }
    } catch {
      return
    }

    baselineRef.current = normalized
  }

  const confirmationFrequency = form.watch(
    'regional_restriction.confirmation_frequency'
  )

  return (
    <SettingsSection title={t('Regional Restriction')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save regional restriction settings'
          />

          <FormField
            control={form.control}
            name='regional_restriction.enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable regional restriction')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Apply regional checks only to registration, new OAuth accounts, API key page confirmation, and API key creation.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <SettingsControlGroup>
            <FormField
              control={form.control}
              name='regional_restriction.registration_enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Password registration')}</FormLabel>
                    <FormDescription>
                      {t('Restrict new password-based account registration.')}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />
            <FormField
              control={form.control}
              name='regional_restriction.oauth_signup_enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('New OAuth accounts')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Restrict first-time OAuth account creation without affecting existing-account login.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />
            <FormField
              control={form.control}
              name='regional_restriction.api_key_page_confirmation_enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('API key page confirmation')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Require confirmation before API key management is loaded.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />
            <FormField
              control={form.control}
              name='regional_restriction.api_key_create_enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('API key creation')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Check the current request region again before creating an API key.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />
          </SettingsControlGroup>

          <FormField
            control={form.control}
            name='regional_restriction.blocked_country_codes'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Blocked country codes')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className='font-mono uppercase'
                    placeholder='CN'
                    autoCapitalize='characters'
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Use two-letter country codes separated by commas or spaces. The default is CN.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='regional_restriction.unknown_region_policy'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Unknown region policy')}</FormLabel>
                <Select
                  items={[
                    { value: 'allow', label: t('Allow') },
                    { value: 'deny', label: t('Deny') },
                  ]}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value='allow'>{t('Allow')}</SelectItem>
                      <SelectItem value='deny'>{t('Deny')}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FormDescription>
                  {t(
                    'Allow is recommended so missing country headers do not cause false blocks.'
                  )}
                </FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='regional_restriction.confirmation_revision'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Confirmation revision')}</FormLabel>
                <FormControl>
                  <Input {...field} className='font-mono' />
                </FormControl>
                <FormDescription>
                  {t(
                    'Changing the revision invalidates prior browser confirmations.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='regional_restriction.confirmation_frequency'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Confirmation frequency')}</FormLabel>
                <Select
                  items={[
                    {
                      value: 'once_per_revision',
                      label: t('Once per confirmation revision'),
                    },
                    { value: 'always', label: t('Every page visit') },
                    { value: 'interval', label: t('After an interval') },
                  ]}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value='once_per_revision'>
                        {t('Once per confirmation revision')}
                      </SelectItem>
                      <SelectItem value='always'>
                        {t('Every page visit')}
                      </SelectItem>
                      <SelectItem value='interval'>
                        {t('After an interval')}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='regional_restriction.confirmation_interval_hours'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Confirmation interval hours')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type='number'
                    min={1}
                    max={8760}
                    step={1}
                    disabled={confirmationFrequency !== 'interval'}
                    onChange={(event) =>
                      field.onChange(
                        Number.parseInt(event.target.value, 10) || 1
                      )
                    }
                  />
                </FormControl>
                <FormDescription>
                  {t('Used only when confirmation frequency is interval.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
