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
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getMainSiteUrl } from '@/lib/main-site'

import './type-led-home.css'

type TypeLedHomeProps = {
  isAuthenticated: boolean
}

type ProtocolName = 'openai' | 'claude' | 'gemini'
type PathName = 'topup' | 'connect' | 'call'

const PROTOCOLS: Record<
  ProtocolName,
  {
    label: string
    word: string
    path: string
    caption: string
    endpoint: string
    model: string
    route: string
    target: string
  }
> = {
  openai: {
    label: 'OPENAI / CHAT',
    word: 'OPENAI',
    path: 'POST /v1/chat/completions',
    caption: 'Chat Completions',
    endpoint: 'https://new.fatherkey.com/v1',
    model: 'your-model',
    route: 'OpenAI compatible',
    target: 'Chat Completions',
  },
  claude: {
    label: 'CLAUDE / MESSAGES',
    word: 'CLAUDE',
    path: 'POST /v1/messages',
    caption: 'Messages',
    endpoint: 'https://new.fatherkey.com/v1',
    model: 'your-model',
    route: 'Anthropic compatible',
    target: 'Messages',
  },
  gemini: {
    label: 'GEMINI / GENERATE',
    word: 'GEMINI',
    path: 'POST /v1beta/models',
    caption: 'Generate Content',
    endpoint: 'https://new.fatherkey.com/v1beta',
    model: 'your-model',
    route: 'Gemini compatible',
    target: 'Generate Content',
  },
}

function ArrowIcon() {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
      <path d='M7 7h10v10' />
      <path d='M7 17 17 7' />
    </svg>
  )
}

function BrandMark() {
  return (
    <>
      <span className='brand-mark'>FK</span>
      <span className='brand-name'>FatherKey</span>
    </>
  )
}

