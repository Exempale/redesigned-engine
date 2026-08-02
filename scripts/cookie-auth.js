// cookie-auth.js

let sessionValid = false;

function loadRoleBadgeHelpers() {
    if (window.FortPortRoles) return Promise.resolve(window.FortPortRoles);
    if (window.roleBadgeHelpersPromise) return window.roleBadgeHelpersPromise;
    window.roleBadgeHelpersPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/scripts/role-badges.js';
        script.onload = () => resolve(window.FortPortRoles);
        script.onerror = reject;
        document.head.appendChild(script);
    });
    return window.roleBadgeHelpersPromise;
}

loadRoleBadgeHelpers().catch(error => console.error('Role badge helpers failed to load:', error));

let sessionBootstrapPromise = null;

function renderDeveloperModerationTools(user = {}) {
    document.getElementById('developer-moderation-tools')?.remove();
    if (!user.isAdmin && !user.isDeveloper && !user.isModerator) return;

    const root = document.createElement('aside');
    root.id = 'developer-moderation-tools';
    root.className = 'developer-moderation-tools';
    root.innerHTML = `
        <button type="button" class="developer-moderation-toggle" aria-expanded="false" aria-controls="developer-moderation-panel">
            Жалобы <span class="developer-moderation-count">…</span>
        </button>
        <section class="developer-moderation-panel" id="developer-moderation-panel" hidden>
            <div class="developer-moderation-header">
                <strong>Модерация</strong>
                <a href="/modspace">Открыть панель</a>
            </div>
            <div class="developer-moderation-list">Загрузка...</div>
        </section>
    `;
    document.body.appendChild(root);

    const toggle = root.querySelector('.developer-moderation-toggle');
    const panel = root.querySelector('.developer-moderation-panel');
    toggle.addEventListener('click', () => {
        const willOpen = panel.hidden;
        panel.hidden = !willOpen;
        toggle.setAttribute('aria-expanded', String(willOpen));
        root.classList.toggle('is-open', willOpen);
    });

    const loadReports = async () => {
        const list = root.querySelector('.developer-moderation-list');
        try {
            const response = await fetch('/api/mod/flagged-posts', { credentials: 'same-origin' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Не удалось загрузить жалобы');
            const reports = data.flags || [];
            root.querySelector('.developer-moderation-count').textContent = reports.length;
            list.innerHTML = '';
            if (!reports.length) {
                list.textContent = 'Новых жалоб нет';
                return;
            }

            reports.slice(0, 5).forEach(report => {
                const item = document.createElement('article');
                item.className = 'developer-moderation-item';
                const summary = document.createElement('a');
                summary.href = `/post?id=${encodeURIComponent(report.postId)}`;
                summary.className = 'developer-moderation-item-summary';
                summary.textContent = report.postContent || `Пост #${report.postId}`;
                const meta = document.createElement('div');
                meta.className = 'developer-moderation-item-meta';
                meta.textContent = `${report.flagType} · ${report.submitterName || 'Пользователь'}`;
                const actions = document.createElement('div');
                actions.className = 'developer-moderation-item-actions';

                [['hide', 'Скрыть'], ['dismiss', 'Отклонить'], ['resolve', 'Закрыть']].forEach(([action, label]) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.textContent = label;
                    button.addEventListener('click', async () => {
                        button.disabled = true;
                        try {
                            const actionResponse = await fetch(`/api/mod/reports/${report.id}/action`, {
                                method: 'POST',
                                credentials: 'same-origin',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ action })
                            });
                            const actionData = await actionResponse.json();
                            if (!actionResponse.ok || !actionData.success) {
                                throw new Error(actionData.error || 'Действие не выполнено');
                            }
                            await loadReports();
                        } catch (error) {
                            button.disabled = false;
                            console.error(error);
                        }
                    });
                    actions.appendChild(button);
                });
                item.append(summary, meta, actions);
                list.appendChild(item);
            });
        } catch (error) {
            root.querySelector('.developer-moderation-count').textContent = '!';
            list.textContent = error.message;
        }
    };

    loadReports();
}

