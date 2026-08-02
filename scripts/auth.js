// Flag to prevent duplicate top bar creation
let topBarCreated = false;
let topUtilityBarCreated = false;
let chatLongPollingController = null;
let isChatsPage = window.location.pathname.includes('/chats');
let notificationPollingController = null;

let notificationsPanel = null;
let notificationsLoaded = false;

function createUtilityBar() {
    document.getElementById('utility-bar')?.remove();
    topUtilityBarCreated = true;

    const bootstrapUser = window.sessionBootstrap?.user;
    const userId = bootstrapUser?.id ?? localStorage.getItem('userId');
    const username = bootstrapUser?.username ?? localStorage.getItem('username');
    const userAvatar = bootstrapUser?.profilePicture || localStorage.getItem('userAvatar') || '/default-avatar.jpg';
    const role = window.FortPortRoles?.resolveRole(bootstrapUser || {});
    const roleNameClass = role ? ` role-name role-name-${role}` : '';
    const roleBadge = window.FortPortRoles?.badgeHtml(bootstrapUser || {}, { compact: true }) || '';
    
    const utilityBar = document.createElement('div');
    utilityBar.className = 'utility-bar';
    utilityBar.id = 'utility-bar';
    
    // Left side - links
    let leftHtml = `
        <div class="utility-left">
            ${localStorage.getItem('userId') ? `<a href="/settings" class="utility-link">Настройки</a>` : ''}
            <a href="/support" class="utility-link">Поддержка</a>
            <a href="/about" class="utility-link">О нас</a>
            <a href="/privacy" class="utility-link">Конфиденциальность</a>
            <a href="/terms" class="utility-link">Условия</a>
        </div>
    `;
    
    // Right side - user info (only if logged in)
    let rightHtml = '';
    if (userId && username) {
        rightHtml = `
            <div class="utility-right">
                <a href="#" class="utility-link utility-logout" onclick="logout()">Выйти</a>
		
                <a href="/profile?id=${encodeURIComponent(userId)}" class="utility-link utility-profile">
                    <span class="utility-username${roleNameClass}">${escapeHtml(username)}</span>
                    ${roleBadge}
                    <img src="${escapeHtml(userAvatar)}" class="utility-avatar" alt="" onerror="this.src='/default-avatar.jpg'">
                </a>
            </div>
        `;
    }
    
    utilityBar.innerHTML = leftHtml + rightHtml;
    document.body.prepend(utilityBar);
}


