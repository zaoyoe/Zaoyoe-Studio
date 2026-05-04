BEGIN;

ALTER TABLE IF EXISTS public.system_notifications
    ADD COLUMN IF NOT EXISTS action_url TEXT,
    ADD COLUMN IF NOT EXISTS action_label TEXT,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
    ADD COLUMN IF NOT EXISTS source_module TEXT,
    ADD COLUMN IF NOT EXISTS source_event_id TEXT;

CREATE INDEX IF NOT EXISTS idx_system_notifications_user_robot_feed
    ON public.system_notifications (user_id, scope, is_read, priority DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_notifications_dedupe_key
    ON public.system_notifications (dedupe_key)
    WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.engagement_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'general',
    page_ids TEXT[] NOT NULL DEFAULT ARRAY['all']::TEXT[],
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    action_label TEXT NOT NULL DEFAULT '',
    action_url TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT 'info',
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.engagement_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    definition JSONB NOT NULL DEFAULT '{}'::JSONB,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.engagement_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL DEFAULT '未命名触达规则',
    description TEXT NOT NULL DEFAULT '',
    site TEXT NOT NULL DEFAULT 'all',
    page_ids TEXT[] NOT NULL DEFAULT ARRAY['all']::TEXT[],
    placement TEXT NOT NULL DEFAULT 'robot_bubble',
    trigger_type TEXT NOT NULL DEFAULT 'page_view',
    audience JSONB NOT NULL DEFAULT '{}'::JSONB,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    action_label TEXT NOT NULL DEFAULT '',
    action_url TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT 'info',
    icon TEXT NOT NULL DEFAULT 'robot',
    priority INTEGER NOT NULL DEFAULT 0,
    frequency TEXT NOT NULL DEFAULT 'once_per_day',
    dismiss_ttl_hours INTEGER NOT NULL DEFAULT 24,
    enabled BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'draft',
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT engagement_rules_site_check CHECK (site IN ('all', 'cn', 'intl')),
    CONSTRAINT engagement_rules_status_check CHECK (status IN ('draft', 'published', 'paused', 'archived')),
    CONSTRAINT engagement_rules_priority_check CHECK (priority BETWEEN -1000 AND 1000),
    CONSTRAINT engagement_rules_schedule_check CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);

