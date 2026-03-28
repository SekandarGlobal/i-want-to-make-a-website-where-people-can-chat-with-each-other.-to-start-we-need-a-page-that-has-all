// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyBQn69HSj_p3K1FTpPiBZMgHlbj5MnnWg0",
  authDomain: "coinzo-1a2a8.firebaseapp.com",
  databaseURL: "https://coinzo-1a2a8-default-rtdb.firebaseio.com",
  projectId: "coinzo-1a2a8",
  storageBucket: "coinzo-1a2a8.firebasestorage.app",
  messagingSenderId: "655863310444",
  appId: "1:655863310444:web:eecf7db53e38bbbd8f5049",
  measurementId: "G-38422J73NZ"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const rtdb = firebase.database();

// State
let currentUser = null;
let currentUserData = null;
let activeConversationId = null;
let activeConversationData = null;
let messagesUnsub = null;
let conversationsUnsub = null;
let groupSelectedMembers = [];
let rtdbPresenceRef = null;

// ========== PAGE NAVIGATION ==========

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
}

// ========== AUTH ==========

function handleSignIn(e) {
  e.preventDefault();
  const email = document.getElementById('signin-email').value.trim();
  const password = document.getElementById('signin-password').value;
  auth.signInWithEmailAndPassword(email, password)
    .then(cred => {
      currentUser = cred.user;
      checkUserProfile(cred.user);
    })
    .catch(err => alert(err.message));
}

function handleSignUp(e) {
  e.preventDefault();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  auth.createUserWithEmailAndPassword(email, password)
    .then(cred => {
      currentUser = cred.user;
      showPage('page-setup-name');
    })
    .catch(err => alert(err.message));
}

function handleGoogleAuth() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider)
    .then(cred => {
      currentUser = cred.user;
      checkUserProfile(cred.user);
    })
    .catch(err => alert(err.message));
}

function handleSignOut() {
  if (rtdbPresenceRef) {
    rtdbPresenceRef.remove();
    rtdbPresenceRef = null;
  }
  activeConversationId = null;
  activeConversationData = null;
  if (messagesUnsub) messagesUnsub();
  if (conversationsUnsub) conversationsUnsub();
  messagesUnsub = null;
  conversationsUnsub = null;
  currentUser = null;
  currentUserData = null;
  auth.signOut().then(() => {
    showPage('page-landing');
    document.getElementById('signin-form').reset();
    document.getElementById('signup-form').reset();
  });
}

// ========== USER PROFILE ==========

function checkUserProfile(user) {
  db.collection('users').doc(user.uid).get().then(doc => {
    if (doc.exists) {
      currentUserData = doc.data();
      if (!currentUserData.name) {
        showPage('page-setup-name');
      } else if (!currentUserData.username) {
        showPage('page-setup-username');
      } else {
        enterChat();
      }
    } else {
      showPage('page-setup-name');
    }
  });
}

