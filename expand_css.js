const fs = require('fs');
try {
    let css = fs.readFileSync('admin-studio.css', 'utf8');
    // Replace #module-users .some-class with :is(#module-users, #module-discounts, #module-tickets) .some-class 
    // Need to handle both #module-users { and #module-users .something {

    // Using Regex to find `#module-users` followed by space, pseudo class (like :), or comma
    // Actually, simply replacing `#module-users ` with `:is(#module-users, #module-discounts, #module-tickets) ` is the safest for descendant selectors.
    // Also `#module-users{` or `#module-users,` if any.

    css = css.replace(/#module-users\b(?![a-zA-Z0-9_\-])/g, ':is(#module-users, #module-discounts, #module-tickets)');

    fs.writeFileSync('admin-studio.css', css, 'utf8');
    console.log("Successfully updated admin-studio.css selectors!");
} catch (e) {
    console.error(e);
}
