import { decryptMessage, encryptMessage } from '/scripts/crypto-utils.js';

// ---------- Тосты вместо alert() ----------
function showToast(message, type = 'success') {
    const stack = document.getElementById('fp-toast-stack');
    if (!stack) { window.alert(message); return; }
    const toast = document.createElement('div');
    toast.className = `fp-toast fp-toast-${type}`;
    toast.textContent = message;
    stack.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fp-toast-leaving');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, 3000);
}

// ---------- Модалка подтверждения вместо confirm() ----------
function confirmDialog({ title = 'Подтвердите действие', text = '', confirmLabel = 'Да', cancelLabel = 'Отмена' }) {
    return new Promise(resolve => {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <h3></h3>
                <p></p>
                <div class="modal-buttons">
                    <button class="cancel-btn"></button>
                    <button class="save-btn"></button>
                </div>
            </div>
        `;
        modal.querySelector('h3').textContent = title;
        modal.querySelector('p').textContent = text;
        modal.querySelector('.cancel-btn').textContent = cancelLabel;
        modal.querySelector('.save-btn').textContent = confirmLabel;
        const close = (result) => { modal.remove(); resolve(result); };
        modal.querySelector('.cancel-btn').addEventListener('click', () => close(false));
        modal.querySelector('.save-btn').addEventListener('click', () => close(true));
        modal.addEventListener('click', (e) => { if (e.target === modal) close(false); });
        document.body.appendChild(modal);
    });
}

function isEncrypted(message) {
    if (!message) return false;
    try {
        atob(message);
        return message.length > 20;
    } catch {
        return false;
    }
}

async function decryptMessageIfNeeded(msg, chatId) {
    // If no message text, return as-is
    if (!msg.messageText) {
        return { ...msg, decryptedText: '' };
    }
    
    // Check if message is encrypted
    if (isEncrypted(msg.messageText)) {
        try {
            const decrypted = await decryptMessage(chatId, msg.messageText);
            return { ...msg, decryptedText: decrypted };
        } catch (err) {
            return { ...msg, decryptedText: 'Ошибка' };
        }
    }
    
    // Plain text message (not encrypted)
    return { ...msg, decryptedText: msg.messageText };
}

async function decryptMessages(messages, chatId) {
    const decrypted = await Promise.all(
        messages.map(msg => decryptMessageIfNeeded(msg, chatId))
    );
    return decrypted;
}

addEventListener("focus", (event) => {
    isWindowFocused = document.hasFocus();

    if (currentChatId !== null) {
        fetch(`/api/users/chats/read/${currentChatId}`, { 
            method: 'POST', 
            credentials: 'same-origin' 
        })
    const card = document.querySelector(`[data-chat-id="${currentChatId}"]`);
    if (card && card.classList.contains('chat-card-unread')) {
        card.classList.remove('chat-card-unread')
        const unreadBadge = card.querySelector('.chat-unread-badge') || card.lastElementChild
        if (unreadBadge) unreadBadge.remove()
    }
	}
});

document.addEventListener('paste', async (e) => {
    // Only handle paste if we're in a chat and input is focused
    if (!currentChatId) return;
    if (document.activeElement !== msgInput) return;
    
    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;
    
    const items = clipboardData.items;
    let hasImage = false;
    
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // Check if it's an image
        if (item.type.indexOf('image') !== -1) {
            const file = item.getAsFile();
            if (file) {
                pendingFiles.push(file);
                hasImage = true;
            }
        }
    }
    
    if (hasImage) {
        e.preventDefault(); // Prevent default paste behavior
        updateFilePreview();
    }
});

    
    // State
    let currentPollController = null;
    let isWindowFocused = true;
    let currentChatId = null;
    let currentOtherUserId = null;
    let currentChatUsername = '';
    let currentChatAvatar = '';
    let allMessages = [];
    let pendingFiles = [];
    let editingMessageId = null;
    let replyToMessageId = null;
    let currentUserId = localStorage.getItem('userId');
    
    // Helper dom
    const chatsListDiv = document.getElementById('chats-list');
    const favDiv = document.getElementById('favoutie-chats-list');
    const favContDiv = document.getElementById('favoutie-chats-container');
    const chatPanel = document.getElementById('active-chat-panel');
    const messagesContainer = document.getElementById('chat-messages-container');
    const msgInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-message-btn');
    const clipBtn = document.getElementById('clip-btn');
    const attachMenu = document.getElementById('attach-menu');
    const filePreviewRow = document.getElementById('file-preview-row');
    const chatMobileBack = document.getElementById('chat-mobile-back');
    const scrollToBottomBtn = document.getElementById('scroll-to-bottom-btn');
    const scrollToBottomBadge = document.getElementById('scroll-to-bottom-badge');
    let unseenWhileScrolledUp = 0;

function isNearBottom(threshold = 120) {
    if (!messagesContainer) return true;
    return messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < threshold;
}

function hideScrollToBottomButton() {
    unseenWhileScrolledUp = 0;
    if (!scrollToBottomBtn) return;
    scrollToBottomBtn.style.display = 'none';
    if (scrollToBottomBadge) scrollToBottomBadge.style.display = 'none';
}

function showScrollToBottomButton(bump = 0) {
    if (!scrollToBottomBtn) return;
    if (bump > 0) unseenWhileScrolledUp += bump;
    scrollToBottomBtn.style.display = 'flex';
    if (scrollToBottomBadge) {
        if (unseenWhileScrolledUp > 0) {
            scrollToBottomBadge.textContent = unseenWhileScrolledUp > 9 ? '9+' : String(unseenWhileScrolledUp);
            scrollToBottomBadge.style.display = 'flex';
        } else {
            scrollToBottomBadge.style.display = 'none';
        }
    }
}

scrollToBottomBtn?.addEventListener('click', () => {
    scrollToBottom();
    hideScrollToBottomButton();
});

function setMobileChatOpen(isOpen) {
    document.body.classList.toggle('mobile-chat-open', Boolean(isOpen));
}

async function initChatPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get('chatId');
    const userId = urlParams.get('id');
    const currentUserId = localStorage.getItem('userId');
    
    if (chatId) {
        // Get all chats for the current user, find the one with this chatId
        try {
            const res = await fetch(`/api/users/chats/${currentUserId}`, { credentials: 'same-origin' });
            const data = await res.json();
            const allChats = [...(data.favouriteChats || []), ...(data.userChats || [])];
            const chat = allChats.find(c => c.chatId == chatId);
            
            if (chat) {
                openChat(chatId, chat.username, chat.profilePicture, chat.userId, chat.status, { skipHistory: true, partner: chat });
            } else {
                console.error('Chat not found');
            }
        } catch (err) {
            console.error('Error loading chat:', err);
        }
    } else if (userId) {
        try {
            const response = await fetch('/api/chats/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: userId })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Не удалось создать диалог');
            if (data.chatId) {
                const url = new URL(window.location);
                url.searchParams.delete('id');
                url.searchParams.set('chatId', data.chatId);
                history.replaceState({ chatId: data.chatId }, '', url);
                const chat = data.chat;
                if (chat) {
                    openChat(chat.chatId, chat.username, chat.profilePicture, chat.userId, chat.status, { skipHistory: true, partner: chat });
                } else {
                    await loadChats();
                }
            }
        } catch (err) {
            console.error('Error creating chat:', err);
        }
    }
}

window.addEventListener('popstate', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get('chatId');
    const currentUserId = localStorage.getItem('userId');
    
    if (chatId) {
        // Get all chats for the current user and find the one with this chatId
        fetch(`/api/users/chats/${currentUserId}`, { credentials: 'same-origin' })
            .then(r => r.json())
            .then(data => {
                const allChats = [...(data.favouriteChats || []), ...(data.userChats || [])];
                const chat = allChats.find(c => c.chatId == chatId);
                
                if (chat) {
                    openChat(chatId, chat.username, chat.profilePicture, chat.userId, chat.status, { skipHistory: true, partner: chat });
                } else {
                    console.error('Chat not found');
                    chatFeedmainClose({ skipHistory: true });
                }
            })
            .catch(err => {
                console.error('Error loading chat on popstate:', err);
                chatFeedmainClose({ skipHistory: true });
            });
    } else {
        // Close the chat panel without creating a new browser-history entry.
        chatFeedmainClose({ skipHistory: true });
    }
});

msgInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
    
    // Arrow up to edit last message
    if (e.key === 'ArrowUp' && msgInput.value === '' && !editingMessageId) {
        e.preventDefault();
        // Find the last message sent by the current user
        const lastMyMessage = [...allMessages]
            .reverse()
            .find(msg => msg.userId == currentUserId);
        
        if (lastMyMessage) {
            startEditing(lastMyMessage.id);
        }
    }
});

// Автоматический рост поля ввода под содержимое (до max-height из CSS)
function autoGrowMessageInput() {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 140) + 'px';
}
msgInput.addEventListener('input', autoGrowMessageInput);

// Escape: закрыть меню вложений, либо отменить редактирование/ответ
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (attachMenu.classList.contains('show')) {
        attachMenu.classList.remove('show');
        return;
    }
    if (editingMessageId) {
        editingMessageId = null;
        msgInput.value = '';
        autoGrowMessageInput();
        sendBtn.innerText = 'Отправить!';
        document.getElementById('edit-indicator').style.display = 'none';
        return;
    }
    if (replyToMessageId) {
        replyToMessageId = null;
        const replyIndicator = document.getElementById('reply-indicator-floating');
        if (replyIndicator) replyIndicator.remove();
    }
});

// Закрыть меню вложений по клику вне его
document.addEventListener('click', (e) => {
    if (!attachMenu.classList.contains('show')) return;
    if (e.target === clipBtn || clipBtn.contains(e.target)) return;
    if (attachMenu.contains(e.target)) return;
    attachMenu.classList.remove('show');
});

// Auto-focus the message input when user starts typing anywhere on the page
document.addEventListener('keydown', (e) => {
    // Ignore if user is typing in another input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }
    
    // Ignore if chat is not open
    if (!currentChatId) return;
    
    // Ignore if it's a shortcut key (Ctrl, Alt, etc.)
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    
    // Ignore if it's just a modifier key
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
    
    // Focus the message input
    msgInput.focus();
});

// Also handle paste anywhere on the page
document.addEventListener('paste', (e) => {
    // Ignore if user is pasting in another input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }
    
    // Ignore if chat is not open
    if (!currentChatId) return;
    
    // Focus the message input
    msgInput.focus();
    
    // Let the paste event handler (from earlier) handle the actual paste
    // Or handle the paste here directly
    const items = e.clipboardData?.items;
    if (!items) return;
    
    let hasImage = false;
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
                pendingFiles.push(file);
                hasImage = true;
            }
        }
    }
    
    if (hasImage) {
        e.preventDefault();
        updateFilePreview();
    }
});


function formatMessageTime(timestamp) {
    if (!timestamp) return '';
    
    // Parse the timestamp - if it's a string from the server, it might be in UTC
    let date;
    if (typeof timestamp === 'string') {
        // If it's a SQLite timestamp string (YYYY-MM-DD HH:MM:SS), parse it as UTC
        date = new Date(timestamp + ' UTC');
        // If that fails, try parsing as ISO
        if (isNaN(date.getTime())) {
            date = new Date(timestamp);
        }
    } else {
        // If it's a number, treat as Unix timestamp (seconds) from server
        date = new Date(timestamp * 1000);
    }
    
    // If date is invalid, try one more time
    if (isNaN(date.getTime())) {
        date = new Date(timestamp);
    }
    
    const now = new Date();
    
    // Get today at midnight in LOCAL timezone
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    // If today - show hours:minutes
    if (date >= today) {
        return date.toLocaleTimeString('ru-RU', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false
        });
    }
    
    // If yesterday - show "Вчера в ЧЧ:ММ"
    if (date >= yesterday && date < today) {
        const time = date.toLocaleTimeString('ru-RU', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false
        });
        return `Вчера в ${time}`;
    }
    
    // If within last week - show day name
    if (date >= weekAgo) {
        const days = ['Вск', 'Пнд', 'Втр', 'Срд', 'Чтв', 'Птн', 'Сбт'];
        return days[date.getDay()];
    }
    
    // Everything else - show date
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 
                    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    return `${date.getDate()} ${months[date.getMonth()]}`;
}

// Load chats on page
async function loadChats() {
    const uid = localStorage.getItem('userId');
    if (!uid) return;
    const res = await fetch(`/api/users/chats/${uid}`, { credentials: 'same-origin' });
    const data = await res.json();
    
    // Decrypt last messages for preview
    const favs = await decryptChatPreviews(data.favouriteChats || []);
    const regular = await decryptChatPreviews(data.userChats || []);
    
    renderChatList(favs, regular);
}

async function decryptChatPreviews(chats) {
    const decrypted = await Promise.all(
        chats.map(async (chat) => {
            if (chat.lastMessage && isEncrypted(chat.lastMessage)) {
                try {
                    const decrypted = await decryptMessage(chat.chatId, chat.lastMessage);
                    return { 
                        ...chat, 
                        lastMessageDecrypted: decrypted,
                        // Keep the sender ID
                    };
                } catch {
                    return { ...chat, lastMessageDecrypted: '' };
                }
            }
            return { ...chat, lastMessageDecrypted: chat.lastMessage };
        })
    );
    return decrypted;
}
    
function renderChatList(favs, regular) {
        favDiv.innerHTML = '';
        chatsListDiv.innerHTML = '';
        if (favs.length) {
            favDiv.style.display = 'block';
            favs.forEach(chat => appendChatCard(favDiv, chat));
        } else {//favDiv.style.display = 'none';
		favContDiv.style.display='none';
		}
        regular.forEach(chat => appendChatCard(chatsListDiv, chat));
}

function setupScrollListener() {
    if (!messagesContainer) return;
    // Remove any existing listener to avoid duplicates
    messagesContainer.removeEventListener('scroll', handleScroll);
    messagesContainer.addEventListener('scroll', handleScroll);
}

function handleScroll() {
    // Load more when within 100px of the top
    if (messagesContainer.scrollTop < 200 && currentChatId) {
        loadMessages(currentChatId, true);
    }
    if (isNearBottom()) {
        hideScrollToBottomButton();
    }
}
    
function appendChatCard(container, chat) {
    const card = document.createElement('div');
    card.className = 'chat-card';
    card.dataset.chatId = chat.chatId;
    card.dataset.userId = chat.userId || (chat.type === 'direct' ? chat.username : null);
    card.innerHTML = `
        <div class="chat-card-content">
            <img class="chat-card-avatar frutiger-aero-border" src="${chat.profilePicture || '/default-avatar.jpg'}">
            <div class="chat-card-info">
                <div class="chat-card-name-row">
                    <div class="chat-card-name${chat.displayRole ? ` role-name role-name-${chat.displayRole}` : ''}">${escapeHtml(chat.username)}</div>
                    ${window.FortPortRoles?.badgeHtml(chat, { compact: true }) || ''}
                </div>
                <div class="chat-card-lastmsg">
                    ${chat.lastMessageSenderId == currentUserId ? 'Вы: ' : ''}
                    ${escapeHtml(chat.lastMessageDecrypted || chat.lastMessage || 'Нет сообщений')}
                </div>
                <div class="chat-card-time">${chat.lastMessageTime ? formatMessageTime(chat.lastMessageTime) : ''}</div>
            </div>
        </div>
        <button class="more-actions-btn" data-chatid="${chat.chatId}">⋮</button>
    `;
	if (chat.unreadCount > 0) {
		card.classList.add('chat-card-unread');
		const unreadBadge = document.createElement('div');
		unreadBadge.classList.add('chat-card-unread-badge');
		unreadBadge.textContent = chat.unreadCount;
		card.appendChild(unreadBadge);
		}
        container.appendChild(card);
        // open chat on card click (except menu button)
        card.addEventListener('click', (e) => {
            if (e.target.classList.contains('more-actions-btn') || e.target.closest('.more-actions-btn')) return;
            if (e.target.closest('.chat-card-menu')) return;
            openChat(chat.chatId, chat.username, chat.profilePicture, chat.userId, chat.status, { partner: chat });
        });
        const menuBtn = card.querySelector('.more-actions-btn');
menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    
    // Remove any existing menu
    const existingMenu = document.getElementById('chat-card-menu-overlay');
    if (existingMenu) existingMenu.remove();
    
    // Close all other open menus
    document.querySelectorAll('.chat-card-menu.show').forEach(m => m.remove());
    
    // Get card position
    const rect = card.getBoundingClientRect();
    
    // Create menu at document level
    const menu = document.createElement('div');
    menu.id = 'chat-card-menu-overlay';
    menu.className = 'chat-card-menu';
    menu.dataset.chatId = chat.chatId;
    menu.style.position = 'fixed';
    menu.style.left = (rect.right - 180) + 'px';
    menu.style.top = (rect.top + 30) + 'px';
    menu.style.background = 'white';
    menu.style.border = '2px solid #8FDADB';
    menu.style.borderRadius = '12px';
    menu.style.boxShadow = '0 4px 12px #0000006b';
    menu.style.zIndex = '9999';
    menu.style.padding = '8px 0';
    menu.style.minWidth = '160px';
    
    const items = [
        { action: 'favourite', label: 'Закрепить' },
        { action: 'readall', label: 'Прочитать всё' },
        { action: 'delete', label: 'Убрать переписку' }
    ];
    
    items.forEach(itemData => {
        const item = document.createElement('div');
        item.className = 'chat-card-menu-item';
        item.dataset.action = itemData.action;
        item.textContent = itemData.label;
        item.style.padding = '10px 20px';
        item.style.cursor = 'pointer';
        item.style.transition = 'background 0.15s';
        item.style.fontSize = '14px';
        item.onmouseenter = () => item.style.background = '#f0f0f0';
        item.onmouseleave = () => item.style.background = 'transparent';
        
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            const action = item.dataset.action;
            const chatId = card.dataset.chatId;
            
            if (action === 'favourite') {
                await fetch(`/api/users/chats/favourite/${chatId}`, { method: 'POST', credentials: 'same-origin' });
                loadChats();
                favContDiv.style.display = 'block';
            } else if (action === 'readall') {
                await fetch(`/api/chats/messages/read/${chatId}`, { method: 'POST', credentials: 'same-origin' });
            } else if (action === 'delete') {
                if (confirm('Убрать переписку только из вашего списка? У другого участника сообщения сохранятся.')) {
                    await fetch(`/api/users/chats/${chatId}`, { method: 'DELETE', credentials: 'same-origin' });
                    if (currentChatId === chatId) {
                        chatFeedmainClose();
                    }
                    loadChats();
                }
            }
            menu.remove();
        });
        
        menu.appendChild(item);
    });
    
    document.body.appendChild(menu);
    menu.classList.add('show');
    
    // Close menu when clicking outside
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target) && e.target !== menuBtn) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 10);
});
}

document.addEventListener('click', (e) => {
    // Close all chat-card-menus if click is outside any menu
    const menus = document.querySelectorAll('.chat-card-menu.show');
    menus.forEach(menu => {
        // Check if click is inside this menu or its trigger button
        const card = menu.closest('.chat-card');
        if (!card) return;
        const menuBtn = card.querySelector('.more-actions-btn');
        
        if (!menu.contains(e.target) && !menuBtn?.contains(e.target)) {
            menu.classList.remove('show');
        }
    });
});
    
async function openChat(chatId, username, avatar, otherUserId, status, options = {}) {

    hasMoreMessages = true;
    oldestMessageId = null;
    isLoadingMore = false;

    const normalizedChatId = String(chatId);
    const url = new URL(window.location);
    const urlChatId = url.searchParams.get('chatId');
    url.searchParams.delete('id');
    url.searchParams.set('chatId', normalizedChatId);

    if (!options.skipHistory && urlChatId !== normalizedChatId) {
        window.history.pushState({ chatId: normalizedChatId }, '', url);
    } else if (urlChatId !== normalizedChatId || options.replaceHistory) {
        window.history.replaceState({ chatId: normalizedChatId }, '', url);
    }
	if (currentPollController) {
        currentPollController.abort();
        currentPollController = null;
    }
    const chatFeedmain = document.getElementById('chat-feedmain');
    chatFeedmain.style.display = 'flex';
    setMobileChatOpen(true);
    currentChatId = chatId;
    currentOtherUserId = otherUserId;
    currentChatUsername = username;
    currentChatAvatar = avatar;
    const chatPartnerName = document.getElementById('chat-partner-name');
    chatPartnerName.textContent = username;
    window.FortPortRoles?.applyName(chatPartnerName, options.partner || { id: otherUserId });
    const partnerNameLine = chatPartnerName.closest('.chat-partner-name-line') || chatPartnerName.parentElement;
    partnerNameLine?.querySelector('.chat-partner-role-badge')?.remove();
    const partnerBadge = window.FortPortRoles?.createBadge(options.partner || { id: otherUserId }, { compact: true, button: false });
    if (partnerBadge && partnerNameLine) {
        partnerBadge.classList.add('chat-partner-role-badge');
        partnerNameLine.appendChild(partnerBadge);
    }
    document.getElementById('chat-partner-avatar').src = avatar || '/default-avatar.jpg';
    const myAvatar = localStorage.getItem('userAvatar') || '/default-avatar.jpg';
    document.getElementById('current-user-chat-avatar').src = myAvatar;
    document.getElementById('chat-partner-status').innerText = status;
    chatPanel.style.display = 'flex';
    
    // Only mark as read if window is focused
    if (isWindowFocused) {
        const response = await fetch(`/api/users/chats/read/${chatId}`, {method: 'POST', credentials: 'same-origin' });
        const card = document.querySelector(`[data-chat-id="${chatId}"]`);
        if (card && card.classList.contains('chat-card-unread')) {
            card.classList.remove('chat-card-unread');
            const badge = card.querySelector('.chat-card-unread-badge');
            if (badge) badge.remove();
        }
    }

    hideScrollToBottomButton();
    await loadMessages(chatId);
    waitForMessages(chatId);
    setupScrollListener();
}
    
let isLoadingMore = false;
let hasMoreMessages = true;
let oldestMessageId = null;

async function loadMessages(chatId, loadMore = false) {
    try {
        if (isLoadingMore) return;
        isLoadingMore = true;
        
        let url;
        if (loadMore) {
            // Get the oldest message ID from the current DOM
            const firstMessage = messagesContainer.querySelector('.message-wrapper');
            if (!firstMessage) {
                hasMoreMessages = false;
                isLoadingMore = false;
                return;
            }
            const oldestId = firstMessage.dataset.msgId;
            url = `/api/chats/messages/${chatId}/before/${oldestId}`;
        } else {
            url = `/api/chats/messages/${chatId}`;
        }
        
        const res = await fetch(url, { 
            credentials: 'same-origin' 
        });
        const data = await res.json();
        
        const rawMessages = data.messages || [];
        const decryptedMessages = await decryptMessages(rawMessages, chatId);
        
       if (loadMore) {
    // Get the height of the content before adding new messages
    const oldScrollHeight = messagesContainer.scrollHeight;
    const oldScrollTop = messagesContainer.scrollTop;
    
    // Prepend older messages
    allMessages = [...decryptedMessages, ...allMessages];
    renderMessages();
    
    // Calculate the height of the new messages that were added
    const newScrollHeight = messagesContainer.scrollHeight;
    const heightAdded = newScrollHeight - oldScrollHeight;
    
    // Restore scroll position by adding the height of new messages
    messagesContainer.scrollTop = oldScrollTop + heightAdded;
} else {
            allMessages = decryptedMessages;
            renderMessages();
            if (isWindowFocused) {
                scrollToBottom();
            }
        }
        
        // If we got less than 60 messages, there are no more
        if (rawMessages.length < 60) {
            hasMoreMessages = false;
        } else {
            hasMoreMessages = true;
        }
        
    } catch (err) {
        console.error('Error loading messages:', err);
        if (!loadMore) {
            messagesContainer.innerHTML = '<div class="error-message">Не удалось загрузить сообщения</div>';
        }
    } finally {
        isLoadingMore = false;
    }
}
    
async function renderMessages() {
    messagesContainer.innerHTML = '';
    let lastDate = null;
    for (const msg of allMessages) {
        const msgDate = new Date(msg.createdAt.replace(' ', 'T') + 'Z');
        const dateKey = `${msgDate.getDate()}-${msgDate.getMonth()}-${msgDate.getFullYear()}`;
        if (lastDate !== dateKey) {
            const sep = document.createElement('div');
            sep.className = 'day-separator';
            sep.innerHTML = `<span>${msgDate.toLocaleDateString('ru-RU', {day:'numeric', month:'long'})}</span>`;
            messagesContainer.appendChild(sep);
            lastDate = dateKey;
        }
        const isMine = msg.userId == currentUserId;
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${isMine ? 'mine' : 'theirs'}`;
        
        // Add unread class if this is our message and it's not read
        if (isMine && !msg.isRead) {
            wrapper.classList.add('unread');
        }
        
        wrapper.dataset.msgId = msg.id;
        
        // Bubble
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        
        // reply preview if referenceId
        if (msg.referenceId) {
    const replyMsg = allMessages.find(m => m.id == msg.referenceId);
    if (replyMsg) {
        const replyDiv = document.createElement('div');
        replyDiv.className = 'reply-preview-block';
        
        // Get the sender name
        const isReplyMine = replyMsg.userId == currentUserId;
        const replySenderName = isReplyMine ? 'Вы' : currentChatUsername;
        
        const replyText = replyMsg.decryptedText || 'Медиа';
        replyDiv.innerHTML = `
            <div class="reply-preview-name">${replySenderName}</div>
            <div class="reply-text-preview">${escapeHtml(replyText.substring(0, 60))}${replyText.length > 60 ? '...' : ''}</div>
        `;
        bubble.appendChild(replyDiv);
    }
}
        
        // text
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        textDiv.innerText = msg.decryptedText || '';
        bubble.appendChild(textDiv);
        
        // attachments grid
        if (msg.filePaths && msg.filePaths.length) {
            const gridDiv = document.createElement('div');
            gridDiv.className = 'message-images-grid';
            const mediaItems = msg.filePaths.map((path, index) => ({
                path,
                type: msg.fileTypes[index] || 'image',
                mediaId: msg.fileIds?.[index] || null
            }));

            for (let i = 0; i < mediaItems.length; i++) {
                const mediaItem = mediaItems[i];
                const fp = mediaItem.path;
                const ft = mediaItem.type;

                if (ft === 'image' || ft === 'gif') {
                    const img = document.createElement('img');
                    img.src = fp;
                    img.className = 'chat-attachment-img';
                    img.style.cursor = 'pointer';
                    img.addEventListener('click', (event) => {
                        event.stopPropagation();
                        if (typeof window.openLightbox === 'function') {
                            window.openLightbox(mediaItem, mediaItems);
                        }
                    });
                    gridDiv.appendChild(img);
                } else if (ft === 'video') {
                    const vid = document.createElement('video');
                    vid.src = fp;
                    vid.controls = true;
                    vid.className = 'chat-attachment-vid';
                    gridDiv.appendChild(vid);
                } else if (ft === 'audio') {
                    const aud = document.createElement('audio');
                    aud.src = fp;
                    aud.controls = true;
                    aud.className = 'chat-attachment-audio';
                    gridDiv.appendChild(aud);
                }
            }
            bubble.appendChild(gridDiv);
        }
        
        const timeSpan = document.createElement('div');
        timeSpan.className = 'message-time';
        timeSpan.innerText = `${msg.edited ? 'Изменено ' : ''} ${msgDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
        bubble.appendChild(timeSpan);
        wrapper.appendChild(bubble);
        
        // click handler for context menu
        wrapper.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showMessageContextMenu(msg.id, isMine, e.clientX, e.clientY);
        });
	wrapper.addEventListener('dblclick', (e) => {
	    e.preventDefault();
	    setReplyTo(msg.id);
	});

        messagesContainer.appendChild(wrapper);
    }
}
    
function showMessageContextMenu(msgId, isMine, mouseX, mouseY) {
    let existingMenu = document.querySelector('.message-context-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'message-context-menu';
    menu.style.left = mouseX + 'px';
    menu.style.top = mouseY + 'px';

    // Copy item - for both yours and theirs
    const copyItem = document.createElement('div');
    copyItem.className = 'context-item';
    copyItem.innerText = 'Скопировать';
    copyItem.onclick = () => {
        const msg = allMessages.find(m => m.id == msgId);
        if (msg && msg.decryptedText) {
            navigator.clipboard.writeText(msg.decryptedText).catch(() => {});
        }
        menu.remove();
    };
    

    const replyItem = document.createElement('div');
    replyItem.className = 'context-item';
    replyItem.innerText = 'Ответить';
    replyItem.onclick = () => { setReplyTo(msgId); menu.remove(); };
    menu.appendChild(replyItem);
    menu.appendChild(copyItem);

    if (isMine) {
        const editItem = document.createElement('div');
        editItem.innerText = 'Редактировать';
        editItem.className = 'context-item';
        editItem.onclick = () => { startEditing(msgId); menu.remove(); };
        menu.appendChild(editItem);

        const deleteItem = document.createElement('div');
        deleteItem.innerText = 'Удалить';
        deleteItem.className = 'context-item';
        deleteItem.onclick = async () => { await deleteMessage(msgId); menu.remove(); };
        menu.appendChild(deleteItem);
    }

    document.body.appendChild(menu);
    void menu.offsetHeight;
    menu.classList.add('show');

    // Не даём меню вылезти за пределы экрана (важно на мобильных: contextmenu
    // срабатывает по долгому тапу и может оказаться у самого края)
    const rect = menu.getBoundingClientRect();
    const margin = 8;
    if (rect.right > window.innerWidth - margin) {
        menu.style.left = Math.max(margin, window.innerWidth - rect.width - margin) + 'px';
    }
    if (rect.bottom > window.innerHeight - margin) {
        menu.style.top = Math.max(margin, window.innerHeight - rect.height - margin) + 'px';
    }

    setTimeout(() => {
        document.addEventListener('click', function hideMenu(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', hideMenu);
            }
        });
    }, 100);
}
    
async function deleteMessage(msgId) {
        const confirmed = await confirmDialog({
            title: 'Удалить сообщение?',
            text: 'Это действие нельзя отменить.',
            confirmLabel: 'Удалить',
            cancelLabel: 'Отмена'
        });
        if (!confirmed) return;

        try {
            const res = await fetch('/api/chats/messages/message', { method: 'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ messageId: msgId }), credentials:'same-origin' });
            if (!res.ok) throw new Error('bad status');
            await loadMessages(currentChatId);
        } catch (err) {
            console.error('Error deleting message:', err);
            showToast('Не удалось удалить сообщение', 'error');
        }
    }
    
function startEditing(msgId) {
        const msg = allMessages.find(m => m.id == msgId);
        if (msg) {
            editingMessageId = msgId;
            msgInput.value = msg.decryptedText || '';
            autoGrowMessageInput();
            msgInput.focus();
            document.getElementById('edit-indicator').style.display = 'block';
            sendBtn.innerText = 'Сохранить';
            replyToMessageId = null;
        }
}
    
function setReplyTo(msgId) {
    replyToMessageId = msgId;
    const msg = allMessages.find(m => m.id == msgId);
    if (!msg) return;
    
    // Remove existing indicator
    const existing = document.getElementById('reply-indicator-floating');
    if(existing) existing.remove();
    
    const indicator = document.createElement('div');
    indicator.id = 'reply-indicator-floating';
    indicator.style.background = '#eef';
    indicator.style.padding = '8px 12px';
    indicator.style.borderRadius = '20px';
    indicator.style.fontSize = '12px';
    indicator.style.marginBottom = '4px';
    indicator.style.borderLeft = '3px solid #8FDADB';
    indicator.style.display = 'flex';
    indicator.style.justifyContent = 'space-between';
    indicator.style.alignItems = 'center';
    
    const textSpan = document.createElement('span');
    const isMine = msg.userId == currentUserId;
    const senderName = isMine ? 'Вы' : currentChatUsername;
    const previewText = msg.decryptedText || '[Медиа]';
    textSpan.textContent = `Ответ ${senderName}: ${previewText.substring(0, 60)}${previewText.length > 60 ? '...' : ''}`;
    indicator.appendChild(textSpan);
    
    const closeBtn = document.createElement('span');
    closeBtn.textContent = '✕';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.marginLeft = '10px';
    closeBtn.onclick = () => {
        replyToMessageId = null;
        indicator.remove();
    };
    indicator.appendChild(closeBtn);
    
    msgInput.parentNode.insertBefore(indicator, msgInput);
}
    
let isSendingMessage = false;

async function sendMessage() {
    if (isSendingMessage) return; // защита от повторной отправки по дабл-клику/Enter
    const text = msgInput.value.trim();
    if (!text && pendingFiles.length === 0) return;

    isSendingMessage = true;
    sendBtn.disabled = true;
    sendBtn.classList.add('is-sending');

    try {
        const formData = new FormData();
        if (text) {
            const { encryptMessage } = await import('./crypto-utils.js');
            const encryptedText = await encryptMessage(currentChatId, text);
            formData.append('messageText', encryptedText);
        }
        if (replyToMessageId) formData.append('referenceId', replyToMessageId);
        for (let file of pendingFiles) {
            formData.append('files', file);
        }
        let url = `/api/chats/messages/${currentChatId}`;
        let method = 'POST';
        if (editingMessageId) {
            await fetch('/api/chats/messages/message', { method: 'PUT', body: JSON.stringify({ messageId: editingMessageId, newText: text, deleteFiles: [] }), headers:{'Content-Type':'application/json'}, credentials:'same-origin' });
            editingMessageId = null;
            document.getElementById('edit-indicator').style.display = 'none';
        } else {
            await fetch(url, { method, body: formData, credentials: 'same-origin' });
        }
        msgInput.value = '';
        autoGrowMessageInput();
        pendingFiles = [];
        replyToMessageId = null;
        updateFilePreview();
        await loadMessages(currentChatId);
        scrollToBottom();

        // Update the chat preview or create the card if it doesn't exist
        updateChatCardPreview(currentChatId, text);
    } finally {
        isSendingMessage = false;
        sendBtn.disabled = false;
        sendBtn.classList.remove('is-sending');
        sendBtn.innerText = 'Отправить!';
    }
}

function updateChatCardPreview(chatId, messageText) {
    const card = document.querySelector(`[data-chat-id="${chatId}"]`);
    const currentUserId = localStorage.getItem('userId');
    
    if (card) {
        // Update existing card
        const lastMsgDiv = card.querySelector('.chat-card-lastmsg');
        if (lastMsgDiv) {
            lastMsgDiv.textContent = 'Вы: ' + (messageText || '[Файл]');
        }
        const timeDiv = card.querySelector('.chat-card-time');
        if (timeDiv) {
            timeDiv.textContent = formatMessageTime(new Date().toISOString());
        }
        // Move card to top of its container
        const container = card.parentElement;
        container.prepend(card);
    } else {
        // Card doesn't exist - create it and add to top
        // First get the user info for this chat
        fetch(`/api/users/${currentOtherUserId}`)
            .then(r => r.json())
            .then(userData => {
                const chat = {
                    chatId: chatId,
                    username: userData.username,
                    profilePicture: userData.profilePicture,
                    userId: userData.id,
                    status: userData.status,
                    lastMessage: messageText,
                    lastMessageDecrypted: 'Вы: ' + (messageText || '[Файл]'),
                    lastMessageSenderId: currentUserId,
                    lastMessageTime: new Date().toISOString(),
                    unreadCount: 0
                };
                
                // Create the card and add to the top of the list
                const container = document.getElementById('chats-list');
                if (container) {
                    // Check if it should be in favourites
                    const card = document.createElement('div');
                    // ... create card using appendChatCard logic
                    // For simplicity, just reload the whole list
                    loadChats();
                }
            });
    }
}
    
    // File attachments handling
function updateFilePreview() {
        filePreviewRow.innerHTML = '';
        if (pendingFiles.length === 0) {
            filePreviewRow.style.display = 'none';
            return;
        }
        filePreviewRow.style.display = 'flex';
        for (let i=0; i<pendingFiles.length; i++) {
            const f = pendingFiles[i];
            const container = document.createElement('div');
            container.className = 'preview-file-item';
            if (f.type.startsWith('image/')) {
                const img = document.createElement('img');
                img.src = URL.createObjectURL(f);
                container.appendChild(img);
            } else if (f.type.startsWith('video/')) {
                const vid = document.createElement('video');
                vid.src = URL.createObjectURL(f);
                vid.controls = true;
                container.appendChild(vid);
            } else {
                const span = document.createElement('span');
                span.innerText = f.name;
                container.appendChild(span);
            }
            const removeBtn = document.createElement('div');
            removeBtn.className = 'remove-preview-btn';
            removeBtn.innerText = '✕';
            removeBtn.onclick = () => { pendingFiles.splice(i,1); updateFilePreview(); };
            container.appendChild(removeBtn);
            filePreviewRow.appendChild(container);
        }
}
    
function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
    
function chatFeedmainClose(options = {}) {
    if (currentPollController) {
        currentPollController.abort();
        currentPollController = null;
    }

    const url = new URL(window.location);
    const hadChatTarget = url.searchParams.has('chatId') || url.searchParams.has('id');
    url.searchParams.delete('chatId');
    url.searchParams.delete('id');

    if (!options.skipHistory && hadChatTarget) {
        window.history.pushState({}, '', url);
    }
    
    const chatFeedmain = document.getElementById('chat-feedmain');
    chatFeedmain.style.display = 'none';
    chatPanel.style.display = 'none';
    setMobileChatOpen(false);
    currentChatId = null;
}
    
    // attach menu logic
    clipBtn.addEventListener('click', () => {
        attachMenu.classList.toggle('show');
    });
    document.querySelectorAll('.attach-option').forEach(opt => {
        opt.addEventListener('click', () => {
            const type = opt.dataset.type;
            const input = document.createElement('input');
            input.type = 'file';
            if (type === 'image') input.accept = 'image/*';
            else if (type === 'video') input.accept = 'video/*';
            else if (type === 'audio') input.accept = 'audio/*';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (file) pendingFiles.push(file);
                updateFilePreview();
            };
            input.click();
            attachMenu.classList.remove('show');
        });
    });
    sendBtn.addEventListener('click', sendMessage);
    chatMobileBack?.addEventListener('click', () => {
        chatFeedmainClose();
    });

    // initial load is owned by the DOMContentLoaded entry point below
    const chatFeedmain = document.getElementById('chat-feedmain')
	chatFeedmain.style.display = 'none'
    setMobileChatOpen(false);

    // optional polling
    //setInterval(() => { if(currentChatId) loadMessages(currentChatId); }, 5000);
    function escapeHtml(str) { if(!str) return ''; return str.replace(/[&<>]/g, function(m){if(m==='&') return '&amp;'; if(m==='<') return '&lt;'; if(m==='>') return '&gt;'; return m;}); }

function stikersResponsive() {
    const firstDiv = document.querySelector('.chat-container-panel');
    const secondDiv = document.querySelector('.chat-stickers-panel');
    const threshold = 1400; 
    
    if (window.innerWidth < threshold) {
        secondDiv.style.display = 'none';
        firstDiv.style.width = '100%';
    } else {
        secondDiv.style.display = 'none';
        firstDiv.style.width = '100%';
        //secondDiv.style.display = 'block';
        //firstDiv.style.width = '65%';
        //secondDiv.style.width = '35%';
    }
}


async function waitForMessages(chatId) {
    if (!chatId) return;
    
    // If we're already polling a different chat, cancel it
    if (currentPollController && currentPollController.chatId !== chatId) {
        currentPollController.abort();
        currentPollController = null;
    }
    
    // If we already have a controller for this chat, use it
    if (!currentPollController) {
        currentPollController = new AbortController();
        currentPollController.chatId = chatId;
    }
    
    try {
        const response = await fetch(`/api/chats/${chatId}/wait`, {
            method: 'GET',
            credentials: 'same-origin',
            signal: currentPollController.signal
        });
        
        if (response.status === 204) {
            waitForMessages(chatId);
            return;
        }
        
        if (response.ok) {
            const data = await response.json();
            
            if (data.type === 'new_message') {
                // Decrypt the message
                const decryptedMsg = await decryptMessageIfNeeded(data.message, chatId);

                // Запоминаем, был ли пользователь у низа ленты ДО перерисовки,
                // чтобы не выдёргивать его вниз, если он читает историю сообщений
                const wasNearBottom = isNearBottom();
                const isOwnMessage = decryptedMsg.userId == currentUserId;

                allMessages.push(decryptedMsg);
                renderMessages();
                //updateChatPreview(chatId, data.message);

		const wrappers = messagesContainer.querySelectorAll('.message-wrapper.mine.unread');
        wrappers.forEach(wrapper => {
                wrapper.classList.remove('unread');
        });

                if (wasNearBottom || isOwnMessage) {
                    scrollToBottom();
                    hideScrollToBottomButton();
                } else {
                    showScrollToBottomButton(1);
                }

                // ONLY mark as read if window is focused
                if (document.hasFocus()) {
                    await fetch(`/api/users/chats/read/${chatId}`, {method: 'POST', credentials: 'same-origin' });
                }
            }


		if (data.type === 'read_all') {
		    const wrappers = messagesContainer.querySelectorAll('.message-wrapper.mine.unread');
		    wrappers.forEach(wrapper => {
		        wrapper.classList.remove('unread');
		    });
		}

            
            // Only continue if not aborted
            if (!currentPollController.signal.aborted) {
                waitForMessages(chatId);
            }
        } else {
            if (!currentPollController.signal.aborted) {
                setTimeout(() => waitForMessages(chatId), 10000);
            }
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            // Normal abort when switching chats - just exit
            return;
        }
        if (!currentPollController.signal.aborted) {
            console.error('Polling error:', err);
            setTimeout(() => waitForMessages(chatId), 10000);
        }
    }
}

// Add sound function
function playNotificationSound() {
    try {
        const audio = new Audio('/sounds/chat-notif.mp3');
        audio.volume = 0.5;
        audio.play().catch(() => {});
    } catch (e) {
        // Silent fail if audio can't play
    }
}

// Global long polling
async function waitForGlobalUpdates() {
    try {
        const response = await fetch(`/api/users/chats/wait`, {
            method: 'GET',
            credentials: 'same-origin',
            signal: AbortSignal.timeout(65000)
        });
        
        if (response.status === 204) {
            waitForGlobalUpdates();
            return;
        }
        
        if (response.ok) {
            const data = await response.json();
            
            if (data.type === 'new_message_global') {
                playNotificationSound();
                updateChatPreview(data.chatId, data.message);
            }
            
            // Handle messages read notification
            if (data.type === 'read_all_global') {
    // Remove unread badge from chat card
    const card = document.querySelector(`[data-chat-id="${data.chatId}"]`);
    if (card) {
        card.classList.remove('chat-card-unread');
        const badge = card.querySelector('.chat-card-unread-badge');
        if (badge) badge.remove();
    }
}
            
            waitForGlobalUpdates();
        } else {
            setTimeout(() => waitForGlobalUpdates(), 10000);
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            waitForGlobalUpdates();
        } else {
            console.error('Global polling error:', err);
            setTimeout(() => waitForGlobalUpdates(), 10000);
        }
    }
}

function updateChatPreview(chatId, message) {
    const card = document.querySelector(`[data-chat-id="${chatId}"]`);
    if (!card) return;
    
    decryptMessageIfNeeded(message, chatId).then(decryptedMsg => {
        const lastMsgDiv = card.querySelector('.chat-card-lastmsg');
        if (lastMsgDiv) {
            const isMine = message.userId == currentUserId;
            const previewText = isMine ? 'Вы: ' : '';
            lastMsgDiv.textContent = previewText + (decryptedMsg.decryptedText || '[Файл]');
        }
        
        const timeDiv = card.querySelector('.chat-card-time');
        if (timeDiv && message.createdAt) {
            timeDiv.textContent = formatMessageTime(message.createdAt);
        }

        const shouldShowUnread = (message.userId != currentUserId) && 
                                 (currentChatId != chatId || !document.hasFocus());
        
        if (shouldShowUnread) {
            card.classList.add('chat-card-unread');
            let badge = card.querySelector('.chat-card-unread-badge');
            if (!badge) {
                badge = document.createElement('div');
                badge.classList.add('chat-card-unread-badge');
                card.appendChild(badge);
            }
            const currentCount = parseInt(badge.textContent) || 0;
            badge.textContent = currentCount + 1;
        } else {
            if (currentChatId == chatId && document.hasFocus()) {
                card.classList.remove('chat-card-unread');
                const badge = card.querySelector('.chat-card-unread-badge');
                if (badge) badge.remove();
            }
        }
    });
}


document.addEventListener('DOMContentLoaded', async () => {
    if (!window.FortPortRoles && window.roleBadgeHelpersPromise) {
        await window.roleBadgeHelpersPromise.catch(() => null);
    }
    await loadChats();
    stikersResponsive();
    waitForGlobalUpdates();
    await initChatPage();
    setupScrollListener();
});
window.addEventListener('resize', stikersResponsive);


window.addEventListener('beforeunload', () => {
    if (currentPollController) {
        currentPollController.abort();
        currentPollController = null;
    }
});


    window.escapeHtml = escapeHtml;
    window.chatFeedmainClose = chatFeedmainClose;