function updateAuthButtons() {
    // Create utility bar FIRST
    createUtilityBar();
    
    // Only create top bar once
    if (!topBarCreated) {
        const body = document.body
        const topBar = document.createElement('nav');
        topBar.classList.add('top-bar')
        topBar.id = 'main-top-bar'
        topBar.innerHTML = `
            <div class="logo-name">
                <a href="/" style="color: #02383e; text-decoration: none; display: flex;">
                    <img src="/ui/logos/main-page-logo-nobottom.webp" style="height:40px; display: flex;">
                </a>
            </div>
            <div id="auth-buttons"></div>
        `
        body.prepend(topBar);
        topBarCreated = true
    }

    const authDiv = document.getElementById('auth-buttons')
    if (!authDiv) return
    
    // Get user data from localStorage (set after login)
    const userId = localStorage.getItem('userId')
    const username = localStorage.getItem('username')
    const userAvatar = localStorage.getItem('userAvatar') || '/default-avatar.jpg'
    const isAdmin = localStorage.getItem('isAdmin') === 'true'
    
    if (userId && username) {
        authDiv.innerHTML = `
            <div class="nav-left-links">
		<a href="/audios" class="nav-link">
                    <img src="/ui/icons/audios_aero.webp" style="height:38px; width:auto; padding:3px; margin-left: -5px;">
                    Музыка
                </a>
                <a href="/communities" class="nav-link">
                    <img src="/ui/icons/communities_aero.webp" style="height:30px; width:auto; padding:3px; margin-left: -5px; margin-top: 2px;">
                    Порты
                </a>
                <a href="/friends" class="nav-link">
                    <img src="/ui/icons/friends_aero.webp" style="height:30px; width:auto; padding:3px; margin-top: 2px; margin-left: -4px;">
                    Друзья
                    ${getFriendNotifications() > 0 ? `<span class="notification-badge">${getFriendNotifications() > 9 ? '9+' : getFriendNotifications()}</span>` : ''}
                </a>
                <a href="/chats" class="nav-link">
                    <img src="/ui/icons/chats_aero.webp" style="height:30px; width:auto; padding:3px;">
                    Переписки
                </a>
            </div>
            <div class="nav-user-section">
		<div class="user-notifs" onclick="showNotifs(this)">
                    <img src="/ui/icons/bell_aero.webp" style="height:30px; width:auto; padding:3px;">
                    <span class="notification-badge" style="display: none;"></span>
                </div>
                <div class="user-menu-container">
                    <div class="user-menu-trigger" onclick="toggleUserMenu(event)">
                        <img src="${userAvatar}" alt="Avatar" class="nav-avatar frutiger-aero-border" onerror="this.src='/default-avatar.jpg'">
                        <span class="dropdown-arrow">▼</span>
                    </div>
                    <div id="user-dropdown" class="user-dropdown">
                        <a href="/profile?id=${userId}" class="dropdown-item">Мой профиль</a>
                        <a href="/settings" class="dropdown-item">Настройки</a>
                        <div class="dropdown-divider"></div>
                        <button onclick="logout()" class="dropdown-item logout-item">Выйти</button>
                    </div>
                </div>
            </div>
        `
        
        // Re-attach chat toggle event
        const chatsToggle = document.getElementById('chats-toggle')
        if (chatsToggle && typeof toggleChatsPanel !== 'undefined') {
            chatsToggle.removeEventListener('click', toggleChatsPanel)
            chatsToggle.addEventListener('click', toggleChatsPanel)
        }
        
        // Close dropdown when clicking outside
        document.addEventListener('click', function(e) {
            const menu = document.getElementById('user-dropdown')
            const trigger = document.querySelector('.user-menu-trigger')
            if (menu && trigger && !trigger.contains(e.target) && !menu.contains(e.target)) {
                menu.classList.remove('show')
            }
        })
        
    } else {
        authDiv.innerHTML = `
            <a href="/login" style="margin-right: 10px; color: #15141c;">Вход</a>
            <a href="/register" style="color: #15141c;">Регистрация</a>
        `
    }

    updateNotificationBadge()
}

function playNotificationSound() {
    try {
        // Check if notifications sound is enabled
        const notifSound = localStorage.getItem('notifSound');
        if (notifSound === '0') return;
        
        const audio = new Audio('/sounds/notif-general.mp3');
        audio.volume = 0.5;
        audio.play().catch(() => {});
    } catch (e) {
        // Silent fail
    }
}

function updateChatBadge(count) {
    const chatsLink = document.querySelector('.nav-link[href="/chats"]');
    if (!chatsLink) return;
    
    // Find the existing image or badge
    const existingImg = chatsLink.querySelector('img');
    const existingBadge = chatsLink.querySelector('.chat-badge-replacement');
    
    if (count > 0) {
        // Remove the image if it exists
        if (existingImg) existingImg.style.display = 'none';
        
        // Check if badge already exists
        let badge = chatsLink.querySelector('.chat-badge-replacement');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'chat-badge-replacement';
            badge.style.borderRadius = '50%';
            badge.style.background = '#ff4444';
            badge.style.color = 'white';
            badge.style.fontSize = '14px';
            badge.style.fontWeight = 'bold';
            badge.style.display = 'flex';
            badge.style.alignItems = 'center';
            badge.style.justifyContent = 'center';
            
            // Insert badge where the image was
            if (existingImg) {
                existingImg.parentNode.insertBefore(badge, existingImg);
            } else {
                chatsLink.prepend(badge);
            }
        }
        
        // Update count
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = 'flex';
        
    } else {
        // Show the image again
        if (existingImg) existingImg.style.display = 'block';
        
        // Remove badge
        const badge = chatsLink.querySelector('.chat-badge-replacement');
        if (badge) badge.remove();
    }
}

