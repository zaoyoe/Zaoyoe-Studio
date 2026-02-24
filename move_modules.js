const fs = require('fs');

try {
    const content = fs.readFileSync('admin-studio.html', 'utf8');
    const lines = content.split('\n');

    let start_discounts = -1;
    let end_tickets = -1;
    let toast_idx = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('<!-- ========== DISCOUNTS MODULE ==========')) {
            start_discounts = i;
        }
        if (lines[i].includes('<!-- Product Edit Modal (Redesigned) -->')) {
            end_tickets = i - 1;
        }
        if (lines[i].includes('<!-- Toast Notifications -->')) {
            toast_idx = i;
        }
    }

    if (start_discounts > -1 && end_tickets > -1 && toast_idx > -1) {
        // Extract modules
        const modules = lines.slice(start_discounts, end_tickets + 1);

        // Remove from original place
        lines.splice(start_discounts, modules.length);

        // toast_idx is still the same since we deleted lines AFTER toast_idx
        // Insert at toast_idx
        lines.splice(toast_idx, 0, ...modules);

        fs.writeFileSync('admin-studio.html', lines.join('\n'), 'utf8');
        console.log('Success: Moved modules inside admin-main-content.');
    } else {
        console.log(`Failed: start=${start_discounts}, end=${end_tickets}, toast=${toast_idx}`);
    }
} catch (e) {
    console.error(e);
}
