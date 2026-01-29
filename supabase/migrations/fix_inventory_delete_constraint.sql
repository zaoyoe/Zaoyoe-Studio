-- Fix foreign key constraint to allow deletion of inventory
-- This script modifies the shop_order_items table to allow deletion of inventory items
-- by setting the inventory_id to NULL in related order items when an inventory item is deleted.

BEGIN;

-- 1. Drop the existing strict constraint
ALTER TABLE shop_order_items 
DROP CONSTRAINT IF EXISTS shop_order_items_inventory_id_fkey;

-- 2. Add the new constraint with ON DELETE SET NULL
-- This ensures that if you delete an inventory item, the order record remains but unlinked
ALTER TABLE shop_order_items
ADD CONSTRAINT shop_order_items_inventory_id_fkey
FOREIGN KEY (inventory_id)
REFERENCES shop_inventory(id)
ON DELETE SET NULL;

COMMIT;
