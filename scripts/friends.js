// friends.js
let currentFriendsData = null
let currentSearchResults = null
let isSearchMode = false
let viewingUserId = null // Track whose profile we're viewing
let searchRequestTokenGlobal = 0

// Get DOM elements
const friendsListContainer = document.getElementById('friends-list-container')
const userSearchContainer = document.getElementById('user-search-container')
const searchInput = document.getElementById('friend-search-input')
const searchBarContainer = document.getElementById('search-bar-container')
const searchClearBtn = document.getElementById('search-clear-btn')

// ---------- Тосты вместо alert() ----------
function showToast(message, type = 'success') {
    const stack = document.getElementById('fp-toast-stack')
    if (!stack) { window.alert(message); return }
    const toast = document.createElement('div')
    toast.className = `fp-toast fp-toast-${type}`
    toast.textContent = message
    stack.appendChild(toast)
    setTimeout(() => {
        toast.classList.add('fp-toast-leaving')
        toast.addEventListener('animationend', () => toast.remove(), { once: true })
    }, 3000)
}

// ---------- Модалка подтверждения вместо confirm() ----------
function showConfirmModal({ title = 'Подтвердите действие', text = '', confirmLabel = 'Да', cancelLabel = 'Отмена' }) {
    return new Promise(resolve => {
        const modal = document.createElement('div')
        modal.className = 'modal-overlay'
        modal.innerHTML = `
            <div class="modal-content">
                <h3>${escapeHtml(title)}</h3>
                <p>${escapeHtml(text)}</p>
                <div class="modal-buttons">
                    <button class="cancel-btn">${escapeHtml(cancelLabel)}</button>
                    <button class="save-btn">${escapeHtml(confirmLabel)}</button>
                </div>
            </div>
        `
        const close = (result) => { modal.remove(); resolve(result) }
        modal.querySelector('.cancel-btn').addEventListener('click', () => close(false))
        modal.querySelector('.save-btn').addEventListener('click', () => close(true))
        modal.addEventListener('click', (e) => { if (e.target === modal) close(false) })
        document.body.appendChild(modal)
    })
}

// ---------- Скелетон загрузки для списков ----------
function renderSkeleton(container, rows = 3) {
    if (!container) return
    container.innerHTML = Array.from({ length: rows }).map(() => `
        <div class="friends-skeleton-row">
            <div class="friends-skeleton-avatar"></div>
            <div class="friends-skeleton-lines"></div>
        </div>
    `).join('')
}

// ---------- Защита кнопки действия от повторного нажатия ----------
async function runOnce(button, action) {
    if (!button || button.disabled) return
    const originalText = button.textContent
    button.disabled = true
    button.textContent = '…'
    try {
        await action()
    } finally {
        // Кнопка обычно исчезает при перерисовке списка, но на всякий случай откатываем
        if (button.isConnected) {
            button.disabled = false
            button.textContent = originalText
        }
    }
}

// Загружаем друзей при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    // Check if viewing someone else's profile
    const urlParams = new URLSearchParams(window.location.search)
    const userIdParam = urlParams.get('id')
    const currentUserId = localStorage.getItem('userId')
    
    if (userIdParam) {
        viewingUserId = parseInt(userIdParam)
    } else {
        viewingUserId = currentUserId ? parseInt(currentUserId) : null
    }
    

    if (window.location.pathname.includes('/profile') || window.location.pathname.includes('/friends')) {
    loadFriendsData(viewingUserId)
	}
    
    if (window.location.pathname.includes('/friends')) {
	setupSearch()
        fetch(`/api/users/bio/${viewingUserId}`)
            .then(r => r.json())
            .then(userBio => {
                if (userBio.profileBackground) {
                    document.body.style.backgroundImage = `url(${userBio.profileBackground})`;
                }
            })
            .catch(() => {});
    }
})

function setupSearch() {
    if (!searchInput) return
    
    const currentUserId = localStorage.getItem('userId')
    if (viewingUserId && viewingUserId !== parseInt(currentUserId)) {
        searchInput.style.display = 'none'
        return
    }

    // Debounce + защита от гонки: если ответ на старый запрос придёт позже
    // нового запроса, он больше не должен перезаписывать результаты
    let searchDebounceTimer = null
    let searchRequestToken = 0

    function queueSearch(query) {
        clearTimeout(searchDebounceTimer)
        if (!query) {
            exitSearchMode()
            searchBarContainer?.classList.remove('is-loading')
            return
        }
        searchBarContainer?.classList.add('is-loading')
        searchDebounceTimer = setTimeout(() => performSearch(query), 300)
    }

    // Search on input
    searchInput.addEventListener('input', function(e) {
        const query = e.target.value.trim()
        searchBarContainer?.classList.toggle('has-value', e.target.value.length > 0)
        queueSearch(query)
    })
    
    // Also search on Enter key — выполняем сразу, без ожидания дебаунса
    searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            clearTimeout(searchDebounceTimer)
            const query = e.target.value.trim()
            if (query.length >= 1) {
                performSearch(query)
            }
        }
        if (e.key === 'Escape') {
            exitSearchMode()
            searchInput.value = ''
            searchBarContainer?.classList.remove('has-value', 'is-loading')
        }
    })

    searchClearBtn?.addEventListener('click', () => {
        searchInput.value = ''
        searchInput.focus()
        clearTimeout(searchDebounceTimer)
        exitSearchMode()
        searchBarContainer?.classList.remove('has-value', 'is-loading')
    })
}

