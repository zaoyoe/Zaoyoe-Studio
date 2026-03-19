-- Fix the RLS policy on shop_tickets specifically for UPDATE
-- Replaces auth.users queries (which cause permission denied) with auth.jwt()

DROP POLICY IF EXISTS "Admins can view all tickets" ON public.shop_tickets;
DROP POLICY IF EXISTS "Admins can update tickets" ON public.shop_tickets;
DROP POLICY IF EXISTS "Admins can delete tickets" ON public.shop_tickets;

-- Also drop the original blanket policy
DROP POLICY IF EXISTS "Admins have full access to tickets" ON public.shop_tickets;

-- 1. SELECT Policy (Admins can view all tickets)
CREATE POLICY "Admins can view all tickets"
ON public.shop_tickets FOR SELECT
USING (public.is_admin());

-- 2. UPDATE Policy (Admins can update all tickets)
CREATE POLICY "Admins can update tickets"
ON public.shop_tickets FOR UPDATE
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 3. DELETE Policy (Admins can delete tickets)
CREATE POLICY "Admins can delete tickets"
ON public.shop_tickets FOR DELETE
USING (public.is_super_admin());