function handleSetupName(e) {
  e.preventDefault();
  const name = document.getElementById('setup-name').value.trim();
  if (!name) return;
  const data = {
    uid: currentUser.uid,
    email: currentUser.email,
    name: name,
    username: null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  db.collection('users').doc(currentUser.uid).set(data, { merge: true }).then(() => {
    currentUserData = { ...currentUserData, ...data };
    showPage('page-setup-username');
  });
}

function handleSetupUsername(e) {
  e.preventDefault();
  const username = document.getElementById('setup-username').value.trim().toLowerCase();
  const errorEl = document.getElementById('username-error');
  errorEl.style.display = 'none';

  if (!username || username.length < 3) {
    errorEl.textContent = 'Username must be at least 3 characters';
    errorEl.style.display = 'block';
    return;
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    errorEl.textContent = 'Only letters, numbers, and underscores allowed';
    errorEl.style.display = 'block';
    return;
  }

  // Check uniqueness
  db.collection('users').where('username', '==', username).get().then(snap => {
    if (!snap.empty) {
      errorEl.textContent = 'Username already taken';
      errorEl.style.display = 'block';
      return;
    }
    db.collection('users').doc(currentUser.uid).update({ username }).then(() => {
      currentUserData.username = username;
      enterChat();
    });
  });
}

// ========== ENTER CHAT ==========

function enterChat() {
  showPage('page-chat');
  setupPresence();
  loadConversations();
}

// ========== PRESENCE (Realtime DB) ==========

function setupPresence() {
  const uid = currentUser.uid;
  const userStatusRef = rtdb.ref('/status/' + uid);
  rtdbPresenceRef = userStatusRef;

  const connectedRef = rtdb.ref('.info/connected');
  connectedRef.on('value', snap => {
    if (snap.val() === true) {
      userStatusRef.onDisconnect().set({ state: 'offline', lastSeen: firebase.database.ServerValue.TIMESTAMP });
      userStatusRef.set({ state: 'online', lastSeen: firebase.database.ServerValue.TIMESTAMP });
    }
  });
}

// ========== SEARCH ==========

let searchTimeout = null;
function handleSearch(query) {
  clearTimeout(searchTimeout);
  const resultsEl = document.getElementById('search-results');
  if (!query || query.length < 1) {
    resultsEl.innerHTML = '';
    resultsEl.classList.remove('has-results');
    return;
  }
  searchTimeout = setTimeout(() => {
    searchUsers(query).then(users => {
      renderSearchResults(users, resultsEl, (user) => {
        startOrOpenConversation(user);
        resultsEl.innerHTML = '';
        resultsEl.classList.remove('has-results');
        document.getElementById('user-search').value = '';
      });
    });
  }, 300);
}

function searchUsers(query) {
  const q = query.toLowerCase();
  return Promise.all([
    db.collection('users').where('username', '>=', q).where('username', '<=', q + '\uf8ff').limit(10).get(),
    db.collection('users').where('email', '==', query).limit(10).get()
  ]).then(([usernameSnap, emailSnap]) => {
    const users = new Map();
    usernameSnap.docs.forEach(doc => {
      if (doc.id !== currentUser.uid) users.set(doc.id, { id: doc.id, ...doc.data() });
    });
    emailSnap.docs.forEach(doc => {
      if (doc.id !== currentUser.uid) users.set(doc.id, { id: doc.id, ...doc.data() });
    });
    return Array.from(users.values());
  });
}

function renderSearchResults(users, container, onClick) {
  container.innerHTML = '';
  if (users.length === 0) {
    container.classList.remove('has-results');
    return;
  }
  container.classList.add('has-results');
  users.forEach(user => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.innerHTML = `
      <div class="search-avatar">${(user.name || user.username || '?')[0].toUpperCase()}</div>
      <div class="search-info">
        <div class="search-name">${user.name || 'Unknown'}</div>
        <div class="search-username">@${user.username || 'unknown'}</div>
      </div>
    `;
    item.onclick = () => onClick(user);
    container.appendChild(item);
  });
}

// ========== CONVERSATIONS ==========

function getConversationId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

function startOrOpenConversation(otherUser) {
  const convId = getConversationId(currentUser.uid, otherUser.id);
  const convRef = db.collection('conversations').doc(convId);

  convRef.get().then(doc => {
    if (!doc.exists) {
      convRef.set({
        type: 'dm',
        participants: [currentUser.uid, otherUser.id].sort(),
        participantDetails: {
          [currentUser.uid]: { name: currentUserData.name, username: currentUserData.username },
          [otherUser.id]: { name: otherUser.name, username: otherUser.username }
        },
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastMessage: null,
        lastMessageTime: null
      }).then(() => openConversation(convId));
    } else {
      openConversation(convId);
    }
  });
}