function performSearch(query) {
    if (!query || query.length < 1) return

    const requestToken = ++searchRequestTokenGlobal

    fetch(`/api/users/search?q=${encodeURIComponent(query)}`)
        .then(r => r.json())
        .then(users => {
            // Отбрасываем устаревший ответ, если пользователь уже успел ввести что-то новое
            if (requestToken !== searchRequestTokenGlobal) return

            currentSearchResults = users
            displaySearchResults(users)
            isSearchMode = true
            
            if (friendsListContainer) friendsListContainer.style.display = 'none'
            if (userSearchContainer) userSearchContainer.style.display = 'block'
        })
        .catch(err => console.error('Search error:', err))
        .finally(() => {
            if (requestToken === searchRequestTokenGlobal) {
                searchBarContainer?.classList.remove('is-loading')
            }
        })
}

function exitSearchMode() {
    isSearchMode = false
    if (friendsListContainer) friendsListContainer.style.display = 'block'
    if (userSearchContainer) userSearchContainer.style.display = 'none'
    if (searchInput) searchInput.value = ''
}

function developerBadgeHtml(user) {
    return window.FortPortRoles?.badgeHtml(user, { compact: true }) || ''
}

function roleNameClasses(user) {
    return `friend-card-name${user?.displayRole ? ` role-name role-name-${user.displayRole}` : ''}`
}

function displaySearchResults(users) {
    const container = document.getElementById('user-search-list')
    if (!container) return
    
    container.innerHTML = ''
    
    if (!users || users.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 30px; color: #666;">Пользователи не найдены</div>'
        return
    }
    
    const currentUserId = parseInt(localStorage.getItem('userId'))
    const currentUserFriends = currentFriendsData?.friends || []
    let cardIndex = 0

    users.forEach(user => {
        // Skip current user
        if (user.id === currentUserId) return
        
        const isFriend = currentUserFriends.some(f => f.id === user.id)
        
        const userCard = document.createElement('div')
        userCard.classList.add('friend-card', 'fp-card-in')
        userCard.style.animationDelay = `${Math.min(cardIndex++, 8) * 40}ms`
        
        userCard.innerHTML = `
            <img src="${user.profilePicture || '/default-avatar.jpg'}" class="friend-card-avatar frutiger-aero-border">
            <div class="friend-card-info">
                <div class="friend-card-name-row">
                    <a href="/profile?id=${user.id}" class="${roleNameClasses(user)}">${escapeHtml(user.username)}</a>
                    ${developerBadgeHtml(user)}
                </div>
                <span class="friend-card-type">${user.status ? user.status : ''}</span>
            </div>
            <div class="friends-page-buttons">
                ${isFriend 
                    ? `<button class="friend-card-btn" onclick="messageFriend(${user.id})">Написать</button>
                       <button class="friend-card-btn" onclick="removeFriend(${user.id}, this)">Отключить</button>`
                    : `<button class="friend-card-btn" onclick="sendFriendRequest(${user.id}, this)">Подключить</button>
                       <button class="friend-card-btn" onclick="messageFriend(${user.id})">Написать</button>`
                }
            </div>
        `
        
        container.appendChild(userCard)
    })
}

