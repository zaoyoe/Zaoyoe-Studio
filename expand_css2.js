const fs = require('fs');
try {
    let css = fs.readFileSync('admin-studio.css', 'utf8');

    // Replace #usersTable with .users-table globally
    css = css.replace(/#usersTable\b/g, '.users-table');

    fs.writeFileSync('admin-studio.css', css, 'utf8');
    console.log("Successfully updated #usersTable to .users-table!");
} catch (e) {
    console.error(e);
}