function loadConversations() {
  if (conversationsUnsub) conversationsUnsub();

  conversationsUnsub = db.collection('conversations')
    .where('participants', 'array-contains', currentUser.uid)
    .orderBy('lastMessageTime', 'desc')
    .onSnapshot(snap => {
      const list = document.getElementById('conversations-list');
      list.innerHTML = '';

      snap.docs.forEach(doc => {
        const conv = { id: doc.id, ...doc.data() };
        const item = document.createElement('div');
        item.className = 'conv-item' + (doc.id === activeConversationId ? ' active' : '');

        let displayName, avatarClass = '';
        if (conv.type === 'group') {
          displayName = conv.groupName;
          avatarClass = 'group';
        } else {
          const otherId = conv.participants.find(p => p !== currentUser.uid);
          const details = conv.participantDetails ? conv.participantDetails[otherId] : null;
          displayName = details ? details.name : 'Unknown';
        }

        const initial = (displayName || '?')[0].toUpperCase();
        const lastMsg = conv.lastMessage || '';
        const time = conv.lastMessageTime ? formatTime(conv.lastMessageTime.toDate()) : '';

        item.innerHTML = `
          <div class="conv-avatar ${avatarClass}">${initial}</div>
          <div class="conv-info">
            <div class="conv-name">${displayName}</div>
            <div class="conv-last-msg">${truncate(lastMsg, 40)}</div>
          </div>
          <div class="conv-time">${time}</div>
        `;
        item.onclick = () => openConversation(doc.id);
        list.appendChild(item);
      });
    });
}

function openConversation(convId) {
  activeConversationId = convId;
  if (messagesUnsub) messagesUnsub();

  db.collection('conversations').doc(convId).get().then(doc => {
    activeConversationData = { id: doc.id, ...doc.data() };
    renderChatHeader();
    loadMessages();
    loadConversations(); // refresh active state
  });
}

// ========== CHAT HEADER ==========

function renderChatHeader() {
  const main = document.getElementById('chat-main');
  const conv = activeConversationData;

  let displayName, avatarClass = '', statusText = '';
  if (conv.type === 'group') {
    displayName = conv.groupName;
    avatarClass = 'group';
    statusText = conv.participants.length + ' members';
  } else {
    const otherId = conv.participants.find(p => p !== currentUser.uid);
    const details = conv.participantDetails ? conv.participantDetails[otherId] : null;
    displayName = details ? details.name : 'Unknown';

    // Check presence
    rtdb.ref('/status/' + otherId).once('value').then(snap => {
      const status = snap.val();
      const statusEl = document.getElementById('chat-status-text');
      if (statusEl) {
        if (status && status.state === 'online') {
          statusEl.textContent = 'Online';
          statusEl.style.color = '#22c55e';
        } else {
          statusEl.textContent = 'Offline';
          statusEl.style.color = '#a3a3a3';
        }
      }
    });
  }

  const initial = (displayName || '?')[0].toUpperCase();

  main.innerHTML = `
    <div class="chat-header">
      <div class="chat-header-avatar ${avatarClass}">${initial}</div>
      <div class="chat-header-info">
        <div class="chat-header-name">${displayName}</div>
        <div class="chat-header-status" id="chat-status-text">${statusText}</div>
      </div>
    </div>
    <div class="messages-area" id="messages-area"></div>
    <div class="message-input-area">
      <input type="text" id="message-input" placeholder="Type a message..." onkeydown="if(event.key==='Enter')sendMessage()">
      <button class="send-btn" onclick="sendMessage()">&#x2192;</button>
    </div>
  `;
}

// ========== MESSAGES ==========

function loadMessages() {
  messagesUnsub = db.collection('conversations').doc(activeConversationId)
    .collection('messages')
    .orderBy('timestamp', 'asc')
    .onSnapshot(snap => {
      const area = document.getElementById('messages-area');
      if (!area) return;
      area.innerHTML = '';

      snap.docs.forEach(doc => {
        renderMessage(doc.id, doc.data(), area);
      });

      area.scrollTop = area.scrollHeight;
    });
}

