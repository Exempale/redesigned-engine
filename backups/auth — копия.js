function updateAuthButtons() {
	const body = document.body
	const topBar = document.createElement('nav');
        topBar.classList.add('top-bar')
        topBar.innerHTML = `
    <div class="logo-name" style=""><a href="/" style="color: #02383e; text-decoration: none; display: flex;"><img src="/ui/logos/main-page-logo-nobottom.webp" style="height:40px; display: flex;"></a></div>
    <div id="auth-buttons">
    </div>`
	body.prepend(topBar);

    const authDiv = document.getElementById('auth-buttons')
    if (!authDiv) return
    
    if (!sessionStorage.getItem('userId')) {
        syncFromLocalStorage()
    }
    
    const userId = sessionStorage.getItem('userId')
    const username = sessionStorage.getItem('username')
    const userAvatar = sessionStorage.getItem('userAvatar') || '/default-avatar.jpg'
    
    if (userId) {
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
			<img src="/ui/icons/chats_aero.webp" style="height:30px; width:auto;  padding:3px;">
                    Переписки
                    ${getChatNotifications() > 0 ? `<span class="notification-badge">${getChatNotifications() > 9 ? '9+' : getChatNotifications()}</span>` : ''}
                </button>
            </div>
            <div class="nav-user-section">
                <div class="user-menu-container">
                    <div class="user-menu-trigger" onclick="toggleUserMenu()">
                        <img src="${userAvatar}" alt="Avatar" class="nav-avatar frutiger-aero-border">
                        <span class="nav-username">${username}</span>
                        <span class="dropdown-arrow">▼</span>
                    </div>
                    <div id="user-dropdown" class="user-dropdown">
                        <a href="/profile.html?user=${username}" class="dropdown-item">Мой профиль</a>
                        <a href="/settings.html" class="dropdown-item">Настройки</a>
                        <div class="dropdown-divider"></div>
                        <button onclick="logout()" class="dropdown-item logout-item">Выйти</button>
                    </div>
                </div>
            </div>
        `
        
        document.getElementById('chats-toggle').addEventListener('click', toggleChatsPanel)
        
        document.addEventListener('click', function(e) {
            const menu = document.getElementById('user-dropdown')
            const trigger = document.querySelector('.user-menu-trigger')
            if (menu && trigger && !trigger.contains(e.target) && !menu.contains(e.target)) {
                menu.classList.remove('show')
            }
        })
        
        setTimeout(loadUserAvatar, 100)
    } else {
        authDiv.innerHTML = `
            <a href="/login.html" style="margin-right: 10px; color: #15141c;">Вход</a>
            <a href="/register.html" style="color: #15141c;">Регистрация</a>
        `
    }
}

function logout() {
    clearUserData() // This clears both sessionStorage and localStorage
    updateAuthButtons()
    window.location.href = '/'
}

function toggleUserMenu() {
    const dropdown = document.getElementById('user-dropdown')
    dropdown.classList.toggle('show')
}


// Update on page load
document.addEventListener('DOMContentLoaded', updateAuthButtons)

// In auth.js or at the bottom of profile.js:
window.loadUserAvatar = function() {
  const username = sessionStorage.getItem('username')
  if (!username) return
  
  const avatar = sessionStorage.getItem('userAvatar') || '/default-avatar.jpg'
  const navAvatar = document.querySelector('.nav-avatar')
  if (navAvatar) navAvatar.src = avatar
}