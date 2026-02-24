import sys

def main():
    try:
        with open('admin-studio.html', 'r', encoding='utf-8') as f:
            lines = f.read().split('\n')

        start_discounts = -1
        end_tickets = -1
        for i, line in enumerate(lines):
            if '<!-- ========== DISCOUNTS MODULE ========== -->' in line:
                start_discounts = i
            if '<!-- Product Edit Modal (Redesigned) -->' in line:
                end_tickets = i - 1

        toast_idx = -1
        for i, line in enumerate(lines):
            if '<!-- Toast Notifications -->' in line:
                toast_idx = i

        if start_discounts > -1 and end_tickets > -1 and toast_idx > -1:
            modules = lines[start_discounts:end_tickets+1]
            del lines[start_discounts:end_tickets+1]
            
            # Since toast_idx is BEFORE start_discounts, deleting lines after it doesn't shift the toast_idx.
            # Wait, toast is BEFORE start_discounts.
            # Actually, toast_idx was around 5318. start_discounts was 5380.
            # So deleting 5380 to 5556 doesn't change 5318 at all.
            
            for i in range(len(modules)):
                lines.insert(toast_idx + i, modules[i])
                
            with open('admin-studio.html', 'w', encoding='utf-8', newline='') as f:
                f.write('\n'.join(lines))
            print('Success: Moved modules inside admin-main-content.')
        else:
            print(f'Failed: start={start_discounts}, end={end_tickets}, toast={toast_idx}')
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