function renderMessage(msgId, msg, area) {
  const isSent = msg.senderId === currentUser.uid;
  const isGroup = activeConversationData.type === 'group';

  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper ' + (isSent ? 'sent' : 'received');

  let senderNameHtml = '';
  if (isGroup && !isSent && msg.senderName) {
    senderNameHtml = `<div class="message-sender-name">${msg.senderName}</div>`;
  }

  const time = msg.timestamp ? formatTime(msg.timestamp.toDate()) : '';
  const editedHtml = msg.edited ? '<span class="message-edited">(edited)</span>' : '';

  let contentHtml;
  if (msg.deleted) {
    contentHtml = `<div class="message-bubble" style="opacity:0.5;font-style:italic">Message deleted</div>`;
  } else {
    contentHtml = `<div class="message-bubble">${escapeHtml(msg.text)}</div>`;
  }

  let actionsHtml = '';
  if (isSent && !msg.deleted) {
    actionsHtml = `
      <div class="message-actions">
        <button class="msg-action-btn" onclick="startEditMessage('${msgId}', '${escapeAttr(msg.text)}')" title="Edit">&#x270F;</button>
        <button class="msg-action-btn" onclick="deleteMessage('${msgId}')" title="Delete">&#x1F5D1;</button>
      </div>
    `;
  }

  wrapper.innerHTML = `
    ${senderNameHtml}
    <div style="display:flex;align-items:flex-end;gap:6px;">
      ${isSent ? actionsHtml : ''}
      ${contentHtml}
      ${!isSent ? actionsHtml : ''}
    </div>
    <div class="message-meta">
      <span class="message-time">${time}</span>
      ${editedHtml}
    </div>
  `;

  area.appendChild(wrapper);
}

function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text || !activeConversationId) return;

  const msgData = {
    text: text,
    senderId: currentUser.uid,
    senderName: currentUserData.name,
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    edited: false,
    deleted: false
  };

  db.collection('conversations').doc(activeConversationId)
    .collection('messages').add(msgData);

  // Update last message on conversation
  db.collection('conversations').doc(activeConversationId).update({
    lastMessage: text,
    lastMessageTime: firebase.firestore.FieldValue.serverTimestamp()
  });

  input.value = '';
}

// ========== EDIT MESSAGE ==========

function startEditMessage(msgId, currentText) {
  const area = document.getElementById('messages-area');
  const msgWrappers = area.querySelectorAll('.message-wrapper');
  let targetWrapper = null;

  // Find the wrapper containing this message by checking onclick attributes
  msgWrappers.forEach(w => {
    const editBtns = w.querySelectorAll('.msg-action-btn');
    editBtns.forEach(btn => {
      if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(msgId)) {
        targetWrapper = w;
      }
    });
  });

  if (!targetWrapper) return;

  const bubble = targetWrapper.querySelector('.message-bubble');
  const originalHtml = bubble.innerHTML;

  bubble.innerHTML = `
    <input type="text" class="edit-input" id="edit-input-${msgId}" value="${escapeAttr(currentText)}">
    <div class="edit-actions">
      <button class="btn btn-sm btn-primary" onclick="saveEditMessage('${msgId}')">Save</button>
      <button class="btn btn-sm btn-outline" onclick="cancelEdit(this, '${escapeAttr(currentText)}')">Cancel</button>
    </div>
  `;

  const editInput = document.getElementById('edit-input-' + msgId);
  editInput.focus();
  editInput.selectionStart = editInput.value.length;

  editInput.onkeydown = (e) => {
    if (e.key === 'Enter') saveEditMessage(msgId);
    if (e.key === 'Escape') cancelEdit(bubble.querySelector('.btn-outline'), currentText);
  };
}

function saveEditMessage(msgId) {
  const input = document.getElementById('edit-input-' + msgId);
  const newText = input.value.trim();
  if (!newText) return;

  db.collection('conversations').doc(activeConversationId)
    .collection('messages').doc(msgId).update({
      text: newText,
      edited: true
    });

  // Update last message if this was the last one
  db.collection('conversations').doc(activeConversationId).get().then(doc => {
    const conv = doc.data();
    if (conv.lastMessage) {
      db.collection('conversations').doc(activeConversationId).update({
        lastMessage: newText
      });
    }
  });
}

