#!/usr/bin/env python3
"""Fix language toggle using event delegation to prevent listener loss"""

file_path = '/Volumes/chao/AI/xianyu_profit_calculator/js/framer_home.js'

# Read the file
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

#Replace the problematic event binding code with event delegation
old_code = '''        // Re-render settings dropdown to reflect current language
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

new_code = '''        // Re-render settings dropdown to reflect current language
        if (dropdownType === 'settings' && data.type === 'custom' && data.render) {
          dropdown.innerHTML = data.render();
        }'''

content = content.replace(old_code, new_code)

# Now add event delegation OUTSIDE the showDropdown function, in the initialization
# Find the place where dropdowns are initialized and add delegation there
old_init = '''      // Bind language toggle event (for settings dropdown only)
      if (dropdownType === 'settings') {
        const langToggleBtn = document.getElementById('langToggleDropdown');
        if (langToggleBtn) {
          langToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent dropdown from closing
            if (window.i18n && typeof window.i18n.toggleLanguage === 'function') {
              window.i18n.toggleLanguage();
              console.log('🌐 Language toggle clicked');
            } else {
              console.error('❌ i18n.toggleLanguage not available');
            }
          });

          // Listen for language changes to update button states
          window.addEventListener('languageChanged', (e) => {
            const langZh = document.getElementById('langZhDropdown');
            const langEn = document.getElementById('langEnDropdown');

            if (langZh && langEn) {
              if (e.detail.lang === 'zh') {
                langZh.classList.add('active');
                langEn.classList.remove('active');
              } else {
                langZh.classList.remove('active');
                langEn.classList.add('active');
              }
              console.log(`✅ Dropdown button state updated: ${e.detail.lang}`);
            }
          });
        }
      }'''

new_init = '''      // Bind language toggle event using EVENT DELEGATION (for settings dropdown)
      if (dropdownType === 'settings') {
        // Use event delegation on the dropdown container to avoid listener loss on re-render
        dropdown.addEventListener('click', (e) => {
          const target = e.target;
          
          // Check if clicked element is lang-text span
          if (target.classList.contains('lang-text')) {
            e.stopPropagation();
            const clickedText = target.textContent.trim();
            
            if (clickedText === '中' && window.i18n && window.i18n.getCurrentLanguage() !== 'zh') {
              window.i18n.switchLanguage('zh');
              console.log('🌐 Switched to Chinese');
            } else if (clickedText === 'EN' && window.i18n && window.i18n.getCurrentLanguage() !== 'en') {
              window.i18n.switchLanguage('en');
              console.log('🌐 Switched to English');
            }
          }
        });

        // Listen for language changes to trigger re-render
        window.addEventListener('languageChanged', (e) => {
          // Force re-render on language change if dropdown is visible
          if (dropdown.classList.contains('visible') && data.render) {
            dropdown.innerHTML = data.render();
          }
        });
      }'''

content = content.replace(old_init, new_init)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Successfully implemented event delegation for language toggle")
