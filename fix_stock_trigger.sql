-- =============================================
-- FIX: Automatically update Product stock_count
-- =============================================

-- 1. Create a function to increment/decrement stock on Inventory changes
CREATE OR REPLACE FUNCTION fn_trigger_update_stock_count() 
RETURNS TRIGGER AS $$
BEGIN
    -- Case: Insert (Import Inventory) -> Increment
    IF (TG_OP = 'INSERT') THEN
        IF (NEW.status = 'available') THEN
            UPDATE shop_products 
            SET stock_count = stock_count + 1 
            WHERE id = NEW.product_id;
        END IF;
        RETURN NEW;

    -- Case: Update (e.g. Purchase: available -> sold) -> Decrement
    ELSIF (TG_OP = 'UPDATE') THEN
        -- available -> something else (sold/frozen)
        IF (OLD.status = 'available' AND NEW.status != 'available') THEN
             UPDATE shop_products 
             SET stock_count = stock_count - 1 
             WHERE id = NEW.product_id;
        
        -- something else -> available (Restock/Refund)
        ELSIF (OLD.status != 'available' AND NEW.status = 'available') THEN
             UPDATE shop_products 
             SET stock_count = stock_count + 1 
             WHERE id = NEW.product_id;
        END IF;
        RETURN NEW;

    -- Case: Delete (Remove Inventory) -> Decrement
    ELSIF (TG_OP = 'DELETE') THEN
        IF (OLD.status = 'available') THEN
            UPDATE shop_products 
            SET stock_count = stock_count - 1 
            WHERE id = OLD.product_id;
        END IF;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create the Trigger on shop_inventory
DROP TRIGGER IF EXISTS tr_shop_inventory_stock ON shop_inventory;

CREATE TRIGGER tr_shop_inventory_stock
AFTER INSERT OR UPDATE OR DELETE ON shop_inventory
FOR EACH ROW EXECUTE FUNCTION fn_trigger_update_stock_count();

-- 3. One-time Sync for existing data (Reset all counts to correct values)
WITH real_counts AS (
    SELECT product_id, COUNT(*) as cnt 
    FROM shop_inventory 
    WHERE status = 'available'
    GROUP BY product_id
)
UPDATE shop_products p
SET stock_count = COALESCE((SELECT cnt FROM real_counts rc WHERE rc.product_id = p.id), 0);

-- 4. Verification
SELECT name, stock_count FROM shop_products;