function cancelEdit(btn, originalText) {
  const bubble = btn.closest('.message-bubble');
  bubble.innerHTML = escapeHtml(originalText);
}

// ========== DELETE MESSAGE ==========

function deleteMessage(msgId) {
  if (!confirm('Delete this message?')) return;

  db.collection('conversations').doc(activeConversationId)
    .collection('messages').doc(msgId).update({
      deleted: true,
      text: ''
    });

  db.collection('conversations').doc(activeConversationId).get().then(doc => {
    const conv = doc.data();
    if (conv.lastMessage) {
      db.collection('conversations').doc(activeConversationId).update({
        lastMessage: 'Message deleted'
      });
    }
  });
}

// ========== GROUP CREATION ==========

function showCreateGroup() {
  groupSelectedMembers = [];
  document.getElementById('group-name-input').value = '';
  document.getElementById('group-member-search').value = '';
  document.getElementById('group-search-results').innerHTML = '';
  document.getElementById('group-search-results').classList.remove('has-results');
  renderGroupSelectedMembers();
  document.getElementById('group-modal').style.display = 'flex';
}

function closeGroupModal() {
  document.getElementById('group-modal').style.display = 'none';
}

let groupSearchTimeout = null;
function handleGroupSearch(query) {
  clearTimeout(groupSearchTimeout);
  const resultsEl = document.getElementById('group-search-results');
  if (!query || query.length < 1) {
    resultsEl.innerHTML = '';
    resultsEl.classList.remove('has-results');
    return;
  }
  groupSearchTimeout = setTimeout(() => {
    searchUsers(query).then(users => {
      // Filter out already selected
      const filtered = users.filter(u => !groupSelectedMembers.find(m => m.id === u.id));
      renderSearchResults(filtered, resultsEl, (user) => {
        groupSelectedMembers.push(user);
        renderGroupSelectedMembers();
        resultsEl.innerHTML = '';
        resultsEl.classList.remove('has-results');
        document.getElementById('group-member-search').value = '';
      });
    });
  }, 300);
}

function renderGroupSelectedMembers() {
  const container = document.getElementById('group-selected-members');
  container.innerHTML = '';
  groupSelectedMembers.forEach(user => {
    const chip = document.createElement('div');
    chip.className = 'member-chip';
    chip.innerHTML = `${user.name || user.username} <span class="remove-member" onclick="removeGroupMember('${user.id}')">&times;</span>`;
    container.appendChild(chip);
  });
}

function removeGroupMember(userId) {
  groupSelectedMembers = groupSelectedMembers.filter(m => m.id !== userId);
  renderGroupSelectedMembers();
}

function createGroup() {
  const groupName = document.getElementById('group-name-input').value.trim();
  if (!groupName) {
    alert('Please enter a group name');
    return;
  }
  if (groupSelectedMembers.length < 1) {
    alert('Add at least 1 member');
    return;
  }

  const participantIds = [currentUser.uid, ...groupSelectedMembers.map(m => m.id)];
  const participantDetails = {
    [currentUser.uid]: { name: currentUserData.name, username: currentUserData.username }
  };
  groupSelectedMembers.forEach(m => {
    participantDetails[m.id] = { name: m.name, username: m.username };
  });

  db.collection('conversations').add({
    type: 'group',
    groupName: groupName,
    participants: participantIds,
    participantDetails: participantDetails,
    createdBy: currentUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    lastMessage: null,
    lastMessageTime: null
  }).then(docRef => {
    closeGroupModal();
    openConversation(docRef.id);
  });
}

// ========== UTILITIES ==========

function formatTime(date) {
  const now = new Date();
  const diff = now - date;
  const oneDay = 86400000;

  if (diff < oneDay && now.getDate() === date.getDate()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 2 * oneDay) {
    return 'Yesterday';
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// ========== AUTH STATE LISTENER ==========

auth.onAuthStateChanged(user => {
  if (user) {
    currentUser = user;
    checkUserProfile(user);
  }
});