function renderGlobalAnnouncements(announcements = []) {
    document.getElementById('global-announcements-root')?.remove();
    if (!announcements.length) return;

    const root = document.createElement('section');
    root.id = 'global-announcements-root';
    root.className = 'global-announcements-root';
    root.setAttribute('aria-label', 'Глобальные уведомления');

    announcements.forEach(announcement => {
        const card = document.createElement('article');
        card.className = 'global-announcement-card';
        card.dataset.announcementId = announcement.id;

        const content = document.createElement('div');
        content.className = 'global-announcement-content';
        const text = document.createElement('div');
        text.className = 'global-announcement-text';
        text.textContent = announcement.text;
        const meta = document.createElement('div');
        meta.className = 'global-announcement-meta';
        meta.textContent = `От ${announcement.senderUsername} · ${new Date(announcement.createdAt).toLocaleString('ru-RU')}`;
        content.append(text, meta);

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'global-announcement-close';
        closeButton.textContent = 'Закрыть';
        closeButton.setAttribute('aria-label', 'Закрыть глобальное уведомление');
        closeButton.addEventListener('click', async () => {
            closeButton.disabled = true;
            try {
                const response = await fetch(`/api/announcements/${announcement.id}/dismiss`, {
                    method: 'POST',
                    credentials: 'same-origin'
                });
                if (!response.ok) throw new Error('Не удалось закрыть уведомление');
                card.remove();
                if (!root.children.length) root.remove();
            } catch (error) {
                closeButton.disabled = false;
                console.error(error);
            }
        });

        card.append(content, closeButton);
        root.appendChild(card);
    });

    document.body.appendChild(root);
}

async function verifySession() {
    try {
        if (!sessionBootstrapPromise) {
            sessionBootstrapPromise = fetch('/api/session/bootstrap', {
                credentials: 'same-origin'
            }).then(async response => {
                if (!response.ok) throw Object.assign(new Error('Session invalid'), { status: response.status });
                return response.json();
            }).catch(error => {
                sessionBootstrapPromise = null;
                throw error;
            });
        }

        const data = await sessionBootstrapPromise;
        const userData = data.user;
        localStorage.setItem('sessionValid', 'true');
        localStorage.setItem('userId', userData.id);
        localStorage.setItem('username', userData.username);
        localStorage.setItem('userAvatar', userData.profilePicture || '/default-avatar.jpg');
        localStorage.setItem('isAdmin', String(Boolean(userData.isAdmin)));
        localStorage.setItem('isOwner', String(Boolean(userData.isOwner)));
        localStorage.setItem('isDeveloper', String(Boolean(userData.isDeveloper)));
        localStorage.setItem('isModerator', String(Boolean(userData.isModerator)));
        localStorage.setItem('displayRole', userData.displayRole || '');
        const mascotBricked = data.mascot?.bricked === -1 ? '-1' : '0';
        localStorage.setItem('mascotBricked', mascotBricked);
        localStorage.setItem('handHolding', data.mascot?.handHolding ? '1' : '0');
        sessionStorage.setItem('mascotBricked', mascotBricked);
        window.sessionBootstrap = data;
        window.dispatchEvent(new CustomEvent('fortport:bootstrap', { detail: data }));
        renderGlobalAnnouncements(data.announcements || []);
        renderDeveloperModerationTools(userData);
        updateAuthButtons();
        return true;
    } catch (err) {
        console.log('Session verification failed:', err);
    }
    
    // Session invalid - force logout
    clearUserData();
    
    // Pages that REQUIRE authentication
    const protectedPages = [
        '/communities',
        '/friends',
        '/settings',
        '/community/settings',
        '/music',
        '/new_community',
        '/chats'
    ];
    
    const currentPath = window.location.pathname;
    const isProtected = protectedPages.some(page => currentPath === page || currentPath.startsWith(page + '?'));
    
    // Only redirect if:
    // 1. Not already on login/register
    // 2. Not on public pages (/, /about, /support, /privacy, /terms, /post, /photo, /video, /profile, /community)
    // 3. Not during logout
    if (isProtected && 
        currentPath !== '/login' && 
        currentPath !== '/register' &&
        !window._isLoggingOut) {
        window._isLoggingOut = true;
        alert('Your session has expired. Please log in again.');
        window.location.href = '/login';
    }
    return false;
}

async function authenticatedFetch(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        credentials: 'same-origin'
    });
    
    if (response.status === 401) {
        // Session expired
        clearUserData();
        if (!window._isLoggingOut) {
            window._isLoggingOut = true;
            alert('Session expired. Please log in again.');
            window.location.href = '/login';
        }
        throw new Error('Unauthorized');
    }
    
    return response;
}

// Save user display data (from login response)
function setUserData(userData) {
    localStorage.setItem('username', userData.username);
    localStorage.setItem('userAvatar', userData.profilePicture || '/default-avatar.jpg');
    localStorage.setItem('userId', userData.id);
    localStorage.setItem('isAdmin', String(Boolean(userData.isAdmin)));
    localStorage.setItem('isOwner', String(Boolean(userData.isOwner)));
    localStorage.setItem('isDeveloper', String(Boolean(userData.isDeveloper)));
    localStorage.setItem('isModerator', String(Boolean(userData.isModerator)));
    localStorage.setItem('displayRole', userData.displayRole || '');
    localStorage.setItem('sessionValid', 'true');
}