async function notificationLongPolling() {
    try {
        if (notificationPollingController) {
            notificationPollingController.abort();
        }
        
        notificationPollingController = new AbortController();
        
        const response = await fetch(`/api/users/notifications/wait`, {
            method: 'GET',
            credentials: 'same-origin',
            signal: notificationPollingController.signal
        });
        
        if (response.status === 204) {
            notificationLongPolling();
            return;
        }
        
        if (response.ok) {
            const data = await response.json();
            
            if (data.type === 'new_notification') {
                // Play sound if enabled
                playNotificationSound();
                
                // Update notification badge
                await updateNotificationBadge();
                
                // If notifications panel is open, refresh it
                if (notificationsPanel && notificationsPanel.classList.contains('show')) {
                    await loadNotifications();
                }
            }
            
            notificationLongPolling();
        } else {
            setTimeout(notificationLongPolling, 10000);
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            return;
        }
        console.error('Notification polling error:', err);
        setTimeout(notificationLongPolling, 10000);
    }
}

async function chatLongPolling() {
    // Only run if not on chats page
    if (isChatsPage) return;
    
    try {
        if (chatLongPollingController) {
            chatLongPollingController.abort();
        }
        
        chatLongPollingController = new AbortController();
        
        const response = await fetch(`/api/users/chats/wait`, {
            method: 'GET',
            credentials: 'same-origin',
            signal: chatLongPollingController.signal
        });
        
        if (response.status === 204) {
            chatLongPolling();
            return;
        }
        
        if (response.ok) {
            const data = await response.json();
            
            if (data.type === 'new_message_global') {
                // Play sound if chat sounds are enabled
                if (localStorage.getItem('chatSound') !== '0') {
                    try {
                        const audio = new Audio('/sounds/chat-notif.mp3');
                        audio.volume = 0.5;
                        audio.play().catch(() => {});
                    } catch (e) {}
                }
                
                const unreadResponse = await fetch(`/api/users/chats/unread`, {
                    method: 'GET',
                    credentials: 'same-origin'
                });
                const unreadData = await unreadResponse.json();
                updateChatBadge(unreadData.unreadCount || 0);
            }
            
            if (data.type === 'read_all_global') {
                const unreadResponse = await fetch(`/api/users/chats/unread`, {
                    method: 'GET',
                    credentials: 'same-origin'
                });
                const unreadData = await unreadResponse.json();
                updateChatBadge(unreadData.unreadCount || 0);
            }
            
            chatLongPolling();
        } else {
            setTimeout(chatLongPolling, 10000);
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            return;
        }
        console.error('Chat long polling error:', err);
        setTimeout(chatLongPolling, 10000);
    }
}

async function updateInitialChatBadge() {
    try {
        const response = await fetch(`/api/users/chats/unread`, {
            method: 'GET',
            credentials: 'same-origin'
        });
        const data = await response.json();
        updateChatBadge(data.unreadCount || 0);
    } catch (err) {
        console.error('Error getting initial chat unread count:', err);
    }
}

// Helper function to prevent XSS
function escapeHtml(str) {
    if (!str) return ''
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;'
        if (m === '<') return '&lt;'
        if (m === '>') return '&gt;'
        return m
    })
}

async function logout() {
    try {
        window._isLoggingOut = true;
        await fetch('/api/logout', {
            method: 'POST',
            credentials: 'same-origin'
        });
    } catch (err) {
        console.error('Logout error:', err);
    }
    
    // Clear local data
    localStorage.removeItem('userId');
    localStorage.removeItem('username');
    localStorage.removeItem('userAvatar');
    localStorage.removeItem('isAdmin');
    
    // Reset flags
    topBarCreated = false;
    topUtilityBarCreated = false;
    
    // Redirect to home
    window.location.href = '/';
}

