// Loaded synchronously in <head>. Two jobs that must happen before anything else:
// 1) apply the saved (or system) theme before first paint;
// 2) define the Turnstile callbacks. The Turnstile script is async and may
//    fire before the app module has loaded, so events are buffered here and
//    re-dispatched to whoever subscribes later (js/api.js).
(function () {
    var theme = 'dark';
    try {
        var saved = localStorage.getItem('theme');
        if (saved === 'light' || saved === 'dark') theme = saved;
        else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) theme = 'light';
    } catch (_e) { /* storage blocked */ }
    var root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);

    var buffered = [];
    var listener = null;
    function emit(type, value) {
        if (listener) listener(type, value);
        else buffered.push([type, value]);
    }
    window.onTurnstileSuccess = function (token) { emit('success', token); };
    window.onTurnstileError = function (code) { emit('error', code); return true; };
    window.onTurnstileExpired = function () { emit('expired'); };
    window.__turnstileBridge = {
        subscribe: function (fn) {
            listener = fn;
            var pending = buffered;
            buffered = [];
            pending.forEach(function (e) { fn(e[0], e[1]); });
        },
    };
})();
