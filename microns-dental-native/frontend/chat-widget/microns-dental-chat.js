/**
 * Microns Dental chat widget — embeddable lead qualification for dental practice websites.
 *
 * Embed:
 *   <script
 *     src="https://api.your-practice.com/widget/microns-dental-chat.js"
 *     data-api="https://api.your-practice.com"
 *     data-practice="Microns Dental"
 *     data-color="#2563eb"
 *     defer></script>
 *
 * No dependencies, no build step, no cookies. Everything renders inside a
 * shadow root so the practice's own CSS cannot break it and it cannot break
 * theirs. The session id lives in sessionStorage, so a page reload resumes the
 * conversation but closing the tab does not leave anything behind.
 *
 * Privacy: this file collects only what the visitor types. It sets no tracking
 * cookie, loads no third-party script, and sends nothing anywhere except the
 * practice's own API.
 */
(function () {
  'use strict';

  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName('script');
      return all[all.length - 1];
    })();

  var config = {
    api: (script && script.getAttribute('data-api')) || window.location.origin,
    practice: (script && script.getAttribute('data-practice')) || 'our practice',
    color: (script && script.getAttribute('data-color')) || '#2563eb',
    title: (script && script.getAttribute('data-title')) || 'Chat with us',
    position: (script && script.getAttribute('data-position')) || 'right'
  };

  var STORAGE_KEY = 'microns_dental_chat_session';
  var state = { open: false, sessionId: null, busy: false, done: false };

  try {
    state.sessionId = window.sessionStorage.getItem(STORAGE_KEY);
  } catch (err) {
    // Private browsing with storage disabled: fall back to an in-memory session.
    state.sessionId = null;
  }

  // ------------------------------------------------------------------ //
  // Markup
  // ------------------------------------------------------------------ //
  var host = document.createElement('div');
  host.id = 'microns-dental-chat-widget';
  host.setAttribute('data-microns', 'dental-chat');
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var style = document.createElement('style');
  style.textContent = [
    ':host, * { box-sizing: border-box; }',
    '.wrap {',
    '  position: fixed; bottom: 20px; z-index: 2147483000;',
    "  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;",
    '}',
    '.wrap[data-pos="right"] { right: 20px; }',
    '.wrap[data-pos="left"] { left: 20px; }',
    '.launcher {',
    '  display: flex; align-items: center; gap: 10px;',
    '  border: 0; cursor: pointer; border-radius: 999px;',
    '  padding: 14px 20px; font-size: 15px; font-weight: 600; color: #fff;',
    '  background: var(--brand); box-shadow: 0 8px 24px rgba(15, 23, 42, 0.22);',
    '  transition: transform .15s ease, box-shadow .15s ease;',
    '}',
    '.launcher:hover { transform: translateY(-1px); box-shadow: 0 12px 28px rgba(15,23,42,.28); }',
    '.launcher:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }',
    '.panel {',
    '  display: none; flex-direction: column; overflow: hidden;',
    '  width: min(380px, calc(100vw - 32px)); height: min(560px, calc(100vh - 120px));',
    '  background: #fff; border-radius: 16px; border: 1px solid rgba(15,23,42,.08);',
    '  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);',
    '}',
    '.panel[data-open="true"] { display: flex; }',
    '.head {',
    '  background: var(--brand); color: #fff; padding: 16px 18px;',
    '  display: flex; align-items: center; justify-content: space-between; gap: 12px;',
    '}',
    '.head h2 { margin: 0; font-size: 15px; font-weight: 600; }',
    '.head p { margin: 2px 0 0; font-size: 12px; opacity: .85; }',
    '.close { background: transparent; border: 0; color: #fff; font-size: 22px; line-height: 1; cursor: pointer; padding: 4px 6px; border-radius: 8px; }',
    '.close:hover { background: rgba(255,255,255,.16); }',
    '.log { flex: 1; overflow-y: auto; padding: 16px; background: #f8fafc; display: flex; flex-direction: column; gap: 10px; }',
    '.msg { max-width: 82%; padding: 10px 13px; border-radius: 14px; font-size: 14px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }',
    '.msg.bot { background: #fff; color: #0f172a; border: 1px solid rgba(15,23,42,.08); border-bottom-left-radius: 4px; align-self: flex-start; }',
    '.msg.user { background: var(--brand); color: #fff; border-bottom-right-radius: 4px; align-self: flex-end; }',
    '.msg.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; align-self: flex-start; }',
    '.chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 12px; background: #f8fafc; }',
    '.chip { background: #fff; border: 1px solid var(--brand); color: var(--brand); border-radius: 999px; padding: 7px 14px; font-size: 13px; cursor: pointer; font-weight: 500; }',
    '.chip:hover { background: var(--brand); color: #fff; }',
    '.chip:disabled { opacity: .5; cursor: default; }',
    '.form { display: flex; gap: 8px; padding: 12px; border-top: 1px solid rgba(15,23,42,.08); background: #fff; }',
    '.form input { flex: 1; border: 1px solid rgba(15,23,42,.16); border-radius: 10px; padding: 11px 12px; font-size: 14px; font-family: inherit; }',
    '.form input:focus { outline: 2px solid var(--brand); outline-offset: -1px; }',
    '.form button { background: var(--brand); color: #fff; border: 0; border-radius: 10px; padding: 0 16px; font-size: 14px; font-weight: 600; cursor: pointer; }',
    '.form button:disabled { opacity: .55; cursor: default; }',
    '.typing { display: flex; gap: 4px; align-self: flex-start; padding: 12px 14px; background: #fff; border: 1px solid rgba(15,23,42,.08); border-radius: 14px; }',
    '.typing span { width: 6px; height: 6px; border-radius: 50%; background: #94a3b8; animation: blink 1.2s infinite; }',
    '.typing span:nth-child(2) { animation-delay: .2s; }',
    '.typing span:nth-child(3) { animation-delay: .4s; }',
    '@keyframes blink { 0%, 80%, 100% { opacity: .3 } 40% { opacity: 1 } }',
    '.legal { font-size: 11px; color: #64748b; text-align: center; padding: 0 16px 10px; background: #fff; }',
    '@media (prefers-reduced-motion: reduce) { .launcher, .typing span { transition: none; animation: none; } }',
    '@media (max-width: 460px) { .wrap { bottom: 12px; right: 12px; left: 12px; } .panel { width: 100%; height: min(70vh, 520px); } }'
  ].join('\n');

  var wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.setAttribute('data-pos', config.position === 'left' ? 'left' : 'right');
  wrap.style.setProperty('--brand', config.color);

  wrap.innerHTML = [
    '<div class="panel" role="dialog" aria-modal="false" aria-label="Chat with ' + esc(config.practice) + '">',
    '  <div class="head">',
    '    <div><h2>' + esc(config.practice) + '</h2><p>Typically replies instantly</p></div>',
    '    <button class="close" type="button" aria-label="Close chat">&times;</button>',
    '  </div>',
    '  <div class="log" role="log" aria-live="polite"></div>',
    '  <div class="chips"></div>',
    '  <form class="form">',
    '    <input type="text" name="message" autocomplete="off" placeholder="Type your answer…" aria-label="Your message" />',
    '    <button type="submit">Send</button>',
    '  </form>',
    '  <div class="legal">If this is a dental emergency, please call the office directly.</div>',
    '</div>',
    '<button class="launcher" type="button" aria-expanded="false">',
    '  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">',
    '    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-4.6A8.4 8.4 0 0 1 4 11.5 8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z"/>',
    '  </svg>',
    '  <span>' + esc(config.title) + '</span>',
    '</button>'
  ].join('\n');

  root.appendChild(style);
  root.appendChild(wrap);

  var panel = wrap.querySelector('.panel');
  var launcher = wrap.querySelector('.launcher');
  var closeBtn = wrap.querySelector('.close');
  var log = wrap.querySelector('.log');
  var chips = wrap.querySelector('.chips');
  var form = wrap.querySelector('.form');
  var input = form.querySelector('input');
  var sendBtn = form.querySelector('button');

  function mount() {
    (document.body || document.documentElement).appendChild(host);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  // ------------------------------------------------------------------ //
  // Rendering
  // ------------------------------------------------------------------ //
  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function addMessage(text, who) {
    var node = document.createElement('div');
    node.className = 'msg ' + (who || 'bot');
    node.textContent = text; // textContent, never innerHTML — the server reply is data.
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;
    return node;
  }

  function showTyping() {
    var node = document.createElement('div');
    node.className = 'typing';
    node.innerHTML = '<span></span><span></span><span></span>';
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;
    return node;
  }

  function renderChips(options) {
    chips.innerHTML = '';
    if (!options || !options.length || state.done) return;
    options.forEach(function (option) {
      var button = document.createElement('button');
      button.className = 'chip';
      button.type = 'button';
      button.textContent = option;
      button.addEventListener('click', function () {
        send(option);
      });
      chips.appendChild(button);
    });
  }

  function setBusy(busy) {
    state.busy = busy;
    sendBtn.disabled = busy || state.done;
    input.disabled = busy || state.done;
    Array.prototype.forEach.call(chips.querySelectorAll('.chip'), function (chip) {
      chip.disabled = busy;
    });
  }

  // ------------------------------------------------------------------ //
  // Transport
  // ------------------------------------------------------------------ //
  function post(message) {
    var body = { message: message, source: 'website_chat' };
    if (state.sessionId) body.session_id = state.sessionId;

    return fetch(config.api.replace(/\/+$/, '') + '/leads/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (response) {
      if (response.status === 429) {
        throw new Error('rate_limited');
      }
      if (!response.ok) {
        throw new Error('http_' + response.status);
      }
      return response.json();
    });
  }

  /**
   * @param {string} message
   * @param {{silent?: boolean}} [options] silent skips echoing the message into
   *        the log — used for the "__init__" turn that fetches the greeting.
   */
  function send(message, options) {
    if (state.busy || state.done) return;
    message = String(message || '').trim();
    if (!message) return;

    if (!(options && options.silent)) addMessage(message, 'user');
    input.value = '';
    renderChips([]);
    setBusy(true);
    var typing = showTyping();

    post(message)
      .then(function (data) {
        typing.remove();
        if (data.session_id) {
          state.sessionId = data.session_id;
          try {
            window.sessionStorage.setItem(STORAGE_KEY, data.session_id);
          } catch (err) {
            /* storage disabled — session stays in memory */
          }
        }
        addMessage(data.reply, 'bot');
        if (data.complete) {
          state.done = true;
          chips.innerHTML = '';
          if (data.booking_url) {
            var link = document.createElement('button');
            link.className = 'chip';
            link.type = 'button';
            link.textContent = 'Open booking page';
            link.addEventListener('click', function () {
              window.open(data.booking_url, '_blank', 'noopener');
            });
            chips.appendChild(link);
          }
        } else {
          renderChips(data.options);
        }
        setBusy(false);
        if (!state.done) input.focus();
      })
      .catch(function (error) {
        typing.remove();
        addMessage(
          error && error.message === 'rate_limited'
            ? 'Sorry — too many messages at once. Give it a moment and try again.'
            : "Sorry, I couldn't reach the practice just now. Please try again, or call us directly.",
          'error'
        );
        setBusy(false);
      });
  }

  // ------------------------------------------------------------------ //
  // Interaction
  // ------------------------------------------------------------------ //
  function open() {
    state.open = true;
    panel.setAttribute('data-open', 'true');
    launcher.setAttribute('aria-expanded', 'true');
    launcher.style.display = 'none';
    if (!log.children.length) {
      // The server writes the opening line and the first question, so the two
      // channels (chat and SMS) always ask the same things in the same order.
      send('__init__', { silent: true });
    }
    input.focus();
  }

  function close() {
    state.open = false;
    panel.removeAttribute('data-open');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.style.display = '';
    launcher.focus();
  }

  launcher.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    send(input.value);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && state.open) close();
  });

  // Small public API so a practice's own CTA can open the chat:
  //   window.MicronsDentalChat.open()
  window.MicronsDentalChat = {
    open: open,
    close: close,
    reset: function () {
      try {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch (err) {
        /* ignore */
      }
      state.sessionId = null;
      state.done = false;
      log.innerHTML = '';
      chips.innerHTML = '';
      setBusy(false);
    }
  };
})();