function toggleUserMenu(event) {
    if (event) {
        event.stopPropagation()
    }
    const dropdown = document.getElementById('user-dropdown')
    if (dropdown) {
        dropdown.classList.toggle('show')
    }
}

// Update on page load


function showNotifs(badge) {
	
}

function openNotificationsPanel(triggerElement) {
    // Close if already exists
    if (notificationsPanel) {
        notificationsPanel.remove();
        notificationsPanel = null;
    }
    
    // Create panel
    notificationsPanel = document.createElement('div');
    notificationsPanel.className = 'notifications-panel';
    notificationsPanel.innerHTML = `
        <div class="notifications-header">
            <h3>Уведомления</h3>
            <button class="notifications-close-btn" onclick="closeNotificationsPanel()">×</button>
        </div>
        <div class="notifications-content">
            <div class="notifications-loading">Загрузка...</div>
        </div>
        <div class="notifications-footer">
            <button class="notifications-mark-all-btn" onclick="markAllNotificationsRead()">Прочитать всё</button>
            <button class="notifications-refresh-btn" onclick="refreshNotifications()">Обновить</button>
        </div>
    `;
    
    // Position relative to trigger element
    document.body.appendChild(notificationsPanel);
    // Add show class for animation
    setTimeout(() => notificationsPanel.classList.add('show'), 10);
    
    // Load notifications
    loadNotifications();
    
    // Close when clicking outside
    setTimeout(() => {
        document.addEventListener('click', function outsideClickListener(e) {
            if (notificationsPanel && !notificationsPanel.contains(e.target) && 
                !(triggerElement && triggerElement.contains(e.target))) {
                closeNotificationsPanel();
                document.removeEventListener('click', outsideClickListener);
            }
        });
    }, 100);
}

async function loadNotifications() {
    const userId = localStorage.getItem('userId');
    if (!userId) return;
    
    const contentDiv = notificationsPanel.querySelector('.notifications-content');
    contentDiv.innerHTML = '<div class="notifications-loading">Загрузка...</div>';
    
    try {
        const response = await fetch(`/api/users/notifications/${userId}`, {
            credentials: 'same-origin'
        });
        
        if (!response.ok) throw new Error('Failed to load notifications');
        
        const notifications = await response.json();
        
        if (notifications.length === 0) {
            contentDiv.innerHTML = '<div class="notifications-empty">Нет уведомлений</div>';
            return;
        }
        
        // Group notifications by date
        const grouped = groupNotificationsByDate(notifications);
        
        let html = '';
        for (const [dateLabel, notifs] of Object.entries(grouped)) {
            html += `<div class="notifications-date-group">
                        <div class="notifications-date-header">${dateLabel}</div>`;
            
            for (const notif of notifs) {
                html += `
    <div class="notification-item" data-notif-id="${notif.id}" data-notif-type="${notif.type}">
        <div class="notification-avatar">
            ${getNotificationAvatar(notif)}
        </div>
        <div class="notification-content">
            ${notif.requesterName ? `
                <div class="notification-actor">
                    <a href="/profile?id=${encodeURIComponent(notif.requesterId || notif.sourceId)}" class="notification-actor-name${notif.displayRole ? ` role-name role-name-${notif.displayRole}` : ''}">${escapeHtml(notif.requesterName)}</a>
                    ${window.FortPortRoles?.badgeHtml(notif, { compact: true }) || ''}
                </div>
            ` : ''}
            <div class="notification-text">${escapeHtml(notif.text)}</div>
            ${notif.preview ? `<div class="notification-preview">${escapeHtml(notif.preview)}</div>` : ''}
            <div class="notification-time">${formatNotificationTime(notif.createdAt)}</div>
        </div>
	    <div style="display:flex; flex-direction:row; gap:5px;">
        	${getActionButtonsForType(notif)}
	</div>
</div>
`;
            }
            html += `</div>`;
        }
        
        contentDiv.innerHTML = html;
        
    } catch (error) {
        console.error('Error loading notifications:', error);
        contentDiv.innerHTML = '<div class="notifications-error">Ошибка загрузки уведомлений</div>';
    }
}

