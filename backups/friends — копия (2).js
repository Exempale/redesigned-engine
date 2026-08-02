// friends.js
let currentFriendsData = null

// Загружаем друзей при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
  loadFriendsData()
})

function loadFriendsData() {
  const userId = sessionStorage.getItem('userId')
  if (!userId) {
    return
  }
  
  fetch(`/api/friends/${userId}`)
    .then(r => r.json())
    .then(data => {
      currentFriendsData = data
      displayFriends(data.friends)
      displayPending(data.pending)
      
      // Update friend notification count
      const pendingCount = data.pending.length
      updateFriendNotifications(pendingCount)
      
      document.getElementById('pending-count').textContent = pendingCount
      updateFriendsBadge(pendingCount)
    })
    .catch(err => {
      console.error('Error loading friends:', err)
    })
}

// Clear notifications when viewing friends page
document.addEventListener('DOMContentLoaded', function() {
  clearFriendNotifications()
  loadFriendsData()
})

function displayFriends(friends) {
  const container = document.getElementById('friends-list')
  container.innerHTML = ''
  
  if (!friends || friends.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 30px; color: #666;">У вас пока нет друзей</div>'
    return
  }
  
  friends.forEach(friend => {
    const friendCard = document.createElement('div')
    friendCard.classList.add('friend-card')
    
    friendCard.innerHTML = `
      <img src="${friend.profilePicture || '/default-avatar.jpg'}" class="friend-card-avatar frutiger-aero-border">
      <div class="friend-card-info">
        <a href="/profile.html?id=${friend.id}" class="friend-card-name">${friend.username}</a>
      </div>
      <button class="friend-card-btn" onclick="messageFriend(${friend.id})">Сообщение</button>
    `
    
    container.appendChild(friendCard)
  })
}

function displayPending(pending) {
  const container = document.getElementById('pending-list')
  container.innerHTML = ''
  
  if (!pending || pending.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 30px; color: #666;">Нет новых заявок</div>'
    return
  }
  
  pending.forEach(requester => {
    const requestCard = document.createElement('div')
    requestCard.classList.add('friend-card')
    
    requestCard.innerHTML = `
      <img src="${requester.profilePicture || '/default-avatar.jpg'}" class="friend-card-avatar frutiger-aero-border">
      <div class="friend-card-info">
        <a href="/profile.html?id=${requester.id}" class="friend-card-name">${requester.username}</a>
        <span class="friend-card-status">Хочет подключиться к вам в друзья</span>
      </div>
      <div style="display: flex; gap: 10px;">
        <button class="friend-card-btn accept-btn" onclick="acceptRequest(${requester.id})">Подключить</button>
        <button class="friend-card-btn reject-btn" onclick="rejectRequest(${requester.id})">Отклонить</button>
      </div>
    `
    
    container.appendChild(requestCard)
  })
}

function acceptRequest(requesterUserId) {
  const currentUserId = sessionStorage.getItem('userId')
  
  fetch('/api/friends/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentUserId: parseInt(currentUserId),
      requesterUserId: requesterUserId
    })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      loadFriendsData()
    }
  })
  .catch(err => console.error('Error accepting request:', err))
}

function rejectRequest(requesterUserId) {
  const currentUserId = sessionStorage.getItem('userId')
  
  fetch('/api/friends/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentUserId: parseInt(currentUserId),
      requesterUserId: requesterUserId
    })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      loadFriendsData()
    }
  })
  .catch(err => console.error('Error rejecting request:', err))
}

function messageFriend(friendUserId) {
    if (typeof window.toggleChatsPanel === 'function') {
        window.toggleChatsPanel()
        setTimeout(() => {
            if (typeof window.openChatWithUser === 'function') {
                // Pass ID directly, no extra fetch needed
                window.openChatWithUser(friendUserId)
            }
        }, 100)
    }
}

function updateFriendsBadge(count) {
  const friendsLink = document.querySelector('a[href="/friends.html"]')
  if (friendsLink && count > 0) {
    friendsLink.innerHTML = `Друзья <span style="background-color: #4CAF50; color: white; padding: 2px 6px; border-radius: 12px; font-size: 12px; margin-left: 5px;">${count}</span>`
  }
}

// Функция для добавления в друзья (будет вызываться из профиля)
function sendFriendRequest(toUserId) {
  const fromUserId = sessionStorage.getItem('userId')
  
  fetch('/api/friends/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromUserId: parseInt(fromUserId),
      toUserId: toUserId
    })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      alert('Заявка отправлена!')
    } else {
      alert('Ошибка: ' + data.error)
    }
  })
  .catch(err => console.error('Error sending friend request:', err))
}

// Check for new friend requests every 30 seconds
setInterval(() => {
  const userId = sessionStorage.getItem('userId')
  if (!userId) return
  
  fetch(`/api/friends/${userId}`)
    .then(r => r.json())
    .then(data => {
      const pendingCount = data.pending.length
      updateFriendNotifications(pendingCount)
    })
    .catch(err => console.error('Error checking friend requests:', err))
}, 30000)

function updateFriendNotifications(count) {
  const friendsLink = document.querySelector('a[href="/friends.html"]')
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
  const friendsLink = document.querySelector('a[href="/friends.html"]')
  if (friendsLink) {
    const badge = friendsLink.querySelector('.notification-badge')
    if (badge) badge.remove()
  }
}

// Helper function to check if user is logged in
function isUserLoggedIn() {
  return sessionStorage.getItem('userId') !== null
}

// Делаем функции глобальными
window.sendFriendRequest = sendFriendRequest
window.acceptRequest = acceptRequest
window.rejectRequest = rejectRequest
window.messageFriend = messageFriend