export function TypeLedHome({ isAuthenticated }: TypeLedHomeProps) {
  const { t, i18n } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [progress, setProgress] = useState(0)
  const [activePath, setActivePath] = useState<PathName>('topup')
  const [protocol, setProtocol] = useState<ProtocolName>('openai')
  const [flow, setFlow] = useState<ProtocolName>('openai')
  const [mainSiteUrl] = useState(() => getMainSiteUrl())
  const [hostLabel] = useState(
    () => globalThis.location?.host || 'new.fatherkey.com'
  )
  const protocolItem = PROTOCOLS[protocol]
  const flowItem = PROTOCOLS[flow]
  const isZh =
    i18n.language === 'zhCN' ||
    i18n.language === 'zhTW' ||
    i18n.language.startsWith('zh')
  const consoleTo = isAuthenticated ? '/dashboard' : '/sign-in'
  const startTo = isAuthenticated ? '/dashboard' : '/sign-up'

  useEffect(() => {
    document.documentElement.classList.add('fk-home-active')
    return () => {
      document.documentElement.classList.remove('fk-home-active')
    }
  }, [])

  useEffect(() => {
    const updateProgress = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0)
    }
    updateProgress()
    window.addEventListener('scroll', updateProgress, { passive: true })
    return () => window.removeEventListener('scroll', updateProgress)
  }, [])

  return (
    <div
      ref={rootRef}
      className='fk-home'
      onMouseMove={(event) => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          return
        }
        const hero = event.currentTarget.querySelector('.hero')
        if (!(hero instanceof HTMLElement)) return
        const rect = hero.getBoundingClientRect()
        if (
          event.clientY < rect.top ||
          event.clientY > rect.bottom ||
          event.clientX < rect.left ||
          event.clientX > rect.right
        ) {
          return
        }
        const x = ((event.clientX - rect.left) / rect.width - 0.5) * 28
        const y = ((event.clientY - rect.top) / rect.height - 0.5) * 18
        event.currentTarget.style.setProperty(
          '--pointer-x',
          `${x.toFixed(1)}px`
        )
        event.currentTarget.style.setProperty(
          '--pointer-y',
          `${y.toFixed(1)}px`
        )
      }}
      onMouseLeave={() => {
        rootRef.current?.style.setProperty('--pointer-x', '0px')
        rootRef.current?.style.setProperty('--pointer-y', '0px')
      }}
    >
      <header className='site-header'>
        <a
          className='brand'
          href={mainSiteUrl}
          target='_blank'
          rel='noopener noreferrer'
        >
          <BrandMark />
        </a>
        <nav
          className={menuOpen ? 'main-nav is-open' : 'main-nav'}
          aria-label={t('How to start')}
        >
          <a href='#paths' onClick={() => setMenuOpen(false)}>
            {t('How to start')}
          </a>
          <a href='#protocol' onClick={() => setMenuOpen(false)}>
            {t('Protocols')}
          </a>
          <a href='#ledger' onClick={() => setMenuOpen(false)}>
            {t('Credits')}
          </a>
          <a href='#flow' onClick={() => setMenuOpen(false)}>
            {t('Route')}
          </a>
        </nav>
        <div className='nav-actions'>
          <div className='lang-switch' role='group' aria-label='Language'>
            <button
              type='button'
              className={isZh ? 'is-active' : undefined}
              onClick={() => {
                void i18n.changeLanguage('zhCN')
              }}
            >
              中文
            </button>
            <button
              type='button'
              className={isZh ? undefined : 'is-active'}
              onClick={() => {
                void i18n.changeLanguage('en')
              }}
            >
              EN
            </button>
          </div>
          {isAuthenticated ? null : (
            <Link className='nav-login' to='/sign-in'>
              {t('Sign in')}
            </Link>
          )}
          <Link className='nav-start' to={startTo}>
            {isAuthenticated ? t('Go to Dashboard') : t('Get started')}
          </Link>
          <button
            className='menu-button'
            type='button'
            aria-label={t('Menu')}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg
              width='17'
              height='17'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
            >
              <path d='M4 5h16M4 12h16M4 19h16' />
            </svg>
          </button>
        </div>
      </header>

      <div className='page-progress' aria-hidden='true'>
        <span style={{ transform: `scaleY(${progress})` }} />
      </div>

      <main>
        <section className='hero' aria-labelledby='hero-title'>
          <div className='hero-type' aria-hidden='true'>
            <span className='word word-route'>ROUTE</span>
            <span className='word word-key'>FATHERKEY</span>
            <span className='word word-access'>ACCESS</span>
            <span className='word word-father'>FATHER</span>
          </div>
          <div className='hero-center'>
            <span className='kicker'>
              API GATEWAY · MODEL ACCESS · USAGE LEDGER
            </span>
            <h1 id='hero-title'>FatherKey</h1>
            <p className='lead'>{t('One key, many models.')}</p>
            <p className='subtitle'>
              {t(
                'Compatible APIs, usage ledger, and access control in one console.'
              )}
            </p>
            <div className='hero-actions'>
              <Link className='arrow-link button-light' to={consoleTo}>
                <span>{t('Open console')}</span>
                <ArrowIcon />
              </Link>
              <Link className='arrow-link button-outline' to='/keys'>
                <span>{t('Connect API')}</span>
                <ArrowIcon />
              </Link>
            </div>
          </div>
          <div className='hero-meta' aria-label={t('Protocols')}>
            <span>
              <i className='status-dot' />
              ALL SYSTEMS NORMAL
            </span>
            <span>OPENAI · CLAUDE · GEMINI</span>
            <span>SMART ROUTING</span>
            <span>USAGE LEDGER</span>
          </div>
          <div className='scroll-cue' aria-hidden='true'>
            <i />
            EXPLORE
          </div>
        </section>

        <section className='paths' id='paths'>
          <div className='band-heading'>
            <span className='section-label label-violet'>
              {t('01 / Choose a path')}
            </span>
            <h2>
              {t('Same account.')}
              <br />
              {t('Start where you are.')}
            </h2>
            <p>
              {t(
                'Top up on the main site. Keys, models, and usage stay in the console.'
              )}
            </p>
          </div>
          <div className='path-grid'>
            <article
              className={
                activePath === 'topup' ? 'path-card is-active' : 'path-card'
              }
              data-word='TOPUP'
              onMouseEnter={() => setActivePath('topup')}
            >
              <div className='path-top'>
                <span>01 / TOP UP</span>
                <small>{t('Main site')}</small>
              </div>
              <h3>{t('Top up')}</h3>
              <p>
                {t(
                  'Buy credits on the main site. This console only routes, meters, and issues keys.'
                )}
              </p>
              <div className='tags'>
                <span>{t('Main wallet')}</span>
                <span>{t('Synced quota')}</span>
                <span>{t('Visible ledger')}</span>
              </div>
              <a
                className='arrow-link'
                href={mainSiteUrl}
                target='_blank'
                rel='noopener noreferrer'
              >
                <span>{t('Recharge on main site')}</span>
                <ArrowIcon />
              </a>
            </article>
            <article
              className={
                activePath === 'connect'
                  ? 'path-card path-connect is-active'
                  : 'path-card path-connect'
              }
              data-word='CONNECT'
              onMouseEnter={() => setActivePath('connect')}
            >
              <div className='path-top'>
                <span>02 / CONNECT</span>
                <small>{t('Unified API')}</small>
              </div>
              <h3>{t('Connect APIs')}</h3>
              <p>
                {t(
                  'Use the interfaces you already know. Routing, availability, and key permissions stay here.'
                )}
              </p>
              <div className='tags'>
                <span>{t('One endpoint')}</span>
                <span>{t('Model switch')}</span>
                <span>{t('Key scopes')}</span>
              </div>
              <Link className='arrow-link' to='/keys'>
                <span>{t('Manage API keys')}</span>
                <ArrowIcon />
              </Link>
            </article>
            <article
              className={
                activePath === 'call'
                  ? 'path-card path-call is-active'
                  : 'path-card path-call'
              }
              data-word='CALL'
              onMouseEnter={() => setActivePath('call')}
            >
              <div className='path-top'>
                <span>03 / CALL</span>
                <small>{t('Model catalog')}</small>
              </div>
              <h3>{t('Call models')}</h3>
              <p>
                {t(
                  'Pick a model, then point your app, script, or client at the same key.'
                )}
              </p>
              <div className='tags'>
                <span>{t('Catalog')}</span>
                <span>{t('Multi-protocol')}</span>
                <span>{t('Usage tracking')}</span>
              </div>
              <Link className='arrow-link' to='/pricing'>
                <span>{t('Open model catalog')}</span>
                <ArrowIcon />
              </Link>
            </article>
          </div>
        </section>

        <section className='studio' id='protocol'>
          <div className='studio-copy'>
            <span className='section-label label-blue'>
              {t('02 / Compatible APIs')}
            </span>
            <h2>
              {t('Familiar routes.')}
              <br />
              {t('One ledger.')}
            </h2>
            <p>
              {t(
                'Keep your current protocol. Models, routing, and usage still land in this console.'
              )}
            </p>
            <div className='mode-tabs' role='tablist'>
              <button
                type='button'
                className={protocol === 'openai' ? 'is-active' : undefined}
                onClick={() => setProtocol('openai')}
              >
                <span>01</span>
                <strong>{t('Chat Completions')}</strong>
                <small>/v1/chat/completions</small>
              </button>
              <button
                type='button'
                className={protocol === 'claude' ? 'is-active' : undefined}
                onClick={() => setProtocol('claude')}
              >
                <span>02</span>
                <strong>{t('Messages')}</strong>
                <small>/v1/messages</small>
              </button>
              <button
                type='button'
                className={protocol === 'gemini' ? 'is-active' : undefined}
                onClick={() => setProtocol('gemini')}
              >
                <span>03</span>
                <strong>{t('Generate Content')}</strong>
                <small>/v1beta/models</small>
              </button>
            </div>
          </div>
          <div className='studio-console'>
            <div className='console-head'>
              <span>{protocolItem.label}</span>
              <span>
                <i className='status-dot' />
                READY
              </span>
            </div>
            <div className='console-main'>
              <div className='preview-pane'>
                <div className='preview-scan' />
                <div className='preview-path'>{protocolItem.path}</div>
                <div className='preview-word'>{protocolItem.word}</div>
                <div className='preview-bars' aria-hidden='true'>
                  <i style={{ height: '38%' }} />
                  <i style={{ height: '72%' }} />
                  <i style={{ height: '46%' }} />
                  <i style={{ height: '88%' }} />
                  <i style={{ height: '31%' }} />
                  <i style={{ height: '64%' }} />
                  <i style={{ height: '52%' }} />
                  <i style={{ height: '79%' }} />
                  <i style={{ height: '41%' }} />
                  <i style={{ height: '93%' }} />
                  <i style={{ height: '27%' }} />
                  <i style={{ height: '58%' }} />
                </div>
                <div className='preview-caption'>
                  <span>PROTOCOL LIVE</span>
                  <strong>{protocolItem.caption}</strong>
                </div>
              </div>
              <div className='specs'>
                <div>
                  <span>ENDPOINT</span>
                  <strong>{protocolItem.endpoint}</strong>
                </div>
                <div>
                  <span>AUTH</span>
                  <strong>Bearer sk-••••</strong>
                </div>
                <div>
                  <span>MODEL</span>
                  <strong>{protocolItem.model}</strong>
                </div>
                <div>
                  <span>LEDGER</span>
                  <strong>{t('Metered in console')}</strong>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className='growth' id='ledger'>
          <div className='growth-words' aria-hidden='true'>
            <span>TOPUP</span>
            <span>ROUTE</span>
            <span>LEDGER</span>
            <span>KEYS</span>
          </div>
          <div className='growth-rings' aria-hidden='true'>
            <i />
            <i />
          </div>
          <div className='growth-center'>
            <span className='section-label label-coral'>
              {t('03 / Credits')}
            </span>
            <h2>
              {t('Top up on the main site.')}
              <br />
              {t('Keep the ledger clear.')}
            </h2>
            <p>
              {t(
                'Payments stay on the main site. The console shows balance, calls, and keys.'
              )}
            </p>
            <a
              className='arrow-link button-light'
              href={mainSiteUrl}
              target='_blank'
              rel='noopener noreferrer'
            >
              <span>{t('Recharge on main site')}</span>
              <ArrowIcon />
            </a>
          </div>
          <div className='growth-metrics'>
            <div>
              <span>{t('Top-up entry')}</span>
              <strong>{t('Main wallet')}</strong>
            </div>
            <div>
              <span>{t('Calls')}</span>
              <strong>{hostLabel}</strong>
            </div>
            <div>
              <span>{t('Ledger')}</span>
              <strong>{t('Console usage')}</strong>
            </div>
          </div>
        </section>

        <section className='flow' id='flow'>
          <div className='flow-word' aria-hidden='true'>
            ROUTE
          </div>
          <div className='flow-center'>
            <span className='section-label label-coral'>
              {t('04 / How it routes')}
            </span>
            <div className='flow-tabs' role='tablist'>
              <button
                type='button'
                className={flow === 'openai' ? 'is-active' : undefined}
                onClick={() => setFlow('openai')}
              >
                OpenAI
              </button>
              <button
                type='button'
                className={flow === 'claude' ? 'is-active' : undefined}
                onClick={() => setFlow('claude')}
              >
                Claude
              </button>
              <button
                type='button'
                className={flow === 'gemini' ? 'is-active' : undefined}
                onClick={() => setFlow('gemini')}
              >
                Gemini
              </button>
            </div>
            <h2>{t('One key. Three protocols.')}</h2>
            <p>
              {t(
                'Your app talks to FatherKey. We route by protocol. Usage still lands in one ledger.'
              )}
            </p>
          </div>
          <div className='flow-trace'>
            <div>
              <span>{t('FROM')}</span>
              <strong>your app</strong>
            </div>
            <div className='trace-line'>
              <i />
              <b />
              <span>{flowItem.route}</span>
            </div>
            <div className='trace-target'>
              <span>{t('TO')}</span>
              <strong>{flowItem.target}</strong>
            </div>
          </div>
          <div className='flow-foot'>
            <span>KEY</span>
            <i />
            <span>ROUTE</span>
            <i />
            <span>LEDGER</span>
          </div>
        </section>

        <section className='final' id='start'>
          <div className='final-type' aria-hidden='true'>
            <span>START</span>
            <span>KEY</span>
            <span>NOW</span>
          </div>
          <div className='final-center'>
            <span className='section-label label-lime'>
              {t('05 / Start here')}
            </span>
            <h2>{t('Start with the actual task.')}</h2>
            <p>
              {t(
                'Top up, connect, or browse models. Account and security stay the same.'
              )}
            </p>
            <div className='final-actions'>
              <a
                className='arrow-link'
                href={mainSiteUrl}
                target='_blank'
                rel='noopener noreferrer'
              >
                <span>{t('Recharge on main site')}</span>
                <ArrowIcon />
              </a>
              <Link className='arrow-link button-outline' to='/keys'>
                <span>{t('API access')}</span>
                <ArrowIcon />
              </Link>
              <Link className='arrow-link button-outline' to='/pricing'>
                <span>{t('Open model catalog')}</span>
                <ArrowIcon />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className='site-footer'>
        <a
          className='brand'
          href={mainSiteUrl}
          target='_blank'
          rel='noopener noreferrer'
        >
          <BrandMark />
        </a>
        <span>{t('API management platform')}</span>
        <span>{hostLabel}</span>
      </footer>
    </div>
  )
}