// Clear ALL user data
function clearUserData() {
    localStorage.removeItem('userId');
    localStorage.removeItem('username');
    localStorage.removeItem('isAdmin');
    localStorage.removeItem('isOwner');
    localStorage.removeItem('isDeveloper');
    localStorage.removeItem('isModerator');
    localStorage.removeItem('displayRole');
    localStorage.removeItem('userAvatar');
    localStorage.removeItem('sessionValid');
    localStorage.removeItem('friendNotifications');
    localStorage.removeItem('chatNotifications');
}

// Check if user is logged in via localStorage
function isUserLoggedIn() {
    return localStorage.getItem('sessionValid') === 'true' && localStorage.getItem('userId');
}

function getUserData() {
    return {
        userId: localStorage.getItem('userId'),
        username: localStorage.getItem('username'),
        isAdmin: localStorage.getItem('isAdmin') === 'true',
        isDeveloper: localStorage.getItem('isDeveloper') === 'true',
        userAvatar: localStorage.getItem('userAvatar') || '/default-avatar.jpg'
    };
}

function syncFromLocalStorage() {
    // Just a stub for compatibility
    updateAuthButtons();
}

// ============ NOTIFICATION FUNCTIONS ============
function updateFriendNotifications(count) {
    localStorage.setItem('friendNotifications', count.toString());
    updateNotificationBadges();
}

function updateChatNotifications(count) {
    localStorage.setItem('chatNotifications', count.toString());
    updateNotificationBadges();
}

function getFriendNotifications() {
    return parseInt(localStorage.getItem('friendNotifications') || '0');
}

function getChatNotifications() {
    return parseInt(localStorage.getItem('chatNotifications') || '0');
}

function clearFriendNotifications() {
    localStorage.setItem('friendNotifications', '0');
    updateNotificationBadges();
}

function clearChatNotifications() {
    localStorage.setItem('chatNotifications', '0');
    updateNotificationBadges();
}

function updateNotificationBadges() {
    const friendCount = getFriendNotifications();
    const chatCount = getChatNotifications();
    
    const friendsLink = document.querySelector('a[href="/friends.html"]');
    if (friendsLink) {
        let badge = friendsLink.querySelector('.notification-badge');
        if (friendCount > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.classList.add('notification-badge');
                friendsLink.appendChild(badge);
            }
            badge.textContent = friendCount > 9 ? '9+' : friendCount;
        } else {
            if (badge) badge.remove();
        }
    }
    
    const chatsToggle = document.getElementById('chats-toggle');
    if (chatsToggle) {
        let badge = chatsToggle.querySelector('.notification-badge');
        if (chatCount > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.classList.add('notification-badge');
                chatsToggle.appendChild(badge);
            }
            badge.textContent = chatCount > 9 ? '9+' : chatCount;
        } else {
            if (badge) badge.remove();
        }
    }
}

// Call this on login page after successful login
function onLoginSuccess(userData) {
    setUserData(userData);
    window.location.href = '/';
}

// Call this on page load
document.addEventListener('DOMContentLoaded', () => {
    const protectedPages = [
        '/communities',
        '/friends',
        '/settings',
        '/community/settings',
        '/music',
        '/new_community',
        '/chats',
        '/profile'
    ];
    
    const currentPath = window.location.pathname;
    const isProtected = protectedPages.some(page => currentPath === page || currentPath.startsWith(page + '?'));
    
    // Only verify session on protected pages OR if not on login/register
    if (isProtected || (currentPath !== '/login' && currentPath !== '/register')) {
        verifySession();
    } else {
        updateAuthButtons();
    }
});

// Make functions global
window.setUserData = setUserData;
window.clearUserData = clearUserData;
window.isUserLoggedIn = isUserLoggedIn;
window.getUserData = getUserData;
window.syncFromLocalStorage = syncFromLocalStorage;
window.updateFriendNotifications = updateFriendNotifications;
window.updateChatNotifications = updateChatNotifications;
window.getFriendNotifications = getFriendNotifications;
window.getChatNotifications = getChatNotifications;
window.clearFriendNotifications = clearFriendNotifications;
window.clearChatNotifications = clearChatNotifications;
window.updateNotificationBadges = updateNotificationBadges;
window.verifySession = verifySession;
window.authenticatedFetch = authenticatedFetch;
window.onLoginSuccess = onLoginSuccess;