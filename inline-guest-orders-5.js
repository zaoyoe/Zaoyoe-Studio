
        (function () {
            try {
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (k && k.indexOf('sb-') === 0 && k.indexOf('-auth-token') > 0) {
                        var raw = localStorage.getItem(k);
                        if (raw && (raw.indexOf('access_token') > 0 || raw.indexOf('currentSession') > 0)) {
                            document.documentElement.classList.add('guest-orders-member-mode');
                            break;
                        }
                    }
                }
            } catch (_) {}
        })();
