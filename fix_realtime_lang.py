#!/usr/bin/env python3
"""Add re-render logic for settings dropdown when showing"""

file_path = '/Volumes/chao/AI/xianyu_profit_calculator/js/framer_home.js'

# Read the file
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the showDropdown function and add re-render logic for settings
old_code = '''      const showDropdown = () => {
        clearTimeout(hideTimeout);
        // Position dropdown below nav bar (not trigger)
        const nav = document.querySelector('.framer-nav');
        const navRect = nav.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();
        dropdown.style.left = `${triggerRect.left + triggerRect.width / 2}px`;
        dropdown.style.top = `${navRect.bottom}px`;
        dropdown.classList.add('visible');
      };'''

new_code = '''      const showDropdown = () => {
        clearTimeout(hideTimeout);
        
        // Re-render settings dropdown to reflect current language
        if (dropdownType === 'settings' && data.type === 'custom' && data.render) {
          dropdown.innerHTML = data.render();
          // Re-bind language toggle event after re-render
          const langToggleBtn = document.getElementById('langToggleDropdown');
          if (langToggleBtn) {
            langToggleBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (window.i18n && typeof window.i18n.toggleLanguage === 'function') {
                window.i18n.toggleLanguage();
                console.log('🌐 Language toggle clicked');
              }
            });
          }
        }
        
        // Position dropdown below nav bar (not trigger)
        const nav = document.querySelector('.framer-nav');
        const navRect = nav.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();
        dropdown.style.left = `${triggerRect.left + triggerRect.width / 2}px`;
        dropdown.style.top = `${navRect.bottom}px`;
        dropdown.classList.add('visible');
      };'''

if old_code in content:
    content = content.replace(old_code, new_code)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("✅ Successfully added re-render logic to showDropdown")
else:
    print("❌ Could not find the showDropdown function to modify")
