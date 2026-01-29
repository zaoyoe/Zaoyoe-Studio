-- Drop the old restricted policy
DROP POLICY IF EXISTS "Admins manage inventory" ON shop_inventory;

-- Create the new policy allowing specific emails
CREATE POLICY "Admins manage inventory" ON shop_inventory FOR ALL USING (
    public.is_admin() OR 
    (auth.jwt() ->> 'email') IN ('fjivvid@163.com', 'zaoyoe@gmail.com')
);

-- Verify it worked
SELECT * FROM pg_policies WHERE tablename = 'shop_inventory';
