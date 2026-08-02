// Flag to prevent duplicate top bar creation
let topBarCreated = false;

function updateAuthButtons() {
    // Only create top bar once
    if (!topBarCreated) {
        const body = document.body
        const topBar = document.createElement('nav');
        topBar.classList.add('top-bar')
        topBar.id = 'main-top-bar' // Add ID for checking
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
    
    // Get user data from sessionStorage (set after login)
//    const userId = sessionStorage.getItem('userId')
//    const username = sessionStorage.getItem('username')
//    const userAvatar = sessionStorage.getItem('userAvatar') || '/default-avatar.jpg'
//    const isAdmin = sessionStorage.getItem('isAdmin') === 'true'

	const userId = localStorage.getItem('userId')
	    const username = localStorage.getItem('username')
	    const userAvatar = localStorage.getItem('userAvatar') || '/default-avatar.jpg'
	    const isAdmin = localStorage.getItem('isAdmin') === 'true'
    
    if (userId && username) {
        authDiv.innerHTML = `
            <div class="nav-left-links">
                <a href="/communities.html" class="nav-link">
                    <img src="/ui/icons/communities_aero.webp" style="height:30px; width:auto; padding:3px;">
                    Порты
                </a>
                <a href="/friends.html" class="nav-link">
                    <img src="/ui/icons/friends_aero.webp" style="height:30px; width:auto; padding:3px;">
                    Друзья
                    ${getFriendNotifications() > 0 ? `<span class="notification-badge">${getFriendNotifications() > 9 ? '9+' : getFriendNotifications()}</span>` : ''}
                </a>
                <button id="chats-toggle" class="chats-toggle-btn">
                    <img src="/ui/icons/chats_aero.webp" style="height:30px; width:auto; padding:3px;">
                    Переписки
                    ${getChatNotifications() > 0 ? `<span class="notification-badge">${getChatNotifications() > 9 ? '9+' : getChatNotifications()}</span>` : ''}
                </button>
            </div>
            <div class="nav-user-section">
                <div class="user-menu-container">
                    <div class="user-menu-trigger" onclick="toggleUserMenu(event)">
                        <img src="${userAvatar}" alt="Avatar" class="nav-avatar frutiger-aero-border" onerror="this.src='/default-avatar.jpg'">
                        <span class="nav-username">${escapeHtml(username)}</span>
                        <span class="dropdown-arrow">▼</span>
                    </div>
                    <div id="user-dropdown" class="user-dropdown">
                        <a href="/profile.html?user=${encodeURIComponent(username)}" class="dropdown-item">Мой профиль</a>
                        <a href="/settings.html" class="dropdown-item">Настройки</a>
                        <div class="dropdown-divider"></div>
                        <button onclick="logout()" class="dropdown-item logout-item">Выйти</button>
                    </div>
                </div>
            </div>
        `
        
        // Re-attach chat toggle event
        const chatsToggle = document.getElementById('chats-toggle')
        if (chatsToggle && typeof toggleChatsPanel !== 'undefined') {
            // Remove old listener to avoid duplicates
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
            <a href="/login.html" style="margin-right: 10px; color: #15141c;">Вход</a>
            <a href="/register.html" style="color: #15141c;">Регистрация</a>
        `
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
        window._isLoggingOut = true
        // Call logout endpoint to clear session cookie
        await fetch('/api/logout', {
            method: 'POST',
            credentials: 'same-origin'
        })
    } catch (err) {
        console.error('Logout error:', err)
    }
    
    // Clear local data
    clearUserData()
    
    // Reset top bar flag so it gets recreated
    topBarCreated = false
    
    // Redirect to home
    window.location.href = '/'
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

// Update on page load - but don't recreate top bar if it exists
document.addEventListener('DOMContentLoaded', () => {
//	verifySession()
    if (document.getElementById('main-top-bar')) {
//        topBarCreated = true
    }
//    updateAuthButtons()
})

window.loadUserAvatar = function() {
    const username = sessionStorage.getItem('username')
    if (!username) return
    
    const avatar = sessionStorage.getItem('userAvatar') || '/default-avatar.jpg'
    const navAvatar = document.querySelector('.nav-avatar')
    if (navAvatar) navAvatar.src = avatar
}

window.updateAuthButtons = updateAuthButtons