function groupNotificationsByDate(notifications) {
    const groups = {};
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const thisWeek = new Date(today);
    thisWeek.setDate(thisWeek.getDate() - 7);
    
    for (const notif of notifications) {
        const date = new Date(notif.createdAt);
        let label;
        
        if (date >= today) {
            label = 'Сегодня';
        } else if (date >= yesterday) {
            label = 'Вчера';
        } else if (date >= thisWeek) {
            label = 'На этой неделе';
        } else {
            label = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
        }
        
        if (!groups[label]) groups[label] = [];
        groups[label].push(notif);
    }
    
    return groups;
}

function formatNotificationTime(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Только что';
    if (diffMins < 60) return `${diffMins} мин назад`;
    if (diffHours < 24) return `${diffHours} ч назад`;
    if (diffDays === 1) return 'Вчера';
    if (diffDays < 7) return `${diffDays} дн назад`;
    
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function getNotificationAvatar(notif) {
    switch (notif.type) {
        case 'comment_on_post':
        case 'reply_to_comment':
        case 'friend_request':
        case 'friend_request_accepted':
            // Use user's profile picture if available
            if (notif.requesterPicture) {
                return `<img src="${notif.requesterPicture}" class="notif-avatar-img" onerror="this.src='/default-avatar.jpg'">`;
            }
            return `<img src="/default-avatar.jpg" class="notif-avatar-img">`;
            
        case 'like_on_post':
        case 'like_on_comment':
            return `<img src="/ui/notifications/post_liked.webp" class="notif-avatar-icon">`;
            
        default:
            return `<div class="notif-avatar-placeholder"></div>`;
    }
}

function getActionButtonsForType(notif) {
    // Bottom action buttons - empty onclick handlers for you to fill
    switch (notif.type) {
        case 'comment_on_post':
        case 'reply_to_comment':
            return `<div class="notification-action-bottom">
                        <button class="notification-action-btn" onclick="viewCommentNotification(${notif.id}, ${notif.postId || notif.sourceId}, ${notif.commentId || 'null'})">Ответить</button>
    		<button class="notification-action-btn" onclick="markNotificationRead(${notif.id}, event)">Прочитать</button>
                    </div>`;
        case 'like_on_post':
        case 'like_on_comment':
            return `<div class="notification-action-bottom">
                        <button class="notification-action-btn" onclick="viewLikeNotification(${notif.id}, ${notif.sourceId})">Посмотреть</button>
    		<button class="notification-action-btn" onclick="markNotificationRead(${notif.id}, event)">Прочитать</button>
                    </div>`;
        case 'friend_request':
            return `<div class="notification-action-bottom">
                        <button class="notification-action-btn accept-request" onclick="acceptFriendRequestNotif(${notif.id}, ${notif.sourceId})">Принять</button>
                        <button class="notification-action-btn reject-request" onclick="rejectFriendRequestNotif(${notif.id}, ${notif.sourceId})">Отклонить</button>
                    </div>`;
        case 'friend_request_accepted':
            return `<div class="notification-action-bottom">
                        <button class="notification-action-btn" onclick="viewProfileNotification(${notif.id}, ${notif.sourceId})">Написать</button>
    		<button class="notification-action-btn" onclick="markNotificationRead(${notif.id}, event)">Прочитать</button>
                    </div>`;
        default:
            return '';
    }
}

// Mark single notification as read (delete it)
window.markNotificationRead = async function(notifId, event) {
    if (event) event.stopPropagation();
    
    const userId = localStorage.getItem('userId');
    if (!userId) return;
    
    try {
        const response = await fetch(`/api/users/notifications/read/${notifId}`, {
            method: 'POST',
            credentials: 'same-origin'
        });
        
        if (response.ok) {
            // Remove the notification item from DOM
            const notifElement = document.querySelector(`.notification-item[data-notif-id="${notifId}"]`);
            if (notifElement) {
                notifElement.remove();
                
                // Check if group is empty, remove it
                const group = notifElement.closest('.notifications-date-group');
                if (group && group.querySelectorAll('.notification-item').length === 0) {
                    group.remove();
                }
                
                // If no notifications left, show empty state
                const contentDiv = notificationsPanel?.querySelector('.notifications-content');
                if (contentDiv && contentDiv.querySelectorAll('.notification-item').length === 0) {
                    contentDiv.innerHTML = '<div class="notifications-empty">Нет уведомлений</div>';
                }
            }
            
            // Update notification badge
            updateNotificationBadge();
        }
    } catch (error) {
        console.error('Error marking notification as read:', error);
    }
};



let notificationCheckInterval = null;

function startNotificationPolling() {
    if (notificationCheckInterval) clearInterval(notificationCheckInterval);
    notificationCheckInterval = setInterval(() => {
        const userId = localStorage.getItem('userId');
        if (userId && notificationsLoaded) {
            updateNotificationBadge();
            // Optionally refresh if panel is open
            if (notificationsPanel && notificationsPanel.classList.contains('show')) {
                loadNotifications();
            }
        }
    }, 30000);
}

// Initialize on page load


// Cleanup interval on page unload
window.addEventListener('beforeunload', () => {
    if (notificationCheckInterval) {
        clearInterval(notificationCheckInterval);
    }
});

window.viewCommentNotification = async function(notifId, postId, commentId) {
    try {
        await Promise.race([
            markNotificationRead(notifId),
            new Promise(resolve => setTimeout(resolve, 250))
        ]);
    } finally {
        const target = commentId ? `&comment=${encodeURIComponent(commentId)}` : '';
        window.location.href = `/post?id=${encodeURIComponent(postId)}${target}`;
    }
};

window.viewLikeNotification = function(notifId, postId) {
 markNotificationRead(notifId);
 window.location.href = `/post?id=${postId}`;
};

async function handleFriendRequestNotification(action, notifId, requesterId) {
    const item = document.querySelector(`.notification-item[data-notif-id="${notifId}"]`);
    const buttons = item ? [...item.querySelectorAll('button')] : [];
    buttons.forEach(button => { button.disabled = true; });
    try {
        const response = await fetch(`/api/friends/${action}`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requesterUserId: Number(requesterId) })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Не удалось обработать заявку');
        await markNotificationRead(notifId);
        if (typeof window.updateFriendNotifications === 'function') {
            const current = Math.max(0, (Number(localStorage.getItem('friendNotifications')) || 1) - 1);
            window.updateFriendNotifications(current);
        }
    } catch (error) {
        buttons.forEach(button => { button.disabled = false; });
        alert(error.message);
    }
}

