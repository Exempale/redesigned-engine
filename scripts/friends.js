// friends.js
let currentFriendsData = null
let currentSearchResults = null
let isSearchMode = false
let viewingUserId = null // Track whose profile we're viewing

// Get DOM elements
const friendsListContainer = document.getElementById('friends-list-container')
const userSearchContainer = document.getElementById('user-search-container')
const searchInput = document.getElementById('friend-search-input')

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
    
    // Search on input
    searchInput.addEventListener('input', function(e) {
        const query = e.target.value.trim()
        if (query.length >= 1) {
            performSearch(query)
        } else if (query.length === 0) {
            exitSearchMode()
        }
    })
    
    // Also search on Enter key
    searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            const query = e.target.value.trim()
            if (query.length >= 1) {
                performSearch(query)
            }
        }
        if (e.key === 'Escape') {
            exitSearchMode()
            searchInput.value = ''
        }
    })
}

function performSearch(query) {
    if (!query || query.length < 1) return
    
    fetch(`/api/users/search?q=${encodeURIComponent(query)}`)
        .then(r => r.json())
        .then(users => {
            currentSearchResults = users
            displaySearchResults(users)
            isSearchMode = true
            
            if (friendsListContainer) friendsListContainer.style.display = 'none'
            if (userSearchContainer) userSearchContainer.style.display = 'block'
        })
        .catch(err => console.error('Search error:', err))
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
    
    users.forEach(user => {
        // Skip current user
        if (user.id === currentUserId) return
        
        const isFriend = currentUserFriends.some(f => f.id === user.id)
        
        const userCard = document.createElement('div')
        userCard.classList.add('friend-card')
        
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
                       <button class="friend-card-btn" onclick="removeFriend(${user.id})">Отключить</button>`
                    : `<button class="friend-card-btn" onclick="sendFriendRequest(${user.id})">Подключить</button>
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
    
    friends.forEach(friend => {
        const friendCard = document.createElement('div')
        friendCard.classList.add('friend-card')
        
        const buttonsHtml = showButtons ? `
            <div class="friends-page-buttons">
                <button class="friend-card-btn" onclick="messageFriend(${friend.id})">Написать</button>
                <button class="friend-card-btn" onclick="removeFriend(${friend.id})">Отключить</button>
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
    
    pending.forEach(requester => {
        const requestCard = document.createElement('div')
        requestCard.classList.add('friend-card')
        
        const buttonsHtml = showButtons ? `
            <div class="friends-page-buttons">
                <button class="friend-card-btn accept-btn" onclick="acceptRequest(${requester.id})">Подключить</button>
                <button class="friend-card-btn reject-btn" onclick="rejectRequest(${requester.id})">Отклонить</button>
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

function acceptRequest(requesterUserId) {
    const currentUserId = localStorage.getItem('userId')
    
    fetch('/api/friends/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ requesterUserId: requesterUserId })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            loadFriendsData(parseInt(currentUserId))
        }
    })
    .catch(err => console.error('Error accepting request:', err))
}

function rejectRequest(requesterUserId) {
    const currentUserId = localStorage.getItem('userId')
    
    fetch('/api/friends/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ requesterUserId: requesterUserId })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            loadFriendsData(parseInt(currentUserId))
        }
    })
    .catch(err => console.error('Error rejecting request:', err))
}

function sendFriendRequest(toUserId) {
    const fromUserId = localStorage.getItem('userId')
    if (!fromUserId) return
    
    fetch('/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ toUserId: toUserId })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            alert('Заявка отправлена!')
            loadFriendsData(parseInt(fromUserId))
        } else {
            alert('Ошибка: ' + (data.error || 'Не удалось отправить заявку'))
        }
    })
    .catch(err => console.error('Error sending friend request:', err))
}

function removeFriend(friendUserId) {
    const currentUserId = localStorage.getItem('userId')
    if (!confirm('Удалить из друзей?')) return
    
    fetch('/api/friends/remove', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            friendId: friendUserId
        })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            loadFriendsData(parseInt(currentUserId))
        }
    })
    .catch(err => console.error('Error removing friend:', err))
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