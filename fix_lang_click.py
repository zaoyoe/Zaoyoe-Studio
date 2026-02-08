#!/usr/bin/env python3
"""Improve language toggle click area by making spans individually clickable"""

file_path = '/Volumes/chao/AI/xianyu_profit_calculator/js/framer_home.js'

# Read the file
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the showDropdown re-render logic with improved version
old_code = '''        // Re-render settings dropdown to reflect current language
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
        }'''

new_code = '''        // Re-render settings dropdown to reflect current language
        if (dropdownType === 'settings' && data.type === 'custom' && data.render) {
          dropdown.innerHTML = data.render();
          // Re-bind language toggle events to individual spans for better UX
          const langZh = document.getElementById('langZhDropdown');
          const langEn = document.getElementById('langEnDropdown');
          
          if (langZh) {
            langZh.style.cursor = 'pointer';
            langZh.addEventListener('click', (e) => {
              e.stopPropagation();
              if (window.i18n && window.i18n.getCurrentLanguage() !== 'zh') {
                window.i18n.switchLanguage('zh');
                console.log('🌐 Switched to Chinese');
              }
            });
          }
          
          if (langEn) {
            langEn.style.cursor = 'pointer';
            langEn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (window.i18n && window.i18n.getCurrentLanguage() !== 'en') {
                window.i18n.switchLanguage('en');
                console.log('🌐 Switched to English');
              }
            });
          }
        }'''

if old_code in content:
    content = content.replace(old_code, new_code)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("✅ Successfully improved language toggle click areas")
else:
    print("❌ Could not find the target code to modify")