function loadFriendsData(userId) {
    if (!userId) {
        console.warn('No userId provided for loadFriendsData')
        return
    }
    
    const currentUserId = localStorage.getItem('userId')
    const isOwnProfile = userId === parseInt(currentUserId)
    
    // Update header text
    const headerElement = document.querySelector('.search-header h2')
    if (headerElement) {
        if (isOwnProfile) {
            headerElement.textContent = 'Мои друзья'
        } else {
            fetch(`/api/users/${userId}`)
                .then(r => r.json())
                .then(user => {
                    headerElement.textContent = `Друзья ${user.username}`
                })
                .catch(() => {
                    headerElement.textContent = 'Друзья пользователя'
                })
        }
    }
    
    // If viewing own profile, show pending requests section
    const pendingSection = document.querySelector('#pending-list')?.parentElement
    if (pendingSection) {
        pendingSection.style.display = isOwnProfile ? 'block' : 'none'
    }
    
    const friendsLabel = document.querySelector('#friends-list-container h2')
    if (friendsLabel) {
        if (isOwnProfile) {
            friendsLabel.textContent = 'Мои друзья'
            friendsLabel.style.display = 'block'
        } else {
            fetch(`/api/users/${userId}`)
                .then(r => r.json())
                .then(user => {
                    friendsLabel.textContent = `Друзья ${user.username}`
                })
                .catch(() => {
                    friendsLabel.textContent = 'Друзья пользователя'
                })
        }
    }
    
    if (searchInput) {
        searchInput.style.display = isOwnProfile ? 'block' : 'none'
    }
    
    renderSkeleton(document.getElementById('friends-list'), 3)
    if (isOwnProfile) renderSkeleton(document.getElementById('pending-list'), 2)

    // Load friends and pending in one request
    fetch(`/api/friends/${userId}`)
        .then(r => r.json())
        .then(data => {
            currentFriendsData = { 
                friends: data.friends || [], 
                pending: data.pending || [] 
            }
            
            displayFriends(data.friends || [], isOwnProfile)
            
            // Only show pending for own profile
            if (isOwnProfile) {
                displayPending(data.pending || [], true)
                const pendingCount = (data.pending || []).length
                // Clear existing badge first, then add new one
                clearFriendNotifications()
                updateFriendNotifications(pendingCount)
                
                const pendingCountElement = document.getElementById('pending-count')
                if (pendingCountElement) pendingCountElement.textContent = pendingCount
                updateFriendsBadge(pendingCount)
            } else {
                displayPending([], false)
                const pendingSection = document.querySelector('#pending-list')?.parentElement
                if (pendingSection) pendingSection.style.display = 'none'
                // Remove any badge if viewing someone else
                clearFriendNotifications()
            }
        })
        .catch(err => console.error('Error loading friends:', err))
}

function displayFriends(friends, showButtons = true) {
    const container = document.getElementById('friends-list')
    if (!container) return
    
    container.innerHTML = ''
    
    if (!friends || friends.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 30px; color: #666;">У пользователя нет друзей</div>'
        return
    }
    
    friends.forEach((friend, index) => {
        const friendCard = document.createElement('div')
        friendCard.classList.add('friend-card', 'fp-card-in')
        friendCard.style.animationDelay = `${Math.min(index, 8) * 40}ms`
        
        const buttonsHtml = showButtons ? `
            <div class="friends-page-buttons">
                <button class="friend-card-btn" onclick="messageFriend(${friend.id})">Написать</button>
                <button class="friend-card-btn" onclick="removeFriend(${friend.id}, this)">Отключить</button>
            </div>
        ` : `
            <div class="friends-page-buttons">
                <button class="friend-card-btn" onclick="messageFriend(${friend.id})">Написать</button>
            </div>
        `
        
        friendCard.innerHTML = `
            <img src="${friend.profilePicture || '/default-avatar.jpg'}" class="friend-card-avatar frutiger-aero-border">
            <div class="friend-card-info">
                <div class="friend-card-name-row">
                    <a href="/profile?id=${friend.id}" class="${roleNameClasses(friend)}">${escapeHtml(friend.username)}</a>
                    ${developerBadgeHtml(friend)}
                </div>
                <span class="friend-card-type">${friend.status ? friend.status : ''}</span>
            </div>
            ${buttonsHtml}
        `
        
        container.appendChild(friendCard)
    })
}

function displayPending(pending, showButtons = true) {
    const container = document.getElementById('pending-list')
    if (!container) return
    
    container.innerHTML = ''
    
    if (!pending || pending.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 30px; color: #666;">Нет новых заявок</div>'
        return
    }
    
    pending.forEach((requester, index) => {
        const requestCard = document.createElement('div')
        requestCard.classList.add('friend-card', 'fp-card-in')
        requestCard.style.animationDelay = `${Math.min(index, 8) * 40}ms`
        
        const buttonsHtml = showButtons ? `
            <div class="friends-page-buttons">
                <button class="friend-card-btn accept-btn" onclick="acceptRequest(${requester.id}, this)">Подключить</button>
                <button class="friend-card-btn reject-btn" onclick="rejectRequest(${requester.id}, this)">Отклонить</button>
            </div>
        ` : ''
        
        requestCard.innerHTML = `
            <img src="${requester.profilePicture || '/default-avatar.jpg'}" class="friend-card-avatar frutiger-aero-border">
            <div class="friend-card-info">
                <div class="friend-card-name-row">
                    <a href="/profile?id=${requester.id}" class="${roleNameClasses(requester)}">${escapeHtml(requester.username)}</a>
                    ${developerBadgeHtml(requester)}
                </div>
                <span class="friend-card-status">Хочет подключиться к вам в друзья</span>
            </div>
            ${buttonsHtml}
        `
        
        container.appendChild(requestCard)
    })
}

