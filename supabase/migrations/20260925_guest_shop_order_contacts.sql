-- Store a recoverable, authenticated-encrypted copy of the guest checkout
-- contact only for service-role admin workflows. The HMAC remains the identity
-- and lookup value; this table is deliberately unreachable from browser roles.
CREATE TABLE IF NOT EXISTS public.guest_shop_order_contacts (
    guest_order_id UUID PRIMARY KEY
        REFERENCES public.guest_shop_orders(id) ON DELETE CASCADE,
    site TEXT NOT NULL CHECK (site IN ('cn', 'intl')),
    buyer_contact_hash TEXT NOT NULL
        CHECK (buyer_contact_hash ~ '^[0-9a-f]{64}$'),
    encrypted_email TEXT NOT NULL
        CHECK (length(encrypted_email) BETWEEN 32 AND 1024),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE public.guest_shop_order_contacts IS
    'Service-role-only encrypted guest checkout contact snapshots for authorized admin inventory detail. Never store plaintext email here.';
COMMENT ON COLUMN public.guest_shop_order_contacts.encrypted_email IS
    'AES-256-GCM v1 envelope. Key is GUEST_SHOP_CONTACT_EMAIL_ENCRYPTION_KEY; AAD binds site and guest_order_id.';

ALTER TABLE public.guest_shop_order_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_shop_order_contacts FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.guest_shop_order_contacts FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.guest_shop_order_contacts TO service_role;
