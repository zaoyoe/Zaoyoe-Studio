#!/usr/bin/env python3
"""Fix language selector highlight in framer_home.js"""

file_path = '/Volumes/chao/AI/xianyu_profit_calculator/js/framer_home.js'

# Read the file
with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find and replace the specific lines
modified = False
for i in range(len(lines)):
    # Replace the render function declaration to include currentLang
    if i < len(lines) - 1 and lines[i].strip() == 'render: () => {' and 'settings' in ''.join(lines[max(0, i-5):i]):
        # Insert the currentLang declaration after the opening brace
        if 'const currentLang' not in lines[i+1]:
            lines[i] = lines[i].rstrip() + '\n'
            lines.insert(i+1, "          const currentLang = window.i18n?.getCurrentLanguage() || 'zh';\n")
            modified = True
            print(f"✓ Added currentLang declaration at line {i+2}")
    
    # Replace the Chinese language span
    if 'langZhDropdown' in lines[i] and 'class="lang-text active"' in lines[i]:
        lines[i] = lines[i].replace(
            'class="lang-text active"',
            'class="lang-text ${currentLang === \'zh\' ? \'active\' : \'\'}"'
        )
        modified = True
        print(f"✓ Updated Chinese lang selector at line {i+1}")
    
    # Replace the English language span
    if 'langEnDropdown' in lines[i] and 'class="lang-text"' in lines[i] and 'langZh' not in lines[i]:
        lines[i] = lines[i].replace(
            'class="lang-text"',
            'class="lang-text ${currentLang === \'en\' ? \'active\' : \'\'}"'
        )
        modified = True
        print(f"✓ Updated English lang selector at line {i+1}")

if modified:
    # Write the file back
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print(f"\n✅ Successfully updated {file_path}")
else:
    print("❌ No changes made - pattern not found")