CREATE INDEX IF NOT EXISTS idx_engagement_rules_public_lookup
    ON public.engagement_rules (enabled, status, site, priority DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_rules_pages_gin
    ON public.engagement_rules USING GIN (page_ids);

CREATE TABLE IF NOT EXISTS public.engagement_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID REFERENCES public.engagement_rules(id) ON DELETE CASCADE,
    notification_id UUID REFERENCES public.system_notifications(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    reader_key TEXT NOT NULL DEFAULT '',
    page_id TEXT NOT NULL DEFAULT 'unknown',
    site TEXT NOT NULL DEFAULT 'all',
    status TEXT NOT NULL DEFAULT 'delivered',
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    viewed_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    CONSTRAINT engagement_deliveries_status_check CHECK (status IN ('delivered', 'viewed', 'clicked', 'dismissed', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_engagement_deliveries_user_page
    ON public.engagement_deliveries (user_id, page_id, delivered_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_deliveries_reader_page
    ON public.engagement_deliveries (reader_key, page_id, delivered_at DESC);

CREATE TABLE IF NOT EXISTS public.engagement_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID REFERENCES public.engagement_rules(id) ON DELETE SET NULL,
    notification_id UUID REFERENCES public.system_notifications(id) ON DELETE SET NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reader_key TEXT NOT NULL DEFAULT '',
    page_id TEXT NOT NULL DEFAULT 'unknown',
    site TEXT NOT NULL DEFAULT 'all',
    event_type TEXT NOT NULL,
    source_module TEXT NOT NULL DEFAULT 'engagement',
    source_event_id TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT engagement_events_event_type_check CHECK (event_type IN ('view', 'click', 'dismiss', 'conversion'))
);

CREATE INDEX IF NOT EXISTS idx_engagement_events_rule_event
    ON public.engagement_events (rule_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_events_notification_event
    ON public.engagement_events (notification_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_events_page_event
    ON public.engagement_events (page_id, event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.engagement_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT 'rule',
    target_id TEXT NOT NULL DEFAULT '',
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.set_engagement_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_engagement_templates_updated_at ON public.engagement_templates;
CREATE TRIGGER trigger_engagement_templates_updated_at
BEFORE UPDATE ON public.engagement_templates
FOR EACH ROW
EXECUTE FUNCTION public.set_engagement_updated_at();

DROP TRIGGER IF EXISTS trigger_engagement_segments_updated_at ON public.engagement_segments;
CREATE TRIGGER trigger_engagement_segments_updated_at
BEFORE UPDATE ON public.engagement_segments
FOR EACH ROW
EXECUTE FUNCTION public.set_engagement_updated_at();

DROP TRIGGER IF EXISTS trigger_engagement_rules_updated_at ON public.engagement_rules;
CREATE TRIGGER trigger_engagement_rules_updated_at
BEFORE UPDATE ON public.engagement_rules
FOR EACH ROW
EXECUTE FUNCTION public.set_engagement_updated_at();

ALTER TABLE public.engagement_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage engagement templates" ON public.engagement_templates;
CREATE POLICY "Admins can manage engagement templates"
    ON public.engagement_templates FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can manage engagement segments" ON public.engagement_segments;
CREATE POLICY "Admins can manage engagement segments"
    ON public.engagement_segments FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can manage engagement rules" ON public.engagement_rules;
CREATE POLICY "Admins can manage engagement rules"
    ON public.engagement_rules FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can view engagement deliveries" ON public.engagement_deliveries;
CREATE POLICY "Admins can view engagement deliveries"
    ON public.engagement_deliveries FOR SELECT
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can view engagement events" ON public.engagement_events;
CREATE POLICY "Admins can view engagement events"
    ON public.engagement_events FOR SELECT
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can view engagement audit logs" ON public.engagement_audit_logs;
CREATE POLICY "Admins can view engagement audit logs"
    ON public.engagement_audit_logs FOR SELECT
    USING (public.is_admin());

INSERT INTO public.engagement_templates (key, name, description, category, page_ids, title, content, action_label, action_url, tone)
VALUES
    ('points_insufficient', '积分不足提醒', '购买、验证或解锁时积分不足，引导用户充值。', 'points', ARRAY['shop', 'verify', 'prompts'], '积分不足', '当前积分不够完成这次操作，可以先去钱包充值。', '去充值', '/index.html#wallet', 'warning'),
    ('comment_replied', '评论被回复', '留言或 Prompt 评论被回复时，引导用户回到上下文。', 'community', ARRAY['guestbook', 'prompts'], '有人回复了你', '你的留言或评论收到了新回复。', '查看回复', '/guestbook.html', 'info'),
    ('coupon_available', '商品可领券', '商品有公开可领取优惠券时，提醒用户领取。', 'commerce', ARRAY['shop'], '这件商品有优惠', '当前商品有可领取的卡券，领取后下单可直接使用。', '立即领取', '/shop.html', 'success'),
    ('permission_changed', '权限变更通知', '管理员权限、访问范围或到期时间发生变化。', 'account', ARRAY['home'], '账号权限已更新', '你的账号权限发生了变化，请查看最新可用功能。', '查看账号', '/index.html', 'info')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.engagement_rules IS 'Customer engagement rules rendered through the public support robot bubble.';
COMMENT ON TABLE public.engagement_events IS 'Robot bubble engagement events: view, click, dismiss, and conversion.';
COMMENT ON COLUMN public.system_notifications.action_url IS 'Optional deep link used by the notification drawer and support robot bubble.';
COMMENT ON COLUMN public.system_notifications.dedupe_key IS 'Stable key for preventing duplicate user-facing notifications.';

COMMIT;