window.acceptFriendRequestNotif = function(notifId, requesterId) {
    return handleFriendRequestNotification('accept', notifId, requesterId);
};

window.rejectFriendRequestNotif = function(notifId, requesterId) {
    return handleFriendRequestNotification('reject', notifId, requesterId);
};

window.viewProfileNotification = function(notifId, userId) {
  markNotificationRead(notifId);
  window.location.href = `/profile?id=${userId}`;
};

window.loadUserAvatar = function() {
    const username = localStorage.getItem('username')
    if (!username) return
    
    const avatar = localStorage.getItem('userAvatar') || '/default-avatar.jpg'
    const navAvatar = document.querySelector('.nav-avatar')
    if (navAvatar) navAvatar.src = avatar
}

window.updateAuthButtons = updateAuthButtons
window.addEventListener('fortport:roles-ready', () => {
    if (window.sessionBootstrap?.user) createUtilityBar();
});
window.showNotifs = function(badgeElement) {
    if (notificationsPanel && notificationsPanel.classList.contains('show')) {
        closeNotificationsPanel();
    } else {
        openNotificationsPanel(badgeElement);
    }
};
window.closeNotificationsPanel = function() {
    if (notificationsPanel) {
        notificationsPanel.classList.remove('show');
        setTimeout(() => {
            if (notificationsPanel) {
                notificationsPanel.remove();
                notificationsPanel = null;
            }
        }, 300);
    }
};
window.markAllNotificationsRead = async function() {
    const userId = localStorage.getItem('userId');
    if (!userId) return;
    
    try {
        const response = await fetch(`/api/users/notifications/${userId}/read`, {
            method: 'POST',
            credentials: 'same-origin'
        });
        
        if (response.ok) {
            // Clear all notifications from panel
            const contentDiv = notificationsPanel?.querySelector('.notifications-content');
            if (contentDiv) {
                contentDiv.innerHTML = '<div class="notifications-empty">Нет уведомлений</div>';
            }
            
            // Update notification badge
            updateNotificationBadge();
        }
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
    }
};

