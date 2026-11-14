// The cat's chat box. It only appears when the cat's own computer serves this website
// (python3 -m catmind site serve --chat). Everywhere else the mailbox stays closed.
(function () {
  'use strict';
  var panel = document.getElementById('chat-panel');
  if (!panel || !window.fetch || !window.JSON) { return; }
  var catName = 'the cat';
  var maxLength = 300;

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    if (text) { node.textContent = text; }
    return node;
  }

  function say(log, who, text, kind) {
    var item = el('li', kind ? { 'class': kind } : {});
    if (who) { item.appendChild(el('b', {}, who + ': ')); }
    item.appendChild(document.createTextNode(text));
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
  }

  function openChat() {
    var closed = panel.querySelector('.closed');
    if (closed) { closed.hidden = true; }
    var intro = el('p', {}, 'You are on ' + catName + "'s own computer, so you can chat for real. Be kind!");
    var log = el('ol', { 'class': 'chatlog', 'aria-live': 'polite', 'aria-label': 'Chat with ' + catName });
    var form = el('form', { 'class': 'chatform', 'novalidate': '' });
    var nameLabel = el('label', {}, 'Your first name (optional)');
    var nameBox = el('input', { 'type': 'text', 'maxlength': '20', 'autocomplete': 'given-name' });
    nameLabel.appendChild(nameBox);
    var msgLabel = el('label', {}, 'Your message');
    var msgBox = el('input', { 'type': 'text', 'maxlength': String(maxLength), 'required': '', 'autocomplete': 'off' });
    msgLabel.appendChild(msgBox);
    var button = el('button', { 'type': 'submit' }, 'Send');
    form.appendChild(nameLabel);
    form.appendChild(msgLabel);
    form.appendChild(button);
    panel.appendChild(intro);
    panel.appendChild(log);
    panel.appendChild(form);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var text = msgBox.value.trim();
      if (!text) { msgBox.focus(); return; }
      var who = nameBox.value.trim() || 'You';
      say(log, who, text, 'me');
      msgBox.value = '';
      button.disabled = true;
      fetch('api/chat', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, name: nameBox.value.trim() })
      }).then(function (response) { return response.json(); })
        .then(function (answer) {
          if (answer && answer.reply) { say(log, catName, String(answer.reply), ''); }
          else { say(log, '', String((answer && answer.note) || 'No answer right now.'), 'quiet'); }
        })
        .catch(function () { say(log, '', 'The chat stopped answering. Is the cat\'s computer still on?', 'quiet'); })
        .then(function () { button.disabled = false; msgBox.focus(); });
    });
  }

  fetch('api/chat/ping', { method: 'GET', credentials: 'same-origin', cache: 'no-store' })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (info) {
      if (!info || info.chat !== true) { return; }
      if (typeof info.name === 'string' && info.name) { catName = info.name; }
      if (typeof info.max_length === 'number') { maxLength = info.max_length; }
      openChat();
    })
    .catch(function () { /* GitHub Pages, or opened from the disk: the mailbox stays as it is */ });
}());
