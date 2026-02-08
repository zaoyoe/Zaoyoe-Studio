#!/bin/bash
# Fix language selector highlight in framer_home.js

FILE="/Volumes/chao/AI/xianyu_profit_calculator/js/framer_home.js"

# Create backup
cp "$FILE" "$FILE.bak"

# Use awk to properly replace the render function
awk '
/^        render: \(\) => \{$/ {
    print "        render: () => {"
    print "          const currentLang = window.i18n?.getCurrentLanguage() || '\''zh'\'';"
    getline
    next
}
/^                <span id="langZhDropdown" class="lang-text active">中<\/span>$/ {
    print "                <span id=\"langZhDropdown\" class=\"lang-text ${currentLang === '\''zh'\'' ? '\''active'\'' : '\'''}\"
>中</span>"
    next
}
/^                <span id="langEnDropdown" class="lang-text">EN<\/span>$/ {
    print "                <span id=\"langEnDropdown\" class=\"lang-text ${currentLang === '\''en'\'' ? '\''active'\'' : '\'''}\"
>EN</span>"
    next
}
{ print }
' "$FILE.bak" > "$FILE"

echo "Fix applied successfully"