function acceptRequest(requesterUserId, btn) {
    return runOnce(btn, async () => {
        const currentUserId = localStorage.getItem('userId')
        try {
            const r = await fetch('/api/friends/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ requesterUserId: requesterUserId })
            })
            const data = await r.json()
            if (data.success) {
                showToast('Заявка принята', 'success')
                loadFriendsData(parseInt(currentUserId))
            } else {
                showToast(data.error || 'Не удалось принять заявку', 'error')
            }
        } catch (err) {
            console.error('Error accepting request:', err)
            showToast('Не удалось принять заявку', 'error')
        }
    })
}

function rejectRequest(requesterUserId, btn) {
    return runOnce(btn, async () => {
        const currentUserId = localStorage.getItem('userId')
        try {
            const r = await fetch('/api/friends/reject', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ requesterUserId: requesterUserId })
            })
            const data = await r.json()
            if (data.success) {
                loadFriendsData(parseInt(currentUserId))
            } else {
                showToast(data.error || 'Не удалось отклонить заявку', 'error')
            }
        } catch (err) {
            console.error('Error rejecting request:', err)
            showToast('Не удалось отклонить заявку', 'error')
        }
    })
}

function sendFriendRequest(toUserId, btn) {
    return runOnce(btn, async () => {
        const fromUserId = localStorage.getItem('userId')
        if (!fromUserId) return
        try {
            const r = await fetch('/api/friends/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ toUserId: toUserId })
            })
            const data = await r.json()
            if (data.success) {
                showToast('Заявка отправлена!', 'success')
                loadFriendsData(parseInt(fromUserId))
                if (isSearchMode && currentSearchResults) displaySearchResults(currentSearchResults)
            } else {
                showToast('Ошибка: ' + (data.error || 'Не удалось отправить заявку'), 'error')
            }
        } catch (err) {
            console.error('Error sending friend request:', err)
            showToast('Не удалось отправить заявку', 'error')
        }
    })
}

async function removeFriend(friendUserId, btn) {
    const confirmed = await showConfirmModal({
        title: 'Удалить из друзей?',
        text: 'Вы уверены, что хотите разорвать это подключение?',
        confirmLabel: 'Удалить',
        cancelLabel: 'Отмена'
    })
    if (!confirmed) return

    return runOnce(btn, async () => {
        const currentUserId = localStorage.getItem('userId')
        try {
            const r = await fetch('/api/friends/remove', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    friendId: friendUserId
                })
            })
            const data = await r.json()
            if (data.success) {
                loadFriendsData(parseInt(currentUserId))
            } else {
                showToast(data.error || 'Не удалось удалить из друзей', 'error')
            }
        } catch (err) {
            console.error('Error removing friend:', err)
            showToast('Не удалось удалить из друзей', 'error')
        }
    })
}

function messageFriend(friendUserId) {
    const userId = Number(friendUserId)
    if (!Number.isSafeInteger(userId)) return
    window.location.href = `/chats?id=${encodeURIComponent(userId)}`
}

function updateFriendsBadge(count) {
    const friendsLink = document.querySelector('a[href="/friends"]')
    if (friendsLink && count > 0) {
        // Remove existing badge first
        const existingBadge = friendsLink.querySelector('.notification-badge')
        if (existingBadge) existingBadge.remove()
        
        const badge = document.createElement('span')
        badge.className = 'notification-badge'
        badge.textContent = count > 99 ? '99+' : count
        friendsLink.appendChild(badge)
    }
}

function updateFriendNotifications(count) {
    const friendsLink = document.querySelector('a[href="/friends"]')
    if (!friendsLink) return
    
    const existingBadge = friendsLink.querySelector('.notification-badge')
    if (existingBadge) existingBadge.remove()
    
    if (count > 0) {
        const badge = document.createElement('span')
        badge.classList.add('notification-badge')
        badge.textContent = count > 99 ? '99+' : count
        friendsLink.appendChild(badge)
    }
}

function clearFriendNotifications() {
    const friendsLink = document.querySelector('a[href="/friends"]')
    if (friendsLink) {
        const badge = friendsLink.querySelector('.notification-badge')
        if (badge) badge.remove()
    }
}

function escapeHtml(str) {
    if (!str) return ''
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

// Make functions global
window.sendFriendRequest = sendFriendRequest
window.acceptRequest = acceptRequest
window.rejectRequest = rejectRequest
window.messageFriend = messageFriend
window.removeFriend = removeFriend
window.exitSearchMode = exitSearchMode