// Refresh notifications
window.refreshNotifications = async function() {
    await loadNotifications();
    updateNotificationBadge();
};


async function updateNotificationBadge() {
    const userId = localStorage.getItem('userId');
    if (!userId) return;
    
    try {
        const response = await fetch(`/api/users/notifications/${userId}/count`, {
            credentials: 'same-origin'
        });
        
        if (response.ok) {
            const data = await response.json();
            const badge = document.querySelector('.user-notifs .notification-badge');
            
            if (data.count > 0) {
                if (badge) {
                    const notifIcon = document.querySelector('.user-notifs');
                    badge.textContent = data.count;
                	badge.style.display = 'inline-flex';
		    notifIcon.classList.add('has-notifications')
                } else {
                    const notifIcon = document.querySelector('.user-notifs');
                    if (notifIcon) {
                        const newBadge = document.createElement('span');
                        newBadge.className = 'notification-badge';
                        newBadge.textContent = data.count;
                        notifIcon.appendChild(newBadge);
			notifIcon.classList.add('has-notifications')
                    }
                }
            } else if (badge) {
                badge.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error updating notification badge:', error);
    }
}

async function getMascotStatus() {
	const userId = localStorage.getItem('userId')
	if (!sessionStorage.getItem('mascotBricked')) 
		{
		const data = await fetch(`/api/users/mascot/status`, {method: 'GET', credentials: 'same-origin'})
		const pData = await data.json()

		localStorage.setItem('mascotBricked', pData.bricked === -1 ? '-1' : '0')
		sessionStorage.setItem('mascotBricked', pData.bricked === -1 ? '-1' : '0')
		localStorage.setItem('handHolding',pData.hand_holding)
	}
}

// Call on every page load
document.addEventListener('DOMContentLoaded', async () => {
    await updateAuthButtons();
    getMascotStatus();

    // Фоновые поллинги имеют смысл только для авторизованных —
    // иначе гость бесконечно долбится в защищённые эндпоинты
    const isLoggedIn = Boolean(localStorage.getItem('userId'));
    if (!isLoggedIn) return;

    startNotificationPolling();
    notificationLongPolling(); // Start notification long polling

    // Start chat long polling only if not on chats page
    if (!isChatsPage) {
        await updateInitialChatBadge();
        chatLongPolling();
    }
});


window.addEventListener('beforeunload', () => {
    if (notificationCheckInterval) {
        clearInterval(notificationCheckInterval);
    }
    if (notificationPollingController) {
        notificationPollingController.abort();
        notificationPollingController = null;
    }
    if (chatLongPollingController) {
        chatLongPollingController.abort();
        chatLongPollingController = null;
    }
});